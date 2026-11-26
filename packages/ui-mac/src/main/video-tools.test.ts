import { afterAll, expect, test } from "bun:test"
import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { cachePath, publish, writeJson } from "../../resources/video-mcp/cache"
import { callVideoTool } from "../../resources/video-mcp/tools"
import { createVideoServer } from "../../resources/video-mcp/server"
import { sourceOf } from "../../resources/video-mcp/source"
import { transcriptRecipe } from "../../resources/video-mcp/transcript"
import { fail, type VideoRuntime } from "../../resources/video-mcp/runtime"

const root = await mkdtemp(path.join(tmpdir(), "video-tools-"))
afterAll(() => rm(root, { recursive: true, force: true }))
const runtime: VideoRuntime = {
  directory: root,
  cacheRoot: root,
  recipe: "test",
  signal: new AbortController().signal,
  platform: "darwin-arm64",
  progress: () => {},
  component: async () => fail("component_download_failed", "No components prepared for cached tool replay"),
}

test("tool errors are typed, strict input is enforced before preparation and cancellation cannot succeed", async () => {
  for (const [name, args, context, code] of [
    ["info", { source: { kind: "path", path: "missing.wav" } }, undefined, "component_download_failed"],
    ["transcript", { source: { kind: "id", id: "1" }, cacheRoot: "/injected" }, undefined, "range_invalid"],
    ["info", { source: { kind: "path", path: "missing.wav" } }, runtime, "source_missing"],
    [
      "info",
      { source: { kind: "path", path: "missing.wav" } },
      { ...runtime, signal: AbortSignal.abort() },
      "cancelled",
    ],
    ["download", { url: "https://example.invalid/video" }, runtime, "network_denied"],
  ] as const) {
    const result = await callVideoTool(name, args, context)
    expect(result.isError).toBe(true)
    expect(result.content[0]?.type).toBe("text")
    if (result.content[0]?.type === "text")
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        code,
        action: expect.any(String),
        message: expect.any(String),
      })
    expect(result.structuredContent).toBeUndefined()
  }
})

test("actual MCP tools replay persistent info, transcript, search and project export without calling ASR", async () => {
  const source = await sourceOf(
    { kind: "path", path: path.join(import.meta.dir, "fixtures/video/speech-en.wav") },
    runtime,
  )
  source.info = {
    durationMs: 10140,
    startMs: 0,
    audioStartMs: 0,
    videoStartMs: 0,
    streams: [{ kind: "audio", codec: "pcm_s16le" }],
  }
  await writeJson(cachePath(runtime, "sources", `${source.sourceId}.json`), source)
  const segments = [
    { id: "one", startMs: 1000, endMs: 1900, text: "The Olympic gold medalist", language: "en", speaker: "speaker-1" },
  ]
  await publish(cachePath(runtime, "transcripts", source.sourceId, `${transcriptRecipe(source.info, runtime)}.json`), {
    segments,
    assets: [],
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createVideoServer(runtime)
  const client = new Client({ name: "video-tool-replay", version: "1" })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const ref = { kind: "id", id: source.sourceId }
    expect((await client.callTool({ name: "info", arguments: { source: ref } })).structuredContent).toMatchObject({
      sourceId: source.sourceId,
      cached: { transcript: true, frames: false },
    })
    expect((await client.callTool({ name: "transcript", arguments: { source: ref } })).structuredContent).toMatchObject(
      { segments, cached: true },
    )
    expect(
      (await client.callTool({ name: "search", arguments: { source: ref, text: "Olympic" } })).structuredContent,
    ).toMatchObject({ hits: [{ match: segments[0], before: [], after: [] }] })
    const exported = await client.callTool({
      name: "export",
      arguments: { source: ref, destination: "captions.srt", output: { kind: "subtitles", format: "srt" } },
    })
    expect(exported.isError).not.toBe(true)
    expect(exported.structuredContent).toMatchObject({
      files: [{ path: path.join(root, "captions.srt"), mime: "application/x-subrip", bytes: expect.any(Number) }],
    })
  } finally {
    await client.close()
    await server.close()
  }
})
