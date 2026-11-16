import { createHash } from "node:crypto"
import { ConfigMarkdown } from "@opencode/core/config/markdown"

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
export type Text = readonly (string | { binding: "pluginRoot" | "skillDir" | "projectDir" } | { secret: string })[]
export type ToolRule = { tool: string; pattern?: string }
export type ModelHint = { alias: string } | { providerID: string; modelID: string }
export type Invocation = {
  argumentHint?: string; model?: ModelHint; agent?: string
  fork: boolean; userInvocable: boolean; implicitInvocation: boolean
  allowedTools: ToolRule[]; deniedTools: ToolRule[]; availableTools?: ToolRule[]
}
export type SecretNeed = { id: string; componentId: string; label: string; targets: { file: RelPath; pointer: string }[] }
export type LoginNeed = {
  id: string; componentId: string; kind: "mcp-oauth"; required: boolean; serviceId: string; serverUrl: string
  oauth?: { clientId?: string; clientSecret?: Text; scopes?: string[]; resource?: string; authorizationServerUrl?: string }
}
export type HookEvent = "SessionStart" | "UserPromptSubmit" | "UserPromptExpansion" | "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "Stop" | "StopFailure" | "PermissionRequest"
export type Hook = {
  event: HookEvent; matcher?: string; if?: string; command: Text; timeoutSeconds: number
  async: boolean; asyncRewake: boolean; onFailure: "continue" | "block"; order: number
  scope: { kind: "package" } | { kind: "skill" | "agent"; entryId: string }
}
type EntryBase = { id: string; sourcePath: RelPath; sourceName: string }
export type Entry = EntryBase & (
  | { kind: "skill"; directory: RelPath; instruction: Text; invocation: Invocation; display: Record<string, Json>; mcpDependencies: string[] }
  | { kind: "command" | "agent"; instruction: Text; invocation: Invocation }
  | { kind: "mcp"; transport: "stdio"; command: Text[]; environment: Record<string, Text>; cwd?: Text; timeoutMs?: number; floatingVersion?: { commandIndex: number; token: string } }
  | { kind: "mcp"; transport: "http" | "sse"; url: Text; headers: Record<string, Text>; timeoutMs?: number; oauth?: false | LoginNeed }
  | { kind: "hook"; hook: Hook }
)
export type Diagnostic = { path: RelPath; field?: string; code: "invalid-definition" | "missing-entry" | "unresolved-app-id"; message: string }
export type PluginPackage = {
  schema: "codepuppy.plugin-package.v1"; provider: Provider; name: string; version?: string; description?: string
  source: Source; tree: TreeNode[]; treeDigest: Sha256; entries: Entry[]; secrets: SecretNeed[]; diagnostics: Diagnostic[]
}
export type MarketplaceEntry = {
  name: string; description: string; category?: string
  source: { kind: "path"; path: RelPath } | { kind: "git"; url: string; commit?: string; ref?: string; path?: RelPath } | { kind: "unsupported"; detail: string }
}

export class CaptureError extends Error {
  constructor(readonly code: "invalid-path" | "duplicate-path" | "invalid-node" | "read-failed" | "digest-mismatch", readonly path: string) {
    super("Plugin capture " + code + ": " + path)
  }
}

export function readMarketplace(bytes: Uint8Array, ecosystem: "claude" | "codex"): { name: string; entries: MarketplaceEntry[]; diagnostics: Diagnostic[] } {
  const document: unknown = JSON.parse(decode(bytes))
  if (!object(document) || !Array.isArray(document.plugins)) throw new Error("invalid marketplace definition")
  const diagnostics: Diagnostic[] = []
  const entries = document.plugins.flatMap((entry, index): MarketplaceEntry[] => {
    if (!object(entry) || typeof entry.name !== "string" || !entry.name) {
      diagnostics.push({ path: ecosystem === "codex" ? ".agents/plugins/marketplace.json" : ".claude-plugin/marketplace.json", field: "plugins/" + index, code: "invalid-definition", message: "Marketplace entry has no name" })
      return []
    }
    return [{ name: entry.name, description: string(entry.description) ?? "", ...(typeof entry.category === "string" ? { category: entry.category } : {}), source: marketplaceSource(ecosystem === "codex" && object(entry.source) && entry.source.source === "local" ? entry.source.path : entry.source) }]
  })
  return { name: string(document.name) ?? "", entries, diagnostics }
}

/** Validate the captured bytes before interpreting any definition; only sanitized bytes leave the converter. */
export async function convertPluginTree(input: Capture): Promise<{ package: PluginPackage; replacements: ReadonlyMap<RelPath, Uint8Array>; privateCredentials: ReadonlyMap<string, Uint8Array> }> {
  const files = new Map<string, Uint8Array>()
  const seen = new Set<string>()
  for (const node of input.nodes) {
    if (!validPath(node.path)) throw new CaptureError("invalid-path", node.path)
    if (seen.has(node.path)) throw new CaptureError("duplicate-path", node.path)
    seen.add(node.path)
    if (node.kind !== "symlink" && (!Number.isInteger(node.mode) || node.mode < 0 || node.mode > 0o7777)) throw new CaptureError("invalid-node", node.path)
    if (node.kind !== "file") continue
    const bytes = await input.readFile(node.path).catch(() => { throw new CaptureError("read-failed", node.path) })
    if (!Number.isInteger(node.bytes) || node.bytes < 0 || bytes.length !== node.bytes || sha256(bytes) !== node.digest) throw new CaptureError("digest-mismatch", node.path)
    files.set(node.path, bytes)
  }
  const diagnostics: Diagnostic[] = []
  const documents = new Map<string, Record<string, unknown>>()
  const json = (path: string) => {
    const known = documents.get(path)
    if (known) return known
    const bytes = files.get(path)
    if (!bytes) { diagnostics.push({ path, code: "missing-entry", message: "Declared file is missing" }); return }
    const parsed = parseJson(bytes)
    if (!object(parsed)) { diagnostics.push({ path, code: "invalid-definition", message: "Definition is not a JSON object" }); return }
    documents.set(path, parsed)
    return parsed
  }
  const codex = input.source.ecosystem === "codex" || files.has(".codex-plugin/plugin.json") || (!files.has(".claude-plugin/plugin.json") && files.has("plugin.json"))
  const manifestPath = codex ? files.has(".codex-plugin/plugin.json") ? ".codex-plugin/plugin.json" : "plugin.json" : ".claude-plugin/plugin.json"
  const manifest = files.has(manifestPath) ? json(manifestPath) : undefined
  if (codex && files.has(".app.json")) {
    const apps = json(".app.json")
    if (object(apps?.apps)) for (const [name, app] of Object.entries(apps.apps)) {
      if (object(app) && typeof app.id === "string") diagnostics.push({ path: ".app.json", field: "/apps/" + escapePointer(name), code: "unresolved-app-id", message: "An application identifier is not an MCP definition" })
    }
  }
  const entries: Entry[] = []
  const roots = ["skills", ...declaredPaths(manifest?.skills, manifestPath, "skills", diagnostics)]
  const skillFiles = [...files.keys()].filter((path) => path === "SKILL.md" || roots.some((root) => path.startsWith(root + "/") && path.endsWith("/SKILL.md")))
  for (const path of skillFiles) {
    const instruction = decode(files.get(path)!)
    const parsed = ConfigMarkdown.parseOption(instruction)
    if (!parsed || !object(parsed.data)) { diagnostics.push({ path, code: "invalid-definition", message: "Skill frontmatter is invalid" }); continue }
    const data: Record<string, unknown> = parsed.data
    const directory = path === "SKILL.md" ? "" : path.slice(0, -"/SKILL.md".length)
    const name = string(data.name) ?? directory.split("/").at(-1) ?? input.source.entryName ?? "skill"
    entries.push({ kind: "skill", id: "skill:" + path, sourcePath: path, sourceName: name, directory, instruction: bindings(instruction), invocation: invocation(data), display: jsonRecord(data), mcpDependencies: object(data.dependencies) ? strings(data.dependencies.mcp) : [] })
  }
  const definitions: { name: string; path: string; pointer: string; value: unknown }[] = []
  const addServers = (path: string, map: Record<string, unknown>, pointer: string) => {
    const wrapped = object(map.mcpServers)
    const servers = wrapped ? map.mcpServers : map
    if (!object(servers)) return
    for (const [name, value] of Object.entries(servers)) definitions.push({ name, path, pointer: pointer + (wrapped ? "/mcpServers" : "") + "/" + escapePointer(name), value })
  }
  if (files.has(".mcp.json")) {
    const root = json(".mcp.json")
    if (root) addServers(".mcp.json", root, "")
  }
  if (object(manifest?.mcpServers)) addServers(manifestPath, manifest.mcpServers, "/mcpServers")
  for (const path of declaredPaths(manifest?.mcpServers, manifestPath, "mcpServers", diagnostics, true)) {
    const definition = json(path)
    if (definition) addServers(path, definition, "")
  }
  const unique = [...new Map(definitions.map((definition) => [definition.path + "#" + definition.pointer, definition])).values()]
  const winners = new Map(unique.map((definition) => [definition.name, definition]))
  const needs = new Map<string, SecretNeed>()
  const credentials = new Map<string, Uint8Array>()
  const changed = new Set<string>()
  for (const definition of unique) {
    const winner = winners.get(definition.name)!
    const id = "mcp:" + winner.path + "#" + definition.name
    const text = (value: string, pointer: string, sensitive = false) => credentialText(value, {
      componentId: id, file: definition.path, pointer, sensitive, needs, credentials,
      replace: (replacement) => { replacePointer(documents.get(definition.path)!, pointer, replacement); changed.add(definition.path) },
    })
    const entry = mcpEntry(definition, id, text)
    if (!entry) { diagnostics.push({ path: definition.path, field: definition.pointer, code: "invalid-definition", message: "MCP definition has invalid connection fields" }); continue }
    if (winner === definition) entries.push(entry)
  }
  const replacements = new Map<string, Uint8Array>([...changed].map((path) => [path, new TextEncoder().encode(JSON.stringify(documents.get(path), null, 2) + "\n")]))
  const tree = input.nodes.map((node): TreeNode => {
    const replacement = replacements.get(node.path)
    return node.kind === "file" && replacement ? { ...node, bytes: replacement.length, digest: sha256(replacement) } : { ...node }
  })
  return {
    package: {
      schema: "codepuppy.plugin-package.v1", provider: codex ? "codex" : !manifest && files.has("SKILL.md") ? "skill" : "claude-code",
      name: string(manifest?.name) ?? input.source.entryName ?? entries.find((entry) => entry.kind === "skill")?.sourceName ?? input.source.pluginPath?.split("/").at(-1) ?? "plugin",
      ...(typeof manifest?.version === "string" ? { version: manifest.version } : {}), ...(typeof manifest?.description === "string" ? { description: manifest.description } : {}),
      source: input.source, tree, treeDigest: sha256(new TextEncoder().encode(canonical(tree.toSorted((a, b) => a.path.localeCompare(b.path))))), entries, secrets: [...needs.values()], diagnostics,
    },
    replacements, privateCredentials: credentials,
  }
}

/** A registry definition has no plugin tree or executable installation step. */
export function convertMcpServerDefinition(server: Json, source: Source): { package: PluginPackage; privateCredentials: ReadonlyMap<string, Uint8Array> } {
  const name = (object(server) ? string(server.name) : undefined) ?? source.serverName ?? "mcp"
  const sourceName = name.split("/").at(-1)!
  const id = "mcp:server.json#" + sourceName
  const needs = new Map<string, SecretNeed>()
  const credentials = new Map<string, Uint8Array>()
  const entries: Entry[] = []
  const diagnostics: Diagnostic[] = []
  const fieldText = (field: Record<string, unknown>, pointer: string, label: string): Text => {
    const context: CredentialContext = { componentId: id, file: "server.json", pointer, sensitive: field.isSecret === true, needs, credentials, replace: () => {} }
    const value = field.value ?? field.default
    if (typeof value !== "string") return [{ secret: credentialNeed(label, context) }]
    if (!object(field.variables)) return credentialText(value, context)
    const parts: Text[number][] = []
    let offset = 0
    for (const match of value.matchAll(/\{([^{}]+)\}/g)) {
      if (match.index > offset) parts.push(...bindings(value.slice(offset, match.index)))
      const variable = field.variables[match[1]!]
      const fallback = object(variable) ? string(variable.value ?? variable.default) : undefined
      parts.push(...(fallback !== undefined ? credentialText(fallback, { ...context, sensitive: object(variable) && variable.isSecret === true }) : [{ secret: credentialNeed(match[1]!, context) }]))
      offset = match.index + match[0].length
    }
    if (!offset) return credentialText(value, context)
    if (offset < value.length) parts.push(...bindings(value.slice(offset)))
    return parts
  }
  if (object(server)) {
    for (const [index, remote] of (Array.isArray(server.remotes) ? server.remotes : []).entries()) {
      if (!object(remote) || (remote.type !== "streamable-http" && remote.type !== "sse") || typeof remote.url !== "string" || /\{[^}]+\}/.test(remote.url)) continue
      if (!URL.canParse(remote.url) || !["http:", "https:"].includes(new URL(remote.url).protocol)) continue
      if (remote.headers !== undefined && (!Array.isArray(remote.headers) || remote.headers.some((header) => !object(header) || typeof header.name !== "string"))) continue
      const headers = Object.fromEntries((Array.isArray(remote.headers) ? remote.headers as Record<string, Json>[] : []).map((header, headerIndex) => {
        const value = fieldText(header, "/remotes/" + index + "/headers/" + headerIndex + "/value", String(header.name))
        return [header.name, header.isSecret === true && String(header.name).toLowerCase() === "authorization" && header.value === undefined ? ["Bearer ", ...value] : value]
      }))
      entries.push({ kind: "mcp", id, sourcePath: "server.json", sourceName, transport: remote.type === "sse" ? "sse" : "http", url: [remote.url], headers,
        ...(!Object.keys(headers).some((key) => /authorization|token|secret|api[_-]?key|cookie/i.test(key)) && needs.size === 0 ? { oauth: mcpLogin(id, sourceName, remote.url) } : {}) })
      break
    }
    if (!entries.length) for (const [index, pkg] of (Array.isArray(server.packages) ? server.packages : []).entries()) {
      if (!object(pkg) || !["npm", "pypi", "oci"].includes(String(pkg.registryType)) || typeof pkg.identifier !== "string" || !pkg.identifier) continue
      if (!object(pkg.transport) || pkg.transport.type !== "stdio") continue
      if (pkg.registryType !== "oci" && typeof pkg.version !== "string") continue
      if (pkg.runtimeArguments !== undefined && (!Array.isArray(pkg.runtimeArguments) || pkg.runtimeArguments.some((arg) => !object(arg)))) continue
      if (pkg.environmentVariables !== undefined && (!Array.isArray(pkg.environmentVariables) || pkg.environmentVariables.some((env) => !object(env) || typeof env.name !== "string"))) continue
      const args = (Array.isArray(pkg.runtimeArguments) ? pkg.runtimeArguments as Record<string, Json>[] : []).flatMap((arg, argIndex): Text[] => [
        ...(arg.type === "named" && typeof arg.name === "string" ? [[arg.name]] : []),
        ...(arg.value !== undefined || object(arg.variables) ? [fieldText(arg, "/packages/" + index + "/runtimeArguments/" + argIndex + "/value", string(arg.name) ?? "argument")] : []),
      ])
      const command: Text[] = pkg.registryType === "oci" ? [["docker"], ["run"], ["-i"], ["--rm"], ...args, [pkg.identifier]]
        : pkg.registryType === "npm" ? [["npx"], ["-y"], ...args, [pkg.identifier + "@" + pkg.version]] : [["uvx"], ...args, [pkg.identifier + "==" + pkg.version]]
      const environment = Object.fromEntries((Array.isArray(pkg.environmentVariables) ? pkg.environmentVariables as Record<string, Json>[] : []).map((env, envIndex) => [env.name, fieldText(env, "/packages/" + index + "/environmentVariables/" + envIndex + "/value", String(env.name))]))
      entries.push({ kind: "mcp", id, sourcePath: "server.json", sourceName, transport: "stdio", command, environment })
      break
    }
  }
  if (!entries.length) diagnostics.push({ path: "server.json", code: "invalid-definition", message: "Registry definition has no expressible MCP connection" })
  return { package: { schema: "codepuppy.plugin-package.v1", provider: "mcp-registry", name: sourceName,
    ...(object(server) && typeof server.version === "string" ? { version: server.version } : {}),
    ...(object(server) && typeof server.description === "string" ? { description: server.description } : {}),
    source, tree: [], treeDigest: sha256(new TextEncoder().encode(canonical([]))), entries, secrets: [...needs.values()], diagnostics }, privateCredentials: credentials }
}

function marketplaceSource(value: unknown): MarketplaceEntry["source"] {
  if (typeof value === "string") {
    const path = value.replace(/^\.\//, "").replace(/\/$/, "")
    return validPath(path) ? { kind: "path", path } : { kind: "unsupported", detail: "Invalid marketplace path" }
  }
  if (!object(value) || (value.source !== "url" && value.source !== "git-subdir") || typeof value.url !== "string") return { kind: "unsupported", detail: "Source is not a Git repository or local path" }
  const path = typeof value.path === "string" ? value.path.replace(/^\.\//, "").replace(/\/$/, "") : undefined
  if (path !== undefined && !validPath(path)) return { kind: "unsupported", detail: "Invalid Git subdirectory" }
  return { kind: "git", url: value.url, ...(typeof value.sha === "string" ? { commit: value.sha } : {}), ...(typeof value.ref === "string" ? { ref: value.ref } : {}), ...(path === undefined ? {} : { path }) }
}

function declaredPaths(value: unknown, path: string, field: string, diagnostics: Diagnostic[], allowObject = false): string[] {
  if (value === undefined || (allowObject && object(value))) return []
  return (typeof value === "string" ? [value] : Array.isArray(value) ? value : [value]).flatMap((value): string[] => {
    const normalized = typeof value === "string" ? value.replace(/^\.\//, "").replace(/\/$/, "") : ""
    if (validPath(normalized)) return [normalized]
    diagnostics.push({ path, field, code: "invalid-definition", message: "Declared path is not a relative tree path" })
    return []
  })
}

function mcpEntry(definition: { name: string; path: string; pointer: string; value: unknown }, id: string, text: (value: string, pointer: string, sensitive?: boolean) => Text): Entry | undefined {
  const value = definition.value
  if (!object(value)) return
  const base = { kind: "mcp" as const, id, sourcePath: definition.path, sourceName: definition.name, ...(typeof value.timeout === "number" && value.timeout > 0 ? { timeoutMs: value.timeout } : {}) }
  if (typeof value.command === "string" && value.command && (value.type === undefined || value.type === "stdio")) {
    if (value.args !== undefined && (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === "string"))) return
    if (value.env !== undefined && !stringMap(value.env)) return
    if (value.cwd !== undefined && typeof value.cwd !== "string") return
    const command = [value.command, ...strings(value.args)]
    const commandIndex = ["npx", "uvx"].includes(value.command) ? command.findIndex((arg, index) => index > 0 && !arg.startsWith("-")) : -1
    const token = command[commandIndex]
    return {
      ...base, transport: "stdio", command: command.map((part) => bindings(part)),
      environment: Object.fromEntries(Object.entries(stringMap(value.env) ? value.env : {}).map(([key, part]) => [key, text(part, definition.pointer + "/env/" + escapePointer(key), /token|secret|password|api[_-]?key/i.test(key))])),
      ...(typeof value.cwd === "string" ? { cwd: bindings(value.cwd) } : {}),
      ...(token && !/@\d/.test(token) ? { floatingVersion: { commandIndex, token } } : {}),
    }
  }
  if (typeof value.url !== "string" || !value.url || (value.type !== undefined && value.type !== "http" && value.type !== "sse")) return
  if (value.headers !== undefined && !stringMap(value.headers)) return
  const headers = Object.fromEntries(Object.entries(stringMap(value.headers) ? value.headers : {}).map(([key, part]) => [key, text(part, definition.pointer + "/headers/" + escapePointer(key), /authorization|token|secret|api[_-]?key|cookie/i.test(key))]))
  const oauth = object(value.oauth) ? value.oauth : undefined
  const login: LoginNeed = {
    ...mcpLogin(id, definition.name, value.url),
    ...(oauth || typeof value.oauth_resource === "string" ? { oauth: {
      ...(typeof (oauth?.clientId ?? oauth?.client_id) === "string" ? { clientId: String(oauth?.clientId ?? oauth?.client_id) } : {}),
      ...(typeof (oauth?.clientSecret ?? oauth?.client_secret) === "string" ? { clientSecret: text(String(oauth?.clientSecret ?? oauth?.client_secret), definition.pointer + (typeof oauth?.clientSecret === "string" ? "/oauth/clientSecret" : "/oauth/client_secret"), true) } : {}),
      ...(Array.isArray(oauth?.scopes ?? value.scopes) ? { scopes: strings(oauth?.scopes ?? value.scopes) } : {}),
      ...(typeof (oauth?.resource ?? value.oauth_resource) === "string" ? { resource: String(oauth?.resource ?? value.oauth_resource) } : {}),
      ...(typeof oauth?.authorizationServerUrl === "string" ? { authorizationServerUrl: oauth.authorizationServerUrl } : {}),
    } } : {}),
  }
  return { ...base, transport: value.type === "sse" ? "sse" : "http", url: bindings(value.url), headers, ...(value.oauth === false ? { oauth: false } : !Object.keys(headers).some((key) => /authorization|token|secret|api[_-]?key|cookie/i.test(key)) || oauth ? { oauth: login } : {}) }
}

function mcpLogin(componentId: string, serviceId: string, serverUrl: string): LoginNeed {
  return { id: "login_" + sha256(new TextEncoder().encode(componentId)).slice(7, 23), componentId, kind: "mcp-oauth", required: false, serviceId, serverUrl }
}

type CredentialContext = { componentId: string; file: string; pointer: string; sensitive: boolean; needs: Map<string, SecretNeed>; credentials: Map<string, Uint8Array>; replace(value: string): void }

function credentialNeed(label: string, context: CredentialContext, literal?: string): string {
  const id = "need_" + sha256(new TextEncoder().encode(context.componentId + "\0" + label)).slice(7, 23)
  const existing = context.needs.get(id) ?? { id, componentId: context.componentId, label, targets: [] }
  if (!existing.targets.some((target) => target.file === context.file && target.pointer === context.pointer)) existing.targets.push({ file: context.file, pointer: context.pointer })
  context.needs.set(id, existing)
  if (literal !== undefined) context.credentials.set(id, new TextEncoder().encode(literal))
  return id
}

function credentialText(value: string, context: CredentialContext): Text {
  const need = (label: string, literal?: string) => credentialNeed(label, context, literal)
  const pieces: Text[number][] = []
  let offset = 0
  for (const match of value.matchAll(/\$\{([A-Za-z_][\w]*)(?::-[^}]*)?\}|\$([A-Za-z_][\w]*)|\{([A-Za-z_][\w]*)\}|<([A-Za-z_][\w]*)>/g)) {
    const label = match[1] ?? match[2] ?? match[3] ?? match[4]!
    if (bindingName(label) || ["PATH", "HOME", "USER", "TMPDIR"].includes(label)) continue
    if (match.index > offset) pieces.push(...bindings(value.slice(offset, match.index)))
    pieces.push({ secret: need(label) })
    offset = match.index + match[0].length
  }
  if (!pieces.length && context.sensitive && value) {
    const prefix = value.match(/^(Bearer |Basic )/i)?.[0] ?? ""
    const id = need(context.pointer.split("/").at(-1)!, value.slice(prefix.length))
    context.replace(prefix + "{secret:" + id + "}")
    return [...(prefix ? [prefix] : []), { secret: id }]
  }
  if (!pieces.length) return bindings(value)
  if (offset < value.length) pieces.push(...bindings(value.slice(offset)))
  context.replace(pieces.map((part) => typeof part === "string" ? part : "secret" in part ? "{secret:" + part.secret + "}" : "$" + "{" + (part.binding === "pluginRoot" ? "CLAUDE_PLUGIN_ROOT" : part.binding === "skillDir" ? "CLAUDE_SKILL_DIR" : "CLAUDE_PROJECT_DIR") + "}").join(""))
  return pieces
}

function invocation(data: Record<string, unknown>): Invocation {
  return {
    fork: data.context === "fork", userInvocable: data["user-invocable"] !== false, implicitInvocation: data["disable-model-invocation"] !== true && data.allow_implicit_invocation !== false,
    allowedTools: toolRules(data["allowed-tools"]), deniedTools: toolRules(data["disallowed-tools"]),
    ...(data.tools === undefined ? {} : { availableTools: toolRules(data.tools) }),
    ...(typeof data.model === "string" ? { model: { alias: data.model } } : {}),
    ...(typeof data.agent === "string" ? { agent: data.agent } : {}),
    ...(typeof data["argument-hint"] === "string" ? { argumentHint: data["argument-hint"] } : {}),
  }
}

function toolRules(value: unknown): ToolRule[] {
  return strings(value).map((value) => {
    const match = value.match(/^([^()]+)\((.*)\)$/)
    return match ? { tool: match[1]!, pattern: match[2]! } : { tool: value }
  })
}
function strings(value: unknown): string[] { return typeof value === "string" ? value.split(/,\s*|\s+/).filter(Boolean) : Array.isArray(value) ? value.filter((part): part is string => typeof part === "string") : [] }
function bindings(value: string): Text {
  const parts: Text[number][] = []
  let offset = 0
  for (const match of value.matchAll(/\$\{(CLAUDE_PLUGIN_ROOT|CLAUDE_SKILL_DIR|CLAUDE_PROJECT_DIR)\}/g)) {
    if (match.index > offset) parts.push(value.slice(offset, match.index))
    parts.push({ binding: bindingName(match[1]!)! })
    offset = match.index + match[0].length
  }
  if (offset < value.length) parts.push(value.slice(offset))
  return parts.length ? parts : [value]
}
function bindingName(value: string): "pluginRoot" | "skillDir" | "projectDir" | undefined { return value === "CLAUDE_PLUGIN_ROOT" ? "pluginRoot" : value === "CLAUDE_SKILL_DIR" ? "skillDir" : value === "CLAUDE_PROJECT_DIR" ? "projectDir" : undefined }
function validPath(value: string): boolean { return !!value && !value.includes("\0") && !value.includes("\\") && !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && value.split("/").every((part) => !!part && part !== "." && part !== "..") }
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function string(value: unknown): string | undefined { return typeof value === "string" ? value : undefined }
function stringMap(value: unknown): value is Record<string, string> { return object(value) && Object.values(value).every((part) => typeof part === "string") }
function decode(bytes: Uint8Array): string { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "") }
function parseJson(bytes: Uint8Array): unknown { try { return JSON.parse(decode(bytes)) } catch { return undefined } }
function jsonRecord(value: Record<string, unknown>): Record<string, Json> { return JSON.parse(JSON.stringify(value)) as Record<string, Json> }
function sha256(bytes: Uint8Array): Sha256 { return ("sha256:" + createHash("sha256").update(bytes).digest("hex")) as Sha256 }
function canonical(value: unknown): string { return JSON.stringify(value, (_key, item: unknown) => object(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item) }
function escapePointer(value: string): string { return value.replaceAll("~", "~0").replaceAll("/", "~1") }
function replacePointer(root: Record<string, unknown>, pointer: string, replacement: string): void {
  const keys = pointer.slice(1).split("/").map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"))
  const target = keys.slice(0, -1).reduce<unknown>((node, key) => object(node) ? node[key] : undefined, root)
  if (object(target)) target[keys.at(-1)!] = replacement
}
