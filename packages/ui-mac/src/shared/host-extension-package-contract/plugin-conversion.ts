import { UNAVAILABLE_PLUGIN_HOOKS } from "./plugin-hook-events"
import { PLUGIN_HOOK_EVENTS, pluginRelativePath, pluginText, renderPluginText, pluginOptionEnvironmentName, pluginTreeDigest } from "./plugin-package"
import { createHash } from "node:crypto"
import { parse, type ParseError } from "jsonc-parser/lib/esm/main.js"
import { ConfigMarkdown } from "@opencode/core/config/markdown"

export type { Sha256, RelPath, Json, Source, Provider, TreeNode, Capture, Text, ToolRule, ModelHint, ArgumentSyntax, SkillDisplay, McpToolDependency, Invocation, SecretNeed, LoginNeed, HookEvent, Hook, Entry, Diagnostic, PluginPackage, MarketplaceEntry } from "./plugin-package"
import type { Sha256, RelPath, Json, Source, TreeNode, Capture, Text, ToolRule, Invocation, McpToolDependency, SkillDisplay, ArgumentSyntax, SecretNeed, LoginNeed, HookEvent, Hook, Entry, Diagnostic, PluginPackage, MarketplaceEntry } from "./plugin-package"

export class CaptureError extends Error {
  constructor(readonly code: "invalid-path" | "duplicate-path" | "invalid-node" | "read-failed" | "digest-mismatch", readonly path: string) {
    super("Plugin capture " + code + ": " + path)
  }
}

/** Read Markdown metadata while retaining the original Text nodes for invocation-time binding. */
export function pluginInstructionDefinition(instruction: Text): { body: Text; description?: string } {
  const source = instruction.map(part => typeof part === "string" ? part : "").join("")
  const parsed = ConfigMarkdown.parseOption(source)
  let header = parsed ? source.length - parsed.content.length : 0
  const body = instruction.flatMap(part => {
    if (!header) return [part]
    if (typeof part !== "string") return []
    const rest = part.slice(header)
    header = Math.max(0, header - part.length)
    return rest ? [rest] : []
  })
  return { body, ...(typeof parsed?.data.description === "string" ? { description: parsed.data.description } : {}) }
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
    if (!pluginRelativePath(node.path)) throw new CaptureError("invalid-path", node.path)
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
    const parsed = (() => { try { return parseJson(bytes, path.endsWith(".jsonc")) } catch { diagnostics.push({ path, code: "invalid-definition", message: "JSON definition could not be parsed" }); return undefined } })()
    if (!object(parsed)) { diagnostics.push({ path, code: "invalid-definition", message: "Definition is not a JSON object" }); return }
    documents.set(path, parsed)
    return parsed
  }
  const portable = files.has("plugin.json") ? json("plugin.json") : undefined
  const claude = files.has(".claude-plugin/plugin.json") ? json(".claude-plugin/plugin.json") : undefined
  const codexManifest = files.has(".codex-plugin/plugin.json") ? json(".codex-plugin/plugin.json") : undefined
  const opencode = input.source.ecosystem === "opencode" || (!input.source.ecosystem && !portable && !claude && !codexManifest && ([...files.keys()].some(path => /^(?:\.opencode\/|opencode\.jsonc?$)/.test(path)) || files.has("package.json")))
  const codex = !opencode && (input.source.ecosystem === "codex" || (!input.source.ecosystem && (!!portable || !claude && !!codexManifest)))
  const manifestPath = opencode ? "package.json" : codex ? portable ? "plugin.json" : ".codex-plugin/plugin.json" : ".claude-plugin/plugin.json"
  const primary = opencode ? files.has("package.json") ? json("package.json") : undefined : codex ? portable ?? codexManifest : claude
  const secondary = opencode ? undefined : codex ? portable ? claude : undefined : portable
  const manifest = primary || secondary ? { ...secondary, ...primary } : undefined
  const manifests = [{ path: codex ? ".claude-plugin/plugin.json" : "plugin.json", value: secondary }, { path: manifestPath, value: primary }].filter(item => !!item.value)
  const options: Record<string, import("./plugin-package").PluginOption> = Object.create(null)
  const optionNeeds = new Map<string, SecretNeed>()
  const optionCredentials = new Map<string, Uint8Array>()
  const optionChanged = new Set<string>()
  for (const source of manifests) if (object(source.value?.userConfig)) for (const [key, value] of Object.entries(source.value.userConfig)) {
    if (!object(value) || !["string", "number", "boolean"].includes(String(value.type)) || value.default !== undefined && (typeof value.default !== value.type || typeof value.default === "number" && !Number.isFinite(value.default))) {
      diagnostics.push({ path: source.path, field: "/userConfig/" + escapePointer(key), code: "invalid-definition", message: "Invalid plugin option type or default" }); continue
    }
    const secret = value.sensitive === true ? credentialNeed(key, { componentId: "$package", file: source.path, pointer: "/userConfig/" + escapePointer(key) + "/default", sensitive: true, needs: optionNeeds, credentials: optionCredentials, replace: () => {} }, value.default === undefined ? undefined : String(value.default)) : undefined
    options[key] = { type: value.type as "string" | "number" | "boolean", title: string(value.title) ?? key, description: string(value.description) ?? "", required: value.required === true, sensitive: value.sensitive === true, ...(value.default === undefined ? {} : { default: secret ? { secret } : value.default as string | number | boolean }) }
    if (secret && value.default !== undefined) { replacePointer(documents.get(source.path)!, "/userConfig/" + escapePointer(key) + "/default", "{secret:" + secret + "}"); optionChanged.add(source.path) }
  }
  const optionEnvironment = new Map<string, string[]>()
  for (const key of Object.keys(options)) {
    const name = pluginOptionEnvironmentName(key)
    optionEnvironment.set(name, [...(optionEnvironment.get(name) ?? []), key])
  }
  for (const [name, keys] of optionEnvironment) if (keys.length > 1) diagnostics.push({ path: manifestPath, field: "/userConfig", code: "invalid-definition", message: "Plugin option environment name is ambiguous: " + name })
  if (codex && files.has(".app.json")) {
    const apps = json(".app.json")
    if (object(apps?.apps)) for (const [name, app] of Object.entries(apps.apps)) {
      if (object(app) && typeof app.id === "string") diagnostics.push({ path: ".app.json", field: "/apps/" + escapePointer(name), code: "unresolved-app-id", message: "An application identifier is not an MCP definition" })
    }
  }
  const entries: Entry[] = []
  const scopedHooks: { path: string; value: unknown; scope: Hook["scope"] }[] = []
  const dependencyDefinitions: { name: string; path: string; pointer: string; value: unknown }[] = []
  const roots = opencode ? ["skills", "skill", ".opencode/skills", ".opencode/skill"] : ["skills", ...manifests.flatMap(item => declaredPaths(item.value?.skills, item.path, "skills", diagnostics))]
  const loose = !manifest && !opencode ? [...files.keys()].filter(path => /^[^/]+\/SKILL\.md$/.test(path)) : []
  const skillFiles = [...files.keys()].filter((path) => path === "SKILL.md" || (loose.length === 1 && path === loose[0]) || roots.some((root) => path.startsWith(root + "/") && path.endsWith("/SKILL.md")))
  for (const path of skillFiles) {
    const instruction = decode(files.get(path)!)
    const parsed = ConfigMarkdown.parseOption(instruction)
    if (!parsed || !object(parsed.data)) { diagnostics.push({ path, code: "invalid-definition", message: "Skill frontmatter is invalid" }); continue }
    const data: Record<string, unknown> = parsed.data
    const directory = path === "SKILL.md" ? "" : path.slice(0, -"/SKILL.md".length)
    const name = string(data.name) ?? directory.split("/").at(-1) ?? input.source.entryName ?? "skill"
    const sidecarPath = (directory ? directory + "/" : "") + "agents/openai.yaml"
    const sidecar = codex && files.has(sidecarPath) ? ConfigMarkdown.parseOption("---\n" + decode(files.get(sidecarPath)!) + "\n---") : undefined
    if (codex && files.has(sidecarPath) && !sidecar) diagnostics.push({ path: sidecarPath, code: "invalid-definition", message: "Skill YAML could not be parsed" })
    const yaml: Record<string, unknown> = sidecar?.data ?? {}
    const policy = object(yaml.policy) ? yaml.policy : {}
    const dependencies: McpToolDependency[] = object(yaml.dependencies) && Array.isArray(yaml.dependencies.tools) ? yaml.dependencies.tools.flatMap((value): McpToolDependency[] => {
      if (!object(value) || value.type !== "mcp" || typeof value.value !== "string") return []
      const transport = value.transport === "sse" ? "sse" : value.transport === "stdio" ? "stdio" : ["http", "streamable_http", "streamable-http"].includes(String(value.transport)) ? "http" : undefined
      if (typeof value.url === "string" && transport !== "stdio") dependencyDefinitions.push({ name: value.value, path: sidecarPath, pointer: "/dependencies/tools", value: { type: transport ?? "http", url: value.url } })
      return [{ type: "mcp", value: value.value, ...(typeof value.description === "string" ? { description: value.description } : {}), ...(transport ? { transport } : {}), ...(typeof value.url === "string" ? { url: pluginText(value.url) } : {}) }]
    }) : []
    const display: SkillDisplay = typeof data.description === "string" ? { shortDescription: data.description } : {}
    if (object(yaml.interface)) for (const [source, target] of [["display_name", "displayName"], ["short_description", "shortDescription"], ["icon_small", "iconSmall"], ["icon_large", "iconLarge"], ["brand_color", "brandColor"], ["default_prompt", "defaultPrompt"]] as const) {
      const value = yaml.interface[source]
      if (typeof value !== "string") continue
      if (source.startsWith("icon_") && !pluginRelativePath(value.replace(/^\.\//, ""))) { diagnostics.push({ path: sidecarPath, field: "interface/" + source, code: "invalid-definition", message: "Skill icon must be relative to its skill directory" }); continue }
      display[target] = source.startsWith("icon_") ? value.replace(/^\.\//, "") : value
    }
    if (data.hooks !== undefined) scopedHooks.push({ path, value: data.hooks, scope: { kind: "skill", entryId: "skill:" + path } })
    entries.push({ kind: "skill", id: "skill:" + path, sourcePath: path, sourceName: name, directory, instruction: pluginText(instruction, "instruction"), invocation: invocation({ ...data, allow_implicit_invocation: data.allow_implicit_invocation === false || policy.allow_implicit_invocation === false ? false : true }, opencode ? "opencode" : codex ? "literal" : "claude", path, diagnostics), display, dependencies, mcpDependencies: [...new Set([...dependencies.map(item => item.value), ...(object(data.dependencies) ? strings(data.dependencies.mcp) : [])])] })
  }
  const definitions: { name: string; path: string; pointer: string; value: unknown }[] = []
  const addServers = (path: string, map: Record<string, unknown>, pointer: string) => {
    const wrapped = object(map.mcpServers)
    const servers = wrapped ? map.mcpServers : map
    if (!object(servers)) return
    for (const [name, value] of Object.entries(servers)) definitions.push({ name, path, pointer: pointer + (wrapped ? "/mcpServers" : "") + "/" + escapePointer(name), value })
  }
  for (const path of ["mcp.json", ".mcp.json"]) if (files.has(path)) { const root = json(path); if (root) addServers(path, root, "") }
  for (const item of manifests) {
    if (object(item.value?.mcpServers)) addServers(item.path, item.value.mcpServers, "/mcpServers")
    const extension = object(item.value?.extensions) && object(item.value.extensions["com.openai"]) ? item.value.extensions["com.openai"] : undefined
    for (const path of [...declaredPaths(item.value?.mcpServers, item.path, "mcpServers", diagnostics, true), ...declaredPaths(extension?.mcpServers, item.path, "extensions/com.openai/mcpServers", diagnostics, true)]) {
      const definition = json(path); if (definition) addServers(path, definition, "")
    }
  }
  if (opencode) {
    for (const path of ["opencode.json", "opencode.jsonc", ".opencode/opencode.json", ".opencode/opencode.jsonc"]) {
      if (!files.has(path)) continue
      const config = json(path)
      if (object(config?.mcp)) for (const [name, value] of Object.entries(config.mcp)) definitions.push({ name, path, pointer: "/mcp/" + escapePointer(name), value })
    }
    const modules = new Map([...files.keys()].filter((path) => /^(?:\.opencode\/)?plugins?\/.+\.(?:js|mjs|cjs|ts)$/.test(path)).map((path) => [path, path.split("/").at(-1)!.replace(/\.[^.]+$/, "")]))
    const exports = object(manifest?.exports) ? manifest.exports["."] : undefined
    const declared = [manifest?.main, ...(object(exports) ? [exports.import, exports.default] : [exports])]
    for (const entry of declared) {
      if (typeof entry !== "string") continue
      const path = entry.replace(/^\.\//, "")
      if (!pluginRelativePath(path)) { diagnostics.push({ path: "package.json", code: "invalid-definition", message: "Native module entry is not a relative tree path" }); continue }
      if (!files.has(path)) { diagnostics.push({ path, code: "missing-entry", message: "Native module entry is missing" }); continue }
      modules.set(path, string(manifest?.name) ?? path.split("/").at(-1)!.replace(/\.[^.]+$/, ""))
    }
    for (const [path, sourceName] of modules) diagnostics.push({ code: "native-js-plugin", path, sourceName, message: "Code Puppy does not run third-party native plugin code" })
  }
  for (const [path, bytes] of files) {
    const match = path.match(opencode ? /^(?:\.opencode\/)?(agent|command)\/(.+)\.md$/ : /^(agents|commands)\/(.+)\.md$/)
    if (!match) continue
    const instruction = decode(bytes)
    const parsed = ConfigMarkdown.parseOption(instruction)
    if (!parsed) { diagnostics.push({ path, code: "invalid-definition", message: "Markdown definition is invalid" }); continue }
    const kind = match[1]!.startsWith("agent") ? "agent" : "command"
    if (kind === "agent" && parsed.data.hooks !== undefined) scopedHooks.push({ path, value: parsed.data.hooks, scope: { kind, entryId: kind + ":" + path } })
    entries.push({ kind, id: kind + ":" + path, sourcePath: path, sourceName: match[2]!, instruction: pluginText(instruction, "instruction"), invocation: invocation(parsed.data, kind === "agent" ? "literal" : opencode ? "opencode" : codex ? "codex" : "claude", path, diagnostics) })
  }
  const hookFiles = new Set<string>()
  let hookOrder = 0
  const addHooks = (path: string, value: unknown, scope: Hook["scope"]): void => {
    if (typeof value === "string") {
      const file = value.replace(/^\.\//, "")
      if (!pluginRelativePath(file)) { diagnostics.push({ path, code: "invalid-definition", message: "Hook file must be package-relative" }); return }
      const key = JSON.stringify([file, scope])
      if (hookFiles.has(key)) return
      hookFiles.add(key)
      addHooks(file, json(file), scope)
      return
    }
    if (Array.isArray(value)) { for (const item of value) addHooks(path, item, scope); return }
    if (!object(value)) { diagnostics.push({ path, code: "invalid-definition", message: "Hook definition must be an object" }); return }
    if (value.modules !== undefined) diagnostics.push({ path, code: "unsupported-host-capability", message: "In-process Claude hook modules require the Claude UI host" })
    const events = object(value.hooks) ? value.hooks : value
    for (const [name, groups] of Object.entries(events)) {
      if (name === "modules" || name === "description") continue
      const event = PLUGIN_HOOK_EVENTS.find(event => event === name)
      if (!event || !Array.isArray(groups)) { diagnostics.push({ path, sourceName: name, code: "invalid-definition", message: "Hook event definition is invalid" }); continue }
      for (const [groupIndex, group] of groups.entries()) {
        if (!object(group) || !Array.isArray(group.hooks)) { diagnostics.push({ path, sourceName: name, code: "invalid-definition", message: "Hook group is invalid" }); continue }
        for (const [index, handler] of group.hooks.entries()) {
          const invalid = (message: string) => diagnostics.push({ path, sourceName: name, code: "invalid-definition", message })
          if (!object(handler) || !["command", "prompt"].includes(String(handler.type))) { diagnostics.push({ path, sourceName: name, code: "unsupported-host-capability", message: "Hook handler protocol is unsupported" }); continue }
          if (handler.timeout !== undefined && (typeof handler.timeout !== "number" || !Number.isFinite(handler.timeout) || handler.timeout <= 0)) { invalid("Hook timeout must be positive"); continue }
          const base = { event, ...(typeof group.matcher === "string" ? { matcher: group.matcher } : {}), ...(typeof handler.if === "string" ? { if: handler.if } : {}), timeoutSeconds: typeof handler.timeout === "number" ? handler.timeout : handler.type === "prompt" ? 30 : 600, onFailure: handler.onFailure === "block" ? "block" as const : "continue" as const, order: hookOrder++, scope }
          const id = "hook:" + path + "#" + (scope.kind === "package" ? "" : scope.entryId + "/") + event + "/" + groupIndex + "/" + index
          if (handler.type === "command") {
            if (typeof handler.command !== "string" || handler.args !== undefined && (!Array.isArray(handler.args) || !handler.args.every(arg => typeof arg === "string"))) { invalid("Hook command or arguments are invalid"); continue }
            entries.push({ kind: "hook", id, sourcePath: path, sourceName: event, hook: { ...base, type: "command", command: pluginText(handler.command), ...(Array.isArray(handler.args) ? { args: handler.args.map(arg => pluginText(String(arg))) } : {}), async: handler.async === true, asyncRewake: handler.asyncRewake === true } })
          }
          if (handler.type === "prompt") {
            if (!["PreToolUse", "PermissionRequest", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "UserPromptSubmit", "UserPromptExpansion", "Stop", "SubagentStop", "PermissionDenied", "TaskCreated", "TaskCompleted", "TeammateIdle"].includes(event)) { diagnostics.push({ path, sourceName: name, code: "unsupported-host-capability", message: "Prompt hooks have no source protocol for this event" }); continue }
            if (typeof handler.prompt !== "string") { invalid("Hook prompt is missing"); continue }
            entries.push({ kind: "hook", id, sourcePath: path, sourceName: event, hook: { ...base, type: "prompt", prompt: pluginText(handler.prompt, "instruction"), ...(sourceModel(handler.model) ? { model: sourceModel(handler.model) } : {}), continueOnBlock: handler.continueOnBlock === true } })
          }
          if (Object.hasOwn(UNAVAILABLE_PLUGIN_HOOKS, event)) diagnostics.push({ path, sourceName: name, code: "unavailable-trigger", message: UNAVAILABLE_PLUGIN_HOOKS[event as keyof typeof UNAVAILABLE_PLUGIN_HOOKS] })
        }
      }
    }
  }
  if (!opencode) {
    if (files.has("hooks/hooks.json")) addHooks("hooks/hooks.json", "hooks/hooks.json", { kind: "package" })
    for (const item of manifests) if (item.value?.hooks !== undefined) addHooks(item.path, item.value.hooks, { kind: "package" })
    for (const source of scopedHooks) addHooks(source.path, source.value, source.scope)
    const monitorSources = manifests.flatMap(item => object(item.value?.experimental) && item.value.experimental.monitors !== undefined ? [{ path: item.path, value: item.value.experimental.monitors }] : [])
    if (!monitorSources.length && files.has("monitors/monitors.json")) monitorSources.push({ path: "monitors/monitors.json", value: "monitors/monitors.json" })
    const monitors = new Map<string, Extract<Entry, { kind: "monitor" }>>()
    for (const source of monitorSources) {
      const path = typeof source.value === "string" ? source.value.replace(/^\.\//, "") : source.path
      if (!pluginRelativePath(path)) { diagnostics.push({ path: source.path, code: "invalid-definition", message: "Monitor file must be package-relative" }); continue }
      if (typeof source.value === "string" && !files.has(path)) { diagnostics.push({ path, code: "missing-entry", message: "Declared monitor file is missing" }); continue }
      const values: unknown = typeof source.value === "string" ? (() => { try { return parseJson(files.get(path)!, false) } catch { return undefined } })() : source.value
      if (!Array.isArray(values)) { diagnostics.push({ path, code: "invalid-definition", message: "Monitor definition must be an array" }); continue }
      for (const value of values) {
        if (!object(value) || typeof value.name !== "string" || !value.name || typeof value.description !== "string" || typeof value.command !== "string" || value.when !== undefined && value.when !== "always" && (typeof value.when !== "string" || !/^on-skill-invoke:.+/.test(value.when))) { diagnostics.push({ path, code: "invalid-definition", message: "Monitor name, command, description or trigger is invalid" }); continue }
        monitors.set(value.name, { kind: "monitor", id: "monitor:" + path + "#" + value.name, sourcePath: path, sourceName: value.name, command: pluginText(value.command), description: value.description, when: typeof value.when === "string" && value.when.startsWith("on-skill-invoke:") ? { kind: "skill", sourceName: value.when.slice("on-skill-invoke:".length) } : { kind: "always" } })
      }
    }
    entries.push(...monitors.values())
  }
  definitions.push(...dependencyDefinitions.filter(item => !definitions.some(existing => existing.name === item.name)))
  const unique = [...new Map(definitions.map((definition) => [definition.path + "#" + definition.pointer, definition])).values()]
  const winners = new Map(unique.map((definition) => [definition.name, definition]))
  const needs = optionNeeds
  const credentials = optionCredentials
  const changed = optionChanged
  for (const definition of unique) {
    const winner = winners.get(definition.name)!
    const id = "mcp:" + definition.name
    const text = (value: string, pointer: string, sensitive = false) => credentialText(value, {
      componentId: id, file: definition.path, pointer, sensitive, needs, credentials,
      replace: (replacement) => { replacePointer(documents.get(definition.path)!, pointer, replacement); changed.add(definition.path) },
    })
    const entry = mcpEntry(definition, id, text)
    if (!entry) { diagnostics.push({ path: definition.path, field: definition.pointer, code: "invalid-definition", message: "MCP definition has invalid connection fields" }); continue }
    if (winner === definition) entries.push(entry)
  }
  for (const [file, document] of documents) {
    const visit = (value: unknown, pointer: string) => {
      if (typeof value === "string") for (const part of pluginText(value)) {
        if (typeof part === "string" || !("option" in part) || !options[part.option]?.sensitive) continue
        credentialNeed(part.option, { componentId: "$package", file, pointer, sensitive: true, needs, credentials, replace: () => {} })
      }
      if (Array.isArray(value)) value.forEach((child, index) => visit(child, pointer + "/" + index))
      else if (object(value)) for (const [key, child] of Object.entries(value)) visit(child, pointer + "/" + escapePointer(key))
    }
    visit(document, "")
  }
  const replacements = new Map<string, Uint8Array>([...changed].map((path) => [path, new TextEncoder().encode(JSON.stringify(documents.get(path), null, 2) + "\n")]))
  const tree = input.nodes.map((node): TreeNode => {
    const replacement = replacements.get(node.path)
    return node.kind === "file" && replacement ? { ...node, bytes: replacement.length, digest: sha256(replacement) } : { ...node }
  })
  return {
    package: {
      schema: "codepuppy.plugin-package.v1", provider: opencode ? "opencode" : codex ? "codex" : !manifest && files.has("SKILL.md") ? "skill" : "claude-code",
      name: string(manifest?.name) ?? input.source.entryName ?? entries.find((entry) => entry.kind === "skill")?.sourceName ?? input.source.pluginPath?.split("/").at(-1) ?? "plugin",
      ...(typeof (manifest?.version ?? input.source.version) === "string" ? { version: String(manifest?.version ?? input.source.version) } : {}), ...(typeof manifest?.description === "string" ? { description: manifest.description } : {}),
      source: input.source, tree, treeDigest: pluginTreeDigest(tree), entries, secrets: [...needs.values()], options, defaults: {}, diagnostics,
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
      if (match.index > offset) parts.push(...pluginText(value.slice(offset, match.index)))
      const variable = field.variables[match[1]!]
      const fallback = object(variable) ? string(variable.value ?? variable.default) : undefined
      parts.push(...(fallback !== undefined ? credentialText(fallback, { ...context, sensitive: object(variable) && variable.isSecret === true }) : [{ secret: credentialNeed(match[1]!, context) }]))
      offset = match.index + match[0].length
    }
    if (!offset) return credentialText(value, context)
    if (offset < value.length) parts.push(...pluginText(value.slice(offset)))
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
    source, tree: [], treeDigest: pluginTreeDigest([]), entries, secrets: [...needs.values()], diagnostics }, privateCredentials: credentials }
}

function marketplaceSource(value: unknown): MarketplaceEntry["source"] {
  if (typeof value === "string") {
    const path = value === "." || value === "./" ? "." : value.replace(/^\.\//, "").replace(/\/$/, "")
    return path === "." || pluginRelativePath(path) ? { kind: "path", path } : { kind: "unsupported", detail: "Invalid marketplace path" }
  }
  if (!object(value) || (value.source !== "url" && value.source !== "git-subdir") || typeof value.url !== "string") return { kind: "unsupported", detail: "Source is not a Git repository or local path" }
  const path = typeof value.path === "string" ? value.path.replace(/^\.\//, "").replace(/\/$/, "") : undefined
  if (path !== undefined && !pluginRelativePath(path)) return { kind: "unsupported", detail: "Invalid Git subdirectory" }
  return { kind: "git", url: value.url, ...(typeof value.sha === "string" ? { commit: value.sha } : {}), ...(typeof value.ref === "string" ? { ref: value.ref } : {}), ...(path === undefined ? {} : { path }) }
}

function declaredPaths(value: unknown, path: string, field: string, diagnostics: Diagnostic[], allowObject = false): string[] {
  if (value === undefined || (allowObject && object(value))) return []
  return (typeof value === "string" ? [value] : Array.isArray(value) ? value : [value]).flatMap((value): string[] => {
    const normalized = typeof value === "string" ? value.replace(/^\.\//, "").replace(/\/$/, "") : ""
    if (pluginRelativePath(normalized)) return [normalized]
    diagnostics.push({ path, field, code: "invalid-definition", message: "Declared path is not a relative tree path" })
    return []
  })
}

function mcpEntry(definition: { name: string; path: string; pointer: string; value: unknown }, id: string, text: (value: string, pointer: string, sensitive?: boolean) => Text): Entry | undefined {
  const value = definition.value
  if (!object(value)) return
  const base = { kind: "mcp" as const, id, sourcePath: definition.path, sourceName: definition.name, ...(typeof value.timeout === "number" && value.timeout > 0 ? { timeoutMs: value.timeout } : {}), ...((typeof value.startup_timeout_sec === "number" || typeof value.tool_timeout_sec === "number") ? { timeouts: { ...(typeof value.startup_timeout_sec === "number" ? { startupMs: value.startup_timeout_sec * 1000 } : {}), ...(typeof value.tool_timeout_sec === "number" ? { executionMs: value.tool_timeout_sec * 1000 } : {}) } } : {}) }
  if ((value.type === "local" && Array.isArray(value.command)) || (typeof value.command === "string" && value.command && (value.type === undefined || value.type === "stdio"))) {
    if (Array.isArray(value.command) && (!value.command.length || !value.command.every((arg) => typeof arg === "string"))) return
    if (value.args !== undefined && (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === "string"))) return
    const environment = value.type === "local" ? value.environment : value.env
    if (environment !== undefined && !stringMap(environment)) return
    if (value.cwd !== undefined && typeof value.cwd !== "string") return
    const command = Array.isArray(value.command) ? strings(value.command) : [String(value.command), ...strings(value.args)]
    const commandIndex = ["npx", "uvx"].includes(command[0]!) ? command.findIndex((arg, index) => index > 0 && !arg.startsWith("-")) : -1
    const token = command[commandIndex]
    return {
      ...base, transport: "stdio", command: command.map((part, index) => text(part, definition.pointer + (Array.isArray(value.command) ? "/command/" + index : index === 0 ? "/command" : "/args/" + (index - 1)))),
      environment: Object.fromEntries(Object.entries(stringMap(environment) ? environment : {}).map(([key, part]) => [key, text(part, definition.pointer + (value.type === "local" ? "/environment/" : "/env/") + escapePointer(key), /token|secret|password|api[_-]?key/i.test(key))])),
      forwardEnvironment: Array.isArray(value.env_vars) ? value.env_vars.flatMap(item => typeof item === "string" ? [{ name: item, source: "local" as const }] : object(item) && typeof item.name === "string" && (item.source === "local" || item.source === "remote") ? [{ name: item.name, source: item.source }] : []) : [],
      ...(typeof value.cwd === "string" ? { cwd: pluginText(value.cwd) } : {}),
      ...(token && !/@\d/.test(token) ? { floatingVersion: { commandIndex, token } } : {}),
    }
  }
  if (typeof value.url !== "string" || !value.url || (value.type !== undefined && value.type !== "http" && value.type !== "sse" && value.type !== "remote" && value.type !== "streamable-http" && value.type !== "streamable_http")) return
  if (value.headers !== undefined && !stringMap(value.headers)) return
  const headers = Object.fromEntries(Object.entries(stringMap(value.headers) ? value.headers : {}).map(([key, part]) => [key, text(part, definition.pointer + "/headers/" + escapePointer(key), /authorization|token|secret|api[_-]?key|cookie/i.test(key))]))
  if (stringMap(value.env_http_headers)) for (const [header, name] of Object.entries(value.env_http_headers)) headers[header] = [{ environment: { name } }]
  if (typeof value.bearer_token_env_var === "string" && !Object.keys(headers).some(key => key.toLowerCase() === "authorization")) headers.Authorization = ["Bearer ", { environment: { name: value.bearer_token_env_var } }]
  const oauth = object(value.oauth) ? value.oauth : undefined
  const login: LoginNeed = {
    ...mcpLogin(id, definition.name, value.url),
    ...(oauth || typeof value.oauth_resource === "string" ? { oauth: {
      ...(typeof (oauth?.clientId ?? oauth?.client_id) === "string" ? { clientId: String(oauth?.clientId ?? oauth?.client_id) } : {}),
      ...(typeof (oauth?.clientSecret ?? oauth?.client_secret) === "string" ? { clientSecret: text(String(oauth?.clientSecret ?? oauth?.client_secret), definition.pointer + (typeof oauth?.clientSecret === "string" ? "/oauth/clientSecret" : "/oauth/client_secret"), true) } : {}),
      ...(typeof oauth?.scope === "string" || Array.isArray(oauth?.scopes ?? value.scopes) ? { scopes: strings(oauth?.scope ?? oauth?.scopes ?? value.scopes) } : {}),
      ...(typeof (oauth?.resource ?? value.oauth_resource) === "string" ? { resource: String(oauth?.resource ?? value.oauth_resource) } : {}),
      ...(typeof oauth?.authorizationServerUrl === "string" ? { authorizationServerUrl: oauth.authorizationServerUrl } : {}),
    } } : {}),
  }
  return { ...base, transport: value.type === "sse" ? "sse" : "http", url: text(value.url, definition.pointer + "/url"), headers, ...(value.oauth === false ? { oauth: false } : !Object.keys(headers).some((key) => /authorization|token|secret|api[_-]?key|cookie/i.test(key)) || oauth ? { oauth: login } : {}) }
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
  const structured = pluginText(value)
  if (structured.some(part => typeof part !== "string")) {
    if (!context.sensitive) return structured
    const protect = (part: Text[number], label?: string): Text[number] => {
      if (typeof part === "string") return label && part ? { secret: credentialNeed(label, context, part) } : part
      if (!("environment" in part)) return part
      const environment = part.environment
      const fallback = environment.default
      if (fallback && !fallback.every(part => typeof part === "string")) return { environment: { ...environment, default: fallback.map((child, index) => protect(child, environment.name + ":" + index)) } }
      const id = credentialNeed(environment.name, context, fallback ? fallback.join("") : undefined)
      return { environment: { ...environment, default: [{ secret: id }] } }
    }
    const result = structured.map(part => protect(part))
    const placeholder = (parts: Text): string => parts.map(part => typeof part === "string" ? part
      : "environment" in part ? "${" + part.environment.name + (part.environment.default ? ":-" + placeholder(part.environment.default) : "") + "}"
      : "option" in part ? "${user_config." + part.option + "}"
      : "binding" in part ? renderPluginText([part], { pluginRoot: "${CLAUDE_PLUGIN_ROOT}", projectDir: "${CLAUDE_PROJECT_DIR}" })
      : "{secret:" + part.secret + "}").join("")
    context.replace(placeholder(result))
    return result
  }
  if (!context.sensitive || !value || /^\{secret:[^}]+\}$/.test(value)) return structured
  const parts: Text[number][] = []
  let offset = 0
  // These placeholders occur in recorded credential fields, never in arbitrary prose or shell source.
  for (const match of value.matchAll(/\$([A-Za-z_][\w]*)|\{(?:env:)?([A-Za-z_][\w]*)\}|<([A-Za-z_][\w]*)>/g)) {
    if (match.index! > offset) parts.push(value.slice(offset, match.index))
    parts.push({ secret: credentialNeed(match[1] ?? match[2] ?? match[3]!, context) })
    offset = match.index! + match[0].length
  }
  if (parts.length) {
    if (offset < value.length) parts.push(value.slice(offset))
    context.replace(parts.map(part => typeof part === "string" ? part : "secret" in part ? "{secret:" + part.secret + "}" : "").join(""))
    return parts
  }
  const prefix = value.match(/^(Bearer |Basic )/i)?.[0] ?? ""
  const id = credentialNeed(context.pointer.split("/").at(-1)!, context, value.slice(prefix.length))
  context.replace(prefix + "{secret:" + id + "}")
  return [...(prefix ? [prefix] : []), { secret: id }]
}

function invocation(data: Record<string, unknown>, syntax: ArgumentSyntax, path: string, diagnostics: Diagnostic[]): Invocation {
  const rules = (field: string) => pluginToolRules(data[field], () => diagnostics.push({ path, field, code: "invalid-definition", message: "Tool rule has unbalanced syntax" }))
  const effort = ["low", "medium", "high", "xhigh", "max"].find(value => data.effort === value) as Invocation["effort"]
  const memory = ["user", "project", "local"].find(value => data.memory === value) as Invocation["memory"]
  return {
    fork: data.context === "fork", userInvocable: data["user-invocable"] !== false, implicitInvocation: data["disable-model-invocation"] !== true && data.allow_implicit_invocation !== false,
    allowedTools: rules("allowed-tools"), deniedTools: rules("disallowed-tools"),
    ...(data.tools === undefined ? {} : { availableTools: rules("tools") }),
    ...(sourceModel(data.model) ? { model: sourceModel(data.model) } : {}),
    ...(typeof data.agent === "string" ? { agent: data.agent } : {}),
    ...(typeof data["argument-hint"] === "string" ? { argumentHint: data["argument-hint"] } : {}),
    arguments: strings(data.arguments), argumentSyntax: syntax, paths: strings(data.paths), preloadSkills: strings(data.skills),
    ...(effort ? { effort } : {}), ...(memory ? { memory } : {}),
    ...(Number.isSafeInteger(data.maxTurns) && Number(data.maxTurns) > 0 ? { maxTurns: Number(data.maxTurns) } : {}),
    ...(typeof data.background === "boolean" ? { background: data.background } : {}),
  }
}

export function pluginToolRules(value: unknown, invalid: () => void): ToolRule[] {
  const result: ToolRule[] = []
  for (const source of typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []) {
    let start = 0
    while (start < source.length) {
      if (/[\s,]/.test(source[start]!)) { start++; continue }
      let depth = 0
      let quote = ""
      let escaped = false
      let end = start
      for (; end < source.length; end++) {
        const character = source[end]!
        if (escaped) { escaped = false; continue }
        if (character === "\\") { escaped = true; continue }
        if (quote) { if (character === quote) quote = ""; continue }
        if (character === "'" || character === '"') { quote = character; continue }
        if (character === "(") depth++
        if (character === ")") depth--
        if (depth === 0 && /[\s,]/.test(character)) break
        if (depth < 0) break
      }
      if (depth !== 0 || quote || escaped) {
        invalid()
        const next = source.indexOf(",", start)
        start = next < 0 ? source.length : next + 1
        continue
      }
      const rule = source.slice(start, end).match(/^([^()\s]+)(?:\(([\s\S]*)\))?$/)
      if (rule) result.push({ tool: rule[1]!, ...(rule[2] === undefined ? {} : { pattern: rule[2] }) })
      else invalid()
      start = end + 1
    }
  }
  return result
}
function strings(value: unknown): string[] { return typeof value === "string" ? value.split(/,\s*|\s+/).filter(Boolean) : Array.isArray(value) ? value.filter((part): part is string => typeof part === "string") : [] }
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function string(value: unknown): string | undefined { return typeof value === "string" ? value : undefined }
function stringMap(value: unknown): value is Record<string, string> { return object(value) && Object.values(value).every((part) => typeof part === "string") }
function decode(bytes: Uint8Array): string { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "") }
function parseJson(bytes: Uint8Array, jsonc = false): unknown {
  try {
    if (!jsonc) return JSON.parse(decode(bytes))
    const errors: ParseError[] = []
    const value: unknown = parse(decode(bytes), errors, { allowTrailingComma: true })
    return errors.length ? undefined : value
  } catch { return undefined }
}
function jsonRecord(value: Record<string, unknown>): Record<string, Json> { return JSON.parse(JSON.stringify(value)) as Record<string, Json> }
function sha256(bytes: Uint8Array): Sha256 { return ("sha256:" + createHash("sha256").update(bytes).digest("hex")) as Sha256 }
function escapePointer(value: string): string { return value.replaceAll("~", "~0").replaceAll("/", "~1") }
function replacePointer(root: Record<string, unknown>, pointer: string, replacement: string): void {
  const keys = pointer.slice(1).split("/").map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"))
  const target = keys.slice(0, -1).reduce<unknown>((node, key) => object(node) ? node[key] : undefined, root)
  if (object(target)) target[keys.at(-1)!] = replacement
}

/** Materialize only the installed copy; discovery and frontmatter field meanings remain converter-owned. */
export function renderInstalledSkill(entry: Extract<Entry, { kind: "skill" }>, bytes: Uint8Array, hosts: ReadonlyMap<string, string>): Uint8Array {
  const text = decode(bytes)
  const hostName = hosts.get(entry.id) ?? hosts.get(entry.sourceName) ?? entry.sourceName
  const rendered = text.replace(/^(---\r?\n)([\s\S]*?)(\r?\n---)/, (_match, start: string, frontmatter: string, end: string) => {
    const named = /^name:/.test(frontmatter) || /\nname:/.test(frontmatter)
      ? frontmatter.replace(/^name:[^\r\n]*$/m, "name: " + hostName)
      : "name: " + hostName + "\n" + frontmatter
    const rules = [["allowed-tools", entry.invocation.allowedTools], ["disallowed-tools", entry.invocation.deniedTools], ["tools", entry.invocation.availableTools ?? []]] as const
    const withRules = rules.reduce((value, [field, rules]) => {
      const rewritten = rules.map((rule) => {
        const tool = [...hosts].reduce((tool, [source, host]) => tool.startsWith("mcp__" + source + "__") ? "mcp__" + host + "__" + tool.slice(("mcp__" + source + "__").length) : tool, rule.tool)
        return tool + (rule.pattern === undefined ? "" : "(" + rule.pattern + ")")
      })
      if (rules.every((rule, index) => rule.tool + (rule.pattern === undefined ? "" : "(" + rule.pattern + ")") === rewritten[index])) return value
      return value.replace(new RegExp("^" + field + ":[^\\r\\n]*(?:\\r?\\n[ \\t]+[^\\r\\n]*)*", "m"), field + ": " + JSON.stringify(rewritten))
    }, named)
    const dependencies = withRules.replace(/^dependencies:[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/m, (block) => block.replace(/\bmcp:[^\r\n]*(?:\r?\n[ \t]+-[^\r\n]*)*/, (mcp) => entry.mcpDependencies.reduce((value, source) => {
      const host = hosts.get(source)
      if (!host || host === source) return value
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      return value.replace(new RegExp("(?<=[\\s\\[,'\"])" + escaped + "(?=[\\s\\],'\"]|$)", "g"), host)
    }, mcp)))
    return start + dependencies + end
  })
  return new TextEncoder().encode(rendered)
}

function sourceModel(value: unknown): import("./plugin-package").ModelHint | undefined {
  if (typeof value !== "string" || value === "inherit") return
  return value.includes("/") ? { providerID: value.slice(0, value.indexOf("/")), modelID: value.slice(value.indexOf("/") + 1) } : { alias: value }
}
