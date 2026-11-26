import { afterAll, expect, test } from "bun:test"
import { mkdtemp, copyFile, rm, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { sourceOf, requireRange, sourceFile, mediaInfo } from "../../resources/video-mcp/source"
import { fail, mediaFailure, type VideoRuntime } from "../../resources/video-mcp/runtime"

const root = await mkdtemp(path.join(tmpdir(), "video-source-"))
afterAll(() => rm(root, { recursive: true, force: true }))
const runtime: VideoRuntime = { directory: root, cacheRoot: path.join(root, "cache"), recipe: {speech:"test",frames:"test",media:"test"}, platform: "darwin-arm64", signal: new AbortController().signal, progress: () => {}, component: async () => fail("component_download_failed", "No components are prepared in this filesystem-only test") }

test("source identity hashes real media once, reconciles paths and detects a changed file", async () => {
  const first = path.join(root, "one.wav")
  const other = path.join(root, "two.wav")
  await copyFile(path.join(import.meta.dir, "fixtures/video/speech-en.wav"), first)
  await copyFile(first, other)
  const source = await sourceOf({ kind: "path", path: first }, runtime)
  expect((await sourceOf({ kind: "path", path: other }, runtime)).sourceId).toBe(source.sourceId)
  expect((await sourceOf({ kind: "id", id: source.sourceId }, runtime)).bytes).toBe(source.bytes)
  await writeFile(first, "changed local file; this is not a fabricated media container")
  await expect(sourceFile(source)).rejects.toThrow("changed since it was opened")
  expect((await sourceOf({ kind: "path", path: first }, runtime)).sourceId).not.toBe(source.sourceId)
})

test("source ranges use the actual source duration", () => {
  const info = { durationMs: 2000, startMs: 5000, audioStartMs: 0, videoStartMs: 0, streams: [] }
  expect(requireRange(undefined, info)).toEqual({ startMs: 0, endMs: 2000 })
  expect(() => requireRange({ startMs: 1, endMs: 2001 }, info)).toThrow()
})


test("a real failing probe distinguishes truncated known media from a plain text file",async()=>{
 const probe=Bun.which(process.platform === "win32" ? "where.exe" : "false")
 if(!probe)throw new Error("The non-zero-exit probe program is unavailable")
 const wav=await readFile(path.join(import.meta.dir,"fixtures/video/speech-en.wav"))
 const corrupted=path.join(root,"truncated.wav"),text=path.join(root,"plain.txt")
 await writeFile(corrupted,wav.subarray(0,48))
 await writeFile(text,"This is a real plain text file, not a media container.")
 for(const [file,code,action] of [[corrupted,"media_corrupt","Replace"],[text,"format_unsupported","convert"]]){
  const context={...runtime,component:async()=>({path:probe,digest:"test-program"})}
  const source=await sourceOf({kind:"path",path:file!},context)
  const error=await mediaInfo(source,context).catch(value=>value)
  expect(mediaFailure(error)).toMatchObject({code,action:expect.stringContaining(action!)})
 }
})
