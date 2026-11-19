import type { CreatedPluginDraftV1 } from "../../ui-mac/src/shared/plugin-install"
import { randomUUID } from "node:crypto"
import type { Plugin } from "@opencode/plugin"
import type { Info as ToolInfo, ToolContext } from "@opencode/plugin/promise/tool"
import { AUTOMATION_PROFILES } from "../../schema/src/codepuppy-unattended"
import type { HubInstallRequest, HubRequestRecord, HubView, HubViewRow } from "../../ui-mac/src/main/codepuppy-sidecar-messages"
import { TOOL_TEXT } from "./context-injection"
import type { BridgeFailure, HubBridge, HubInstallSubject } from "./hub-bridge"

export const HUB_INSTALL_ACTION = "codepuppy_hub_install"
export const HUB_CREATE_ACTION = "codepuppy_hub_create"
export const HUB_SEARCH_ACTION = "codepuppy_hub_search"
export const HUB_STATUS_ACTION = "codepuppy_hub_status"
/**
 * BR-01 / BR-10(SPEC-plugin-helper-and-hub v5):助手的只读工具 —— 查找只发目录 / 市场 / 注册表查询,状态只读 main 的定制中心视图,
 * 都不写盘、不安装、不发别的东西。交互档位里它们不问(档位规则见 codepuppy-config-injection.ts 的请求审批档与只读档);
 * 唯一的一张卡是安装(hubInstallAsk)。
 */
export const HUB_READ_ACTIONS = [HUB_SEARCH_ACTION, HUB_STATUS_ACTION] as const
export function denyHubMutationForAutomation(agent: string, action: string) {
  if (action !== HUB_INSTALL_ACTION && action !== HUB_CREATE_ACTION) return
  if (Object.hasOwn(AUTOMATION_PROFILES, agent)) throw Error("Permission denied: " + action)
}
/**
 * BR-10(DESIGN-plugin-helper-and-hub v7 §4.6「安装前确认一次」):助手发起的安装在每个交互档位都问一次,经执行闸的普通审批卡。
 * 别的工具 ⇒ undefined(照常判定)。安装工具 ⇒ 钉成每次询问;核验过的随包工具还带上卡上要写的名称与真实来源 —— 本进程没从
 * main 的搜索里拿到过的编号无从写名,拒绝并请模型先搜索(搜过之后就认得)。
 */
export function hubInstallAsk(call: { tool: string; input: unknown }, verified: boolean, known: HubBridge["installSubject"]): { subject?: HubInstallSubject } | undefined {
  if (call.tool !== HUB_INSTALL_ACTION && call.tool !== HUB_CREATE_ACTION) return
  if (!verified) return {}
  const input = call.input as { id?: unknown; name?: unknown } | undefined
  const subject = call.tool === HUB_CREATE_ACTION
    ? typeof input?.name === "string" && input.name.trim() ? { name: input.name, source: "created" as const } : undefined
    : typeof input?.id === "string" ? known(input.id) : undefined
  if (subject) return { subject }
  throw Error(call.tool === HUB_CREATE_ACTION
    ? "not installed: invalid-draft; the plugin needs a name"
    : `not installed: ${HUB_INSTALL_OUTCOME.unknownEntry}; install an id returned by codepuppy_hub_search, searching again first`)
}
export const HUB_INSTALL_OUTCOME = {
  available: "installed; available",
  submitted: "submitted; result pending",
  unknownEntry: "unknown entry",
} as const
export const HUB_PRICE_NOTE_MISSING = "本目录尚未提供价格说明;费用以服务端为准"
export const HUB_UNAVAILABLE = "The Customization Center is not available in this engine host."

const HUB_SEARCH_CANDIDATES_PER_SOURCE = 25

type HubToolContext = Pick<Plugin.Context, "location">
const idInput = (description: string) => ({
  type: "object",
  properties: { id: { type: "string", description } },
  required: ["id"],
  additionalProperties: false,
})

export function createHubTools(bridge: HubBridge, context: HubToolContext, askInstall: (call: { sessionID: string; messageID: string; id: string }) => Promise<void>): ToolInfo[] {
  const directory = context.location.directory
  const viewOf = (ctx: ToolContext) => bridge.view({ directory, sessionID: ctx.sessionID, agent: ctx.agent })
  const submit = async (ref: HubInstallRequest["ref"], scope: HubInstallRequest["scope"], ctx: ToolContext, action: string) => {
    denyHubMutationForAutomation(ctx.agent, action)
    if (!bridge.available) return result(HUB_UNAVAILABLE, { ok: false })
    // BR-10:先把要装的名称与真实来源记在本次调用上(时间线卡在等待审批与拒绝之后都读它),再问一次;拒绝原样抛出、不交给 main。
    const subject = ref.kind === "created" ? (ref.draft.name.trim() ? { name: ref.draft.name, source: "created" as const } : undefined) : bridge.installSubject(ref.id)
    const named = subject ? { install: subject } : {}
    // 进度更新原样成为工具状态的 metadata(core session/runner/publish-llm-event.ts progress),所以是扁平的键,时间线直接读。
    await ctx.progress({ ...named, stage: "awaiting-approval" })
    await askInstall({ sessionID: ctx.sessionID, messageID: ctx.messageID, id: ctx.id })
    const requestId = randomUUID().replaceAll("-", "")
    const metadata = { ...named, requestId, stage: "submitted" }
    await ctx.progress(metadata)
    const accepted = await bridge.install({
      requestId,
      directory,
      sessionID: ctx.sessionID,
      agent: ctx.agent,
      ref,
      scope,
    })
    if (!accepted.ok)
      return result(
        accepted.reason === "timeout" ? HUB_INSTALL_OUTCOME.submitted : "not installed: " + accepted.detail,
        metadata,
      )
    while (!ctx.signal.aborted) {
      const answer = await bridge.request(requestId)
      if (!answer.ok || !answer.record) return result(HUB_INSTALL_OUTCOME.submitted, metadata)
      const record = answer.record
      if (record.stage === "submitted") {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, 100)
          function done() {
            clearTimeout(timer)
            ctx.signal.removeEventListener("abort", done)
            resolve()
          }
          ctx.signal.addEventListener("abort", done, { once: true })
        })
        continue
      }
      const outcome = record.outcome
      const identity = {
        ...metadata,
        stage: record.stage,
        ...(record.packageId ? { packageId: record.packageId } : {}),
      }
      if (!outcome) return result(HUB_INSTALL_OUTCOME.submitted, identity)
      if (!outcome.ok) return result("not installed: " + outcome.code, identity)
      const after = await viewOf(ctx)
      const rows = after.ok
        ? after.view.rows.filter(
            (row) =>
              row.id === outcome.packageId ||
              outcome.installed.some((entry) => row.name === entry.hostName && row.kind === entry.kind),
          )
        : []
      const authorization = await bridge.packageAuthorization(outcome.packageId)
      const items = authorization.ok ? authorization.items : []
      const login = items.find(item => item.kind === "mcp-oauth" && !item.authenticated && item.status === "needs_auth")
      const token = items.find(item => item.kind === "secret" && !item.saved)
      const state = login ? "installed; needs login: " + login.serviceName
        : token ? "installed; needs token: " + token.serviceName
        : outcome.alreadyInstalled
        ? "already installed"
        : outcome.notRunning.length
          ? "installed; partly running: " +
            outcome.notRunning.map((item) => item.sourceName + ": " + item.reason).join(", ")
          : rows.length && rows.every((row) => row.state === "available")
            ? HUB_INSTALL_OUTCOME.available
            : "installed; loading pending: " +
              (rows.find((row) => row.state !== "available")?.stateReason?.detail ??
                "engine state is not available")
      return result(state, identity)
    }
    return result(HUB_INSTALL_OUTCOME.submitted, metadata)
  }
  const scopeInput = {
    type: "string", description: TOOL_TEXT.codepuppy_hub_install.args.scope,
    enum: ["all-projects", "this-project"],
  }
  return [
    {
      name: HUB_SEARCH_ACTION,
      description: TOOL_TEXT.codepuppy_hub_search.description,
      input: {
        type: "object",
        properties: { query: { type: "string", description: TOOL_TEXT.codepuppy_hub_search.args.query } },
        required: ["query"],
        additionalProperties: false,
      },
      options: { codemode: false },
      async execute(input: { query: string }) {
        if (!bridge.available) return result(HUB_UNAVAILABLE, { ok: false })
        const answer = await bridge.search({ directory, query: input.query })
        if (!answer.ok) return result(unreachable(answer), { ok: false })
        const counts = new Map<string, number>()
        const candidates = answer.result.candidates.filter(candidate => {
          const count = counts.get(candidate.source) ?? 0
          counts.set(candidate.source, count + 1)
          return count < HUB_SEARCH_CANDIDATES_PER_SOURCE
        })
        return result(JSON.stringify({ ...answer.result, candidates }), { searchId: answer.result.searchId })
      },
    },
    {
      name: HUB_INSTALL_ACTION,
      description: TOOL_TEXT.codepuppy_hub_install.description,
      input: {
        ...idInput(TOOL_TEXT.codepuppy_hub_install.args.id),
        properties: {
          id: { type: "string", description: TOOL_TEXT.codepuppy_hub_install.args.id },
          scope: scopeInput,
        },
      },
      options: { codemode: false },
      async execute(input: { id: string; scope?: "all-projects" | "this-project" }, ctx) {
        return submit({ kind: "id", id: input.id }, input.scope ?? "all-projects", ctx, HUB_INSTALL_ACTION)
      },
    },
    {
      name: HUB_CREATE_ACTION,
      description: TOOL_TEXT.codepuppy_hub_create.description,
      input: {
        type: "object", additionalProperties: false,
        properties: {
          searchId: { type: "string", description: TOOL_TEXT.codepuppy_hub_create.args.searchId },
          name: { type: "string", description: TOOL_TEXT.codepuppy_hub_create.args.name },
          description: { type: "string", description: TOOL_TEXT.codepuppy_hub_create.args.description },
          files: { type: "array", description: TOOL_TEXT.codepuppy_hub_create.args.files, items: {
            type: "object", properties: { path: { type: "string" }, text: { type: "string" } }, required: ["path", "text"], additionalProperties: false,
          } },
          scope: scopeInput,
        },
        required: ["searchId", "name", "description", "files"],
      },
      options: { codemode: false },
      async execute(input: CreatedPluginDraftV1 & { scope?: HubInstallRequest["scope"] }, ctx) {
        return submit({ kind: "created", draft: { searchId: input.searchId, name: input.name, description: input.description, files: input.files } }, input.scope ?? "all-projects", ctx, HUB_CREATE_ACTION)
      },
    },
    {
      name: HUB_STATUS_ACTION,
      description: TOOL_TEXT.codepuppy_hub_status.description,
      input: idInput(TOOL_TEXT.codepuppy_hub_status.args.id),
      options: { codemode: false },
      async execute(input: { id: string }, ctx) {
        if (!bridge.available) return result(HUB_UNAVAILABLE, { ok: false })
        const answer = await viewOf(ctx)
        if (!answer.ok) return result(unreachable(answer), { ok: false, id: input.id })
        const rows = answer.view.rows.filter((row) => row.id === input.id)
        return result(rows.length ? renderRows(answer.view, rows) : HUB_INSTALL_OUTCOME.unknownEntry, {
          ok: true,
          id: input.id,
        })
      },
    },
  ]
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
