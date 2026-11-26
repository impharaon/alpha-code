import path from "node:path"
import { cachePath, fileDigest, publish } from "./cache"
import { clipMedia } from "./clip"
import type { TimeRange } from "./contracts"
import { mediaInfo, requireRange, type Source } from "./source"
import { fail, type VideoRuntime } from "./runtime"
import { stat } from "node:fs/promises"

/** Internal completion payload for the D5 wrapper, never a model answer. */
export async function prepareVideo(source: Source, range: TimeRange | undefined, runtime: VideoRuntime) {
  const info = await mediaInfo(source, runtime)
  if (!info.streams.some((stream) => stream.kind === "video"))
    fail("no_video_stream", "Direct video understanding requires a video stream.")
  const selected = requireRange(range, info)
  const output = await clipMedia(source, selected, { kind: "clip" }, runtime)
  const relativePath = path.relative(runtime.cacheRoot, output.path).split(path.sep).join("/")
  if (relativePath.startsWith("../") || path.isAbsolute(relativePath))
    fail("processing_failed", "The prepared video is outside the managed cache.")
  const clip = {
    relativePath,
    sha256: await fileDigest(output.path),
    bytes: (await stat(output.path)).size,
    mime: output.mime,
  }
  const completed = {
    sourceId: source.sourceId,
    sourceRange: selected,
    clip,
    sensitivity: { originalName: source.name, originalPath: source.path },
  }
  await publish(cachePath(runtime, "prepared", `${clip.sha256}.json`), completed, [output.path])
  return completed
}
