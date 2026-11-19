// Backend leg of V3/V4/V5. Production main listener/registry/IPC, real native module and child
// engine. Electron transport is substituted here; G0/V7 separately requires signed utilityProcess.
import { afterAll, beforeAll, expect, test, mock } from "bun:test"
import { fork } from "node:child_process"
import { EventEmitter } from "node:events"
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildFenceAddon } from "../../scripts/build-fence-addon"
import { mockElectron } from "../../test-component/electron-mock"
import { scriptedModel, textOf } from "../../test-component/codepuppy-engine"
import { renderProcessFenceProfile, resolveEngineRoots } from "./process-fence-profile"
import { planProcessFence } from "./process-fence-plan"
import { createWorkspaceWritableTracker } from "../renderer/codepuppy-ui/workspace-writable-core"
import { workspaceReadonlyMessage } from "../renderer/codepuppy-ui/workspace-writable"
import { setLocale } from "../renderer/i18n"

const run = process.env.CODEPUPPY_WRITABLE_TEST_ROOT!
const A = join(run, "A"), B = join(run, "B"), C = join(run, "C"), D = join(run, "D"), E = join(run, "rewritten")
const install = join(run, "engine-install")
const protectedHome = join(run, "protected", "home")
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
const userData = join(run, "main-user-data")
const appEvents = new EventEmitter()
const handlers = new Map<string, (...args: unknown[]) => unknown>()
const log: string[] = []
const events: Array<Record<string, unknown>> = []
const record = (event: string, fields: Record<string, unknown> = {}) => events.push({ event, ms: performance.now(), ...fields })
mockElectron(() => ({
  app: { isPackaged: false, getPath: () => userData, getVersion: () => "0.2.5-test", on: appEvents.on.bind(appEvents), off: appEvents.off.bind(appEvents), once: appEvents.once.bind(appEvents) },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler), on: () => {} },
  BrowserWindow: class {}, utilityProcess: { fork: () => { throw new Error("unexpected fork") } }, dialog: {},
}))
mock.module("./windows", () => ({ createMainWindow: () => {}, getPinchZoomEnabled: () => false, setPinchZoomEnabled: () => {}, setTitlebar: () => {}, updateTitlebar: () => {} }))
mock.module("./logging", () => ({ getLogger: () => ({ log: (line: unknown) => { log.push(String(line)) }, warn: (line: unknown) => { log.push(String(line)) }, error: () => {} }), write: () => {}, rotateServerLogs: () => {} }))
mock.module("./store", () => ({ getStore: () => ({ get: () => null, set: () => {}, delete: () => {}, clear: () => {} }) }))
mock.module("./codepuppy-keychain-backend", () => ({ keychainBackend: () => ({ isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() }) }))
const actualFence = await import("./process-fence-apply")
const loadOriginalFenceAddon = actualFence.loadFenceAddon
let nativeIssues = 0
// Models fenced code that can write the registered path's parent: the path is a symlink to the target at the
// instant of issue and the real directory again before main's post-issue comparison. Real issue, real kernel.
let raceSwap: { directory: string; target: string } | undefined
mock.module("./process-fence-apply", () => ({ ...actualFence, loadFenceAddon: (path: string) => {
  const original = loadOriginalFenceAddon(path)
  const wrapped = Object.create(original)
  Object.defineProperty(wrapped, "issueFileExtensionToProcess", { value: (...args: Parameters<typeof original.issueFileExtensionToProcess>) => {
    nativeIssues++
    const survivor = survivorSwap && args[1] === survivorSwap.directory ? survivorSwap : undefined
    if (survivor) {
      askSurvivor(survivor.control, "toggle", "toggled")
      try {
        return original.issueFileExtensionToProcess(...args)
      } finally {
        askSurvivor(survivor.control, "restore", "restored")
      }
    }
    const swap = raceSwap && args[1] === raceSwap.directory ? raceSwap : undefined
    if (!swap) return original.issueFileExtensionToProcess(...args)
    renameSync(swap.directory, `${swap.directory}-real`)
    symlinkSync(swap.target, swap.directory)
    try {
      return original.issueFileExtensionToProcess(...args)
    } finally {
      rmSync(swap.directory)
      renameSync(`${swap.directory}-real`, swap.directory)
    }
  } })
  return wrapped
} }))
// A process started in an earlier generation toggles the path at main's issue instant (R3): main asks the survivor
// through a control directory and waits for its acknowledgement, synchronously, around the real issue call.
let survivorSwap: { directory: string; control: string } | undefined
const askSurvivor = (control: string, request: string, ack: string) => {
  writeFileSync(join(control, request), "")
  const end = Date.now() + 10_000
  const pause = new Int32Array(new SharedArrayBuffer(4))
  while (!existsSync(join(control, ack))) {
    if (existsSync(join(control, "error"))) throw new Error(`survivor failed: ${readFileSync(join(control, "error"), "utf8")}`)
    if (Date.now() > end) throw new Error(`survivor did not answer ${request}`)
    Atomics.wait(pause, 0, 0, 5)
  }
  rmSync(join(control, ack))
}
// Directories whose fenced probe answers "denied" at main's seam (the probe saw a symlink to a protected target).
const forcedDenied = new Set<string>()
const { spawnLocalServer } = await import("./server")
const { registerIpcHandlers } = await import("./ipc")
const { bootFenceWorkspaceTruth, writeWorkspaceTruth, readWorkspaceTruthOrThrow } = await import("./process-fence-workspaces")
const { GLOBAL_RENDERER_STORE, TABS_INFO_KEY } = await import("./tabs-preclean")
const { creditDanglingSweepForSpawn, resetDanglingSweepLatchForTests } = await import("./dangling-sweep-latch")

const model = scriptedModel()
let releaseStream: (() => void) | undefined
let streamStarted = false
let streamCancelled = false
let streamReleased = false
// Hold the bytes generated by the existing real scripted-model fixture; do not invent its wire format.
const modelProxy = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const body = await request.clone().json() as { messages?: Array<{ role: string; content?: unknown }> }
  const held = body.messages?.some((message) => message.role === "user" && textOf(message.content).includes("CP-HOLD-STREAM"))
  const response = await fetch(`${model.baseURL}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: await request.text() })
  if (!held) return response
  const bytes = await response.text()
  const split = bytes.indexOf("\n\n") + 2
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(bytes.slice(0, split)))
    streamStarted = true
    releaseStream = () => { if (streamReleased || streamCancelled) return; streamReleased = true; controller.enqueue(new TextEncoder().encode(bytes.slice(split))); controller.close() }
  }, cancel() { if (!streamReleased) streamCancelled = true } }), { headers: { "content-type": "text/event-stream" } })
} })

let connection: { url: string; authorization: string; pid: number; database: string; buildId: string } | undefined
let child: ReturnType<typeof fork>
let listener: Awaited<ReturnType<typeof spawnLocalServer>>["listener"]
const childLogs: string[] = []
const controller = new EventEmitter()
const truthPath = join(run, "truth.json")
let tracker: ReturnType<typeof bootFenceWorkspaceTruth>
let generation = 1
const observation = (directory: string) => ({ server: "sidecar", directory, generation, sandbox: true })
const writable = createWorkspaceWritableTracker((input) => tracker.probeWrite(input, listener))
const invoke = (channel: string, ...inputs: unknown[]) => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`missing IPC ${channel}`)
  return handler({ sender: { id: 1 } }, ...inputs)
}
const waitFor = async (condition: () => boolean, why: string) => {
  const end = Date.now() + 20_000
  while (!condition()) { if (Date.now() > end) throw new Error(`timeout ${why}: ${childLogs.join("").slice(-3000)}`); await Bun.sleep(10) }
}
async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(new URL(route, connection!.url), { method, headers: { authorization: connection!.authorization, "content-type": "application/json", "x-opencode-directory": encodeURIComponent(A) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${text.slice(0, 1000)}`)
  return (text ? JSON.parse(text) : undefined) as T
}
async function session(directory: string) {
  const created = await api<{ data: { id: string } }>("POST", "/api/session", { location: { directory }, agent: "build", model: { id: "m", providerID: "codepuppy" } })
  return created.data.id
}
async function write(directory: string, name: string) {
  const id = await session(directory)
  const before = model.requests.length
  await api("POST", `/api/session/${id}/prompt`, { text: `CP-CALL ${JSON.stringify({ name: "write", args: { path: name, content: "x" } })}` })
  await api("POST", `/api/experimental/session/${id}/wait`)
  return model.requests.slice(before).flatMap((request) => request.messages.filter((message) => message.role === "tool").map((message) => textOf(message.content))).join("\n")
}

let addon = ""
let useProductionPlanner = false
let preparedPlan: Awaited<ReturnType<typeof planProcessFence>> | undefined
async function boot() {
  connection = undefined
  resetDanglingSweepLatchForTests(); creditDanglingSweepForSpawn()
  preparedPlan = undefined
  const result = await spawnLocalServer("127.0.0.1", 43210, "test-only", {
    userDataPath: userData, egressProxy: async () => ({ port: modelProxy.port! }), healthCheck: async () => !!connection,
    fenceRun: tracker,
    // Both planners take main's carried run set from the spawn input, as the production planner does.
    planFence: (input) => {
      const carried = input.carriedWorkspaces
      if (useProductionPlanner) return preparedPlan = planProcessFence({ userDataPath: install, sidecarEnv: { XDG_STATE_HOME: join(install, "state") }, egressProxyPort: modelProxy.port!, addon: { packaged: true, resourcesPath: run, moduleDir: run, exists: existsSync }, carriedWorkspaces: carried }, {
        homeDir: () => protectedHome, appStateRoot: () => join(run, "state"), codepuppyGlobalRoot: () => join(install, "state/env/dev"), defaultWorkspace: () => A,
        readWorkspaces: () => readWorkspaceTruthOrThrow(truthPath, { readFileSync }), realpath: realpathSync.native, isDirectory: (path) => { try { return readdirSync(path) !== undefined } catch { return false } },
        mkdirp: (path) => { mkdirSync(path, { recursive: true }) }, compile: () => ({ ok: true }), log: (line) => { log.push(line) },
      })
      return { addonPath: addon, profile: renderProcessFenceProfile({ workspaces: [...new Set([A, ...readWorkspaceTruthOrThrow(truthPath, { readFileSync }), ...carried])], codepuppyGlobalRoot: join(install, "state/env/dev"), userDataPath: install, stateHome: join(install, "state"), roots: resolveEngineRoots({}, join(install, "home")), egressProxyPort: modelProxy.port! }) }
    },
    fork: ((_file: string, _args: string[], options: { env: Record<string, string> }) => {
      const peer = new EventEmitter() as EventEmitter & { pid: number; stdout: unknown; stderr: unknown; postMessage: (message: { type: string; id?: number; directory?: string }) => void; kill: () => void }
      child = fork(join(import.meta.dir, "../../native/codepuppy-fence/test/project-writable-engine.fixture.ts"), [], { execPath: process.execPath, env: { ...options.env, HOME: join(install, "home"), TMPDIR: install, CODEPUPPY_WRITABLE_ENGINE_ROOT: install, CODEPUPPY_WRITABLE_A: A, CODEPUPPY_WRITABLE_B: B, CODEPUPPY_WRITABLE_OUTSIDE: join(run, "self-check-outside"), CODEPUPPY_WRITABLE_MODEL_URL: `http://127.0.0.1:${modelProxy.port}/v1` }, stdio: ["ignore", "pipe", "pipe", "ipc"] })
      peer.pid = child.pid!
      peer.stdout = child.stdout; peer.stderr = child.stderr
      child.stdout?.on("data", (chunk) => { childLogs.push(String(chunk)) })
      child.stderr?.on("data", (chunk) => { childLogs.push(String(chunk)) })
      child.on("message", (message: Record<string, unknown>) => {
        if (message.type === "fixture.ready") connection = message as unknown as typeof connection
        if (message.type === "fixture.consumed") record("consumed", { id: message.id, handle: message.handle, errno: message.errno, pid: message.pid })
        if (message.type === "fixture.reverse-sent") controller.emit("reverse")
        peer.emit("message", message)
      })
      child.on("exit", (code, signal) => { record("exit", { pid: child.pid, code, signal }); peer.emit("exit", code ?? -1) })
      child.on("error", (error) => peer.emit("error", error))
      peer.postMessage = (message) => {
        if (message.type === "grant-write") record("grant-sent", { id: message.id, pid: child.pid })
        if (message.type === "write-probe") record("probe-sent", { directory: message.directory })
        if (message.type === "write-probe" && forcedDenied.has(message.directory!)) {
          queueMicrotask(() => peer.emit("message", { type: "write-probe-result", id: message.id, outcome: "denied", detail: "test: probe answered at main's seam" }))
          return
        }
        child.send(message)
      }
      peer.kill = () => { child.kill("SIGKILL") }
      return peer
    }) as never,
  })
  listener = result.listener
  await result.health.wait
  record("ready", { pid: connection!.pid, buildId: connection!.buildId, generation })
}

beforeAll(async () => {
  for (const directory of [A, B, C, D, E, join(run, "self-check-outside"), install, protectedHome, join(install, "home"), userData, join(run, "state/env/dev")]) mkdirSync(directory, { recursive: true })
  writeWorkspaceTruth(truthPath, [A], { mkdirSync, writeFileSync, renameSync, rmSync })
  tracker = bootFenceWorkspaceTruth({
    truthPath, store: { tabs: [{ type: "draft", draftID: "a", server: "sidecar", directory: A }], recent: undefined, info: undefined }, fs: { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync }, log: (line) => { log.push(line) },
    eligibility: { homeDir: protectedHome, appStateRoot: join(run, "state"), realpath: realpathSync.native, isDirectory: (directory) => { try { return readdirSync(directory) !== undefined } catch { return false } } },
    onWritableChanged: (change) => { record("changed", change); writable.invalidate(change); writable.observe(observation(change.directory)) },
  })

  process.env.CODEPUPPY_GLOBAL_DIR = join(run, "state/env/dev")
  addon = buildFenceAddon({ out: join(run, "codepuppy-fence/codepuppy_fence.node"), buildId: `engine-grant-${Date.now()}` }).out
  await boot()
  registerIpcHandlers({ fenceWorkspaces: tracker, probeWorkspaceWrite: (input) => tracker.probeWrite(input, listener), grantWorkspaceWrite: async (input) => { await tracker.grantWrite(input, listener) }, updater: { subscribe: () => () => {} } } as unknown as Parameters<typeof registerIpcHandlers>[0])
}, 90_000)
afterAll(async () => {
  releaseStream?.()
  if (listener) await listener.stop()
  if (child && child.exitCode === null && child.signalCode === null) { const stopped = new Promise<void>((resolve) => child.once("exit", () => resolve())); child.kill("SIGKILL"); await stopped }
  model.stop(); modelProxy.stop(true)
  writeFileSync(join(run, "proof.json"), JSON.stringify({
    enginePids: events.filter((event) => event.event === "ready").map((event) => event.pid),
    oldPtyPid: existsSync(join(A, "pty-pid")) ? Number(readFileSync(join(A, "pty-pid"), "utf8")) : null,
    oldMcp: existsSync(join(A, "mcp-after.json")) ? JSON.parse(readFileSync(join(A, "mcp-after.json"), "utf8")) : null,
    files: { B: readdirSync(B), C: readdirSync(C), D: readdirSync(D), rewritten: readdirSync(E) },
    stream: { started: streamStarted, released: streamReleased, cancelled: streamCancelled },
    exits: events.filter((event) => event.event === "exit"),
  }, null, 2))
  writeFileSync(join(run, "events.json"), JSON.stringify(events, null, 2))
  writeFileSync(join(run, "main.log"), log.join("\n"))
  writeFileSync(join(run, "engine.log"), childLogs.join(""))
  console.log(`real engine evidence=${run}`)
})

test("unregistered model write is refused with zero files; child-originated registration requests do not expand eligibility", async () => {
  expect(await tracker.probeWrite({ server: "sidecar", directory: B }, listener)).toMatchObject({ grant: "ineligible", reason: "not-opened-by-you", outcome: "denied" })
  expect(await write(B, "before.txt")).toMatch(/stop and tell the user/i)
  expect(readdirSync(B)).toEqual([])
  const reverse = new Promise<void>((resolve) => controller.once("reverse", resolve))
  child.send({ type: "fixture.reverse", directory: C })
  await reverse
  expect(tracker.userOpened.has("sidecar", C)).toBe(false)
  expect(await tracker.probeWrite({ server: "sidecar", directory: C }, listener)).toMatchObject({ grant: "ineligible", outcome: "denied" })
  expect(readdirSync(C)).toEqual([])
})

test("a project inside start-time W1 writes without any native issue call", async () => {
  const directory = join(A, "already-writable")
  mkdirSync(directory)
  const before = nativeIssues
  await invoke("workspace-open-record", { server: "sidecar", directory })
  const result = await tracker.probeWrite({ server: "sidecar", directory }, listener)
  await write(directory, "inside.txt")
  const landed = existsSync(join(directory, "inside.txt"))
  record("already-writable", { issued: nativeIssues - before, result, landed })
  expect(landed).toBe(true)
  expect(nativeIssues).toBe(before)
})

test("inside a writable root nothing is issued even when the probe says denied and the path is toggled around the issue", async () => {
  const directory = join(A, "race-project"), target = join(run, "race-target")
  mkdirSync(directory); mkdirSync(target)
  expect(invoke("workspace-open-record", { server: "sidecar", directory })).toEqual({ recorded: true })
  expect((await listener.probeWrite(target)).outcome).toBe("denied") // the stand-in is outside every root of this generation
  forcedDenied.add(directory)
  raceSwap = { directory, target }
  const before = nativeIssues
  const result = await tracker.probeWrite({ server: "sidecar", directory }, listener)
  forcedDenied.delete(directory)
  raceSwap = undefined
  await write(target, "race-escape.txt")
  setLocale("zh")
  const files = readdirSync(target)
  record("race-inside-root", { issued: nativeIssues - before, result, files })
  expect(nativeIssues - before).toBe(0)
  expect(files).toEqual([])
  expect(result).toMatchObject({ outcome: "denied", grant: "failed", reason: "grant-failed" })
  expect(workspaceReadonlyMessage(result.reason)).toBe("这个文件夹暂时写不进去，下次打开 Code Puppy 后即可写入。")
})

test("outside every writable root exactly one issue makes it writable; a directory inside that grant is not issued again", async () => {
  const outside = join(run, "outside-project"), inner = join(outside, "inner")
  mkdirSync(inner, { recursive: true })
  const before = nativeIssues // the renderer's own re-probe on the registration notice may issue during the record call
  expect(invoke("workspace-open-record", { server: "sidecar", directory: outside })).toEqual({ recorded: true })
  const granted = await tracker.probeWrite({ server: "sidecar", directory: outside }, listener)
  await write(outside, "outside.txt")
  const issuedOutside = nativeIssues - before
  expect(invoke("workspace-open-record", { server: "sidecar", directory: inner })).toEqual({ recorded: true })
  const nested = await tracker.probeWrite({ server: "sidecar", directory: inner }, listener)
  await write(inner, "inner.txt")
  const issuedTotal = nativeIssues - before
  record("outside-root", { issuedOutside, issuedTotal, granted, nested, files: readdirSync(outside), innerFiles: readdirSync(inner) })
  expect(granted).toMatchObject({ outcome: "writable", grant: "granted" })
  expect(nested).toMatchObject({ outcome: "writable", grant: "granted" })
  expect(issuedOutside).toBe(1)
  expect(issuedTotal).toBe(1)
  expect(existsSync(join(outside, "outside.txt")) && existsSync(join(inner, "inner.txt"))).toBe(true)
})

test("main grants the same running engine; existing PTY/MCP and first model/new PTY write B, C stays empty and another streamed answer is not cancelled", async () => {
  const initialPid = connection!.pid
  const ptyCommand = `echo $$ > ${quote(join(A, "pty-pid"))}; echo x > ${quote(join(B, "pty-before.txt"))}; echo ready > ${quote(join(A, "pty-ready"))}; while [ ! -f ${quote(join(A, "go"))} ]; do sleep .01; done; echo x > ${quote(join(B, "pty-existing.txt"))}; echo x > ${quote(join(C, "pty-existing.txt"))}`
  await api("POST", "/api/pty", { cwd: A, command: "/bin/sh", args: ["-c", ptyCommand] })
  await api("PUT", "/api/experimental/mcp/codepuppy1321probe", { config: { type: "local", command: [process.execPath, join(import.meta.dir, "../../native/codepuppy-fence/test/project-writable-mcp.mjs"), A, B, C] } })
  await waitFor(() => existsSync(join(A, "pty-ready")) && existsSync(join(A, "mcp-ready.json")), "old PTY and MCP ready")
  const mcpBefore = JSON.parse(readFileSync(join(A, "mcp-ready.json"), "utf8"))
  expect(mcpBefore.beforeB).toBe("EPERM")
  expect(readdirSync(B)).toEqual([])
  const other = await session(A)
  await api("POST", `/api/session/${other}/prompt`, { text: "CP-HOLD-STREAM" })
  let completionFailure: unknown
  const completion = api("POST", `/api/experimental/session/${other}/wait`).catch((error) => { completionFailure = error })
  await waitFor(() => streamStarted, "other response streaming")
  child.send({ type: "fixture.delay", ms: 180 })
  expect(invoke("workspace-open-record", { server: "sidecar", directory: B })).toEqual({ recorded: true })
  await writable.whenSettled(observation(B))
  record("first-work", { directory: B })
  expect(await write(B, "first-model.txt")).not.toMatch(/refused this write|not inside a project/i)
  writeFileSync(join(A, "go"), "go")
  await waitFor(() => existsSync(join(A, "mcp-after.json")) && existsSync(join(B, "pty-existing.txt")), "old children after grant")
  const mcpAfter = JSON.parse(readFileSync(join(A, "mcp-after.json"), "utf8"))
  expect(mcpAfter).toMatchObject({ pid: mcpBefore.pid, B: 0, C: "EPERM" })
  await api("POST", "/api/pty", { cwd: A, command: "/bin/sh", args: ["-c", `echo x > ${quote(join(B, "pty-new.txt"))}`] })
  await waitFor(() => existsSync(join(B, "pty-new.txt")), "new PTY write")
  expect(connection!.pid).toBe(initialPid)
  expect(readdirSync(C)).toEqual([])
  expect(streamReleased).toBe(false)
  expect(streamCancelled).toBe(false)
  releaseStream!(); await completion
  expect(completionFailure).toBeUndefined()
  const first = events.findIndex((event) => event.event === "first-work")
  const consumed = events.findIndex((event) => event.event === "consumed")
  expect(consumed).toBeGreaterThan(-1)
  expect(first).toBeGreaterThan(consumed)
})

test("a same-generation refused directory becomes writable through picker registration, with cache invalidation and no restart", async () => {
  writable.observe(observation(D))
  await writable.whenSettled(observation(D))
  expect(writable.result(observation(D))).toMatchObject({ outcome: "denied", reason: "not-opened-by-you" })
  expect(readdirSync(D)).toEqual([])
  const pid = connection!.pid
  process.env.CODEPUPPY_OPEN_DIR = D
  try { expect(await invoke("open-directory-picker")).toBe(D) } finally { delete process.env.CODEPUPPY_OPEN_DIR }
  await writable.whenSettled(observation(D))
  expect(writable.result(observation(D))).toMatchObject({ outcome: "writable", grant: "granted" })
  await write(D, "picked.txt")
  expect(readFileSync(join(D, "picked.txt"), "utf8")).toBe("x")
  expect(connection!.pid).toBe(pid)
  expect(readdirSync(C)).toEqual([])
})


test("remote requests do not touch the local engine; HOME/app-state recording is ineligible", async () => {
  const count = events.length
  expect(invoke("workspace-open-record", { server: "remote", directory: C })).toEqual({ recorded: false, reason: "not-local" })
  expect(await tracker.probeWrite({ server: "remote", directory: C }, listener)).toEqual({ outcome: "unknown", grant: "not-local" })
  expect(events).toHaveLength(count)
  const grants = events.filter((event) => event.event === "grant-sent").length
  for (const directory of [protectedHome, join(run, "state")]) {
    expect(invoke("workspace-open-record", { server: "sidecar", directory })).toEqual({ recorded: false, reason: "home-or-app-state" })
    expect(await tracker.probeWrite({ server: "sidecar", directory }, listener)).toMatchObject({ grant: "ineligible", reason: "home-or-app-state" })
  }
  expect(events.filter((event) => event.event === "grant-sent")).toHaveLength(grants)
  expect(readdirSync(C)).toEqual([])
})

test("a model rewrites session_v2.directory and kills its engine: the restored directory stays outside truth/W1; an honest registered directory remains writable", async () => {
  // session_v2.directory is the actual text column observed in the fixture DB and core/session/sql.ts.
  const rewritten = await session(B)
  invoke("store-set", GLOBAL_RENDERER_STORE, TABS_INFO_KEY, { [`sidecar\n/session/${rewritten}`]: { directory: B } })
  expect(readWorkspaceTruthOrThrow(truthPath, { readFileSync })).toContain(B)
  const sql = `UPDATE session_v2 SET directory='${E.replace(/'/g, "''")}' WHERE id='${rewritten}';`
  const mutation = await session(A)
  await api("POST", `/api/session/${mutation}/prompt`, { text: `CP-CALL ${JSON.stringify({ name: "shell", args: { command: `/usr/bin/sqlite3 ${quote(connection!.database)} ${quote(sql)}` } })}` })
  const completed = api("POST", `/api/experimental/session/${mutation}/wait`)
  let done = false
  void completed.then(() => { done = true })
  for (let i = 0; i < 200 && !done; i++) {
    const pending = await api<{ data: Array<{ id: string }> }>("GET", `/api/session/${mutation}/permission`)
    for (const request of pending.data) await api("POST", `/api/session/${mutation}/permission/${request.id}/reply`, { decision: "once" })
    if (!done) await Bun.sleep(20)
  }
  await completed
  const changed = await api<{ data: { location: { directory: string } } }>("GET", `/api/session/${rewritten}`)
  expect(changed.data.location.directory, JSON.stringify(changed)).toBe(E)
  invoke("store-set", GLOBAL_RENDERER_STORE, TABS_INFO_KEY, { [`sidecar\n/session/${rewritten}`]: { directory: E } })
  expect(readWorkspaceTruthOrThrow(truthPath, { readFileSync })).not.toContain(E)
  expect(tracker.userOpened.has("sidecar", E)).toBe(false)
  const first = child
  const previousPid = connection!.pid
  const exited = new Promise<void>((resolve) => first.once("exit", () => resolve()))
  const crash = await session(A)
  await api("POST", `/api/session/${crash}/prompt`, { text: `CP-CALL ${JSON.stringify({ name: "shell", args: { command: `kill -KILL ${previousPid}` } })}` }).catch(() => undefined)
  await exited
  expect(first.signalCode).toBe("SIGKILL")
  generation++
  // Explicit fixture restart: the production index self-heal and real document reload remain window evidence.
  await boot()
  expect(connection!.pid).not.toBe(previousPid)
  const restored = await api<{ data: { location: { directory: string } } }>("GET", `/api/session/${rewritten}`)
  expect(restored.data.location.directory).toBe(E)
  expect(await tracker.probeWrite({ server: "sidecar", directory: E }, listener)).toMatchObject({ outcome: "denied", grant: "ineligible", reason: "not-opened-by-you" })
  await write(E, "rewritten.txt")
  expect(readdirSync(E)).toEqual([])
  expect(await tracker.probeWrite({ server: "sidecar", directory: B }, listener)).toMatchObject({ outcome: "writable", grant: "granted" })
  await write(B, "honest-reload.txt")
  expect(readFileSync(join(B, "honest-reload.txt"), "utf8")).toBe("x")
})

test("production planner and a new app start exclude a registered entry rebound to LaunchAgents", async () => {
  const directory = join(A, "planner-project"), target = join(run, "LaunchAgents")
  mkdirSync(directory); mkdirSync(target)
  await invoke("workspace-open-record", { server: "sidecar", directory })
  await invoke("store-set", GLOBAL_RENDERER_STORE, TABS_INFO_KEY, { "sidecar\n/session/planner": { directory } })
  expect(readWorkspaceTruthOrThrow(truthPath, { readFileSync })).toContain(directory)
  const previousPid = connection!.pid
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  await api("POST", "/api/pty", { cwd: A, command: "/bin/sh", args: ["-c", `mv ${quote(directory)} ${quote(`${directory}-old`)} && ln -s ${quote(target)} ${quote(directory)} && kill -KILL ${previousPid}`] }).catch(() => undefined)
  await exited
  generation++
  useProductionPlanner = true
  await boot()
  const fresh = await bootFenceWorkspaceTruth({ truthPath, store: { tabs: [{ type: "draft", draftID: "restored", server: "sidecar", directory }], recent: undefined, info: undefined }, fs: { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync }, eligibility: { homeDir: protectedHome, appStateRoot: join(run, "state"), realpath: realpathSync.native, isDirectory: (path) => { try { return readdirSync(path) !== undefined } catch { return false } } }, log: (line) => { log.push(line) }, onWritableChanged: () => {} })
  const seeded = await fresh.userOpened.has("sidecar", directory)
  const result = await fresh.probeWrite({ server: "sidecar", directory }, listener)
  await write(directory, "planner-escape.txt")
  const files = readdirSync(target)
  record("planner-rebind", { previousPid, pid: connection!.pid, workspaces: preparedPlan!.workspaces, excluded: preparedPlan!.excluded, seeded, result, files })
  useProductionPlanner = false
  preparedPlan = undefined
  await invoke("store-set", GLOBAL_RENDERER_STORE, TABS_INFO_KEY, {})
  expect(files).toEqual([])
  expect(seeded).toBe(false)
  expect(result.grant).toBe("ineligible")
})

test("a directory granted in an earlier generation of this run is carried: no new issue, in the next W1, a survivor of that generation cannot redirect it", async () => {
  const directory = join(run, "carried-project"), target = join(run, "carried-target")
  const control = join(install, "survivor-ctl"), park = join(install, "parked-carried")
  mkdirSync(directory); mkdirSync(target); mkdirSync(control, { recursive: true })
  expect(invoke("workspace-open-record", { server: "sidecar", directory })).toEqual({ recorded: true }) // no tab: never in the truth
  expect(await tracker.probeWrite({ server: "sidecar", directory }, listener)).toMatchObject({ outcome: "writable", grant: "granted" })
  // Generation N's sandbox (with the consumed grant) is inherited by a background process that outlives the engine.
  const loop = `echo $$ > ${quote(join(control, "pid"))}; while :; do ` +
    `if [ -f ${quote(join(control, "toggle"))} ]; then rm ${quote(join(control, "toggle"))}; { mv ${quote(directory)} ${quote(park)} && ln -s ${quote(target)} ${quote(directory)} && touch ${quote(join(control, "toggled"))}; } || echo toggle > ${quote(join(control, "error"))}; fi; ` +
    `if [ -f ${quote(join(control, "restore"))} ]; then rm ${quote(join(control, "restore"))}; { rm ${quote(directory)} && mv ${quote(park)} ${quote(directory)} && touch ${quote(join(control, "restored"))}; } || echo restore > ${quote(join(control, "error"))}; fi; ` +
    `[ -f ${quote(join(control, "stop"))} ] && exit 0; sleep 0.01; done`
  // Own session (no process-group or hang-up kill when the PTY or the engine goes); the sandbox survives exec.
  await api("POST", "/api/pty", { cwd: A, command: "/bin/sh", args: ["-c", `/usr/bin/perl -MPOSIX -e 'exit if fork; POSIX::setsid(); exec @ARGV' /bin/sh -c ${quote(loop)} < /dev/null > /dev/null 2>&1`] })
  await waitFor(() => existsSync(join(control, "pid")) && readFileSync(join(control, "pid"), "utf8").trim().length > 0, "survivor started")
  const survivorPid = Number(readFileSync(join(control, "pid"), "utf8"))
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
  const previousPid = connection!.pid
  try {
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
    child.kill("SIGKILL")
    await exited
    generation++
    useProductionPlanner = true
    survivorSwap = { directory, control }
    await boot()
    const survived = alive(survivorPid)
    expect(survived, "a process of the previous generation must outlive the engine").toBe(true)
    const before = nativeIssues
    const result = await tracker.probeWrite({ server: "sidecar", directory }, listener)
    survivorSwap = undefined
    await write(directory, "new-generation.txt")
    const landed = existsSync(join(directory, "new-generation.txt"))
    askSurvivor(control, "toggle", "toggled")
    const toggled = realpathSync.native(directory)
    await write(directory, "through-toggle.txt")
    const files = readdirSync(target)
    askSurvivor(control, "restore", "restored")
    record("carried-generation", { previousPid, pid: connection!.pid, survivorPid, survived, issued: nativeIssues - before, workspaces: preparedPlan?.workspaces, result, landed, toggled, files })
    expect(survived).toBe(true)
    expect(nativeIssues - before).toBe(0)
    expect(preparedPlan!.workspaces).toContain(directory)
    expect(result).toMatchObject({ outcome: "writable", grant: "granted" })
    expect(landed).toBe(true)
    expect(toggled).toBe(target)
    expect(files).toEqual([])
  } finally {
    survivorSwap = undefined
    useProductionPlanner = false
    writeFileSync(join(control, "stop"), "")
    if (alive(survivorPid)) process.kill(survivorPid, "SIGKILL")
  }
})

for (const [kind, target] of [["home", protectedHome], ["state", join(run, "state")], ["home-ancestor", join(run, "protected")]]) {
  test(`registered directory replaced by a symlink to ${kind} cannot expand the next generation`, async () => {
    const directory = join(A, `swap-${kind}`)
    mkdirSync(directory)
    expect(invoke("workspace-open-record", { server: "sidecar", directory })).toEqual({ recorded: true })
    expect(await tracker.probeWrite({ server: "sidecar", directory }, listener)).toMatchObject({ grant: "granted" })
    const previousPid = connection!.pid
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
    await api("POST", "/api/pty", { cwd: A, command: "/bin/sh", args: ["-c", `mv ${quote(directory)} ${quote(`${directory}-original`)} && ln -s ${quote(target!)} ${quote(directory)} && kill -KILL ${previousPid}`] }).catch(() => undefined)
    await exited
    expect(realpathSync.native(directory)).toBe(target!)
    generation++
    await boot()
    // Calibrate the new W1 before issuing: even the HOME-like target is outside every write root.
    expect((await listener.probeWrite(target!)).outcome).toBe("denied")
    const result = await tracker.probeWrite({ server: "sidecar", directory }, listener)
    const name = `symlink-${kind}.txt`
    await write(directory, name)
    setLocale("zh")
    const sentence = workspaceReadonlyMessage(result.reason)
    record("symlink-rebind", { kind, previousPid, pid: connection!.pid, directory, target, result, landed: existsSync(join(target!, name)), sentence })
    expect(existsSync(join(target!, name))).toBe(false)
    expect(result).toMatchObject({ outcome: "denied", grant: "ineligible", reason: "home-or-app-state" })
    expect(sentence).toBe("主目录和 Code Puppy 自己的数据目录不能整个作为项目写入，请打开里面的具体文件夹。")
  })
}

test("a stopped real sidecar reports grant-failed independently of an unknown probe outcome", async () => {
  await listener.stop()
  expect(await tracker.probeWrite({ server: "sidecar", directory: B }, listener)).toMatchObject({ outcome: "unknown", grant: "failed", reason: "grant-failed" })
})
