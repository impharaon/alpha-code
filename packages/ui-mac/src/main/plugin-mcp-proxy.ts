import type { McpProxyBinding, PluginMcpProxies } from "@opencode/util/codepuppy-plugin-mcp"
import { pluginMcpLoopback } from "@opencode/util/codepuppy-plugin-mcp"
import type { EgressProxyHandle } from "./network-egress-proxy"

let proxy: EgressProxyHandle | undefined
let publish: ((bindings: PluginMcpProxies) => Promise<void>) | undefined
const active = new Map<string, McpProxyBinding[]>()
export function pluginMcpProxySnapshot(): PluginMcpProxies { return Object.fromEntries([...active].map(([name, bindings]) => [name, [...bindings]])) }
export function configurePluginMcpProxy(handle: EgressProxyHandle) { proxy = handle }
export function attachPluginMcpProxyPublisher(writer: (bindings: PluginMcpProxies) => Promise<void>) {
  publish = writer
  return () => {
    if (publish !== writer) return
    publish = undefined
    for (const name of active.keys()) revokePluginMcpProxy(name)
  }
}
export function revokePluginMcpProxy(name: string) {
  for (const binding of active.get(name) ?? []) proxy?.revokePluginMcp(binding)
  active.delete(name)
}

/** Called only with main's freshly bound, enabled installed definition, never with a sidecar-supplied URL. */
export async function bindPluginMcpProxy(name: string, input: Omit<McpProxyBinding, "proxyUrl" | "proxyAuthorization">, transport: "http" | "sse" = "http") {
  if (!pluginMcpLoopback(new URL(input.serverUrl))) { revokePluginMcpProxy(name); return }
  if (!proxy || !publish) throw Error("Plugin MCP proxy is unavailable")
  const previous = active.get(name) ?? []
  if (previous.some(binding => binding.generation !== input.generation || binding.definitionDigest !== input.definitionDigest)) revokePluginMcpProxy(name)
  if (!(active.get(name) ?? []).some(binding => binding.serverUrl === input.serverUrl)) active.set(name, [...(active.get(name) ?? []), proxy.bindPluginMcp(input, transport)])
  await publish(pluginMcpProxySnapshot())
}
