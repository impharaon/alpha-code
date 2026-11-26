import { decodeContract } from "@codepuppy/contracts-consumer"
import { videoProgress } from "../../../schema/src/codepuppy-video-progress"
import type {
  VideoUnderstandingInputV1,
  VideoUnderstandingResultV1,
  VideoSourceRange,
} from "@codepuppy/contracts-consumer"
import type { VideoProgress } from "../../../schema/src/codepuppy-video-progress"

export type VideoClip = { relativePath: string; sha256: string; bytes: number; mime: string }
export type VideoCloudRequest = {
  sourceId: string
  input: VideoUnderstandingInputV1
  clip: VideoClip
  sensitivity: { originalName: string; originalRelativePath?: string }
}
export type VideoCall = { directory: string; sessionID: string; agent: string; callID: string; messageID: string }
export type VideoCloudResult = VideoUnderstandingResultV1 & { jobIds: string[]; cached: boolean }
export type VideoCloudState = {
  progress?: VideoProgress
  prepare?: VideoSourceRange
  result?: VideoCloudResult
  error?: string
}
export type VideoBridgeRequest = {
  type: "codepuppy.video.understand"
  id: number
  call: VideoCall
} & (
  | { action: "start"; request: VideoCloudRequest }
  | { action: "query" | "cancel"; requestId: string }
  | { action: "prepare"; requestId: string; request: VideoCloudRequest }
)
export type VideoBridgeReply = { type: "codepuppy.video.understand.reply"; id: number } & (
  | { ok: true; requestId: string; state: VideoCloudState }
  | { ok: false; error: string }
)

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0
export function parseVideoBridgeRequest(value: unknown): VideoBridgeRequest | undefined {
  if (
    !record(value) ||
    value.type !== "codepuppy.video.understand" ||
    !Number.isSafeInteger(value.id) ||
    Number(value.id) < 1 ||
    !record(value.call)
  )
    return
  if (
    Object.keys(value.call).some((key) => !["directory", "sessionID", "agent", "callID", "messageID"].includes(key)) ||
    ![value.call.directory, value.call.sessionID, value.call.agent, value.call.callID, value.call.messageID].every(text)
  )
    return
  const action = value.action
  if (!["start", "query", "prepare", "cancel"].includes(String(action))) return
  const allowed = [
    "type",
    "id",
    "call",
    "action",
    ...(action === "start" ? [] : ["requestId"]),
    ...(["start", "prepare"].includes(String(action)) ? ["request"] : []),
  ]
  if (Object.keys(value).some((key) => !allowed.includes(key)) || (action !== "start" && !text(value.requestId))) return
  if (action === "start" || action === "prepare") {
    if (
      !record(value.request) ||
      Object.keys(value.request).some((key) => !["sourceId", "input", "clip", "sensitivity"].includes(key)) ||
      !text(value.request.sourceId) ||
      !record(value.request.clip) ||
      !record(value.request.sensitivity)
    )
      return
    const clip = value.request.clip
    if (
      Object.keys(clip).some((key) => !["relativePath", "sha256", "bytes", "mime"].includes(key)) ||
      ![clip.relativePath, clip.sha256, clip.mime].every(text) ||
      !Number.isSafeInteger(clip.bytes) ||
      Number(clip.bytes) <= 0
    )
      return
    if (
      Object.keys(value.request.sensitivity).some((key) => !["originalName", "originalRelativePath"].includes(key)) ||
      !text(value.request.sensitivity.originalName)
    )
      return
    try {
      decodeContract("VideoUnderstandingInputV1", value.request.input, "cloud-http")
    } catch {
      return
    }
  }
  return value as VideoBridgeRequest
}
export function parseVideoBridgeReply(value: unknown): VideoBridgeReply | undefined {
  if (!record(value) || value.type !== "codepuppy.video.understand.reply" || !Number.isSafeInteger(value.id)) return
  if (value.ok === false && text(value.error)) return value as VideoBridgeReply
  if (value.ok !== true || !text(value.requestId) || !record(value.state)) return
  try {
    if (value.state.result) {
      if (!record(value.state.result)) return
      const { jobIds, cached, ...result } = value.state.result
      if (!Array.isArray(jobIds) || !jobIds.every(text) || typeof cached !== "boolean") return
      decodeContract("VideoUnderstandingResultV1", result, "cloud-http")
    }
    if (value.state.prepare)
      decodeContract(
        "VideoUnderstandingInputV1",
        { schema_version: 1, question: "prepare", source_range: value.state.prepare },
        "cloud-http",
      )
    if (value.state.progress && !videoProgress(value.state.progress)) return
    if (value.state.error !== undefined && !text(value.state.error)) return
  } catch {
    return
  }
  return value as VideoBridgeReply
}
