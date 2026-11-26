import { z } from "zod"
import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createVideoRuntime, preparedFilesResult, videoInvocation } from "../../resources/video-mcp/assets"
import { mediaFailure } from "../../resources/video-mcp/runtime"

const root = await mkdtemp(path.join(tmpdir(), "video-assets-"))
afterAll(() => rm(root, { recursive: true, force: true }))
// This is our bundle-inventory schema, not a forged model/codec response.
await writeFile(
  path.join(root, "runtime.json"),
  JSON.stringify({ platform: `${process.platform}-${process.arch}`, files: {}, components: {} }),
)
const invocation = { directory: root, cacheRoot: path.join(root, "persistent-cache"), bundleDirectory: root + path.sep }

test("video entry uses the host argv cache root without deriving a version or workspace root", () => {
  expect(videoInvocation([root, "--cache-root", invocation.cacheRoot], invocation.bundleDirectory)).toEqual(invocation)
  expect(() => videoInvocation([root, "--cache-root", "relative"], root)).toThrow("trusted video invocation")
  expect(videoInvocation([], root)).toBeUndefined()
})

test("component preparation is lazy and preserves the original call metadata, remaining budget and signal", async () => {
  const controller = new AbortController()
  const deadline = Date.now() + 120000
  const requests: { ids: readonly string[]; meta: Record<string, unknown>; timeout: number; signal: AbortSignal }[] = []
  const runtime = await createVideoRuntime(invocation, {
    signal: controller.signal,
    meta: {
      "codepuppy/pinned-files.call": "host-call-value",
      "codepuppy/pinned-files.deadline": deadline,
      unrelated: "not forwarded",
    },
    ensure: async (ids, meta, options) => {
      requests.push({ ids, meta, ...options })
      return { ok: true, files: ids.map((id) => ({ id, path: path.join(root, "host-returned-entry") })) }
    },
  })
  expect(requests).toEqual([])
  const component = await runtime.component("vad")
  expect(component.path).toBe(path.join(root, "host-returned-entry"))
  expect(requests).toHaveLength(1)
  expect(requests[0]!.ids).toEqual(["speech-model/any/silero-vad"])
  expect(requests[0]!.meta).toEqual({
    "codepuppy/pinned-files.call": "host-call-value",
    "codepuppy/pinned-files.deadline": deadline,
  })
  expect(requests[0]!.timeout).toBeGreaterThan(30000)
  expect(requests[0]!.timeout).toBeLessThanOrEqual(120000)
  expect(requests[0]!.signal).toBe(controller.signal)
  controller.abort()
  await expect(runtime.component("vad")).rejects.toThrow()
  expect(requests).toHaveLength(1)
})

test("preparation failures retain disk, cancellation and unavailable categories without returning an entry", async () => {
  for (const [error, expected] of [
    ["disk", "disk_full"],
    ["cancelled", "cancelled"],
    ["integrity", "component_download_failed"],
    ["network", "component_download_failed"],
    ["unknown-file", "component_download_failed"],
  ] as const) {
    const runtime = await createVideoRuntime(invocation, {
      signal: new AbortController().signal,
      meta: { "codepuppy/pinned-files.call": "host-call-value", "codepuppy/pinned-files.deadline": Date.now() + 60000 },
      ensure: async () => ({ ok: false, error }),
    })
    const result = await runtime.component("vad").catch((error: unknown) => error)
    expect(mediaFailure(result).code).toBe(expected)
  }
  let called = false
  const runtime = await createVideoRuntime(invocation, {
    signal: new AbortController().signal,
    meta: undefined,
    ensure: async () => {
      called = true
      return { ok: false, error: "unknown-file" }
    },
  })
  expect(mediaFailure(await runtime.component("vad").catch((error: unknown) => error)).code).toBe(
    "component_download_failed",
  )
  expect(called).toBe(false)
})

test("SDK nested preparation stays associated with the original call and propagates cancellation", async () => {
  const { Client, InMemoryTransport } = await import("@modelcontextprotocol/client")
  const { createVideoServer } = await import("../../resources/video-mcp/server")
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createVideoServer(invocation)
  const client = new Client({ name: "video-asset-host", version: "1" })
  const requests: Record<string, unknown>[] = []
  const seen = Promise.withResolvers<void>()
  const cancelled = Promise.withResolvers<void>()
  client.setRequestHandler(
    "codepuppy/pinned-files.ensure",
    {
      params: z.object({ ids: z.array(z.string()), _meta: z.record(z.string(), z.unknown()) }),
      result: preparedFilesResult,
    },
    async (params, context) => {
      requests.push(params)
      if (requests.length === 1) return { ok: false, error: "disk" }
      context.mcpReq.signal.addEventListener("abort", () => cancelled.resolve(), { once: true })
      seen.resolve()
      await cancelled.promise
      return { ok: false, error: "cancelled" }
    },
  )
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  const params = {
    name: "info",
    arguments: { source: { kind: "path", path: path.join(import.meta.dir, "fixtures/video/speech-en.wav") } },
    _meta: {
      "codepuppy/pinned-files.call": "original-host-call",
      "codepuppy/pinned-files.deadline": Date.now() + 120000,
    },
  }
  try {
    await client.listTools()
    expect(requests).toEqual([])
    const result = await client.callTool(params)
    expect(result.isError).toBe(true)
    if (result.content[0]?.type === "text") expect(JSON.parse(result.content[0].text).code).toBe("disk_full")
    expect(requests[0]).toEqual({
      ids: ["ffmpeg/" + `${process.platform}-${process.arch}` + "/9.1-openh264-2.7.0"],
      _meta: params._meta,
    })
    const controller = new AbortController()
    const pending = client.callTool(params, { signal: controller.signal }).catch((error: unknown) => error)
    await seen.promise
    controller.abort()
    await pending
    await cancelled.promise
    expect(requests).toHaveLength(2)
  } finally {
    cancelled.resolve()
    await client.close()
    await server.close()
  }
})
