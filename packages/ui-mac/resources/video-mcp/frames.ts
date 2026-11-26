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
  const key = digest(`${runtime.recipe.frames}:${JSON.stringify(selection)}`)
  const manifest = cachePath(runtime, "frames", source.sourceId, `${key}.json`)
  const found = await readPublished<Frame[]>(manifest)
  if (found) return { sourceId: source.sourceId, frames: found.map((item) => frame.parse(item)), cached: true }
  return withMediaLock(runtime, `frames:${source.sourceId}:${key}`, async () => {
    const cached = await readPublished<Frame[]>(manifest)
    if (cached) return { sourceId: source.sourceId, frames: cached.map((item) => frame.parse(item)), cached: true }
    const input = await sourceFile(source)
    const probe = await runtime.component("ffprobe")
    const ffmpeg = await runtime.component("ffmpeg")
    let progressBuffer=""
    const scene =
      selection.kind === "scenes"
        ? await runComponent(
            ffmpeg.path,
            [
              "-nostdin",
              "-copyts",
              "-progress", "pipe:2", "-nostats",
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
            undefined,
            async chunk=>{
              progressBuffer+=chunk
              const lines=progressBuffer.split(/\r?\n/);progressBuffer=lines.pop() ?? ""
              for(const line of lines){const time=/^out_time_us=(\d+)$/.exec(line);if(time)await runtime.progress({phase:"frames",completed:Math.min(info.durationMs,Math.max(0,Math.round(Number(time[1])/1000)-info.startMs)),total:info.durationMs,unit:"ms"})}
            },
          )
        : undefined
    const changes = [...(scene?.stderr ?? "").matchAll(/pts_time:([\d.e+-]+)/g)].map(
      (match) => Math.round(Number(match[1]) * 1000) - info.startMs,
    )
    const range=selection.kind === "times" ? {startMs:0,endMs:info.durationMs} : (selection.range ?? {startMs:0,endMs:info.durationMs})
    const points=selection.kind === "times" ? [...selection.timesMs].sort((a,b)=>a-b) : selection.kind === "scenes" ? [range.startMs,...changes].sort((a,b)=>a-b) : Array.from({length:Math.ceil((range.endMs-range.startMs)/selection.intervalMs)},(_,index)=>range.startMs+index*selection.intervalMs)
    const selected = selectedTimes(selection, points, info.durationMs, changes)
    const frames: Frame[] = []
    const directory = cachePath(runtime, "frames", source.sourceId, key)
    await mkdir(directory, { recursive: true })
    const created: string[] = []
    try {
      for (const entry of selected) {
        const target = `${directory}/${randomUUID()}.jpg`
        created.push(target)
        const extraction=await runComponent(
          ffmpeg.path,
          ["-nostdin","-copyts","-ss",String(entry.actualMs/1000),"-noaccurate_seek","-i",input,
            "-vf",`trim=end=${(entry.actualMs+info.startMs+1)/1000},select='lte(t,${(entry.actualMs+info.startMs)/1000})',scale=iw*sar:ih,setsar=1,showinfo`,
            "-fps_mode","passthrough","-update","1","-f","image2",target],
          runtime,
        )
        const decoded=[...extraction.stderr.matchAll(/pts_time:([\d.e+-]+)/g)].map(match=>Math.round(Number(match[1])*1000)-info.startMs)
        const actualMs=frameAt(decoded,entry.actualMs)
        const id=digest(`${source.sourceId}:${actualMs}:${runtime.recipe.frames}`)
        const existing=frames.find(item=>item.id === id)
        if(existing){await rm(target,{force:true});frames.push({...existing,requestedMs:entry.requestedMs});continue}
        const dimensions = await runComponent(
          probe.path,
          ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", target],
          runtime,
        )
        const size = (JSON.parse(dimensions.stdout) as { streams: { width: number; height: number }[] }).streams[0]!
        const ocr = await readFrameText(target, size.width, size.height, runtime)
        frames.push(frame.parse({ id, ...entry, actualMs, path: target, mime: "image/jpeg", ...size, ocr: ocr.ocr }))
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
