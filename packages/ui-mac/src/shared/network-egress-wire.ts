import { Schema } from "effect"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import type { PermMode } from "./permission-tier"

export type RuntimeTier = PermMode
export type SessionRef = { generation: number; sessionID: string; directory: string }
export type ToolRef = SessionRef & { messageID: string; callID: string }
export type Destination = { host: string; port: number }
export type SiteKey = { kind: "domain" | "host"; value: string }
export type RememberedSite = { site: SiteKey; at: string }
export type EgressSitesDocument = { v: 1; sites: RememberedSite[] }
export type EgressDecision = "allow-session" | "allow-persist" | "deny"
export type ApprovalState = "pending" | "connection-expired" | "resolved"
export type EgressApproval = {
  requestID: string
  destination: Destination
  site: SiteKey
  attribution: { kind: "unknown" }
  recipients: SessionRef[]
  createdAt: string
  connectionDeadlineAt: string
  state: ApprovalState
  decision?: EgressDecision
}
export type EgressDecisionReceipt = {
  requestID: string
  decision: EgressDecision
  remembered: boolean
  persistenceError?: "io"
}
export type EgressPassSummary = { destination: Destination; firstAt: string; lastAt: string; count: number }
export type EgressSettings =
  | { available: false }
  | { available: true; revision: number; sites: RememberedSite[]; passes: EgressPassSummary[]; persistence: "ok" | "unreadable" | "write-failed" }
export type EgressError = "unavailable" | "invalid-input" | "not-found" | "io"
export type Result<T> = { ok: true; value: T } | { ok: false; code: EgressError }
export type EgressChange = { revision: number; kind: "approvals" | "settings" }
export interface NetworkEgressApi {
  setTier(input: { session: SessionRef; tier: RuntimeTier }): Promise<Result<{ revision: number }>>
  listApprovals(input: { session: SessionRef }): Promise<Result<EgressApproval[]>>
  decide(input: { requestID: string; decision: EgressDecision }): Promise<Result<EgressDecisionReceipt>>
  settings(): Promise<Result<EgressSettings>>
  revoke(input: { site: SiteKey }): Promise<Result<{ revision: number }>>
  subscribe(listener: (event: EgressChange) => void): () => void
}
export type NetworkActivity =
  | { kind: "tool"; invocationID: string; ref: ToolRef; tool: string }
  | { kind: "shell"; session: SessionRef; shellID: string }
export type NetworkActivityCommand = { type: "codepuppy.network.activity"; id: number; seq: number; op: "enter" | "leave"; activity: NetworkActivity }
export type NetworkActivityReply = { type: "codepuppy.network.activity.reply"; id: number; seq: number; ok: boolean }
export type NetworkRuntimeAttached = { type: "codepuppy.network.attached"; generation: number }
export type NetworkActivitySnapshot = { type: "codepuppy.network.snapshot"; id: number; generation: number; seq: number; activities: NetworkActivity[] }
export type NetworkSnapshotRequest = { type: "codepuppy.network.snapshot.request"; generation: number }
export type EgressNotice = {
  type: "codepuppy.network.notice"
  requestID: string
  destination: Destination
  state: "waiting" | "denied" | "timed-out" | "unavailable" | "allowed"
  sessions: SessionRef[]
  activities: NetworkActivity[]
  attribution: "unknown"
}
export type NetworkInbound = NetworkActivityCommand | NetworkActivitySnapshot
export type NetworkOutbound = NetworkActivityReply | NetworkRuntimeAttached | NetworkSnapshotRequest | EgressNotice

export function hasEgressKeys(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === names.length && names.every((key) => Object.hasOwn(value, key))
}

export function isEgressSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

export function parseSessionRef(value: unknown): SessionRef | undefined {
  if (!hasEgressKeys(value, ["generation", "sessionID", "directory"])) return
  if (!isEgressSequence(value.generation) || !Schema.is(SessionID)(value.sessionID)) return
  if (typeof value.directory !== "string" || !(/^(?:\/|[a-z]:[\\/])/i.test(value.directory))) return
  return { generation: value.generation, sessionID: value.sessionID, directory: value.directory }
}

export function parseSiteKey(value: unknown): SiteKey | undefined {
  if (!hasEgressKeys(value, ["kind", "value"]) || (value.kind !== "domain" && value.kind !== "host")) return
  if (typeof value.value !== "string" || !value.value || /[\s*\/:]/.test(value.value) || value.value !== value.value.toLowerCase()) return
  return { kind: value.kind, value: value.value }
}

export function parseNetworkActivity(value: unknown): NetworkActivity | undefined {
  if (hasEgressKeys(value, ["kind", "session", "shellID"]) && value.kind === "shell") {
    const session = parseSessionRef(value.session)
    if (session && typeof value.shellID === "string" && value.shellID) return { kind: "shell", session, shellID: value.shellID }
  }
  if (!hasEgressKeys(value, ["kind", "invocationID", "ref", "tool"]) || value.kind !== "tool") return
  if (!hasEgressKeys(value.ref, ["generation", "sessionID", "directory", "messageID", "callID"])) return
  const ref = parseSessionRef({ generation: value.ref.generation, sessionID: value.ref.sessionID, directory: value.ref.directory })
  if (!ref || !Schema.is(SessionMessage.ID)(value.ref.messageID) || typeof value.ref.callID !== "string") return
  if (typeof value.invocationID !== "string" || !value.invocationID || typeof value.tool !== "string" || !value.tool) return
  return { kind: "tool", invocationID: value.invocationID, ref: { ...ref, messageID: value.ref.messageID, callID: value.ref.callID }, tool: value.tool }
}

export function parseNetworkInbound(value: unknown): NetworkInbound | undefined {
  if (hasEgressKeys(value, ["type", "id", "seq", "op", "activity"]) && value.type === "codepuppy.network.activity") {
    const activity = parseNetworkActivity(value.activity)
    if (activity && isEgressSequence(value.id) && isEgressSequence(value.seq) && (value.op === "enter" || value.op === "leave"))
      return { type: value.type, id: value.id, seq: value.seq, op: value.op, activity }
  }
  if (!hasEgressKeys(value, ["type", "id", "generation", "seq", "activities"]) || value.type !== "codepuppy.network.snapshot") return
  if (!isEgressSequence(value.id) || !isEgressSequence(value.generation) || !isEgressSequence(value.seq) || !Array.isArray(value.activities)) return
  const activities = value.activities.map(parseNetworkActivity)
  if (activities.some((item) => !item)) return
  return { type: value.type, id: value.id, generation: value.generation, seq: value.seq, activities: activities.filter((item) => item !== undefined) }
}

export function parseNetworkOutbound(value: unknown): NetworkOutbound | undefined {
  if (hasEgressKeys(value, ["type", "generation"]) && isEgressSequence(value.generation)
    && (value.type === "codepuppy.network.attached" || value.type === "codepuppy.network.snapshot.request"))
    return { type: value.type, generation: value.generation }
  if (hasEgressKeys(value, ["type", "id", "seq", "ok"]) && value.type === "codepuppy.network.activity.reply"
    && isEgressSequence(value.id) && isEgressSequence(value.seq) && typeof value.ok === "boolean")
    return { type: value.type, id: value.id, seq: value.seq, ok: value.ok }
  if (!hasEgressKeys(value, ["type", "requestID", "destination", "state", "sessions", "activities", "attribution"]) || value.type !== "codepuppy.network.notice") return
  if (typeof value.requestID !== "string" || value.attribution !== "unknown" || !Array.isArray(value.sessions) || !Array.isArray(value.activities)) return
  if (!hasEgressKeys(value.destination, ["host", "port"]) || typeof value.destination.host !== "string"
    || typeof value.destination.port !== "number" || !Number.isInteger(value.destination.port) || value.destination.port < 1 || value.destination.port > 65535) return
  if (value.state !== "waiting" && value.state !== "denied" && value.state !== "timed-out" && value.state !== "unavailable" && value.state !== "allowed") return
  const sessions = value.sessions.map(parseSessionRef)
  const activities = value.activities.map(parseNetworkActivity)
  if (sessions.some((item) => !item) || activities.some((item) => !item)) return
  return { type: value.type, requestID: value.requestID, destination: { host: value.destination.host, port: value.destination.port }, state: value.state,
    sessions: sessions.filter((item) => item !== undefined), activities: activities.filter((item) => item !== undefined), attribution: "unknown" }
}

export function isEgressDecision(value: unknown): value is EgressDecision {
  return value === "allow-session" || value === "allow-persist" || value === "deny"
}

export function activitySession(activity: NetworkActivity): SessionRef {
  return activity.kind === "tool" ? { generation: activity.ref.generation, sessionID: activity.ref.sessionID, directory: activity.ref.directory } : activity.session
}

export function sessionRefKey(session: SessionRef): string {
  return JSON.stringify([session.generation, session.directory, session.sessionID])
}

export function networkActivityKey(activity: NetworkActivity): string {
  return JSON.stringify([activitySession(activity).generation, activity.kind, activity.kind === "tool" ? activity.invocationID : activity.shellID])
}
