// north-star:codepuppy-owned — real stateful SDK transport for session lifecycle proofs.
import { Server } from "@modelcontextprotocol/server"

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
