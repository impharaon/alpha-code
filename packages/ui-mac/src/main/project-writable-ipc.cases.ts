// Same production handlers / truth tracker / spawnLocalServer listener. Electron UI and native
// issuance are the narrow substitutes; actual kernel issuance is independently measured by G0/V2.
import { afterEach, beforeEach, expect, mock, test, vi } from "bun:test"
import { EventEmitter } from "node:events"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mockElectron } from "../../test-component/electron-mock"
import type { WorkspaceWriteGrantCommand, WorkspaceWriteProbeCommand } from "./workspace-write-probe"

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const events = new EventEmitter()
const logs: string[] = []
const issues: Array<{ cls: string; directory: string; pid: number }> = []
const root = process.env.CODEPUPPY_WRITABLE_IPC_ROOT!
let run = ""
let selected: string[] = []
let issueMode: "ok" | "swap" | "throw" | "task_name_for_pid" | "task_info" | "issue" = "ok"
let probeOutcome: "writable" | "denied" | "unknown" = "denied"
const changed: unknown[] = []
// Kernel model: a consumed grant makes its directory writable for the fenced probe.
const consumed = new Set<string>()

mockElectron(() => ({
  app: { isPackaged: false, getPath: () => run, getVersion: () => "0.0.0-test", on: events.on.bind(events), off: events.off.bind(events), once: events.once.bind(events) },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler), on: () => {} },
  utilityProcess: { fork: () => { throw new Error("unexpected fork") } },
  BrowserWindow: class {},
  dialog: { showOpenDialog: async () => ({ canceled: selected.length === 0, filePaths: selected }) },
}))
mock.module("./windows", () => ({ createMainWindow: () => {}, getPinchZoomEnabled: () => false, setPinchZoomEnabled: () => {}, setTitlebar: () => {}, updateTitlebar: () => {} }))
mock.module("./store", () => ({ getStore: () => ({ get: () => null, set: () => {}, delete: () => {}, clear: () => {} }) }))
mock.module("./logging", () => ({ getLogger: () => ({ log: (line: unknown) => { logs.push(String(line)) }, warn: () => {}, error: () => {} }), write: () => {}, rotateServerLogs: () => {} }))
const fenceModule = await import("./process-fence-apply")
mock.module("./process-fence-apply", () => ({ ...fenceModule, loadFenceAddon: () => ({
  issueFileExtensionToProcess: (cls: string, directory: string, pid: number) => {
    issues.push({ cls, directory, pid })
    if (issueMode === "throw") throw new Error("do not expose native exception text")
    if (issueMode !== "ok" && issueMode !== "swap") return { token: null, step: issueMode, errno: 5 }
    if (issueMode === "swap") { renameSync(directory, `${directory}-original`); symlinkSync(join(run, "C"), directory) }
    return { token: "test-memory-only" }
  },
}) }))
mock.module("./codepuppy-keychain-backend", () => ({ keychainBackend: () => ({ isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() }) }))

const { registerIpcHandlers } = await import("./ipc")
const { bootFenceWorkspaceTruth } = await import("./process-fence-workspaces")
const { spawnLocalServer } = await import("./server")
const { creditDanglingSweepForSpawn, resetDanglingSweepLatchForTests } = await import("./dangling-sweep-latch")
const { WORKSPACE_WRITE_EXTENSION_CLASS } = await import("./process-fence-profile")
const { createWriteGrantRequester } = await import("./workspace-write-probe")

class Child extends EventEmitter {
  pid = 12345
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  grants: WorkspaceWriteGrantCommand[] = []
  probes: WorkspaceWriteProbeCommand[] = []
  grantMode: "ok" | "failed" | "hold" | "throw" = "ok"
  postMessage(message: { type: string }) {
    if (message.type === "start") queueMicrotask(() => this.emit("message", { type: "ready" }))
    if (message.type === "grant-write") {
      this.grants.push(message as WorkspaceWriteGrantCommand)
      if (this.grantMode === "throw") throw new Error("test-memory-only must not reach diagnostics")
      const id = (message as WorkspaceWriteGrantCommand).id
      const outcome = this.grantMode === "ok" ? "granted" : "failed"
      if (outcome === "granted") consumed.add(issues.at(-1)!.directory)
      if (this.grantMode !== "hold") queueMicrotask(() => this.emit("message", { type: "grant-write-result", id, outcome, ...(outcome === "failed" ? { detail: "consume errno=1" } : {}) }))
    }
    if (message.type === "write-probe") {
      this.probes.push(message as WorkspaceWriteProbeCommand)
      const id = (message as WorkspaceWriteProbeCommand).id
      const outcome = consumed.has((message as WorkspaceWriteProbeCommand).directory) ? "writable" : probeOutcome
      queueMicrotask(() => this.emit("message", { type: "write-probe-result", id, outcome }))
    }
    if (message.type === "stop") this.kill()
  }
  reply(outcome: "granted" | "failed") { if (outcome === "granted") consumed.add(issues.at(-1)!.directory); this.emit("message", { type: "grant-write-result", id: this.grants.at(-1)!.id, outcome, ...(outcome === "failed" ? { detail: "consume errno=1" } : {}) }) }
  kill() { this.emit("exit", 0) }
}

let child: Child
let listener: Awaited<ReturnType<typeof spawnLocalServer>>["listener"]
let tracker: ReturnType<typeof bootFenceWorkspaceTruth>
const request = (directory = join(run, "B"), server = "sidecar") => ({ server, directory })
const invoke = (channel: string, input?: unknown) => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`missing IPC ${channel}`)
  return handler({ sender: { id: 1 } }, input)
}
const probe = (input = request()) => tracker.probeWrite(input, listener)
const register = (input = request()) => tracker.userOpened.register(input)

beforeEach(async () => {
  run = mkdtempSync(join(root, "main-writable-"))
  selected = []
  process.env.CODEPUPPY_GLOBAL_DIR = join(run, "state/env/dev")
  issues.length = logs.length = changed.length = 0
  consumed.clear()
  issueMode = "ok"
  probeOutcome = "denied"
  for (const directory of ["home", "A", "A/inside", "B", "C", "state", "user-data"]) mkdirSync(join(run, directory))
  mkdirSync(process.env.CODEPUPPY_GLOBAL_DIR, { recursive: true })
  tracker = bootFenceWorkspaceTruth({
    truthPath: join(run, "truth.json"), store: { tabs: undefined, recent: undefined, info: undefined },
    fs: { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync }, log: (line) => { logs.push(line) },
    eligibility: { homeDir: join(run, "home"), appStateRoot: join(run, "state"), configFenceRoots: () => [], realpath: realpathSync.native, isDirectory: () => true },
    onWritableChanged: (change) => { changed.push(change) },
  })
  await spawnGeneration()
  registerIpcHandlers({ fenceWorkspaces: tracker, probeWorkspaceWrite: probe, grantWorkspaceWrite: async (input) => { await tracker.grantWrite(input, listener) },
    updater: { subscribe: () => () => {} },
  } as unknown as Parameters<typeof registerIpcHandlers>[0])
})

async function spawnGeneration() {
  resetDanglingSweepLatchForTests()
  creditDanglingSweepForSpawn()
  child = new Child()
  const result = await spawnLocalServer("127.0.0.1", 43210, "test-not-a-credential", {
    userDataPath: join(run, "user-data"), egressProxy: async () => ({ port: 59999 }), fenceRun: tracker,
    // A is every generation's only start-time root here (the renderer's block form); B and C lie outside it.
    planFence: () => ({ profile: `(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write*\n  (subpath "${join(run, "A")}") ; W1\n)\n`, addonPath: join(run, "test.node"), workspaces: [join(run, "A")] }),
    fork: (() => child) as never, healthCheck: async () => true,
  })
  listener = result.listener
  await result.health.wait
}

afterEach(async () => { await listener?.stop(); events.removeAllListeners("will-quit"); rmSync(run, { recursive: true, force: true }) })

test("probe never registers; untrusted extra open cannot grant; record IPC registers before its reply", async () => {
  expect(await invoke("workspace-write-probe", { ...request(), open: true })).toMatchObject({ outcome: "denied", grant: "ineligible", reason: "not-opened-by-you" })
  expect(issues).toEqual([])
  expect(tracker.userOpened.has("sidecar", request().directory)).toBe(false)
  expect(invoke("workspace-open-record", request())).toEqual({ recorded: true })
  expect(tracker.userOpened.has("sidecar", request().directory)).toBe(true)
  expect(await invoke("workspace-write-probe", request())).toMatchObject({ grant: "granted" })
})

test("a path changed during issuance drops the token before send and leaves the ledger retryable", async () => {
  register()
  issueMode = "swap"
  expect(await probe()).toMatchObject({ grant: "failed", reason: "grant-failed" })
  expect(issues).toHaveLength(1)
  expect(child.grants).toHaveLength(0)
  rmSync(request().directory)
  renameSync(`${request().directory}-original`, request().directory)
  issueMode = "ok"
  expect(await probe()).toMatchObject({ grant: "granted" })
  expect(child.grants).toHaveLength(1)
})

test("remote and no-fence do not touch native or local probe; HOME reason remains independent of probe outcome", async () => {
  register()
  expect(await probe(request(undefined, "remote"))).toEqual({ outcome: "unknown", grant: "not-local" })
  expect(await tracker.probeWrite(request(), { ...listener, fenced: false })).toEqual({ outcome: "unknown", grant: "no-fence" })
  expect(child.probes).toHaveLength(0)
  expect(issues).toEqual([])
  probeOutcome = "unknown"
  expect(await probe(request(join(run, "home")))).toMatchObject({ outcome: "unknown", grant: "ineligible", reason: "home-or-app-state" })
})

test("simultaneous same-directory requests coalesce; only success is remembered in this engine generation", async () => {
  register()
  child.grantMode = "hold"
  const first = probe()
  const second = probe()
  expect(issues).toEqual([{ cls: WORKSPACE_WRITE_EXTENSION_CLASS, directory: request().directory, pid: child.pid }])
  expect(child.grants).toHaveLength(1)
  child.reply("granted")
  expect((await first).grant).toBe("granted")
  expect((await second).grant).toBe("granted")
  await probe()
  expect(child.grants).toHaveLength(1)
})

test("already writable inside a start-time root needs no native issue or consume", async () => {
  register(request(join(run, "A", "inside")))
  probeOutcome = "writable"
  expect(await probe(request(join(run, "A", "inside")))).toMatchObject({ outcome: "writable", grant: "granted" })
  expect(issues).toHaveLength(0)
  expect(child.grants).toHaveLength(0)
})

test("inside a start-time root a denied probe never issues: the answer is grant-failed", async () => {
  register(request(join(run, "A", "inside")))
  probeOutcome = "denied"
  expect(await probe(request(join(run, "A", "inside")))).toEqual({ outcome: "denied", grant: "failed", reason: "grant-failed" })
  expect(issues).toHaveLength(0)
  expect(child.grants).toHaveLength(0)
})

test("a directory inside another directory whose grant is still in flight is not issued", async () => {
  const inner = join(run, "B", "inner")
  mkdirSync(inner)
  register()
  register(request(inner))
  child.grantMode = "hold"
  const outer = probe()
  expect(await probe(request(inner))).toEqual({ outcome: "denied", grant: "failed", reason: "grant-failed" })
  expect(issues.map((issue) => issue.directory)).toEqual([request().directory])
  child.reply("granted")
  expect((await outer).grant).toBe("granted")
  expect(issues).toHaveLength(1)
})

test("a directory issued in an earlier generation is never issued again in a later one, even when that W1 lacks it", async () => {
  register()
  expect(await probe()).toMatchObject({ outcome: "writable", grant: "granted" })
  expect(tracker.carriedWorkspaces()).toEqual([join(run, "A"), request().directory])
  await listener.stop()
  consumed.clear() // a new generation is a new sandbox: the earlier consumption does not carry over
  await spawnGeneration()
  expect(await probe()).toEqual({ outcome: "denied", grant: "failed", reason: "grant-failed" })
  expect(issues).toHaveLength(1)
})

test("a token whose reply never arrived may have been consumed: the same generation never issues it again", async () => {
  register()
  child.grantMode = "hold"
  expect(await probe()).toEqual({ outcome: "denied", grant: "failed", reason: "grant-failed" }) // the reply timed out
  child.reply("granted") // the engine processes the queued grant late and really consumes it; main already gave up
  child.grantMode = "ok"
  expect(await probe()).toEqual({ outcome: "writable", grant: "granted" })
  expect(issues).toHaveLength(1)
  expect(child.grants).toHaveLength(1)
}, 15_000)

test("native exceptions and every typed issue failure return grant-failed even if probe is unknown; retry can recover", async () => {
  register()
  probeOutcome = "unknown"
  for (const mode of ["throw", "task_name_for_pid", "task_info", "issue"] as const) {
    issueMode = mode
    expect(await probe()).toMatchObject({ outcome: "unknown", grant: "failed", reason: "grant-failed" })
  }
  issueMode = "ok"
  probeOutcome = "writable"
  expect(await probe()).toEqual({ outcome: "writable", grant: "granted" })
  expect(changed).toEqual([request(), request()])
  expect(logs.join("\n")).not.toContain("test-memory-only")
  expect(logs.join("\n")).not.toContain("do not expose native exception text")
})

test("a definite consume failure can retry; a post exception or child exit leaves the token possibly consumed, never re-issued or credited", async () => {
  register()
  child.grantMode = "failed" // the sidecar answers "consume errno=1": definitely not consumed
  expect((await probe()).reason).toBe("grant-failed")
  child.grantMode = "throw" // the token was handed to postMessage, which threw: it may have been delivered
  expect((await probe()).reason).toBe("grant-failed")
  expect(child.grants).toHaveLength(2)
  child.grantMode = "ok"
  expect(await probe()).toEqual({ outcome: "denied", grant: "failed", reason: "grant-failed" }) // covered now: no third token
  expect(child.grants).toHaveLength(2)
  const other = request(join(run, "C"))
  register(other)
  child.grantMode = "hold"
  const pending = probe(other)
  child.kill()
  expect((await pending).reason).toBe("grant-failed")
  expect((await probe(other)).reason).toBe("grant-failed")
  expect(issues.map((issue) => issue.directory)).toEqual([request().directory, request().directory, other.directory])
  expect(logs.join("\n")).not.toContain("test-memory-only")
})

test("picker including multiple directories registers and consumes before returning paths", async () => {
  selected = [join(run, "B"), join(run, "C")]
  expect(await invoke("open-directory-picker", { multiple: true })).toEqual(selected)
  for (const directory of selected) expect(tracker.userOpened.has("sidecar", directory)).toBe(true)
  expect(child.grants).toHaveLength(2)
  expect(child.probes).toHaveLength(0) // O1 waits for consume, not a later filesystem probe.
  expect(await probe()).toMatchObject({ grant: "granted" })
  expect(child.grants).toHaveLength(2)
})

test("picker upper bound is 1 second; pending grant continues and later work joins it", async () => {
  selected = [join(run, "B")]
  child.grantMode = "hold"
  // Controlled time (bun fake timers drive the picker's setTimeout): the grant is held and never answered
  // here, so only the bound can return the picker — still waiting at 999 ms, returned at exactly 1000 ms.
  vi.useFakeTimers()
  try {
    let returned: unknown
    let done = false
    const picked = Promise.resolve(invoke("open-directory-picker")).then((value) => { returned = value; done = true })
    const turn = () => new Promise<void>((resolve) => setImmediate(resolve))
    for (let i = 0; i < 100 && child.grants.length === 0; i++) await turn()
    for (let i = 0; i < 3; i++) await turn()
    expect(child.grants).toHaveLength(1)
    vi.advanceTimersByTime(999)
    for (let i = 0; i < 3; i++) await turn()
    expect(done).toBe(false)
    vi.advanceTimersByTime(1)
    for (let i = 0; i < 3; i++) await turn()
    expect(done).toBe(true)
    await picked
    expect(returned).toBe(selected[0])
  } finally {
    vi.useRealTimers()
  }
  const pending = probe()
  expect(child.grants).toHaveLength(1)
  child.reply("granted")
  expect((await pending).grant).toBe("granted")
})

test("CODEPUPPY_OPEN_DIR follows the same registration/grant path; cancellation adds nothing", async () => {
  const prior = process.env.CODEPUPPY_OPEN_DIR
  try {
    process.env.CODEPUPPY_OPEN_DIR = join(run, "B")
    expect(await invoke("open-directory-picker")).toBe(join(run, "B"))
    expect(child.grants).toHaveLength(1)
  } finally {
    if (prior === undefined) delete process.env.CODEPUPPY_OPEN_DIR
    else process.env.CODEPUPPY_OPEN_DIR = prior
  }
  expect(await invoke("open-directory-picker")).toBeNull()
  expect(tracker.userOpened.has("sidecar", join(run, "C"))).toBe(false)
})

test("bad IPC shapes fail closed; sidecar-originated record/issue commands have no reverse route", async () => {
  for (const input of [null, "directory", {}, { server: "sidecar" }, { server: 3, directory: "/x" }]) {
    expect(invoke("workspace-open-record", input)).toEqual({ recorded: false })
    expect(await invoke("workspace-write-probe", input)).toMatchObject({ outcome: "unknown", grant: "ineligible" })
  }
  for (const type of ["workspace-open-record", "grant-write", "issue-write", "open-directory-picker"]) child.emit("message", { type, ...request() })
  expect(issues).toEqual([])
  expect(changed).toEqual([])
  expect(tracker.userOpened.has("sidecar", request().directory)).toBe(false)
})

test("eligibility precedes a missing sidecar: HOME and unregistered directories keep their real reason", async () => {
  expect(await tracker.probeWrite(request(join(run, "home")), null)).toEqual({ outcome: "unknown", grant: "ineligible", reason: "home-or-app-state" })
  expect(await tracker.probeWrite(request(), null)).toEqual({ outcome: "unknown", grant: "ineligible", reason: "not-opened-by-you" })
  expect(issues).toEqual([])
})

test("grant request book timeout is failed; no live sidecar is failed rather than ineligible", async () => {
  const grants = createWriteGrantRequester(() => {})
  expect((await grants.request("test-memory-only")).outcome).toBe("failed")
  register()
  expect(await tracker.probeWrite(request(), null)).toMatchObject({ outcome: "unknown", grant: "failed", reason: "grant-failed" })
}, 10_000)
