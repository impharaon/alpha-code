import { readFile } from "node:fs/promises"
import { isDeepStrictEqual } from "node:util"
import {
  connectorDiagnosticTranscript,
  createPinnedFileRequester,
  isConnectorLaunchDiagnostic,
  isRuntimeDependencyFacts,
  parseConnectorLaunchMainMessage,
  type ConnectorEgressEvidence,
  type ConnectorLaunchApi,
  type ConnectorLaunchHost,
  type ConnectorLaunchHostRequest,
  type ConnectorLaunchSidecarMessage,
  type LauncherEnvironment,
  type LaunchIdentity,
  type PinnedFileCancel,
  type PinnedFileRequest,
} from "../../../util/src/codepuppy-connector-launch"

/**
 * The sidecar's §4.7 ConnectorLaunchHost over its parentPort: one per generation, published before the engine starts. Data only
 * crosses the port; main keeps downloads, launcher assets, dependency facts and egress attribution. The diagnostic body stays here.
 */
export function createConnectorLaunchSidecarHost(input: {
  sidecarGeneration: string
  /** This generation's bootstrap descriptor; resolveAssets must return exactly it. */
  launchers: LauncherEnvironment
  post: (message: ConnectorLaunchSidecarMessage | PinnedFileRequest | PinnedFileCancel) => void
}) {
  const files = createPinnedFileRequester(input.post, input.sidecarGeneration)
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const evidence = new Map<string, ConnectorEgressEvidence[]>()
  let next = 0
  let closed = false
  const attempt = (identity: LaunchIdentity) => JSON.stringify([identity.directory, identity.server, identity.attempt])
  const notify = (message: ConnectorLaunchSidecarMessage) => {
    if (closed) return
    try {
      input.post(message)
    } catch {
      /* A stopped parent cannot receive notifications. */
    }
  }
  const request = (value: ConnectorLaunchHostRequest) =>
    new Promise<unknown>((resolve, reject) => {
      if (closed) return reject(new Error("connector launch host closed"))
      const id = ++next
      pending.set(id, { resolve, reject })
      try {
        input.post({ type: "codepuppy.connector-launch.request", id, sidecarGeneration: input.sidecarGeneration, request: value })
      } catch (error) {
        pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  const host: ConnectorLaunchHost = {
    ensureFile: files.ensureFile,
    prepareFiles: files.prepareFiles,
    changed: (snapshot) => notify({ type: "codepuppy.connector-launch.changed", snapshot }),
    async runtimeDependencies(identity) {
      const facts = await request({ operation: "runtime-dependencies", identity })
      if (!isRuntimeDependencyFacts(facts)) throw new Error("invalid runtime dependency facts")
      return facts
    },
    async beginEgress(identity) {
      evidence.set(attempt(identity), [])
      const value = await request({ operation: "begin-egress", identity })
      const environment = value && typeof value === "object" && "proxyEnvironment" in value ? value.proxyEnvironment : undefined
      if (!environment || typeof environment !== "object" || Object.values(environment).some((item) => typeof item !== "string"))
        throw new Error("invalid egress attribution environment")
      return { proxyEnvironment: environment as Record<string, string> }
    },
    async egressEvidence(identity) {
      return [...(evidence.get(attempt(identity)) ?? [])]
    },
    endEgress(identity) {
      evidence.delete(attempt(identity))
      notify({ type: "codepuppy.connector-launch.end-egress", sidecarGeneration: input.sidecarGeneration, identity })
    },
    async resolveAssets() {
      const assets = await request({ operation: "resolve-assets" })
      if (!isDeepStrictEqual(assets, input.launchers)) throw new Error("bundled launchers differ from this generation's descriptor")
      return input.launchers
    },
  }
  return {
    host,
    receive(value: unknown): boolean {
      if (files.receive(value)) return true
      const message = parseConnectorLaunchMainMessage(value)
      if (!message) return false
      if (message.sidecarGeneration !== input.sidecarGeneration || closed) return true
      if (message.type === "codepuppy.connector-launch.reply") {
        const waiter = pending.get(message.id)
        pending.delete(message.id)
        if (message.ok) waiter?.resolve(message.value)
        else waiter?.reject(new Error(message.detail))
        return true
      }
      // Evidence counts only for an attempt that began attribution here and has not ended.
      if (message.type === "codepuppy.connector-launch.egress-evidence") {
        evidence.get(attempt(message.evidence.identity))?.push(message.evidence)
        return true
      }
      void readDiagnostic(input.launchers.runtimeRoot, message.identity).then((result) =>
        notify({ type: "codepuppy.connector-launch.diagnostic.result", id: message.id, sidecarGeneration: input.sidecarGeneration, result }),
      )
      return true
    },
    close() {
      closed = true
      files.close()
      for (const waiter of pending.values()) waiter.reject(new Error("connector launch host closed"))
      pending.clear()
      evidence.clear()
    },
  }
}

/** Only the file derived from this identity's attempt, and only if it is that attempt's own diagnostic. */
async function readDiagnostic(runtimeRoot: string, identity: LaunchIdentity): Promise<Awaited<ReturnType<ConnectorLaunchApi["diagnostic"]>>> {
  const transcriptFile = connectorDiagnosticTranscript(runtimeRoot, identity.attempt)
  // A missing or torn file is simply unavailable; every query still gets its one reply.
  const stored: unknown = await readFile(transcriptFile, "utf8")
    .then((text): unknown => JSON.parse(text))
    .catch(() => undefined)
  if (!isConnectorLaunchDiagnostic(stored) || stored.transcriptFile !== transcriptFile || !isDeepStrictEqual(stored.identity, identity))
    return { ok: false, error: "unavailable" }
  return {
    ok: true,
    value: {
      identity: stored.identity,
      requestedCommand: stored.requestedCommand,
      effectiveCommand: stored.effectiveCommand,
      cwd: stored.cwd,
      exitCode: stored.exitCode,
      signal: stored.signal,
      stderr: stored.stderr,
      stage: stored.stage,
      transcriptFile,
    },
  }
}
