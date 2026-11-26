import { createMcpHandler, Server } from "@modelcontextprotocol/server"

/** A web-standard MCP server with one `echo` tool, for tests that route MCP HTTP through their own fetch. */
export const echoMcpHandler = () =>
  createMcpHandler(() => {
    const protocol = new Server({ name: "echo", version: "1.0.0" }, { capabilities: { tools: {} } })
    protocol.setRequestHandler("tools/list", () =>
      Promise.resolve({ tools: [{ name: "echo", inputSchema: { type: "object" as const, properties: {} } }] }),
    )
    protocol.setRequestHandler("tools/call", (request) =>
      Promise.resolve({ content: [{ type: "text" as const, text: `called ${request.params.name}` }] }),
    )
    return protocol
  })

/** Stateful SDK transport, so a SessionEnd assertion observes the actual protocol close. */
export async function sessionMcpHandler() {
  const { WebStandardStreamableHTTPServerTransport } = await import("@modelcontextprotocol/server")
  const transports = new Map<string, InstanceType<typeof WebStandardStreamableHTTPServerTransport>>()
  const counts = { opened: 0, closed: 0 }
  return {
    counts,
    async fetch(request: Request) {
      const id = request.headers.get("mcp-session-id")
      if (id) return transports.get(id)?.handleRequest(request) ?? new Response(null, { status: 404 })
      const protocol = new Server({ name: "session-echo", version: "1" }, { capabilities: { tools: {} } })
      protocol.setRequestHandler("tools/list", async () => ({ tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }] }))
      protocol.setRequestHandler("tools/call", async () => ({ content: [{ type: "text", text: "session echo" }] }))
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), enableJsonResponse: true,
        onsessioninitialized: id => { transports.set(id, transport); counts.opened++ },
        onsessionclosed: id => { transports.delete(id); counts.closed++ },
      })
      await protocol.connect(transport)
      return transport.handleRequest(request)
    },
  }
}
