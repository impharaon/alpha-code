import type { VideoProgress } from "@opencode/schema/codepuppy-video-progress"
import type { MediaFailure } from "./contracts"

export type ComponentName = "ffmpeg" | "ffprobe" | "sensevoice" | "sensevoice-tokens" | "vad" | "lid-encoder" | "lid-decoder" | "diarization-segmentation" | "speaker-embedding" | "whisper" | "ocr" | "ocr-model" | "python" | "yt-dlp" | "yt-dlp-ejs" | "node" | { kind: "ocr-model"; script: string }
export type PreparedComponent = { path: string; digest: string }
export type VideoRuntime = {
  directory: string
  cacheRoot: string
  // Fingerprint of the algorithm plus the actual pinned asset digests for this
  // platform (including lazy language/OCR assets). The preparer owns that list.
  recipe: {speech:string;frames:string;media:string}
  component: (name: ComponentName) => Promise<PreparedComponent>
  signal: AbortSignal
  progress: (update: VideoProgress) => void | Promise<void>
  platform: "darwin-arm64" | "win32-x64"
  egressProxy?: string
}

export class VideoError extends Error {
  constructor(readonly failure: MediaFailure) { super(failure.message) }
}

const actions: Record<MediaFailure["code"], string> = {
  source_missing: "Select the original file again, or ask about its already cached content.",
  source_unreadable: "Check access to the original file and try again.", source_changed: "Wait for the file to finish changing, then try again.",
  format_unsupported: "Use a supported media container or ask to convert the original file.", media_corrupt: "Replace the original file or download it again.",
  disk_full: "Free disk space and retry.", component_download_failed: "Retry component preparation; the original task can continue.", processing_failed: "Retry with the original file and retain the failure category if it persists.",
  range_invalid: "Choose a range within the media duration.", no_video_stream: "Use the audio transcript or provide a video file.", site_unavailable: "Download the public video yourself and attach the file.", site_requires_access: "This page requires access; attach a local file you can already access.",
  network_denied: "Use the existing network approval action, or attach the local file.", cancelled: "Request processing again when you want to continue.", cloud_failed: "Retry the platform tool after its reported failure is resolved.",
}

export function fail(code: MediaFailure["code"], message: string): never {
  throw new VideoError({ code, message, action: actions[code], retryable: ["component_download_failed", "processing_failed", "disk_full", "source_changed", "site_unavailable"].includes(code) })
}

export function mediaFailure(error: unknown): MediaFailure {
  if (error instanceof VideoError) return error.failure
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined
  const kind = code === "ENOSPC" || code === "EDQUOT" ? "disk_full" : code === "ENOENT" ? "source_missing" : code === "EACCES" || code === "EPERM" ? "source_unreadable" : error instanceof Error && error.name === "AbortError" ? "cancelled" : "processing_failed"
  return { code: kind, message: kind === "disk_full" ? "There is not enough disk space to finish processing." : kind === "cancelled" ? "Media processing was cancelled." : `Local media processing failed (${kind}).`, action: actions[kind], retryable: kind === "disk_full" || kind === "processing_failed" }
}
