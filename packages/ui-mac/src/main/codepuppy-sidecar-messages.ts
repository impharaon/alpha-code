import { parseDirectoryAccessTargets, type DirectoryAccessTarget } from "../shared/directory-write-approval"
import { parseVideoBridgeRequest, type VideoBridgeRequest, type VideoBridgeReply } from "../shared/video-understanding"
import type { NetworkOutbound } from "../shared/network-egress-wire"
import type { PackageAuthorizationResultV1 } from "../shared/package-admission"
import { isInstallOutcomeV1, type InstallOutcomeV1, type CreatedPluginDraftV1 } from "../shared/plugin-install"
import type { SourceSearchResultV1, CandidateV1, SourceStatusV1 } from "./plugin-sources"
import type { ToolPolicyPartition, ToolPolicyRecord } from "../../../schema/src/codepuppy-tool-policy"
import type { PackageManagerExecutionLease, PreparedShellExecution } from "@opencode/plugin/codepuppy-package-manager"

export const PACKAGE_MANAGER_CANCEL_REASONS = ["cancelled", "timeout", "engine-disconnected", "app-quitting"] as const
export type PackageManagerCancelReason = typeof PACKAGE_MANAGER_CANCEL_REASONS[number]
export type PackageManagerControl =
  | { op: "authorize"; input: PreparedShellExecution }
  | { op: "bind"; executionID: string; pid: number }
  | { op: "finish"; executionID: string }
  | { op: "cancel"; executionID: string; reason: PackageManagerCancelReason }
export type PackageManagerControlRequest = { type: "codepuppy.package-manager.request"; id: number; request: PackageManagerControl }
export type PackageManagerControlReply = { type: "codepuppy.package-manager.reply"; id: number; result: { ok: true; lease?: PackageManagerExecutionLease } | { ok: false; error: "unavailable" } }
export type PackageManagerControlHandler = (request: PackageManagerControl) => Promise<PackageManagerControlReply["result"]>
import { documentRecord, isDocumentRuntimeState, isDocumentRuntimeVerifyRef, isDocumentRuntimeVerifyTask, isDocumentRuntimeVerifyReceipt, type DocumentRuntimeState, type DocumentRuntimeVerifyRef, type DocumentRuntimeVerifyTask, type DocumentRuntimeVerifyReceipt } from "../../../util/src/codepuppy-document"

export type DocumentRuntimeMessage =
  | { type: "codepuppy.document.runtime.verify"; task: DocumentRuntimeVerifyTask }
  | { type: "codepuppy.document.runtime.verify.cancel"; ref: DocumentRuntimeVerifyRef }
  | { type: "codepuppy.document.runtime.verify.receipt"; receipt: DocumentRuntimeVerifyReceipt }
  | { type: "codepuppy.document.runtime.changed"; sidecarGeneration: number; sequence: number; state: DocumentRuntimeState }

export function parseDocumentRuntimeMessage(value: unknown): DocumentRuntimeMessage | undefined {
  if (!documentRecord(value)) return
  if (value.type === "codepuppy.document.runtime.verify" && isDocumentRuntimeVerifyTask(value.task)) return { type: value.type, task: value.task }
  if (value.type === "codepuppy.document.runtime.verify.cancel" && isDocumentRuntimeVerifyRef(value.ref)) return { type: value.type, ref: value.ref }
  if (value.type === "codepuppy.document.runtime.verify.receipt" && isDocumentRuntimeVerifyReceipt(value.receipt)) return { type: value.type, receipt: value.receipt }
  if (value.type === "codepuppy.document.runtime.changed" && Number.isSafeInteger(value.sidecarGeneration) && Number(value.sidecarGeneration) >= 0 && Number.isSafeInteger(value.sequence) && Number(value.sequence) >= 0 && isDocumentRuntimeState(value.state)) return { type: value.type, sidecarGeneration: Number(value.sidecarGeneration), sequence: Number(value.sequence), state: value.state }
}

// Main ↔ sidecar contract: source lookup, ID-only installation, main-owned progress and reload messages.
// Shared by ext and ui-mac; no filesystem or Electron dependencies. Build/parse pairs reject malformed payloads.

// ── 状态词(§2.5)────────────────────────────────────────────────────────────────────────────

export const HUB_STATE_WORDS = ["not-installed", "installed", "reload-pending", "available"] as const
export type HubStateWord = (typeof HUB_STATE_WORDS)[number]

/**
 * 原因的机器码(`detail` 是给人看的技术细节,只进日志 / 次要文字):
 *   disabled       已装,账本 desiredState = disabled(装完即停用,不承诺可用)
 *   reload-waiting 有在途重载(排队、等会话空闲、或引擎状态查不到)
 *   reload-failed  最近一次重载报告失败
 *   not-loaded     没有在途重载,但本目录的即时核验没过
 *   cloud-connection / cloud-tools / cloud-policy 云核验未通过的具体步骤,不改变安装状态词
 */
export const HUB_REASON_CODES = [
  "disabled",
  "reload-waiting",
  "reload-failed",
  "not-loaded",
  "cloud-connection",
  "cloud-tools",
  "cloud-policy",
] as const
export type HubReasonCode = (typeof HUB_REASON_CODES)[number]
export type HubStateReason = { code: HubReasonCode; detail?: string }

export type HubViewRow = {
  /** catalog id 或 `user:<name>`。 */
  id: string
  /** 安装行 = 账本作用域;未安装的目录行 = null。行身份 = (id, scope)。 */
  scope: "global" | "project" | null
  name: string
  kind: string
  displayName: string
  description: string
  installed: boolean
  enabled: boolean
  state: HubStateWord
  stateReason?: HubStateReason
  /** `none` / `secret:<VAR,…>` / `platform-login`。只含变量名,从不含值。 */
  authorization: string
  /** 目录提供的云能力价格说明;缺席时不推测费用。 */
  priceNote?: string
  /** 只出现在 ext 侧的应答里,且只对技能行;不改 `state`(I4)。 */
  agentNote?: string
}

export type HubView = { directory: string; rows: HubViewRow[]; warnings: string[] }

/** agentNote 的两句固定文案(基线 §2.5 技能行原文)。 */
export const AGENT_NOTE_DENIED = "本会话的 agent 规则拒绝该技能,调用会被拒"
export const AGENT_NOTE_UNVERIFIED = "本会话权限未核验"

// ── 安装请求的阶段(§2.3,I9)──────────────────────────────────────────────────────────────────

export const HUB_REQUEST_STAGES = ["submitted", "committed", "failed"] as const
export type HubRequestStage = (typeof HUB_REQUEST_STAGES)[number]

/** The tool mints this request ID; main alone advances its installation record. */
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/
export function isHubRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID.test(value)
}

export type HubRequestRecord = {
  requestId: string
  stage: HubRequestStage
  displayName?: string
  packageId?: string
  outcome?: InstallOutcomeV1
}

// ── 重载(§2.6)────────────────────────────────────────────────────────────────────────────────

export type ReloadScope = "global" | { directory: string }
export type ReloadItem = { id: string; scope: "global" | "project" }
export const RELOAD_OUTCOMES = ["reloaded", "failed", "waiting"] as const
export type ReloadOutcome = (typeof RELOAD_OUTCOMES)[number]

// ── 消息 ──────────────────────────────────────────────────────────────────────────────────────

export type HubViewRequestMessage = {
  type: "codepuppy.hub.view.request"
  id: number
  directory: string
  sessionID?: string
  agent?: string
  query?: string
}
export type HubRequestQueryMessage = { type: "codepuppy.hub.request.request"; id: number; requestId: string }
export type ReloadReportMessage = {
  type: "codepuppy.reload.report"
  generation: number
  scope: ReloadScope
  outcome: ReloadOutcome
  directories: string[]
  /** failed:失败原因;waiting:在等什么(「2 session(s) busy」/「status of <dir> unknown」)。 */
  error?: string
}
export type ReloadRequestMessage = {
  type: "codepuppy.reload.request"
  generation: number
  scope: ReloadScope
  items: ReloadItem[]
  reason: string
  /** 用户显式「现在重载」:只跳过「等空闲」这一条,不跳过状态查不到(§2.6)。 */
  force?: true
}
export type HubViewReplyMessage =
  | { type: "codepuppy.hub.view.reply"; id: number; view: HubView }
  | { type: "codepuppy.hub.view.reply"; id: number; error: string }
export type HubRequestReplyMessage =
  | { type: "codepuppy.hub.request.reply"; id: number; record: HubRequestRecord | null }
  | { type: "codepuppy.hub.request.reply"; id: number; error: string }

export type SourcesSearchRequest = {
  type: "codepuppy.sources.search.request"
  id: number
  directory: string
  query: string
}
export type HubInstallRequest = {
  type: "codepuppy.hub.install.request"
  id: number
  requestId: string
  directory: string
  sessionID: string
  agent: string
  ref: { kind: "id"; id: string } | { kind: "created"; draft: CreatedPluginDraftV1 }
  scope: "all-projects" | "this-project"
}
export type SourcesSearchReply =
  | { type: "codepuppy.sources.search.reply"; id: number; result: SourceSearchResultV1 }
  | { type: "codepuppy.sources.search.reply"; id: number; error: string }
export type HubInstallReply =
  | { type: "codepuppy.hub.install.reply"; id: number; accepted: true }
  | { type: "codepuppy.hub.install.reply"; id: number; error: "invalid" | "unavailable" }

export type PackageAuthorizationQuery = { type: "codepuppy.package.authorization.request"; id: number; packageId: string }
export type PackageAuthorizationReply = { type: "codepuppy.package.authorization.reply"; id: number; result: PackageAuthorizationResultV1 }

export type PackageLocationReadyMessage = { type: "codepuppy.package.location.ready"; directory: string }
export function buildPackageLocationReady(directory: string): PackageLocationReadyMessage {
  return { type: "codepuppy.package.location.ready", directory }
}

export type CodePuppySidecarInbound =
  | PackageLocationReadyMessage
  | PackageManagerControlRequest
  | WriteScopeRequest
  | VideoBridgeRequest
  | HubViewRequestMessage
  | PackageAuthorizationQuery
  | HubRequestQueryMessage
  | ReloadReportMessage
  | UnattendedAck
  | SourcesSearchRequest
  | HubInstallRequest
export type CodePuppySidecarOutbound =
  | PackageManagerControlReply
  | WriteScopeReply
  | VideoBridgeReply
  | NetworkOutbound
  | ReloadRequestMessage
  | PackageAuthorizationReply
  | HubViewReplyMessage
  | HubRequestReplyMessage
  | UnattendedLive
  | SourcesSearchReply
  | HubInstallReply

const MAX_TEXT = 4_096

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}
function isText(value: unknown, max = MAX_TEXT): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
}
function isOptionalText(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length <= MAX_TEXT)
}

/** `codepuppy.*` 前缀:收方据此决定「是不是本族」;是本族但 parse 不过 = 丢弃 + 记一行。 */
export function isCodePuppySidecarMessage(value: unknown): boolean {
  return isRecord(value) && typeof value.type === "string" && value.type.startsWith("codepuppy.")
}

export function parseReloadScope(value: unknown): ReloadScope | undefined {
  if (value === "global") return "global"
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isText(value.directory)) return
  return { directory: value.directory }
}

function parseReloadItems(value: unknown): ReloadItem[] | undefined {
  if (!Array.isArray(value) || value.length > 256) return
  const items: ReloadItem[] = []
  for (const item of value) {
    if (!isRecord(item) || !isText(item.id, 256) || (item.scope !== "global" && item.scope !== "project")) return
    items.push({ id: item.id, scope: item.scope })
  }
  return items
}

/** main 侧:ext → main 的封闭消息族。别的一律 undefined(含 main → ext 的方向)。 */
export function parseCodePuppySidecarInbound(value: unknown): CodePuppySidecarInbound | undefined {
  const video=parseVideoBridgeRequest(value)
  if(video)return video
  if (!isRecord(value)) return
  if (value.type === "codepuppy.package.location.ready")
    return isText(value.directory) && Object.keys(value).every(key => ["type", "directory"].includes(key)) ? buildPackageLocationReady(value.directory) : undefined
  if (value.type === "codepuppy.package-manager.request") return parsePackageManagerControlRequest(value)
  if (value.type === "codepuppy.write-scope.request") return parseWriteScopeRequest(value)
  if (value.type === "codepuppy.package.authorization.request")
    return isId(value.id) && isText(value.packageId) && Object.keys(value).every(key => ["type", "id", "packageId"].includes(key))
      ? buildPackageAuthorizationQuery(value.id, value.packageId) : undefined
  if (value.type === "codepuppy.sources.search.request")
    return isId(value.id) && typeof value.directory === "string" && typeof value.query === "string"
      ? buildSourcesSearchRequest({ id: value.id, directory: value.directory, query: value.query })
      : undefined
  if (value.type === "codepuppy.hub.install.request") {
    if (
      !isId(value.id) ||
      !isHubRequestId(value.requestId) ||
      !isText(value.directory) ||
      !isText(value.sessionID) ||
      !isText(value.agent) ||
      (value.scope !== "all-projects" && value.scope !== "this-project") ||
      !isRecord(value.ref)
    )
      return
    const ref = value.ref
    if (
      ref.kind === "id" &&
      Object.keys(ref).every((key) => key === "kind" || key === "id") &&
      typeof ref.id === "string" &&
      ref.id
    )
      return buildHubInstallRequest({
        id: value.id,
        requestId: value.requestId,
        directory: value.directory,
        sessionID: value.sessionID,
        agent: value.agent,
        ref: { kind: "id", id: ref.id },
        scope: value.scope,
      })
    if (
      ref.kind === "created" &&
      Object.keys(ref).every((key) => key === "kind" || key === "draft") &&
      isRecord(ref.draft) &&
      typeof ref.draft.searchId === "string" &&
      typeof ref.draft.name === "string" &&
      typeof ref.draft.description === "string" &&
      Array.isArray(ref.draft.files) &&
      ref.draft.files.every(
        (file: unknown) =>
          isRecord(file) &&
          typeof file.path === "string" &&
          typeof file.text === "string" &&
          Object.keys(file).every((key) => key === "path" || key === "text"),
      )
    )
      return buildHubInstallRequest({
        id: value.id,
        requestId: value.requestId,
        directory: value.directory,
        sessionID: value.sessionID,
        agent: value.agent,
        ref: {
          kind: "created",
          draft: {
            searchId: ref.draft.searchId,
            name: ref.draft.name,
            description: ref.draft.description,
            files: ref.draft.files as CreatedPluginDraftV1["files"],
          },
        },
        scope: value.scope,
      })
    return
  }

  if (value.type === "codepuppy.unattended.ack") return parseUnattendedAck(value)
  if (value.type === "codepuppy.hub.view.request") {
    if (!isId(value.id) || !isText(value.directory)) return
    if (!isOptionalText(value.sessionID) || !isOptionalText(value.agent) || !isOptionalText(value.query)) return
    return {
      type: "codepuppy.hub.view.request",
      id: value.id,
      directory: value.directory,
      ...(typeof value.sessionID === "string" && value.sessionID ? { sessionID: value.sessionID } : {}),
      ...(typeof value.agent === "string" && value.agent ? { agent: value.agent } : {}),
      ...(typeof value.query === "string" ? { query: value.query } : {}),
    }
  }
  if (value.type === "codepuppy.hub.request.request") {
    if (!isId(value.id) || !isHubRequestId(value.requestId)) return
    return { type: "codepuppy.hub.request.request", id: value.id, requestId: value.requestId }
  }
  if (value.type === "codepuppy.reload.report") {
    const scope = parseReloadScope(value.scope)
    if (!isId(value.generation) || !scope) return
    if (typeof value.outcome !== "string" || !(RELOAD_OUTCOMES as readonly string[]).includes(value.outcome)) return
    if (!Array.isArray(value.directories) || !value.directories.every((d) => isText(d))) return
    if (!isOptionalText(value.error)) return
    return {
      type: "codepuppy.reload.report",
      generation: value.generation,
      scope,
      outcome: value.outcome as ReloadOutcome,
      directories: value.directories as string[],
      ...(typeof value.error === "string" && value.error ? { error: value.error } : {}),
    }
  }
  return
}

/** ext 侧:main → ext 的重载请求。 */
export function parseReloadRequest(value: unknown): ReloadRequestMessage | undefined {
  if (!isRecord(value) || value.type !== "codepuppy.reload.request") return
  const scope = parseReloadScope(value.scope)
  const items = parseReloadItems(value.items)
  if (!isId(value.generation) || !scope || !items || !isText(value.reason)) return
  if (value.force !== undefined && value.force !== true) return
  return {
    type: "codepuppy.reload.request",
    generation: value.generation,
    scope,
    items,
    reason: value.reason,
    ...(value.force === true ? { force: true as const } : {}),
  }
}

export function buildReloadRequest(input: {
  generation: number
  scope: ReloadScope
  items: ReloadItem[]
  reason: string
  force?: boolean
}): ReloadRequestMessage {
  return {
    type: "codepuppy.reload.request",
    generation: input.generation,
    scope: input.scope === "global" ? "global" : { directory: input.scope.directory },
    items: input.items.map((item) => ({ id: item.id, scope: item.scope })),
    reason: input.reason,
    ...(input.force ? { force: true as const } : {}),
  }
}

export function buildHubViewReply(id: number, result: { view: HubView } | { error: string }): HubViewReplyMessage {
  return "view" in result
    ? { type: "codepuppy.hub.view.reply", id, view: result.view }
    : { type: "codepuppy.hub.view.reply", id, error: result.error }
}

export function buildHubRequestReply(
  id: number,
  result: { record: HubRequestRecord | null } | { error: string },
): HubRequestReplyMessage {
  return "record" in result
    ? { type: "codepuppy.hub.request.reply", id, record: result.record }
    : { type: "codepuppy.hub.request.reply", id, error: result.error }
}

// ── ext 侧(`#1531`):建 ext → main 的三种、解析 main → ext 的两种应答 ──────────────────────────────
//
// 线形不变(仍是上面冻结的那几种);这里只补 ext 那一侧的 build/parse,与 main 侧 parseCodePuppySidecarInbound 同一纪律:
// 应答形状不对 ⇒ undefined,由 ext 当「无法判断」处理,不带着半个视图去回答 agent。

export function buildHubViewRequest(input: {
  id: number
  directory: string
  sessionID?: string
  agent?: string
  query?: string
}): HubViewRequestMessage {
  return {
    type: "codepuppy.hub.view.request",
    id: input.id,
    directory: input.directory,
    ...(input.sessionID ? { sessionID: input.sessionID } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.query !== undefined ? { query: input.query } : {}),
  }
}

export function buildHubRequestQuery(id: number, requestId: string): HubRequestQueryMessage {
  return { type: "codepuppy.hub.request.request", id, requestId }
}

export function buildReloadReport(input: {
  generation: number
  scope: ReloadScope
  outcome: ReloadOutcome
  directories: string[]
  error?: string
}): ReloadReportMessage {
  return {
    type: "codepuppy.reload.report",
    generation: input.generation,
    scope: input.scope === "global" ? "global" : { directory: input.scope.directory },
    outcome: input.outcome,
    directories: [...input.directories],
    ...(input.error ? { error: input.error } : {}),
  }
}

function parseStateReason(value: unknown): HubStateReason | undefined | null {
  if (value === undefined) return undefined
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    !(HUB_REASON_CODES as readonly string[]).includes(value.code)
  )
    return null
  if (value.detail !== undefined && typeof value.detail !== "string") return null
  return { code: value.code as HubReasonCode, ...(typeof value.detail === "string" ? { detail: value.detail } : {}) }
}

function parseHubViewRow(value: unknown): HubViewRow | undefined {
  if (!isRecord(value)) return
  const text = ["id", "name", "kind", "displayName", "description", "authorization"] as const
  if (!text.every((key) => typeof value[key] === "string")) return
  if (value.scope !== null && value.scope !== "global" && value.scope !== "project") return
  if (typeof value.installed !== "boolean" || typeof value.enabled !== "boolean") return
  if (typeof value.state !== "string" || !(HUB_STATE_WORDS as readonly string[]).includes(value.state)) return
  const reason = parseStateReason(value.stateReason)
  if (reason === null) return
  if (value.agentNote !== undefined && typeof value.agentNote !== "string") return
  if (value.priceNote !== undefined && typeof value.priceNote !== "string") return
  return {
    id: value.id as string,
    scope: value.scope,
    name: value.name as string,
    kind: value.kind as string,
    displayName: value.displayName as string,
    description: value.description as string,
    installed: value.installed,
    enabled: value.enabled,
    state: value.state as HubStateWord,
    ...(reason ? { stateReason: reason } : {}),
    authorization: value.authorization as string,
    ...(typeof value.priceNote === "string" ? { priceNote: value.priceNote } : {}),
    ...(typeof value.agentNote === "string" ? { agentNote: value.agentNote } : {}),
  }
}

/** ext 侧:main 对视图请求的应答。行里任何一条形状不对 ⇒ 整条应答作废(不呈现半个视图)。 */
export function parseHubViewReply(value: unknown): HubViewReplyMessage | undefined {
  if (!isRecord(value) || value.type !== "codepuppy.hub.view.reply" || !isId(value.id)) return
  if (typeof value.error === "string") return { type: "codepuppy.hub.view.reply", id: value.id, error: value.error }
  const view = value.view
  if (
    !isRecord(view) ||
    typeof view.directory !== "string" ||
    !Array.isArray(view.rows) ||
    !Array.isArray(view.warnings)
  )
    return
  if (!view.warnings.every((warning) => typeof warning === "string")) return
  const rows = view.rows.map(parseHubViewRow)
  if (rows.some((row) => row === undefined)) return
  return {
    type: "codepuppy.hub.view.reply",
    id: value.id,
    view: { directory: view.directory, rows: rows as HubViewRow[], warnings: view.warnings as string[] },
  }
}

/** ext 侧:main 对阶段查询的应答。`record: null` = main 没有这次请求的记录(合法应答,不是错误)。 */
export function parseHubRequestReply(value: unknown): HubRequestReplyMessage | undefined {
  if (!isRecord(value) || value.type !== "codepuppy.hub.request.reply" || !isId(value.id)) return
  if (typeof value.error === "string") return { type: "codepuppy.hub.request.reply", id: value.id, error: value.error }
  if (value.record === null) return { type: "codepuppy.hub.request.reply", id: value.id, record: null }
  const record = value.record
  if (
    !isRecord(record) ||
    !isHubRequestId(record.requestId) ||
    typeof record.stage !== "string" ||
    !(HUB_REQUEST_STAGES as readonly string[]).includes(record.stage)
  )
    return
  if (Object.keys(record).some((key) => !["requestId", "stage", "displayName", "packageId", "outcome"].includes(key)))
    return
  if (record.displayName !== undefined && typeof record.displayName !== "string") return
  if (record.packageId !== undefined && typeof record.packageId !== "string") return
  if (record.outcome !== undefined && !isInstallOutcomeV1(record.outcome)) return
  return { type: "codepuppy.hub.request.reply", id: value.id, record: record as HubRequestRecord }
}

/** #1699:完整名单只从 main 推给 ext,回程只承认这一版的随机回执。 */
export type UnattendedLive = {
  type: "codepuppy.unattended.live"
  seq: number
  nonce: string
  sessions: ReadonlyArray<{ sessionID: string; agent?: string; promptID: string }>
}
export type UnattendedAck = { type: "codepuppy.unattended.ack"; seq: number; nonce: string }

export function buildUnattendedLive(input: Omit<UnattendedLive, "type">): UnattendedLive {
  return {
    type: "codepuppy.unattended.live",
    seq: input.seq,
    nonce: input.nonce,
    sessions: input.sessions.map((entry) => ({
      sessionID: entry.sessionID,
      promptID: entry.promptID,
      ...(entry.agent === undefined ? {} : { agent: entry.agent }),
    })),
  }
}
export function parseUnattendedLive(value: unknown): UnattendedLive | undefined {
  if (!isRecord(value) || value.type !== "codepuppy.unattended.live" || !isId(value.seq) || !isText(value.nonce)) return
  if (!Array.isArray(value.sessions)) return
  const sessions: UnattendedLive["sessions"][number][] = []
  for (const entry of value.sessions) {
    if (!isRecord(entry) || !isText(entry.sessionID) || !isText(entry.promptID)) return
    if (entry.agent !== undefined && !isText(entry.agent)) return
    sessions.push({
      sessionID: entry.sessionID,
      promptID: entry.promptID,
      ...(typeof entry.agent === "string" ? { agent: entry.agent } : {}),
    })
  }
  return buildUnattendedLive({ seq: value.seq, nonce: value.nonce, sessions })
}
export function buildUnattendedAck(seq: number, nonce: string): UnattendedAck {
  return { type: "codepuppy.unattended.ack", seq, nonce }
}
export function parseUnattendedAck(value: unknown): UnattendedAck | undefined {
  if (!isRecord(value) || value.type !== "codepuppy.unattended.ack" || !isId(value.seq) || !isText(value.nonce)) return
  return buildUnattendedAck(value.seq, value.nonce)
}

export function buildSourcesSearchRequest(input: Omit<SourcesSearchRequest, "type">): SourcesSearchRequest {
  return { type: "codepuppy.sources.search.request", ...input }
}
export function buildHubInstallRequest(input: Omit<HubInstallRequest, "type">): HubInstallRequest {
  return { type: "codepuppy.hub.install.request", ...input }
}
export function buildSourcesSearchReply(
  id: number,
  result: { result: SourceSearchResultV1 } | { error: string },
): SourcesSearchReply {
  return { type: "codepuppy.sources.search.reply", id, ...result }
}
export function buildHubInstallReply(
  id: number,
  result: { accepted: true } | { error: "invalid" | "unavailable" },
): HubInstallReply {
  return { type: "codepuppy.hub.install.reply", id, ...result }
}
export function parseHubInstallReply(input: unknown): HubInstallReply | undefined {
  if (!isRecord(input) || input.type !== "codepuppy.hub.install.reply" || !isId(input.id)) return
  if (input.accepted === true && input.error === undefined) return buildHubInstallReply(input.id, { accepted: true })
  if (input.error === "invalid" || input.error === "unavailable")
    return buildHubInstallReply(input.id, { error: input.error })
}
export function parseSourcesSearchReply(input: unknown): SourcesSearchReply | undefined {
  if (!isRecord(input) || input.type !== "codepuppy.sources.search.reply" || !isId(input.id)) return
  if (typeof input.error === "string") return buildSourcesSearchReply(input.id, { error: input.error })
  const result = input.result
  const source = (value: unknown) =>
    ["catalog", "claude-marketplace", "codex-marketplace", "opencode-npm", "mcp-registry"].includes(String(value))
  if (
    !isRecord(result) ||
    typeof result.searchId !== "string" ||
    typeof result.query !== "string" ||
    !Array.isArray(result.sources) ||
    !Array.isArray(result.candidates)
  )
    return
  const keys = (input: Record<string, unknown>, allowed: string[]) =>
    Object.keys(input).every((key) => allowed.includes(key))
  if (!keys(result, ["searchId", "query", "sources", "candidates"])) return
  if (
    !result.sources.every(
      (item: unknown) =>
        isRecord(item) &&
        source(item.source) &&
        (item.status === "ok"
          ? keys(item, ["source", "status", "matched", "skipped"]) &&
            Number.isSafeInteger(item.matched) &&
            Number(item.matched) >= 0 &&
            Number.isSafeInteger(item.skipped) &&
            Number(item.skipped) >= 0
          : item.status === "failed" &&
            keys(item, ["source", "status", "reason", "detail"]) &&
            ["network", "http", "format"].includes(String(item.reason)) &&
            typeof item.detail === "string"),
    )
  )
    return
  if (
    !result.candidates.every((item: unknown) => {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        !source(item.source) ||
        typeof item.name !== "string" ||
        typeof item.displayName !== "string" ||
        typeof item.description !== "string" ||
        (item.kind !== "plugin" && item.kind !== "mcp") ||
        !isRecord(item.upstream) ||
        !keys(item, [
          "id",
          "source",
          "name",
          "displayName",
          "description",
          "kind",
          "sameAs",
          "installed",
          "publisher",
          "upstream",
        ])
      )
        return false
      if (item.sameAs !== undefined && typeof item.sameAs !== "string") return false
      if (
        item.installed !== undefined &&
        (!isRecord(item.installed) ||
          !keys(item.installed, ["packageId", "enabled"]) ||
          typeof item.installed.packageId !== "string" ||
          typeof item.installed.enabled !== "boolean")
      )
        return false
      if (
        item.publisher !== undefined &&
        (!isRecord(item.publisher) ||
          !(item.publisher.kind === "github"
            ? keys(item.publisher, ["kind", "account"]) && typeof item.publisher.account === "string"
            : item.publisher.kind === "domain" &&
              keys(item.publisher, ["kind", "domain"]) &&
              typeof item.publisher.domain === "string"))
      )
        return false
      return (
        keys(item.upstream, ["repository", "commit", "path", "serverName", "version", "npm"]) &&
        Object.values(item.upstream).every((value) => typeof value === "string")
      )
    })
  )
    return
  return buildSourcesSearchReply(input.id, {
    result: {
      searchId: result.searchId,
      query: result.query,
      sources: result.sources as SourceStatusV1[],
      candidates: result.candidates as CandidateV1[],
    },
  })
}

export function buildPackageAuthorizationQuery(id: number, packageId: string): PackageAuthorizationQuery {
  return { type: "codepuppy.package.authorization.request", id, packageId }
}

export function buildPackageAuthorizationReply(id: number, result: PackageAuthorizationResultV1): PackageAuthorizationReply {
  return { type: "codepuppy.package.authorization.reply", id, result: result.ok ? {
    ok: true, packageId: result.packageId, items: result.items.map(item => ({
      kind: item.kind, componentId: item.componentId, prerequisiteId: item.prerequisiteId, serviceName: item.serviceName, label: item.label,
      ...(item.kind === "mcp-version" ? { key: item.key, token: item.token, value: item.value, ...(item.suggestion ? { suggestion: item.suggestion } : {}) } : item.kind === "option" ? { key: item.key, type: item.type, description: item.description, required: item.required, sensitive: item.sensitive, configured: item.configured, ...(!item.sensitive && item.value !== undefined ? { value: item.value } : {}) } : item.kind === "secret" ? { saved: item.saved } : item.kind === "mcp-oauth" ? { authenticated: item.authenticated, status: item.status } : { ready: item.ready }),
    })) as Extract<PackageAuthorizationResultV1, { ok: true }>["items"],
  } : { ok: false, reason: result.reason } }
}

export function parsePackageAuthorizationReply(value: unknown): PackageAuthorizationReply | undefined {
  if (!isRecord(value) || value.type !== "codepuppy.package.authorization.reply" || !isId(value.id) || Object.keys(value).some(key => !["type", "id", "result"].includes(key))) return
  const result = value.result
  if (!isRecord(result)) return
  if (result.ok === false && typeof result.reason === "string" && Object.keys(result).every(key => ["ok", "reason"].includes(key)))
    return buildPackageAuthorizationReply(value.id, { ok: false, reason: result.reason })
  if (result.ok !== true || !isText(result.packageId) || !Array.isArray(result.items) || Object.keys(result).some(key => !["ok", "packageId", "items"].includes(key))) return
  for (const item of result.items) {
    if (!isRecord(item) || !["componentId", "prerequisiteId", "serviceName", "label"].every(key => typeof item[key] === "string")) return
    const fields = item.kind === "mcp-version" && typeof item.key === "string" && typeof item.token === "string" && typeof item.value === "string" && (item.suggestion === undefined || typeof item.suggestion === "string") ? ["key", "token", "value", "suggestion"]
      : item.kind === "option" && typeof item.key === "string" && ["string", "number", "boolean"].includes(String(item.type)) && typeof item.description === "string" && typeof item.required === "boolean" && typeof item.sensitive === "boolean" && typeof item.configured === "boolean" && (item.value === undefined || !item.sensitive && typeof item.value === item.type && (typeof item.value !== "number" || Number.isFinite(item.value))) ? ["key", "type", "description", "required", "sensitive", "configured", "value"]
      : item.kind === "secret" && typeof item.saved === "boolean" ? ["saved"]
      : item.kind === "mcp-oauth" && typeof item.authenticated === "boolean" && typeof item.status === "string" ? ["authenticated", "status"]
      : item.kind === "connection" && typeof item.ready === "boolean" ? ["ready"] : undefined
    if (!fields || Object.keys(item).some(key => !["kind", "componentId", "prerequisiteId", "serviceName", "label", ...fields].includes(key))) return
  }
  return buildPackageAuthorizationReply(value.id, result as Extract<PackageAuthorizationResultV1, { ok: true }>)
}

// ── 工具策略改写(SPEC-engine-config-fence BR-03,DESIGN-engine-config-fence §4.5、D7)─────────────────────────────────────
// 工具策略目录在受保护集里,围栏内的 ext 写不了它:设置页的改写由 ext 经本通道交给 main 写,main 写完再回复。读仍在 ext(每次判定现读)。
// 这一对消息由 server.ts 接收链上自己的那一环处理(main 跑的是 ext/policy/store.ts 的 receiveToolPolicyWrite),不进上面的 hub 入站族。
// 只查形状;记录本身由写者在落盘前按完整 schema 解码(savePolicyDocument)。

export type ToolPolicyWriteRequest =
  | { type: "codepuppy.tool-policy.write.request"; id: number; op: "save"; partition: ToolPolicyPartition; records: ToolPolicyRecord[] }
  | { type: "codepuppy.tool-policy.write.request"; id: number; op: "reset"; partition: ToolPolicyPartition }
export type ToolPolicyWriteReply =
  | { type: "codepuppy.tool-policy.write.reply"; id: number; ok: true; backup?: string }
  | { type: "codepuppy.tool-policy.write.reply"; id: number; error: string } // 不含文档内容

export function buildToolPolicyWriteRequest(
  input: { id: number; partition: ToolPolicyPartition } & ({ op: "save"; records: readonly ToolPolicyRecord[] } | { op: "reset" }),
): ToolPolicyWriteRequest {
  const partition = { account: input.partition.account, workspace: input.partition.workspace }
  return input.op === "save"
    ? { type: "codepuppy.tool-policy.write.request", id: input.id, op: "save", partition, records: [...input.records] }
    : { type: "codepuppy.tool-policy.write.request", id: input.id, op: "reset", partition }
}

/** main 侧:ext 的工具策略写请求。形状不对 ⇒ undefined(接收方回 error 并记一行)。 */
export function parseToolPolicyWriteRequest(value: unknown): ToolPolicyWriteRequest | undefined {
  if (!isRecord(value) || value.type !== "codepuppy.tool-policy.write.request" || !isId(value.id)) return
  const partition = value.partition
  if (!isRecord(partition) || Object.keys(partition).some((key) => key !== "account" && key !== "workspace")) return
  if (!isText(partition.account) || !isText(partition.workspace)) return
  const parsed = { account: partition.account, workspace: partition.workspace }
  if (value.op === "reset" && Object.keys(value).every((key) => ["type", "id", "op", "partition"].includes(key)))
    return { type: "codepuppy.tool-policy.write.request", id: value.id, op: "reset", partition: parsed }
  if (value.op !== "save" || Object.keys(value).some((key) => !["type", "id", "op", "partition", "records"].includes(key))) return
  if (!Array.isArray(value.records) || !value.records.every(isRecord)) return
  return { type: "codepuppy.tool-policy.write.request", id: value.id, op: "save", partition: parsed, records: value.records as ToolPolicyRecord[] }
}

export function buildToolPolicyWriteReply(id: number, result: { ok: true; backup?: string } | { error: string }): ToolPolicyWriteReply {
  return "error" in result
    ? { type: "codepuppy.tool-policy.write.reply", id, error: result.error }
    : { type: "codepuppy.tool-policy.write.reply", id, ok: true, ...(result.backup !== undefined ? { backup: result.backup } : {}) }
}

/** ext 侧:main 对工具策略写请求的应答。 */
export function parseToolPolicyWriteReply(value: unknown): ToolPolicyWriteReply | undefined {
  if (!isRecord(value) || value.type !== "codepuppy.tool-policy.write.reply" || !isId(value.id)) return
  if ("error" in value)
    return isText(value.error) && Object.keys(value).every((key) => ["type", "id", "error"].includes(key))
      ? { type: "codepuppy.tool-policy.write.reply", id: value.id, error: value.error }
      : undefined
  if (value.ok !== true || Object.keys(value).some((key) => !["type", "id", "ok", "backup"].includes(key))) return
  if (value.backup !== undefined && !isText(value.backup)) return
  return buildToolPolicyWriteReply(value.id, { ok: true, ...(typeof value.backup === "string" ? { backup: value.backup } : {}) })
}

/** DESIGN-local-plugin-install v3.1 S-03: trusted main actions, private parentPort only. */
export type PackageSessionMessage = { type: "codepuppy.plugin.session"; id: number; sessionId: string } & (
  | { action: "leave"; reason: "clear" | "resume" | "logout" | "prompt_input_exit" | "other" }
  | { action: "notification"; notification: { message: string; title?: string; notificationType: string; occurrenceId: string } }
)
export function parsePackageSessionMessage(value: unknown): PackageSessionMessage | undefined {
  if (!isRecord(value) || value.type !== "codepuppy.plugin.session" || !Number.isSafeInteger(value.id) || !isText(value.sessionId)) return
  if (value.action === "leave" && typeof value.reason === "string" && ["clear", "resume", "logout", "prompt_input_exit", "other"].includes(value.reason)) return value as PackageSessionMessage
  if (value.action !== "notification" || !isRecord(value.notification)) return
  const notification = value.notification
  if (typeof notification.message !== "string" || (notification.title !== undefined && typeof notification.title !== "string") || typeof notification.notificationType !== "string" || !isText(notification.occurrenceId)) return
  return value as PackageSessionMessage
}

export type WriteScopeRequest = { type: "codepuppy.write-scope.request"; id: number; access: "read" | "write"; targets: readonly DirectoryAccessTarget[] }
/** `fixed`: writable because the target matched the R7-verified R3 fixed global-install/user-config table; `writable`: any other source (/tmp, caches, run-approved folders). */
export type WriteScopeReply = { type: "codepuppy.write-scope.reply"; id: number; result: { revision: number; targets: readonly { absolute: string; outcome: "fixed" | "writable" | "needs-approval" | "protected" | "no-fence" }[] } | { error: "unavailable" } }

export function parseWriteScopeRequest(value: unknown): WriteScopeRequest | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 4 || value.type !== "codepuppy.write-scope.request" || !isId(value.id) || (value.access !== "read" && value.access !== "write")) return
  const targets = parseDirectoryAccessTargets(value.targets)
  return targets ? { type: value.type, id: value.id, access: value.access, targets } : undefined
}
export function buildWriteScopeRequest(id: number, input: Pick<WriteScopeRequest, "access" | "targets">): WriteScopeRequest {
  const request = parseWriteScopeRequest({ type: "codepuppy.write-scope.request", id, ...input })
  if (!request) throw new Error("invalid write scope query")
  return request
}
export function parseWriteScopeReply(value: unknown): WriteScopeReply | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 3 || value.type !== "codepuppy.write-scope.reply" || !isId(value.id) || !isRecord(value.result)) return
  const result = value.result
  if (Object.keys(result).length === 1 && result.error === "unavailable") return { type: value.type, id: value.id, result: { error: "unavailable" } }
  if (Object.keys(result).length !== 2 || !isId(result.revision) || !Array.isArray(result.targets)) return
  const targets = result.targets
  if (!targets.every((target) => isRecord(target) && Object.keys(target).length === 2 && parseDirectoryAccessTargets([{ absolute: target.absolute, directory: target.absolute }]) && ["fixed", "writable", "needs-approval", "protected", "no-fence"].includes(target.outcome as string))) return
  return { type: value.type, id: value.id, result: { revision: result.revision, targets } }
}
export function buildWriteScopeReply(id: number, result: WriteScopeReply["result"]): WriteScopeReply {
  const reply = parseWriteScopeReply({ type: "codepuppy.write-scope.reply", id, result })
  if (!reply) throw new Error("invalid write scope result")
  return reply
}

export function buildPackageManagerControlRequest(id: number, request: PackageManagerControl): PackageManagerControlRequest {
  return { type: "codepuppy.package-manager.request", id, request }
}
export function buildPackageManagerControlReply(id: number, result: PackageManagerControlReply["result"]): PackageManagerControlReply {
  return { type: "codepuppy.package-manager.reply", id, result }
}
export function parsePackageManagerControlRequest(value: unknown): PackageManagerControlRequest | undefined {
  if (!isRecord(value) || value.type !== "codepuppy.package-manager.request" || !isId(value.id) || !closedKeys(value, ["type", "id", "request"]) || !isRecord(value.request)) return
  const request = value.request
  if (request.op === "authorize") {
    const input = request.input
    const keys = ["shellID", "sessionID", "messageID", "callID", "command", "cwd", "shell"] as const
    if (!closedKeys(request, ["op", "input"]) || !isRecord(input) || !closedKeys(input, keys) || !keys.every((key) => typeof input[key] === "string") || !keys.filter((key) => key !== "command").every((key) => isText(input[key]))) return
    return buildPackageManagerControlRequest(value.id, { op: "authorize", input: input as PreparedShellExecution })
  }
  if (!isText(request.executionID)) return
  if (request.op === "bind" && closedKeys(request, ["op", "executionID", "pid"]) && Number.isSafeInteger(request.pid) && typeof request.pid === "number" && request.pid > 0) return buildPackageManagerControlRequest(value.id, { op: "bind", executionID: request.executionID, pid: request.pid })
  if (request.op === "finish" && closedKeys(request, ["op", "executionID"])) return buildPackageManagerControlRequest(value.id, { op: "finish", executionID: request.executionID })
  if (request.op === "cancel" && closedKeys(request, ["op", "executionID", "reason"]) && PACKAGE_MANAGER_CANCEL_REASONS.some((reason) => reason === request.reason)) return buildPackageManagerControlRequest(value.id, { op: "cancel", executionID: request.executionID, reason: request.reason as PackageManagerCancelReason })
}
export function parsePackageManagerControlReply(value: unknown): PackageManagerControlReply | undefined {
  if (!isRecord(value) || value.type !== "codepuppy.package-manager.reply" || !isId(value.id) || !closedKeys(value, ["type", "id", "result"]) || !isRecord(value.result)) return
  const result = value.result
  if (result.ok === false && result.error === "unavailable" && closedKeys(result, ["ok", "error"])) return buildPackageManagerControlReply(value.id, { ok: false, error: "unavailable" })
  if (result.ok !== true || !closedKeys(result, result.lease === undefined ? ["ok"] : ["ok", "lease"])) return
  if (result.lease === undefined) return buildPackageManagerControlReply(value.id, { ok: true })
  const lease = result.lease
  if (!isRecord(lease) || !closedKeys(lease, ["executionID", "nodes", "helperService", "executionSource", "shellPrivateInput"]) || !isText(lease.executionID) || typeof lease.executionSource !== "string" || typeof lease.helperService !== "string" || !Array.isArray(lease.nodes) || !lease.nodes.every((node) => isRecord(node) && closedKeys(node, ["nodeID"]) && isText(node.nodeID))) return
  const input = lease.shellPrivateInput
  if (!isRecord(input) || !closedKeys(input, ["fd", "data"]) || typeof input.fd !== "number" || !Number.isSafeInteger(input.fd) || input.fd < 3 || input.fd > 9 || !(input.data instanceof Uint8Array)) return
  return buildPackageManagerControlReply(value.id, { ok: true, lease: lease as PackageManagerExecutionLease })
}
function closedKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}
