import { afterAll, expect, test } from "bun:test"
import { appendFile, copyFile, mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { cancelComposerMediaDuration, composerMediaDuration, registerComposerMedia } from "./composer-media-attachment"

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

test("duration comes from the pinned ffprobe only for a source this renderer registered, with its registered bytes", async () => {
  // Stand-in executable replaying the real pinned ffprobe stdout captured for speech-en.wav (fixtures/video/provenance.json).
  const probe = path.join(directory, "ffprobe")
  await writeFile(probe, `#!/bin/sh\nexec cat ${JSON.stringify(path.join(import.meta.dir, "fixtures/video/speech-en.ffprobe.json"))}\n`, { mode: 0o755 })
  const source = path.join(directory, "speech.wav")
  await copyFile(path.join(import.meta.dir, "fixtures/video/speech-en.wav"), source)
  const size = (await Bun.file(source).stat()).size
  const warnings: string[] = []
  const warn = (line: string) => void warnings.push(line)
  const ffprobe = async () => probe
  expect(await composerMediaDuration(1, "card", source, size, ffprobe, warn)).toBeNull()
  expect(await registerComposerMedia(1, source, "speech.wav", size, "audio/wav")).toMatchObject({ ok: true, media: { durationMs: null } })
  expect(await composerMediaDuration(1, "card", source, size, ffprobe, warn)).toBe(10_140)
  expect(await composerMediaDuration(2, "card", source, size, ffprobe, warn)).toBeNull()
  expect(await composerMediaDuration(1, "card", source, size, undefined, warn)).toBeNull()
  expect(await composerMediaDuration(1, "card", source, size, async () => undefined, warn)).toBeNull()
  expect(warnings).toEqual([])
  expect(await composerMediaDuration(1, "card", source, size, async () => Bun.which("false")!, warn)).toBeNull()
  expect(warnings).toHaveLength(1)
  expect(await registerComposerMedia(1, source, "speech.wav", size, "audio/wav")).toMatchObject({ ok: true })
  await appendFile(source, "changed after selection")
  expect(await registerComposerMedia(1, source, "speech.wav", size + 23, "audio/wav")).toMatchObject({ ok: true })
  // The card attached before the change asks with its own bytes; the newer registration does not answer it.
  expect(await composerMediaDuration(1, "card", source, size, ffprobe, warn)).toBeNull()
})

test("a source changed while the component is being prepared or probed keeps an unknown duration", async () => {
  const fixture = path.join(import.meta.dir, "fixtures/video/speech-en.wav")
  const replay = path.join(directory, "ffprobe-replay")
  await writeFile(replay, `#!/bin/sh\nexec cat ${JSON.stringify(path.join(import.meta.dir, "fixtures/video/speech-en.ffprobe.json"))}\n`, { mode: 0o755 })
  const size = (await Bun.file(fixture).stat()).size
  const other = path.join(directory, "other.wav")
  await writeFile(other, Buffer.alloc(size, 1))
  const cases: Record<string, (source: string) => Promise<string>> = {
    "same-size rewrite during preparation": async (source) => { await writeFile(source, Buffer.alloc(size, 2)); return replay },
    "replaced by a link during preparation": async (source) => { await rm(source); await symlink(other, source); return replay },
    "rewritten while the probe runs": async (source) => {
      const probe = path.join(directory, "ffprobe-rewrites")
      await writeFile(probe, `#!/bin/sh\nprintf 'same size' | dd of=${JSON.stringify(source)} bs=1 seek=0 conv=notrunc 2>/dev/null\nexec cat ${JSON.stringify(path.join(import.meta.dir, "fixtures/video/speech-en.ffprobe.json"))}\n`, { mode: 0o755 })
      return probe
    },
  }
  for (const [name, change] of Object.entries(cases)) {
    const source = path.join(directory, `${name.replaceAll(" ", "-")}.wav`)
    await copyFile(fixture, source)
    expect(await registerComposerMedia(1, source, "speech.wav", size, "audio/wav")).toMatchObject({ ok: true })
    expect([name, await composerMediaDuration(1, "card", source, size, () => change(source), () => {})]).toEqual([name, null])
  }
})

test("a duration request ends with its consumer: the preparation wait and the probe process are cancelled", async () => {
  const source = path.join(directory, "cancelled.wav")
  await copyFile(path.join(import.meta.dir, "fixtures/video/speech-en.wav"), source)
  const size = (await Bun.file(source).stat()).size
  expect(await registerComposerMedia(3, source, "cancelled.wav", size, "audio/wav")).toMatchObject({ ok: true })
  let preparing: AbortSignal | undefined
  const waiting = composerMediaDuration(3, "removed-card", source, size, (signal) => {
    preparing = signal
    return new Promise((resolve) => signal.addEventListener("abort", () => resolve(undefined), { once: true }))
  }, () => {})
  await Promise.resolve()
  cancelComposerMediaDuration(3, "removed-card")
  expect(await waiting).toBeNull()
  expect(preparing?.aborted).toBe(true)
  const started = path.join(directory, "probe-started")
  const probe = path.join(directory, "ffprobe-sleeps")
  await writeFile(probe, `#!/bin/sh\ntouch ${JSON.stringify(started)}\nexec sleep 600\n`, { mode: 0o755 })
  const running = composerMediaDuration(3, "closed-window", source, size, async () => probe, () => {})
  while (!(await Bun.file(started).exists())) await Bun.sleep(10)
  cancelComposerMediaDuration(3)
  expect(await running).toBeNull()
})
