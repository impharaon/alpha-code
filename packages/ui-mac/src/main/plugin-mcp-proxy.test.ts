import { expect, test } from "bun:test"
import { attachPluginMcpProxyPublisher, bindPluginMcpProxy, configurePluginMcpProxy, pluginMcpProxySnapshot, revokePluginMcpProxy } from "./plugin-mcp-proxy"
import { startEgressPolicyProxy } from "./network-egress-proxy"
import { pluginMcpFetch, publishPluginMcpProxies } from "@opencode/util/codepuppy-plugin-mcp"

test("package MCP capabilities retain a definition and revoke on replacement, off and sidecar exit", async () => {
  const proxy = await startEgressPolicyProxy({ log: () => {} })
  const target = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ready") })
  configurePluginMcpProxy(proxy)
  const detach = attachPluginMcpProxyPublisher(async bindings => publishPluginMcpProxies(bindings))
  const input = { packageId: "claude:rill", entryId: "mcp:rill-developer", generation: "gen-000001-abcdef", definitionDigest: ("sha256:" + "d".repeat(64)) as `sha256:${string}`, serverUrl: "http://127.0.0.1:" + target.port + "/mcp" }
  try {
    await bindPluginMcpProxy("rill", input)
    const original = pluginMcpProxySnapshot().rill![0]!
    const old = pluginMcpFetch("rill", input.serverUrl, fetch)
    expect(await (await old(input.serverUrl)).text()).toBe("ready")
    await bindPluginMcpProxy("rill", input)
    expect(pluginMcpProxySnapshot().rill![0]).toBe(original)
    await bindPluginMcpProxy("rill", { ...input, generation: "gen-000002-abcdef" })
    expect(pluginMcpProxySnapshot().rill![0]!.proxyAuthorization).not.toBe(original.proxyAuthorization)
    await expect(old(input.serverUrl)).rejects.toThrow("revoked")
    const next = pluginMcpFetch("rill", input.serverUrl, fetch)
    revokePluginMcpProxy("rill")
    expect((await next(input.serverUrl)).status).toBe(405)
    await bindPluginMcpProxy("rill", input)
    detach()
    expect(pluginMcpProxySnapshot()).toEqual({})
  } finally { detach(); publishPluginMcpProxies({}); await proxy.close(); await target.stop(true) }
})
