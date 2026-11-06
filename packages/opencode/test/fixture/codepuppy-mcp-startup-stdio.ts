// #1563 fixture: a real stdio MCP server whose startup can hang, run slow, fork a descendant and log its startup
// window, so codepuppy-mcp-independent-startup.test.ts measures processes instead of assuming them. Driven by env:
//   CODEPUPPY_MCP_PID_FILE          write {"parent":pid,"child":pid?} once the process (and its descendant) exist
//   CODEPUPPY_MCP_CHILD=1           fork a long-lived descendant process
//   CODEPUPPY_MCP_HANG=1            never read stdin, so `initialize` is never answered
//   CODEPUPPY_MCP_INIT_DELAY_MS     wait before reading stdin (the handshake takes at least this long)
//   CODEPUPPY_MCP_LIST_DELAY_MS     wait before answering tools/list
//   CODEPUPPY_MCP_STARTUP_LOG       append "+" at launch and "-" when answering tools/list (end of startup)
//   CODEPUPPY_MCP_DESCRIPTION_FILE  the `echo` tool's description, read at launch (a reconnect can change the definition)
//   CODEPUPPY_MCP_CALL_LOG          append "<tool>\n" when a tools/call starts
//   CODEPUPPY_MCP_TOOLS_FILE        serve this JSON array of tool definitions instead of echo/slow (#1565: stand in for
//                               a first-party Office server whose definitions come from its bundled manifest)
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ErrorCode, McpError, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const env = process.env
const mark = (value: string) => {
  if (env.CODEPUPPY_MCP_STARTUP_LOG) appendFileSync(env.CODEPUPPY_MCP_STARTUP_LOG, value)
}

mark("+")
const child = env.CODEPUPPY_MCP_CHILD ? Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1 << 30)"]) : undefined
if (env.CODEPUPPY_MCP_PID_FILE)
  writeFileSync(env.CODEPUPPY_MCP_PID_FILE, JSON.stringify({ parent: process.pid, child: child?.pid }))
if (env.CODEPUPPY_MCP_HANG) {
  setInterval(() => {}, 1 << 30)
  await new Promise(() => {})
}
if (env.CODEPUPPY_MCP_INIT_DELAY_MS) await Bun.sleep(Number(env.CODEPUPPY_MCP_INIT_DELAY_MS))

const description = env.CODEPUPPY_MCP_DESCRIPTION_FILE ? readFileSync(env.CODEPUPPY_MCP_DESCRIPTION_FILE, "utf8") : "echo"
const server = new Server({ name: "codepuppy-mcp-startup", version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (env.CODEPUPPY_MCP_LIST_DELAY_MS) await Bun.sleep(Number(env.CODEPUPPY_MCP_LIST_DELAY_MS))
  mark("-")
  // #1653: the SDK's real timeout error shape (shared/protocol.js), also used by the remote startup fixture.
  if (env.CODEPUPPY_MCP_LIST_TIMEOUT_FILE && existsSync(env.CODEPUPPY_MCP_LIST_TIMEOUT_FILE))
    throw new McpError(ErrorCode.RequestTimeout, "Request timed out")
  if (env.CODEPUPPY_MCP_TOOLS_FILE) return { tools: JSON.parse(readFileSync(env.CODEPUPPY_MCP_TOOLS_FILE, "utf8")) }
  return {
    tools: [
      { name: "echo", description, inputSchema: { type: "object", properties: { text: { type: "string" } } } },
      { name: "slow", description: "sleeps", inputSchema: { type: "object", properties: { ms: { type: "number" } } } },
    ],
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments ?? {}
  if (env.CODEPUPPY_MCP_CALL_LOG) appendFileSync(env.CODEPUPPY_MCP_CALL_LOG, `${request.params.name}\n`)
  if (request.params.name === "slow") await Bun.sleep(Number(args.ms ?? 0))
  return { content: [{ type: "text", text: String(args.text ?? request.params.name) }] }
})

await server.connect(new StdioServerTransport())
