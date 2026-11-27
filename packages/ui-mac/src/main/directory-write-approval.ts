import { mkdirSync, realpathSync, statSync } from "node:fs"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"
import type { PermissionRequest } from "../engine-adapter/contract/v1"
import { canonicalJson, requestFingerprint } from "../engine-adapter/contract/receipts"
import { permissionV1Fingerprint } from "../../../codepuppy-app/src/context/permission-v1-adapter"
import { directoryAccessMetadata, type DirectoryAccessDescriptionInput, type DirectoryAccessDescription, type DirectoryWriteApproval, type DirectoryWriteApprovalResult } from "../shared/directory-write-approval"
import { checkWritableTarget, plannedWritableTarget } from "./process-fence-plan"
import { LOCAL_SIDECAR_SERVER_KEY, type WorkspaceDirectoryInput } from "./process-fence-profile"
import type { FenceWorkspaceTracker } from "./process-fence-workspaces"
import type { SidecarListener } from "./server"

export function createDirectoryWriteApproval(deps: {
  eligibility: WorkspaceDirectoryInput
  tracker: Pick<FenceWorkspaceTracker, "userOpened" | "grantWrite">
  sidecar: () => SidecarListener | null
  current: (sessionID: string, requestID: string) => Promise<PermissionRequest | undefined>
}) {
  type Snapshot = { input: DirectoryAccessDescriptionInput; renderer: number; generation: SidecarListener; fingerprint: string; description: DirectoryAccessDescription; anchors: readonly { path: string; dev: string; ino: string }[] }
  const snapshots = new Map<string, Snapshot>()
  const decisions = new Map<string, { identity: string; generation: SidecarListener | null; pending: Promise<DirectoryWriteApprovalResult> }>()
  const describe = (target: string) => {
    const planned = plannedWritableTarget(target, realpathSync.native)
    let ancestor = planned.target
    while (planned.missing.has(ancestor)) ancestor = dirname(ancestor)
    const stat = statSync(ancestor, { bigint: true })
    return { planned, anchor: { path: ancestor, dev: String(stat.dev), ino: String(stat.ino) } }
  }
  const current = async (input: Omit<DirectoryAccessDescriptionInput, "targets">) => {
    const request = await deps.current(input.sessionID, input.requestID)
    if (!request) return
    const metadata = directoryAccessMetadata(request.metadata)
    const fingerprint = await requestFingerprint(request)
    if (request.sessionID !== input.sessionID || request.permission !== "external_directory" || !metadata || metadata.access !== "write" || (input.requestFingerprint !== fingerprint && input.requestFingerprint !== permissionV1Fingerprint(request.id))) throw new Error("conflict")
    return { request, metadata, fingerprint }
  }
  return {
    async describeDirectoryAccess(input: DirectoryAccessDescriptionInput, renderer: number): Promise<DirectoryAccessDescription> {
      if (input.server !== LOCAL_SIDECAR_SERVER_KEY) throw new Error("not local")
      const generation = deps.sidecar()
      if (!generation) throw new Error("expired")
      const facts = await current(input)
      if (!facts) throw new Error("expired")
      if (canonicalJson(facts.metadata.targets) !== canonicalJson(input.targets)) throw new Error("conflict")
      // A description can be refreshed without accumulating snapshots for the same displayed request.
      for (const [id, snapshot] of snapshots) if (snapshot.renderer === renderer && snapshot.input.requestID === input.requestID) snapshots.delete(id)
      const resolved = input.targets.map((target) => {
        const directory = describe(target.directory)
        const file = plannedWritableTarget(target.absolute, realpathSync.native)
        return { target: { ...target, realDirectory: directory.planned.target, realTarget: file.target, dev: directory.anchor.dev, ino: directory.anchor.ino }, anchor: directory.anchor }
      })
      const description = { snapshotID: randomUUID(), targets: resolved.map((item) => item.target) }
      snapshots.set(description.snapshotID, { input: structuredClone(input), renderer, generation, fingerprint: facts.fingerprint, description, anchors: resolved.map((item) => item.anchor) })
      return description
    },
    approveDirectoryWrite(input: DirectoryWriteApproval, renderer: number): Promise<DirectoryWriteApprovalResult> {
      const identity = canonicalJson({ ...input, renderer })
      const previous = decisions.get(input.decisionID)
      if (previous) return previous.identity === identity && previous.generation === deps.sidecar() ? previous.pending : Promise.resolve({ outcome: "conflict" })
      const pending = (async (): Promise<DirectoryWriteApprovalResult> => {
        const snapshot = snapshots.get(input.snapshotID)
        const generation = deps.sidecar()
        if (!snapshot || !generation) return { outcome: "expired" }
        if (snapshot.renderer !== renderer || input.server !== snapshot.input.server || input.sessionID !== snapshot.input.sessionID || input.requestID !== snapshot.input.requestID || input.requestFingerprint !== snapshot.input.requestFingerprint || (input.decision !== "once" && input.decision !== "always")) return { outcome: "conflict" }
        const facts = await current(input)
        if (!facts) return { outcome: "expired" }
        if (input.decision === "always" && !facts.request.always.length) return { outcome: "conflict" }
        if (facts.fingerprint !== snapshot.fingerprint || generation !== snapshot.generation || generation !== deps.sidecar()) return { outcome: "conflict" }
        if (!generation.fenced) return { outcome: "no-fence" }
        const scope = await generation.readWriteScope({ access: "write", targets: snapshot.input.targets })
        if ("error" in scope) return { outcome: "failed", reason: "grant-failed" }
        if (scope.targets.some((target) => target.outcome === "protected")) return { outcome: "failed", reason: "protected-config" }
        if (generation !== deps.sidecar()) return { outcome: "conflict" }
        const prepared = snapshot.description.targets.map((target, index) => {
          const actual = describe(target.directory)
          if (canonicalJson(actual.anchor) !== canonicalJson(snapshot.anchors[index]) || actual.planned.target !== target.realDirectory) throw new Error("conflict")
          const check = checkWritableTarget(deps.eligibility, actual.planned)
          return { actual, check }
        })
        // Validate every displayed identity before any directory is prepared or registered.
        for (const item of prepared) if (!item.check.eligible) return { outcome: "failed", reason: item.check.reason === "not-a-directory" ? "grant-failed" : item.check.reason }
        for (const item of prepared) {
          if (generation.generationWrites(item.actual.planned.target)) continue
          mkdirSync(item.actual.planned.target, { recursive: true })
          const registered = deps.tracker.userOpened.register({ server: input.server, directory: item.actual.planned.target })
          if (!registered.eligible) return { outcome: "failed", reason: registered.reason === "home-or-app-state" || registered.reason === "protected-config" ? registered.reason : "grant-failed" }
          if (generation !== deps.sidecar()) return { outcome: "conflict" }
          const result = await deps.tracker.grantWrite({ server: input.server, directory: registered.directory }, generation)
          if (result.grant !== "granted") return { outcome: "failed", reason: result.reason === "home-or-app-state" || result.reason === "protected-config" ? result.reason : "grant-failed" }
        }
        return generation === deps.sidecar() ? { outcome: "granted" } : { outcome: "conflict" }
      })().catch((error): DirectoryWriteApprovalResult => error instanceof Error && error.message === "conflict" ? { outcome: "conflict" } : { outcome: "failed", reason: "grant-failed" })
      decisions.set(input.decisionID, { identity, generation: deps.sidecar(), pending })
      // A native failure remains retryable with the same human decision; successful OS grants cannot be undone.
      void pending.then((result) => { if (result.outcome === "failed") decisions.delete(input.decisionID) })
      return pending
    },
    forgetRenderer(renderer: number) { for (const [id, snapshot] of snapshots) if (snapshot.renderer === renderer) snapshots.delete(id) },
  }
}
