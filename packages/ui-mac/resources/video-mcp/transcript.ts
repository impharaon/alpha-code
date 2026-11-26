import { readdir, rm } from "node:fs/promises"
import { cachePath, digest, publish, readPublished, withMediaLock } from "./cache"
import { decodeAudio, recognizeAudio, type TimedText, type SpeakerSpan } from "./audio"
import type { TimeRange, TranscriptSegment } from "./contracts"
import { mediaInfo, requireRange, sourceFile, verifySourceFile, type Source, type MediaInfo } from "./source"
import type { VideoRuntime } from "./runtime"

export type Transcript = { sourceId: string; range: TimeRange; segments: TranscriptSegment[]; cached: boolean }
export const overlaps = (segment: TimeRange, range: TimeRange) => segment.endMs > range.startMs && segment.startMs < range.endMs
export const transcriptRecipe = (info: MediaInfo, runtime: VideoRuntime) => digest(`${runtime.recipe.speech}:audio-0:${info.audioStartMs}`)

export async function transcriptOf(source: Source, range: TimeRange | undefined, runtime: VideoRuntime): Promise<Transcript> {
  const info = await mediaInfo(source, runtime)
  const selected = requireRange(range, info)
  const key = transcriptRecipe(info, runtime)
  const manifest = cachePath(runtime, "transcripts", source.sourceId, `${key}.json`)
  const project = (segments: TranscriptSegment[], cached: boolean) => ({ sourceId: source.sourceId, range: selected, segments: segments.filter((segment) => overlaps(segment, selected)), cached })
  const cached = await readPublished<{ segments: TranscriptSegment[]; assets: string[] }>(manifest)
  if (cached) return project(cached.segments, true)
  return withMediaLock(runtime, `transcript:${source.sourceId}:${key}`, async () => {
    const existing = await readPublished<{ segments: TranscriptSegment[]; assets: string[] }>(manifest)
    if (existing) return project(existing.segments, true)
    if (!info.streams.some((stream) => stream.kind === "audio")) return project([], false)
    const file = await sourceFile(source)
    const audio = await decodeAudio(source, runtime)
    try {
      const chunksRoot = cachePath(runtime, "chunks", source.sourceId, key)
      const files = await readdir(chunksRoot).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error })
      const chunks = (await Promise.all(files.filter((name) => /^\d+-\d+\.json$/.test(name)).map((name) => readPublished<{ key: string; parts: TimedText[]; assets: string[] }>(`${chunksRoot}/${name}`)))).filter((value) => value !== undefined)
      const speakers = await readPublished<SpeakerSpan[]>(`${chunksRoot}/speakers.json`)
      const result = await recognizeAudio(source, audio, runtime, { chunks, speakers, save: async (kind, value) => {
        if (kind === "speakers") return publish(`${chunksRoot}/speakers.json`, value)
        const chunk = value as { key: string }
        if (!/^\d+-\d+$/.test(chunk.key)) throw new Error("Invalid chunk completion key")
        await publish(`${chunksRoot}/${chunk.key}.json`, value)
      } })
      runtime.signal.throwIfAborted()
      await verifySourceFile(source, file)
      await publish(manifest, result)
      return project(result.segments, false)
    } finally { await rm(audio.file, { force: true }) }
  })
}
