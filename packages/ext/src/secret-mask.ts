import { restoreEnvMutation, type EnvMutation, type EnvSnapshot } from "./secret-mutations"
import { projectEnvDiff } from "./secret-diff"
import { constants } from "node:fs"
import { access, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import type { ToolFacts } from "./policy/identity"
import { AUTOMATION_PROFILES, type UnattendedProfile } from "../../schema/src/codepuppy-unattended"
import { credentialValues, envAssignments } from "./secret-values"
import { projectSecretRead } from "./secret-read"
import { isUtf8 } from "node:buffer"
import { fileURLToPath } from "node:url"
import type { ToolEditor, ToolContext } from "@opencode/plugin/promise/tool"
import { Tool } from "../../schema/src/tool"
import { ProtectedFiles } from "../../schema/src/codepuppy-protected-files"
import { stripAnsi } from "../../session-ui/src/tools/ansi"
import { toolCallKey } from "./policy/identity"
import { DISPLAY_KEY } from "./policy/display"
import { createSecretFiles, resolveProtectedFile } from "./secret-files"

type MaskCall = { sessionID: string; messageID: string; id: string }
type CallState = {
  kind: "tool" | "execute"
  failed: boolean
  last?: Tool.Metadata
  published?: Tool.Metadata
  publish?: ToolContext["progress"]
  mutations?: EnvSnapshot[]
  read?: { before?: string; requested: string; target: string }
}
const WRAPPED = Symbol("secret-progress")

export function createSecretMask(roots: ProtectedFiles.ProtectedRoots) {
  const files = createSecretFiles(roots)
  const calls = new Map<string, CallState>()
  const views = new WeakMap<object, () => Tool.Result>()
  const stateOf = (call: MaskCall, tool: string) => {
    const state = calls.get(toolCallKey(call))
    return state?.kind === "execute" && tool !== "execute" ? undefined : state
  }
  const text = (value: string) =>
    Buffer.from(
      replaceSecretBytes(
        Buffer.from(stripAnsi(value)),
        files.values().flatMap((value) => {
          if (!isUtf8(value)) return []
          const normalized = Buffer.from(stripAnsi(Buffer.from(value).toString()))
          return normalized.length ? [normalized] : []
        }),
      ),
    ).toString()
  const project = (value: unknown, seen = new Set<object>()): unknown => {
    if (typeof value === "string") return text(value)
    if (typeof value === "number" || typeof value === "boolean")
      return text(String(value)) === String(value) ? value : ProtectedFiles.REDACTED
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint")
      throw new Error("Invalid dynamic tool payload")
    if (typeof value !== "object" || value === null) return value
    if (seen.has(value)) throw new Error("Cyclic tool payload")
    seen.add(value)
    try {
      if (Array.isArray(value)) return value.map((item) => project(item, seen))
      const result: Record<string, unknown> = Object.create(null)
      for (const [key, child] of Object.entries(value)) {
        const name = text(key)
        if (Object.hasOwn(result, name)) return ProtectedFiles.REDACTED
        Object.defineProperty(result, name, { value: project(child, seen), enumerable: true })
      }
      return result
    } finally {
      seen.delete(value)
    }
  }
  const metadata = (value?: Tool.Metadata): Tool.Metadata => {
    const { [DISPLAY_KEY]: display, ...dynamic } = value ?? {}
    const masked = project(dynamic)
    return {
      ...(typeof masked === "object" && masked !== null ? masked : { output: ProtectedFiles.REDACTED }),
      ...(display === undefined ? {} : { [DISPLAY_KEY]: display }),
    }
  }
  const hiddenMetadata = (state?: CallState): Tool.Metadata => ({
    output: ProtectedFiles.MASKING_FAILED_TEXT,
    ...(state?.kind === "execute" ? { toolCalls: [] } : {}),
    ...(state?.published?.[DISPLAY_KEY] === undefined ? {} : { [DISPLAY_KEY]: state.published[DISPLAY_KEY] }),
  })
  const content = async (item: Tool.Content): Promise<Tool.Content> => {
    if (item.type === "text") return { type: "text", text: text(item.text) }
    if (item.uri.startsWith("data:")) {
      const match = item.uri.match(/^data:([^,]*),([\s\S]*)$/)
      if (!match) throw new Error("Invalid inline tool content")
      const bytes = /;base64(?:;|$)/i.test(match[1])
        ? Buffer.from(match[2], "base64")
        : Buffer.from(decodeURIComponent(match[2]))
      const masked = replaceSecretBytes(bytes, files.values())
      const textual = /^(?:text\/|application\/(?:[^;]+\+)?(?:json|xml|javascript)(?:;|$))/.test(item.mime)
      if ((!textual && !Buffer.from(masked).equals(bytes)) || text(item.mime) !== item.mime)
        return { type: "text", text: ProtectedFiles.REDACTED }
      const value = textual ? Buffer.from(text(new TextDecoder("utf-8", { fatal: true }).decode(bytes))) : bytes
      return {
        type: "file",
        mime: item.mime,
        uri: `data:${match[1]},${/;base64(?:;|$)/i.test(match[1]) ? value.toString("base64") : encodeURIComponent(value.toString())}`,
        ...(item.name === undefined ? {} : { name: text(item.name) }),
      }
    }
    const referenced = item.uri.startsWith("file:") ? fileURLToPath(item.uri) : item.uri
    if (
      (!/^[a-z][a-z0-9+.-]*:/i.test(item.uri) || item.uri.startsWith("file:")) &&
      (await resolveProtectedFile(referenced, roots))
    )
      return { type: "text", text: ProtectedFiles.PROTECTED_FILE_TEXT }
    return {
      type: "file",
      uri: text(item.uri),
      mime: text(item.mime),
      ...(item.name === undefined ? {} : { name: text(item.name) }),
    }
  }
  const prepareMutation = async (input: EnvMutation) => {
    const prepared = await restoreEnvMutation(input, roots)
    for (const snapshot of prepared.snapshots)
      for (const source of [snapshot.before, snapshot.after])
        if (source !== undefined) files.remember(credentialValues(snapshot.file, Buffer.from(source)))
    return prepared
  }
  const mutationProjection = async (value: unknown, state?: CallState): Promise<unknown> => {
    if (!state?.mutations?.length) return value
    const sources = new Map(await Promise.all(state.mutations.map(async (snapshot) => [snapshot.path, [snapshot.before, snapshot.after, await readFile(snapshot.path).then((bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).catch(() => undefined)].filter((source): source is string => source !== undefined)] as const)))
    const visit = (item: unknown): unknown => {
      if (Array.isArray(item)) return item.map(visit)
      if (typeof item !== "object" || item === null) return item
      const result: Record<string, unknown> = Object.create(null)
      for (const [key, child] of Object.entries(item))
        result[key] = key === "patch" && typeof child === "string" && typeof (item as { file?: unknown }).file === "string" && state.mutations?.some((snapshot) => snapshot.path === path.resolve(roots.directory, (item as { file: string }).file))
          ? projectEnvDiff(child, sources.get(path.resolve(roots.directory, (item as { file: string }).file)) ?? [], text) : visit(child)
      const data = item as { diff?: unknown; files?: unknown }
      if (typeof data.diff === "string" && Array.isArray(data.files)) {
        const original = data.files.map((file: { patch?: unknown }) => typeof file.patch === "string" ? `${file.patch}\n` : "").join("")
        if (data.diff !== original) throw new Error("Unattributed mutation diff")
        result.diff = (result.files as { patch: string }[]).map((file) => `${file.patch}\n`).join("")
      }
      return result
    }
    return visit(value)
  }
  const finishProgress = async (state: CallState | undefined, failed: boolean) => {
    if (!state?.publish) return
    const safe = failed ? hiddenMetadata(state) : metadata(state.last)
    await state.publish(safe)
    state.published = safe
  }
  const service = {
    roots,
    prepareMutation: async (input: EnvMutation): Promise<EnvMutation> => (await prepareMutation(input)).mutation,
    read: async (input: { call: MaskCall; file: ProtectedFiles.ProtectedFile; result: Tool.Result }): Promise<Tool.Result> => {
      const state = stateOf(input.call, "read")
      try {
        const after = input.file.view === "variables" ? new TextDecoder("utf-8", { fatal: true }).decode(await readFile(state?.read?.target ?? input.file.path)) : undefined
        if (after !== undefined) files.remember(credentialValues(input.file, Buffer.from(after)))
        const render = () => projectSecretRead({ file: input.file, result: input.result, sources: [state?.read?.before, after].filter((source): source is string => source !== undefined), requested: state?.read?.requested ?? input.file.path, target: state?.read?.target ?? input.file.path, mask: text })
        const safe = render()
        views.set(safe, render)
        return safe
      } catch {
        if (state) state.failed = true
        return { content: [{ type: "text", text: ProtectedFiles.MASKING_FAILED_TEXT }] }
      }
    },
    isRoot: (call: MaskCall, tool: string) => stateOf(call, tool) !== undefined,
    begin: async (input: { call: MaskCall; kind: "tool" | "execute" }) => {
      if (calls.get(toolCallKey(input.call))?.kind === "execute") return
      const state: CallState = { kind: input.kind, failed: false }
      calls.set(toolCallKey(input.call), state)
      try {
        await files.refresh()
      } catch {
        state.failed = true
      }
    },
    result: async (input: { call: MaskCall; tool: string; result: Tool.Result }): Promise<Tool.Result> => {
      const state = stateOf(input.call, input.tool)
      try {
        await files.refresh()
        if (state?.failed) throw new Error("Hidden tool output")
        const view = views.get(input.result)?.()
        const payload = view ?? await mutationProjection(input.result, state) as Tool.Result
        const result: Tool.Result = {
          ...(view ? { output: view.output } : payload.output === undefined ? {} : { output: project(payload.output) }),
          content: view ? view.content :
            typeof input.result.content === "string"
              ? text(input.result.content)
              : input.result.content === undefined
                ? undefined
                : await Promise.all(input.result.content.map(content)),
          metadata: { ...metadata(payload.metadata), ...(view ? { truncated: payload.metadata?.truncated } : {}) },
        }
        await finishProgress(state, false)
        return result
      } catch {
        if (state) state.failed = true
        const safe = hiddenMetadata(state)
        try {
          await finishProgress(state, true)
        } catch {
          /* The terminal payload still replaces all dynamic fields. */
        }
        return { content: [{ type: "text", text: ProtectedFiles.MASKING_FAILED_TEXT }], metadata: safe }
      } finally {
        if (state) calls.delete(toolCallKey(input.call))
      }
    },
    error: async (input: { call: MaskCall; tool: string; error: Tool.Error }): Promise<Tool.Error> => {
      const state = stateOf(input.call, input.tool)
      try {
        await files.refresh()
        if (state?.failed) throw new Error("Hidden tool output")
        if (state?.mutations?.some((snapshot) => [snapshot.before, snapshot.after].some((source) => source !== undefined && envAssignments(source).some((record) => !ProtectedFiles.isPublicValue(record) && record.rhs.split(/\r?\n/).some((part) => {
          const fragment = part.replace(/^["'`]|["'`]$/g, "")
          return fragment.length > 0 && input.error.message.includes(fragment)
        }))))) throw new Error("Restored env excerpt in error")
        const error = new Tool.Error({
          message: text(input.error.message),
          metadata: metadata(await mutationProjection({ ...state?.last, ...input.error.metadata }, state) as Tool.Metadata),
        })
        await finishProgress(state, false)
        return error
      } catch {
        if (state) state.failed = true
        try {
          await finishProgress(state, true)
        } catch {
          /* Never recover the previous dynamic progress. */
        }
        return new Tool.Error({ message: ProtectedFiles.MASKING_FAILED_TEXT, metadata: hiddenMetadata(state) })
      } finally {
        if (state) calls.delete(toolCallKey(input.call))
      }
    },
    progress: async (input: { call: MaskCall; update: Tool.Metadata }): Promise<Tool.Metadata> => {
      const state = calls.get(toolCallKey(input.call))
      try {
        await files.refresh()
        if (state?.failed) throw new Error("Hidden tool output")
        if (state) state.last = input.update
        const safe = metadata(input.update)
        if (state) state.published = safe
        return safe
      } catch {
        if (state) state.failed = true
        return {
          ...hiddenMetadata(state),
          output: ProtectedFiles.MASKING_FAILED_TEXT,
        }
      }
    },
    preview: async (value: Record<string, unknown>, call?: MaskCall) => {
      try {
        await files.refresh()
        const safe = project(await mutationProjection(value, call ? calls.get(toolCallKey(call)) : undefined))
        return typeof safe === "object" && safe !== null
          ? (safe as Record<string, unknown>)
          : { output: ProtectedFiles.REDACTED }
      } catch {
        return { output: ProtectedFiles.MASKING_FAILED_TEXT }
      }
    },
    wrap: (editor: ToolEditor, readAccess: {
      facts: (tool: string) => Promise<ToolFacts | undefined>
      profile: (sessionID: string, agent?: string) => Promise<UnattendedProfile | undefined>
      protect: (call: MaskCall, file: ProtectedFiles.ProtectedFile) => void
    }) => {
      for (const tool of editor.list())
        editor.update(tool.id, (draft) => {
          if (Object.hasOwn(draft.execute, WRAPPED)) return
          const inner = draft.execute
          const wrapped: typeof inner = async (input, context) => {
            const state = stateOf(context, tool.id)
            if (state) state.publish = context.progress
            const facts = await readAccess.facts(tool.id)
            if (facts?.identity.source === "builtin" && facts.identity.name === "read" && !Object.hasOwn(AUTOMATION_PROFILES, context.agent) && await readAccess.profile(context.sessionID, context.agent) === undefined) {
              const request = input as { path: string }
              const target = path.resolve(roots.directory, request.path)
              const file = await resolveProtectedFile(target, roots)
              if (file) {
                readAccess.protect(context, file)
                if (file.view === "notice") {
                  try { await stat(target); await access(target, constants.R_OK) } catch (cause) {
                    throw new Tool.Error({ message: `${(cause as NodeJS.ErrnoException).code === "ENOENT" ? "File not found:" : "Unable to read"} ${request.path}` })
                  }
                  if (!Schema.isSchema(draft.output)) throw new Tool.Error({ message: ProtectedFiles.MASKING_FAILED_TEXT })
                  return { output: Schema.decodeUnknownSync(draft.output)({ type: "text-page", content: ProtectedFiles.PROTECTED_FILE_TEXT, mime: "text/plain", offset: 1, truncated: false }), content: [{ type: "text", text: ProtectedFiles.PROTECTED_FILE_TEXT }], metadata: { truncated: false } }
                }
                const before = await readFile(file.path).then((bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).catch(() => undefined)
                if (state) state.read = { before, requested: request.path, target: file.path }
                return inner({ ...request, path: file.path }, context)
              }
            }
            if (facts?.identity.source === "builtin" && (facts.identity.name === "write" || facts.identity.name === "edit" || facts.identity.name === "patch")) {
              const prepared = await prepareMutation({ ...(input as object), operation: facts.identity.name } as EnvMutation)
              if (state) state.mutations = prepared.snapshots
              const result = await inner(prepared.mutation, context)
              if (!("replacements" in prepared)) return result
              const count = prepared.replacements
              const displayCount = (value: string) => value.replace(/\(1 replacement\)$/, `(${count} replacements)`)
              return { ...result, output: { ...(result.output as object), replacements: count }, content: typeof result.content === "string" ? displayCount(result.content) : result.content?.map((item) => item.type === "text" ? { ...item, text: displayCount(item.text) } : item) }
            }
            return inner(input, {
              ...context,
              progress: async (update) => {
                // Core makes child progress a no-op; it must not overwrite the outer execute snapshot.
                if (!state && calls.get(toolCallKey(context))?.kind === "execute") return
                // SC-02 masks once at the root publication boundary.
                await context.progress(update)
              },
            })
          }
          Object.defineProperty(wrapped, WRAPPED, { value: true })
          draft.execute = wrapped
        })
    },
    release: (call: MaskCall) => { calls.delete(toolCallKey(call)) },
    dispose: () => {
      calls.clear()
      files.dispose()
    },
  }
  return service
}

/** Leftmost, then longest at the same position; replacements are never rescanned. */
export function replaceSecretBytes(bytes: Uint8Array, values: readonly Uint8Array[]): Uint8Array {
  const source = Buffer.from(bytes)
  const pieces: Uint8Array[] = []
  let cursor = 0
  while (cursor < source.length) {
    let position = source.length
    let length = 0
    for (const value of values) {
      if (!value.length) continue
      const index = source.indexOf(value, cursor)
      if (index !== -1 && (index < position || (index === position && value.length > length))) {
        position = index
        length = value.length
      }
    }
    pieces.push(source.subarray(cursor, position))
    if (!length) break
    pieces.push(Buffer.from(ProtectedFiles.REDACTED))
    cursor = position + length
  }
  return Buffer.concat(pieces)
}
