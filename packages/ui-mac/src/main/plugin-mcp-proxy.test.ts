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

// Real legacy SSE server from core's installed Claude Agent SDK peer (bun.lock); no hand-written JSON-RPC.
test("explicit SSE registers its real POST endpoint for the same proxy generation and revokes it with the stream", async () => {
  const { createServer } = await import("node:http")
  const { dirname, resolve } = await import("node:path")
  const peer = dirname(Bun.resolveSync("@anthropic-ai/claude-agent-sdk", resolve(import.meta.dir, "../../../core")))
  const sdk = await import(Bun.resolveSync("@modelcontextprotocol/sdk/server/mcp.js", peer))
  const sse = await import(Bun.resolveSync("@modelcontextprotocol/sdk/server/sse.js", peer))
  const { McpConnection } = await import("../../../core/src/mcp/connection")
  const { Environment } = await import("../../../core/src/environment/index")
  const { hostEnvironmentLayer } = await import("../../../core/test/fixture/environment")
  const { Effect } = await import("effect")
  const seen: Array<{ method: string; path: string; privateHeaders: unknown[] }> = []
  const streams: Promise<void>[] = []
  const closeServers: Array<() => Promise<void>> = []
  const transports = new Map<string, InstanceType<typeof sse.SSEServerTransport>>()
  const endpoint = createServer(async (request, response) => {
    seen.push({ method: request.method!, path: request.url!, privateHeaders: [request.headers["proxy-authorization"], request.headers["codepuppy-mcp-sse-endpoint"]] })
    if (request.headers.authorization !== "Bearer invalid-local-sse-token") { response.writeHead(403); response.end(); return }
    if (request.method === "GET" && request.url === "/events?source=plugin") {
      const server = new sdk.McpServer({ name: "real-sdk-sse", version: "1.0.0" })
      server.registerTool("probe", { inputSchema: {} }, async () => ({ content: [{ type: "text", text: "sse-probed" }] }))
      const transport = new sse.SSEServerTransport("/messages", response)
      transports.set(transport.sessionId, transport)
      streams.push(new Promise<void>(resolve => response.once("close", resolve)))
      closeServers.push(() => server.close())
      await server.connect(transport)
      return
    }
    const transport = transports.get(new URL(request.url!, "http://localhost").searchParams.get("sessionId") ?? "")
    if (request.method === "POST" && transport) { await transport.handlePostMessage(request, response); return }
    response.writeHead(404); response.end()
  })
  await new Promise<void>(resolve => endpoint.listen(0, "127.0.0.1", resolve))
  const address = endpoint.address()
  if (!address || typeof address === "string") throw Error("SSE fixture port missing")
  const url = `http://127.0.0.1:${address.port}/events?source=plugin`
  const proxy = await startEgressPolicyProxy({ log: () => {} })
  configurePluginMcpProxy(proxy)
  const detach = attachPluginMcpProxyPublisher(async bindings => publishPluginMcpProxies(bindings))
  const requests: Array<{ url: string; authorization?: string }> = []
  const base: typeof fetch = Object.assign((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    requests.push({ url: String(input), authorization: (init as { proxy?: { headers: Record<string, string> } })?.proxy?.headers["Proxy-Authorization"] })
    return fetch(input, init)
  }, fetch)
  try {
    await bindPluginMcpProxy("sse", { packageId: "claude:sse", entryId: "mcp:sse", generation: "gen-000001-abcdef", definitionDigest: ("sha256:" + "e".repeat(64)) as `sha256:${string}`, serverUrl: url }, "sse")
    const binding = pluginMcpProxySnapshot().sse![0]!
    for (const revoke of [false, true]) await Effect.runPromise(Effect.gen(function* () {
      const run = Effect.runForkWith(yield* Effect.context())
      const connection = McpConnection.make({
        name: "sse", config: { type: "remote", url, transport: "sse", oauth: false, headers: { Authorization: "Bearer invalid-local-sse-token" } }, directory: import.meta.dir,
        environment: yield* Environment.Service, fetch: base, scope: yield* Effect.scope,
        authProvider: Effect.succeed(undefined), elicitation: { create: () => Effect.die("unexpected elicitation"), complete: () => Effect.void },
        lock: effect => effect, callbacks: effect => run(effect), fork: effect => run(effect),
        events: { connecting: Effect.void, connected: Effect.void, settled: Effect.void, failed: failure => Effect.die(failure), closed: () => Effect.void, changed: () => Effect.void },
      })
      yield* connection.start
      const client = connection.client
      if (!client) throw Error("SSE connection did not retain its client")
      expect((yield* client.tools()).map(tool => tool.name)).toEqual(["probe"])
      expect((yield* client.callTool({ name: "probe", args: {} })).content).toEqual([{ type: "text", text: "sse-probed" }])
      if (!revoke) {
        const before = seen.length
        const rejected = yield* Effect.promise(() => fetch(new URL("/unrelated", url), { method: "POST", proxy: { url: binding.proxyUrl, headers: { "Proxy-Authorization": binding.proxyAuthorization }, respectNoProxy: false } }))
        expect(rejected.status).toBe(405)
        expect(seen).toHaveLength(before)
      }
      if (revoke) { revokePluginMcpProxy("sse"); yield* Effect.promise(() => streams.at(-1)!) }
    }).pipe(Effect.provide(hostEnvironmentLayer), Effect.scoped))
    expect(seen.filter(request => request.method === "GET")).toHaveLength(2)
    expect(new Set(seen.filter(request => request.method === "POST").map(request => request.path)).size).toBe(2)
    expect(requests.every(request => request.authorization === binding.proxyAuthorization)).toBe(true)
    expect(seen.every(request => request.privateHeaders.every(value => value === undefined))).toBe(true)
    const before = seen.length
    expect((await fetch(requests.find(request => request.url.includes("/messages?"))!.url, { method: "POST", proxy: { url: binding.proxyUrl, headers: { "Proxy-Authorization": binding.proxyAuthorization }, respectNoProxy: false } })).status).toBe(405)
    expect(seen).toHaveLength(before)
  } finally {
    detach(); publishPluginMcpProxies({}); await proxy.close()
    await Promise.all(closeServers.map(close => close()))
    endpoint.closeAllConnections()
    await new Promise<void>(resolve => endpoint.close(() => resolve()))
  }
})

// Moved from core's runtime file: the main proxy belongs in ui-mac's integration layer.
test("plugin local MCP uses its private proxy for HTTP sessions and keeps proxy auth off the server", async () => {
  const { resolve } = await import("node:path")
  const sdk = await import(Bun.resolveSync("@modelcontextprotocol/server", resolve(import.meta.dir, "../../../core")))
  const { McpConnection } = await import("../../../core/src/mcp/connection")
  const { Environment } = await import("../../../core/src/environment/index")
  const { hostEnvironmentLayer } = await import("../../../core/test/fixture/environment")
  const { Effect } = await import("effect")
  const server = new sdk.Server({ name: "codepuppy-remote", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler("tools/list", async () => ({ tools: [{ name: "probe", inputSchema: { type: "object" as const, properties: {} } }] }) as never)
  server.setRequestHandler("tools/call", async () => ({ content: [{ type: "text" as const, text: "probed" }] }))
  const transport = new sdk.WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), enableJsonResponse: true })
  await server.connect(transport)
  const methods: string[] = []
  const proxyHeaders: Array<string | null> = []
  const endpoint = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    methods.push(request.method); proxyHeaders.push(request.headers.get("proxy-authorization"))
    return transport.handleRequest(request)
  } })
  const url = `http://127.0.0.1:${endpoint.port}/mcp`
  const proxy = await startEgressPolicyProxy({ log: () => {} })
  const binding = proxy.bindPluginMcp({ packageId: "claude:rill", entryId: "mcp:rill-developer", generation: "gen-000001-abcdef", definitionDigest: ("sha256:" + "c".repeat(64)) as `sha256:${string}`, serverUrl: url })
  publishPluginMcpProxies({ remote: [binding] })
  const requests: unknown[] = []
  const base: typeof fetch = Object.assign((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => { requests.push(init); return fetch(input, init) }, fetch)
  try {
    await Effect.runPromise(Effect.gen(function* () {
      const run = Effect.runForkWith(yield* Effect.context())
      const connection = McpConnection.make({
        name: "remote", config: { type: "remote", url, oauth: false }, directory: import.meta.dir,
        environment: yield* Environment.Service, fetch: base, scope: yield* Effect.scope,
        authProvider: Effect.succeed(undefined), elicitation: { create: () => Effect.die("unexpected elicitation"), complete: () => Effect.void },
        lock: effect => effect, callbacks: effect => run(effect), fork: effect => run(effect),
        events: { connecting: Effect.void, connected: Effect.void, settled: Effect.void, failed: failure => Effect.die(failure), closed: () => Effect.void, changed: () => Effect.void },
      })
      yield* connection.start
      const client = connection.client
      if (!client) throw Error("HTTP connection did not retain its client")
      expect((yield* client.tools()).map(tool => tool.name)).toEqual(["probe"])
      expect((yield* client.callTool({ name: "probe", args: {} })).content).toEqual([{ type: "text", text: "probed" }])
      yield* connection.stop
    }).pipe(Effect.provide(hostEnvironmentLayer), Effect.scoped))
    expect(methods).toContain("POST"); expect(methods).toContain("GET"); expect(methods).toContain("DELETE")
    expect(proxyHeaders.every(value => value === null)).toBe(true)
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every(request => (request as { proxy?: { headers: Record<string, string>; respectNoProxy: boolean } }).proxy?.headers["Proxy-Authorization"] === binding.proxyAuthorization && (request as { proxy: { respectNoProxy: boolean } }).proxy.respectNoProxy === false)).toBe(true)
  } finally { publishPluginMcpProxies({}); await proxy.close(); await server.close(); await endpoint.stop(true) }
})
