import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import { cachePath, digest, publish, readPublished, withMediaLock } from "./cache"
import type { TimeRange } from "./contracts"
import { runComponent } from "./process"
import { fail, type VideoRuntime } from "./runtime"
import { mediaInfo, probeInfo, requireRange, sourceFile, verifySourceFile, type Source } from "./source"

export async function clipMedia(
  source: Source,
  range: TimeRange,
  output: { kind: "clip" } | { kind: "gif"; fps: number; width?: number },
  runtime: VideoRuntime,
) {
  const info = await mediaInfo(source, runtime)
  requireRange(range, info)
  const video = info.streams.some((stream) => stream.kind === "video")
  if (output.kind === "gif" && !video) fail("no_video_stream", "This source has no video stream for a GIF.")
  const key = digest(`${runtime.recipe}:${JSON.stringify(range)}:${JSON.stringify(output)}`)
  const directory = cachePath(runtime, "clips", source.sourceId, key)
  const manifest = `${directory}/complete.json`
  const previous = await readPublished<{ path: string; mime: string; durationMs: number }>(manifest)
  if (previous) return previous
  return withMediaLock(runtime, `clip:${source.sourceId}:${key}`, async () => {
    const cached = await readPublished<{ path: string; mime: string; durationMs: number }>(manifest)
    if (cached) return cached
    const input = await sourceFile(source)
    const ffmpeg = await runtime.component("ffmpeg")
    const probe = await runtime.component("ffprobe")
    await mkdir(directory, { recursive: true })
    const target = `${directory}/${randomUUID()}.${output.kind === "gif" ? "gif" : video ? "mp4" : "m4a"}`
    const common = [
      "-nostdin",
      "-v",
      "error",
      "-ss",
      String(range.startMs / 1000),
      "-i",
      input,
      "-t",
      String((range.endMs - range.startMs) / 1000),
    ]
    const args =
      output.kind === "gif"
        ? [
            ...common,
            "-filter_complex",
            `[0:v]scale=iw*sar:ih,setsar=1,fps=${output.fps},scale=${output.width ?? "iw"}:-1:flags=lanczos,split[x][y];[x]palettegen[p];[y][p]paletteuse`,
            "-loop",
            "0",
            "-f",
            "gif",
            target,
          ]
        : video
          ? [
              ...common,
              "-map",
              "0:v:0",
              "-map",
              "0:a:0?",
              "-vf",
              "scale=iw*sar:ih,setsar=1,pad=ceil(iw/2)*2:ceil(ih/2)*2",
              "-c:v",
              "libopenh264",
              "-pix_fmt",
              "yuv420p",
              "-c:a",
              "aac",
              "-movflags",
              "+faststart",
              "-f",
              "mp4",
              target,
            ]
          : [...common, "-vn", "-c:a", "aac", "-movflags", "+faststart", "-f", "ipod", target]
    try {
      await runComponent(ffmpeg.path, args, runtime)
      const actual = await runComponent(
        probe.path,
        ["-v", "error", "-show_format", "-show_streams", "-of", "json", target],
        runtime,
      )
      const result = probeInfo(JSON.parse(actual.stdout))
      if (Math.abs(result.durationMs - (range.endMs - range.startMs)) > 1000)
        fail("processing_failed", "The encoded clip does not match the requested source duration.")
      if (
        output.kind === "clip" &&
        video &&
        !result.streams.some((stream) => stream.kind === "video" && stream.codec === "h264")
      )
        fail("processing_failed", "The prepared encoder did not produce H.264 video.")
      await verifySourceFile(source, input)
      runtime.signal.throwIfAborted()
      const completed = {
        path: target,
        mime: output.kind === "gif" ? "image/gif" : video ? "video/mp4" : "audio/mp4",
        durationMs: result.durationMs,
      }
      await publish(manifest, completed, [target])
      await runtime.progress({
        phase: "exporting",
        completed: result.durationMs,
        total: range.endMs - range.startMs,
        unit: "ms",
      })
      return completed
    } catch (error) {
      await rm(target, { force: true })
      throw error
    }
  })
}
