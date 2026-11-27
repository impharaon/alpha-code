import { afterAll, expect, test } from "bun:test"
import { mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { registerComposerMedia } from "./composer-media-attachment"

const directory = await mkdtemp(path.join(tmpdir(), "composer-media-"))
afterAll(() => rm(directory, { recursive: true, force: true }))

test("registering a large selected file preserves its original path without copying or reading its contents", async () => {
  // Sparse filesystem fixture: exercises stat/open only, not a handwritten media container.
  const source = path.join(directory, "large.mp4")
  const file = await open(source, "w")
  await file.truncate(2_000_000_000)
  await file.close()
  expect(await registerComposerMedia(source, "large.mp4", 2_000_000_000, "video/mp4")).toEqual({
    ok: true, media: { kind: "video", path: source, name: "large.mp4", bytes: 2_000_000_000, durationMs: null },
  })
})

test("source validation follows the selected real file and reports missing, changed and unreadable sources", async () => {
  const source = path.join(directory, "recording.mp3")
  await writeFile(source, "filesystem fixture, not decoded in this layer")
  const size = (await Bun.file(source).stat()).size
  const link = path.join(directory, "selected.mp3")
  await symlink(source, link)
  expect(await registerComposerMedia(link, "selected.mp3", size, "")).toMatchObject({ ok: true, media: { path: source, name: "selected.mp3" } })
  expect(await registerComposerMedia(source, "recording.mp3", size + 1, "")).toEqual({ ok: false, reason: "source_changed" })
  expect(await registerComposerMedia(path.join(directory, "missing.mp4"), "missing.mp4", 1, "")).toEqual({ ok: false, reason: "source_missing" })
  expect(await registerComposerMedia(directory, "directory.mp4", 0, "")).toEqual({ ok: false, reason: "source_unreadable" })
  expect(await registerComposerMedia("relative.mp4", "relative.mp4", 1, "")).toEqual({ ok: false, reason: "source_unreadable" })
})
