import { pluginDataDirectory, storedPluginOption } from "./installed-plugin-settings"
import { renderPluginText, pluginOptionEnvironmentName, type Entry, type Text, type PackageTextBindings } from "./host-extension-package-contract/plugin-package"
import type { McpConfigLeafV1 } from "./plugin-install"

export class PluginMcpBindingError extends Error {
  constructor(readonly code: "missing-config" | "dependency-missing", readonly field: string) { super(code + ": " + field) }
}

/** Normalized package entries retain their source argv through the existing v1 projection. */
export function pluginMcpConfig(entry: Extract<Entry, { kind: "mcp" }>, bindings?: PackageTextBindings): McpConfigLeafV1 {
  const render = (text: Text) => renderPluginText(text, bindings ?? { pluginRoot: "${CLAUDE_PLUGIN_ROOT}", projectDir: "${CLAUDE_PROJECT_DIR}" })
  const timing = { ...(entry.timeoutMs === undefined ? {} : { timeout: entry.timeoutMs }), ...(entry.timeouts ? { timeouts: entry.timeouts } : {}) }
  if (entry.transport !== "stdio") return {
    type: "remote", url: render(entry.url), headers: Object.fromEntries(Object.entries(entry.headers).map(([key, value]) => [key, render(value)])), ...timing,
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

export function bindPluginMcp(input: {
  description: import("./host-extension-package-contract/plugin-package").PluginPackage
  entry: Extract<Entry, { kind: "mcp" }>
  settings: import("./installed-plugin-settings").InstalledPluginSettingsV1
  pluginRoot: string
  projectDir: string
  resolveEnvironment(name: string): string | undefined
  resolveOptionSecret(reference: string): string | undefined
  resolveSecret(id: string): string | undefined
}): McpConfigLeafV1 {
  const values = new Map<string, string | number | boolean>()
  const option = (key: string) => {
    if (values.has(key)) return values.get(key)
    const definition = input.description.options?.[key]
    if (!definition) return
    const stored = storedPluginOption(input.settings, key) === undefined ? definition.default : storedPluginOption(input.settings, key)
    const reference = typeof stored === "object" ? input.settings.secretRefs[stored.secret] : undefined
    const encoded = reference && input.resolveOptionSecret(reference)
    const value: unknown = typeof stored === "object" ? encoded === undefined ? undefined : JSON.parse(encoded) : stored
    if (value === undefined) {
      if (definition.required) throw new PluginMcpBindingError("missing-config", key)
      return
    }
    if (typeof value !== definition.type || typeof value === "number" && !Number.isFinite(value)) throw new PluginMcpBindingError("missing-config", key)
    values.set(key, value as string | number | boolean)
    return value as string | number | boolean
  }
  const config = pluginMcpConfig(input.entry, { pluginRoot: input.pluginRoot, projectDir: input.projectDir,
    pluginData: pluginDataDirectory(input.settings.dataHome, input.settings.packageId), resolveOption: option,
    resolveEnvironment: input.resolveEnvironment, resolveSecret: input.resolveSecret,
  })
  if (config.type !== "local") return config
  const version = input.settings.mcpVersions[input.entry.id]
  if (input.entry.transport === "stdio" && input.entry.floatingVersion && version !== undefined && version.length > 0) {
    const { commandIndex, token } = input.entry.floatingVersion
    const npm = input.entry.command[0]?.[0] === "npx"
    const name = npm ? token.replace(/(?<!^)@[^@/]*$/, "") : token.split("==")[0]!
    config.command[commandIndex] = name + (npm ? "@" : "==") + version
  }
  // Only consumed required options can stop an entry. Other unset options simply have no environment export.
  const names = new Map<string, string[]>()
  for (const key of Object.keys(input.description.options ?? {})) {
    const name = pluginOptionEnvironmentName(key)
    names.set(name, [...(names.get(name) ?? []), key])
  }
  const environment: Record<string, string> = { CLAUDE_PLUGIN_ROOT: input.pluginRoot, CLAUDE_PLUGIN_DATA: pluginDataDirectory(input.settings.dataHome, input.settings.packageId) }
  for (const [name, keys] of names) {
    if (keys.length !== 1) continue
    const key = keys[0]!
    const definition = input.description.options![key]!
    const stored = storedPluginOption(input.settings, key) === undefined ? definition.default : storedPluginOption(input.settings, key)
    if (stored === undefined) continue
    const value = option(key)
    if (value !== undefined) environment[name] = String(value)
  }
  return { ...config, environment: { ...environment, ...config.environment } }
}
