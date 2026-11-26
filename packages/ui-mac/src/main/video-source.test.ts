import { afterAll, expect, test } from "bun:test"
import { mkdtemp, copyFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { sourceOf, requireRange } from "../../resources/video-mcp/source"
import { fail, type VideoRuntime } from "../../resources/video-mcp/runtime"

const root = await mkdtemp(path.join(tmpdir(), "video-source-"))
afterAll(() => rm(root, { recursive: true, force: true }))
const runtime: VideoRuntime = { directory: root, cacheRoot: path.join(root, "cache"), recipe: "test", platform: "darwin-arm64", signal: new AbortController().signal, progress: () => {}, component: async () => fail("component_download_failed", "No components are prepared in this filesystem-only test") }

test("source identity hashes real media once, reconciles paths and detects a changed file", async () => {
  const first = path.join(root, "one.wav")
  const other = path.join(root, "two.wav")
  await copyFile(path.join(import.meta.dir, "fixtures/video/speech-en.wav"), first)
  await copyFile(first, other)
  const source = await sourceOf({ kind: "path", path: first }, runtime)
  expect((await sourceOf({ kind: "path", path: other }, runtime)).sourceId).toBe(source.sourceId)
  expect((await sourceOf({ kind: "id", id: source.sourceId }, runtime)).bytes).toBe(source.bytes)
  await writeFile(first, "changed local file; this is not a fabricated media container")
  expect((await sourceOf({ kind: "path", path: first }, runtime)).sourceId).not.toBe(source.sourceId)
})

test("source ranges use the actual source duration", () => {
  const info = { durationMs: 2000, startMs: 5000, audioStartMs: 0, videoStartMs: 0, streams: [] }
  expect(requireRange(undefined, info)).toEqual({ startMs: 0, endMs: 2000 })
  expect(() => requireRange({ startMs: 1, endMs: 2001 }, info)).toThrow()
})
