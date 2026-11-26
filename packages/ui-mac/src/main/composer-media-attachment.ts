import { open, realpath } from "node:fs/promises"
import path from "node:path"
import { mediaKindOf, type MediaAttachmentResult } from "../shared/media-attachment"

/** Called only with a path obtained by preload from the File the user just selected. */
export async function registerComposerMedia(filePath: unknown, name: unknown, bytes: unknown, mime: unknown): Promise<MediaAttachmentResult> {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath) || typeof name !== "string" ||
      typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0 || typeof mime !== "string")
    return { ok: false, reason: "source_unreadable" }
  const kind = mediaKindOf(name, mime)
  if (!kind) return { ok: false, reason: "source_unreadable" }
  return realpath(filePath).then(async (resolved): Promise<MediaAttachmentResult> => {
    const file = await open(resolved, "r")
    try {
      const stat = await file.stat()
      if (!stat.isFile()) return { ok: false, reason: "source_unreadable" }
      if (stat.size !== bytes) return { ok: false, reason: "source_changed" }
      return { ok: true, media: { kind, path: resolved, name: path.basename(filePath), bytes: stat.size, durationMs: null } }
    } finally {
      await file.close()
    }
  }).catch((error: NodeJS.ErrnoException): MediaAttachmentResult => ({
    ok: false,
    reason: error.code === "ENOENT" ? "source_missing" : "source_unreadable",
  }))
}
