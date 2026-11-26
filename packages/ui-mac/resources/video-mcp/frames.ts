import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import { cachePath, digest, publish, readPublished, withMediaLock } from "./cache"
import { frame, type Frame, type FrameSelection } from "./contracts"
import { readFrameText } from "./ocr"
import { runComponent } from "./process"
import { fail, type VideoRuntime } from "./runtime"
import { mediaInfo, requireRange, sourceFile, verifySourceFile, type Source } from "./source"

export function frameAt(points: readonly number[], requestedMs: number) {
  const index = points.findIndex((point) => point > requestedMs)
  return (
    points[index === -1 ? points.length - 1 : Math.max(0, index - 1)] ??
    fail("media_corrupt", "No decoded video frames were found.")
  )
}

export function selectedTimes(
  selection: FrameSelection,
  points: readonly number[],
  durationMs: number,
  scenes: readonly number[] = [],
) {
  const range =
    selection.kind === "times"
      ? { startMs: 0, endMs: durationMs }
      : (selection.range ?? { startMs: 0, endMs: durationMs })
  if (selection.kind === "times")
    return selection.timesMs.map((time) => ({ requestedMs: time, actualMs: frameAt(points, time) }))
  if (selection.kind === "scenes")
    return [
      ...new Set([
        frameAt(points, range.startMs),
        ...scenes.filter((time) => time >= range.startMs && time < range.endMs),
      ]),
    ]
      .sort((a, b) => a - b)
      .map((actualMs) => ({ requestedMs: null, actualMs }))
  const selected: { requestedMs: number; actualMs: number }[] = []
  for (let time = range.startMs; time < range.endMs; time += selection.intervalMs)
    selected.push({ requestedMs: time, actualMs: frameAt(points, time) })
  return selected
}

export async function framesOf(source: Source, selection: FrameSelection, runtime: VideoRuntime) {
  const info = await mediaInfo(source, runtime)
  if (!info.streams.some((stream) => stream.kind === "video"))
    fail("no_video_stream", "This source has no video stream.")
  if (selection.kind === "times") {
    if (selection.timesMs.some((time) => time >= info.durationMs))
      fail("range_invalid", "The requested frame lies outside the source duration.")
  } else requireRange(selection.range, info)
  const key = digest(`${runtime.recipe}:${JSON.stringify(selection)}`)
  const manifest = cachePath(runtime, "frames", source.sourceId, `${key}.json`)
  const found = await readPublished<Frame[]>(manifest)
  if (found) return { sourceId: source.sourceId, frames: found.map((item) => frame.parse(item)), cached: true }
  return withMediaLock(runtime, `frames:${source.sourceId}:${key}`, async () => {
    const cached = await readPublished<Frame[]>(manifest)
    if (cached) return { sourceId: source.sourceId, frames: cached.map((item) => frame.parse(item)), cached: true }
    const input = await sourceFile(source)
    const probe = await runtime.component("ffprobe")
    const ffmpeg = await runtime.component("ffmpeg")
    const pts = await runComponent(
      probe.path,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_frames",
        "-show_entries",
        "frame=best_effort_timestamp_time",
        "-of",
        "csv=p=0",
        input,
      ],
      runtime,
    )
    const points = pts.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => Number(line.split(",")[0]))
      .filter((value) => Number.isFinite(value))
      .map((time) => Math.round(time * 1000) - info.startMs)
    const scene =
      selection.kind === "scenes"
        ? await runComponent(
            ffmpeg.path,
            [
              "-nostdin",
              "-copyts",
              "-v",
              "info",
              "-i",
              input,
              "-vf",
              `select='gt(scene,${selection.threshold})',showinfo`,
              "-an",
              "-f",
              "null",
              "-",
            ],
            runtime,
          )
        : undefined
    const changes = [...(scene?.stderr ?? "").matchAll(/pts_time:([\d.e+-]+)/g)].map(
      (match) => Math.round(Number(match[1]) * 1000) - info.startMs,
    )
    const selected = selectedTimes(selection, points, info.durationMs, changes)
    const frames: Frame[] = []
    const directory = cachePath(runtime, "frames", source.sourceId, key)
    await mkdir(directory, { recursive: true })
    const created: string[] = []
    try {
      for (const entry of selected) {
        const id = digest(`${source.sourceId}:${entry.actualMs}:${runtime.recipe}`)
        const existing = frames.find((item) => item.id === id)
        if (existing) {
          frames.push({ ...existing, ...entry })
          continue
        }
        const target = `${directory}/${id}-${randomUUID()}.jpg`
        created.push(target)
        await runComponent(
          ffmpeg.path,
          [
            "-nostdin",
            "-v",
            "error",
            "-ss",
            String(entry.actualMs / 1000),
            "-i",
            input,
            "-frames:v",
            "1",
            "-vf",
            "scale=iw*sar:ih,setsar=1",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "pipe:1",
          ],
          runtime,
          target,
        )
        const dimensions = await runComponent(
          probe.path,
          ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", target],
          runtime,
        )
        const size = (JSON.parse(dimensions.stdout) as { streams: { width: number; height: number }[] }).streams[0]!
        const ocr = await readFrameText(target, size.width, size.height, runtime)
        frames.push(frame.parse({ id, ...entry, path: target, mime: "image/jpeg", ...size, ocr: ocr.ocr }))
        await runtime.progress({ phase: "frames", completed: frames.length, total: selected.length, unit: "items" })
      }
      await verifySourceFile(source, input)
      runtime.signal.throwIfAborted()
      await publish(manifest, frames, [...new Set(frames.map((item) => item.path))])
      return { sourceId: source.sourceId, frames, cached: false }
    } catch (error) {
      await Promise.all(created.map((file) => rm(file, { force: true })))
      throw error
    }
  })
}
