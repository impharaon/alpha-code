import { z } from "zod"

export const milliseconds = z.int().nonnegative()
export const timeRange = z.strictObject({ startMs: milliseconds, endMs: milliseconds }).refine((range) => range.endMs > range.startMs, "endMs must follow startMs")
export const mediaRef = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("path"), path: z.string().min(1) }), z.strictObject({ kind: z.literal("id"), id: z.string().min(1) })])
export const transcriptSegment = z.strictObject({ id: z.string(), startMs: milliseconds, endMs: milliseconds, text: z.string(), language: z.string(), speaker: z.string().nullable() })
export const frameSelection = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("times"), timesMs: z.array(milliseconds).min(1) }),
  z.strictObject({ kind: z.literal("interval"), range: timeRange.optional(), intervalMs: z.int().positive() }),
  z.strictObject({ kind: z.literal("scenes"), range: timeRange.optional(), threshold: z.number().min(0).max(1).default(0.05) }),
])
export const frame = z.strictObject({ id: z.string(), requestedMs: milliseconds.nullable(), actualMs: milliseconds, path: z.string(), mime: z.literal("image/jpeg"), width: z.int().positive(), height: z.int().positive(), ocr: z.strictObject({ text: z.string(), lines: z.array(z.strictObject({ text: z.string(), box: z.tuple([z.number(), z.number(), z.number(), z.number()]) })) }) })
export const failure = z.strictObject({ code: z.enum(["source_missing", "source_unreadable", "source_changed", "format_unsupported", "media_corrupt", "disk_full", "component_download_failed", "processing_failed", "range_invalid", "no_video_stream", "site_unavailable", "site_requires_access", "network_denied", "cancelled", "cloud_failed"]), message: z.string(), action: z.string(), retryable: z.boolean() })
export type MediaRef = z.infer<typeof mediaRef>
export type TimeRange = z.infer<typeof timeRange>
export type TranscriptSegment = z.infer<typeof transcriptSegment>
export type FrameSelection = z.infer<typeof frameSelection>
export type Frame = z.infer<typeof frame>
export type MediaFailure = z.infer<typeof failure>

export const inputs = {
  info: z.strictObject({ source: mediaRef }),
  transcript: z.strictObject({ source: mediaRef, range: timeRange.optional() }),
  frames: z.strictObject({ source: mediaRef, selection: frameSelection }),
  search: z.strictObject({ source: mediaRef, text: z.string().optional(), range: timeRange.optional(), contextBefore: z.int().nonnegative().default(1), contextAfter: z.int().nonnegative().default(1) }).refine((input) => input.text !== undefined || input.range !== undefined, "text or range is required"),
  export: z.strictObject({ source: mediaRef, output: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("subtitles"), format: z.enum(["srt", "vtt"]), range: timeRange.optional() }), z.strictObject({ kind: z.literal("transcript"), format: z.enum(["txt", "md"]), range: timeRange.optional() }), z.strictObject({ kind: z.literal("frames"), selection: frameSelection })]), destination: z.string().min(1) }),
  clip: z.strictObject({ source: mediaRef, range: timeRange, destination: z.string().min(1) }),
  gif: z.strictObject({ source: mediaRef, range: timeRange, destination: z.string().min(1), fps: z.number().positive().default(10), width: z.int().positive().optional() }),
  download: z.strictObject({ url: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "HTTP video page required") }),
}
export type VideoToolName = keyof typeof inputs
export const outputs = {
  info: z.strictObject({ sourceId: z.string(), name: z.string(), bytes: z.int().nonnegative(), durationMs: milliseconds, streams: z.array(z.strictObject({ kind: z.enum(["audio", "video", "subtitle"]), codec: z.string(), language: z.string().optional() })), cached: z.strictObject({ transcript: z.boolean(), frames: z.boolean() }) }),
  transcript: z.strictObject({ sourceId: z.string(), range: timeRange, segments: z.array(transcriptSegment), cached: z.boolean() }),
  frames: z.strictObject({ sourceId: z.string(), frames: z.array(frame), cached: z.boolean() }),
  search: z.strictObject({ sourceId: z.string(), hits: z.array(z.strictObject({ match: transcriptSegment, before: z.array(transcriptSegment), after: z.array(transcriptSegment) })) }),
  export: z.strictObject({ files: z.array(z.strictObject({ path: z.string(), mime: z.string(), bytes: z.int().nonnegative() })) }),
  clip: z.strictObject({ path: z.string(), mime: z.string(), durationMs: milliseconds }),
  gif: z.strictObject({ path: z.string(), mime: z.literal("image/gif"), durationMs: milliseconds }),
  download: z.strictObject({ sourceId: z.string(), path: z.string(), name: z.string(), bytes: z.int().nonnegative(), durationMs: milliseconds }),
}

export function videoToolDefinitions() {
  const descriptions: Record<VideoToolName, string> = {
    info: "Probe a local video or audio file; paths are resolved in the current Location.",
    transcript: "Read the complete local transcript with source timestamps and speakers. A range filters the result, never audio coverage.",
    frames: "Extract exact, interval or scene frames with source timestamps and local OCR.",
    search: "Find text or a time range in a locally cached transcript, with surrounding sentences.",
    export: "Export subtitles, a transcript or frames into the current project.",
    clip: "Precisely export a source time range as MP4/H.264/AAC or M4A/AAC.",
    gif: "Export a video source time range as a playable palette-encoded GIF.",
    download: "Download a public video page through the existing network policy; no login or browser cookies.",
  }
  return (Object.keys(inputs) as VideoToolName[]).map((name) => ({ name, description: descriptions[name], inputSchema: z.toJSONSchema(inputs[name], { unrepresentable: "any" }), outputSchema: z.toJSONSchema(outputs[name]) }))
}
