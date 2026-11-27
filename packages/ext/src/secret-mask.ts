import { restoreEnvMutation, type EnvMutation, type EnvSnapshot } from "./secret-mutations"
import { ShellResult } from "../../core/src/shell/result"
import { projectEnvDiff } from "./secret-diff"
import { constants } from "node:fs"
import { access, open, readFile, stat, unlink } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import type { ShellCapture } from "@opencode/plugin/promise/shell"
import { createSecretSpool, type SecretSpool } from "./secret-spool"
import { createSecretStream } from "./secret-stream"
import path from "node:path"
import { Option, Schema } from "effect"
import type { ToolFacts } from "./policy/identity"
import { AUTOMATION_PROFILES, UNATTENDED_DENIAL_KEY, UnattendedDenial, unattendedDenialCopy, type UnattendedProfile } from "../../schema/src/codepuppy-unattended"
import { credentialValues, envAssignments, envSecret } from "./secret-values"
import { projectSecretRead } from "./secret-read"
import { isUtf8 } from "node:buffer"
import { fileURLToPath } from "node:url"
import { Error as ToolError, type ToolEditor, type ToolContext } from "@opencode/plugin/promise/tool"
// Type only: a runtime relative import of the schema tool module splits Tool.Error from Core's in the engine.
import type { Tool } from "../../schema/src/tool"
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
  runtime?: Record<string, unknown>
  mutations?: EnvSnapshot[]
  read?: { before?: string; requested: string; target: string }
}
const WRAPPED = Symbol("secret-progress")

export function createSecretMask(roots: ProtectedFiles.ProtectedRoots) {
  const files = createSecretFiles(roots)
  const calls = new Map<string, CallState>()
  // Design §10 SPEC5-03: Location release takes no new calls; the calls already running finish masking, then values clear.
  let closing = false
  const settle = () => {
    if (closing && calls.size === 0) files.dispose()
  }
  // After release only the calls already running (and their Code Mode children) produce output; any other is withheld.
  const admitted = (call: MaskCall) => !closing || calls.has(toolCallKey(call))
  const views = new WeakMap<object, () => Tool.Result>()
  type Capture = { raw: SecretSpool; stream: ReturnType<typeof createSecretStream>; publish: ShellCapture["publish"] }
  const captures = new Map<string, Capture>()
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
  const permissionCause = (cause: unknown, mode: "mask" | "hide", seen = new Set<object>()): unknown => {
    if (!cause || typeof cause !== "object" || seen.has(cause)) return undefined
    seen.add(cause)
    const source = cause as { _tag?: string; error?: unknown; message?: string; reason?: string; feedback?: string; rules?: unknown; permission?: string; resources?: unknown }
    if (source._tag !== "Permission.BlockedError" && source._tag !== "Permission.CorrectedError")
      return permissionCause(source.error, mode, seen)
    const fields = mode === "hide"
      ? { rules: [], permission: source.permission, resources: [], reason: ProtectedFiles.MASKING_FAILED_TEXT, feedback: ProtectedFiles.MASKING_FAILED_TEXT, message: ProtectedFiles.MASKING_FAILED_TEXT }
      : project(Object.fromEntries(Object.entries(source).filter(([key]) => ["rules", "permission", "resources", "reason", "feedback"].includes(key)))) as Record<string, unknown>
    // Preserve the engine's actual class prototype across the separately bundled extension boundary.
    return Object.create(Object.getPrototypeOf(cause), Object.fromEntries(Object.entries({ ...fields, _tag: source._tag }).map(([key, value]) => [key, { value, enumerable: true, configurable: true, writable: true }])))
  }
  const metadata = (value?: Tool.Metadata): Tool.Metadata => {
    const { [DISPLAY_KEY]: display, ...dynamic } = value ?? {}
    const masked = project(dynamic)
    return {
      ...(typeof masked === "object" && masked !== null ? masked : { output: ProtectedFiles.REDACTED }),
      ...(display === undefined ? {} : { [DISPLAY_KEY]: display }),
    }
  }
  // The policy's own unattended denial survives hiding so the automation still records the run failed; its sentence is
  // rebuilt from the fixed copy instead of keeping the incoming text.
  const hiddenDenial = (value?: Tool.Metadata): Tool.Metadata => {
    const denial = Schema.decodeUnknownOption(UnattendedDenial)(value?.[UNATTENDED_DENIAL_KEY])
    if (Option.isNone(denial)) return {}
    const { reason, tool } = denial.value
    return { [UNATTENDED_DENIAL_KEY]: { version: 1, reason, tool, message: unattendedDenialCopy(reason, tool) } }
  }
  const hiddenMetadata = (state?: CallState, terminal?: Tool.Metadata): Tool.Metadata => ({
    output: ProtectedFiles.MASKING_FAILED_TEXT,
    ...(state?.kind === "execute" ? { toolCalls: [] } : {}),
    ...(state?.published?.[DISPLAY_KEY] === undefined ? {} : { [DISPLAY_KEY]: state.published[DISPLAY_KEY] }),
    ...hiddenDenial(terminal),
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
    const safe = failed ? hiddenMetadata(state) : { ...metadata(state.last), ...state.runtime }
    await state.publish(safe)
    state.published = safe
  }
  const service = {
    roots,
    capture: async (input: ShellCapture) => {
      let staging: string | undefined
      const release = async () => {
        const state = captures.get(input.id)
        captures.delete(input.id)
        await state?.stream.dispose()
        await state?.raw.dispose()
      }
      try {
        if (input.withheld) throw new Error("Hidden shell capture")
        await files.refresh()
        if (input.phase === "start") {
          const raw = await createSecretSpool(input.file, input.id)
          // Capture material is cleared at release and never re-established, also when release came during this start
          // (design §10 SPEC5-03); later phases find no capture and are withheld.
          if (closing) {
            await raw.dispose()
            throw new Error("Location released")
          }
          const state: Capture = { raw, publish: input.publish, stream: createSecretStream(input.file, input.id, files.values, (bytes) => state.publish(bytes)) }
          captures.set(input.id, state)
          return
        }
        const state = captures.get(input.id)
        if (!state) throw new Error("Shell capture released")
        state.publish = input.publish
        if (input.phase === "chunk") {
          await state.raw.append(input.bytes)
          await state.stream.push(input.bytes)
          return
        }
        await state.stream.dispose()
        staging = `${input.file}.safe.${randomUUID()}`
        const handle = await open(staging, "wx", 0o600)
        let size = 0
        let newlines = 0
        const stream = createSecretStream(input.file, input.id, files.values, async (bytes) => {
          let offset = 0
          while (offset < bytes.length) {
            const written = await handle.write(bytes, offset, bytes.length - offset)
            if (!written.bytesWritten) throw new Error("Safe capture write failed")
            offset += written.bytesWritten
          }
          size += bytes.length
          for (const byte of bytes) if (byte === 10) newlines++
        })
        try {
          for await (const bytes of state.raw.read()) await stream.push(bytes)
          await stream.finish()
        } finally { await stream.dispose(); await handle.close() }
        input.replacement = { file: staging, size, newlines }
        input.disposition = "replace"
        staging = undefined
        await release()
      } catch {
        input.disposition = "withhold"
        await release()
      } finally { if (staging) await unlink(staging).catch(() => {}) }
    },
    // Spec v6 BR-05: protected files a shell command names literally join collection before it spawns, so the capture
    // start's refresh reads them and every chunk is masked; so does the list file a named link literally points to. The
    // working directory resolves like the engine's `workdir`.
    command: async (input: { command: string; cwd: string }) => {
      const api = roots.platform === "win32" ? path.win32 : path.posix
      const directory = api.resolve(roots.directory, /^~(?:[/\\]|$)/.test(input.cwd) ? api.join(roots.home, input.cwd.slice(1)) : input.cwd)
      const named = { text: input.command, roots: { ...roots, directory } }
      for (const file of ProtectedFiles.named(named)) files.track(file)
      for (const candidate of ProtectedFiles.literalPaths(named)) await files.trackLink(candidate)
    },
    prepareMutation: async (input: EnvMutation): Promise<EnvMutation> => (await prepareMutation(input)).mutation,
    read: async (input: { call: MaskCall; file: ProtectedFiles.ProtectedFile; result: Tool.Result }): Promise<Tool.Result> => {
      const state = stateOf(input.call, "read")
      const running = admitted(input.call)
      // A protected file outside every scanned source joins later collection once read (spec v5 BR-05).
      if (running) files.track(input.file)
      try {
        if (!running) throw new Error("Location released")
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
      if (closing || calls.get(toolCallKey(input.call))?.kind === "execute") return
      const state: CallState = { kind: input.kind, failed: false }
      calls.set(toolCallKey(input.call), state)
      try {
        await files.refresh()
      } catch {
        state.failed = true
      }
    },
    result: async (input: { call: MaskCall; tool: string; facts: ToolFacts | undefined; result: Tool.Result }): Promise<Tool.Result> => {
      const state = stateOf(input.call, input.tool)
      try {
        if (!admitted(input.call)) throw new Error("Location released")
        await files.refresh()
        if (state?.failed) throw new Error("Hidden tool output")
        const view = views.get(input.result)?.()
        const payload = view ?? await mutationProjection(input.result, state) as Tool.Result
        const output = view ? view.output : payload.output === undefined ? undefined : project(payload.output)
        const runtime = shellRuntime(payload.output, input.facts)
        const result: Tool.Result = {
          ...(output === undefined ? {} : { output: Object.keys(runtime.fields).length ? { ...(typeof output === "object" && output !== null ? output : {}), ...runtime.fields } : output }),
          content: view ? view.content :
            typeof input.result.content === "string"
              ? text(input.result.content)
              : input.result.content === undefined
                ? undefined
                : await Promise.all(input.result.content.map((item, index) => item.type === "text" && index === input.result.content!.length - 1 && item.text === runtime.notice ? Promise.resolve(item) : content(item))),
          metadata: { ...metadata(payload.metadata), ...shellRuntime(payload.metadata, input.facts).fields, ...(view ? { truncated: payload.metadata?.truncated } : {}) },
        }
        await finishProgress(state, false)
        return result
      } catch {
        if (state) state.failed = true
        const safe = hiddenMetadata(state, input.result.metadata)
        try {
          await finishProgress(state, true)
        } catch {
          /* The terminal payload still replaces all dynamic fields. */
        }
        return { content: [{ type: "text", text: ProtectedFiles.MASKING_FAILED_TEXT }], metadata: safe }
      } finally {
        if (state) calls.delete(toolCallKey(input.call))
        settle()
      }
    },
    error: async (input: { call: MaskCall; tool: string; error: Tool.Error }): Promise<Tool.Error> => {
      const state = stateOf(input.call, input.tool)
      // Masking keeps the incoming class: Core recognises its errors by class (as in policy/display.ts).
      const Constructor = input.error.constructor as typeof ToolError
      try {
        if (!admitted(input.call)) throw new Error("Location released")
        await files.refresh()
        if (state?.failed) throw new Error("Hidden tool output")
        if (state?.mutations?.some((snapshot) => [snapshot.before, snapshot.after].some((source) => source !== undefined && envAssignments(source).some((record) => envSecret(record) && record.rhs.split(/\r?\n/).some((part) => {
          const fragment = part.replace(/^["'`]|["'`]$/g, "")
          return fragment.length > 0 && input.error.message.includes(fragment)
        }))))) throw new Error("Restored env excerpt in error")
        const error = new Constructor({
          message: text(input.error.message),
          error: permissionCause(input.error, "mask"),
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
        return new Constructor({ message: ProtectedFiles.MASKING_FAILED_TEXT, error: permissionCause(input.error, "hide"), metadata: hiddenMetadata(state, input.error.metadata) })
      } finally {
        if (state) calls.delete(toolCallKey(input.call))
        settle()
      }
    },
    progress: async (input: { call: MaskCall; facts: ToolFacts | undefined; update: Tool.Metadata }): Promise<Tool.Metadata> => {
      const state = calls.get(toolCallKey(input.call))
      try {
        if (!admitted(input.call)) throw new Error("Location released")
        await files.refresh()
        if (state?.failed) throw new Error("Hidden tool output")
        const runtime = shellRuntime(input.update, input.facts).fields
        if (state) { state.last = input.update; state.runtime = runtime }
        const safe = { ...metadata(input.update), ...runtime }
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
                    throw new ToolError({ message: `${(cause as NodeJS.ErrnoException).code === "ENOENT" ? "File not found:" : "Unable to read"} ${request.path}` })
                  }
                  if (!Schema.isSchema(draft.output)) throw new ToolError({ message: ProtectedFiles.MASKING_FAILED_TEXT })
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
    release: (call: MaskCall) => {
      calls.delete(toolCallKey(call))
      settle()
    },
    dispose: () => {
      closing = true
      for (const state of captures.values()) { void state.stream.dispose(); void state.raw.dispose() }
      captures.clear()
      settle()
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

/** Only the verified engine shell's runtime envelope is authoritative; arbitrary tool fields remain dynamic. */
function shellRuntime(value: unknown, facts: ToolFacts | undefined) {
  if (facts?.identity.source !== "builtin" || facts.identity.name !== "shell" || typeof value !== "object" || value === null) return { fields: {}, notice: undefined }
  const output = value as Parameters<typeof ShellResult.metadata>[0] & { status?: string; shellID?: string }
  return {
    fields: Object.fromEntries(Object.entries({ ...ShellResult.metadata(output), status: output.status, shellID: output.shellID }).filter(([, value]) => value !== undefined)),
    notice: ShellResult.notice(output),
  }
}
