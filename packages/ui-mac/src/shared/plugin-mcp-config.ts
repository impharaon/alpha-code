import { Schema, Option } from "effect"
import { pluginDataDirectory, storedPluginOption } from "./installed-plugin-settings"
import { renderPluginText, pluginOptionEnvironmentName, type Entry, type Text, type PackageTextBindings } from "./host-extension-package-contract/plugin-package"
import type { McpConfigLeafV1 } from "./plugin-install"

export class PluginMcpBindingError extends Error {
  constructor(readonly code: "missing-config" | "dependency-missing", readonly field: string) { super(code + ": " + field) }
}

/** Normalized package entries retain their source argv through the existing v1 projection. */
export function pluginMcpConfig(entry: Extract<Entry, { kind: "mcp" }>, bindings?: PackageTextBindings): McpConfigLeafV1 {
  return renderMcpConfig(entry, text => renderPluginText(text, bindings ?? { pluginRoot: "${CLAUDE_PLUGIN_ROOT}", projectDir: "${CLAUDE_PROJECT_DIR}" }), bindings)
}

function renderMcpConfig(entry: Extract<Entry, { kind: "mcp" }>, render: (text: Text) => string, bindings?: PackageTextBindings): McpConfigLeafV1 {
  const timing = { ...(entry.timeoutMs === undefined ? {} : { timeout: entry.timeoutMs }), ...(entry.timeouts ? { timeouts: entry.timeouts } : {}) }
  if (entry.transport !== "stdio") return {
    type: "remote", transport: entry.transport, url: render(entry.url), headers: Object.fromEntries(Object.entries(entry.headers).map(([key, value]) => [key, render(value)])), ...timing,
    ...(entry.oauth === false ? { oauth: false } : entry.oauth?.oauth ? { oauth: {
      ...(entry.oauth.oauth.clientId ? { clientId: entry.oauth.oauth.clientId } : {}),
      ...(entry.oauth.oauth.clientSecret ? { clientSecret: render(entry.oauth.oauth.clientSecret) } : {}),
      ...(entry.oauth.oauth.scopes ? { scope: entry.oauth.oauth.scopes.join(" ") } : {}),
    } } : {}),
  }
  const forwarded = bindings ? Object.fromEntries((entry.forwardEnvironment ?? []).flatMap(variable => {
    if (variable.source === "remote") throw new PluginMcpBindingError("dependency-missing", variable.name)
    const value = bindings.resolveEnvironment(variable.name)
    return value === undefined ? [] : [[variable.name, value]]
  })) : {}
  return { type: "local", command: entry.command.map(render),
    environment: { ...forwarded, ...Object.fromEntries(Object.entries(entry.environment).map(([key, value]) => [key, render(value)])) },
    ...(entry.forwardEnvironment ? { forwardEnvironment: entry.forwardEnvironment } : {}),
    ...(entry.cwd ? { cwd: render(entry.cwd) } : {}), ...timing,
  }
}

type PluginProcessSource = {
  description: import("./host-extension-package-contract/plugin-package").PluginPackage
  settings: import("./installed-plugin-settings").InstalledPluginSettingsV1
  pluginRoot: string
  projectDir: string
  skillDir?: string
  resolveEnvironment(name: string): string | undefined
  resolveOptionSecret(reference: string): string | undefined
  resolveSecret(id: string): string | undefined
}

export function pluginProcessConfig(input: PluginProcessSource) {
  const secretValues = new Set<string>()
  const values = new Map<string, string | number | boolean>()
  const option = (key: string) => {
    if (values.has(key)) return values.get(key)
    const definition = input.description.options?.[key]
    if (!definition) return
    const stored = storedPluginOption(input.settings, key) === undefined ? definition.default : storedPluginOption(input.settings, key)
    const reference = typeof stored === "object" ? input.settings.secretRefs[stored.secret] : undefined
    const encoded = reference && input.resolveOptionSecret(reference)
    const decoded = encoded === undefined ? undefined : Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(encoded)
    if (decoded && Option.isNone(decoded)) throw new PluginMcpBindingError("missing-config", key)
    const value: unknown = typeof stored === "object" ? decoded && Option.isSome(decoded) ? decoded.value : undefined : stored
    if (value === undefined) {
      if (definition.required) throw new PluginMcpBindingError("missing-config", key)
      return
    }
    if (typeof value !== definition.type || typeof value === "number" && !Number.isFinite(value)) throw new PluginMcpBindingError("missing-config", key)
    if (definition.sensitive && String(value)) secretValues.add(String(value))
    values.set(key, value as string | number | boolean)
    return value as string | number | boolean
  }
  const bindings: PackageTextBindings = { pluginRoot: input.pluginRoot, projectDir: input.projectDir, skillDir: input.skillDir,
    pluginData: pluginDataDirectory(input.settings.dataHome, input.settings.packageId), resolveOption: option,
    resolveEnvironment: input.resolveEnvironment, resolveSecret: id => {
      const value = input.resolveSecret(id)
      if (value) secretValues.add(value)
      return value
    },
  }
  const environment = () => {
    // Only consumed required options can stop an entry. Other unset options simply have no environment export.
    const names = new Map<string, string[]>()
    for (const key of Object.keys(input.description.options ?? {})) {
      const name = pluginOptionEnvironmentName(key)
      names.set(name, [...(names.get(name) ?? []), key])
    }
    const environment: Record<string, string> = { CLAUDE_PLUGIN_ROOT: input.pluginRoot, CLAUDE_PLUGIN_DATA: pluginDataDirectory(input.settings.dataHome, input.settings.packageId) }
    if (input.skillDir) environment.CLAUDE_SKILL_DIR = input.skillDir
    for (const [name, keys] of names) {
      if (keys.length !== 1) continue
      const key = keys[0]!
      const definition = input.description.options![key]!
      const stored = storedPluginOption(input.settings, key) === undefined ? definition.default : storedPluginOption(input.settings, key)
      if (stored === undefined) continue
      const value = option(key)
      if (value !== undefined) environment[name] = String(value)
    }
    return environment
  }
  const render = (text: Text): string => {
    for (const part of text) {
      if (typeof part === "string") continue
      if ("environment" in part && bindings.resolveEnvironment(part.environment.name) === undefined) {
        const fallback = part.environment.default
        if (fallback?.length === 1 && typeof fallback[0] !== "string" && "secret" in fallback[0]! && bindings.resolveSecret(fallback[0].secret) === undefined)
          throw new PluginMcpBindingError("dependency-missing", part.environment.name)
        if (fallback) render(fallback)
        else throw new PluginMcpBindingError("dependency-missing", part.environment.name)
      }
      if ("option" in part && bindings.resolveOption(part.option) === undefined) throw new PluginMcpBindingError("missing-config", part.option)
      if ("secret" in part && bindings.resolveSecret(part.secret) === undefined) throw new PluginMcpBindingError("missing-config", part.secret)
      if ("binding" in part && bindings[part.binding] === undefined) throw new PluginMcpBindingError("dependency-missing", part.binding)
    }
    return renderPluginText(text, bindings)
  }
  return { bindings, environment, render, secretValues }
}

export function bindPluginMcp(input: PluginProcessSource & { entry: Extract<Entry, { kind: "mcp" }> }): McpConfigLeafV1 {
  const process = pluginProcessConfig(input)
  const config = renderMcpConfig(input.entry, process.render, process.bindings)
  if (config.type !== "local") return config
  const version = input.settings.mcpVersions[input.entry.id]
  if (input.entry.transport === "stdio" && input.entry.floatingVersion && version !== undefined && version.length > 0) {
    const { commandIndex, token } = input.entry.floatingVersion
    const npm = input.entry.command[0]?.[0] === "npx"
    const name = npm ? token.replace(/(?<!^)@[^@/]*$/, "") : token.split("==")[0]!
    config.command[commandIndex] = name + (npm ? "@" : "==") + version
  }
  return { ...config, environment: { ...process.environment(), ...config.environment } }
}
