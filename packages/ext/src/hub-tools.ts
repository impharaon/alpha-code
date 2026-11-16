import { randomUUID } from "node:crypto"
import type { Plugin } from "@opencode/plugin"
import type { Info as ToolInfo, ToolContext } from "@opencode/plugin/promise/tool"
import { AUTOMATION_PROFILES } from "../../schema/src/codepuppy-unattended"
import type { HubRequestRecord, HubView, HubViewRow } from "../../ui-mac/src/main/codepuppy-sidecar-messages"
import { TOOL_TEXT } from "./context-injection"
import type { BridgeFailure, HubBridge } from "./hub-bridge"

export const HUB_INSTALL_ACTION = "codepuppy_hub_install"
export function denyHubInstallForAutomation(agent: string) {
  if (Object.hasOwn(AUTOMATION_PROFILES, agent)) throw Error("Permission denied: " + HUB_INSTALL_ACTION)
}
export const HUB_INSTALL_OUTCOME = {
  available: "installed; available",
  submitted: "submitted; result pending",
  unknownEntry: "unknown entry",
} as const
export const HUB_PRICE_NOTE_MISSING = "本目录尚未提供价格说明;费用以服务端为准"
export const HUB_UNAVAILABLE = "The Customization Center is not available in this engine host."

type HubToolContext = Pick<Plugin.Context, "location">
const idInput = (description: string) => ({
  type: "object",
  properties: { id: { type: "string", description } },
  required: ["id"],
  additionalProperties: false,
})

export function createHubTools(bridge: HubBridge, context: HubToolContext): ToolInfo[] {
  const directory = context.location.directory
  const viewOf = (ctx: ToolContext) => bridge.view({ directory, sessionID: ctx.sessionID, agent: ctx.agent })
  return [
    {
      name: "codepuppy_hub_search",
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
        return result(JSON.stringify(answer.result), { searchId: answer.result.searchId })
      },
    },
    {
      name: HUB_INSTALL_ACTION,
      description: TOOL_TEXT.codepuppy_hub_install.description,
      input: {
        ...idInput(TOOL_TEXT.codepuppy_hub_install.args.id),
        properties: {
          id: { type: "string", description: TOOL_TEXT.codepuppy_hub_install.args.id },
          scope: {
            type: "string",
            description: TOOL_TEXT.codepuppy_hub_install.args.scope,
            enum: ["all-projects", "this-project"],
          },
        },
      },
      options: { codemode: false },
      async execute(input: { id: string; scope?: "all-projects" | "this-project" }, ctx) {
        denyHubInstallForAutomation(ctx.agent)
        if (!bridge.available) return result(HUB_UNAVAILABLE, { ok: false })
        const requestId = randomUUID().replaceAll("-", "")
        const metadata = { requestId, stage: "submitted" }
        await ctx.progress({ metadata })
        const accepted = await bridge.install({
          requestId,
          directory,
          sessionID: ctx.sessionID,
          agent: ctx.agent,
          ref: { kind: "id", id: input.id },
          scope: input.scope ?? "all-projects",
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
          const state = outcome.alreadyInstalled
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
      },
    },
    {
      name: "codepuppy_hub_status",
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
