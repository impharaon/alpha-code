import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, renameSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createDirectoryWriteApproval } from "./directory-write-approval"
import { bootFenceWorkspaceTruth } from "./process-fence-workspaces"
import { permissionV1Fingerprint } from "../../../codepuppy-app/src/context/permission-v1-adapter"
import { toV1PermissionRequest } from "../engine-adapter/opencode2/v1-shapes"
import sample from "../engine-adapter/fixtures/permission-asked.json"
import type { SidecarListener } from "./server"
import { readFileSync, writeFileSync } from "node:fs"

async function disk(run: (value: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "directory-approval-")))
  try { await run(await fixture(root)) } finally { rmSync(root, { recursive: true, force: true }) }
}
async function fixture(root: string) {
  const home = join(root, "home"), state = join(root, "state"), outside = join(root, "outside"), protectedRoot = join(home, ".config/opencode")
  for (const path of [home, state, outside, protectedRoot]) mkdirSync(path, { recursive: true })
  const eligibility = { homeDir: home, appStateRoot: state, configFenceRoots: () => [protectedRoot], realpath: realpathSync.native, isDirectory: (path: string) => statSync(path).isDirectory() }
  const tracker = bootFenceWorkspaceTruth({ truthPath: join(state, "workspaces.json"), eligibility, store: {}, fs: { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync }, log: () => {}, onWritableChanged: () => {} })
  const granted = new Set<string>()
  const issued: [string, string | undefined][] = []
  let fail = false
  let scope: "protected" | "needs-approval" = "needs-approval"
  // R6 stand-in: a target under a granted location reads as writable, as main's own ledger answers.
  const covered = (path: string) => [...granted].some((root) => path === root || path.startsWith(`${root}/`))
  const sidecar: SidecarListener = { fenced: true, generationWrites: (path) => covered(path), grantWrite: async (path, kind) => { issued.push([path, kind]); if (fail) return { outcome: "failed", detail: "consume failed" }; granted.add(path); return { outcome: "granted" } }, probeWrite: async () => ({ outcome: "unknown" }), projectConfigView: async () => undefined, permissionRequest: async () => undefined, readWriteScope: async (input) => ({ revision: 1, targets: input.targets.map((target) => ({ absolute: target.absolute, outcome: scope === "needs-approval" && covered(target.absolute) ? "writable" as const : scope, realDirectory: target.directory, kind: "directory" as const })) }), stop: async () => {}, kill: () => {} }
  let generation: SidecarListener | null = sidecar
  // Real engine sample, projected by production translator. Only this feature's own id/action/targets are substituted.
  const requests = new Map<string, ReturnType<typeof toV1PermissionRequest>>()
  let request: ReturnType<typeof toV1PermissionRequest> | undefined
  const manager = createDirectoryWriteApproval({ eligibility, tracker, sidecar: () => generation, current: async (_sessionID, requestID) => requests.get(requestID) })
  /** The engine's request for `absolute` in `directory` (a write in a folder, or `{ P, HOME }` for a new path in HOME). */
  const describe = (directory: string, absolute = join(directory, "a.txt"), id = sample.frame.data.id) => {
    request = toV1PermissionRequest({ ...sample.frame.data, id, action: "external_directory", resources: [directory+"/*"], save: [directory+"/*"], metadata: { directoryAccess: { access: "write", targets: [{ absolute, directory }] } } })
    requests.set(request.id, request)
    return { server: "sidecar", requestID: request.id, sessionID: request.sessionID, requestFingerprint: permissionV1Fingerprint(request.id), targets: request.metadata.directoryAccess.targets }
  }
  return { root, home, state, outside, protectedRoot, tracker, manager, granted, issued, describe, calls: () => issued.length, scope: (value: typeof scope) => { scope = value }, fail: (value: boolean) => { fail = value }, expire: () => { requests.clear() }, change: () => { request!.metadata.changed = true }, generation: () => { generation = { ...sidecar } } }
}

test("directory approval binds the displayed real directory and prepares only the missing target", async () => disk(async (f) => {
  const link = join(f.root, "alias"); symlinkSync(f.outside, link)
  for (const directory of [link, join(f.root, "not-yet/child")]) {
    const input = f.describe(directory)
    const description = await f.manager.describeDirectoryAccess(input, 7)
    expect(description.targets[0]!.realDirectory).toBe(directory === link ? f.outside : directory)
    expect(f.tracker.userOpened.has("sidecar", directory)).toBe(false)
    const approval = { ...input, decisionID: directory, decision: "once" as const, snapshotID: description.snapshotID }
    expect(await f.manager.approveDirectoryWrite(approval, 7)).toEqual({ outcome: "granted" })
    expect(await f.manager.approveDirectoryWrite(approval, 7)).toEqual({ outcome: "granted" })
    expect(f.tracker.carriedWorkspaces()).toContain(description.targets[0]!.realDirectory)
    expect(f.granted.has(description.targets[0]!.realDirectory)).toBe(true)
  }
  expect(f.calls()).toBe(2)
  expect(f.granted.has(join(f.root, "not-yet"))).toBe(false)
}))

test("directory approval rejects re-pointing, replaced identities, stale requests and wrong generations before registration", async () => disk(async (f) => {
  const link = join(f.root, "alias"); symlinkSync(f.outside, link)
  const input = f.describe(link), shown = await f.manager.describeDirectoryAccess(input, 7)
  const approval = { ...input, decisionID: "decision", decision: "once" as const, snapshotID: shown.snapshotID }
  expect(await f.manager.approveDirectoryWrite({ ...approval, decisionID: "wrong-renderer" }, 8)).toEqual({ outcome: "conflict" })
  const elsewhere = join(f.root, "elsewhere");mkdirSync(elsewhere)
  unlinkSync(link);symlinkSync(elsewhere, link)
  expect(await f.manager.approveDirectoryWrite(approval, 7)).toEqual({ outcome: "conflict" })
  expect(f.calls()).toBe(0)
  unlinkSync(link);symlinkSync(f.outside, link)
  const next = await f.manager.describeDirectoryAccess(input, 7)
  f.change()
  expect(await f.manager.approveDirectoryWrite({ ...approval, snapshotID: next.snapshotID, decisionID: "changed" }, 7)).toEqual({ outcome: "conflict" })
  const replacedInput = f.describe(f.outside), replaced = await f.manager.describeDirectoryAccess(replacedInput, 7)
  renameSync(f.outside, f.outside+"-old");mkdirSync(f.outside)
  expect(await f.manager.approveDirectoryWrite({ ...replacedInput, snapshotID: replaced.snapshotID, decision: "once", decisionID: "replaced" }, 7)).toEqual({ outcome: "conflict" })
  const fresh = f.describe(f.outside), generation = await f.manager.describeDirectoryAccess(fresh, 7)
  f.generation()
  expect(await f.manager.approveDirectoryWrite({ ...fresh, snapshotID: generation.snapshotID, decision: "once", decisionID: "generation" }, 7)).toEqual({ outcome: "conflict" })
  const expired = await f.manager.describeDirectoryAccess(fresh, 7);f.expire()
  expect(await f.manager.approveDirectoryWrite({ ...fresh, snapshotID: expired.snapshotID, decision: "once", decisionID: "expired" }, 7)).toEqual({ outcome: "expired" })
  expect(f.calls()).toBe(0);expect(f.tracker.carriedWorkspaces()).toEqual([])
}))

test("directory approval keeps protected locations closed and retries a native failure without replying allow", async () => disk(async (f) => {
  // SPEC v8: in HOME, an entry that already exists is HOME's refusal (a new one is approved as itself, below).
  writeFileSync(join(f.home, "a.txt"), "keep")
  for (const directory of [f.home, f.state, f.protectedRoot]) {
    const input = f.describe(directory), shown = await f.manager.describeDirectoryAccess(input, 7)
    expect(await f.manager.approveDirectoryWrite({ ...input, snapshotID: shown.snapshotID, decisionID: directory, decision: "once" }, 7)).toMatchObject({ outcome: "failed" })
  }
  expect(readFileSync(join(f.home, "a.txt"), "utf8")).toBe("keep")
  const input = f.describe(f.outside), shown = await f.manager.describeDirectoryAccess(input, 7)
  const approval = { ...input, snapshotID: shown.snapshotID, decisionID: "retry", decision: "once" as const }
  f.scope("protected")
  expect(await f.manager.approveDirectoryWrite({ ...approval, decisionID: "protected-file" }, 7)).toEqual({ outcome: "failed", reason: "protected-config" })
  expect(f.calls()).toBe(0)
  f.scope("needs-approval")
  f.fail(true)
  expect(await f.manager.approveDirectoryWrite(approval, 7)).toEqual({ outcome: "failed", reason: "grant-failed" })
  expect(f.granted.size).toBe(0)
  f.fail(false)
  expect(await f.manager.approveDirectoryWrite(approval, 7)).toEqual({ outcome: "granted" })
  expect(f.calls()).toBe(2)
}))

// SPEC v8 BR-08 (design v7 NP3/NP4): a path directly in HOME that does not exist yet is shown and granted as itself —
// never created first, never registered as an opened folder, carried as a new path.
test("a new path directly in HOME is granted as itself: nothing created, nothing registered, carried as a new path", async () => disk(async (f) => {
  for (const name of ["note.txt", "newfolder"]) {
    const path = join(f.home, name)
    const input = f.describe(f.home, path, `per_new_${name}`), shown = await f.manager.describeDirectoryAccess(input, 7)
    const home = statSync(f.home, { bigint: true })
    expect(shown.targets[0]).toMatchObject({ realDirectory: path, dev: String(home.dev), ino: String(home.ino) })
    expect(await f.manager.approveDirectoryWrite({ ...input, snapshotID: shown.snapshotID, decisionID: name, decision: "once" }, 7)).toEqual({ outcome: "granted" })
    expect(existsSync(path)).toBe(false)
    expect(f.tracker.userOpened.has("sidecar", path)).toBe(false)
  }
  expect(f.issued).toEqual([[join(f.home, "note.txt"), "new-path"], [join(f.home, "newfolder"), "new-path"]])
  expect(f.tracker.carriedNewPaths()).toEqual([join(f.home, "note.txt"), join(f.home, "newfolder")])
  expect(f.tracker.carriedWorkspaces()).toEqual([])
  // Inside the granted new folder: already writable, nothing more is issued.
  mkdirSync(join(f.home, "newfolder"))
  const inside = f.describe(join(f.home, "newfolder"), join(f.home, "newfolder", "sub", "b"), "per_inside"), shown = await f.manager.describeDirectoryAccess(inside, 7)
  expect(await f.manager.approveDirectoryWrite({ ...inside, snapshotID: shown.snapshotID, decisionID: "inside", decision: "once" }, 7)).toEqual({ outcome: "granted" })
  expect(f.calls()).toBe(2)
}))

// design v7 §6 evidence 12 (R1-F1): P is created by an unfenced process after main read it as new — before the card is
// described, or after it is shown (a conflict, then the refreshed card). Every arm ends at HOME's sentence: P is never
// created, registered or granted as a folder.
test("a new path created meanwhile, as a folder or a file, before the card or after it is shown, ends at HOME's refusal", async () => disk(async (f) => {
  const make = (path: string, as: "folder" | "file") => (as === "folder" ? mkdirSync(path) : writeFileSync(path, "theirs"))
  for (const when of ["before-describe", "after-shown"] as const) for (const as of ["folder", "file"] as const) {
    const path = join(f.home, `${when}-${as}`), id = `per_${when}_${as}`.replaceAll("-", "_")
    const input = f.describe(f.home, path, id)
    if (when === "before-describe") make(path, as)
    let shown = await f.manager.describeDirectoryAccess(input, 7)
    if (when === "after-shown") {
      expect(shown.targets[0]!.realDirectory).toBe(path)
      make(path, as)
      expect(await f.manager.approveDirectoryWrite({ ...input, snapshotID: shown.snapshotID, decisionID: `${id}_first`, decision: "once" }, 7)).toEqual({ outcome: "conflict" })
      shown = await f.manager.describeDirectoryAccess(input, 7)
    }
    expect({ when, as, shown: shown.targets[0]!.realDirectory }).toEqual({ when, as, shown: f.home })
    expect({ when, as, result: await f.manager.approveDirectoryWrite({ ...input, snapshotID: shown.snapshotID, decisionID: id, decision: "once" }, 7) }).toEqual({ when, as, result: { outcome: "failed", reason: "home-or-app-state" } })
    expect(f.tracker.userOpened.has("sidecar", path)).toBe(false)
    if (as === "file") expect(readFileSync(path, "utf8")).toBe("theirs")
    else expect(readdirSync(path)).toEqual([])
  }
  expect(f.calls()).toBe(0)
  expect([...f.tracker.carriedWorkspaces(), ...f.tracker.carriedNewPaths()]).toEqual([])
  // Contrast: the same existing folder offered as `{ P, P }` is today's folder rule and would be granted — why AB3 must carry
  // `{ P, HOME }` for a new path (design v7 §4.2).
  const folder = join(f.home, "before-describe-folder"), asFolder = f.describe(folder, folder, "per_as_folder"), shown = await f.manager.describeDirectoryAccess(asFolder, 7)
  expect(await f.manager.approveDirectoryWrite({ ...asFolder, snapshotID: shown.snapshotID, decisionID: "as-folder", decision: "once" }, 7)).toEqual({ outcome: "granted" })
  expect(f.issued).toEqual([[folder, undefined]])
}))

// design v7 §5 concurrency, §6 evidence 9: two sessions refused at the same new path. A is approved and its re-run creates the
// file; B's card, clicked afterwards, reads the path as writable and is granted without a second issue.
test("a second card for a new path another card already granted is granted without issuing again", async () => disk(async (f) => {
  const path = join(f.home, "note2.txt")
  const a = f.describe(f.home, path, "per_session_a"), shownA = await f.manager.describeDirectoryAccess(a, 7)
  const b = f.describe(f.home, path, "per_session_b"), shownB = await f.manager.describeDirectoryAccess(b, 7)
  expect(await f.manager.approveDirectoryWrite({ ...a, snapshotID: shownA.snapshotID, decisionID: "a", decision: "once" }, 7)).toEqual({ outcome: "granted" })
  writeFileSync(path, "written by A's re-run")
  expect(await f.manager.approveDirectoryWrite({ ...b, snapshotID: shownB.snapshotID, decisionID: "b", decision: "once" }, 7)).toEqual({ outcome: "granted" })
  expect(f.issued).toEqual([[path, "new-path"]])
}))
