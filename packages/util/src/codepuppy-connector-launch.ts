// #1760 frozen connector-launchers §4.6 / DOC-NODE-v2 data definitions.
// Shared authority only; launcher acquisition, classification and host publication remain #1760 integration.
import type { EnsurePinnedFileResult, PinnedFileId } from "./codepuppy-pinned-files.js"

export type LauncherPlatform = "darwin-arm64" | "win32-x64"
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

export type PinnedFileRequest = { type: "codepuppy.pinned-file.ensure"; id: number; sidecarGeneration: string; fileId: PinnedFileId }
export type PinnedFileCancel = { type: "codepuppy.pinned-file.cancel"; id: number; sidecarGeneration: string }
export type PinnedFileReply = { type: "codepuppy.pinned-file.result"; id: number; sidecarGeneration: string; delivery: PinnedFileDelivery }
export type PinnedFileProgress = { type: "codepuppy.pinned-file.progress"; id: number; sidecarGeneration: string; received: number; total: number }

export function isPinnedFileDelivery(value: unknown): value is PinnedFileDelivery {
  if (!value || typeof value !== "object" || !("result" in value) || !value.result || typeof value.result !== "object" || !("ok" in value.result)) return false
  const result = value.result
  if (result.ok === true) return "path" in result && typeof result.path === "string" && /^(?:\/|[a-z]:[\\/])/i.test(result.path) && "via" in result && ["cache", "relay", "origin"].includes(String(result.via)) && (!("failure" in value) || value.failure === undefined)
  if (result.ok !== false || !("error" in result) || !["unknown-file", "network", "integrity", "disk", "cancelled"].includes(String(result.error))) return false
  if (!("failure" in value) || value.failure === undefined) return true
  const failure = value.failure
  return !!failure && typeof failure === "object" && "kind" in failure && "detail" in failure && typeof failure.detail === "string" && (
    failure.kind === "http" ? "status" in failure && Number.isInteger(failure.status) && Number(failure.status) >= 100 && Number(failure.status) <= 599
      : ["connect", "timeout", "resolution", "integrity", "disk", "other"].includes(String(failure.kind))
  )
}

/** Bound to one parent port/generation. Preparation has no ordinary RPC total timeout. */
export function createPinnedFileRequester(post: (message: PinnedFileRequest | PinnedFileCancel) => void, sidecarGeneration: string) {
  let next = 0
  let closed = false
  const pending = new Map<number, { settle: (delivery: PinnedFileDelivery) => void; progress: (received: number, total: number) => void }>()
  const cancelled = (): PinnedFileDelivery => ({ result: { ok: false, error: "cancelled" } })
  return {
    ensureFile(fileId: PinnedFileId, signal: AbortSignal, progress: (received: number, total: number) => void): Promise<PinnedFileDelivery> {
      if (closed || signal.aborted) return Promise.resolve(cancelled())
      const id = ++next
      return new Promise((resolve) => {
        const settle = (value: PinnedFileDelivery) => {
          if (!pending.delete(id)) return
          signal.removeEventListener("abort", abort)
          resolve(value)
        }
        const abort = () => {
          try { post({ type: "codepuppy.pinned-file.cancel", id, sidecarGeneration }) } catch { /* The stopped parent cannot receive cancellation. */ } finally { settle(cancelled()) }
        }
        pending.set(id, { settle, progress })
        signal.addEventListener("abort", abort, { once: true })
        try { post({ type: "codepuppy.pinned-file.ensure", id, sidecarGeneration, fileId }) }
        catch { settle(cancelled()) }
      })
    },
    receive(value: unknown) {
      if (!value || typeof value !== "object" || !("type" in value) || !["codepuppy.pinned-file.result", "codepuppy.pinned-file.progress"].includes(String(value.type))) return false
      if (!("sidecarGeneration" in value) || value.sidecarGeneration !== sidecarGeneration || !("id" in value) || typeof value.id !== "number") return true
      const entry = pending.get(value.id)
      if (!entry) return true
      if (value.type === "codepuppy.pinned-file.result" && "delivery" in value && isPinnedFileDelivery(value.delivery)) entry.settle(value.delivery)
      if (value.type === "codepuppy.pinned-file.progress" && "received" in value && "total" in value && Number.isSafeInteger(value.received) && Number.isSafeInteger(value.total) && Number(value.received) >= 0 && Number(value.total) > 0 && Number(value.received) <= Number(value.total)) entry.progress(Number(value.received), Number(value.total))
      return true
    },
    close() {
      closed = true
      for (const [id, entry] of pending) {
        try { post({ type: "codepuppy.pinned-file.cancel", id, sidecarGeneration }) } catch { /* Closing always settles every local waiter. */ } finally { entry.settle(cancelled()) }
      }
    },
  }
}
