import { preparedVideoPath } from "../../resources/video-mcp/prepare"
import path from "node:path"
import { constants } from "node:fs"
import { open, realpath } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { Flock } from "@opencode/util/flock"
import {
  decodeContract,
  type VideoModelsV1,
  type VideoUnderstandingResultV1,
  type VideoSourceRange,
} from "@codepuppy/contracts-consumer"
import { cachePath, digest, fileDigest, readJson, writeJson, type Published } from "../../resources/video-mcp/cache"
import { preparedVideo } from "../../resources/video-mcp/contracts"
import type { Source } from "../../resources/video-mcp/source"
import { guardCloudEnvelope } from "./cloud-envelope-guard"
import { createVideoUploadSnapshot } from "./codepuppy-upload-manifest"
import { videoFits, type dispatchVideoUpload } from "./codepuppy-video-transport"
import type { createMainUploadService } from "./codepuppy-upload"
import type { CloudJobStatus, CloudUploadResult } from "../preload/types"
import type {
  VideoCall,
  VideoClip,
  VideoCloudRequest,
  VideoCloudResult,
  VideoCloudState,
} from "../shared/video-understanding"

type Attempt = {
  sourceRange: VideoSourceRange
  attemptKey: string
  envelopeJson: string
  manifestJson: string
  clip: VideoClip
  bodyFullySent: boolean
  jobId: string | null
  state: "dispatching" | "running" | "completed" | "failed" | "cancelled"
  result?: VideoUnderstandingResultV1
  error?: string
  cancelOutcome?: unknown
}
type RecordValue = {
  referencePath:string
  sourceId: string
  input: VideoCloudRequest["input"]
  tenant: string
  model: VideoModelsV1["models"][number]
  ranges: VideoSourceRange[]
  clips: { range: VideoSourceRange; clip: VideoClip }[]
  attempts: Attempt[]
  cancelled?: boolean
  result?: VideoCloudResult
}
type RequestPointer = { key: string; call: VideoCall; tenant: string; cancelled?: boolean }
type Work = {
  controller: AbortController
  requests: Set<string>
  state: VideoCloudState
  prepared?: () => void
  record?: RecordValue
  promise: Promise<void>
}
const sameRange = (a: VideoSourceRange, b: VideoSourceRange) => a.start_ms === b.start_ms && a.end_ms === b.end_ms
const codeOf = (error: unknown) =>
  error instanceof Error && /^[a-z][a-z0-9_-]+$/.test(error.message)
    ? error.message
    : error && typeof error === "object" && "code" in error && error.code === "ENOSPC"
      ? "disk_full"
      : "cloud_failed"
const pause = (signal: AbortSignal, ms = 500) =>
  new Promise<void>((resolve, reject) => {
    const done = () => {
      signal.removeEventListener("abort", abort)
      resolve()
    }
    const timer = setTimeout(done, ms)
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
  })

export function createMainVideoService(deps: {
  root: () => string | undefined
  identity: () => { tenantId: string; accessToken: string } | undefined
  models: () => Promise<VideoModelsV1 | { error: string }>
  upload: ReturnType<typeof createMainUploadService>
  endpoint: () => string
  sender: (call: VideoCall, signal: AbortSignal) => Promise<number>
  dispatch: typeof dispatchVideoUpload
  status: (jobId: string) => Promise<CloudJobStatus | { error: string }>
  cancel: (jobId: string) => Promise<unknown>
  artifact: (jobId: string, artifactId: string, call: VideoCall, signal: AbortSignal) => Promise<unknown>
}) {
  const work = new Map<string, Work>()
  const rootOf = () => {
    const root = deps.root()
    if (!root || !path.isAbsolute(root)) throw new Error("component_download_failed")
    return root
  }
  const fileOf = (root: string, key: string) => cachePath({ cacheRoot: root }, "cloud", `${key}.json`)
  const pointerOf = (root: string, id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("video_request_invalid")
    return cachePath({ cacheRoot: root }, "cloud-requests", `${id}.json`)
  }
  const owner = async (requestId: string, call: VideoCall) => {
    const root = rootOf(),
      identity = deps.identity(),
      pointer = await readJson<RequestPointer>(pointerOf(root, requestId))
    if (
      !identity ||
      !pointer ||
      pointer.tenant !== identity.tenantId ||
      !["directory", "sessionID", "agent", "callID", "messageID"].every(
        (key) => Reflect.get(pointer.call, key) === Reflect.get(call, key),
      )
    )
      throw new Error("not-authenticated")
    return { root, pointer }
  }
  const checkedClip = async (root: string, request: VideoCloudRequest) => {
    if (!/^[a-f0-9]{64}$/.test(request.sourceId) || !/^[a-f0-9]{64}$/.test(request.clip.sha256))
      throw new Error("video_request_invalid")
    const relative = request.clip.relativePath
    if (
      !relative ||
      relative.includes("\\") ||
      relative.split("/").some((p) => !p || p === "." || p === "..") ||
      path.isAbsolute(relative)
    )
      throw new Error("upload-path-invalid")
    const canonical = await realpath(root),
      target = path.join(canonical, ...relative.split("/"))
    if ((await realpath(target)) !== target || !target.startsWith(canonical + path.sep))
      throw new Error("upload-path-invalid")
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size !== request.clip.bytes || (await fileDigest(target)) !== request.clip.sha256)
        throw new Error("snapshot-changed")
    } finally {
      await handle.close()
    }
    const preparedPath = preparedVideoPath(
      canonical,
      request.sourceId,
      { startMs: request.input.source_range.start_ms, endMs: request.input.source_range.end_ms },
      request.clip.sha256,
    )
    if ((await realpath(preparedPath)) !== preparedPath) throw new Error("upload-path-invalid")
    const publication = await readJson<Published<unknown>>(preparedPath)
    if (
      !publication ||
      publication.sha256 !== digest(JSON.stringify(publication.value)) ||
      publication.files.length !== 1 ||
      publication.files[0]?.path !== target ||
      publication.files[0].sha256 !== request.clip.sha256 ||
      publication.files[0].bytes !== request.clip.bytes
    )
      throw new Error("video_request_invalid")
    const completed = preparedVideo.safeParse(publication.value)
    const range = request.input.source_range
    if (
      !completed.success ||
      completed.data.sourceId !== request.sourceId ||
      completed.data.sourceRange.startMs !== range.start_ms ||
      completed.data.sourceRange.endMs !== range.end_ms ||
      !["relativePath", "sha256", "bytes", "mime"].every(
        (key) => Reflect.get(completed.data.clip, key) === Reflect.get(request.clip, key),
      )
    )
      throw new Error("video_request_invalid")
    const sourcePath = cachePath({ cacheRoot: canonical }, "sources", `${request.sourceId}.json`)
    if ((await realpath(sourcePath)) !== sourcePath) throw new Error("upload-path-invalid")
    const source = await readJson<Source>(sourcePath)
    if (
      !source ||
      source.sourceId !== request.sourceId ||
      !source.path
    )
      throw new Error("video_request_invalid")
    return { target, source }
  }
  const ensureWork = (root: string, key: string, call: VideoCall) => {
    const existing = work.get(key)
    if (existing && !existing.controller.signal.aborted) return existing
    const current: Work = {
      controller: new AbortController(),
      requests: new Set(),
      state: {},
      promise: Promise.resolve(),
    }
    work.set(key, current)
    current.promise = Flock.withLock(
      `video-run:${key}`,
      async () => {
        const record = await readJson<RecordValue>(fileOf(root, key))
        if (!record) throw new Error("video_request_invalid")
        current.record = record
        const signal = current.controller.signal
        const persist = () => writeJson(fileOf(root, key), record)
        const identity = () => {
          if (deps.identity()?.tenantId !== record.tenant) throw new Error("not-authenticated")
          signal.throwIfAborted()
        }
        const progress = (phase: "uploading" | "understanding", completed: number, total?: number) => {
          current.state = {
            progress: {
              phase,
              completed,
              ...(total === undefined ? {} : { total }),
              unit: phase === "uploading" ? "bytes" : "items",
            },
          }
        }
        const split = async (range: VideoSourceRange) => {
          const middle = range.start_ms + Math.floor((range.end_ms - range.start_ms) / 2)
          if (middle <= range.start_ms) throw new Error("video_input_exceeds_upstream")
          const index = record.ranges.findIndex((item) => sameRange(item, range))
          record.ranges.splice(
            index,
            1,
            { start_ms: range.start_ms, end_ms: middle },
            { start_ms: middle, end_ms: range.end_ms },
          )
          await persist()
        }
        if (record.tenant !== deps.identity()?.tenantId) throw new Error("not-authenticated")
        if (record.result) {
          current.state = {
            result: {
              ...decodeContract(
                "VideoUnderstandingResultV1",
                (({ jobIds, cached, ...value }) => value)(record.result),
                "cloud-http",
              ),
              jobIds: record.result.jobIds,
              cached: true,
            },
          }
          return
        }
        const consents = new Map<string,string>()
        const stopAttempts = async () => {
          for (const attempt of record.attempts.filter((a) => a.state === "running" || a.state === "dispatching")) {
            if(!attempt.jobId && !attempt.bodyFullySent){
              attempt.state="cancelled"
              await persist()
              continue
            }
            while (!attempt.jobId) {
              const access = deps.identity()
              if (!access || access.tenantId !== record.tenant) throw new Error("not-authenticated")
              const request = {
                sourceId: record.sourceId,
                input: { ...record.input, source_range: attempt.sourceRange },
                clip: attempt.clip,
                sensitivity: { originalName: "" },
              }
              const checked = await checkedClip(root, request)
              // Resolve a lost acknowledgement with the SAME persisted admission, never a new paid attempt.
              const recovered = await deps.dispatch({
                endpoint: deps.endpoint(),
                accessToken: access.accessToken,
                envelopeJson: attempt.envelopeJson,
                manifestJson: attempt.manifestJson,
                path: checked.target,
                clip: attempt.clip,
                model: record.model,
                signal: new AbortController().signal,
                uploadConsent: consents.get(attempt.attemptKey),
                progress: () => {},
              })
              if ("error" in recovered) {
                if (recovered.error === "network") {
                  await pause(new AbortController().signal)
                  continue
                }
                attempt.state = "cancelled"
                attempt.error = recovered.error
                await persist()
                break
              }
              attempt.jobId = recovered.job_id
              await persist()
            }
            if (attempt.jobId) {
              for (;;) {
                const access = deps.identity()
                if (!access || access.tenantId !== record.tenant) throw new Error("not-authenticated")
                attempt.cancelOutcome = await deps.cancel(attempt.jobId)
                if (
                  attempt.cancelOutcome &&
                  typeof attempt.cancelOutcome === "object" &&
                  "error" in attempt.cancelOutcome
                ) {
                  await persist()
                  await pause(new AbortController().signal)
                  continue
                }
                attempt.state = "cancelled"
                await persist()
                break
              }
            }
          }
        }
        if (record.cancelled) await stopAttempts()
        record.cancelled = false
        try {
          for (let index = 0; index < record.ranges.length; ) {
            identity()
            const range = record.ranges[index]!
            const successful = record.attempts.find((a) => sameRange(a.sourceRange, range) && a.state === "completed")
            if (successful) {
              index++
              continue
            }
            let attempt = record.attempts.find(
              (a) => sameRange(a.sourceRange, range) && (a.state === "dispatching" || a.state === "running"),
            )
            let clip = attempt?.clip ?? record.clips.find((c) => sameRange(c.range, range))?.clip
            while (!clip) {
              current.state = {
                prepare: range,
                progress: {
                  phase: "exporting",
                  completed: range.start_ms,
                  total: record.input.source_range.end_ms,
                  unit: "ms",
                },
              }
              await new Promise<void>((resolve, reject) => {
                const abort = () => {
                  current.prepared = undefined
                  reject(signal.reason)
                }
                current.prepared = () => {
                  signal.removeEventListener("abort", abort)
                  resolve()
                }
                signal.addEventListener("abort", abort, { once: true })
                if (signal.aborted) abort()
              })
              const latest = await readJson<RecordValue>(fileOf(root, key))
              record.clips = latest?.clips ?? record.clips
              clip = record.clips.find((c) => sameRange(c.range, range))?.clip
            }
            if (!attempt?.jobId && !videoFits(clip, record.model)) {
              await split(range)
              continue
            }
            const request: VideoCloudRequest = {
              sourceId: record.sourceId,
              input: { ...record.input, source_range: range },
              clip,
              sensitivity: { originalName: "" },
            }
            const checked = attempt?.jobId
              ? undefined
              : await checkedClip(root, request).catch(async (error) => {
                  if (codeOf(error) !== "snapshot-changed" || attempt) throw error
                  record.clips = record.clips.filter((c) => !sameRange(c.range, range))
                  await persist()
                  return undefined
                })
            if (!checked && !attempt?.jobId) continue
            if (!attempt) {
              const snapshot = await createVideoUploadSnapshot(
                { directory: call.directory, path: checked!.target, originalPath: record.referencePath, ...clip },
                record.tenant,
              )
              const guarded = guardCloudEnvelope({
                autonomy: "pipeline",
                kind: "video-understanding",
                input: request.input,
              })
              if (!guarded.ok) throw new Error(guarded.error)
              attempt = {
                sourceRange: range,
                attemptKey: guarded.envelope.idempotency_key,
                envelopeJson: JSON.stringify(guarded.envelope),
                manifestJson: snapshot.manifestJson,
                clip,
                bodyFullySent: false,
                jobId: null,
                state: "dispatching",
              }
              record.attempts.push(attempt)
              await persist()
            }
            const active = attempt
            if (!active.jobId) {
              const snapshot = await createVideoUploadSnapshot(
                { directory: call.directory, path: checked!.target, originalPath: record.referencePath, ...clip },
                record.tenant,
                active.manifestJson,
              )
              const sender = snapshot.manifest.consent_required ? await deps.sender(call, signal) : 0
              identity()
              progress("uploading", 0, clip.bytes)
              const send = (access: {accessToken:string}, consent?:string) => {
                identity()
                if(consent) consents.set(active.attemptKey,consent)
                return deps.dispatch({
                  endpoint: deps.endpoint(),
                  accessToken: access.accessToken,
                  envelopeJson: active.envelopeJson,
                  manifestJson: active.manifestJson,
                  path: checked!.target,
                  clip: active.clip,
                  model: record.model,
                  signal,
                  uploadConsent: consent,
                  progress: async (bytes) => {
                    if(bytes === active.clip.bytes && !active.bodyFullySent){active.bodyFullySent=true;await persist()}
                    progress("uploading",bytes,active.clip.bytes)
                  },
                })
              }
              const consent=consents.get(active.attemptKey)
              const access=deps.identity()
              if(!access || access.tenantId !== record.tenant)throw new Error("not-authenticated")
              const retried=consent ? await send(access,consent) : undefined
              let uploaded: CloudUploadResult= retried
                ? "error" in retried ? {status:"failed",error:retried.error} : {status:"sent",privacy:"confirmed",job:retried,directory:call.directory}
                : await deps.upload.prepareVideo(sender,snapshot,send)
              if (uploaded.status === "consent-required") uploaded = await deps.upload.wait(uploaded.requestId, signal)
              if (uploaded.status === "cancelled") throw new Error("cancelled")
              if (uploaded.status !== "sent") {
                const error = uploaded.status === "failed" ? uploaded.error : "cloud_failed"
                if (error === "snapshot-changed") {
                  active.state = "failed"
                  active.error = error
                  record.clips = record.clips.filter((c) => !sameRange(c.range, range))
                  await persist()
                  continue
                }
                if (error === "video_input_exceeds_upstream") {
                  active.state = "failed"
                  active.error = error
                  await persist()
                  await split(range)
                  continue
                }
                // Temporary disconnection resumes this call with the original control bytes.
                if (error === "network") {
                  await pause(signal)
                  continue
                }
                throw new Error(error)
              }
              active.jobId = uploaded.job.job_id
              active.state = "running"
              await persist()
            }
            for (;;) {
              identity()
              progress("understanding", index, record.ranges.length)
              const status = await deps.status(active.jobId)
              identity()
              if ("error" in status && typeof status.error === "string" && !("status" in status)) {
                if (status.error === "network") {
                  await pause(signal)
                  continue
                }
                throw new Error(status.error)
              }
              if (!("status" in status)) throw new Error("cloud_failed")
              if (status.status === "completed") {
                const job = decodeContract("VideoJobResultV1", status.result, "cloud-http")
                const result =
                  job.response.kind === "inline"
                    ? { ...job, text: job.response.text }
                    : await deps.artifact(active.jobId, job.response.artifact_id, call, signal)
                const value =
                  job.response.kind === "inline"
                    ? (({ response, ...value }) => value)(result as typeof job & { text: string })
                    : result
                const decoded = decodeContract("VideoUnderstandingResultV1", value, "cloud-http")
                if (
                  decoded.model !== record.model.key ||
                  !sameRange(decoded.source_range, range)
                )
                  throw new Error("contract-incompatible")
                identity()
                active.result = decoded
                active.state = "completed"
                await persist()
                index++
                break
              }
              if (status.status === "failed" || status.status === "cancelled") {
                active.state = status.status
                active.error = (status.result as { failure_code?: string } | undefined)?.failure_code ?? "cloud_failed"
                await persist()
                if (
                  status.status === "failed" &&
                  ["video_input_exceeds_upstream", "provider_timeout"].includes(active.error)
                ) {
                  await split(range)
                  break
                }
                throw new Error(status.status === "cancelled" ? "cancelled" : active.error)
              }
              await pause(signal)
            }
          }
          identity()
          const answers = record.ranges.map(
            (range) => record.attempts.find((a) => sameRange(a.sourceRange, range) && a.state === "completed")!.result!,
          )
          const usage = answers.reduce(
            (sum, result) => ({
              input_tokens: sum.input_tokens + result.usage.input_tokens,
              output_tokens: sum.output_tokens + result.usage.output_tokens,
            }),
            { input_tokens: 0, output_tokens: 0 },
          )
          const answer = decodeContract(
            "VideoUnderstandingResultV1",
            {
              schema_version: 1,
              model: record.model.key,
              model_revision: answers[0]!.model_revision,
              source_range: record.input.source_range,
              usage,
              text: answers
                .map(
                  (result) =>
                    `[${Math.floor(result.source_range.start_ms / 60000)}:${String(Math.floor(result.source_range.start_ms / 1000) % 60).padStart(2, "0")}] ${result.text}`,
                )
                .join("\n\n"),
            },
            "cloud-http",
          )
          const result = {
            ...answer,
            jobIds: [...new Set(record.attempts.flatMap((a) => (a.jobId ? [a.jobId] : [])))],
            cached: false,
          }
          if(answers.every(answer=>answer.model_revision === record.model.revision))record.result=result
          await persist()
          current.state = { result }
        } catch (error) {
          if (signal.aborted || (error instanceof Error && error.message === "cancelled")) {
            record.cancelled = true
            await persist()
            current.state = { error: "cancelled" }
            await stopAttempts()
            await persist()
            return
          }
          current.state = { error: codeOf(error) }
        }
      },
      { dir: cachePath({ cacheRoot: root }, "cloud-locks"), signal: current.controller.signal, timeoutMs: Infinity },
    ).catch((error) => {
      current.state = { error: current.controller.signal.aborted ? "cancelled" : codeOf(error) }
    })
    return current
  }
  return {
    async disconnect() {
      for(const [key,current] of work){
        current.requests.clear()
        current.controller.abort()
        const record=current.record
        if(record){record.cancelled=true;await writeJson(fileOf(rootOf(),key),record)}
        await Promise.all((record?.attempts ?? []).filter(a=>a.jobId && a.state === "running").map(a=>deps.cancel(a.jobId!)))
      }
    },
    async start(call: VideoCall, request: VideoCloudRequest, referencePath:string) {
      if(!path.isAbsolute(referencePath))throw new Error("video_request_invalid")
      const root = rootOf(),
        identity = deps.identity()
      if (!identity) throw new Error("not-authenticated")
      const input = decodeContract("VideoUnderstandingInputV1", request.input, "cloud-http"),
        models = await deps.models()
      if ("error" in models) throw new Error(models.error)
      const model = models.models.find((row) => row.key === (input.model ?? models.default_model))
      if (!model) throw new Error("unsupported_model")
      const key = digest(
        JSON.stringify([
          identity.tenantId,
          request.sourceId,
          input.source_range,
          input.question,
          model.key,
          model.revision,
        ]),
      )
      await Flock.withLock(
        `video-init:${key}`,
        async () => {
          if (await readJson(fileOf(root, key))) return
          await checkedClip(root, { ...request, input })
          await writeJson(fileOf(root, key), {
            referencePath,
            sourceId: request.sourceId,
            input,
            tenant: identity.tenantId,
            model,
            ranges: [input.source_range],
            clips: [{ range: input.source_range, clip: request.clip }],
            attempts: [],
          } satisfies RecordValue)
        },
        { dir: cachePath({ cacheRoot: root }, "cloud-locks"), timeoutMs: Infinity },
      )
      const requestId = randomUUID()
      await writeJson(pointerOf(root, requestId), { key, call, tenant: identity.tenantId } satisfies RequestPointer)
      if (work.get(key)?.state.result || work.get(key)?.state.error) work.delete(key)
      // Only the existing first query acknowledges receipt and joins this call.
      return { requestId, state: {} }
    },
    async query(requestId: string, call: VideoCall) {
      const { root, pointer } = await owner(requestId, call)
      if (pointer.cancelled) return { requestId, state: { error: "cancelled" } }
      const current = ensureWork(root, pointer.key, call)
      current.requests.add(requestId)
      return { requestId, state: current.state }
    },
    async prepare(requestId: string, call: VideoCall, request: VideoCloudRequest) {
      const { root, pointer } = await owner(requestId, call)
      if (pointer.cancelled) throw new Error("cancelled")
      const current = ensureWork(root, pointer.key, call),
        record = await readJson<RecordValue>(fileOf(root, pointer.key))
      if (
        !record ||
        record.sourceId !== request.sourceId ||
        request.input.question !== record.input.question ||
        !current.state.prepare ||
        !sameRange(current.state.prepare, request.input.source_range)
      )
        throw new Error("video_request_invalid")
      await checkedClip(root, request)
      record.clips.push({ range: request.input.source_range, clip: request.clip })
      await writeJson(fileOf(root, pointer.key), record)
      current.state = { progress: { phase: "exporting", completed: request.input.source_range.start_ms, unit: "ms" } }
      current.prepared?.()
      current.prepared = undefined
      return { requestId, state: current.state }
    },
    async cancel(requestId: string, call: VideoCall) {
      const { root, pointer } = await owner(requestId, call)
      if (pointer.cancelled) return { requestId, state: { error: "cancelled" } }
      const current = ensureWork(root, pointer.key, call)
      await writeJson(pointerOf(root, requestId), { ...pointer, cancelled: true })
      current.requests.delete(requestId)
      if (!current.requests.size) {
        current.controller.abort()
        const record = current.record ?? (await readJson<RecordValue>(fileOf(root, pointer.key)))
        if (record) {
          record.cancelled = true
          await writeJson(fileOf(root, pointer.key), record)
        }
        await Promise.all(
          (record?.attempts ?? []).filter((a) => a.jobId && a.state === "running").map((a) => deps.cancel(a.jobId!)),
        )
        // The durable cancellation continues in main even if this RPC caller disappears.
        void current.promise
      }
      return { requestId, state: { error: "cancelled" } }
    },
  }
}
export type MainVideoService = ReturnType<typeof createMainVideoService>
