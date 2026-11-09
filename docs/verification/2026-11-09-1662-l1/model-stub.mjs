// alpha-code#1662 L1a — loopback OpenAI-compatible model stub. No upstream model is ever contacted.
// Usage: node model-stub.mjs <port> <logfile> [<cert.pem> <key.pem>]   (TLS when a cert is given)
// Answers POST …/chat/completions (stream or not) with the fixed text below; logs one JSON line per request.
import { appendFileSync, readFileSync } from "node:fs"
import { createServer } from "node:http"
import { createServer as createTlsServer } from "node:https"

const port = Number(process.argv[2])
const logFile = process.argv[3]
const REPLY = "ac1662-stub-reply: hello from the loopback stub"
let n = 0
const tls = process.argv[4] ? { cert: readFileSync(process.argv[4]), key: readFileSync(process.argv[5]) } : undefined

;(tls ? (handler) => createTlsServer(tls, handler) : createServer)((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    const parsed = body ? safeJson(body) : undefined
    appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url, model: parsed?.model, stream: parsed?.stream, messages: parsed?.messages?.length }) + "\n")
    if (req.method === "GET" && req.url.endsWith("/models")) return json(res, { object: "list", data: [{ id: "stub-model", object: "model", owned_by: "ac1662" }] })
    if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) return json(res, { error: { message: `stub: unhandled ${req.method} ${req.url}` } }, 404)
    const id = `chatcmpl-ac1662-${++n}`
    // A user turn containing "ac1662-tool" gets ONE `bash` tool call back (the v1 seed uses it so the converted
    // history holds a renamed tool — the path that reaches v1-migration's Bun.CryptoHasher call).
    const last = parsed?.messages?.at(-1)
    const wantsTool = last?.role === "user" && JSON.stringify(last.content ?? "").includes("ac1662-tool")
    const created = Math.floor(Date.now() / 1000)
    const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
    if (wantsTool && parsed?.stream) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
      const call = (delta, finish) => res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: parsed.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
      call({ role: "assistant", content: null, tool_calls: [{ index: 0, id: `call_ac1662_${n}`, type: "function", function: { name: "bash", arguments: "" } }] }, null)
      call({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ command: "echo ac1662-tool-ran", description: "ac1662 probe" }) } }] }, null)
      call({}, "tool_calls")
      return res.end("data: [DONE]\n\n")
    }
    if (!parsed?.stream)
      return json(res, { id, object: "chat.completion", created, model: parsed?.model ?? "stub-model", choices: [{ index: 0, message: { role: "assistant", content: REPLY }, finish_reason: "stop" }], usage })
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
    const chunk = (delta, finish, extra = {}) =>
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: parsed.model ?? "stub-model", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`)
    chunk({ role: "assistant", content: "" }, null)
    chunk({ content: REPLY }, null)
    chunk({}, "stop", { usage })
    res.end("data: [DONE]\n\n")
  })
}).listen(port, "127.0.0.1", () => console.log(`stub listening ${port}${tls ? " (tls)" : ""}`))

function json(res, value, status = 200) {
  const text = JSON.stringify(value)
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) })
  res.end(text)
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
