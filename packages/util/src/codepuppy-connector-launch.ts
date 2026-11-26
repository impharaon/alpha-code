// #1760 frozen connector-launchers §4.6 / DOC-NODE-v2 data definitions.
// Shared authority only; launcher acquisition, classification and host publication remain #1760 integration.
import type { EnsurePinnedFileResult } from "./codepuppy-pinned-files.js"

export type LauncherPlatform = "darwin-arm64" | "win32-x64"
export type DownloadFailureEvidence =
  | { kind: "connect" | "timeout"; detail: string }
  | { kind: "http"; status: number; detail: string }
  | { kind: "resolution" | "integrity" | "disk" | "other"; detail: string }
export type PinnedFileDelivery = { result: EnsurePinnedFileResult; failure?: DownloadFailureEvidence }
export type ConnectorLaunchFailure =
  | { kind: "download"; detail: string }
  | { kind: "egress"; host: string; port: number }
  | { kind: "secret"; fields: string[]; packageId?: string }
  | { kind: "auth"; service: string }
  | { kind: "workspace"; reason: "missing" | "not-git" }
  | { kind: "dependency"; program: string }
  | { kind: "unknown"; detail: string }

export function isConnectorLaunchFailure(value: unknown): value is ConnectorLaunchFailure {
  if (!value || typeof value !== "object" || !("kind" in value)) return false
  if (value.kind === "download" || value.kind === "unknown") return "detail" in value && typeof value.detail === "string"
  if (value.kind === "egress") return "host" in value && typeof value.host === "string" && "port" in value && Number.isInteger(value.port) && Number(value.port) > 0 && Number(value.port) <= 65535
  if (value.kind === "secret") return "fields" in value && Array.isArray(value.fields) && value.fields.every((field) => typeof field === "string") && (!("packageId" in value) || typeof value.packageId === "string")
  if (value.kind === "auth") return "service" in value && typeof value.service === "string"
  if (value.kind === "workspace") return "reason" in value && (value.reason === "missing" || value.reason === "not-git")
  return value.kind === "dependency" && "program" in value && typeof value.program === "string"
}
