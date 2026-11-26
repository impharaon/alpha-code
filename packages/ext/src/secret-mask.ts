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
}
const WRAPPED = Symbol("secret-progress")

export function createSecretMask(roots: ProtectedFiles.ProtectedRoots) {
  const files = createSecretFiles(roots)
  const calls = new Map<string, CallState>()
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
  const finishProgress = async (state: CallState | undefined, failed: boolean) => {
    if (!state?.publish) return
    const safe = failed ? hiddenMetadata(state) : metadata(state.last)
    await state.publish(safe)
    state.published = safe
  }
  const service = {
    roots,
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
        const result: Tool.Result = {
          ...(input.result.output === undefined ? {} : { output: project(input.result.output) }),
          content:
            typeof input.result.content === "string"
              ? text(input.result.content)
              : input.result.content === undefined
                ? undefined
                : await Promise.all(input.result.content.map(content)),
          metadata: metadata(input.result.metadata),
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
        const error = new Tool.Error({
          message: text(input.error.message),
          metadata: metadata({ ...state?.last, ...input.error.metadata }),
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
    preview: async (value: Record<string, unknown>) => {
      try {
        await files.refresh()
        const safe = project(value)
        return typeof safe === "object" && safe !== null
          ? (safe as Record<string, unknown>)
          : { output: ProtectedFiles.REDACTED }
      } catch {
        return { output: ProtectedFiles.MASKING_FAILED_TEXT }
      }
    },
    wrap: (editor: ToolEditor) => {
      for (const tool of editor.list())
        editor.update(tool.id, (draft) => {
          if (Object.hasOwn(draft.execute, WRAPPED)) return
          const inner = draft.execute
          const wrapped: typeof inner = async (input, context) => {
            const state = stateOf(context, tool.id)
            if (state) state.publish = context.progress
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
