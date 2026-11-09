// ADR-041 display snapshot on OpenCode 2 (lane seams I7b): `state.metadata.codepuppyDisplay` on a tool call.
// Replaces packages/opencode/src/session/tool-display.ts and the processor.ts takeover that wrote `part.display`.
//
// Where OpenCode 2 lets a plugin write a tool call's `state.metadata` (measured, #1662 L4 first step):
//   · running   — `session.tool.progress` (live replacement metadata) from the tool context's `progress`; reached by
//                 wrapping `execute` in `tool.transform`, so it covers tools registered before the wrapper.
//   · completed — `execute.after` `result.metadata` → `session.tool.success` metadata.
//   · error     — a `Tool.Error`'s `metadata` (a denied call's error, or `execute.after` replacing `error`), merged
//                 with the last progress snapshot by the session publisher.
// The snapshot is written once per call from the facts at decision time and never overwritten (ADR-041 §4).
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { parseToolDisplaySnapshot, type ToolDisplaySnapshotV1 } from "../../../schema/src/tool-identity"
import type { ToolFacts } from "./identity"

export const DISPLAY_KEY = "codepuppyDisplay"

export function displaySnapshot(facts: ToolFacts): ToolDisplaySnapshotV1 {
  return parseToolDisplaySnapshot({
    identity: facts.identity,
    technicalId: facts.technicalId,
    authority: facts.authority,
    ...(facts.location ? { location: facts.location } : {}),
    ...(facts.readable ? { readable: facts.readable } : {}),
  })
}

/** Marks wrappers this module installed, so a rebuild never wraps twice. */
const WRAPPED = Symbol.for("codepuppy.policy.display")

type Progress = (update: Record<string, unknown>) => Promise<void>
type Execute = (input: unknown, context: { progress: Progress } & Record<string, unknown>) => Promise<unknown>

/** `tool.transform` body: every listed tool first reports its call's snapshot, and later progress keeps it. */
export function wrapForDisplay(
  editor: {
    list(): readonly { id: string }[]
    update(id: string, update: (tool: { execute: Execute }) => void): void
  },
  snapshotOf: (callID: string) => ToolDisplaySnapshotV1 | undefined,
) {
  for (const { id } of editor.list()) {
    editor.update(id, (draft) => {
      if ((draft.execute as unknown as Record<symbol, unknown>)[WRAPPED]) return
      const inner = draft.execute
      const wrapped: Execute = async (input, context) => {
        const display = snapshotOf(String(context.id ?? ""))
        if (!display) return inner(input, context)
        const progress = context.progress
        await progress({ [DISPLAY_KEY]: display })
        return inner(input, { ...context, progress: (update) => progress({ ...update, [DISPLAY_KEY]: display }) })
      }
      Object.defineProperty(wrapped, WRAPPED, { value: true })
      draft.execute = wrapped
    })
  }
}

/** `execute.after` body: the terminal state carries the snapshot whether the call completed or failed. */
export function attachTerminal(
  event:
    | { status: "completed"; result: { metadata?: Record<string, unknown> } & Record<string, unknown> }
    | { status: "error"; error: InstanceType<typeof ToolError> },
  display: ToolDisplaySnapshotV1 | undefined,
) {
  if (!display) return
  if (event.status === "completed") {
    if (event.result.metadata?.[DISPLAY_KEY] !== undefined) return
    event.result = { ...event.result, metadata: { ...event.result.metadata, [DISPLAY_KEY]: display } }
    return
  }
  if (event.error.metadata?.[DISPLAY_KEY] !== undefined) return
  event.error = new ToolError({
    message: event.error.message,
    ...(event.error.error === undefined ? {} : { error: event.error.error }),
    metadata: { ...event.error.metadata, [DISPLAY_KEY]: display },
  })
}
