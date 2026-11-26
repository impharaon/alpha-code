// Default import lets browser consumers prune the unused backend digest validator.
import crypto from "node:crypto"
import type { PackagePayloadRefV1 } from "./decoder"

export type Sha256 = `sha256:${string}`
export type RelPath = string
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Source = {
  kind: "folder" | "git" | "listing" | "marketplace" | "mcp-registry" | "npm" | "created"
  locator: string
  repository?: string
  commit?: string
  pluginPath?: string
  ecosystem?: "claude" | "codex" | "opencode"
  entryName?: string
  serverName?: string
  version?: string
  integrity?: string
}
export type Provider = "claude-code" | "codex" | "skill" | "mcp-registry" | "opencode"
export type TreeNode =
  | { kind: "directory"; path: RelPath; mode: number }
  | { kind: "file"; path: RelPath; mode: number; bytes: number; digest: Sha256 }
  | { kind: "symlink"; path: RelPath; target: string }
export type Capture = { source: Source; nodes: readonly TreeNode[]; readFile(path: RelPath): Promise<Uint8Array> }
export type Text = readonly (string | { binding: "pluginRoot" | "skillDir" | "projectDir" | "pluginData" } | { secret: string } | { option: string } | { environment: { name: string; default?: Text } })[]
export type PluginOption = { type: "string" | "number" | "boolean"; title: string; description: string; required: boolean; sensitive: boolean; default?: string | number | boolean | { secret: string } }
export type EnvironmentForward = { name: string; source: "local" | "remote" }
export type McpTimeouts = { startupMs?: number; catalogMs?: number; executionMs?: number }
export type PackageTextBindings = { pluginRoot: string; skillDir?: string; projectDir: string; pluginData: string; resolveOption(key: string): string | number | boolean | undefined; resolveEnvironment(name: string): string | undefined; resolveSecret(id: string): string | undefined }
export type ToolRule = { tool: string; pattern?: string }
export type ModelHint = { alias: string } | { providerID: string; modelID: string }
export type Invocation = {
  argumentHint?: string
  model?: ModelHint
  agent?: string
  fork: boolean
  userInvocable: boolean
  implicitInvocation: boolean
  allowedTools: ToolRule[]
  deniedTools: ToolRule[]
  availableTools?: ToolRule[]
}
export type SecretNeed = {
  id: string
  componentId: string
  label: string
  targets: { file: RelPath; pointer: string }[]
}
export type LoginNeed = {
  id: string
  componentId: string
  kind: "mcp-oauth"
  required: boolean
  serviceId: string
  serverUrl: string
  oauth?: {
    clientId?: string
    clientSecret?: Text
    scopes?: string[]
    resource?: string
    authorizationServerUrl?: string
  }
}
export type HookEvent =
  | "SessionStart"
  | "UserPromptSubmit"
  | "UserPromptExpansion"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Stop"
  | "StopFailure"
  | "PermissionRequest"
export type Hook = {
  event: HookEvent
  matcher?: string
  if?: string
  command: Text
  timeoutSeconds: number
  async: boolean
  asyncRewake: boolean
  onFailure: "continue" | "block"
  order: number
  scope: { kind: "package" } | { kind: "skill" | "agent"; entryId: string }
}
type EntryBase = { id: string; sourcePath: RelPath; sourceName: string }
export type Entry = EntryBase &
  (
    | {
        kind: "skill"
        directory: RelPath
        instruction: Text
        invocation: Invocation
        display: Record<string, Json>
        mcpDependencies: string[]
      }
    | { kind: "command" | "agent"; instruction: Text; invocation: Invocation }
    | {
        kind: "mcp"
        transport: "stdio"
        command: Text[]
        environment: Record<string, Text>
        forwardEnvironment?: EnvironmentForward[]
        timeouts?: McpTimeouts
        cwd?: Text
        timeoutMs?: number
        floatingVersion?: { commandIndex: number; token: string }
      }
    | {
        kind: "mcp"
        transport: "http" | "sse"
        url: Text
        headers: Record<string, Text>
        timeouts?: McpTimeouts
        timeoutMs?: number
        oauth?: false | LoginNeed
      }
    | { kind: "hook"; hook: Hook }
  )
export type Diagnostic = {
  path: RelPath
  field?: string
  code: "invalid-definition" | "missing-entry" | "unresolved-app-id" | "native-js-plugin"
  sourceName?: string
  message: string
}
export type PluginPackage = {
  schema: "codepuppy.plugin-package.v1"
  provider: Provider
  name: string
  version?: string
  description?: string
  source: Source
  tree: TreeNode[]
  treeDigest: Sha256
  entries: Entry[]
  secrets: SecretNeed[]
  options?: Record<string, PluginOption>
  defaults?: { agent?: string }
  diagnostics: Diagnostic[]
}
export type MarketplaceEntry = {
  name: string
  description: string
  category?: string
  source:
    | { kind: "path"; path: RelPath }
    | { kind: "git"; url: string; commit?: string; ref?: string; path?: RelPath }
    | { kind: "unsupported"; detail: string }
}

export type PluginPackagePayloadV1 = {
  schema: "codepuppy.host-extension-package.payload.plugin-package.v1"
  description: PluginPackage
  blobs: PackagePayloadRefV1[]
}

export function pluginTreeDigest(tree: readonly TreeNode[]): `sha256:${string}` {
  return `sha256:${crypto.createHash("sha256")
    .update(canonicalPluginJson([...tree].sort((a, b) => a.path.localeCompare(b.path))))
    .digest("hex")}`
}

export function canonicalPluginJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalPluginJson).join(",") + "]"
  if (object(value))
    return (
      "{" +
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => JSON.stringify(key) + ":" + canonicalPluginJson(value[key]))
        .join(",") +
      "}"
    )
  return JSON.stringify(value)
}

export function pluginRelativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !!value &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/.test(value) &&
    value.split("/").every((part) => !!part && part !== "." && part !== "..")
  )
}

/** The tree contract is shared by capture, profile decoding and transaction validation. */
export function validPluginTree(value: unknown): value is TreeNode[] {
  if (!Array.isArray(value)) return false
  const nodes = new Map<string, TreeNode>()
  for (const node of value) {
    if (!object(node) || !pluginRelativePath(node.path) || nodes.has(node.path)) return false
    if (node.kind === "symlink") {
      if (!keys(node, ["kind", "path", "target"]) || typeof node.target !== "string" || node.target.includes("\0"))
        return false
    } else {
      if (!Number.isInteger(node.mode) || Number(node.mode) < 0 || Number(node.mode) > 0o7777) return false
      if (node.kind === "directory") {
        if (!keys(node, ["kind", "path", "mode"])) return false
      } else if (
        node.kind !== "file" ||
        !keys(node, ["kind", "path", "mode", "bytes", "digest"]) ||
        !Number.isSafeInteger(node.bytes) ||
        Number(node.bytes) < 0 ||
        !digest(node.digest)
      )
        return false
    }
    nodes.set(node.path, node as TreeNode)
  }
  // A link/file cannot be an ancestor of a declared destination, regardless of node order.
  return [...nodes.values()].every((node) =>
    node.path
      .split("/")
      .slice(0, -1)
      .every((_, index, parts) => {
        const parent = nodes.get(parts.slice(0, index + 1).join("/"))
        return !parent || parent.kind === "directory"
      }),
  )
}

export function validPluginPackage(value: unknown): value is PluginPackage {
  if (
    !object(value) ||
    !keys(value, [
      "schema",
      "provider",
      "name",
      "version",
      "description",
      "source",
      "tree",
      "treeDigest",
      "entries",
      "secrets",
      "diagnostics",
      "options",
      "defaults",
    ]) ||
    value.schema !== "codepuppy.plugin-package.v1"
  )
    return false
  if (
    !["claude-code", "codex", "skill", "mcp-registry", "opencode"].includes(String(value.provider)) ||
    typeof value.name !== "string" ||
    !optionalString(value.version) ||
    !optionalString(value.description)
  )
    return false
  if (
    !object(value.source) ||
    !keys(value.source, [
      "kind",
      "locator",
      "repository",
      "commit",
      "pluginPath",
      "ecosystem",
      "entryName",
      "serverName",
      "version",
      "integrity",
    ]) ||
    !["folder", "git", "listing", "marketplace", "mcp-registry", "npm", "created"].includes(
      String(value.source.kind),
    ) ||
    typeof value.source.locator !== "string" ||
    !Object.values(value.source).every((part) => typeof part === "string")
  )
    return false
  if (value.source.ecosystem !== undefined && !["claude", "codex", "opencode"].includes(String(value.source.ecosystem)))
    return false
  if (
    !validPluginTree(value.tree) ||
    value.treeDigest !== pluginTreeDigest(value.tree) ||
    !Array.isArray(value.entries) ||
    !value.entries.every(validEntry) ||
    new Set(value.entries.map((entry) => entry.id)).size !== value.entries.length
  )
    return false
  if (value.options !== undefined && (!object(value.options) || !Object.values(value.options).every(validPluginOption))) return false
  if (value.defaults !== undefined && (!object(value.defaults) || !keys(value.defaults, ["agent"]) || !optionalString(value.defaults.agent))) return false
  const paths = new Set(value.tree.filter((node) => node.kind !== "directory").map((node) => node.path))
  if (value.entries.some((entry) => !paths.has(entry.sourcePath))) return false
  const entries = value.entries
  if (
    !Array.isArray(value.secrets) ||
    !value.secrets.every(
      (need) =>
        object(need) &&
        keys(need, ["id", "componentId", "label", "targets"]) &&
        typeof need.id === "string" &&
        typeof need.componentId === "string" &&
        (need.componentId === "$package" || entries.some((entry: Entry) => entry.id === need.componentId)) &&
        typeof need.label === "string" &&
        Array.isArray(need.targets) &&
        need.targets.every(
          (target) =>
            object(target) &&
            keys(target, ["file", "pointer"]) &&
            pluginRelativePath(target.file) &&
            typeof target.pointer === "string",
        ),
    )
  )
    return false
  return (
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(
      (item) =>
        object(item) &&
        keys(item, ["path", "field", "code", "sourceName", "message"]) &&
        typeof item.path === "string" &&
        optionalString(item.field) &&
        optionalString(item.sourceName) &&
        typeof item.message === "string" &&
        ["invalid-definition", "missing-entry", "unresolved-app-id", "native-js-plugin"].includes(String(item.code)),
    )
  )
}

export function validPluginOption(value: unknown): value is PluginOption {
  return object(value) && keys(value, ["type", "title", "description", "required", "sensitive", "default"]) && ["string", "number", "boolean"].includes(String(value.type)) && typeof value.title === "string" && typeof value.description === "string" && typeof value.required === "boolean" && typeof value.sensitive === "boolean" && (value.default === undefined || typeof value.default === value.type && (typeof value.default !== "number" || Number.isFinite(value.default)) || value.sensitive === true && object(value.default) && keys(value.default, ["secret"]) && typeof value.default.secret === "string")
}

export function renderPluginText(text: Text, paths: Pick<PackageTextBindings, "pluginRoot" | "projectDir"> & Partial<PackageTextBindings>): string {
  return text.map(part => {
    if (typeof part === "string") return part
    if ("secret" in part) return paths.resolveSecret?.(part.secret) ?? "{secret:" + part.secret + "}"
    if ("option" in part) return String(paths.resolveOption?.(part.option) ?? "${user_config." + part.option + "}")
    if ("environment" in part) return paths.resolveEnvironment?.(part.environment.name) ?? (part.environment.default ? renderPluginText(part.environment.default, paths) : "${" + part.environment.name + "}")
    return paths[part.binding] ?? "${" + (part.binding === "pluginData" ? "CLAUDE_PLUGIN_DATA" : "CLAUDE_SKILL_DIR") + "}"
  }).join("")
}

function validEntry(value: unknown): value is Entry {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    !pluginRelativePath(value.sourcePath) ||
    typeof value.sourceName !== "string"
  )
    return false
  const base = ["id", "kind", "sourcePath", "sourceName"]
  if (value.kind === "skill" || value.kind === "command" || value.kind === "agent") {
    if (!text(value.instruction) || !invocation(value.invocation)) return false
    if (value.kind !== "skill") return keys(value, [...base, "instruction", "invocation"])
    return (
      keys(value, [...base, "directory", "instruction", "invocation", "display", "mcpDependencies"]) &&
      (value.directory === "" || pluginRelativePath(value.directory)) &&
      value.sourcePath === (value.directory ? value.directory + "/" : "") + "SKILL.md" &&
      object(value.display) &&
      strings(value.mcpDependencies)
    )
  }
  if (value.kind === "mcp") {
    if (value.timeouts !== undefined && (!object(value.timeouts) || !keys(value.timeouts, ["startupMs", "catalogMs", "executionMs"]) || !Object.values(value.timeouts).every(value => typeof value === "number" && Number.isFinite(value) && value >= 0))) return false
    if (value.forwardEnvironment !== undefined && (!Array.isArray(value.forwardEnvironment) || !value.forwardEnvironment.every(item => object(item) && keys(item, ["name", "source"]) && typeof item.name === "string" && (item.source === "local" || item.source === "remote")))) return false
    if (value.timeoutMs !== undefined && (!Number.isSafeInteger(value.timeoutMs) || Number(value.timeoutMs) < 0))
      return false
    if (value.transport === "stdio")
      return (
        keys(value, [...base, "transport", "command", "environment", "cwd", "timeoutMs", "floatingVersion", "forwardEnvironment", "timeouts"]) &&
        Array.isArray(value.command) &&
        value.command.every(text) &&
        textMap(value.environment) &&
        (value.cwd === undefined || text(value.cwd)) &&
        (value.floatingVersion === undefined ||
          (object(value.floatingVersion) &&
            keys(value.floatingVersion, ["commandIndex", "token"]) &&
            Number.isSafeInteger(value.floatingVersion.commandIndex) &&
            Number(value.floatingVersion.commandIndex) >= 0 &&
            Number(value.floatingVersion.commandIndex) < value.command.length &&
            typeof value.floatingVersion.token === "string"))
      )
    return (
      keys(value, [...base, "transport", "url", "headers", "timeoutMs", "oauth", "timeouts"]) &&
      (value.transport === "http" || value.transport === "sse") &&
      text(value.url) &&
      textMap(value.headers) &&
      (value.oauth === undefined ||
        value.oauth === false ||
        (object(value.oauth) &&
          keys(value.oauth, ["id", "componentId", "kind", "required", "serviceId", "serverUrl", "oauth"]) &&
          value.oauth.kind === "mcp-oauth" &&
          typeof value.oauth.id === "string" &&
          typeof value.oauth.componentId === "string" &&
          typeof value.oauth.required === "boolean" &&
          typeof value.oauth.serviceId === "string" &&
          typeof value.oauth.serverUrl === "string" &&
          (value.oauth.oauth === undefined ||
            (object(value.oauth.oauth) &&
              keys(value.oauth.oauth, ["clientId", "clientSecret", "scopes", "resource", "authorizationServerUrl"]) &&
              optionalString(value.oauth.oauth.clientId) &&
              (value.oauth.oauth.clientSecret === undefined || text(value.oauth.oauth.clientSecret)) &&
              (value.oauth.oauth.scopes === undefined || strings(value.oauth.oauth.scopes)) &&
              optionalString(value.oauth.oauth.resource) &&
              optionalString(value.oauth.oauth.authorizationServerUrl)))))
    )
  }
  if (value.kind !== "hook" || !keys(value, [...base, "hook"]) || !object(value.hook)) return false
  const hook = value.hook
  return (
    keys(hook, [
      "event",
      "matcher",
      "if",
      "command",
      "timeoutSeconds",
      "async",
      "asyncRewake",
      "onFailure",
      "order",
      "scope",
    ]) &&
    [
      "SessionStart",
      "UserPromptSubmit",
      "UserPromptExpansion",
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "Stop",
      "StopFailure",
      "PermissionRequest",
    ].includes(String(hook.event)) &&
    optionalString(hook.matcher) &&
    optionalString(hook.if) &&
    text(hook.command) &&
    typeof hook.timeoutSeconds === "number" &&
    Number.isFinite(hook.timeoutSeconds) &&
    hook.timeoutSeconds >= 0 &&
    typeof hook.async === "boolean" &&
    typeof hook.asyncRewake === "boolean" &&
    (hook.onFailure === "continue" || hook.onFailure === "block") &&
    Number.isSafeInteger(hook.order) &&
    object(hook.scope) &&
    ((hook.scope.kind === "package" && keys(hook.scope, ["kind"])) ||
      (["skill", "agent"].includes(String(hook.scope.kind)) &&
        keys(hook.scope, ["kind", "entryId"]) &&
        typeof hook.scope.entryId === "string"))
  )
}
function invocation(value: unknown): boolean {
  if (
    !object(value) ||
    !keys(value, [
      "argumentHint",
      "model",
      "agent",
      "fork",
      "userInvocable",
      "implicitInvocation",
      "allowedTools",
      "deniedTools",
      "availableTools",
    ])
  )
    return false
  const rules = (value: unknown) =>
    Array.isArray(value) &&
    value.every(
      (rule) =>
        object(rule) &&
        keys(rule, ["tool", "pattern"]) &&
        typeof rule.tool === "string" &&
        optionalString(rule.pattern),
    )
  return (
    optionalString(value.argumentHint) &&
    optionalString(value.agent) &&
    (value.model === undefined ||
      (object(value.model) &&
        ((keys(value.model, ["alias"]) && typeof value.model.alias === "string") ||
          (keys(value.model, ["providerID", "modelID"]) &&
            typeof value.model.providerID === "string" &&
            typeof value.model.modelID === "string")))) &&
    typeof value.fork === "boolean" &&
    typeof value.userInvocable === "boolean" &&
    typeof value.implicitInvocation === "boolean" &&
    rules(value.allowedTools) &&
    rules(value.deniedTools) &&
    (value.availableTools === undefined || rules(value.availableTools))
  )
}
function text(value: unknown): value is Text {
  return (
    Array.isArray(value) &&
    value.every(
      (part) =>
        typeof part === "string" ||
        (object(part) &&
          ((keys(part, ["binding"]) && ["pluginRoot", "skillDir", "projectDir", "pluginData"].includes(String(part.binding))) ||
            (keys(part, ["secret"]) && typeof part.secret === "string") || (keys(part, ["option"]) && typeof part.option === "string") || (keys(part, ["environment"]) && object(part.environment) && keys(part.environment, ["name", "default"]) && typeof part.environment.name === "string" && (part.environment.default === undefined || text(part.environment.default))))),
    )
  )
}
function textMap(value: unknown): boolean {
  return object(value) && Object.values(value).every(text)
}
function strings(value: unknown): boolean {
  return Array.isArray(value) && value.every((part) => typeof part === "string")
}
function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string"
}
function digest(value: unknown): boolean {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value)
}
function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function pluginText(value: string): Text {
  const parts: Text[number][] = []
  let offset = 0
  for (const match of value.matchAll(/\$\{(user_config\.[^}]+|[A-Za-z_][\w]*(?::-[^}]*)?)\}/g)) {
    if (match.index! > offset) parts.push(value.slice(offset, match.index))
    const expression = match[1]!
    const binding = pluginPathBinding(expression)
    const split = expression.indexOf(":-")
    parts.push(binding ? { binding } : expression.startsWith("user_config.") ? { option: expression.slice(12) } : { environment: { name: split < 0 ? expression : expression.slice(0, split), ...(split < 0 ? {} : { default: pluginText(expression.slice(split + 2)) }) } })
    offset = match.index! + match[0].length
  }
  if (offset < value.length) parts.push(value.slice(offset))
  return parts.length ? parts : [value]
}
export function pluginPathBinding(value: string): "pluginRoot" | "skillDir" | "projectDir" | "pluginData" | undefined {
  return value === "CLAUDE_PLUGIN_ROOT" || value === "PLUGIN_ROOT" ? "pluginRoot" : value === "CLAUDE_SKILL_DIR" ? "skillDir" : value === "CLAUDE_PROJECT_DIR" ? "projectDir" : value === "CLAUDE_PLUGIN_DATA" || value === "PLUGIN_DATA" ? "pluginData" : undefined
}
