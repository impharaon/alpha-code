/** Video processing facts, shared by the local producer, MCP adapter and card. */
export const VIDEO_PROGRESS_KEY = "codepuppy.video.progress"
export const VIDEO_FRAME_KEY = "codepuppy.video.frame"
const phases = [
  "preparing",
  "decoding",
  "transcribing",
  "diarizing",
  "frames",
  "exporting",
  "uploading",
  "understanding",
] as const
export type VideoProgress = {
  phase: (typeof phases)[number]
  completed: number
  total?: number
  unit: "bytes" | "ms" | "items"
}
export type VideoFrameReference = { sourceId: string; frameId: string; actualMs: number }

export function videoProgress(value: unknown): VideoProgress | undefined {
  if (!value || typeof value !== "object") return
  const progress = value as VideoProgress
  if (!phases.includes(progress.phase) || !["bytes", "ms", "items"].includes(progress.unit)) return
  if (!Number.isSafeInteger(progress.completed) || progress.completed < 0) return
  if (progress.total !== undefined && (!Number.isSafeInteger(progress.total) || progress.total < progress.completed))
    return
  return {
    phase: progress.phase,
    completed: progress.completed,
    ...(progress.total === undefined ? {} : { total: progress.total }),
    unit: progress.unit,
  }
}

export function videoFrameReference(value: unknown): VideoFrameReference | undefined {
  if (!value || typeof value !== "object") return
  const frame = value as VideoFrameReference
  if (
    typeof frame.sourceId !== "string" ||
    !frame.sourceId ||
    typeof frame.frameId !== "string" ||
    !frame.frameId ||
    !Number.isSafeInteger(frame.actualMs) ||
    frame.actualMs < 0
  )
    return
  return { sourceId: frame.sourceId, frameId: frame.frameId, actualMs: frame.actualMs }
}
