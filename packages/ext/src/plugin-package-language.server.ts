// Controlled stdio language server for plugin-package-language tests. It speaks standard LSP framing and
// records its own lifecycle; it is not a stand-in for pyright's analysis, only for the protocol boundary.
import { appendFileSync } from "node:fs"

const recordFile = process.env.LSP_FIXTURE_RECORD
const note = (event: Record<string, unknown>) => { if (recordFile) appendFileSync(recordFile, JSON.stringify({ pid: process.pid, ...event }) + "\n") }
const write = (message: Record<string, unknown>) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }))
  process.stdout.write(Buffer.concat([Buffer.from("Content-Length: " + body.length + "\r\n\r\n"), body]))
}
const diagnostics = (text: string, message = 'Type "str" is not assignable to declared type "int"') =>
  text.split("\n").flatMap((line, index) => {
    const match = /^(\s*)\w+\s*:\s*int\s*=\s*"/.exec(line)
    return match ? [{ range: { start: { line: index, character: match[1]!.length }, end: { line: index, character: line.length } }, severity: 1, source: "fixture", code: "reportAssignmentType", message }] : []
  })
const publish = (uri: string, version: number, text: string) => {
  // `# fixture: delay=N` publishes this version N ms later, modelling a slow or late server answer.
  const delay = Number(/# fixture: delay=(\d+)/.exec(text)?.[1] ?? 0)
  if (delay) return void setTimeout(() => write({ method: "textDocument/publishDiagnostics", params: { uri, version, diagnostics: diagnostics(text) } }), delay)
  write({ method: "textDocument/publishDiagnostics", params: { uri, version, diagnostics: diagnostics(text) } })
  if (!text.includes("# fixture: stale")) return
  write({ method: "textDocument/publishDiagnostics", params: { uri, version: version - 1, diagnostics: diagnostics(text, "stale versioned") } })
  write({ method: "textDocument/publishDiagnostics", params: { uri, diagnostics: diagnostics(text, "stale unversioned") } })
}

note({ event: "start", argv: process.argv.slice(2) })
// LSP_FIXTURE_MODE=silent never answers; hang-on-shutdown ignores shutdown, exit and end of input.
const mode = process.env.LSP_FIXTURE_MODE
let buffer = Buffer.alloc(0)
let sequence = 0
process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n")
    if (end < 0) return
    const length = Number(/content-length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())?.[1])
    if (buffer.length < end + 4 + length) return
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString())
    buffer = buffer.subarray(end + 4 + length)
    if (mode === "silent" || mode === "hang-on-shutdown" && (message.method === "shutdown" || message.method === "exit")) { note({ event: "ignored", method: message.method }); continue }
    if (message.method === "initialize") {
      note({ event: "initialize", rootUri: message.params.rootUri, initializationOptions: message.params.initializationOptions })
      write({ id: message.id, result: { capabilities: { textDocumentSync: 1 } } })
    } else if (message.method === "initialized") write({ id: "configuration-" + ++sequence, method: "workspace/configuration", params: { items: [{ section: "python" }] } })
    else if (typeof message.id === "string" && message.id.startsWith("configuration-")) note({ event: "configuration", result: message.result })
    else if (message.method === "workspace/didChangeConfiguration") note({ event: "didChangeConfiguration", settings: message.params.settings })
    else if (message.method === "textDocument/didOpen") { note({ event: "didOpen", uri: message.params.textDocument.uri, version: message.params.textDocument.version, languageId: message.params.textDocument.languageId }); publish(message.params.textDocument.uri, message.params.textDocument.version, message.params.textDocument.text) }
    else if (message.method === "textDocument/didChange") { note({ event: "didChange", uri: message.params.textDocument.uri, version: message.params.textDocument.version }); publish(message.params.textDocument.uri, message.params.textDocument.version, message.params.contentChanges.at(-1).text) }
    else if (message.method === "textDocument/didClose") note({ event: "didClose", uri: message.params.textDocument.uri })
    else if (message.method === "shutdown") { note({ event: "shutdown" }); write({ id: message.id, result: null }) }
    else if (message.method === "exit") { note({ event: "exit" }); process.exit(0) }
  }
})
process.stdin.on("end", () => { if (mode !== "hang-on-shutdown") process.exit(0) })
if (mode === "hang-on-shutdown" || mode === "silent") setInterval(() => {}, 1000)
