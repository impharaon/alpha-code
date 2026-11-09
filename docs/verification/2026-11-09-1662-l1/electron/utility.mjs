// alpha-code#1662 L1a — the utilityProcess side, in sidecar.ts order: fence FIRST (Code Puppy's
// applyProcessFence, unchanged), THEN import the OpenCode 2 bundle and call start(). No v1 code, no ext.
import http from "node:http"
import { Readable } from "node:stream"
import { pathToFileURL } from "node:url"

const parent = process.parentPort
if (!parent) throw new Error("not a utilityProcess")
const post = (message) => parent.postMessage(message)
let engine
let separate
let auth

parent.on("message", async (event) => {
  const cmd = event.data
  try {
    if (cmd.type === "start") return post({ type: "ready", ...(await start(cmd)) })
    if (cmd.type === "inproc") {
      const fetcher = cmd.graph === "separate" ? (separate ??= await engine.separateGraphFetch()) : engine.inProcessFetch
      const response = await fetcher(
        new Request(`http://in-process${cmd.path}`, {
          method: cmd.method,
          headers: { authorization: auth, "content-type": "application/json" },
          body: cmd.body === undefined ? undefined : JSON.stringify(cmd.body),
        }),
      )
      return post({ type: "result", id: cmd.id, status: response.status, body: await response.text() })
    }
    if (cmd.type === "selfconnect") {
      // TCP from inside the (possibly fenced) process to its own listener — #1531's shape.
      const outcome = await fetch(`http://127.0.0.1:${cmd.port}/api/info`, { headers: { authorization: auth }, signal: AbortSignal.timeout(5000) }).then(
        (r) => ({ ok: true, status: r.status }),
        (e) => ({ ok: false, error: `${e?.name}: ${e?.message}; cause=${e?.cause?.code ?? e?.cause?.message ?? ""}` }),
      )
      return post({ type: "result", id: cmd.id, ...outcome })
    }
    if (cmd.type === "stop") {
      await engine?.close()
      post({ type: "stopped", id: cmd.id })
      setImmediate(() => process.exit(0))
    }
  } catch (error) {
    post({ type: "error", id: cmd.id, error: { message: String(error?.message ?? error), stack: error?.stack } })
  }
})

async function start(cmd) {
  auth = `Basic ${Buffer.from(`opencode:${cmd.password}`).toString("base64")}`
  let fence = null
  if (cmd.fence) {
    const { applyProcessFence } = await import(pathToFileURL(cmd.fenceModule).href)
    fence = applyProcessFence(cmd.fence)
  }
  // sidecar.ts useEnvProxy(): route fetch/http through HTTP(S)_PROXY (the fence's only door). No-op without proxy env.
  // cmd.skipEnvProxy = negative control (arm armCraw): leave the call out and see where model traffic goes.
  const envProxy = !cmd.skipEnvProxy && typeof http.setGlobalProxyFromEnv === "function"
  if (envProxy) http.setGlobalProxyFromEnv()
  const t0 = Date.now()
  const bundle = await import(pathToFileURL(cmd.engineBundle).href)
  const options = { port: cmd.port, password: cmd.password, databasePath: cmd.databasePath, configContent: cmd.configContent }
  engine = cmd.route === "fetch" ? await serveFetchOnly(bundle, options) : await bundle.startEngine(options)
  return { route: cmd.route ?? "transform", fence, envProxy, bootMs: Date.now() - t0, address: engine.address, versions: { node: process.versions.node, electron: process.versions.electron, modules: process.versions.modules } }
}

// Route 2: Code Puppy's own Node listener in front of ServerFetch.make's handler; in-process calls use the SAME handler.
async function serveFetchOnly(bundle, options) {
  const graph = await bundle.startFetchOnly(options)
  const server = http.createServer(async (req, res) => {
    const controller = new AbortController()
    res.on("close", () => res.writableFinished || controller.abort())
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value)
    const hasBody = req.method !== "GET" && req.method !== "HEAD"
    const response = await graph.handler(
      new Request(`http://${req.headers.host ?? "127.0.0.1"}${req.url}`, { method: req.method, headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: "half", signal: controller.signal }),
    )
    res.writeHead(response.status, Object.fromEntries(response.headers))
    if (!response.body) return res.end()
    Readable.fromWeb(response.body).pipe(res)
  })
  await new Promise((resolve) => server.listen(options.port, "127.0.0.1", resolve))
  return {
    address: server.address(),
    inProcessFetch: graph.handler,
    separateGraphFetch: graph.separateGraphFetch,
    close: async () => {
      server.closeAllConnections()
      server.close()
      await graph.close()
    },
  }
}
