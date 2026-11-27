import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, renameSync } from "node:fs"
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
  let calls = 0, fail = false
  let scope: "protected" | "needs-approval" = "needs-approval"
  const sidecar: SidecarListener = { fenced: true, generationWrites: (path) => granted.has(path), grantWrite: async (path) => { calls++; if (fail) return { outcome: "failed", detail: "consume failed" }; granted.add(path); return { outcome: "granted" } }, probeWrite: async () => ({ outcome: "unknown" }), projectConfigView: async () => undefined, permissionRequest: async () => undefined, readWriteScope: async (input) => ({ revision: 1, targets: input.targets.map((target) => ({ absolute: target.absolute, outcome: scope, realDirectory: target.directory, kind: "directory" as const })) }), stop: async () => {}, kill: () => {} }
  let generation: SidecarListener | null = sidecar
  // Real engine sample, projected by production translator. Only this feature's own action/targets are substituted.
  let request: ReturnType<typeof toV1PermissionRequest> | undefined
  const manager = createDirectoryWriteApproval({ eligibility, tracker, sidecar: () => generation, current: async () => request })
  const describe = (directory: string) => {
    request = toV1PermissionRequest({ ...sample.frame.data, action: "external_directory", resources: [directory+"/*"], save: [directory+"/*"], metadata: { directoryAccess: { access: "write", targets: [{ absolute: join(directory, "a.txt"), directory }] } } })
    return { server: "sidecar", requestID: request.id, sessionID: request.sessionID, requestFingerprint: permissionV1Fingerprint(request.id), targets: request.metadata.directoryAccess.targets }
  }
  return { root, home, state, outside, protectedRoot, tracker, manager, granted, describe, calls: () => calls, scope: (value: typeof scope) => { scope = value }, fail: (value: boolean) => { fail = value }, expire: () => { request = undefined }, change: () => { request!.metadata.changed = true }, generation: () => { generation = { ...sidecar } } }
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
  for (const directory of [f.home, f.state, f.protectedRoot]) {
    const input = f.describe(directory), shown = await f.manager.describeDirectoryAccess(input, 7)
    expect(await f.manager.approveDirectoryWrite({ ...input, snapshotID: shown.snapshotID, decisionID: directory, decision: "once" }, 7)).toMatchObject({ outcome: "failed" })
  }
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
