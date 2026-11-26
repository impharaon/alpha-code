import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import type { CallToolResult } from "@modelcontextprotocol/server"
import { cachePath, readPublished } from "./cache"
import { clipMedia } from "./clip"
import { inputs, outputs, type VideoToolName } from "./contracts"
import { downloadVideo } from "./download"
import { subtitleText, transcriptText, writeProjectOutput } from "./export"
import { framesOf } from "./frames"
import { fail, mediaFailure, type VideoRuntime } from "./runtime"
import { searchTranscript } from "./search"
import { mediaInfo, sourceOf } from "./source"
import { transcriptOf, transcriptRecipe } from "./transcript"

/** Only the trusted component preparer supplies this context; MCP arguments
 * cannot select executables, cache roots or the network proxy. */
export async function callVideoTool(name: string, args: unknown, runtime?: VideoRuntime): Promise<CallToolResult> {
  try {
    if (!Object.hasOwn(inputs, name)) fail("processing_failed", "The requested local video tool does not exist.")
    const tool = name as VideoToolName
    // Validate even while components are cold so malformed calls never enter preparation.
    const parsed = inputs[tool].safeParse(args)
    if (!parsed.success)
      fail("range_invalid", `Invalid ${name} input: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`)
    if (!runtime) fail("component_download_failed", "The trusted video component preparation context is not ready.")
    runtime.signal.throwIfAborted()
    const result = await execute(tool, args, runtime)
    runtime.signal.throwIfAborted()
    const structuredContent = outputs[tool].parse(result)
    const content: CallToolResult["content"] = [{ type: "text", text: JSON.stringify(structuredContent) }]
    if (tool === "transcript" && "segments" in structuredContent && !structuredContent.segments.length)
      content.push({
        type: "text",
        text: "No speech transcript is available for this source range. A source without an audio stream can still be inspected with frames and local OCR.",
      })
    if (tool === "frames" && "frames" in structuredContent) {
      for (const frame of structuredContent.frames) {
        content.push({
          type: "text",
          text: JSON.stringify({
            sourceId: structuredContent.sourceId,
            frameId: frame.id,
            actualMs: frame.actualMs,
            ocr: frame.ocr,
          }),
        })
        content.push({ type: "image", mimeType: frame.mime, data: (await readFile(frame.path)).toString("base64") })
      }
    }
    return { content, structuredContent }
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify(mediaFailure(error)) }] }
  }
}

async function execute(tool: VideoToolName, args: unknown, runtime: VideoRuntime) {
  if (tool === "download") return downloadVideo(inputs.download.parse(args).url, runtime)
  if (tool === "info") {
    const input = inputs.info.parse(args)
    const source = await sourceOf(input.source, runtime)
    const info = await mediaInfo(source, runtime)
    const transcript = await readPublished(
      cachePath(runtime, "transcripts", source.sourceId, `${transcriptRecipe(info, runtime)}.json`),
    )
    const directory = cachePath(runtime, "frames", source.sourceId)
    const manifests = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    const frames = await Promise.all(
      manifests.filter((file) => file.endsWith(".json")).map((file) => readPublished(path.join(directory, file))),
    )
    return {
      sourceId: source.sourceId,
      name: source.name,
      bytes: source.bytes,
      durationMs: info.durationMs,
      streams: info.streams,
      cached: { transcript: transcript !== undefined, frames: frames.some((value) => value !== undefined) },
    }
  }
  if (tool === "transcript") {
    const input = inputs.transcript.parse(args)
    return transcriptOf(await sourceOf(input.source, runtime), input.range, runtime)
  }
  if (tool === "frames") {
    const input = inputs.frames.parse(args)
    return framesOf(await sourceOf(input.source, runtime), input.selection, runtime)
  }
  if (tool === "search") {
    const input = inputs.search.parse(args)
    const source = await sourceOf(input.source, runtime)
    const transcript = await transcriptOf(source, undefined, runtime)
    return { sourceId: source.sourceId, hits: searchTranscript(transcript.segments, input) }
  }
  if (tool === "export") {
    const input = inputs.export.parse(args)
    const source = await sourceOf(input.source, runtime)
    const base = `${path.parse(source.name).name}-${source.sourceId.slice(0, 12)}`
    if (input.output.kind === "frames") {
      const result = await framesOf(source, input.output.selection, runtime)
      const files: { path: string; bytes: number; mime: string }[] = []
      for (const frame of result.frames) {
        const output = await writeProjectOutput(
          source,
          `${input.destination}${path.sep}`,
          `${base}-${frame.actualMs}.jpg`,
          { file: frame.path },
          runtime,
        )
        files.push({ ...output, mime: frame.mime })
      }
      const manifest = await writeProjectOutput(
        source,
        `${input.destination}${path.sep}`,
        `${base}-frames.json`,
        { text: JSON.stringify(result.frames.map((frame, index) => ({ ...frame, path: files[index]!.path }))) },
        runtime,
      )
      return { files: [...files, { ...manifest, mime: "application/json" }] }
    }
    const transcript = await transcriptOf(source, input.output.range, runtime)
    const text =
      input.output.kind === "subtitles"
        ? subtitleText(transcript.segments, input.output.format)
        : transcriptText(transcript.segments, input.output.format)
    const file = await writeProjectOutput(
      source,
      input.destination,
      `${base}.${input.output.format}`,
      { text },
      runtime,
    )
    return {
      files: [
        {
          ...file,
          mime:
            input.output.format === "vtt"
              ? "text/vtt"
              : input.output.format === "srt"
                ? "application/x-subrip"
                : input.output.format === "md"
                  ? "text/markdown"
                  : "text/plain",
        },
      ],
    }
  }
  const input =
    tool === "gif"
      ? { ...inputs.gif.parse(args), kind: "gif" as const }
      : { ...inputs.clip.parse(args), kind: "clip" as const }
  const source = await sourceOf(input.source, runtime)
  const output = await clipMedia(
    source,
    input.range,
    input.kind === "gif" ? { kind: "gif", fps: input.fps, width: input.width } : { kind: "clip" },
    runtime,
  )
  const file = await writeProjectOutput(
    source,
    input.destination,
    `${path.parse(source.name).name}-${input.range.startMs}-${input.range.endMs}${path.extname(output.path)}`,
    { file: output.path },
    runtime,
  )
  return { path: file.path, mime: output.mime, durationMs: output.durationMs }
}
