import { testEgressDial } from "../../test-component/egress-upstream-fixture"
import { afterAll, beforeAll, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import type { EgressProxyHandle, EgressLogRecord } from "./network-egress-proxy"
import { mockElectron } from "../../test-component/electron-mock"

const root = fs.mkdtempSync(join(tmpdir(), "relay-wiring-"))
const userDataPath = join(root, "userdata")
fs.mkdirSync(userDataPath)
process.env.CODEPUPPY_GLOBAL_DIR = join(root, "codepuppy-state", "env", "dev")
fs.mkdirSync(process.env.CODEPUPPY_GLOBAL_DIR, { recursive: true })
delete process.env.CODEPUPPY_BASE_URL
delete process.env.CODEPUPPY_CLOUD_MCP_URL
for (const key of ["WEB", "PLATFORM", "ACCOUNT", "CLOUD", "MCP"]) delete process.env[`CODEPUPPY_${key}_URL`]
const starts: CodePuppyBootstrap[] = []
class Child extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  postMessage(message: { type: string; bootstrap?: CodePuppyBootstrap }) {
    if (message.type === "start") { starts.push(message.bootstrap!); queueMicrotask(() => this.emit("message", { type: "ready" })) }
    if (message.type === "stop") queueMicrotask(() => this.emit("exit", 0))
  }
  kill() { queueMicrotask(() => this.emit("exit", 0)) }
}
mockElectron(() => ({ app: { isPackaged: false, on: () => {}, off: () => {}, getPath: () => userDataPath, getVersion: () => "test" }, utilityProcess: { fork: () => new Child() }, BrowserWindow: class {}, dialog: {}, ipcMain: { handle: () => {} } }))
mock.module("./logging", () => ({ getLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} }), write: () => {}, rotateServerLogs: () => {} }))
mock.module("./store", () => ({ getStore: () => ({ get: () => null, set: () => {}, delete: () => {} }) }))
mock.module("./codepuppy-keychain-backend", () => ({ keychainBackend: () => undefined }))
const { startEgressPolicyProxy } = await import("./network-egress-proxy")
let proxy: EgressProxyHandle | undefined
let proxyLog: (record: EgressLogRecord) => void = () => {}
let fault = false
let targetPort = 0
let closedPort = 0
const target = net.createServer((socket) => socket.on("data", () => {}))
mock.module("./network-egress-proxy", () => ({ startEgressPolicyProxy: async (deps: Parameters<typeof startEgressPolicyProxy>[0]) => {
  proxyLog = deps.log
  proxy = await startEgressPolicyProxy({ resolveEgressRoutes: async () => [{ kind: "direct" }], ...deps, dial: testEgressDial((host) => net.connect({ host: "127.0.0.1", port: fault || host === "registry.npmjs.org" ? closedPort : targetPort })) })
  return proxy
} }))
const health = await Bun.file(new URL("./fixtures/relay-route/health-cloud.json", import.meta.url)).text()
let probes = 0
const originalFetch = globalThis.fetch
globalThis.fetch = (async (input) => {
  const url = String(input)
  if (!new URL(url).hostname.endsWith(".test")) throw new Error("unexpected network in relay wiring fixture")
  probes++
  return new Response(health, { status: fault && url.includes("cloud") ? 502 : 200, headers: { "content-type": "application/json" } })
}) as typeof fetch
const { initEndpoints, currentRoute, preferredEndpoints, noteRelayFailureSignal } = await import("./codepuppy-endpoints")
const { applyAuthEnv, initAuthEnv } = await import("./codepuppy-auth")
const { spawnLocalServer } = await import("./server")
const { creditDanglingSweepForSpawn } = await import("./dangling-sweep-latch")
const { getConfiguredEgressDestinations, isEgressAuthorizedForSidecar } = await import("./network-egress-derived")
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const configure = (generation: string) => {
  fs.writeFileSync(join(userDataPath, "codepuppy-endpoints.json"), JSON.stringify({ platform: `https://gateway-${generation}.test`, cloud: `https://cloud-${generation}.test` }))
  initEndpoints(userDataPath, () => {})
}
const spawn = async () => {
  creditDanglingSweepForSpawn()
  const server = await spawnLocalServer("127.0.0.1", 0, "test", { userDataPath, healthCheck: async () => true, planFence: () => ({ profile: "(version 1)\n(allow default)", addonPath: "/unused" }), fork: () => new Child() as never })
  await server.health.wait
  await server.listener.stop()
}
const connect = (host: string) => new Promise<string>((resolve, reject) => {
  const socket = net.connect(proxy!.port, "127.0.0.1", () => socket.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`))
  socket.on("error", reject)
  socket.once("data", (bytes) => { socket.destroy(); resolve(bytes.toString()) })
})
beforeAll(async () => {
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve))
  targetPort = (target.address() as net.AddressInfo).port
  const closed = net.createServer()
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve))
  closedPort = (closed.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => closed.close(() => resolve()))
})
afterAll(async () => { await proxy?.close(); target.close(); globalThis.fetch = originalFetch })

test("W1 the next generation consumes freshly assigned preferred addresses in egress and bootstrap", async () => {
  // Same synthetic purpose-token grammar already exercised by codepuppy-auth.cases.ts.
  process.env.DEV_PLATFORM_TOKEN = `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ schema_version: 1, iss: "codepuppy-web", aud: "codepuppy-platform-api", sub: "fixture", token_use: "platform_access", purpose: "model.invoke", scope: ["model.invoke"], iat: 1, exp: 2, jti: "route" })).toString("base64url")}.signature`
  configure("one")
  initAuthEnv(userDataPath)
  await spawn()
  configure("two")
  applyAuthEnv()
  await spawn()
  expect(starts.map((item) => String(item.platform.modelProxyBaseURL))).toEqual(["https://gateway-one.test/v1", "https://gateway-two.test/v1"])
  expect(starts.map((item) => String(item.cloudMcp?.definition.url))).toEqual(["https://cloud-one.test/mcp", "https://cloud-two.test/mcp"])
  expect(getConfiguredEgressDestinations()).toContainEqual(expect.objectContaining({ host: "cloud-two.test", providerId: "platform:cloud-mcp" }))
  expect(getConfiguredEgressDestinations().some((item) => item.host === "cloud-one.test")).toBe(false)
})

test("W2 the configured cloud MCP transport is authorized by the production CONNECT proxy", async () => {
  expect(await connect("cloud-two.test")).toStartWith("HTTP/1.1 200")
  expect(isEgressAuthorizedForSidecar("alpha-cloud.tidelabs.click", 443)).toBe(true)
})

test("W3 real dial-failed logs trigger a coalesced probe only for the preferred hosts", async () => {
  await flush()
  const before = probes
  expect(await connect("registry.npmjs.org")).toStartWith("HTTP/1.1 502")
  await flush()
  expect(probes).toBe(before)
  fault = true
  expect(await connect("cloud-two.test")).toStartWith("HTTP/1.1 502")
  await flush()
  expect(probes).toBe(before + 2)
  expect(currentRoute()).toBe("direct")
  fault = false
  noteRelayFailureSignal()
  await flush()
  expect(currentRoute()).toBe("preferred")
  const recovered = probes
  proxyLog({ event: "egress.tunnel-closed", id: 1, at: "fixture", host: new URL(preferredEndpoints().cloud).hostname, port: 443, bytesUp: 1, bytesDown: 1, durationMs: 1 })
  await flush()
  expect(probes).toBe(recovered)
  for (const host of ["registry.npmjs.org", new URL(preferredEndpoints().platform).hostname, new URL(preferredEndpoints().cloud).hostname]) {
    const beforeSilent = probes
    // Same record shape as the production proxy's TLS-silent watchdog emission.
    proxyLog({ event: "egress.tunnel-silent", id: 2, at: "fixture", host, port: 443, bytesUp: 1, remote: "127.0.0.1", fakeIp: false })
    await flush()
    expect(probes).toBe(beforeSilent + (host.endsWith(".test") ? 2 : 0))
  }
})
