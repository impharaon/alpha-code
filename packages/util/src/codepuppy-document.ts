import type { Location } from "../../schema/src/location.js"
import type { ConnectorLaunchFailure } from "./codepuppy-connector-launch.js"
import { isConnectorLaunchFailure } from "./codepuppy-connector-launch.js"
import type { PinnedFileId } from "./codepuppy-pinned-files.js"

export type DocumentRuntimeState =
  | { phase: "preparing"; stage: "download" | "extract" | "verify"; received?: number; total?: number }
  | { phase: "ready"; version: string; executable: string }
  | { phase: "failed"; failure: ConnectorLaunchFailure }

export type DocumentRuntimeVerifyRef = {
  taskId: string
  sidecarGeneration: number
  registrationId: string
  location: Location.Ref
  pinId: PinnedFileId
  pinSha256: string
}
export type DocumentRuntimeVerifyTask = DocumentRuntimeVerifyRef & { kind: "libreoffice"; runtimeRoot: string; jobRoot: string }
export type DocumentRuntimeVerifyReceipt = DocumentRuntimeVerifyRef & (
  | { status: "completed"; version: string; pdfPath: string; pdfSha256: string; pageCount: number }
  | { status: "failed"; reason: "spawn" | "conversion" | "invalid-result" | "timeout"; detail: string; exitCode: number | null; stderr: string }
  | { status: "cancelled"; reason: "requested" | "location-disposed" | "sidecar-stopped" | "superseded" }
)

export const documentRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
export const documentDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !value.includes("\0")
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const absolute = (value: unknown): value is string => text(value) && (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value))

export function isDocumentRuntimeState(value: unknown): value is DocumentRuntimeState {
  if (!documentRecord(value)) return false
  if (value.phase === "ready") return text(value.version) && absolute(value.executable)
  if (value.phase === "failed") return isConnectorLaunchFailure(value.failure)
  return value.phase === "preparing" && ["download", "extract", "verify"].includes(String(value.stage)) && (value.received === undefined || count(value.received)) && (value.total === undefined || count(value.total)) && !(typeof value.received === "number" && typeof value.total === "number" && value.received > value.total)
}

export function isDocumentRuntimeVerifyRef(value: unknown): value is DocumentRuntimeVerifyRef & Record<string, unknown> {
  if (!documentRecord(value) || !text(value.taskId) || !count(value.sidecarGeneration) || !text(value.registrationId)) return false
  if (!documentRecord(value.location) || !absolute(value.location.directory) || (value.location.workspaceID !== undefined && !text(value.location.workspaceID))) return false
  return typeof value.pinId === "string" && /^libreoffice\/(darwin-arm64|win32-x64)\/[^/]+$/.test(value.pinId) && documentDigest(value.pinSha256)
}
export function isDocumentRuntimeVerifyTask(value: unknown): value is DocumentRuntimeVerifyTask {
  return isDocumentRuntimeVerifyRef(value) && documentRecord(value) && value.kind === "libreoffice" && absolute(value.runtimeRoot) && absolute(value.jobRoot)
}
export function isDocumentRuntimeVerifyReceipt(value: unknown): value is DocumentRuntimeVerifyReceipt {
  if (!isDocumentRuntimeVerifyRef(value) || !documentRecord(value)) return false
  if (value.status === "completed") return text(value.version) && absolute(value.pdfPath) && documentDigest(value.pdfSha256) && count(value.pageCount) && value.pageCount > 0
  if (value.status === "cancelled") return ["requested", "location-disposed", "sidecar-stopped", "superseded"].includes(String(value.reason))
  return value.status === "failed" && ["spawn", "conversion", "invalid-result", "timeout"].includes(String(value.reason)) && typeof value.detail === "string" && typeof value.stderr === "string" && (value.exitCode === null || Number.isSafeInteger(value.exitCode))
}
export function sameDocumentVerifyRef(a: DocumentRuntimeVerifyRef, b: DocumentRuntimeVerifyRef) {
  return a.taskId === b.taskId && a.sidecarGeneration === b.sidecarGeneration && a.registrationId === b.registrationId && a.location.directory === b.location.directory && a.location.workspaceID === b.location.workspaceID && a.pinId === b.pinId && a.pinSha256 === b.pinSha256
}
