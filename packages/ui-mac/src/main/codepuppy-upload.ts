import { randomUUID } from "node:crypto"
import { decodeUploadConsentClaims } from "@codepuppy/contracts-consumer"
import type { CloudDispatchResult, CloudUploadIntent, CloudUploadResult } from "../preload/types"
import {
  UploadAdmissionError,
  createExplicitUploadRequest,
  createExplicitUploadSnapshot,
  type ExplicitUploadSnapshot,
  type UploadClassifier,
  type UploadErrorCode,
  type UploadSelection,
} from "./codepuppy-upload-manifest"

type AccessIdentity = { accessToken: string; tenantId: string }
type ExplicitUploadBody = ReturnType<typeof createExplicitUploadRequest>
type UploadSnapshot = Omit<ExplicitUploadSnapshot, "files">
type SendUpload = (identity: AccessIdentity, consent?: string) => Promise<CloudDispatchResult | { error: string }>
type PendingUpload = {
  senderId: number
  tenantId: string
  snapshot: UploadSnapshot
  send: SendUpload
  kind: "code-review" | "video-understanding"
  consumed: boolean
  cancelled: boolean
  wait: Promise<CloudUploadResult>
  finish: (result: CloudUploadResult) => void
}

export function createMainUploadService(deps: {
  identity: () => AccessIdentity | undefined | Promise<AccessIdentity | undefined>
  issue: (input: { accessToken: string; manifestJson: string; manifestSha256: string }) => Promise<string>
  dispatch: (input: {
    accessToken: string
    body: ExplicitUploadBody
    uploadConsent?: string
  }) => Promise<CloudDispatchResult | { error: string }>
  log: (message: string) => void
  now?: () => Date
  id?: () => string
  classify?: UploadClassifier
}) {
  const pending = new Map<string, PendingUpload>()
  const admit = async (
    senderId: number,
    identity: AccessIdentity,
    snapshot: UploadSnapshot,
    send: SendUpload,
    kind: PendingUpload["kind"],
  ): Promise<CloudUploadResult> => {
    if (snapshot.manifest.tenant_id !== identity.tenantId) return fail(deps.log, "not-authenticated")
    if (!snapshot.manifest.consent_required) {
      const job = await send(identity)
      return "error" in job
        ? fail(deps.log, job.error)
        : { status: "sent", privacy: "clear", job, directory: snapshot.projectDirectory }
    }
    if (kind === "code-review")
      for (const [id, value] of pending)
        if (value.senderId === senderId && value.kind === kind) {
          value.finish({ status: "cancelled" })
          pending.delete(id)
        }
    const requestId = randomUUID(),
      completion = Promise.withResolvers<CloudUploadResult>()
    pending.set(requestId, {
      senderId,
      tenantId: identity.tenantId,
      snapshot,
      send,
      kind,
      consumed: false,
      cancelled: false,
      wait: completion.promise,
      finish: completion.resolve,
    })
    return { status: "consent-required", requestId, preview: snapshot.preview }
  }
  return {
    prepare: async (
      senderId: number,
      intent: CloudUploadIntent,
      selection: UploadSelection,
    ): Promise<CloudUploadResult> => {
      if (!intent || intent.kind !== "code-review") return fail(deps.log, "upload-selection-invalid")
      try {
        const identity = await deps.identity()
        if (!identity) return fail(deps.log, "not-authenticated")
        const snapshot = await createExplicitUploadSnapshot(selection, identity.tenantId, {
          now: deps.now,
          id: deps.id,
          classify: deps.classify,
        })
        const body = createExplicitUploadRequest(snapshot, { autonomy: "pipeline", kind: "code-review", input: {} })
        return await admit(
          senderId,
          identity,
          snapshot,
          (current, uploadConsent) => deps.dispatch({ accessToken: current.accessToken, body, uploadConsent }),
          "code-review",
        )
      } catch (error) {
        return fail(deps.log, error instanceof UploadAdmissionError ? error.code : "upload-selection-invalid")
      }
    },
    prepareVideo: async (senderId: number, snapshot: UploadSnapshot, send: SendUpload): Promise<CloudUploadResult> => {
      const identity = await deps.identity()
      if (!identity) return fail(deps.log, "not-authenticated")
      return admit(senderId, identity, snapshot, send, "video-understanding")
    },
    videoPreviews: (senderId: number) =>
      [...pending.entries()]
        .filter(([, entry]) => entry.kind === "video-understanding" && entry.senderId === senderId && !entry.consumed)
        .map(([requestId, entry]) => ({ requestId, preview: entry.snapshot.preview })),
    wait: async (requestId: string, signal: AbortSignal): Promise<CloudUploadResult> => {
      const upload = pending.get(requestId)
      if (!upload) return { status: "cancelled" }
      const abort = () => {
        upload.consumed = true
        upload.cancelled = true
        upload.finish({ status: "cancelled" })
      }
      signal.addEventListener("abort", abort, { once: true })
      if (signal.aborted) abort()
      try {
        return await upload.wait
      } finally {
        signal.removeEventListener("abort", abort)
        pending.delete(requestId)
      }
    },
    confirm: async (senderId: number, requestId: string): Promise<CloudUploadResult> => {
      const upload = pending.get(requestId)
      if (!upload || upload.senderId !== senderId || upload.consumed) return fail(deps.log, "upload-selection-invalid")
      upload.consumed = true
      const result = await (async (): Promise<CloudUploadResult> => {
        try {
          const identity = await deps.identity()
          if (!identity || identity.tenantId !== upload.tenantId) return fail(deps.log, "not-authenticated")
          const uploadConsent = await deps.issue({
            accessToken: identity.accessToken,
            manifestJson: upload.snapshot.manifestJson,
            manifestSha256: upload.snapshot.manifestSha256,
          })
          const claims = decodeUploadConsentClaims(uploadConsent),
            now = Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000)
          if (
            claims.sub !== upload.tenantId ||
            claims.manifest_id !== upload.snapshot.manifest.manifest_id ||
            claims.manifest_sha256 !== upload.snapshot.manifestSha256 ||
            claims.exp <= claims.iat ||
            claims.exp <= now ||
            JSON.stringify(claims.egress) !== JSON.stringify(upload.snapshot.manifest.egress)
          )
            return fail(deps.log, "upload-consent-invalid")
          // Identity can change while consent issuance is in flight.
          const current = await deps.identity()
          if (!current || current.tenantId !== upload.tenantId) return fail(deps.log, "not-authenticated")
          if (upload.cancelled) return { status: "cancelled" }
          const job = await upload.send(current, uploadConsent)
          return "error" in job
            ? fail(deps.log, job.error)
            : { status: "sent", privacy: "confirmed", job, directory: upload.snapshot.projectDirectory }
        } catch (error) {
          return fail(deps.log, error instanceof UploadAdmissionError ? error.code : "upload-consent-issuance-failed")
        }
      })()
      upload.finish(result)
      if (upload.kind === "code-review") pending.delete(requestId)
      return result
    },
    cancel: (senderId: number, requestId: string): CloudUploadResult => {
      const upload = pending.get(requestId)
      if (upload?.senderId === senderId) {
        upload.consumed = true
        upload.cancelled = true
        upload.finish({ status: "cancelled" })
        if (upload.kind === "code-review") pending.delete(requestId)
      }
      return { status: "cancelled" }
    },
    clear: (senderId: number) => {
      for (const [id, upload] of pending)
        if (upload.senderId === senderId) {
          upload.consumed = true
          upload.cancelled = true
          upload.finish({ status: "cancelled" })
          pending.delete(id)
        }
    },
  }
}

export function assertSafeUploadResult<T>(result: T): T {
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(inspect)
    if (!value || typeof value !== "object") return
    for (const [key, nested] of Object.entries(value)) {
      if (
        [
          "proof",
          "token",
          "accessToken",
          "manifest",
          "manifestJson",
          "manifestSha256",
          "consentToken",
          "uploadConsent",
          "consent_token",
          "upload_consent",
        ].includes(key)
      ) {
        throw new UploadAdmissionError("upload-consent-invalid")
      }
      inspect(nested)
    }
  }
  inspect(result)
  return result
}

// [#940] code 除本地准入码外还可能是派发腿透传的平台分类码 / http-<status> 回退。
// 两者都是稳定分类面(唯一咽喉 platform-error-code.ts 已按文法过滤,散文不进来),
// 日志与 renderer 都可安全承载。
function fail(log: (message: string) => void, code: UploadErrorCode | (string & {})): CloudUploadResult {
  log(`[codepuppy-upload] failed code=${code}`)
  return { status: "failed", error: code }
}
