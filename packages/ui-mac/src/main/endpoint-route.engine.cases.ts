import { testEgressDial } from "../../test-component/egress-upstream-fixture"
import { expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import https from "node:https"
import net from "node:net"
import path from "node:path"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Socket } from "node:net"
import type { ConfigProvider } from "@opencode/schema/config/provider"
import type { CodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import type { EgressLogRecord, EgressProxyHandle } from "./network-egress-proxy"
import { mockElectron } from "../../test-component/electron-mock"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, textOf } from "../../test-component/codepuppy-engine"
import { CODEPUPPY_ENDPOINTS } from "../shared/codepuppy-config"

// Every host invocation selects one case in a fresh process: global engine services, the fetch
// implementation, keep-alive pools and the main proxy singleton cannot leak across cases.
const sandbox = engineSandbox()
const name = "relay-live"
const userData = path.join(sandbox.root, `${name}-userdata`)
const preferred = { platform: "https://model-relay.test", cloud: "https://cloud-relay.test" }
const modelKey = `sk-cp-${name}`
const cloudKey = "relay-cloud-sentinel"
const requestBudget = 500
// Same transport-only image sample as ext/cloud-vision.test.ts; no image decoding is under test.
const image = { base64: "QUJD", mime: "image/jpeg" as const, bytes: 3, width: 1, height: 1, quality: 85, sourceWidth: 1, sourceHeight: 1 }
const health = await Bun.file(new URL("./fixtures/relay-route/health-cloud.json", import.meta.url)).text()
const accepted = (await Bun.file(new URL("../../../codepuppy-contracts-consumer/vendor/alpha-platform/contracts/v1/fixtures/producer/cloud-job-accepted.json", import.meta.url)).json()).value
const originalFetch = globalThis.fetch
let proxy: EgressProxyHandle | undefined
const proxyRecords: EgressLogRecord[] = []
const dialPorts = new Map<string, number>()
let start: CodePuppyBootstrap | undefined
class Child extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  postMessage(message: { type: string; bootstrap?: CodePuppyBootstrap }) {
    if (message.type === "start") { start = message.bootstrap; queueMicrotask(() => this.emit("message", { type: "ready" })) }
    if (message.type === "stop") queueMicrotask(() => this.emit("exit", 0))
  }
  kill() { queueMicrotask(() => this.emit("exit", 0)) }
}
mockElectron(() => ({ app: { isPackaged: false, on: () => {}, off: () => {}, getPath: () => userData, getVersion: () => "test" }, utilityProcess: { fork: () => new Child() }, BrowserWindow: class {}, dialog: {}, ipcMain: { handle: () => {} } }))
mock.module("./logging", () => ({ getLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} }), write: () => {}, rotateServerLogs: () => {} }))
mock.module("./store", () => ({ getStore: () => ({ get: () => null, set: () => {}, delete: () => {} }) }))
mock.module("./codepuppy-keychain-backend", () => ({ keychainBackend: () => ({ isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() }) }))
const { startEgressPolicyProxy } = await import("./network-egress-proxy")
mock.module("./network-egress-proxy", () => ({ startEgressPolicyProxy: async (deps: Parameters<typeof startEgressPolicyProxy>[0]) => {
  proxy = await startEgressPolicyProxy({ resolveEgressRoutes: async () => [{ kind: "direct" }], ...deps, log: (record) => { proxyRecords.push(record); deps.log(record) }, dial: testEgressDial((host) => {
    const port = dialPorts.get(host)
    if (!port) throw new Error("nonfixture proxy destination refused")
    return net.connect({ host: "127.0.0.1", port })
  }) })
  return proxy
} }))
const { initCodePuppyEnvironment } = await import("./codepuppy-environment")
const { initEndpoints, currentRoute, relayConfigured, noteRelayFailureSignal } = await import("./codepuppy-endpoints")
const { spawnLocalServer } = await import("./server")
const { creditDanglingSweepForSpawn } = await import("./dangling-sweep-latch")
const { syncSecretFiles } = await import("./codepuppy-secret-files")
const { initByokKeys, storeByokKey } = await import("./codepuppy-byok-keys")
const { writeCustomProviderTruth } = await import("./custom-provider-truth-write")
const { CLOUD_MCP_TOOL_LIST } = await import("./fixtures/cloud-mcp-tools")
const { cloudVisionAccess, describeImage } = await import("../../../ext/src/cloud-vision")
const { createEngineFetch } = await import("../engine-adapter")
const { codepuppyBootstrap } = await import("@opencode/util/codepuppy-bootstrap")
const { Provider } = await import("../../../core/src/provider")

const until = async (check: () => boolean | Promise<boolean>, budget = 5000) => {
  const end = Date.now() + budget
  while (!(await check()) && Date.now() < end) await Bun.sleep(20)
  expect(await check()).toBe(true)
}
const chunk = (delta: Record<string, unknown>, finish: string | null = null) => `data: ${JSON.stringify({ id: "chatcmpl-cp-engine", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

type Wire = { at: number; target: string; host: string; path: string; method: string; credential: "model" | "cloud" | "byok" | "other"; body: string }
async function startFixture(label: string, options: { directOnly?: boolean; lookalikes?: boolean } = {}) {
  await assertEngineSandboxed(sandbox)
  for (const key of ["BASE_URL", "CLOUD_MCP_URL", "GLOBAL_DIR", "API_KEY", "MCP_TOKEN", "WEB_URL", "PLATFORM_URL", "ACCOUNT_URL", "CLOUD_URL", "MCP_URL"]) delete process.env[`CODEPUPPY_${key}`]
  const environment = initCodePuppyEnvironment({ isPackaged: false, channel: "dev", appDataDir: path.join(sandbox.root, `${name}-state`), homeDir: sandbox.home })
  const defaults = Provider.timeouts({})
  console.log(`RELAY_EVIDENCE ${label} defaults_header_ms=${defaults.headerTimeout} defaults_chunk_ms=${defaults.chunkTimeout} fixture_provider_budget_ms=${requestBudget} retry_policy=unchanged`)
  const timeline: Array<{ at: number; event: string; [key: string]: unknown }> = []
  const log = (event: string, fields: Record<string, unknown> = {}) => timeline.push({ at: Date.now(), event, ...fields })
  const wire: Wire[] = []
  const retries: Array<{ at: number; attempt: number; timeout: boolean; delay: number | undefined }> = []
  const sockets = new Set<Socket>()
  const tlsDir = path.join(sandbox.root, "tls")
  fs.mkdirSync(tlsDir)
  const generated = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-keyout", path.join(tlsDir, "key.pem"), "-out", path.join(tlsDir, "cert.pem")], { stdout: "pipe", stderr: "pipe" })
  expect(generated.exitCode).toBe(0)
  const tls = { key: fs.readFileSync(path.join(tlsDir, "key.pem")), cert: fs.readFileSync(path.join(tlsDir, "cert.pem")) }
  let probes = 0
  let healthReplies = 0
  let stall: "headers" | "body" | undefined
  let cloudFault = false
  let stalled = 0
  // Wire provenance: scriptedModel / ext/cloud-vision.test.ts; tool definitions and
  // accepted job receipts are real vendored platform fixtures. Faults are transport-only.
  const handle = (target: string) => async (request: IncomingMessage, response: ServerResponse) => {
    const pathname = new URL(request.url!, "https://fixture.test").pathname
    if (pathname === "/health") {
      response.writeHead(cloudFault && target === "cloud-relay" ? 502 : 200, { "content-type": "application/json" })
      response.end(health)
      healthReplies++
      return
    }
    const parts: Buffer[] = []
    for await (const part of request) parts.push(Buffer.from(part))
    const body = Buffer.concat(parts).toString()
    const credential = request.headers.authorization === `Bearer ${modelKey}` ? "model" : request.headers.authorization === `Bearer ${cloudKey}` ? "cloud" : request.headers.authorization?.startsWith("Bearer byok-") ? "byok" : "other"
    const host = new URL(`https://${request.headers.host}`).hostname
    wire.push({ at: Date.now(), target, host, path: pathname, method: request.method!, credential, body })
    log("request.start", { target, path: pathname, credential })
    response.on("close", () => log("response.close", { target, path: pathname, completed: response.writableEnded }))
    if (pathname === "/v1/tools/vision") {
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ text: "fixture transcription", model: "qwen", fallback_used: false })); return
    }
    if (pathname === "/mcp") {
      if (request.method === "GET") { response.writeHead(405); response.end(); return }
      if (request.method !== "POST") { response.end(); return }
      const message = JSON.parse(body) as { id?: string | number; method: string; params?: { protocolVersion?: string } }
      if (message.id === undefined) { response.writeHead(202); response.end(); return }
      const result = message.method === "initialize" ? { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture-cloud", version: "1" } } : message.method === "tools/list" ? { tools: CLOUD_MCP_TOOL_LIST } : { content: [{ type: "text", text: JSON.stringify(accepted) }] }
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result })); return
    }
    if (!pathname.endsWith("/chat/completions")) { response.writeHead(404); response.end(); return }
    const fault = stall
    stall = undefined
    if (fault) { stalled++; log("request.stall", { fault, target }) }
    if (fault === "headers") return
    response.writeHead(200, { "content-type": "text/event-stream" })
    if (fault === "body") { response.write(chunk({ role: "assistant", content: "partial" })); return }
    const messages = (JSON.parse(body) as { messages: Array<{ role: string; content?: unknown }> }).messages
    const call = textOf(messages.filter((message) => message.role === "user").at(-1)?.content).match(/CP-CALL (\{.*\})/)
    if (call && messages.at(-1)?.role !== "tool") {
      const invocation = JSON.parse(call[1]!) as { name: string; args: Record<string, unknown> }
      response.end(chunk({ role: "assistant", tool_calls: [{ index: 0, id: `call_${crypto.randomUUID()}`, type: "function", function: { name: invocation.name, arguments: JSON.stringify(invocation.args) } }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n"); return
    }
    response.end(chunk({ role: "assistant", content: "ok" }) + chunk({}, "stop") + "data: [DONE]\n\n")
  }
  const targets = new Map<string, { server: https.Server; port: number }>()
  const open = async (target: string, port = 0) => {
    const server = https.createServer(tls, (request, response) => { void handle(target)(request, response) })
    server.on("connection", (socket) => { sockets.add(socket); log("connection.open", { target, count: sockets.size }); socket.on("close", () => { sockets.delete(socket); log("connection.close", { target, count: sockets.size }) }) })
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve))
    const listening = { server, port: (server.address() as net.AddressInfo).port }
    targets.set(target, listening)
    log("server.start", { target, port: listening.port })
    return listening
  }
  const closeTarget = async (target: string) => {
    const current = targets.get(target)!
    const closed = new Promise<void>((resolve) => current.server.close(() => resolve()))
    current.server.closeAllConnections()
    await closed
    log("server.stop", { target, connections: sockets.size })
    return current.port
  }
  for (const target of ["model-relay", "cloud-relay", "model-direct", "cloud-direct"]) await open(target)
  dialPorts.set(new URL(preferred.platform).hostname, targets.get("model-relay")!.port)
  dialPorts.set(new URL(preferred.cloud).hostname, targets.get("cloud-relay")!.port)
  dialPorts.set(new URL(CODEPUPPY_ENDPOINTS.platform).hostname, targets.get("model-direct")!.port)
  dialPorts.set(new URL(CODEPUPPY_ENDPOINTS.cloud).hostname, targets.get("cloud-direct")!.port)
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return originalFetch(input, init)
    if (!dialPorts.has(url.hostname)) throw new Error("nonfixture network refused")
    if (url.pathname === "/health") probes++
    log("fetch.start", { host: url.hostname, path: url.pathname })
    init?.signal?.addEventListener("abort", () => log("fetch.abort", { host: url.hostname, path: url.pathname }), { once: true })
    // CONNECT preserves the logical URL, headers, body and signal. Only the policy proxy's test
    // dial maps fixture hosts to loopback; no production hostname reaches DNS.
    return originalFetch(input, { ...init, proxy: `http://127.0.0.1:${proxy!.port}`, tls: { rejectUnauthorized: false } })
  }) as typeof fetch
  fs.mkdirSync(userData)
  fs.writeFileSync(path.join(userData, "codepuppy-endpoints.json"), JSON.stringify(options.directOnly ? {} : preferred))
  // No network is started before the proxy: initialize with an explicit default override, capture
  // inherited engine exports, then activate the pinned route after production proxy assembly.
  process.env.CODEPUPPY_PLATFORM_URL = CODEPUPPY_ENDPOINTS.platform
  initEndpoints(userData, () => {})
  delete process.env.CODEPUPPY_PLATFORM_URL
  process.env.CODEPUPPY_BASE_URL = `${options.directOnly ? CODEPUPPY_ENDPOINTS.platform : preferred.platform}/v1`
  process.env.CODEPUPPY_CLOUD_MCP_URL = `${options.directOnly ? CODEPUPPY_ENDPOINTS.cloud : preferred.cloud}/mcp`
  process.env.CODEPUPPY_API_KEY = modelKey
  process.env.CODEPUPPY_MCP_TOKEN = cloudKey
  const lookalikes = options.lookalikes ? { "look-suffix": "https://model-relay.test.evil/v1", "look-path": "https://model-relay.test/v1x", "look-byok": "https://byok.test/v1" } : {}
  initByokKeys(userData)
  writeCustomProviderTruth(path.join(environment.casBaseRoot, "custom-providers", "dev.json"), Object.entries(lookalikes).map(([id, baseURL]) => ({ id, name: id, compat: "openai", baseURL, models: ["m"] })), { mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, rmSync: fs.rmSync })
  for (const [id, base] of Object.entries(lookalikes)) {
    expect(storeByokKey(id, `byok-${id}`).ok).toBe(true)
    dialPorts.set(new URL(base).hostname, targets.get("model-relay")!.port)
  }
  syncSecretFiles(userData, { CODEPUPPY_API_KEY: modelKey, CODEPUPPY_MCP_TOKEN: cloudKey })
  creditDanglingSweepForSpawn()
  const generation = await spawnLocalServer("127.0.0.1", 0, "test", { userDataPath: userData, fork: () => new Child() as never, healthCheck: async () => true, planFence: () => ({ profile: "(version 1)\n(allow default)", addonPath: "/unused" }) })
  await generation.health.wait
  await generation.listener.stop()
  initEndpoints(userData, () => {}, (line) => log("route", { line }))
  await until(() => options.directOnly || healthReplies === 2)
  const host = codepuppyEngine({ sandbox, name, modelBaseURL: start!.platform.modelProxyBaseURL!, directModelProxyBaseURL: start!.platform.directModelProxyBaseURL, routeRef: start!.platform.routeRef, cloudMcp: start!.cloudMcp })
  // Existing pre-start content seam; provider-only timeout fields are deliberately not placed on
  // a model (Provider.modelSettings strips them). The real retry schedule remains untouched.
  const provider = host.content.providers.codepuppy! as ConfigProvider.Info
  Object.assign(provider, { settings: { ...provider.settings, headerTimeout: requestBudget, chunkTimeout: requestBudget } })
  const running = await host.start()
  const { probe } = await import("../../test-component/codepuppy-engine")
  const effective = (await probe().ctx.provider.get({ providerID: "codepuppy" })).data
  expect(effective.settings.headerTimeout).toBe(requestBudget)
  expect(effective.settings.chunkTimeout).toBe(requestBudget)
  log("provider.budget", { header: effective.settings.headerTimeout, chunk: effective.settings.chunkTimeout })
  await probe().ctx.session.hook("retry", (event: { attempt: number; error: { message?: string }; decision: { retry: boolean; delay?: number } }) => {
    const entry = { at: Date.now(), attempt: event.attempt, timeout: /timeout|timed out/i.test(event.error.message ?? ""), delay: event.decision.delay }
    retries.push(entry); log("engine.retry", entry)
  })
  const adapterOrigin = "http://codepuppy-sidecar.invalid"
  const adapter = createEngineFetch({ isEngineOrigin: (origin) => origin === adapterOrigin, fetch: ((input: RequestInfo | URL, init?: RequestInit) => running.fetch(new Request(input, init))) as typeof fetch }) as typeof fetch
  const sessions: string[] = []
  const session = async (providerID = "codepuppy") => {
    const created = await running.send("POST", "/api/session", { title: "relay fixture", location: { directory: host.projectDirectory }, model: { id: "m", providerID }, permissions: [{ action: "*", resource: "*", effect: "allow" }] })
    expect(created.status).toBe(200)
    sessions.push(created.json.data.id)
    return created.json.data.id as string
  }
  const turn = async (id: string, text = "hello") => {
    log("engine.prompt", { session: sessions.indexOf(id) })
    expect((await running.send("POST", `/api/session/${id}/prompt`, { text })).status).toBe(200)
    await running.send("POST", `/api/experimental/session/${id}/wait`)
    const messages = (await running.send("GET", `/api/session/${id}/message`)).json.data as Array<{ type: string; outcome?: string }>
    expect(messages.find((message) => message.type === "idle")?.outcome).toBe("succeeded")
    log("engine.idle", { session: sessions.indexOf(id) })
  }
  const toolParts = async (id: string) => {
    const response = await adapter(`${adapterOrigin}/session/${id}/message`, { headers: { "x-opencode-directory": encodeURIComponent(host.projectDirectory) } })
    const messages = await response.json() as Array<{ parts?: Array<{ type: string; tool?: string; display?: { authority?: { kind: string; evidenceDigest?: string } } }> }>
    return messages.flatMap((message) => message.parts ?? []).filter((part) => part.type === "tool")
  }
  return { wire, retries, session, turn, toolParts, probes: () => probes, stalled: () => stalled, setStall: (value: "headers" | "body") => { stall = value }, setCloudFault: (value: boolean) => { cloudFault = value }, closeTarget, open, bootstrap: start!, timeline,
    async close() {
      for (const id of sessions) await running.send("POST", `/api/session/${id}/interrupt`, {})
      await running.close()
      process.env.CODEPUPPY_PLATFORM_URL = CODEPUPPY_ENDPOINTS.platform
      initEndpoints(userData, () => {})
      await proxy?.close()
      for (const target of targets.keys()) await closeTarget(target)
      for (const socket of sockets) socket.destroy()
      globalThis.fetch = originalFetch
      await until(() => sockets.size === 0)
      console.log(`RELAY_EVIDENCE ${label} trace=${JSON.stringify(timeline)} connections_after_close=${sockets.size}`)
    },
  }
}

test("E1 refused engine CONNECT triggers an immediate route change and periodic recovery", async () => {
  const f = await startFixture("E1")
  try {
    const id = await f.session()
    await f.turn(id)
    const port = await f.closeTarget("model-relay")
    const before = proxyRecords.length
    const started = Date.now()
    const send = f.turn(id, "refused entry")
    await until(() => currentRoute() === "direct", 6000)
    const directMs = Date.now() - started
    const failure = proxyRecords.slice(before).find((record) => record.event === "egress.connect" && record.reason === "dial-failed" && record.host === "model-relay.test")
    expect(failure).toBeDefined()
    expect(f.probes()).toBeGreaterThan(2)
    await send
    expect(f.wire.some((item) => item.target === "model-direct" && item.credential === "model")).toBe(true)
    await f.open("model-relay", port)
    // The 60 s periodic timer that would find the reopened entry is R4 in endpoint-route.cases.ts (fake timers);
    // here the same probe runs through main's immediate trigger (re-armed each poll, so a probe already in flight
    // from before the reopen cannot leave a stale result), and the running engine must follow the new route.
    const recovered = Date.now()
    await until(() => (noteRelayFailureSignal(), currentRoute() === "preferred"), 10_000)
    const recoveryMs = Date.now() - recovered
    const next = f.wire.length
    await f.turn(id, "recovered entry")
    expect(f.wire.slice(next).some((item) => item.target === "model-relay" && item.credential === "model")).toBe(true)
    console.log(`RELAY_EVIDENCE E1 direct_ms=${directMs} direct_bound_ms=6000 recovery_ms=${recoveryMs} engine_restarts=0`)
  } finally { await f.close() }
}, 40_000)

for (const fault of ["headers", "body"] as const) test(`${fault === "headers" ? "E2" : "E3"} healthy TLS entry stalls ${fault}; real timeout and retry keep preferred`, async () => {
  const f = await startFixture(fault === "headers" ? "E2" : "E3")
  try {
    const id = await f.session()
    f.setStall(fault)
    await f.turn(id, `${fault} stall`)
    expect(f.stalled()).toBe(1)
    expect(currentRoute()).toBe("preferred")
    expect(f.retries.some((retry) => retry.timeout)).toBe(true)
    const requests = f.wire.filter((item) => item.path.endsWith("/chat/completions"))
    expect(requests.length).toBeGreaterThan(1)
    expect(requests.every((item) => item.target === "model-relay" && item.credential === "model")).toBe(true)
    expect(requests[1]!.at - requests[0]!.at).toBeGreaterThanOrEqual(requestBudget)
    console.log(`RELAY_EVIDENCE ${fault === "headers" ? "E2" : "E3"} first_request=${requests[0]!.at} retry_request=${requests[1]!.at} timeout_ms=${requestBudget} route=preferred`)
  } finally { await f.close() }
}, 30_000)

test("E4 cloud-only health fault switches both entries on the next probe and preserves cloud authority/key", async () => {
  const f = await startFixture("E4")
  try {
    const id = await f.session()
    const args = { schema_version: 1, idempotency_key: "relay-intent-key", autonomy: "pipeline", kind: "code-review", input: { diff: "+const x = 1" }, constraints: { network: "restricted" }, artifact_policy: { delivery: "descriptor_only" } }
    const prompt = `CP-CALL ${JSON.stringify({ name: "codepuppy_dispatch", args })}`
    await f.turn(id, prompt)
    const original = (await f.toolParts(id)).filter((part) => part.tool === "codepuppy_dispatch").at(-1)?.display?.authority
    expect(original?.kind).toBe("codepuppy-cloud")
    expect(original?.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(f.wire.some((item) => item.path === "/mcp" && item.target === "cloud-relay" && item.credential === "cloud")).toBe(true)
    f.setCloudFault(true)
    const failureRecords = proxyRecords.filter((record) => record.event === "egress.connect" && record.reason === "dial-failed").length
    // The probe is the periodic one's (R4 covers the timer); triggering it directly keeps the case off the 60 s cycle.
    const started = Date.now()
    await until(() => (noteRelayFailureSignal(), currentRoute() === "direct"), 10_000)
    const periodicMs = Date.now() - started
    expect(proxyRecords.filter((record) => record.event === "egress.connect" && record.reason === "dial-failed")).toHaveLength(failureRecords)
    const before = f.wire.length
    await f.turn(id, prompt)
    const switched = (await f.toolParts(id)).filter((part) => part.tool === "codepuppy_dispatch").at(-1)?.display?.authority
    expect(switched).toEqual(original)
    const access = cloudVisionAccess()
    expect(access.ok).toBe(true)
    if (!access.ok) throw new Error("vision fixture credential unavailable")
    expect((await describeImage({ access, image })).ok).toBe(true)
    expect(f.wire.slice(before).some((item) => item.target === "model-direct" && item.credential === "model")).toBe(true)
    expect(f.wire.slice(before).some((item) => item.path === "/v1/tools/vision" && item.target === "model-direct" && item.credential === "cloud")).toBe(true)
    expect(f.wire.slice(before).some((item) => item.path === "/mcp" && item.target === "cloud-direct" && item.credential === "cloud")).toBe(true)
    const keys = f.wire.filter((item) => item.path === "/mcp" && item.body.includes('"tools/call"')).map((item) => JSON.parse(item.body).params.arguments.idempotency_key)
    expect(keys.length).toBeGreaterThan(1)
    expect(new Set(keys)).toEqual(new Set([args.idempotency_key]))
    f.setCloudFault(false)
    await until(() => (noteRelayFailureSignal(), currentRoute() === "preferred"), 10_000)
    const recovery = f.wire.length
    await f.turn(id, prompt)
    const recovered = (await f.toolParts(id)).filter((part) => part.tool === "codepuppy_dispatch").at(-1)?.display?.authority
    expect(recovered).toEqual(original)
    const recoveredAccess = cloudVisionAccess()
    if (!recoveredAccess.ok) throw new Error("recovered vision fixture credential unavailable")
    expect((await describeImage({ access: recoveredAccess, image })).ok).toBe(true)
    expect(f.wire.slice(recovery).some((item) => item.target === "model-relay" && item.credential === "model")).toBe(true)
    expect(f.wire.slice(recovery).some((item) => item.path === "/v1/tools/vision" && item.target === "model-relay" && item.credential === "cloud")).toBe(true)
    expect(f.wire.slice(recovery).some((item) => item.path === "/mcp" && item.target === "cloud-relay" && item.credential === "cloud")).toBe(true)
    console.log(`RELAY_EVIDENCE E4 probe_direct_ms=${periodicMs} authority_unchanged=true idempotency_unchanged=true`)
  } finally { await f.close() }
}, 60_000)

test("E5 running engine confines credentials to the intended host and path on both routes", async () => {
  const f = await startFixture("E5", { lookalikes: true })
  try {
    const id = await f.session()
    await f.turn(id)
    expect(f.wire.some((item) => item.credential === "model" && item.target === "model-relay")).toBe(true)
    // The main health authority chooses direct; the three BYOK nodes remain separate identities.
    f.setCloudFault(true)
    const { noteRelayFailureSignal } = await import("./codepuppy-endpoints")
    noteRelayFailureSignal()
    await until(() => currentRoute() === "direct")
    await f.turn(id, "direct credential")
    expect(f.wire.some((item) => item.credential === "model" && item.target === "model-direct")).toBe(true)
    for (const providerID of ["look-suffix", "look-path", "look-byok"]) {
      const before = f.wire.length
      await f.turn(await f.session(providerID))
      const calls = f.wire.slice(before).filter((item) => item.path.endsWith("/chat/completions"))
      expect(calls.length).toBeGreaterThan(0)
      expect(calls.every((item) => item.credential === "byok")).toBe(true)
    }
    expect(f.wire.filter((item) => item.credential === "model").every((item) => item.host === "model-relay.test" || item.host === new URL(CODEPUPPY_ENDPOINTS.platform).hostname)).toBe(true)
  } finally { await f.close() }
}, 30_000)

test("E6 no relay keeps the running engine's bootstrap and sends direct with no probes", async () => {
  const f = await startFixture("E6", { directOnly: true })
  try {
    expect(relayConfigured()).toBe(false)
    expect(codepuppyBootstrap().platform.routeRef).toBeUndefined()
    expect(codepuppyBootstrap().platform.directModelProxyBaseURL).toBeUndefined()
    const before = f.probes()
    await f.turn(await f.session())
    expect(f.probes()).toBe(before)
    expect(f.wire.some((item) => item.target === "model-direct" && item.credential === "model")).toBe(true)
  } finally { await f.close() }
}, 30_000)
