import { expect, mock, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { EventEmitter } from "node:events"
import type { CodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import type { ProcessFenceStartInput } from "./process-fence-apply"
import { mockElectron } from "../../test-component/electron-mock"
import { engineSandbox, assertEngineSandboxed } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel } from "../../test-component/codepuppy-engine"
import { serveCredentialsFromOutside } from "../../test-component/credential-table"
import { processFenceWriteRules } from "./process-fence-profile"

const sandbox = engineSandbox()
const name = "fence-route"
// Keep engine temporary writes together; route state is separately placed outside temp roots.
process.env.TMPDIR = path.join(sandbox.root, `${name}-state`, "codepuppy-state", "env", "dev", "test-tmp")
fs.mkdirSync(process.env.TMPDIR, { recursive: true })
const userDataPath = path.join(sandbox.root, `${name}-userdata`)
mockElectron(() => ({ app: { isPackaged: false, on: () => {}, off: () => {}, getPath: () => userDataPath, getVersion: () => "test" }, BrowserWindow: class {}, dialog: {}, ipcMain: { handle: () => {} }, utilityProcess: { fork: () => { throw new Error("fixture fork required") } } }))
mock.module("./logging", () => ({ getLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} }), write: () => {}, rotateServerLogs: () => {} }))
mock.module("./store", () => ({ getStore: () => ({ get: () => null, set: () => {}, delete: () => {} }) }))
mock.module("./codepuppy-keychain-backend", () => ({ keychainBackend: () => undefined }))
const { initCodePuppyEnvironment } = await import("./codepuppy-environment")
const { initEndpoints, endpointRouteRef } = await import("./codepuppy-endpoints")
const { applyProcessFence } = await import("./process-fence-apply")
const { spawnLocalServer } = await import("./server")
const { creditDanglingSweepForSpawn } = await import("./dangling-sweep-latch")
const { CODEPUPPY_ENDPOINTS } = await import("../shared/codepuppy-config")
let start: { bootstrap: CodePuppyBootstrap; fence: ProcessFenceStartInput } | undefined
class Child extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  postMessage(message: { type: string }) {
    if (message.type === "start") { start = message as never; queueMicrotask(() => this.emit("message", { type: "ready" })) }
    if (message.type === "stop") queueMicrotask(() => this.emit("exit", 0))
  }
  kill() { queueMicrotask(() => this.emit("exit", 0)) }
}

test("F1 actual generation profile: engine reads main's atomic route; child writes/replaces/renames are denied", async () => {
  await assertEngineSandboxed(sandbox)
  delete process.env.CODEPUPPY_GLOBAL_DIR
  delete process.env.CODEPUPPY_BASE_URL
  delete process.env.CODEPUPPY_CLOUD_MCP_URL
  for (const key of ["WEB", "PLATFORM", "ACCOUNT", "CLOUD", "MCP"]) delete process.env[`CODEPUPPY_${key}_URL`]
  const environment = initCodePuppyEnvironment({ isPackaged: false, channel: "dev", appDataDir: process.env.CODEPUPPY_TEST_ROUTE_FENCE_APP_DATA!, homeDir: sandbox.home })
  const model = scriptedModel()
  const originalFetch = globalThis.fetch
  const sent: string[] = []
  const health = await Bun.file(new URL("./fixtures/relay-route/health-cloud.json", import.meta.url)).text()
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname === "/health") return new Response(health, { headers: { "content-type": "application/json" } })
    if (url.origin === CODEPUPPY_ENDPOINTS.platform || url.origin === new URL(model.baseURL).origin) {
      sent.push(url.origin)
      return originalFetch(new Request(`${new URL(model.baseURL).origin}${url.pathname}`, request))
    }
    if (url.hostname === "127.0.0.1") return originalFetch(input, init)
    throw new Error("nonfixture network refused")
  }) as typeof fetch
  fs.mkdirSync(userDataPath)
  fs.writeFileSync(path.join(userDataPath, "codepuppy-endpoints.json"), JSON.stringify({ platform: new URL(model.baseURL).origin }))
  initEndpoints(userDataPath, () => {})
  const ref = endpointRouteRef()!
  const file = ref.slice(6, -1)
  const host = codepuppyEngine({ sandbox, name, modelBaseURL: model.baseURL, databasePath: path.join(sandbox.data, "opencode", "fence-route.db"), directModelProxyBaseURL: `${CODEPUPPY_ENDPOINTS.platform}/v1`, routeRef: ref })
  process.env.CODEPUPPY_BASE_URL = model.baseURL
  process.env.CODEPUPPY_API_KEY = `sk-cp-${name}`
  process.env.CODEPUPPY_USER_WORKSPACE_DIR = host.projectDirectory
  creditDanglingSweepForSpawn()
  // Default planProductionFence, default native addon resolution, real sandbox-exec trial compile.
  // Only the Electron child transport and engine health reply are replaced.
  const generation = await spawnLocalServer("127.0.0.1", 0, "test", { userDataPath, fork: () => new Child() as never, healthCheck: async () => true, egressProxy: async () => ({ port: Number(new URL(model.baseURL).port) }) })
  await generation.health.wait
  await generation.listener.stop()
  expect(start?.bootstrap.platform.routeRef).toBe(ref)
  expect(start?.fence.profile).toBeDefined()
  expect(file.startsWith(environment.casBaseRoot + path.sep)).toBe(true)
  expect(file.startsWith(userDataPath + path.sep)).toBe(false)
  expect(file.startsWith(environment.mutableRoot + path.sep)).toBe(false)
  expect(fs.readFileSync(file, "utf8")).toBe("preferred")
  // SPEC-stored-credentials-fence: server.ts's planProductionFence fed C1 — this generation's credential stores are in the profile, last
  expect(processFenceWriteRules(start!.fence.profile).deny).toContainEqual({ kind: "subpath", value: path.join(fs.realpathSync.native(userDataPath), "codepuppy-secrets") })
  expect(start!.fence.profile.trimEnd().split("\n").at(-1)).toContain("; C1 上级目录节点")
  // C1 refuses this process its own credential stores once fenced — main (outside the fence) answers the pulls
  await serveCredentialsFromOutside()
  applyProcessFence(start!.fence, { insideDir: host.projectDirectory, outsideDir: path.dirname(file) })
  const running = await host.start()
  const turn = async () => {
    const id = (await running.send("POST", "/api/session", { location: { directory: host.projectDirectory }, model: { id: "m", providerID: "codepuppy" } })).json.data.id
    await running.send("POST", `/api/session/${id}/prompt`, { text: "hello" })
    await running.send("POST", `/api/experimental/session/${id}/wait`)
  }
  try {
    await turn()
    expect(sent.some((origin) => origin === new URL(model.baseURL).origin)).toBe(true)
    const attack = Bun.spawnSync([process.execPath, "-e", `
      const fs = require('node:fs'), path = require('node:path');
      const file = process.argv[1], workspace = process.argv[2];
      const replacement = path.join(workspace, 'route-replacement');
      fs.writeFileSync(replacement, 'direct');
      const blocked = (f) => { try { f(); return false } catch (e) { return /EPERM|EACCES|operation not permitted/i.test(String(e)) } };
      const denied = [
        () => fs.writeFileSync(file, 'direct'), () => fs.truncateSync(file, 0),
        () => fs.unlinkSync(file), () => fs.renameSync(replacement, file),
        () => fs.renameSync(file, path.join(workspace, 'moved-route')),
        () => fs.renameSync(path.dirname(file), path.join(workspace, 'moved-parent')),
        () => fs.renameSync(path.dirname(path.dirname(file)), path.join(workspace, 'moved-state'))
      ].map(blocked);
      process.stdout.write(JSON.stringify({ denied, positive: fs.readFileSync(replacement, 'utf8') === 'direct' }));
    `, file, host.projectDirectory], { env: process.env, stdout: "pipe", stderr: "pipe" })
    expect(attack.exitCode).toBe(0)
    expect(JSON.parse(attack.stdout.toString())).toEqual({ denied: Array(7).fill(true), positive: true })
    const updated = Promise.withResolvers<void>()
    process.on("message", (message) => { if ((message as { type?: string }).type === "route-updated") updated.resolve() })
    process.send!({ type: "route-direct", file })
    await updated.promise
    expect(fs.readFileSync(file, "utf8")).toBe("direct")
    const before = sent.length
    await turn()
    expect(sent.slice(before).some((origin) => origin === CODEPUPPY_ENDPOINTS.platform)).toBe(true)
  } finally { await running.close(); model.stop(); globalThis.fetch = originalFetch }
}, 120_000)
