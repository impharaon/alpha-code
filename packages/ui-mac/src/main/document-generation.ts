import { mkdir, realpath, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { classifyStartFailure } from "@opencode/core/mcp/codepuppy-startup"
import type { DocumentBootstrap } from "../../../util/src/codepuppy-bootstrap"
import { connectorDiagnosticTranscript, type ConnectorLaunchApi, type ConnectorLaunchDiagnostic, type ConnectorLaunchState, type LauncherPlatform, type LaunchIdentity, type PinnedFileDelivery } from "../../../util/src/codepuppy-connector-launch"
import { DOCUMENT_RUNTIME_LAUNCH_SERVER, type DocumentHost, type DocumentRuntimeState } from "../../../util/src/codepuppy-document"
import type { PinnedFileId, PinnedFiles } from "../../../util/src/codepuppy-pinned-files"
import type { createConnectorLaunchState } from "./connector-launch-state"
import { documentChromium } from "./document-chromium"
import { createDocumentHost } from "./document-host"
import { createDocumentMainBridge } from "./document-host-bridge"
import { documentResources } from "./document-resources"
import { createDocumentRuntime } from "./document-runtime"

/**
 * #1761's production composition for one sidecar generation: runtime → host → main bridge on the existing sidecar lane. Its
 * preparation state is also this generation's connector-launch row (#1760 Q1), so the shared presentation offers 重试 and the
 * action reaches the real runtime.retry().
 */
export function openDocumentGeneration(input: {
  sidecarGeneration: number
  userData: string
  resourcesRoot: string
  packaged: boolean
  platform: LauncherPlatform
  documents: DocumentBootstrap
  manifest: PinnedFiles
  /** The connector runtime root whose derived `diagnostics/<attempt>/transcript.json` the assistant entry reads. */
  diagnosticsRoot: string
  /** The launcher authority's resolved Node; documents never derive or download a second one. */
  node: () => Promise<string>
  ensureFile: (id: PinnedFileId, signal: AbortSignal, progress: (received: number, total: number) => void) => Promise<PinnedFileDelivery>
  /** This generation's write authority (server `generationWrites`); no second allowlist. */
  writable: (directory: string) => boolean
  launches: Pick<ReturnType<typeof createConnectorLaunchState>, "changed" | "bindDocumentRuntime">
  chromium?: typeof documentChromium
  extract?: Parameters<typeof createDocumentRuntime>[0]["extract"]
}) {
  const runtime = createDocumentRuntime({
    manifest: input.manifest,
    platform: input.platform,
    userData: input.userData,
    assets: input.documents.assets,
    resources: input.resourcesRoot,
    python: input.documents.python,
    sidecarGeneration: input.sidecarGeneration,
    ensureFile: input.ensureFile,
    ...(input.extract ? { extract: input.extract } : {}),
    classifyFailure: (delivery) =>
      classifyStartFailure(undefined, { type: "local" }, { download: delivery }).failure ?? { kind: "unknown", detail: "LibreOffice preparation failed" },
  })
  const attempt = `document-runtime:${input.sidecarGeneration}`
  const identity = (directory: string): LaunchIdentity => ({ directory, server: DOCUMENT_RUNTIME_LAUNCH_SERVER, attempt })
  const bound = new Map<string, () => void>()
  let latest: { state: DocumentRuntimeState; sequence: number } | undefined
  const project = (directory: string) => {
    if (!latest) return
    input.launches.changed({ identity: identity(directory), sidecarGeneration: String(input.sidecarGeneration), sequence: latest.sequence, state: launchState(latest.state, attempt) })
    if (!bound.has(directory)) bound.set(directory, input.launches.bindDocumentRuntime(identity(directory), runtime))
  }
  const unsubscribe = runtime.subscribe((state, sequence) => {
    latest = { state, sequence }
    for (const directory of bound.keys()) project(directory)
  })
  const created = createDocumentHost({
    authorize: async (caller) => {
      if (!input.writable(await realpath(caller.location.directory))) throw Error("document workspace is not writable by this engine generation")
    },
    resources: async () => {
      const resolved = documentResources({ resourcesRoot: input.resourcesRoot, packaged: input.packaged, platform: input.platform === "darwin-arm64" ? "darwin" : "win32", node: await input.node() })
      return { python: resolved.python, node: resolved.node, nodeModules: resolved.nodeModules, skills: resolved.skills, templates: resolved.templates, fonts: resolved.fonts }
    },
    chromium: input.chromium ?? documentChromium,
    runtime,
    documentRuntimeRoot: input.documents.documentRuntimeRoot,
  })
  // The Location that first asks for the document environment is where its preparation row appears.
  const host: DocumentHost = {
    ...created.host,
    async environment(caller) {
      const value = await created.host.environment(caller)
      project(caller.location.directory)
      return value
    },
  }
  const bridge = createDocumentMainBridge(host, runtime, input.sidecarGeneration, created.cancelChromium)
  return {
    /** A failed preparation's own facts for the row's 「让助手排查」: the original error, written to the attempt's derived file. */
    async diagnostic(value: LaunchIdentity): ReturnType<ConnectorLaunchApi["diagnostic"]> {
      const state = latest?.state
      if (state?.phase !== "failed" || value.server !== DOCUMENT_RUNTIME_LAUNCH_SERVER || value.attempt !== attempt || !bound.has(value.directory))
        return { ok: false, error: "unavailable" }
      const transcriptFile = connectorDiagnosticTranscript(input.diagnosticsRoot, attempt)
      const facts: ConnectorLaunchDiagnostic = {
        identity: identity(value.directory),
        requestedCommand: [],
        effectiveCommand: [],
        cwd: input.documents.documentRuntimeRoot,
        exitCode: null,
        signal: null,
        stderr: "detail" in state.failure ? state.failure.detail : JSON.stringify(state.failure),
        stage: "packages",
        transcriptFile,
      }
      await mkdir(dirname(transcriptFile), { recursive: true })
      await writeFile(transcriptFile, JSON.stringify(facts, null, 2))
      return { ok: true, value: facts }
    },
    receive: bridge.receive,
    attach: bridge.attach,
    async dispose() {
      unsubscribe()
      for (const unbind of bound.values()) unbind()
      bound.clear()
      await bridge.dispose()
      await created.dispose()
      await runtime.dispose()
    },
  }
}

/** Existing stages only (#1761 §4.3): LibreOffice preparation is the row's package preparation; ready is connected. */
function launchState(state: DocumentRuntimeState, attempt: string): ConnectorLaunchState {
  if (state.phase === "ready") return { phase: "connected" }
  if (state.phase === "failed") return { phase: "failed", failure: state.failure, diagnostic: attempt }
  if (state.stage === "download" && state.total !== undefined && state.total > 0)
    return { phase: "preparing", stage: "packages", progress: { unit: "bytes", completed: state.received ?? 0, total: state.total } }
  return { phase: "preparing", stage: "packages", progress: { unit: "activity", detail: state.stage } }
}
