// Original-path media references. No document staging or media bytes cross this boundary.
export const MEDIA_METADATA_KEY = "codepuppy.media"
export const VIDEO_MCP_NAME = "codepuppy-video"

export type MediaAttachment = {
  kind: "video" | "audio"
  path: string
  name: string
  bytes: number
  durationMs: number | null
}

export const MEDIA_EXTENSIONS = {
  video: ["mp4", "m4v", "mov", "mkv", "webm", "avi", "mpeg", "mpg", "mts", "m2ts", "flv", "wmv", "3gp", "ogv"],
  audio: ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "aiff", "aif", "wma", "amr"],
} as const

export function mediaKindOf(name: string, mime = ""): MediaAttachment["kind"] | undefined {
  const extension = name.split(/[\\/]/).at(-1)?.split(".").at(-1)?.toLowerCase()
  if (MEDIA_EXTENSIONS.video.some((value) => value === extension)) return "video"
  if (MEDIA_EXTENSIONS.audio.some((value) => value === extension)) return "audio"
  // Browsers frequently label TypeScript as video/mp2t.
  if (extension === "ts") return undefined
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("audio/")) return "audio"
  return undefined
}

export function mediaAttachmentOf(metadata: unknown): MediaAttachment | undefined {
  if (!metadata || typeof metadata !== "object") return undefined
  const value = (metadata as Record<string, unknown>)[MEDIA_METADATA_KEY]
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  if (Object.keys(item).some((key) => !["kind", "path", "name", "bytes", "durationMs"].includes(key))) return undefined
  if (item.kind !== "video" && item.kind !== "audio") return undefined
  if (typeof item.path !== "string" || !/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(item.path) || item.path.includes("\0")) return undefined
  if (typeof item.name !== "string" || !item.name || item.name.includes("\0")) return undefined
  if (typeof item.bytes !== "number" || !Number.isSafeInteger(item.bytes) || item.bytes < 0) return undefined
  if (item.durationMs !== null && (typeof item.durationMs !== "number" || !Number.isSafeInteger(item.durationMs) || item.durationMs < 0)) return undefined
  return { kind: item.kind, path: item.path, name: item.name, bytes: item.bytes, durationMs: item.durationMs }
}

export type MediaAttachmentResult =
  | { ok: true; media: MediaAttachment }
  | { ok: false; reason: "source_missing" | "source_unreadable" | "source_changed" }

export function mediaDurationText(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000)
  const parts = [Math.floor(seconds / 60) % 60, seconds % 60].map((value) => String(value).padStart(2, "0"))
  return seconds >= 3600 ? [Math.floor(seconds / 3600), ...parts].join(":") : parts.join(":")
}
