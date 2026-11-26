// #1760 frozen connector-launchers §4.6 / DOC-NODE-v2 data definitions.
// Shared authority only; launcher acquisition, classification and host publication remain #1760 integration.
import type { EnsurePinnedFileResult, PinnedFileId } from "./codepuppy-pinned-files.js"
import type { Tool } from "../../schema/src/tool.js"

export type LauncherPlatform = "darwin-arm64" | "win32-x64"
export type PackageRunner = "uv-tool" | "npm-exec"
export type PreparedLaunch = {
  runner: PackageRunner
  key: string
  command: [string, ...string[]]
  cwd: string
  environment: Record<string, string>
}
export type LauncherEnvironment = {
  platform: LauncherPlatform
  pinSet: string
  uv: string
  uvx: string
  node: string
  npmCli: string
  npxCli: string
  runtimeRoot: string
  pythonFileId: PinnedFileId
  packageManagerEnv: Readonly<Record<string, string>>
  environment: Record<string, string>
  firstPartyCacheRoots: Readonly<Record<string, string>>
}
export type PinnedEntryRecipe = {
  id: PinnedFileId
  archive: "file" | "zip" | "tar.gz" | "tar.bz2" | "tar.xz"
  entry: string
  required: readonly string[]
}
export type BundledFirstPartyDeclaration = {
  command: readonly string[]
  environment: Readonly<Record<string, string>>
  cwd: string | null
  codeSha256: Readonly<Record<string, string>>
  tools: readonly unknown[]
  recipe?: readonly PinnedEntryRecipe[]
}
export type DeclaredFirstParty = {
  tools: readonly unknown[]
  recipe?: readonly PinnedEntryRecipe[]
  declarationSha256: string
  recipeSha256: string
}
export type FirstPartyConfiguredEntry = {
  type: "local"
  command: readonly string[]
  environment?: Readonly<Record<string, string>>
  cwd?: string
}
export type ManagedFirstPartyBinding = {
  identity: LaunchIdentity
  sidecarGeneration: string
  entry: FirstPartyConfiguredEntry
  declarationSha256: string
  recipeSha256: string
}
export type ManagedPinnedFilesResult =
  | { ok: true; files: { id: PinnedFileId; path: string }[] }
  | Extract<EnsurePinnedFileResult, { ok: false }>
export type PinnedPreparationProgress = {
  id: PinnedFileId
  phase: "download" | "unpack" | "verify" | "ready" | "failed" | "cancelled"
  sequence: number
  receivedBytes?: number
  totalBytes?: number
  error?: Extract<EnsurePinnedFileResult, { ok: false }>["error"]
  failure?: DownloadFailureEvidence
}
export type PinnedFilesCallPreparation = {
  callID: Tool.CallID
  report: (update: PinnedPreparationProgress) => Promise<void>
}
export type RuntimeDependencyFacts = {
  runtimeDep: readonly string[]
  executables: Readonly<Record<string, string>>
  missing: readonly string[]
}
export type ConnectorEgressEvidence = { identity: LaunchIdentity; host: string; port: number; outcome: "refused" | "granted" | "not-asked" }
export type ConnectorLaunchHost = {
  ensureFile(id: PinnedFileId, signal: AbortSignal, progress: (received: number, total: number) => void): Promise<PinnedFileDelivery>
  changed(snapshot: LaunchSnapshot): void
  runtimeDependencies(identity: LaunchIdentity): Promise<RuntimeDependencyFacts>
  beginEgress(identity: LaunchIdentity): Promise<{ proxyEnvironment: Record<string, string> }>
  egressEvidence(identity: LaunchIdentity): Promise<ConnectorEgressEvidence[]>
  endEgress(identity: LaunchIdentity): void
  resolveAssets(): Promise<LauncherEnvironment>
  prepareFiles(input: { binding: ManagedFirstPartyBinding; ids: readonly PinnedFileId[] }, signal: AbortSignal, progress: (update: PinnedPreparationProgress) => void): Promise<ManagedPinnedFilesResult>
}
const hostKey = Symbol.for("codepuppy.connector-launch.host")
export function publishConnectorLaunchHost(host: ConnectorLaunchHost) {
  const target = globalThis as { [hostKey]?: ConnectorLaunchHost }
  if (target[hostKey]) throw new Error("connector launch host already published for this process")
  target[hostKey] = host
}
export function connectorLaunchHost(): ConnectorLaunchHost {
  const host = (globalThis as { [hostKey]?: ConnectorLaunchHost })[hostKey]
  if (!host) throw new Error("connector launch host was not published before engine startup")
  return host
}

export type DownloadFailureEvidence =
  | { kind: "connect" | "timeout"; detail: string }
  | { kind: "http"; status: number; detail: string }
  | { kind: "resolution" | "integrity" | "disk" | "other"; detail: string }
export type PinnedFileDelivery = { result: EnsurePinnedFileResult; failure?: DownloadFailureEvidence }
export type ConnectorLaunchFailure =
  | { kind: "download"; detail: string }
  | { kind: "egress"; host: string; port: number }
  | { kind: "secret"; fields: string[]; packageId?: string }
  | { kind: "auth"; service: string }
  | { kind: "workspace"; reason: "missing" | "not-git" }
  | { kind: "dependency"; program: string }
  | { kind: "unknown"; detail: string }

export function isConnectorLaunchFailure(value: unknown): value is ConnectorLaunchFailure {
  if (!value || typeof value !== "object" || !("kind" in value)) return false
  if (value.kind === "download" || value.kind === "unknown") return "detail" in value && typeof value.detail === "string"
  if (value.kind === "egress") return "host" in value && typeof value.host === "string" && "port" in value && Number.isInteger(value.port) && Number(value.port) > 0 && Number(value.port) <= 65535
  if (value.kind === "secret") return "fields" in value && Array.isArray(value.fields) && value.fields.every((field) => typeof field === "string") && (!("packageId" in value) || typeof value.packageId === "string")
  if (value.kind === "auth") return "service" in value && typeof value.service === "string"
  if (value.kind === "workspace") return "reason" in value && (value.reason === "missing" || value.reason === "not-git")
  return value.kind === "dependency" && "program" in value && typeof value.program === "string"
}

export type PinnedFileRequest = {
  type: "codepuppy.pinned-file.ensure"
  id: number
  sidecarGeneration: string
  fileId: PinnedFileId
  entryFor?: ManagedFirstPartyBinding
}
export type PinnedFileCancel = { type: "codepuppy.pinned-file.cancel"; id: number; sidecarGeneration: string }
export type PinnedFileReply = {
  type: "codepuppy.pinned-file.result"
  id: number
  sidecarGeneration: string
  delivery: PinnedFileDelivery
}
export type PinnedFileProgress = { type: "codepuppy.pinned-file.progress"; id: number; sidecarGeneration: string } & (
  | { received: number; total: number }
  | { preparation: PinnedPreparationProgress }
)

export function isManagedFirstPartyBinding(value: unknown): value is ManagedFirstPartyBinding {
  if (
    !value ||
    typeof value !== "object" ||
    !("identity" in value) ||
    !isLaunchIdentity(value.identity) ||
    !("sidecarGeneration" in value) ||
    typeof value.sidecarGeneration !== "string"
  )
    return false
  if (
    !("declarationSha256" in value) ||
    typeof value.declarationSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.declarationSha256) ||
    !("recipeSha256" in value) ||
    typeof value.recipeSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.recipeSha256)
  )
    return false
  if (!("entry" in value) || !value.entry || typeof value.entry !== "object") return false
  const entry = value.entry
  if (
    !("type" in entry) ||
    entry.type !== "local" ||
    !("command" in entry) ||
    !Array.isArray(entry.command) ||
    !entry.command.length ||
    !entry.command.every((arg) => typeof arg === "string")
  )
    return false
  if ("cwd" in entry && entry.cwd !== undefined && typeof entry.cwd !== "string") return false
  if (
    "environment" in entry &&
    entry.environment !== undefined &&
    (!entry.environment ||
      typeof entry.environment !== "object" ||
      Array.isArray(entry.environment) ||
      !Object.values(entry.environment).every((item) => typeof item === "string"))
  )
    return false
  return (
    Object.keys(value).every((key) =>
      ["identity", "sidecarGeneration", "entry", "declarationSha256", "recipeSha256"].includes(key),
    ) && Object.keys(entry).every((key) => ["type", "command", "environment", "cwd"].includes(key))
  )
}

function isPinnedPreparationProgress(value: unknown): value is PinnedPreparationProgress {
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("sequence" in value) ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 0 ||
    !("phase" in value) ||
    !["download", "unpack", "verify", "ready", "failed", "cancelled"].includes(String(value.phase))
  )
    return false
  const received = "receivedBytes" in value ? value.receivedBytes : undefined
  const total = "totalBytes" in value ? value.totalBytes : undefined
  for (const count of [received, total])
    if (count !== undefined && (!Number.isSafeInteger(count) || Number(count) < 0)) return false
  if (typeof received === "number" && typeof total === "number" && received > total) return false
  if (
    value.phase === "ready" &&
    (("error" in value && value.error !== undefined) || ("failure" in value && value.failure !== undefined))
  )
    return false
  if (
    "error" in value &&
    value.error !== undefined &&
    !["unknown-file", "network", "integrity", "disk", "cancelled"].includes(String(value.error))
  )
    return false
  return !("failure" in value) || value.failure === undefined || isDownloadFailureEvidence(value.failure)
}

function isDownloadFailureEvidence(failure: unknown): failure is DownloadFailureEvidence {
  return (
    !!failure &&
    typeof failure === "object" &&
    "kind" in failure &&
    "detail" in failure &&
    typeof failure.detail === "string" &&
    (failure.kind === "http"
      ? "status" in failure &&
        Number.isInteger(failure.status) &&
        Number(failure.status) >= 100 &&
        Number(failure.status) <= 599
      : ["connect", "timeout", "resolution", "integrity", "disk", "other"].includes(String(failure.kind)))
  )
}

export function isPinnedFileDelivery(value: unknown): value is PinnedFileDelivery {
  if (
    !value ||
    typeof value !== "object" ||
    !("result" in value) ||
    !value.result ||
    typeof value.result !== "object" ||
    !("ok" in value.result)
  )
    return false
  const result = value.result
  if (result.ok === true)
    return (
      "path" in result &&
      typeof result.path === "string" &&
      /^(?:\/|[a-z]:[\\/])/i.test(result.path) &&
      "via" in result &&
      ["cache", "relay", "origin"].includes(String(result.via)) &&
      (!("failure" in value) || value.failure === undefined)
    )
  if (
    result.ok !== false ||
    !("error" in result) ||
    !["unknown-file", "network", "integrity", "disk", "cancelled"].includes(String(result.error))
  )
    return false
  if (!("failure" in value) || value.failure === undefined) return true
  return isDownloadFailureEvidence(value.failure)
}

/** Bound to one parent port/generation. Preparation has no ordinary RPC total timeout. */
export function createPinnedFileRequester(
  post: (message: PinnedFileRequest | PinnedFileCancel) => void,
  sidecarGeneration: string,
) {
  let next = 0
  let closed = false
  const pending = new Map<
    number,
    {
      fileId: PinnedFileId
      settle: (delivery: PinnedFileDelivery) => void
      progress?: (received: number, total: number) => void
      preparation?: (update: PinnedPreparationProgress) => void
    }
  >()
  const cancelled = (): PinnedFileDelivery => ({ result: { ok: false, error: "cancelled" } })
  const request = (
    fileId: PinnedFileId,
    entryFor: ManagedFirstPartyBinding | undefined,
    signal: AbortSignal,
    progress: ((received: number, total: number) => void) | undefined,
    preparation: ((update: PinnedPreparationProgress) => void) | undefined,
  ): Promise<PinnedFileDelivery> => {
    if (closed || signal.aborted) return Promise.resolve(cancelled())
    const id = ++next
    return new Promise((resolve) => {
      const settle = (value: PinnedFileDelivery) => {
        if (!pending.delete(id)) return
        signal.removeEventListener("abort", abort)
        resolve(value)
      }
      const abort = () => {
        try {
          post({ type: "codepuppy.pinned-file.cancel", id, sidecarGeneration })
        } catch {
          /* The stopped parent cannot receive cancellation. */
        } finally {
          settle(cancelled())
        }
      }
      pending.set(id, { fileId, settle, progress, preparation })
      signal.addEventListener("abort", abort, { once: true })
      try {
        post({ type: "codepuppy.pinned-file.ensure", id, sidecarGeneration, fileId, ...(entryFor ? { entryFor } : {}) })
      } catch {
        settle(cancelled())
      }
    })
  }
  return {
    ensureFile(fileId: PinnedFileId, signal: AbortSignal, progress: (received: number, total: number) => void) {
      return request(fileId, undefined, signal, progress, undefined)
    },
    ensureEntry(
      fileId: PinnedFileId,
      entryFor: ManagedFirstPartyBinding,
      signal: AbortSignal,
      preparation: (update: PinnedPreparationProgress) => void,
    ) {
      return request(fileId, entryFor, signal, undefined, preparation)
    },
    async prepareFiles(
      input: { binding: ManagedFirstPartyBinding; ids: readonly PinnedFileId[] },
      signal: AbortSignal,
      progress: (update: PinnedPreparationProgress) => void,
    ): Promise<ManagedPinnedFilesResult> {
      const ids = [...new Set(input.ids)]
      if (!ids.length) return { ok: false, error: "unknown-file" }
      let sequence = 0
      const files: { id: PinnedFileId; path: string }[] = []
      for (const id of ids) {
        const delivery = await request(id, input.binding, signal, undefined, (update) =>
          progress({ ...update, sequence: ++sequence }),
        )
        if (!delivery.result.ok) return delivery.result
        files.push({ id, path: delivery.result.path })
      }
      return { ok: true, files }
    },
    receive(value: unknown) {
      if (
        !value ||
        typeof value !== "object" ||
        !("type" in value) ||
        !["codepuppy.pinned-file.result", "codepuppy.pinned-file.progress"].includes(String(value.type))
      )
        return false
      if (
        !("sidecarGeneration" in value) ||
        value.sidecarGeneration !== sidecarGeneration ||
        !("id" in value) ||
        typeof value.id !== "number"
      )
        return true
      const entry = pending.get(value.id)
      if (!entry) return true
      if (value.type === "codepuppy.pinned-file.result" && "delivery" in value && isPinnedFileDelivery(value.delivery))
        entry.settle(value.delivery)
      if (
        value.type === "codepuppy.pinned-file.progress" &&
        "received" in value &&
        "total" in value &&
        Number.isSafeInteger(value.received) &&
        Number.isSafeInteger(value.total) &&
        Number(value.received) >= 0 &&
        Number(value.total) > 0 &&
        Number(value.received) <= Number(value.total)
      )
        entry.progress?.(Number(value.received), Number(value.total))
      if (
        value.type === "codepuppy.pinned-file.progress" &&
        "preparation" in value &&
        isPinnedPreparationProgress(value.preparation) &&
        value.preparation.id === entry.fileId
      )
        entry.preparation?.(value.preparation)
      return true
    },
    close() {
      closed = true
      for (const [id, entry] of pending) {
        try {
          post({ type: "codepuppy.pinned-file.cancel", id, sidecarGeneration })
        } catch {
          /* Closing always settles every local waiter. */
        } finally {
          entry.settle(cancelled())
        }
      }
    },
  }
}

export type LaunchIdentity = { directory: string; server: string; attempt: string }
export type PreparationProgress =
  | { unit: "bytes" | "packages"; completed: number; total?: number }
  | { unit: "activity"; detail: string }
export type ConnectorLaunchState =
  | { phase: "preparing"; stage: "launcher" | "python" | "packages"; progress: PreparationProgress }
  | { phase: "connecting" | "connected" | "disabled" }
  | { phase: "failed"; failure: ConnectorLaunchFailure; diagnostic: string }
export type LaunchSnapshot = { identity: LaunchIdentity; sidecarGeneration: string; sequence: number; state: ConnectorLaunchState }
export type LaunchActionResult = { ok: true } | { ok: false; error: "not-current" | "unavailable" | "cancelled"; detail?: string }
export type ConnectorLaunchDiagnostic = {
  identity: LaunchIdentity
  requestedCommand: string[]
  effectiveCommand: string[]
  cwd: string
  exitCode: number | null
  signal: string | null
  stderr: string
  stage: "launcher" | "python" | "packages" | "handshake" | "running"
  transcriptFile: string
}
export type ConnectorLaunchApi = {
  list(directory: string): Promise<LaunchSnapshot[]>
  subscribe(listener: (snapshot: LaunchSnapshot) => void): () => void
  retry(identity: LaunchIdentity): Promise<LaunchActionResult>
  diagnostic(identity: LaunchIdentity): Promise<{ ok: true; value: ConnectorLaunchDiagnostic } | Extract<LaunchActionResult, { ok: false }>>
  openNetworkApproval(identity: LaunchIdentity): Promise<LaunchActionResult>
  chooseWorkspace(identity: LaunchIdentity): Promise<LaunchActionResult>
}

export function isLaunchIdentity(value: unknown): value is LaunchIdentity {
  return !!value && typeof value === "object" && "directory" in value && typeof value.directory === "string" && /^(?:\/|[a-z]:[\\/])/i.test(value.directory) && "server" in value && typeof value.server === "string" && value.server !== "" && "attempt" in value && typeof value.attempt === "string" && value.attempt !== ""
}
export function isLaunchSnapshot(value: unknown): value is LaunchSnapshot {
  if (!value || typeof value !== "object" || !("identity" in value) || !isLaunchIdentity(value.identity) || !("sidecarGeneration" in value) || typeof value.sidecarGeneration !== "string" || !("sequence" in value) || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0 || !("state" in value) || !value.state || typeof value.state !== "object" || !("phase" in value.state)) return false
  const state = value.state
  if (["connecting", "connected", "disabled"].includes(String(state.phase))) return true
  if (state.phase === "failed") return "failure" in state && isConnectorLaunchFailure(state.failure) && "diagnostic" in state && typeof state.diagnostic === "string"
  if (state.phase !== "preparing" || !("stage" in state) || !["launcher", "python", "packages"].includes(String(state.stage)) || !("progress" in state) || !state.progress || typeof state.progress !== "object" || !("unit" in state.progress)) return false
  const progress = state.progress
  if (progress.unit === "activity") return "detail" in progress && typeof progress.detail === "string"
  return ["bytes", "packages"].includes(String(progress.unit)) && "completed" in progress && Number.isSafeInteger(progress.completed) && Number(progress.completed) >= 0 && (!("total" in progress) || (Number.isSafeInteger(progress.total) && Number(progress.total) >= Number(progress.completed)))
}
