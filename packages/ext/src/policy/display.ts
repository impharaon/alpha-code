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
import { codepuppyBootstrap } from "../../../util/src/codepuppy-bootstrap"
import { UNATTENDED_DENIAL_KEY, type UnattendedDenial } from "../../../schema/src/codepuppy-unattended"
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { parseToolDisplaySnapshot, type ToolDisplaySnapshotV1 } from "../../../schema/src/tool-identity"
import { classifyNetFailure, engineNetFailurePath } from "../../../schema/src/codepuppy-net-failure"
import type { ToolFacts } from "./identity"
import { dirname, resolve } from "node:path"
import { WRITE_DENIED_NOTE } from "../context-injection"

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

export const WRITE_DENIED_KEY = "codepuppyWriteDenied"
/** OpenCode 2 的写文件工具(权限动作 `edit`);它们在引擎进程里写盘,被围栏拒时是一次带 EPERM 原因的工具错误。 */
const FILE_WRITE_TOOLS = new Set(["write", "edit", "patch"])

/** seatbelt 拒写 = EPERM(workspace-write-probe.ts 同一判据;EACCES 是文件系统权限位,不归给沙箱)。沿原因链找。 */
function deniedBySandbox(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 6) return false
  const record = error as { code?: unknown; message?: unknown; cause?: unknown; error?: unknown }
  if (record.code === "EPERM") return true
  if (typeof record.message === "string" && /\bEPERM\b/.test(record.message)) return true
  return deniedBySandbox(record.cause, depth + 1) || deniedBySandbox(record.error, depth + 1)
}

/**
 * `execute.after` body(0.2.4 验收第三轮;REQ-159 披露 I4):写被沙箱拒时不留沉默的死路 —— 模型读到的结果后面接一句
 * `WRITE_DENIED_NOTE`(重启之前写不进、停下来告诉用户),metadata 带 `codepuppyWriteDenied`,时间线那张卡据此摆出既有的
 * 只读说明与「重新启动」。两条写路径:写文件工具失败(原因链里有 EPERM;`directory` = 被写文件所在目录)与 shell 输出里有
 * `Operation not permitted`(子进程的写,命令照常结束;写到哪个目录从命令里看不出,不填)。其余调用原样不动。
 */
export function attachWriteDenied(
  event:
    | { tool: string; input?: unknown; status: "completed"; result: { output?: unknown; content?: unknown; metadata?: Record<string, unknown> } & Record<string, unknown> }
    | { tool: string; input?: unknown; status: "error"; error: InstanceType<typeof ToolError> },
  directory: string,
) {
  if (event.status === "error") {
    if (!FILE_WRITE_TOOLS.has(event.tool) || event.error.metadata?.[WRITE_DENIED_KEY] !== undefined) return
    if (!deniedBySandbox(event.error.error ?? event.error)) return
    const target = (event.input as { path?: unknown } | undefined)?.path
    event.error = new ToolError({
      message: `${event.error.message}\n\n${WRITE_DENIED_NOTE}`,
      ...(event.error.error === undefined ? {} : { error: event.error.error }),
      metadata: { ...event.error.metadata, [WRITE_DENIED_KEY]: { directory: typeof target === "string" ? dirname(resolve(directory, target)) : directory } },
    })
    return
  }
  if (event.tool !== "shell" || event.result.metadata?.[WRITE_DENIED_KEY] !== undefined) return
  const output = (event.result.output as { output?: unknown } | undefined)?.output
  if (typeof output !== "string" || !/operation not permitted/i.test(output)) return
  const content = event.result.content
  const note = { type: "text", text: WRITE_DENIED_NOTE }
  event.result = {
    ...event.result,
    content: Array.isArray(content) ? [...content, note] : typeof content === "string" ? `${content}\n\n${WRITE_DENIED_NOTE}` : [{ type: "text", text: output }, note],
    metadata: { ...event.result.metadata, [WRITE_DENIED_KEY]: {} },
  }
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
  egressProxy: string | undefined = codepuppyBootstrap().network.egressProxy,
) {
  if (event.status !== "error" || event.error.metadata?.[NET_FAILURE_KEY] !== undefined) return
  const target = (event.input as { url?: unknown } | undefined)?.url
  const net = classifyNetFailure(event.error.error ?? event.error, engineNetFailurePath(typeof target === "string" ? target : undefined, env, egressProxy))
  if (!net) return
  event.error = new ToolError({
    message: event.error.message,
    ...(event.error.error === undefined ? {} : { error: event.error.error }),
    metadata: { ...event.error.metadata, [NET_FAILURE_KEY]: net },
  })
}

/**
 * `execute.after` body (I-05 contract B, design upgrade-fewer-takeovers §4): a successful directory read carries the
 * directory card's data in 0.1.26's shape and key names (`metadata.display`, read by the frozen card's `dirDisplayOf`),
 * built from the read tool's structured listing (`ListPage`); the model text and `output` are not touched. Any other call,
 * or a result that already has a `display`, is left as it is.
 */
export function attachDirectoryDisplay(event: {
  tool: string
  status: string
  input?: unknown
  result?: { output?: unknown; metadata?: Record<string, unknown> } & Record<string, unknown>
}) {
  if (event.tool !== "read" || event.status !== "completed" || !event.result) return
  const listing = event.result.output as { type?: unknown; entries?: unknown; truncated?: unknown } | undefined
  if (listing?.type !== "list-page" || !Array.isArray(listing.entries) || event.result.metadata?.display !== undefined) return
  const entries = listing.entries.map((entry) => (entry as { path?: unknown } | null)?.path)
  if (!entries.every((entry): entry is string => typeof entry === "string")) return
  const input = (event.input ?? {}) as { path?: unknown; offset?: unknown }
  const offset = typeof input.offset === "number" && Number.isInteger(input.offset) && input.offset > 0 ? input.offset : 1
  const truncated = listing.truncated === true
  const display = {
    type: "directory" as const,
    path: input.path,
    entries,
    offset,
    truncated,
    // 2.x does not say how many entries a truncated listing has; none is made up.
    ...(truncated ? {} : { totalEntries: offset - 1 + entries.length }),
  }
  event.result = { ...event.result, metadata: { ...event.result.metadata, display } }
}


/** Code Mode 外层成功也可能包含子调用拒绝,所以两种终态都附上同一份结构化原因。 */
export function attachUnattendedDenial(
  event: Parameters<typeof attachTerminal>[0],
  denial: UnattendedDenial | undefined,
) {
  if (!denial) return
  if (event.status === "completed") {
    event.result = { ...event.result, metadata: { ...event.result.metadata, [UNATTENDED_DENIAL_KEY]: denial } }
    return
  }
  event.error = new ToolError({
    message: event.error.message,
    ...(event.error.error === undefined ? {} : { error: event.error.error }),
    metadata: { ...event.error.metadata, [UNATTENDED_DENIAL_KEY]: denial },
  })
}
