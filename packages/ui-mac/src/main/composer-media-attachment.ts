import { open, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { runComponent } from "../../resources/video-mcp/process"
import { probeInfo } from "../../resources/video-mcp/source"
import { mediaKindOf, type MediaAttachmentResult } from "../shared/media-attachment"

/** Real paths each renderer registered from a File the user chose, with the size seen then. */
const registered = new Map<string, number>()
const registration = (sender: number, file: string) => `${sender}\0${file}`

/** Called only with a path obtained by preload from the File the user just selected. */
export async function registerComposerMedia(sender: number, filePath: unknown, name: unknown, bytes: unknown, mime: unknown): Promise<MediaAttachmentResult> {
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
      registered.set(registration(sender, resolved), stat.size)
      return { ok: true, media: { kind, path: resolved, name: path.basename(filePath), bytes: stat.size, durationMs: null } }
    } finally {
      await file.close()
    }
  }).catch((error: NodeJS.ErrnoException): MediaAttachmentResult => ({
    ok: false,
    reason: error.code === "ENOENT" ? "source_missing" : "source_unreadable",
  }))
}

/**
 * Design §4.1: the duration arrives after the attachment and never gates attaching or sending. Only a source this
 * renderer registered, still at its registered size, is probed with the pinned ffprobe; anything else stays unknown (null).
 */
export async function composerMediaDuration(
  sender: number,
  filePath: unknown,
  ffprobe: (() => Promise<string | undefined>) | undefined,
  warn: (line: string) => void,
): Promise<number | null> {
  const bytes = typeof filePath === "string" ? registered.get(registration(sender, filePath)) : undefined
  if (bytes === undefined || !ffprobe) return null
  try {
    if ((await stat(filePath as string)).size !== bytes) return null
    const executable = await ffprobe()
    if (!executable) return null
    const probed = await runComponent(executable, ["-v", "error", "-show_format", "-show_streams", "-of", "json", filePath as string], { signal: new AbortController().signal })
    return probeInfo(JSON.parse(probed.stdout)).durationMs
  } catch (error) {
    warn(`media duration probe failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}
