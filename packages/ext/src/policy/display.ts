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
import { classifyNetFailure, engineNetFailurePath } from "../../../schema/src/codepuppy-net-failure"
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

/**
 * `execute.after` body: the terminal state carries the snapshot whether the call completed or failed. The snapshot saved
 * for this decision always wins over a `codepuppyDisplay` the tool reported itself (review R1 #8): only Code Puppy
 * mints provenance (ADR-041 §5).
 */
export function attachTerminal(
  event:
    | { status: "completed"; result: { metadata?: Record<string, unknown> } & Record<string, unknown> }
    | { status: "error"; error: InstanceType<typeof ToolError> },
  display: ToolDisplaySnapshotV1 | undefined,
) {
  if (!display) return
  if (event.status === "completed") {
    event.result = { ...event.result, metadata: { ...event.result.metadata, [DISPLAY_KEY]: display } }
    return
  }
  event.error = new ToolError({
    message: event.error.message,
    ...(event.error.error === undefined ? {} : { error: event.error.error }),
    metadata: { ...event.error.metadata, [DISPLAY_KEY]: display },
  })
}

export const NET_FAILURE_KEY = "codepuppyNetFailure"

/**
 * `execute.after` body (#1572 AC4; v1 processor.ts failToolCall): a call that failed at the network layer carries the
 * layer and code Code Puppy's classifier attributes, read from the failure's original cause before only its message
 * survives. Only layer and code are stored; a failure the classifier does not recognise is left as it is.
 */
export function attachNetFailure(
  event:
    | { status: "completed" }
    | { status: "error"; input: unknown; error: InstanceType<typeof ToolError> },
  env: Record<string, string | undefined> = process.env,
) {
  if (event.status !== "error" || event.error.metadata?.[NET_FAILURE_KEY] !== undefined) return
  const target = (event.input as { url?: unknown } | undefined)?.url
  const net = classifyNetFailure(event.error.error ?? event.error, engineNetFailurePath(typeof target === "string" ? target : undefined, env))
  if (!net) return
  event.error = new ToolError({
    message: event.error.message,
    ...(event.error.error === undefined ? {} : { error: event.error.error }),
    metadata: { ...event.error.metadata, [NET_FAILURE_KEY]: net },
  })
}
