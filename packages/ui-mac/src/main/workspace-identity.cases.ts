// Real filesystem identities; simulated unreachable I/O is installed in both the old main
// callback and the isolated resolver worker. No owner files are read or written.
import { afterAll, beforeAll, expect, mock, test } from "bun:test"
import { createRequire } from "node:module"
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { WorkerOptions } from "node:worker_threads"

const root = process.env.CODEPUPPY_IDENTITY_TEST_ROOT!
const home = join(root, "home"), state = join(root, "state"), A = join(root, "A")
const blocked = join(root, "blocked"), cached = join(root, "cached")
const counters = new SharedArrayBuffer(12)
const values = new Int32Array(counters)
Atomics.store(values, 1, 1)
const require = createRequire(import.meta.url)
const threads = require("node:worker_threads")
const NativeWorker = threads.Worker
mock.module("node:worker_threads", () => ({ ...threads, Worker: class extends NativeWorker {
  constructor(source: string | URL, options: WorkerOptions = {}) {
    const prefix = `const fixtureThreads=require('node:worker_threads');const fixtureFs=require('node:fs');const fixtureRealpath=fixtureFs.realpathSync.native;const fixture=fixtureThreads.workerData.fixture;fixtureFs.realpathSync.native=(p)=>{if(p===fixture.cached)Atomics.add(new Int32Array(fixture.counters),2,1);if(p===fixture.blocked&&Atomics.load(new Int32Array(fixture.counters),1)===0){Atomics.add(new Int32Array(fixture.counters),0,1);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,600);}return fixtureRealpath(p);};`
    super(prefix + String(source), { ...options, workerData: { ...options.workerData, fixture: { blocked, cached, counters } } })
  }
} }))
const { bootFenceWorkspaceTruth, readWorkspaceTruthOrThrow, writeWorkspaceTruth } = await import("./process-fence-workspaces")
const { GLOBAL_RENDERER_STORE, TABS_KEY } = await import("./tabs-preclean")
const fs = { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync }
const logs: string[] = []
const proof: Record<string, unknown>[] = []
const nativeRealpath = realpathSync.native
const eligibility = {
  homeDir: home, appStateRoot: state,
  realpath: (path: string) => {
    if (path === cached) Atomics.add(values, 2, 1)
    if (path === blocked && Atomics.load(values, 1) === 0) {
      Atomics.add(values, 0, 1)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600)
    }
    return nativeRealpath(path)
  },
  isDirectory: (path: string) => statSync(path).isDirectory(),
}
const tab = (directory: string) => ({ type: "draft", draftID: "identity", server: "sidecar", directory })
const create = (truthPath: string, tabs: unknown[] = []) => bootFenceWorkspaceTruth({ truthPath, store: { tabs, recent: undefined, info: undefined }, fs, log: (line) => { logs.push(line) }, eligibility, onWritableChanged: () => {} })
const writable = new Set<string>([A])
const issues: string[] = []
const sidecar = {
  fenced: true,
  grantWrite: async (directory: string) => { issues.push(directory); writable.add(directory); return { outcome: "granted" as const } },
  probeWrite: async (directory: string) => ({ outcome: writable.has(nativeRealpath(directory)) ? "writable" as const : "denied" as const }),
} as unknown as Parameters<Awaited<ReturnType<typeof create>>["probeWrite"]>[1]
beforeAll(() => {
  for (const path of [home, state, A, blocked, cached, join(root, "Project"), join(root, "LaunchAgents")]) mkdirSync(path, { recursive: true })
  symlinkSync(join(root, "Project"), join(root, "work"))
  process.env.CODEPUPPY_USER_WORKSPACE_DIR = A
})
afterAll(() => { writeFileSync(join(root, "result.json"), JSON.stringify({ proof, logs }, null, 2)) })

test("a replaced truth entry is neither seeded nor granted on a new app start", async () => {
  const directory = join(A, "seeded")
  mkdirSync(directory)
  const truthPath = join(root, "seeding.json")
  writeWorkspaceTruth(truthPath, [directory], fs)
  renameSync(directory, `${directory}-old`)
  symlinkSync(join(root, "LaunchAgents"), directory)
  const tracker = await create(truthPath, [tab(directory)])
  const before = issues.length
  const has = await tracker.userOpened.has("sidecar", directory)
  const result = await tracker.probeWrite({ server: "sidecar", directory }, sidecar)
  proof.push({ name: "seeding-rebind", has, result, issued: issues.length - before })
  expect(has).toBe(false)
  expect(result.grant).toBe("ineligible")
  expect(issues.length).toBe(before)
})

test("the firmlink spelling of HOME is refused by runtime and the production planner", async () => {
  const dependencies = JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf8")).dependencies
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "workspace-identity-firmlink.fixture.ts")], target: "node", format: "esm", external: Object.keys(dependencies).filter((name) => name !== "@codepuppy/contracts-consumer") })
  expect(built.success, built.logs.map(String).join("\n")).toBe(true)
  const script = join(root, "firmlink.mjs")
  writeFileSync(script, new Uint8Array(await built.outputs[0]!.arrayBuffer()))
  const electronPackage = dirname(require.resolve("electron/package.json"))
  const electron = join(electronPackage, "dist", readFileSync(join(electronPackage, "path.txt"), "utf8").trim())
  const child = Bun.spawn({ cmd: [electron, script], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdout: "pipe", stderr: "pipe" })
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(code, error).toBe(0)
  const result = JSON.parse(output)
  proof.push({ name: "firmlink", ...result })
  expect(result.sameDevice && result.sameInode).toBe(true)
  expect(result.registered).toMatchObject({ eligible: false, reason: "home-or-app-state" })
  expect(result.runtime).toMatchObject({ grant: "ineligible", reason: "home-or-app-state" })
  expect(result.workspaces).not.toContain(result.alternate)
})

for (const [name, directory] of [["symlink", join(root, "work")], ["tmp", "/tmp"], ["case", join(root, "project")]]) {
  test(`honest ${name} identity survives two restarts without quarantine or truth loss`, async () => {
    const canonical = nativeRealpath(directory!)
    const truthPath = join(root, `honest-${name}.json`)
    writeWorkspaceTruth(truthPath, [], fs)
    let tracker = await create(truthPath)
    expect((await tracker.userOpened.register({ server: "sidecar", directory: directory! })).eligible).toBe(true)
    await tracker.noteRendererStoreSet(GLOBAL_RENDERER_STORE, TABS_KEY, [tab(directory!)])
    const results: unknown[] = []
    for (let i = 0; i < 2; i++) {
      const roots = readWorkspaceTruthOrThrow(truthPath, fs)
      writable.clear(); for (const entry of [A, ...roots]) writable.add(nativeRealpath(entry))
      tracker = await create(truthPath, [tab(directory!)])
      await tracker.noteRendererStoreSet(GLOBAL_RENDERER_STORE, TABS_KEY, [tab(directory!)])
      results.push({ quarantine: tracker.quarantined, truth: readWorkspaceTruthOrThrow(truthPath, fs), probe: await tracker.probeWrite({ server: "sidecar", directory: directory! }, sidecar) })
    }
    proof.push({ name: `honest-${name}`, canonical, results })
    for (const result of results) expect(result).toMatchObject({ quarantine: [], truth: [canonical], probe: { outcome: "writable" } })
  })
}

test("unreachable lookup has a bound, other tabs respond, and the same registration recovers", async () => {
  const truthPath = join(root, "unreachable.json")
  writeWorkspaceTruth(truthPath, [], fs)
  const tracker = await create(truthPath)
  await tracker.userOpened.register({ server: "sidecar", directory: blocked })
  await tracker.probeWrite({ server: "sidecar", directory: blocked }, sidecar)
  Atomics.store(values, 1, 0)
  const start = performance.now()
  const waiting = tracker.probeWrite({ server: "sidecar", directory: blocked }, sidecar)
  const other = await tracker.probeWrite({ server: "sidecar", directory: A }, sidecar)
  const otherMs = performance.now() - start
  const unavailable = await waiting
  const elapsedMs = performance.now() - start
  Atomics.store(values, 1, 1)
  const recovered = await tracker.probeWrite({ server: "sidecar", directory: blocked }, sidecar)
  proof.push({ name: "unreachable", elapsedMs, otherMs, other, unavailable, recovered, reached: Atomics.load(values, 0) })
  expect(Atomics.load(values, 0)).toBeGreaterThan(0)
  expect(otherMs).toBeLessThan(350)
  expect(elapsedMs).toBeLessThan(550)
  expect(other.outcome).toBe("writable")
  expect(unavailable.grant).toBe("ineligible")
  expect(recovered).toMatchObject({ outcome: "writable", grant: "granted" })
})

test("seen literal tab paths do not cause another disk walk on every store update", async () => {
  const truthPath = join(root, "cached.json")
  writeWorkspaceTruth(truthPath, [], fs)
  const tracker = await create(truthPath)
  await tracker.userOpened.register({ server: "sidecar", directory: cached })
  await tracker.noteRendererStoreSet(GLOBAL_RENDERER_STORE, TABS_KEY, [tab(cached)])
  const before = Atomics.load(values, 2)
  for (let i = 0; i < 10; i++) await tracker.noteRendererStoreSet(GLOBAL_RENDERER_STORE, TABS_KEY, [tab(cached)])
  const extra = Atomics.load(values, 2) - before
  proof.push({ name: "tab-resolution-cache", extra })
  expect(extra).toBe(0)
})
