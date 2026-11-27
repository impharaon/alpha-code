import { afterAll, expect, test } from "bun:test"
import { appendFile, copyFile, mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { composerMediaDuration, registerComposerMedia } from "./composer-media-attachment"

const directory = await mkdtemp(path.join(tmpdir(), "composer-media-"))
afterAll(() => rm(directory, { recursive: true, force: true }))

test("registering a large selected file preserves its original path without copying or reading its contents", async () => {
  // Sparse filesystem fixture: exercises stat/open only, not a handwritten media container.
  const source = path.join(directory, "large.mp4")
  const file = await open(source, "w")
  await file.truncate(2_000_000_000)
  await file.close()
  expect(await registerComposerMedia(1, source, "large.mp4", 2_000_000_000, "video/mp4")).toEqual({
    ok: true, media: { kind: "video", path: source, name: "large.mp4", bytes: 2_000_000_000, durationMs: null },
  })
})

test("source validation follows the selected real file and reports missing, changed and unreadable sources", async () => {
  const source = path.join(directory, "recording.mp3")
  await writeFile(source, "filesystem fixture, not decoded in this layer")
  const size = (await Bun.file(source).stat()).size
  const link = path.join(directory, "selected.mp3")
  await symlink(source, link)
  expect(await registerComposerMedia(1, link, "selected.mp3", size, "")).toMatchObject({ ok: true, media: { path: source, name: "selected.mp3" } })
  expect(await registerComposerMedia(1, source, "recording.mp3", size + 1, "")).toEqual({ ok: false, reason: "source_changed" })
  expect(await registerComposerMedia(1, path.join(directory, "missing.mp4"), "missing.mp4", 1, "")).toEqual({ ok: false, reason: "source_missing" })
  expect(await registerComposerMedia(1, directory, "directory.mp4", 0, "")).toEqual({ ok: false, reason: "source_unreadable" })
  expect(await registerComposerMedia(1, "relative.mp4", "relative.mp4", 1, "")).toEqual({ ok: false, reason: "source_unreadable" })
})

test("duration comes from the pinned ffprobe only for a source this renderer registered, at its registered size", async () => {
  // Stand-in executable replaying the real pinned ffprobe stdout captured for speech-en.wav (fixtures/video/provenance.json).
  const probe = path.join(directory, "ffprobe")
  await writeFile(probe, `#!/bin/sh\nexec cat ${JSON.stringify(path.join(import.meta.dir, "fixtures/video/speech-en.ffprobe.json"))}\n`, { mode: 0o755 })
  const source = path.join(directory, "speech.wav")
  await copyFile(path.join(import.meta.dir, "fixtures/video/speech-en.wav"), source)
  const size = (await Bun.file(source).stat()).size
  const warnings: string[] = []
  const warn = (line: string) => void warnings.push(line)
  const ffprobe = async () => probe
  expect(await composerMediaDuration(1, source, ffprobe, warn)).toBeNull()
  expect(await registerComposerMedia(1, source, "speech.wav", size, "audio/wav")).toMatchObject({ ok: true, media: { durationMs: null } })
  expect(await composerMediaDuration(1, source, ffprobe, warn)).toBe(10_140)
  expect(await composerMediaDuration(2, source, ffprobe, warn)).toBeNull()
  expect(await composerMediaDuration(1, source, undefined, warn)).toBeNull()
  expect(await composerMediaDuration(1, source, async () => undefined, warn)).toBeNull()
  expect(warnings).toEqual([])
  expect(await composerMediaDuration(1, source, async () => Bun.which("false")!, warn)).toBeNull()
  expect(warnings).toHaveLength(1)
  await appendFile(source, "changed after selection")
  expect(await composerMediaDuration(1, source, ffprobe, warn)).toBeNull()
})
