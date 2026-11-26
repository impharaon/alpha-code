import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { cachePath, publish } from "../../resources/video-mcp/cache"
import { transcriptOf, transcriptRecipe } from "../../resources/video-mcp/transcript"
import { sourceOf } from "../../resources/video-mcp/source"
import { fail, type VideoRuntime } from "../../resources/video-mcp/runtime"

const root = await mkdtemp(path.join(tmpdir(), "video-transcript-"))
afterAll(() => rm(root, { recursive: true, force: true }))
const runtime: VideoRuntime = { directory: root, cacheRoot: root, recipe: {speech:"verified-assets-recipe",frames:"verified-assets-recipe",media:"verified-assets-recipe"}, signal: new AbortController().signal, platform: "darwin-arm64", progress: () => {}, component: async () => fail("component_download_failed", "No models in cache projection test") }

test("cached complete transcript is projected by overlap without recognizing again or requiring the moved source", async () => {
  const source = await sourceOf({ kind: "path", path: path.join(import.meta.dir, "fixtures/video/speech-en.wav") }, runtime)
  // Internal published result, not an invented sherpa response or accuracy fixture.
  source.info = { durationMs: 10140, startMs: 0, audioStartMs: 0, videoStartMs: 0, streams: [{ kind: "audio", codec: "pcm_s16le" }] }
  const segments = [{ id: "one", startMs: 1000, endMs: 1900, text: "The Olympic gold medalist", language: "en", speaker: "speaker-1" }, { id: "two", startMs: 3000, endMs: 5000, text: "was due to swim", language: "en", speaker: null }]
  await publish(cachePath(runtime, "transcripts", source.sourceId, `${transcriptRecipe(source.info, runtime)}.json`), { segments, assets: [] })
  source.aliases = []
  expect(await transcriptOf(source, { startMs: 1800, endMs: 2500 }, runtime)).toEqual({ sourceId: source.sourceId, range: { startMs: 1800, endMs: 2500 }, segments: [segments[0]], cached: true })
  expect((await transcriptOf(source, undefined, runtime)).segments).toEqual(segments)
  await expect(transcriptOf(source, undefined, { ...runtime, recipe: {speech:"changed-assets-recipe",frames:"changed-assets-recipe",media:"changed-assets-recipe"} })).rejects.toThrow("no longer available")
})

test("worker routes speechless covered chunks through SenseVoice without calling LID",async()=>{
 const {chunkLanguage}=await import("../../resources/video-mcp/speech-worker")
 let calls=0
 const identify=()=>{calls++;return "fr"}
 expect(chunkLanguage([],0,16000,identify)).toBeUndefined()
 expect(chunkLanguage([{start:16000,end:17000}],0,16000,identify)).toBeUndefined()
 expect(calls).toBe(0)
 expect(chunkLanguage([{start:15999,end:17000}],0,16000,identify)).toBe("fr")
 expect(calls).toBe(1)
})


test("worker reads the complete PCM cache across bounded file reads",async()=>{
 const {readAudioSamples}=await import("../../resources/video-mcp/speech-worker")
 // Our own Float32 PCM cache format, with deterministic sample values across a read boundary.
 const samples=Float32Array.from({length:17000},(_,index)=>index/17000)
 const file=path.join(root,"cache.f32")
 await writeFile(file,new Uint8Array(samples.buffer))
 const {spyOn}=await import("bun:test")
 const fs=await import("node:fs/promises")
 // Exercise the same whole-Buffer API refusal without a capacity run or a multi-GiB allocation.
 const whole=spyOn(fs,"readFile").mockRejectedValue(Object.assign(new RangeError("File size is greater than 2 GiB"),{code:"ERR_FS_FILE_TOO_LARGE"}))
 try{expect(await readAudioSamples(file,samples.length)).toEqual(samples)}finally{whole.mockRestore()}
})
