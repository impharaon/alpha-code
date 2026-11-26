import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { cachePath, publish } from "../../resources/video-mcp/cache"
import { transcriptOf, transcriptRecipe } from "../../resources/video-mcp/transcript"
import { sourceOf } from "../../resources/video-mcp/source"
import { fail, type VideoRuntime } from "../../resources/video-mcp/runtime"

const root = await mkdtemp(path.join(tmpdir(), "video-transcript-"))
afterAll(() => rm(root, { recursive: true, force: true }))
const runtime: VideoRuntime = { directory: root, cacheRoot: root, recipe: "verified-assets-recipe", signal: new AbortController().signal, platform: "darwin-arm64", progress: () => {}, component: async () => fail("component_download_failed", "No models in cache projection test") }

test("cached complete transcript is projected by overlap without recognizing again or requiring the moved source", async () => {
  const source = await sourceOf({ kind: "path", path: path.join(import.meta.dir, "fixtures/video/speech-en.wav") }, runtime)
  // Internal published result, not an invented sherpa response or accuracy fixture.
  source.info = { durationMs: 10140, startMs: 0, audioStartMs: 0, videoStartMs: 0, streams: [{ kind: "audio", codec: "pcm_s16le" }] }
  const segments = [{ id: "one", startMs: 1000, endMs: 1900, text: "The Olympic gold medalist", language: "en", speaker: "speaker-1" }, { id: "two", startMs: 3000, endMs: 5000, text: "was due to swim", language: "en", speaker: null }]
  await publish(cachePath(runtime, "transcripts", source.sourceId, `${transcriptRecipe(source.info, runtime)}.json`), { segments, assets: [] })
  source.aliases = []
  expect(await transcriptOf(source, { startMs: 1800, endMs: 2500 }, runtime)).toEqual({ sourceId: source.sourceId, range: { startMs: 1800, endMs: 2500 }, segments: [segments[0]], cached: true })
  expect((await transcriptOf(source, undefined, runtime)).segments).toEqual(segments)
  await expect(transcriptOf(source, undefined, { ...runtime, recipe: "changed-assets-recipe" })).rejects.toThrow("no longer available")
})
