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
import { ElicitResultSchema } from "@modelcontextprotocol/core"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"
import { fromJsonSchema } from "@modelcontextprotocol/client"

const env = process.env
if (env.CODEPUPPY_MCP_LAUNCH_FILE)
  writeFileSync(
    env.CODEPUPPY_MCP_LAUNCH_FILE,
    JSON.stringify({
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      key: env.CONNECTOR_CURRENT_KEY,
      homePresent: env.HOME !== undefined,
    }),
  )
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
const elicitationPeers: (() => void)[] = []
server.setRequestHandler("tools/call", async (request, context) => {
  if (request.params.name === "crash" && env.CODEPUPPY_MCP_CRASH_STDERR) {
    process.stderr.write(env.CODEPUPPY_MCP_CRASH_STDERR + "\n")
    process.exit(17)
  }
  if (env.CODEPUPPY_MCP_CALL_LOG) appendFileSync(env.CODEPUPPY_MCP_CALL_LOG, `${request.params.name}\n`)
  const args = (request.params.arguments ?? {}) as Record<string, unknown>
  if (typeof args.ensure_pin === "string") {
    const result = await server.request({ method: "codepuppy/pinned-files.ensure", params: { ids: [args.ensure_pin], _meta: context.mcpReq._meta } }, fromJsonSchema({ type: "object" }))
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] }
  }
  if (request.params.name === "video_progress") {
    const token = context.mcpReq._meta?.progressToken
    if (typeof token === "string" || typeof token === "number") {
      for (const [sequence, phase] of ["decoding", "transcribing"].entries()) {
        await context.mcpReq.notify({ method: "notifications/progress", params: { progressToken: token, progress: sequence + 1, _meta: { "codepuppy.video.progress": { phase, completed: Number(args.completed), total: 10000, unit: "ms" } } } })
        // A real round trip is a wire barrier, not a sleep/timing assertion: the
        // SDK must dispatch this progress before the next work step/result.
        await context.mcpReq.send({ method: "roots/list" })
      }
    }
  }
  if (request.params.name === "slow") await Bun.sleep(Number(args.ms ?? 0))
  if (request.params.name === "elicit") {
    if (args.waitForPeer) await new Promise<void>(resolve => {
      elicitationPeers.push(resolve)
      if (elicitationPeers.length === 2) for (const release of elicitationPeers) release()
    })
    const answer = await server.request({ method: "elicitation/create", params: { mode: "form", message: "SDK fixture input", requestedSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] } } }, ElicitResultSchema)
    return { content: [{ type: "text" as const, text: JSON.stringify(answer) }] }
  }
  return { content: [{ type: "text" as const, text: String(args.text ?? request.params.name) }] }
})
await server.connect(new StdioServerTransport())
