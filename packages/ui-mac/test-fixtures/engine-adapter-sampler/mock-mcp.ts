// `#1697`(I-04 M5d):采样 MCP 事件用的本机假 MCP 服务器(streamable HTTP,JSON 应答),不连外网。用法见 README.md。
//
//   POST /mcp  JSON-RPC:initialize(声明 tools / resources / prompts 都会发 list_changed)、各 list(空清单)、通知回 202
//   GET  /mcp  服务端推送的 SSE:`announce()` 之后依次推 tools / resources / prompts 的 list_changed 通知
// 引擎连上它之后收到这三条通知,各自重取清单并发出 mcp.tools.changed / mcp.resources.changed / mcp.prompts.changed。

export function startMockMcp(port: number) {
  const origin = `http://127.0.0.1:${port}`
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const encoder = new TextEncoder()
  const requests: string[] = []
  const result = (id: unknown, value: unknown) => Response.json({ jsonrpc: "2.0", id, result: value })
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname !== "/mcp") return new Response("not found", { status: 404 })
      if (request.method === "GET") {
        requests.push("GET /mcp")
        let own: ReadableStreamDefaultController<Uint8Array> | undefined
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              own = controller
              streams.add(controller)
              controller.enqueue(encoder.encode(": connected\n\n"))
            },
            cancel() {
              if (own) streams.delete(own)
            },
          }),
          { headers: { "content-type": "text/event-stream", "mcp-session-id": "sampler" } },
        )
      }
      if (request.method === "DELETE") return new Response(null, { status: 204 })
      const message = (await request.json()) as { id?: unknown; method: string; params?: { protocolVersion?: string } }
      requests.push(`POST ${message.method}`)
      if (message.id === undefined) return new Response(null, { status: 202 })
      const headers = { "mcp-session-id": "sampler" }
      const reply = (value: unknown) => {
        const response = result(message.id, value)
        for (const [key, header] of Object.entries(headers)) response.headers.set(key, header)
        return response
      }
      switch (message.method) {
        case "initialize":
          return reply({
            protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
            capabilities: { tools: { listChanged: true }, resources: { listChanged: true }, prompts: { listChanged: true } },
            serverInfo: { name: "sampler-mcp", version: "1.0.0" },
          })
        case "tools/list":
          return reply({ tools: [{ name: "sampler_echo", description: "echo", inputSchema: { type: "object", properties: {} } }] })
        case "resources/list":
          return reply({ resources: [] })
        case "resources/templates/list":
          return reply({ resourceTemplates: [] })
        case "prompts/list":
          return reply({ prompts: [] })
        case "ping":
          return reply({})
        default:
          return Response.json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" } })
      }
    },
  })
  return {
    origin,
    requests,
    /** 向每条已连上的推送流依次发三种 list_changed。 */
    announce() {
      for (const method of ["notifications/tools/list_changed", "notifications/resources/list_changed", "notifications/prompts/list_changed"])
        for (const stream of streams) stream.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method })}\n\n`))
      return streams.size
    },
    stop: () => server.stop(true),
  }
}
