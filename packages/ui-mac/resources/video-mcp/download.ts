import path from "node:path"
import { randomUUID } from "node:crypto"
import { mkdir, readdir } from "node:fs/promises"
import { cachePath } from "./cache"
import { runComponent } from "./process"
import { fail, mediaFailure, type VideoRuntime } from "./runtime"
import { mediaInfo, sourceOf } from "./source"

export async function downloadVideo(url: string, runtime: VideoRuntime) {
  if (!runtime.egressProxy)
    fail("network_denied", "The existing approved network proxy is not available for this download.")
  const python = await runtime.component("python")
  const ytdlp = await runtime.component("yt-dlp")
  const ejs = await runtime.component("yt-dlp-ejs")
  const node = await runtime.component("node")
  const ffmpeg = await runtime.component("ffmpeg")
  const directory = cachePath(runtime, "downloads", randomUUID())
  await mkdir(directory, { recursive: true })
  // Wheel locations are prepared by #1760; isolated Python imports only these
  // verified wheel paths, never user site-packages, configs or browser cookies.
  try {
    await runComponent(
      python.path,
      videoDownloadArgs(url,{ytdlp:ytdlp.path,ejs:ejs.path,node:node.path,ffmpeg:ffmpeg.path,proxy:runtime.egressProxy,directory,cacheRoot:runtime.cacheRoot}),
      runtime,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (runtime.signal.aborted) fail("cancelled", "The video download was cancelled.")
    if (mediaFailure(error).code === "disk_full") throw error
    if (/forbidden by policy|network policy|proxy.*(?:denied|403)|CONNECT.*403/i.test(message))
      fail("network_denied", "The existing network policy denied the video download.")
    if (/login|sign.?in|private|HTTP Error 40[13]|DRM|members.only|not available in your country/i.test(message))
      fail("site_requires_access", "This video page requires access that the downloader does not have.")
    fail("site_unavailable", "The public video could not be downloaded from this page.")
  }
  const files = (await readdir(directory)).filter((file) => !/\.(part|ytdl|json)$/.test(file))
  if (files.length !== 1) fail("site_unavailable", "The downloader did not finish a single media file.")
  const source = await sourceOf({ kind: "path", path: `${directory}/${files[0]}` }, runtime)
  const info = await mediaInfo(source, runtime)
  return {
    sourceId: source.sourceId,
    path: source.path,
    name: source.name,
    bytes: source.bytes,
    durationMs: info.durationMs,
  }
}

export function videoDownloadArgs(url:string,paths:{ytdlp:string;ejs:string;node:string;ffmpeg:string;proxy:string;directory:string;cacheRoot:string}){
  const bootstrap =
    "import runpy,sys;sys.path[:0]=sys.argv[1:3];sys.argv=sys.argv[3:];runpy.run_module('yt_dlp',run_name='__main__')"
  return [
        "-I",
        "-c",
        bootstrap,
        paths.ytdlp,
        paths.ejs,
        "yt-dlp",
        "--ignore-config",
        "--cache-dir",
        path.join(paths.cacheRoot,"yt-dlp"),
        "--no-plugin-dirs",
        "--no-remote-components",
        "--no-js-runtimes",
        "--js-runtimes",
        `node:${paths.node}`,
        "--proxy",
        paths.proxy,
        "--ffmpeg-location",
        paths.ffmpeg,
        "--no-playlist",
        "-S",
        "vcodec:h264",
        "--no-progress",
        "-o",
        `${paths.directory}/media.%(ext)s`,
        "--",
        url,
      ]
}
