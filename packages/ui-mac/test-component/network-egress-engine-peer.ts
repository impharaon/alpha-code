// Headless process peer: real embedded engine/ext, production fence, Bun IPC instead of Electron's parent port.
import { engineSandbox, assertEngineSandboxed } from "./engine-sandbox"
import { codepuppyEngine, type Running } from "./codepuppy-engine"
import { serveCredentialsFromOutside } from "./credential-table"
import { codepuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { applyProcessFence } from "../src/main/process-fence-apply"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const sandbox = engineSandbox()
// AC-14's entry: a connector the engine itself starts (stdio MCP from codepuppy.jsonc, no tools). The engine runs
// it in the project directory with its own env, so it inherits the proxy variables. While idle it connects to each
// host:port main appends to the trigger file and writes the outcome back; no prompt or tool is involved.
const connector = join(sandbox.root, "network-egress-connector.ts")
writeFileSync(connector, `import { Server } from ${JSON.stringify(Bun.resolveSync("@modelcontextprotocol/server", import.meta.dir))}
import { StdioServerTransport } from ${JSON.stringify(Bun.resolveSync("@modelcontextprotocol/server/stdio", import.meta.dir))}
import { connect } from "node:net"
import { appendFileSync, existsSync, readFileSync } from "node:fs"
const proxy = new URL(process.env.HTTPS_PROXY)
const targets = () => existsSync(process.env.CONNECTOR_TRIGGER) ? readFileSync(process.env.CONNECTOR_TRIGGER, "utf8").split("\\n").filter(Boolean) : []
let handled = targets().length
setInterval(() => { const next = targets(); next.slice(handled).forEach(reach); handled = next.length }, 50)
function reach(target) {
  let reply = ""
  let response = ""
  let tunnel = false
  const socket = connect(Number(proxy.port), proxy.hostname, () => socket.write("CONNECT " + target + " HTTP/1.1\\r\\nHost: " + target + "\\r\\n\\r\\n"))
  socket.on("data", (chunk) => {
    if (tunnel) { response += chunk; return }
    reply += chunk
    if (!reply.includes("\\r\\n\\r\\n") || !reply.startsWith("HTTP/1.1 200")) return
    tunnel = true
    socket.write("GET /probe HTTP/1.1\\r\\nHost: " + target + "\\r\\nConnection: close\\r\\n\\r\\n")
  })
  socket.on("error", (error) => { response += "error " + error.message })
  socket.on("close", () => appendFileSync(process.env.CONNECTOR_RESULTS, JSON.stringify({ target, connect: reply, response }) + "\\n"))
}
const server = new Server({ name: "connector", version: "1.0.0" }, { capabilities: { tools: {} } })
server.setRequestHandler("tools/list", async () => ({ tools: [] }))
await server.connect(new StdioServerTransport())
`)
const listeners: Array<(event: { data: unknown }) => void> = []
const post = (message: unknown) => process.send?.(message)
;(process as unknown as { parentPort: unknown }).parentPort = {
  postMessage: post,
  on: (_event: string, listener: (event: { data: unknown }) => void) => listeners.push(listener),
}
const host = codepuppyEngine({ sandbox, name: "network-egress", modelBaseURL: "https://model.egress.test/v1", egressProxy: process.env.HTTPS_PROXY,
  mcp: { connector: { type: "local", command: [process.execPath, connector], environment: { CONNECTOR_TRIGGER: "connector-trigger.txt", CONNECTOR_RESULTS: "connector-results.jsonl" } } } })
await assertEngineSandboxed(sandbox)
const credentials = await serveCredentialsFromOutside()
let engine: Running | undefined
process.on("message", async (value: unknown) => {
  const command = value as { type: string; id: number; method: string; route: string; body?: unknown; fence: { profile: string; addonPath: string } }
  if (command.type.startsWith("codepuppy.network.")) { listeners.forEach((listener) => listener({ data: value })); return }
  try {
    if (command.type === "fixture.start") {
      const applied = applyProcessFence(command.fence, { insideDir: host.projectDirectory, outsideDir: process.env.EGRESS_OUTSIDE! })
      engine = await host.start()
      post({ type: "fixture.ready", pid: process.pid, url: engine.url, authorization: engine.authorization, applied })
      return
    }
    if (command.type === "fixture.restart") { await engine!.close(); engine = await host.start(); post({ type: "fixture.reply", id: command.id, value: { url: engine.url, authorization: engine.authorization } }); return }
    if (command.type === "fixture.call") { post({ type: "fixture.reply", id: command.id, value: await engine!.send(command.method, command.route, command.body) }); return }
    if (command.type === "fixture.stop") { await engine?.close(); credentials.stop(); process.exit(0) }
  } catch (error) {
    post({ type: "fixture.error", id: command.id, error: String(error) })
    if (command.type === "fixture.start") { credentials.stop(); process.exit(1) }
  }
})
const bootstrap = codepuppyBootstrap()
post({ type: "fixture.prepared", sandbox, userData: host.userData, globalRoot: bootstrap.paths.globalRoot, project: host.projectDirectory, config: host.slot.configDirectory,
  connector: { trigger: join(host.projectDirectory, "connector-trigger.txt"), results: join(host.projectDirectory, "connector-results.jsonl") }, env: Object.fromEntries(["HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "TMPDIR"].map((key) => [key, process.env[key]])) })
