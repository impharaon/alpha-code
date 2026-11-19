import { beforeAll, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { buildFenceAddon } from "../../scripts/build-fence-addon"
import { renderProcessFenceProfile, resolveEngineRoots, WORKSPACE_WRITE_EXTENSION_CLASS } from "./process-fence-profile"

type WriteResult = { writes: string[] }
type ConsumeResult = { handle: number; errno: number }
type MatrixResult = { status: number; rows: { kind: string; issued: boolean; writeErrno: number }[] }
type Report = {
  ready: { pid: number; buildId: string; runtime: string }
  before: WriteResult; forged: ConsumeResult; consumed: ConsumeResult; paths: WriteResult
  updated: { rc: number; errno: number }; retarget: WriteResult; matrix: MatrixResult
  replay: ConsumeResult; replayWrite: WriteResult; unfencedReplay: ConsumeResult
  generation: ConsumeResult; generationWrite: WriteResult; badReplay: ConsumeResult; badReplayWrite: WriteResult
  badFileOnly: MatrixResult; badNoDeny: MatrixResult; invalid: boolean[]
  missingPid: { failed: boolean; step: string; errno: number }; exits: number[]
}

const require = createRequire(import.meta.url)
const fixture = join(import.meta.dir, "../../native/codepuppy-fence/test")
const root = join(process.env.CODEPUPPY_TEST_REAL_HOME ?? homedir(), ".cache/alpha-orch/2026-11-19/impl-project-writable")
mkdirSync(root, { recursive: true })
const run = mkdtempSync(join(root, "extension-"))
const A = join(run, "A")
const B = join(run, "Project")
const C = join(run, "C")
const badFileOnly = join(run, "bad-file-only")
const badNoDeny = join(run, "bad-no-deny")
const buildId = `extension-${Date.now()}`
let report: Report

beforeAll(() => {
  for (const directory of [A, B, C, badFileOnly, badNoDeny, join(run, "home"), join(run, "state")]) mkdirSync(directory, { recursive: true })
  const alias = join(run, "alias")
  symlinkSync(B, alias)
  symlinkSync(C, join(B, "escape"))
  symlinkSync(B, join(C, "entrance"))
  const addon = buildFenceAddon({ out: join(run, "codepuppy_fence.node"), buildId }).out
  const controls = join(run, "controls.node")
  const helper = join(run, "issue-probe")
  const headers = join(dirname(require.resolve("node-api-headers/package.json")), "include")
  for (const args of [
    ["-shared", "-undefined", "dynamic_lookup", `-I${headers}`, join(fixture, "extension-controls.c"), "-lsandbox", "-o", controls],
    [join(fixture, "issue-probe.c"), "-lsandbox", "-o", helper],
  ]) {
    const built = spawnSync("clang", args, { encoding: "utf8" })
    expect(built.status, built.stderr).toBe(0)
  }
  const production = renderProcessFenceProfile({
    workspaces: [A], codepuppyGlobalRoot: join(run, "state"), userDataPath: join(run, "userData"),
    stateHome: join(run, "userData"), roots: resolveEngineRoots({}, join(run, "home")), egressProxyPort: 59999,
  })
  const issueDeny = /\(deny file-issue-extension[^\n]+\(extension-class "[^"]+"\)\)/
  const config = join(run, "config.json")
  writeFileSync(config, JSON.stringify({
    addon, controls, helper, B, C, badFileOnly, badNoDeny, extensionClass: WORKSPACE_WRITE_EXTENSION_CLASS,
    profiles: { production, fileOnly: production.replace(issueDeny, `(deny file-issue-extension (extension-class "${WORKSPACE_WRITE_EXTENSION_CLASS}"))`), noDeny: production.replace(issueDeny, "") },
    paths: [join(B, "real.txt"), join(alias, "alias.txt"), join(run, "project/case.txt"), join(C, "entrance/inward.txt"), join(C, "outside.txt"), join(B, "escape/outward.txt")],
  }))
  const electronPkg = dirname(require.resolve("electron/package.json"))
  const electron = join(electronPkg, "dist", readFileSync(join(electronPkg, "path.txt"), "utf8").trim())
  const result = spawnSync(electron, [join(fixture, "extension-driver.mjs"), config], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", timeout: 90_000 })
  expect(result.status, result.stderr).toBe(0)
  report = JSON.parse(result.stdout.trim())
  writeFileSync(join(run, "result.json"), JSON.stringify(report, null, 2))
  console.log(`V1/V2 evidence: ${run}`)
}, 120_000)

const files = (directory: string) => readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
const contained = (result: WriteResult) => result.writes.every((value) => value === "EPERM")

test("V2 private usable issuance is NULL; legacy/empty tokens may exist; all 50 writes denied, C has zero files", () => {
  expect(report.ready).toMatchObject({ buildId })
  expect(report.ready.runtime).toMatch(/^24\./)
  expect(report.ready.pid).not.toBe(process.pid)
  expect(report.before.writes).toEqual(["EPERM", "EPERM"])
  expect(report.matrix.status).toBe(0)
  expect(report.matrix.rows).toHaveLength(50)
  for (const row of report.matrix.rows) {
    if (!["legacy-file", "legacy-mach", "bit0"].includes(row.kind)) expect(row.issued, row.kind).toBe(false)
    expect(row.writeErrno, row.kind).toBe(1)
  }
  expect(files(C)).toEqual([])
})

test("V1 known bad file-only and no-deny profiles each land a file, so the containment judge turns red", () => {
  expect(report.badFileOnly.status).toBe(0)
  expect(report.badNoDeny.status).toBe(0)
  expect(report.badFileOnly.rows[0]).toMatchObject({ kind: "generic", issued: true, writeErrno: 0 })
  expect(report.badNoDeny.rows[0]).toMatchObject({ kind: "file", issued: true, writeErrno: 0 })
  expect(files(badFileOnly)).toEqual(["generic.txt"])
  expect(files(badNoDeny)).toEqual(["file.txt"])
})

test("V2 forged, other-process, unfenced and new-generation replay fail; removing binding makes the same judge red", () => {
  expect(report.forged.handle).toBe(-1)
  expect(report.forged.errno).toBeGreaterThan(0)
  for (const value of [report.replay, report.unfencedReplay, report.generation]) expect(value).toEqual(expect.objectContaining({ handle: -1, errno: 1 }))
  expect(contained(report.replayWrite)).toBe(true)
  expect(contained(report.generationWrite)).toBe(true)
  expect(report.badReplay.handle).toBeGreaterThanOrEqual(0)
  expect(contained(report.badReplayWrite)).toBe(false)
  expect(existsSync(join(B, "unbound-replay.txt"))).toBe(true)
  expect(existsSync(join(B, "bound-replay.txt"))).toBe(false)
  expect(existsSync(join(B, "generation-replay.txt"))).toBe(false)
})

test("V2 real/alias/inward symlink and volume case semantics write B; outward symlink still cannot write C", () => {
  expect(report.consumed.handle).toBeGreaterThanOrEqual(0)
  expect(report.paths.writes).toEqual(["wrote", "wrote", existsSync(join(run, "project")) ? "wrote" : "ENOENT", "wrote", "EPERM", "EPERM"])
  expect(files(B)).toEqual(["alias.txt", ...(existsSync(join(run, "project")) ? ["case.txt"] : []), "inward.txt", "real.txt", "unbound-replay.txt"].sort())
  expect(files(C)).toEqual([])
})

test("V2 update-file cannot retarget a consumed grant to C", () => {
  expect(report.updated).toMatchObject({ rc: -1, errno: 22 })
  expect(contained(report.retarget)).toBe(true)
  expect(files(C)).toEqual([])
})

test("native invalid inputs throw without crashing; exited pid returns a typed failure; every child exits zero", () => {
  expect(report.invalid).toEqual(Array(7).fill(true))
  expect(report.missingPid.failed).toBe(true)
  expect(["task_name_for_pid", "task_info", "issue"]).toContain(report.missingPid.step)
  expect(report.missingPid.errno).toBeGreaterThan(0)
  expect(report.exits).toEqual([0, 0, 0, 0, 0])
})
