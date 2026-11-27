import { realpathSync } from "node:fs"
import type { PinnedFileId } from "../../../util/src/codepuppy-pinned-files"
import { isDeepStrictEqual } from "node:util"
import { connectorDiagnosticTranscript, isManagedFirstPartyBinding, parseConnectorLaunchSidecarMessage, type ConnectorEgressEvidence, type ConnectorLaunchApi, type ConnectorLaunchMainMessage, type LauncherEnvironment, type LaunchIdentity, type ManagedFirstPartyBinding, type PinnedFileDelivery, type PinnedPreparationProgress, type PinnedFileProgress, type PinnedFileReply, type RuntimeDependencyFacts } from "../../../util/src/codepuppy-connector-launch"
import { createPinnedFileAuthority, readPinnedFiles } from "./pinned-files"
import { sanitizeTransportError } from "./codepuppy-artifact-download"

// A host keeps the same authority through sidecar replacements. Different canonical app-data roots do not share files.
const authorities = new Map<string, ReturnType<typeof createPinnedFileAuthority>>()
export function pinnedFileAuthority(userData: string) {
  const root = realpathSync(userData)
  const existing = authorities.get(root)
  if (existing) return existing
  const authority = createPinnedFileAuthority({ userData: root, manifest: readPinnedFiles() })
  authorities.set(root, authority)
  return authority
}

/** Only this generation's built-in IDs reach the downloader; paths/URLs never cross the port. */
export function createPinnedFileMainBridge(files: Pick<ReturnType<typeof createPinnedFileAuthority>, "ensureFile"> & { ensureEntry?: (id: PinnedFileId, binding: ManagedFirstPartyBinding, signal: AbortSignal, progress: (update: PinnedPreparationProgress) => void) => Promise<PinnedFileDelivery> }, sidecarGeneration: string, post: (message: PinnedFileReply | PinnedFileProgress) => void) {
  const pending = new Map<number, { controller: AbortController; result: Promise<void> }>()
  let stopped = false
  const send = (message: PinnedFileReply | PinnedFileProgress) => { if (!stopped) { try { post(message) } catch { /* The sidecar may have exited while I/O settled. */ } } }
  return {
    receive(value: unknown) {
      if (!value || typeof value !== "object" || !("type" in value) || !["codepuppy.pinned-file.ensure", "codepuppy.pinned-file.cancel"].includes(String(value.type))) return false
      if (stopped || !("id" in value) || typeof value.id !== "number" || !Number.isSafeInteger(value.id) || value.id <= 0) return true
      const id = value.id
      if (!("sidecarGeneration" in value) || typeof value.sidecarGeneration !== "string") return true
      if (value.sidecarGeneration !== sidecarGeneration) {
        send({ type: "codepuppy.pinned-file.result", id, sidecarGeneration: value.sidecarGeneration, delivery: { result: { ok: false, error: "cancelled" } } })
        return true
      }
      if (value.type === "codepuppy.pinned-file.cancel") {
        if (Object.keys(value).length === 3) pending.get(id)?.controller.abort()
        return true
      }
      const hasEntry = "entryFor" in value
      const entryFor = hasEntry && isManagedFirstPartyBinding(value.entryFor) ? value.entryFor : undefined
      if (Object.keys(value).length !== (hasEntry ? 5 : 4) || !("fileId" in value) || typeof value.fileId !== "string" || (hasEntry && (!entryFor || entryFor.sidecarGeneration !== sidecarGeneration))) {
        send({ type: "codepuppy.pinned-file.result", id, sidecarGeneration, delivery: { result: { ok: false, error: "unknown-file" }, failure: { kind: "other", detail: "invalid pinned file request" } } })
        return true
      }
      if (pending.has(id)) return true
      const controller = new AbortController()
      const fileId = value.fileId as PinnedFileId
      const result = Promise.resolve().then(() => entryFor
        ? files.ensureEntry ? files.ensureEntry(fileId, entryFor, controller.signal, (preparation) => send({ type: "codepuppy.pinned-file.progress", id, sidecarGeneration, preparation })) : { result: { ok: false as const, error: "unknown-file" as const }, failure: { kind: "other" as const, detail: "Managed entry preparation was not registered for this port" } }
        : files.ensureFile(fileId, controller.signal, (received, total) => send({ type: "codepuppy.pinned-file.progress", id, sidecarGeneration, received, total }))).then((delivery) => {
        pending.delete(id)
        send({ type: "codepuppy.pinned-file.result", id, sidecarGeneration, delivery })
      }, (error) => {
        pending.delete(id)
        send({ type: "codepuppy.pinned-file.result", id, sidecarGeneration, delivery: { result: { ok: false, error: "disk" }, failure: { kind: "disk", detail: sanitizeTransportError(error instanceof Error ? error.message : String(error)) } } })
      })
      pending.set(id, { controller, result })
      return true
    },
    async dispose() {
      stopped = true
      for (const entry of pending.values()) entry.controller.abort()
      await Promise.all([...pending.values()].map((entry) => entry.result))
      pending.clear()
    },
  }
}

/**
 * Main's end of the other §4.7 messages for one generation: core's changed snapshots into the current projection, the host's
 * requests answered by main's own authorities, egress evidence pushed to the attempt, and diagnostic queries by identity only.
 */
export function createConnectorLaunchMainBridge(input: {
  sidecarGeneration: string
  /** Main's own runtimeRoot; a diagnostic is accepted only at the file derived from its attempt there. */
  runtimeRoot: string
  changed: (snapshot: unknown) => boolean
  resolveAssets: () => Promise<LauncherEnvironment>
  runtimeDependencies: (identity: LaunchIdentity) => Promise<RuntimeDependencyFacts>
  beginEgress: (identity: LaunchIdentity) => Promise<{ proxyEnvironment: Record<string, string> }>
  endEgress: (identity: LaunchIdentity) => void
  post: (message: ConnectorLaunchMainMessage) => void
}) {
  const diagnostics = new Map<number, { identity: LaunchIdentity; settle: (result: Awaited<ReturnType<ConnectorLaunchApi["diagnostic"]>>) => void }>()
  let next = 0
  let stopped = false
  const send = (message: ConnectorLaunchMainMessage) => {
    if (stopped) return
    try {
      input.post(message)
    } catch {
      /* The sidecar may have exited while main was answering. */
    }
  }
  const unavailable = { ok: false as const, error: "unavailable" as const }
  return {
    receive(value: unknown): boolean {
      const message = parseConnectorLaunchSidecarMessage(value)
      if (!message) return false
      if (stopped) return true
      if (message.type === "codepuppy.connector-launch.changed") {
        input.changed(message.snapshot)
        return true
      }
      if (message.sidecarGeneration !== input.sidecarGeneration) return true
      if (message.type === "codepuppy.connector-launch.end-egress") {
        input.endEgress(message.identity)
        return true
      }
      if (message.type === "codepuppy.connector-launch.diagnostic.result") {
        const waiter = diagnostics.get(message.id)
        if (!waiter) return true
        diagnostics.delete(message.id)
        const result = message.result
        const expected = connectorDiagnosticTranscript(input.runtimeRoot, waiter.identity.attempt)
        waiter.settle(result.ok && (result.value.transcriptFile !== expected || !isDeepStrictEqual(result.value.identity, waiter.identity)) ? unavailable : result)
        return true
      }
      const request = message.request
      const answer =
        request.operation === "resolve-assets"
          ? input.resolveAssets()
          : request.operation === "runtime-dependencies"
            ? input.runtimeDependencies(request.identity)
            : input.beginEgress(request.identity)
      void answer.then(
        (result) => send({ type: "codepuppy.connector-launch.reply", id: message.id, sidecarGeneration: input.sidecarGeneration, ok: true, value: result }),
        (error) => send({ type: "codepuppy.connector-launch.reply", id: message.id, sidecarGeneration: input.sidecarGeneration, ok: false, detail: sanitizeTransportError(error instanceof Error ? error.message : String(error)) }),
      )
      return true
    },
    diagnostic(identity: LaunchIdentity): Promise<Awaited<ReturnType<ConnectorLaunchApi["diagnostic"]>>> {
      if (stopped) return Promise.resolve(unavailable)
      const id = ++next
      return new Promise((settle) => {
        diagnostics.set(id, { identity, settle })
        send({ type: "codepuppy.connector-launch.diagnostic", id, sidecarGeneration: input.sidecarGeneration, identity })
      })
    },
    evidence(value: ConnectorEgressEvidence) {
      send({ type: "codepuppy.connector-launch.egress-evidence", sidecarGeneration: input.sidecarGeneration, evidence: value })
    },
    dispose() {
      stopped = true
      for (const waiter of diagnostics.values()) waiter.settle(unavailable)
      diagnostics.clear()
    },
  }
}
