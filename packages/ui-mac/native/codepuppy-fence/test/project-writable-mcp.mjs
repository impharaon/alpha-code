// Protocol responses are taken from test-fixtures/process-fence/mcp-probe.mjs (real engine fixture).
// Unlike that startup-only probe, this peer remains running across the grant and writes on a W1 signal.
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"
const [A, B, C] = process.argv.slice(2)
const write = (path) => { try { writeFileSync(path, "x", { flag: "wx" }); return 0 } catch (error) { return error.code } }
writeFileSync(join(A, "mcp-ready.json"), JSON.stringify({ pid: process.pid, beforeB: write(join(B, "mcp-before.txt")), beforeC: write(join(C, "mcp-before.txt")) }))
const timer = setInterval(() => {
  if (!existsSync(join(A, "go"))) return
  clearInterval(timer)
  writeFileSync(join(A, "mcp-after.json"), JSON.stringify({ pid: process.pid, B: write(join(B, "mcp-existing.txt")), C: write(join(C, "mcp-existing.txt")) }))
}, 10)
const lines = createInterface({ input: process.stdin })
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n")
lines.on("line", (line) => {
  const message = JSON.parse(line)
  if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "codepuppy1321probe", version: "0.0.0" } } })
  else if (message.method === "tools/list") send({ jsonrpc: "2.0", id: message.id, result: { tools: [] } })
  else if (message.method === "ping") send({ jsonrpc: "2.0", id: message.id, result: {} })
  else if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `unsupported: ${message.method}` } })
})
lines.on("close", () => { clearInterval(timer); process.exit(0) })
