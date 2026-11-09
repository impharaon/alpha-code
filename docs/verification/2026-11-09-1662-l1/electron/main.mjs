// alpha-code#1662 L1a — minimal Electron 42.3.3 main: fork ONE utilityProcess (utility.mjs), drive the embedded
// OpenCode 2 engine over HTTP from outside the fence, and write every raw result to cfg.outFile.
// No BrowserWindow, no session/net/safeStorage use. Refuses to run unless the keychain is mocked and every
// per-user root points into the temp tree (see the guard block).
import { app, utilityProcess } from "electron"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const cfg = JSON.parse(readFileSync(process.env.AC1662_RUN_CONFIG, "utf8"))

// ── guard: isolation must be in force before Electron touches anything ─────────────────────────
const refuse = (why) => {
  console.error(`ac1662 REFUSING TO RUN: ${why}`)
  process.exit(3)
}
if (!app.commandLine.hasSwitch("use-mock-keychain")) refuse("--use-mock-keychain missing (Chromium would reach the real keychain)")
for (const key of ["HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"])
  if (!(process.env[key] ?? "").startsWith(cfg.tempRoot)) refuse(`${key}=${process.env[key]} is outside ${cfg.tempRoot}`)
for (const [name, path] of Object.entries(cfg.electronPaths)) app.setPath(name, path)
app.dock?.hide()

const results = { arm: cfg.arm, startedAt: new Date().toISOString(), steps: {} }
const utilityLog = []
const finish = (code) => {
  results.finishedAt = new Date().toISOString()
  // countsOnly (L1b, owner data): engine logs can echo titles/text — keep line counts only, never the lines.
  const lines = utilityLog.join("").split("\n")
  if (cfg.countsOnly) {
    delete results.utilityLog
    results.utilityLogCounts = { lines: lines.length, warn: lines.filter((l) => / WARN /.test(l)).length, error: lines.filter((l) => / ERROR /.test(l)).length }
  } else writeFileSync(cfg.outFile.replace(/\.json$/, ".utility.log"), utilityLog.join(""))
  writeFileSync(cfg.outFile, JSON.stringify(results, null, 2))
  console.log(`ac1662 wrote ${cfg.outFile}`)
  app.exit(code)
}
// L1b (countsOnly) converts a real-size database: give the conversion room before the watchdog.
const watchdogMs = cfg.countsOnly ? 900_000 : 240_000
setTimeout(() => {
  results.watchdog = `fired after ${watchdogMs / 1000} s`
  finish(2)
}, watchdogMs).unref()

app.whenReady().then(async () => {
  const child = utilityProcess.fork(join(dirname(fileURLToPath(import.meta.url)), "utility.mjs"), [], {
    serviceName: "ac1662-engine",
    env: cfg.utilityEnv,
    cwd: cfg.utilityCwd,
    stdio: "pipe",
  })
  const log = utilityLog
  child.stdout?.on("data", (c) => log.push(c.toString()))
  child.stderr?.on("data", (c) => log.push(c.toString()))
  let seq = 0
  const waiters = new Map()
  let ready
  const readyPromise = new Promise((resolve) => (ready = resolve))
  child.on("message", (m) => {
    if (m.type === "ready" || (m.type === "error" && m.id === undefined)) return ready(m)
    waiters.get(m.id)?.(m)
    waiters.delete(m.id)
  })
  child.on("exit", (code) => {
    results.utilityExit = code
    ready({ type: "error", error: { message: `utility exited ${code}` } })
  })
  const ask = (cmd) => new Promise((resolve) => {
    const id = ++seq
    waiters.set(id, resolve)
    child.postMessage({ ...cmd, id })
  })
  const auth = `Basic ${Buffer.from(`opencode:${cfg.password}`).toString("base64")}`
  const http = async (method, path, body) => {
    const r = await fetch(`http://127.0.0.1:${cfg.port}${path}`, {
      method,
      headers: { authorization: auth, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await r.text()
    return { status: r.status, body: parse(text) }
  }
  const step = async (name, fn) => {
    try {
      results.steps[name] = await fn()
    } catch (e) {
      results.steps[name] = { threw: String(e?.stack ?? e) }
    }
  }

  child.postMessage({
    type: "start",
    port: cfg.port,
    password: cfg.password,
    databasePath: cfg.databasePath,
    configContent: JSON.stringify(cfg.engineConfig),
    engineBundle: cfg.engineBundle,
    fence: cfg.fence,
    fenceModule: cfg.fenceModule,
    skipEnvProxy: cfg.arm === "armCraw",
    route: cfg.arm.startsWith("armF") ? "fetch" : "transform",
  })
  const boot = await readyPromise
  results.boot = boot
  if (boot.type !== "ready") {
    results.utilityLog = log.join("").slice(-6000)
    return finish(1)
  }
  await step("info", () => http("GET", "/api/info"))

  if (cfg.mode === "e1e2") {
    const events = []
    const sse = fetch(`http://127.0.0.1:${cfg.port}/api/event`, { headers: { authorization: auth } }).then(async (r) => {
      const reader = r.body.getReader()
      let buffer = ""
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        buffer += Buffer.from(value).toString()
        const frames = buffer.split("\n\n")
        buffer = frames.pop()
        for (const f of frames) for (const line of f.split("\n")) if (line.startsWith("data: ")) events.push(parse(line.slice(6)))
      }
    }).catch((e) => events.push({ sseError: String(e) }))
    void sse
    await new Promise((r) => setTimeout(r, 500))
    const location = { directory: cfg.workspace }

    // E1 — one reply through /api/session/:id/prompt against the loopback stub.
    await step("e1", async () => {
      const created = await http("POST", "/api/session", { title: "ac1662 E1", model: { id: "stub-model", providerID: "stub" }, location })
      const id = created.body?.data?.id
      const prompt = await http("POST", `/api/session/${id}/prompt`, { text: "ac1662 E1: say hello" })
      const deadline = Date.now() + 60_000
      let messages
      while (Date.now() < deadline) {
        messages = await http("GET", `/api/session/${id}/message`)
        const text = JSON.stringify(messages.body)
        if (text.includes(cfg.stubReply) || /"error"|"failed"|"Error"/.test(text.replace(/"error":null/g, ""))) break
        await new Promise((r) => setTimeout(r, 500))
      }
      return { created: created.status, sessionID: id, prompt, replied: JSON.stringify(messages?.body ?? "").includes(cfg.stubReply), messages: messages?.body }
    })

    // E2 — is the Transform-captured fetch the listener's graph? Discriminator: the volatile in-memory event bus.
    await step("e2", async () => {
      const mark = Date.now().toString(36)
      const same = await ask({ type: "inproc", graph: "same", method: "POST", path: "/api/session", body: { title: `ac1662 E2 same ${mark}`, location } })
      const sep = await ask({ type: "inproc", graph: "separate", method: "POST", path: "/api/session", body: { title: `ac1662 E2 separate ${mark}`, location } })
      const viaHttp = await http("POST", "/api/session", { title: `ac1662 E2 http ${mark}`, location })
      await new Promise((r) => setTimeout(r, 2000))
      const sameID = parse(same.body)?.data?.id
      const sepID = parse(sep.body)?.data?.id
      const httpID = viaHttp.body?.data?.id
      const sawOnListenerBus = (id) => events.some((e) => e?.type === "session.created" && JSON.stringify(e).includes(id))
      return {
        inprocSame: { status: same.status, id: sameID, listenerSseSawCreated: sawOnListenerBus(sameID), httpGet: (await http("GET", `/api/session/${sameID}`)).status },
        inprocSeparate: { status: sep.status, id: sepID, listenerSseSawCreated: sawOnListenerBus(sepID), httpGet: (await http("GET", `/api/session/${sepID}`)).status },
        httpCreate: { status: viaHttp.status, id: httpID, listenerSseSawCreated: sawOnListenerBus(httpID), inprocSameGet: (await ask({ type: "inproc", graph: "same", method: "GET", path: `/api/session/${httpID}` })).status },
        eventTypesSeen: [...new Set(events.map((e) => e?.type ?? Object.keys(e ?? {})[0]))],
      }
    })

    // Orchestrator round 1: route 2 (ServerFetch.make) does not fork the Schedule runner (process.ts:119).
    // Measure it: a one-shot schedule due in 5 s; does it fire (stub gets a request, runCount moves)?
    if (!cfg.fence) {
      await step("schedule", async () => {
        const sessionID = results.steps.e1?.sessionID
        const stubBefore = readFileSync(cfg.stubLog, "utf8").split("\n").filter(Boolean).length
        const created = await http("POST", "/api/experimental/schedule", { sessionID, when: { in: "5 seconds" }, prompt: "ac1662 scheduled wake" })
        await new Promise((r) => setTimeout(r, 25_000))
        const id = created.body?.data?.id
        const after = await http("GET", `/api/experimental/schedule/${id}`)
        const stubAfter = readFileSync(cfg.stubLog, "utf8").split("\n").filter(Boolean).length
        return { created: created.status, createBody: created.status === 200 ? undefined : created.body, after: after.body?.data ?? after.body, stubRequestsBefore: stubBefore, stubRequestsAfter: stubAfter }
      })
    }

    if (cfg.fence) {
      await step("selfConnect", () => ask({ type: "selfconnect", port: cfg.port }))
      // Does the engine's model client route through HTTPS_PROXY (the fence's only door)? Non-loopback target.
      await step("proxyProbe", async () => {
        const created = await http("POST", "/api/session", { title: "ac1662 proxy probe", model: { id: "probe-model", providerID: "probe" }, location })
        const id = created.body?.data?.id
        const prompt = await http("POST", `/api/session/${id}/prompt`, { text: "ac1662 proxy probe" })
        await new Promise((r) => setTimeout(r, 15_000))
        const messages = await http("GET", `/api/session/${id}/message`)
        return { prompt: prompt.status, messages: messages.body }
      })
    }
  }

  if (cfg.mode === "e3") {
    await step("e3", async () => {
      const deadline = Date.now() + (cfg.countsOnly ? 780_000 : 90_000)
      const statuses = []
      while (Date.now() < deadline) {
        const s = await http("GET", "/api/experimental/migration/v1")
        statuses.push(s.body)
        if (s.body?.status === "completed" || s.body?.status === "error") break
        await new Promise((r) => setTimeout(r, 500))
      }
      const list = await http("GET", "/api/session?limit=100")
      const sessions = list.body?.data ?? []
      const perSession = []
      for (const s of sessions) {
        const m = await http("GET", `/api/session/${s.id}/message`)
        const data = m.body?.data ?? []
        perSession.push(cfg.countsOnly ? { messages: data.length, types: data.map((x) => x.type) } : { id: s.id, title: s.title, messages: data.length, types: data.map((x) => x.type) })
      }
      return { statuses: statuses.slice(-3), statusPolls: statuses.length, listStatus: list.status, sessionCount: sessions.length, perSession, sample: perSession.length && !cfg.countsOnly ? (await http("GET", `/api/session/${sessions[0].id}/message`)).body : null }
    })
  }

  results.utilityLog = log.join("").slice(-6000)
  await ask({ type: "stop" })
  finish(0)
})

function parse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
