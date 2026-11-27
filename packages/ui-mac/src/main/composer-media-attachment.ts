import { open, realpath } from "node:fs/promises"
import path from "node:path"
import { runComponent } from "../../resources/video-mcp/process"
import { probeInfo, sourceIdentity } from "../../resources/video-mcp/source"
import { mediaKindOf, type MediaAttachmentResult } from "../shared/media-attachment"

/** Real paths each renderer registered from a File the user chose, with the file identity/version seen then. */
const registered = new Map<string, { bytes: number; identity: string }>()
const registration = (sender: number, file: string) => `${sender}\0${file}`
/** In-flight duration requests by renderer and request (the attachment), each with the lifetime of its consumer. */
const pending = new Map<string, AbortController>()

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
      registered.set(registration(sender, resolved), { bytes: stat.size, identity: await sourceIdentity(resolved) })
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
 * renderer registered with these bytes, unchanged in identity/version before and after the probe, is probed with the
 * pinned ffprobe; anything else stays unknown (null). The request lives until its consumer cancels it.
 */
export async function composerMediaDuration(
  sender: number,
  request: unknown,
  filePath: unknown,
  bytes: unknown,
  ffprobe: ((signal: AbortSignal) => Promise<string | undefined>) | undefined,
  warn: (line: string) => void,
): Promise<number | null> {
  const known = typeof filePath === "string" ? registered.get(registration(sender, filePath)) : undefined
  if (typeof request !== "string" || !known || known.bytes !== bytes || !ffprobe) return null
  const key = registration(sender, request)
  pending.get(key)?.abort()
  const lifetime = new AbortController()
  pending.set(key, lifetime)
  const unchanged = () => sourceIdentity(filePath as string).then((identity) => identity === known.identity, () => false)
  try {
    const executable = await ffprobe(lifetime.signal)
    if (!executable || lifetime.signal.aborted || !(await unchanged())) return null
    const probed = await runComponent(executable, ["-v", "error", "-show_format", "-show_streams", "-of", "json", filePath as string], { signal: lifetime.signal })
    const durationMs = probeInfo(JSON.parse(probed.stdout)).durationMs
    return (await unchanged()) ? durationMs : null
  } catch (error) {
    if (!lifetime.signal.aborted) warn(`media duration probe failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  } finally {
    if (pending.get(key) === lifetime) pending.delete(key)
  }
}

/** The consumer is gone (attachment removed, composer or window closed): its waits end; shared downloads keep their other waiters. */
export function cancelComposerMediaDuration(sender: number, request?: unknown) {
  for (const [key, lifetime] of pending)
    if (request === undefined ? key.startsWith(`${sender}\0`) : key === registration(sender, String(request))) lifetime.abort()
}
