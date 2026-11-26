import { Schema } from "effect"
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

export const DOCUMENT_WORK_DIR = ".document-output"

// Pure render contract shared by ext, main and artifact discovery.
export type DocumentKind = "docx" | "xlsx" | "pptx" | "pdf" | "html" | "design"
export type DocumentEnvironment = { python: string; node: string; nodeModules: string; skills: string; templates: string; fonts: string; workRoot: string; renderState: DocumentRuntimeState }
export type RenderRequest = { kind: DocumentKind; path: string; outputPath?: string; dpi?: number; viewport?: { width: number; height: number } }
export type RenderPage = { number: number; path: string; sha256: string; width: number; height: number }
export type DocumentArtifactRecord = { checkId: string; kind: DocumentKind; sourcePath: string; sourceSha256: string; artifactPath: string; artifactSha256: string }
export type RenderReceipt = DocumentArtifactRecord & { id: string; revision: 0 | 1; renderer: "libreoffice-pdfium" | "pdfium" | "chromium"; rendererVersion: string; pages: RenderPage[]; pageCount: number; template: { source: "bundled" | "user"; path: string; sha256: string } | null; diagnostics: string[] }
export type RenderResult =
  | { status: "rendered"; receipt: RenderReceipt }
  | { status: "pending"; checkId: string; artifact: DocumentArtifactRecord; runtime: DocumentRuntimeState }
  | { status: "failed"; code: "invalid-input" | "source-missing" | "runtime" | "conversion" | "raster" | "disk" | "source-changed" | "timeout"; detail: string; artifact?: DocumentArtifactRecord }
export type DocumentToolMetadata = { codepuppyDocument: { schemaVersion: 1; artifact: DocumentArtifactRecord } }
export type FormulaError = { sheet: string; cell: string; formula: string; error: string }
export type DocumentIssue = { page: number; detail: string }
export type DocumentCheckReport = { checkId: string; renderId: string; revision: 0 | 1; final: boolean; inspectedPages: number[]; uninspected: { page: number; reason: string }[]; observations: DocumentIssue[]; fixes: string[]; remaining: DocumentIssue[]; formulaCheck?: { recalculationId: string; errors: FormulaError[] } }
export type DeferredDocumentCheck = { id: string; location: Location.Ref; sessionID: import("../../schema/src/session.js").Session.ID; notificationID: import("../../schema/src/session-message.js").SessionMessage.ID; request: RenderRequest; sourceSha256: string; artifact: DocumentArtifactRecord; revision: 0 | 1; state: "waiting-runtime" | "admitting" | "admitted" | "complete"; report?: DocumentCheckReport }
export type DocumentCaller = { location: Location.Ref; sessionID: import("../../schema/src/session.js").Session.ID }
export type DocumentCheckAdmission = { status: "admitted"; checkId: string; notificationID: import("../../schema/src/session-message.js").SessionMessage.ID } | { status: "session-missing" | "conflict"; checkId: string }
export type DocumentHost = {
  environment(caller: DocumentCaller): Promise<DocumentEnvironment>
  chromiumRender(input: { caller: DocumentCaller; checkId: string; revision: 0 | 1; request: RenderRequest; sourceSha256: string }): Promise<RenderResult>
  defer(input: DeferredDocumentCheck): Promise<void>
  recordCheck(input: { caller: DocumentCaller; checkId: string; report: DocumentCheckReport }): Promise<void>
  subscribeReady(location: Location.Ref, listener: (check: DeferredDocumentCheck) => Promise<DocumentCheckAdmission>): () => void
  subscribeRuntimeVerify(location: Location.Ref, run: (task: DocumentRuntimeVerifyTask, signal: AbortSignal) => Promise<DocumentRuntimeVerifyReceipt>): () => Promise<void>
}
const hostKey = Symbol.for("codepuppy.document.host")
export function publishDocumentHost(host: DocumentHost) {
  const target = globalThis as { [hostKey]?: DocumentHost }
  if (target[hostKey]) throw new Error("document host already published for this process")
  target[hostKey] = host
}
export function documentHost(): DocumentHost {
  const host = (globalThis as { [hostKey]?: DocumentHost })[hostKey]
  if (!host) throw new Error("document host was not published before engine startup")
  return host
}
export function isRenderRequest(value: unknown): value is RenderRequest {
  if (!Schema.is(RenderRequestSchema)(value) || !absolute(value.path)) return false
  if (value.kind === "design" ? !absolute(value.outputPath) : value.outputPath !== undefined) return false
  return Object.keys(value).every((key) => ["kind", "path", "outputPath", "dpi", "viewport"].includes(key))
}
export function isDocumentArtifactRecord(value: unknown): value is DocumentArtifactRecord {
  return documentRecord(value) && text(value.checkId) && ["docx", "xlsx", "pptx", "pdf", "html", "design"].includes(String(value.kind)) && absolute(value.sourcePath) && absolute(value.artifactPath) && documentDigest(value.sourceSha256) && documentDigest(value.artifactSha256)
}
export function documentArtifactFromMetadata(value: unknown): DocumentArtifactRecord | undefined {
  if (!documentRecord(value) || !documentRecord(value.codepuppyDocument) || value.codepuppyDocument.schemaVersion !== 1) return
  return isDocumentArtifactRecord(value.codepuppyDocument.artifact) ? value.codepuppyDocument.artifact : undefined
}
export function documentMetadata(result: RenderResult): DocumentToolMetadata | undefined {
  const artifact = result.status === "rendered" ? result.receipt : result.artifact
  return artifact ? { codepuppyDocument: { schemaVersion: 1, artifact } } : undefined
}

export function isDocumentEnvironment(value: unknown): value is DocumentEnvironment {
  return documentRecord(value) && ["python", "node", "nodeModules", "skills", "templates", "fonts", "workRoot"].every((key) => absolute(value[key])) && isDocumentRuntimeState(value.renderState)
}
export function isRenderResult(value: unknown): value is RenderResult {
  if (!documentRecord(value)) return false
  if (value.status === "pending") return text(value.checkId) && isDocumentArtifactRecord(value.artifact) && isDocumentRuntimeState(value.runtime)
  if (value.status === "failed") return ["invalid-input", "source-missing", "runtime", "conversion", "raster", "disk", "source-changed", "timeout"].includes(String(value.code)) && typeof value.detail === "string" && (value.artifact === undefined || isDocumentArtifactRecord(value.artifact))
  if (value.status !== "rendered" || !isDocumentArtifactRecord(value.receipt)) return false
  const receipt = value.receipt as DocumentArtifactRecord & Record<string, unknown>
  return text(receipt.id) && (receipt.revision === 0 || receipt.revision === 1) && ["libreoffice-pdfium", "pdfium", "chromium"].includes(String(receipt.renderer)) && typeof receipt.rendererVersion === "string" && Array.isArray(receipt.pages) && receipt.pages.length > 0 && receipt.pageCount === receipt.pages.length && receipt.pages.every((page, index) => documentRecord(page) && page.number === index + 1 && absolute(page.path) && documentDigest(page.sha256) && count(page.width) && page.width > 0 && count(page.height) && page.height > 0) && Array.isArray(receipt.diagnostics) && receipt.diagnostics.every((item) => typeof item === "string") && (receipt.template === null || (documentRecord(receipt.template) && ["bundled", "user"].includes(String(receipt.template.source)) && absolute(receipt.template.path) && documentDigest(receipt.template.sha256)))
}
export function isDocumentCaller(value: unknown): value is DocumentCaller & Record<string, unknown> {
  return documentRecord(value) && text(value.sessionID) && documentRecord(value.location) && absolute(value.location.directory) && (value.location.workspaceID === undefined || text(value.location.workspaceID))
}
export type DocumentHostRequest =
  | { operation: "environment"; caller: DocumentCaller }
  | { operation: "chromiumRender"; input: Parameters<DocumentHost["chromiumRender"]>[0] }
  | { operation: "defer"; input: DeferredDocumentCheck }
  | { operation: "recordCheck"; input: Parameters<DocumentHost["recordCheck"]>[0] }
  | { operation: "verify-register" | "verify-unregister"; location: Location.Ref; registrationId: string }
  | { operation: "ready-register" | "ready-unregister"; location: Location.Ref }
export type DocumentHostRequestMessage = { type: "codepuppy.document.host.request"; id: number; sidecarGeneration: number; request: DocumentHostRequest }
export type DocumentHostReplyMessage = { type: "codepuppy.document.host.reply"; id: number; sidecarGeneration: number } & ({ ok: true; value: unknown } | { ok: false; detail: string })

export function isDocumentCheckReport(value: unknown): value is DocumentCheckReport {
  return Schema.is(DocumentCheckReportSchema)(value)
}
export function isDeferredDocumentCheck(value: unknown): value is DeferredDocumentCheck {
  return documentRecord(value) && text(value.id) && isDocumentCaller(value) && text(value.notificationID) && isRenderRequest(value.request) && documentDigest(value.sourceSha256) && isDocumentArtifactRecord(value.artifact) && (value.revision === 0 || value.revision === 1) && ["waiting-runtime", "admitting", "admitted", "complete"].includes(String(value.state)) && (value.report === undefined || isDocumentCheckReport(value.report))
}
export function parseDocumentHostRequest(value: unknown): DocumentHostRequestMessage | undefined {
  if (!documentRecord(value) || value.type !== "codepuppy.document.host.request" || !count(value.id) || !count(value.sidecarGeneration) || !documentRecord(value.request)) return
  const request = value.request
  const valid = request.operation === "environment" ? isDocumentCaller(request.caller)
    : request.operation === "chromiumRender" ? documentRecord(request.input) && isDocumentCaller(request.input.caller) && text(request.input.checkId) && (request.input.revision === 0 || request.input.revision === 1) && isRenderRequest(request.input.request) && documentDigest(request.input.sourceSha256)
    : request.operation === "defer" ? isDeferredDocumentCheck(request.input)
    : request.operation === "recordCheck" ? documentRecord(request.input) && isDocumentCaller(request.input.caller) && text(request.input.checkId) && isDocumentCheckReport(request.input.report)
    : ["verify-register", "verify-unregister", "ready-register", "ready-unregister"].includes(String(request.operation)) && (!["verify-register", "verify-unregister"].includes(String(request.operation)) || text(request.registrationId)) && documentRecord(request.location) && absolute(request.location.directory) && (request.location.workspaceID === undefined || text(request.location.workspaceID))
  return valid ? value as unknown as DocumentHostRequestMessage : undefined
}
export function parseDocumentHostReply(value: unknown): DocumentHostReplyMessage | undefined {
  if (!documentRecord(value) || value.type !== "codepuppy.document.host.reply" || !count(value.id) || !count(value.sidecarGeneration)) return
  if (value.ok === true && "value" in value) return value as DocumentHostReplyMessage
  if (value.ok === false && typeof value.detail === "string") return value as DocumentHostReplyMessage
}

const positive = Schema.Int.check(Schema.isGreaterThan(0))
export const RenderRequestSchema = Schema.Struct({ kind: Schema.Literals(["docx", "xlsx", "pptx", "pdf", "html", "design"]), path: Schema.String, outputPath: Schema.optionalKey(Schema.String), dpi: Schema.optionalKey(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))), viewport: Schema.optionalKey(Schema.Struct({ width: positive, height: positive })) })
const issue = Schema.Struct({ page: positive, detail: Schema.String })
export const DocumentCheckReportSchema = Schema.Struct({ checkId: Schema.String, renderId: Schema.String, revision: Schema.Literals([0, 1]), final: Schema.Boolean, inspectedPages: Schema.Array(positive), uninspected: Schema.Array(Schema.Struct({ page: positive, reason: Schema.String })), observations: Schema.Array(issue), fixes: Schema.Array(Schema.String), remaining: Schema.Array(issue), formulaCheck: Schema.optionalKey(Schema.Struct({ recalculationId: Schema.String, errors: Schema.Array(Schema.Struct({ sheet: Schema.String, cell: Schema.String, formula: Schema.String, error: Schema.String })) })) })
export const DocumentToolInputSchema = Schema.Union([
  Schema.Struct({ action: Schema.Literal("environment") }),
  Schema.Struct({ action: Schema.Literal("render"), request: RenderRequestSchema, checkId: Schema.optionalKey(Schema.String), revision: Schema.optionalKey(Schema.Literals([0, 1])) }),
  Schema.Struct({ action: Schema.Literal("check"), report: DocumentCheckReportSchema }),
])


export function isDocumentCheckAdmission(value: unknown): value is DocumentCheckAdmission {
  return documentRecord(value) && text(value.checkId) && (["session-missing", "conflict"].includes(String(value.status)) || (value.status === "admitted" && text(value.notificationID)))
}
