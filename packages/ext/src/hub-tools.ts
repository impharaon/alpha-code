// hub-tools — REQ-234 `#1531`(基线 §2.1 / §2.3 / §2.4,不变量 I2 / I3 / I7 / I8 / I9):agent 的三个定制中心工具。
// `#1665`(OpenCode 2,接口 I10):安装确认经 2.x 插件 Context 的 `permission.assert` 运输,弹框由 `permission.hook.evaluate` 钉死。
//
// agent 只发请求、只读结论:状态与目录都由 main 即时计算(经 hub-bridge 的 parentPort 窄消息),安装只经引擎自己的审批请求
// 运输到 renderer —— 那边弹定制中心**自己的**安装确认框,用户在框里点同意、在框里填密钥,安装由框发起。
// 本模块不安装任何东西,也够不着任何写通道。
//
//   codepuppy_hub_search(query)    —— 本目录视图(可安装目录 ∪ 已安装),按 query 过滤
//   codepuppy_hub_install(catalogId)—— permission.assert 运输确认请求;放行后按 requestId 向 main 查这一次请求走到哪一步
//   codepuppy_hub_status(catalogId) —— 单条的档与原因
//
// I2:三个工具的参数只有字符串标识(`query` / `catalogId`),没有任何密钥形状的字段;返回值只含视图字段(变量名、状态、原因)。
// I3 / I10:确认框一定会出现 —— 2.x 没有整份配置的钩子,改由 `hubInstallEvaluate` 挂在 `permission.hook.evaluate` 上:
//     `codepuppy_hub_install` 一律 ask(无人值守的 `codepuppy-automation*` 一律 deny)。它注册在 L4 的 `registerPolicy` 之后,
//     按注册顺序说了算;用户 / 项目配置里写 `codepuppy_hub_install: allow` 也压不过它。即便被绕过,安装也只由确认框发起
//     ⇒ 查不到记录 ⇒ 如实说没装。
// I7:`save: []` —— 用户点「始终允许」也不会产生能抵消下一次 codepuppy_hub_install 的 grant。
// I9 / I10:用户拒绝时 `assert` 以结束当前 step 的错误 reject,这里**原样抛出**(不当工具输出返回);放行后结局以 main
//     记录的 requestId 阶段为准 —— 用户已确认、主进程还在提交时期限到了,工具说的是「已提交,结果待定」。

import { randomUUID } from "node:crypto"
import type { Plugin } from "@opencode/plugin"
import type { PermissionEvaluation } from "@opencode/plugin/promise/permission"
import type { Info as ToolInfo, ToolContext } from "@opencode/plugin/promise/tool"
import type { HubRequestRecord, HubView, HubViewRow } from "../../ui-mac/src/main/codepuppy-sidecar-messages"
import { TOOL_TEXT } from "./context-injection"
import type { BridgeFailure, HubBridge } from "./hub-bridge"

/** codepuppy_hub_install 的固定结论(逐字;基线 §2.1)。 */
export const HUB_INSTALL_OUTCOME = {
  declined: "declined",
  reloadPending: "installed; reload pending",
  available: "installed; available",
  disabledByPolicy: "installed; disabled by policy",
  submitted: "submitted; result pending",
  noBox: "not installed: no confirmation box ran",
  unknownEntry: "unknown entry",
} as const

/** 每次 codepuppy_hub_install 结论之后的固定提示(约束 5:只对「可用」之后的下一条消息承诺)。 */
export const HUB_NEXT_MESSAGE_HINT =
  "Once it shows available, it can be used from the next message; it does not take effect within this reply."
/** 云条目在场而目录没有价格说明字段时的固定一句(如实报告缺项;不算 AC1 的价格部分已满足,见基线 §4 C5)。 */
export const HUB_PRICE_NOTE_MISSING = "本目录尚未提供价格说明;费用以服务端为准"
export const HUB_UNAVAILABLE = "The Customization Center is not available in this engine host."

const AGENT_AUTOMATION_PREFIX = "codepuppy-automation"

/** I10 的权限动作名(审批请求的 `action`;renderer 的 hub-install-watcher 按它与 metadata.codepuppyHub 分流)。 */
export const HUB_INSTALL_ACTION = "codepuppy_hub_install"

/**
 * `permission.hook.evaluate`:`codepuppy_hub_install` 恒 ask —— 默认规则是 `*: allow`,不钉就不弹框;
 * 无人值守的自动化 agent(`codepuppy-automation*`,「零 ask」硬前提)恒 deny —— 没有人会看到那个框。
 */
export function hubInstallEvaluate(event: PermissionEvaluation): void {
  if (event.action !== HUB_INSTALL_ACTION) return
  event.effect = event.agent?.startsWith(AGENT_AUTOMATION_PREFIX) ? "deny" : "ask"
}

type HubToolContext = Pick<Plugin.Context, "location" | "permission">

const catalogInput = (description: string) => ({
  type: "object",
  properties: { catalogId: { type: "string", description } },
  required: ["catalogId"],
  additionalProperties: false,
})

/** 三个工具,形状是 2.x 的 promise 工具(`tool.transform` 的 `editor.add`);目录取本 Location(2.x 的工具上下文没有 directory)。 */
export function createHubTools(bridge: HubBridge, context: HubToolContext): ToolInfo[] {
  const directory = context.location.directory
  const viewOf = (ctx: ToolContext, query?: string) =>
    bridge.view({ directory, sessionID: ctx.sessionID, agent: ctx.agent, ...(query !== undefined ? { query } : {}) })
  return [
    {
      name: "codepuppy_hub_search",
      description: TOOL_TEXT.codepuppy_hub_search.description,
      input: {
        type: "object",
        properties: { query: { type: "string", description: TOOL_TEXT.codepuppy_hub_search.args.query } },
        additionalProperties: false,
      },
      options: { codemode: false },
      async execute(input: { query?: string }, ctx) {
        if (!bridge.available) return result(HUB_UNAVAILABLE, { ok: false })
        const answer = await viewOf(ctx, input.query ?? "")
        if (!answer.ok) return result(unreachable(answer), { ok: false })
        return result(renderRows(answer.view, answer.view.rows), { ok: true, count: answer.view.rows.length })
      },
    },
    {
      name: "codepuppy_hub_install",
      description: TOOL_TEXT.codepuppy_hub_install.description,
      input: catalogInput(TOOL_TEXT.codepuppy_hub_install.args.catalogId),
      options: { codemode: false },
      async execute(input: { catalogId: string }, ctx) {
        if (!bridge.available) return result(HUB_UNAVAILABLE, { ok: false })
        const catalogId = input.catalogId.trim()
        const before = await viewOf(ctx)
        if (!before.ok) return result(`not installed: ${unreachable(before)}`, { ok: false, catalogId })
        if (!before.view.rows.some((row) => row.id === catalogId))
          return result(`${HUB_INSTALL_OUTCOME.unknownEntry}\nUse codepuppy_hub_search to find the exact id.`, { ok: false, catalogId })
        const requestId = randomUUID().replaceAll("-", "")
        // I10:拒绝(或 deny 规则)时 assert reject —— 原样抛出,结束当前 step;放行才去 main 查结局。
        await context.permission.assert({
          sessionID: ctx.sessionID,
          agent: ctx.agent,
          action: HUB_INSTALL_ACTION,
          resources: [catalogId],
          save: [],
          metadata: { codepuppyHub: { catalogId, requestId } },
        })
        const stage = await bridge.request(requestId)
        if (!stage.ok) return result(`result unknown: ${unreachable(stage)} — check with codepuppy_hub_status`, { ok: false, catalogId, requestId })
        const outcome = await settle(stage.record, catalogId, ctx)
        return result(`${outcome}\n${HUB_NEXT_MESSAGE_HINT}`, { ok: true, catalogId, requestId, stage: stage.record?.stage ?? null })
      },
    },
    {
      name: "codepuppy_hub_status",
      description: TOOL_TEXT.codepuppy_hub_status.description,
      input: catalogInput(TOOL_TEXT.codepuppy_hub_status.args.catalogId),
      options: { codemode: false },
      async execute(input: { catalogId: string }, ctx) {
        if (!bridge.available) return result(HUB_UNAVAILABLE, { ok: false })
        const catalogId = input.catalogId.trim()
        const answer = await viewOf(ctx)
        if (!answer.ok) return result(unreachable(answer), { ok: false, catalogId })
        const rows = answer.view.rows.filter((row) => row.id === catalogId)
        if (rows.length === 0) return result(`${HUB_INSTALL_OUTCOME.unknownEntry}\nUse codepuppy_hub_search to find the exact id.`, { ok: false, catalogId })
        return result(renderRows(answer.view, rows), { ok: true, catalogId })
      },
    },
  ]

  /** §2.3 末段:main 记的阶段 → 固定结论。committed 之后再读一次视图取该行(id, scope)此刻的档。 */
  async function settle(record: HubRequestRecord | null, catalogId: string, ctx: ToolContext): Promise<string> {
    if (!record) return HUB_INSTALL_OUTCOME.noBox
    if (record.stage === "declined") return HUB_INSTALL_OUTCOME.declined
    if (record.stage === "failed") return `${HUB_INSTALL_OUTCOME.declined}: install failed — ${record.reason ?? "no reason given"}`
    if (record.stage === "confirming") return `${HUB_INSTALL_OUTCOME.declined}: the confirmation was not answered before the request ended`
    if (record.stage === "submitted") return HUB_INSTALL_OUTCOME.submitted
    const after = await viewOf(ctx)
    const row = after.ok ? after.view.rows.find((item) => item.id === catalogId && item.scope === (record.scope ?? "global")) : undefined
    if (!row) return `installed; state unknown — check with codepuppy_hub_status`
    if (row.state === "available") return HUB_INSTALL_OUTCOME.available
    if (row.state === "reload-pending") return `${HUB_INSTALL_OUTCOME.reloadPending} (${reasonText(row)})`
    if (row.stateReason?.code === "disabled") return HUB_INSTALL_OUTCOME.disabledByPolicy
    return `installed; not available in this directory yet (${reasonText(row)})`
  }
}

function result(content: string, metadata: Record<string, unknown>) {
  return { content, metadata }
}

function unreachable(failure: BridgeFailure): string {
  return `the Customization Center could not answer (${failure.detail})`
}

/** 给人 / agent 读的原因短句(§2.1 codepuppy_hub_status 行)。 */
function reasonText(row: HubViewRow): string {
  const detail = row.stateReason?.detail
  const code = row.stateReason?.code
  switch (code) {
    case undefined:
      return ""
    case "disabled":
      return "disabled by policy"
    case "reload-waiting":
      return `waiting: ${detail ?? "queued"}`
    case "reload-failed":
      return `last reload failed: ${detail ?? "unknown reason"}`
    case "not-loaded":
      return `not loaded in this directory: ${detail ?? "unknown reason"}`
    case "cloud-connection":
      return `cloud connection: ${detail ?? "unknown reason"}`
    case "cloud-tools":
      return `cloud tool list: ${detail ?? "unknown reason"}`
    case "cloud-policy":
      return `cloud tool policy: ${detail ?? "unknown reason"}`
  }
  const exhaustive: never = code
  return exhaustive
}

/** 一行一条 JSON(只含视图字段);云条目缺价格说明时末尾固定缺项句;main 的 warnings 不原样外发(可能带内部细节),只说视图可能不全。 */
function renderRows(view: HubView, rows: HubViewRow[]): string {
  if (rows.length === 0) return "No matching entries."
  const lines = rows.map((row) =>
    JSON.stringify({
      id: row.id,
      scope: row.scope ?? "not installed",
      name: row.displayName,
      type: row.kind,
      description: row.description,
      installed: row.installed,
      enabled: row.enabled,
      state: row.state,
      ...(row.stateReason ? { reason: reasonText(row) } : {}),
      authorization: row.authorization,
      ...(row.priceNote !== undefined ? { priceNote: row.priceNote } : {}),
      ...(row.agentNote ? { agentNote: row.agentNote } : {}),
    }),
  )
  if (view.warnings.length > 0) lines.push("Note: some installed items could not be read; this list may be incomplete.")
  if (rows.some((row) => row.kind === "cloud" && row.priceNote === undefined)) lines.push(HUB_PRICE_NOTE_MISSING)
  return lines.join("\n")
}
