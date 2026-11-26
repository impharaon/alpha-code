// #1563 / #1565 fixture (#1662 L4): a real stdio MCP server whose startup can hang or run slow, logs its startup window,
// and serves a tool list from a file, so codepuppy-mcp-runtime.test.ts measures processes instead of assuming them.
//   CODEPUPPY_MCP_HANG=1          never read stdin, so `initialize` is never answered
//   CODEPUPPY_MCP_INIT_DELAY_MS   wait before reading stdin (the handshake takes at least this long)
//   CODEPUPPY_MCP_STARTUP_LOG     append "+" at launch and "-" when answering tools/list (the end of startup)
//   CODEPUPPY_MCP_TOOLS_FILE      serve this JSON array of tool definitions instead of `echo`
//   CODEPUPPY_MCP_CALL_LOG        append "<tool>\n" when a tools/call starts
//   CODEPUPPY_MCP_PID_FILE        write this process's pid at launch, so a test can kill a hung server instead of awaiting it
//   CODEPUPPY_MCP_CHILD_PID_FILE  start a long-lived child process and write its pid (a descendant the engine must reap)
//   CODEPUPPY_MCP_LIST_DELAY_MS   wait this long before answering tools/list
//   CODEPUPPY_MCP_EXIT_STDERR     write this to stderr and exit with code 3 before the handshake
//   a tools/call named `slow`     answers after `ms` milliseconds (list it through CODEPUPPY_MCP_TOOLS_FILE)
import { spawn } from "node:child_process"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"

const env = process.env
const mark = (value: string) => {
  if (env.CODEPUPPY_MCP_STARTUP_LOG) appendFileSync(env.CODEPUPPY_MCP_STARTUP_LOG, value)
}

mark("+")
if (env.CODEPUPPY_MCP_EXIT_STDERR) {
  process.stderr.write(`${env.CODEPUPPY_MCP_EXIT_STDERR}\n`)
  process.exit(3)
}
if (env.CODEPUPPY_MCP_PID_FILE) writeFileSync(env.CODEPUPPY_MCP_PID_FILE, String(process.pid))
if (env.CODEPUPPY_MCP_CHILD_PID_FILE) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], { stdio: "ignore" })
  writeFileSync(env.CODEPUPPY_MCP_CHILD_PID_FILE, String(child.pid))
}
if (env.CODEPUPPY_MCP_HANG) {
  setInterval(() => {}, 1 << 30)
  await new Promise(() => {})
}
if (env.CODEPUPPY_MCP_INIT_DELAY_MS) await Bun.sleep(Number(env.CODEPUPPY_MCP_INIT_DELAY_MS))

const server = new Server({ name: "codepuppy-mcp-startup", version: "1.0.0" }, { capabilities: { tools: {} } })
server.setRequestHandler("tools/list", async () => {
  if (env.CODEPUPPY_MCP_LIST_DELAY_MS) await Bun.sleep(Number(env.CODEPUPPY_MCP_LIST_DELAY_MS))
  mark("-")
  if (env.CODEPUPPY_MCP_TOOLS_FILE) return { tools: JSON.parse(readFileSync(env.CODEPUPPY_MCP_TOOLS_FILE, "utf8")) }
  return { tools: [{ name: "echo", description: "echo", inputSchema: { type: "object" as const, properties: { text: { type: "string" } } } }] }
})
server.setRequestHandler("tools/call", async (request) => {
  if (env.CODEPUPPY_MCP_CALL_LOG) appendFileSync(env.CODEPUPPY_MCP_CALL_LOG, `${request.params.name}\n`)
  const args = (request.params.arguments ?? {}) as Record<string, unknown>
  if (request.params.name === "slow") await Bun.sleep(Number(args.ms ?? 0))
  return { content: [{ type: "text" as const, text: String(args.text ?? request.params.name) }] }
})
await server.connect(new StdioServerTransport())
