import { afterAll, expect, test } from "bun:test"
import { copyFile, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { subtitleText, transcriptText, writeProjectOutput } from "../../resources/video-mcp/export"
import { sourceOf } from "../../resources/video-mcp/source"
import { fail, type VideoRuntime } from "../../resources/video-mcp/runtime"

const root = await mkdtemp(path.join(tmpdir(), "video-export-"))
afterAll(() => rm(root, { recursive: true, force: true }))
const runtime: VideoRuntime = {
  directory: root,
  cacheRoot: path.join(root, "cache"),
  recipe: "test",
  signal: new AbortController().signal,
  platform: "darwin-arm64",
  progress: () => {},
  component: async () => fail("component_download_failed", "No media programs in filesystem export test"),
}

test("subtitle exports parse to the identical source milliseconds and transcript speaker labels", () => {
  const segments = [
    {
      id: "one",
      startMs: 61234,
      endMs: 64999,
      text: "The Olympic gold medalist",
      language: "en",
      speaker: "speaker-1",
    },
  ]
  for (const format of ["srt", "vtt"] as const) {
    const output = subtitleText(segments, format)
    const times = [...output.matchAll(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/g)].map(
      (match) => Number(match[1]) * 3600000 + Number(match[2]) * 60000 + Number(match[3]) * 1000 + Number(match[4]),
    )
    expect(times).toEqual([61234, 64999])
    expect(output).toContain(segments[0]!.text)
    expect(format === "srt" ? output.startsWith("1\n") : output.startsWith("WEBVTT\n\n")).toBe(true)
  }
  expect(transcriptText(segments, "md")).toContain("[00:01:01.234] speaker-1: The Olympic gold medalist")
})

test("project exports retain original media, disambiguate existing names and reject escape paths", async () => {
  const original = path.join(root, "recording.wav")
  await copyFile(path.join(import.meta.dir, "fixtures/video/speech-en.wav"), original)
  const source = await sourceOf({ kind: "path", path: original }, runtime)
  const output = await writeProjectOutput(
    source,
    "transcript.txt",
    "transcript.txt",
    { text: "complete transcript" },
    runtime,
  )
  expect(await readFile(output.path, "utf8")).toBe("complete transcript")
  const next = await writeProjectOutput(source, "transcript.txt", "transcript.txt", { text: "second result" }, runtime)
  expect(next.path).not.toBe(output.path)
  expect(await readFile(output.path, "utf8")).toBe("complete transcript")
  const sameName = await writeProjectOutput(
    source,
    "recording.wav",
    "recording.wav",
    { text: "different export" },
    runtime,
  )
  expect(sameName.path).not.toBe(original)
  expect(
    (await readFile(original)).equals(await readFile(path.join(import.meta.dir, "fixtures/video/speech-en.wav"))),
  ).toBe(true)
  await expect(writeProjectOutput(source, "../escape.txt", "result.txt", { text: "no" }, runtime)).rejects.toThrow(
    "escapes",
  )
  const outside = await mkdtemp(path.join(tmpdir(), "video-export-outside-"))
  try {
    await symlink(outside, path.join(root, "link"), "dir")
    await expect(writeProjectOutput(source, "link/result.txt", "result.txt", { text: "no" }, runtime)).rejects.toThrow(
      "escapes",
    )
    expect(await readdir(outside)).toEqual([])
  } finally {
    await rm(outside, { recursive: true, force: true })
  }
  expect((await readdir(root)).some((file) => file.endsWith(".part"))).toBe(false)
})
