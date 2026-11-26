import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { open, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { cachePath, digest, readJson, withMediaLock, writeJson } from "./cache"
import type { MediaRef, TimeRange } from "./contracts"
import { fail, mediaFailure, type VideoRuntime } from "./runtime"
import { runComponent } from "./process"

export type MediaInfo = { durationMs: number; startMs: number; audioStartMs: number; videoStartMs: number; streams: { kind: "audio" | "video" | "subtitle"; codec: string; language?: string }[]; width?: number; height?: number; fps?: number }
export type Source = { sourceId: string; path: string; name: string; bytes: number; info?: MediaInfo; aliases: { path: string; identity: string }[] }
type FileIndex = { identity: string; sourceId: string }
const identity = (value: Awaited<ReturnType<typeof sourceStat>>) => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(":")
const sourceStat = (file: string) => stat(file, { bigint: true })

export async function updateSource(sourceId:string,runtime:VideoRuntime,change:(current:Source|undefined)=>Promise<Source>){
  return withMediaLock(runtime,`source:${sourceId}`,async()=>{
  const current=await readJson<Source>(cachePath(runtime,"sources",`${sourceId}.json`))
  const updated=await change(current)
  await writeJson(cachePath(runtime,"sources",`${sourceId}.json`),updated)
  return updated
  })
}

export async function sourceOf(ref: MediaRef, runtime: VideoRuntime): Promise<Source> {
  if (ref.kind === "id") {
    if (!/^[a-f0-9]{64}$/.test(ref.id)) fail("source_missing", "This local media reference has not been opened.")
    return await readJson<Source>(cachePath(runtime, "sources", `${ref.id}.json`)) ?? fail("source_missing", "This local media reference has not been opened.")
  }
  const requested = path.resolve(runtime.directory, ref.path)
  const indexPath = cachePath(runtime, "paths", `${digest(requested)}.json`)
  const index = await readJson<FileIndex>(indexPath)
  const info = await sourceStat(requested).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" && index) return undefined
    throw error
  })
  if (!info && index) return sourceOf({ kind: "id", id: index.sourceId }, runtime)
  if (!info?.isFile()) fail("source_unreadable", "The source is not a readable media file.")
  if (index?.identity === identity(info)) {
    const cached = await readJson<Source>(cachePath(runtime, "sources", `${index.sourceId}.json`))
    if (cached) return cached
  }
  const canonical = await realpath(requested)
  const handle = await open(canonical, "r")
  try {
    const before = await handle.stat({ bigint: true })
    const hash = createHash("sha256")
    for await (const block of createReadStream(canonical, { fd: handle.fd, autoClose: false })) hash.update(block)
    const sourceId = hash.digest("hex")
    const after = await handle.stat({ bigint: true })
    const current = await sourceStat(canonical)
    if (identity(before) !== identity(after) || identity(after) !== identity(current)) fail("source_changed", "The source changed while it was being opened.")
    {
      const source=await updateSource(sourceId,runtime,async existing=>{
      const source: Source = { ...existing, sourceId, path: canonical, name: path.basename(requested), bytes: Number(after.size), aliases: [...(existing?.aliases ?? []).filter((entry) => entry.path !== canonical), { path: canonical, identity: identity(after) }] }
      return source

      })
      await writeJson(indexPath, { identity: identity(after), sourceId })
      return source
    }
  } finally { await handle.close() }
}

export function requireRange(range: TimeRange | undefined, info: MediaInfo): TimeRange {
  const value = range ?? { startMs: 0, endMs: info.durationMs }
  if (value.startMs < 0 || value.endMs <= value.startMs || value.endMs > info.durationMs) fail("range_invalid", "The requested range lies outside the source media.")
  return value
}

export function probeInfo(raw: unknown): MediaInfo {
  const input = raw as { format?: { duration?: string; start_time?: string }; streams?: { codec_type: string; codec_name?: string; start_time?: string; duration?: string; width?: number; height?: number; avg_frame_rate?: string; tags?: { language?: string } }[] }
  const streams = input.streams ?? []
  const duration = Number(input.format?.duration ?? Math.max(...streams.map((stream) => Number(stream.duration) || 0)))
  if (!Number.isFinite(duration) || duration <= 0) fail("media_corrupt", "The media has no valid duration.")
  const startMs = Math.round((Number(input.format?.start_time) || 0) * 1000)
  const audio = streams.find((stream) => stream.codec_type === "audio")
  const video = streams.find((stream) => stream.codec_type === "video")
  if (!audio && !video) fail("format_unsupported", "This file has no supported audio or video stream.")
  const fps = video?.avg_frame_rate?.split("/").map(Number)
  return { durationMs: Math.round(duration * 1000), startMs, audioStartMs: Math.round((Number(audio?.start_time) || 0) * 1000) - startMs, videoStartMs: Math.round((Number(video?.start_time) || 0) * 1000) - startMs,
    streams: streams.flatMap((stream) => ["audio", "video", "subtitle"].includes(stream.codec_type) ? [{ kind: stream.codec_type as "audio" | "video" | "subtitle", codec: stream.codec_name ?? "unknown", ...(stream.tags?.language ? { language: stream.tags.language } : {}) }] : []),
    ...(video?.width ? { width: video.width, height: video.height, fps: fps && fps[1] ? fps[0]! / fps[1] : undefined } : {}) }
}

export async function mediaInfo(source: Source, runtime: VideoRuntime) {
  if (source.info) return source.info
  {
    const completed=await updateSource(source.sourceId,runtime,async saved=>{
    if (saved?.info) return saved
    const probe = await runtime.component("ffprobe")
    const file = await sourceFile(source)
    const result = await runComponent(probe.path, ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], runtime).catch(async (error) => {
      if (mediaFailure(error).code !== "processing_failed") throw error
      if (error instanceof Error && /not implemented|unsupported codec|decoder .*not found/i.test(error.message)) fail("format_unsupported", "The prepared decoder does not support this media format.")
      const handle = await open(file, "r")
      try {
        const header = Buffer.alloc(64)
        const read = await handle.read(header, 0, header.length, 0)
        const prefix = header.subarray(0, read.bytesRead)
        const known = /^(RIFF|RF64|OggS|fLaC|ID3)/.test(prefix.toString("ascii")) || prefix.subarray(4, 8).toString("ascii") === "ftyp" || prefix.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) || prefix[0] === 0xff && ((prefix[1] ?? 0) & 0xe0) === 0xe0
        fail(known ? "media_corrupt" : "format_unsupported", known ? "The media container is damaged or incomplete." : "This file is not a supported audio or video format.")
      } finally { await handle.close() }
    })
    const info = probeInfo(JSON.parse(result.stdout))
    await verifySourceFile(source, file)
    source.info = info
    return {...(saved ?? source),info}
    })
    return completed.info!
  }
}

export async function verifySourceFile(source: Source, file: string) {
  const known = source.aliases.find((entry) => entry.path === file)
  const actual = await sourceStat(file)
  if (!known || known.identity !== identity(actual)) fail("source_changed", "The media source changed during processing.")
}

export async function sourceFile(source: Source) {
  let changed = false
  for (const alias of source.aliases) {
    const actual = await sourceStat(alias.path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error })
    if (actual && identity(actual) === alias.identity) return alias.path
    if (actual) changed = true
  }
  return changed ? fail("source_changed", "The media source changed since it was opened.") : fail("source_missing", "The original media is no longer available for this operation.")
}
