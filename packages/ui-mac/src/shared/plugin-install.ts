import type { EnvironmentForward, McpTimeouts } from "./host-extension-package-contract/plugin-package"
export type EffectScopeV1 = { kind: "all-projects" } | { kind: "project"; directory: string }
export type CreatedPluginDraftV1 = { searchId: string; name: string; description: string; files: { path: string; text: string }[] }
export type InstallSourceRefV1 = { kind: "catalog"; catalogId: string } | { kind: "candidate"; candidateId: string } | { kind: "folder" } | { kind: "created"; draft: CreatedPluginDraftV1 }
export type InstallRequestV1 = { requestId: string; source: InstallSourceRefV1; effect: EffectScopeV1; via: "hub" | "chat" }
export type NotRunningReasonV1 = "kind-not-supported-yet" | "needs-plugin-files" | "unresolved-app-id" | "native-js-plugin" | "invalid-definition" | "missing-entry"
export type PackageNotRunningV1 = { kind: string; sourceName: string; reason: NotRunningReasonV1 }
export type McpConfigLeafV1 =
  | { type: "local"; command: string[]; environment?: Record<string, string>; cwd?: string; timeout?: number; timeouts?: McpTimeouts; forwardEnvironment?: EnvironmentForward[] }
  | { type: "remote"; transport?: "http" | "sse"; url: string; headers?: Record<string, string>; timeout?: number; timeouts?: McpTimeouts; oauth?: false | { clientId?: string; clientSecret?: string; scope?: string; redirectUri?: string } }
export type PackageSourceV1 =
  | { kind: "catalog" }
  | { kind: "marketplace"; ecosystem: "claude" | "codex"; repository: string; commit: string; path: string; entryName: string }
  | { kind: "mcp-registry"; serverName: string; version: string; publisher: { kind: "github"; account: string } | { kind: "domain"; domain: string } }
  | { kind: "npm"; ecosystem: "opencode"; name: string; version: string; integrity: string }
  | { kind: "created" } | { kind: "local-folder" }
export type PackageEffectV1 = { kind: "project"; projectPath: string; projectPathHash: string }
export type PackageDeclarationV1 = {
  componentId: string; kind: "skill" | "mcp" | "command" | "agent"; hostName: string; sourceName: string
  mcp?: McpConfigLeafV1
  secretNeeds: { needId: string; label: string }[]
  login?: { serverUrl: string }
  oauthNotApplied?: ("resource" | "authorizationServerUrl")[]
}
export type PackageGraphAnnotationsV1 = {
  source?: PackageSourceV1; effect?: PackageEffectV1; notRunning?: PackageNotRunningV1[]; declarations?: PackageDeclarationV1[]
}
export type InstallOutcomeV1 =
  | { ok: true; packageId: string; displayName: string; source: PackageSourceV1; installed: { kind: "skill" | "mcp" | "command" | "agent"; hostName: string; sourceName: string }[]; notRunning: PackageNotRunningV1[]; alreadyInstalled?: true; resolvedToCatalog?: string }
  | { ok: false; code: "nothing-runnable"; detail: string; notRunning: PackageNotRunningV1[] }
  | { ok: false; code: "unknown-id" | "source-unreachable" | "source-changed" | "invalid-draft" | "not-searched" | "transaction-failed"; detail: string }

const REASONS = new Set<string>(["kind-not-supported-yet", "needs-plugin-files", "unresolved-app-id", "native-js-plugin", "invalid-definition", "missing-entry"])

/** The graph decoder calls this before accepting annotations; no files, values or engine handles cross it. */
export function validPackageGraphAnnotations(input: PackageGraphAnnotationsV1 | Record<string, unknown>): boolean {
  if (input.source !== undefined && !validSource(input.source)) return false
  if (input.effect !== undefined && (!exact(input.effect, ["kind", "projectPath", "projectPathHash"]) || input.effect.kind !== "project" || !nonempty(input.effect.projectPath) || !nonempty(input.effect.projectPathHash))) return false
  if (input.notRunning !== undefined && (!Array.isArray(input.notRunning) || !input.notRunning.every((item: unknown) => exact(item, ["kind", "sourceName", "reason"]) && nonempty(item.kind) && typeof item.sourceName === "string" && typeof item.reason === "string" && REASONS.has(item.reason)))) return false
  if (input.declarations !== undefined && (!Array.isArray(input.declarations) || !input.declarations.every(validDeclaration))) return false
  return true
}

export function validMcpConfigLeaf(input: unknown): input is McpConfigLeafV1 {
  if (!record(input)) return false
  if (input.timeout !== undefined && (!Number.isSafeInteger(input.timeout) || Number(input.timeout) <= 0)) return false
  if (input.timeouts !== undefined && (!exact(input.timeouts, ["startupMs", "catalogMs", "executionMs"]) || !Object.values(input.timeouts).every(value => Number.isSafeInteger(value) && Number(value) > 0))) return false
  if (input.forwardEnvironment !== undefined && (!Array.isArray(input.forwardEnvironment) || !input.forwardEnvironment.every(value => exact(value, ["name", "source"]) && nonempty(value.name) && (value.source === "local" || value.source === "remote")))) return false
  if (input.type === "local")
    return exact(input, ["type", "command", "environment", "cwd", "timeout", "timeouts", "forwardEnvironment"]) && Array.isArray(input.command) && input.command.length > 0 && input.command.every((part: unknown) => typeof part === "string") && (input.environment === undefined || stringMap(input.environment)) && (input.cwd === undefined || typeof input.cwd === "string")
  if (input.type !== "remote" || !exact(input, ["type", "transport", "url", "headers", "timeout", "timeouts", "oauth"]) || !nonempty(input.url) || (input.transport !== undefined && input.transport !== "http" && input.transport !== "sse") || (input.headers !== undefined && !stringMap(input.headers))) return false
  return input.oauth === undefined || input.oauth === false || (exact(input.oauth, ["clientId", "clientSecret", "scope", "redirectUri"]) && Object.values(input.oauth).every((value) => typeof value === "string"))
}

function validDeclaration(input: unknown): boolean {
  if (!exact(input, ["componentId", "kind", "hostName", "sourceName", "mcp", "secretNeeds", "login", "oauthNotApplied"]) || !nonempty(input.componentId) || !nonempty(input.hostName) || typeof input.sourceName !== "string" || !["skill", "mcp", "command", "agent"].includes(String(input.kind))) return false
  if (!Array.isArray(input.secretNeeds) || !input.secretNeeds.every((need: unknown) => exact(need, ["needId", "label"]) && nonempty(need.needId) && typeof need.label === "string")) return false
  if (input.login !== undefined && (!exact(input.login, ["serverUrl"]) || !nonempty(input.login.serverUrl))) return false
  if (input.oauthNotApplied !== undefined && (!Array.isArray(input.oauthNotApplied) || !input.oauthNotApplied.every((field) => field === "resource" || field === "authorizationServerUrl"))) return false
  if (input.kind !== "mcp") return input.mcp === undefined && input.secretNeeds.length === 0
  if (!validMcpConfigLeaf(input.mcp)) return false
  const needs = new Set(input.secretNeeds.map((need: { needId: string }) => need.needId))
  if (needs.size !== input.secretNeeds.length) return false
  const placeholders = new Set([...JSON.stringify(input.mcp).matchAll(/\{secret:([^}]+)\}/g)].map((match) => match[1]!))
  if (placeholders.size !== needs.size || [...placeholders].some((need) => !needs.has(need))) return false
  if (JSON.stringify(input.mcp).includes("{file:")) return false
  if (input.mcp.type !== "remote") return true
  if (Object.entries(input.mcp.headers ?? {}).some(([key, value]) => /authorization|token|secret|api[_-]?key|cookie/i.test(key) && value !== "" && !value.includes("{secret:") && !value.includes("${user_config."))) return false
  return !input.mcp.oauth || input.mcp.oauth.clientSecret === undefined || input.mcp.oauth.clientSecret.includes("{secret:")
}

function validSource(input: unknown): boolean {
  if (!record(input)) return false
  if (input.kind === "catalog" || input.kind === "created" || input.kind === "local-folder") return exact(input, ["kind"])
  if (input.kind === "marketplace") return exact(input, ["kind", "ecosystem", "repository", "commit", "path", "entryName"]) && (input.ecosystem === "claude" || input.ecosystem === "codex") && nonempty(input.repository) && nonempty(input.commit) && typeof input.path === "string" && nonempty(input.entryName)
  if (input.kind === "npm") return exact(input, ["kind", "ecosystem", "name", "version", "integrity"]) && input.ecosystem === "opencode" && nonempty(input.name) && nonempty(input.version) && nonempty(input.integrity)
  return input.kind === "mcp-registry" && exact(input, ["kind", "serverName", "version", "publisher"]) && nonempty(input.serverName) && nonempty(input.version) && record(input.publisher) && (input.publisher.kind === "github" ? exact(input.publisher, ["kind", "account"]) && nonempty(input.publisher.account) : input.publisher.kind === "domain" && exact(input.publisher, ["kind", "domain"]) && nonempty(input.publisher.domain))
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value: unknown, keys: string[]): value is Record<string, unknown> { return record(value) && Object.keys(value).every((key) => keys.includes(key)) }
function nonempty(value: unknown): value is string { return typeof value === "string" && value.length > 0 }
function stringMap(value: unknown): value is Record<string, string> { return record(value) && Object.values(value).every((item) => typeof item === "string") }

export function diagnosticNotRunning(
  diagnostics: readonly import("./host-extension-package-contract/plugin-conversion").Diagnostic[],
): PackageNotRunningV1[] {
  return diagnostics.map((diagnostic) => ({
    kind:
      diagnostic.code === "native-js-plugin"
        ? "plugin"
        : diagnostic.code === "unresolved-app-id"
          ? "app"
          : "definition",
    sourceName: diagnostic.sourceName ?? diagnostic.path.split("/").at(-1) ?? diagnostic.path,
    reason: diagnostic.code,
  }))
}

/** Wire projection of main's result; rejects invented fields and never transports private credentials. */
export function isInstallOutcomeV1(input: unknown): input is InstallOutcomeV1 {
  if (!record(input) || typeof input.ok !== "boolean") return false
  if (!input.ok) {
    if (!exact(input, ["ok", "code", "detail", "notRunning"]) || typeof input.detail !== "string") return false
    if (input.code === "nothing-runnable") return Array.isArray(input.notRunning) && validPackageGraphAnnotations({ notRunning: input.notRunning })
    return input.notRunning === undefined && ["unknown-id", "source-unreachable", "source-changed", "invalid-draft", "not-searched", "transaction-failed"].includes(String(input.code))
  }
  return exact(input, ["ok", "packageId", "displayName", "source", "installed", "notRunning", "alreadyInstalled", "resolvedToCatalog"]) && nonempty(input.packageId) && typeof input.displayName === "string" && validSource(input.source) && Array.isArray(input.notRunning) && validPackageGraphAnnotations({ notRunning: input.notRunning }) && Array.isArray(input.installed) && input.installed.every((item: unknown) => exact(item, ["kind", "hostName", "sourceName"]) && ["skill", "mcp", "command", "agent"].includes(String(item.kind)) && nonempty(item.hostName) && typeof item.sourceName === "string") && (input.alreadyInstalled === undefined || input.alreadyInstalled === true) && (input.resolvedToCatalog === undefined || typeof input.resolvedToCatalog === "string")
}
