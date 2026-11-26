import { expect, test } from "bun:test"
import path from "node:path"
import { videoUnderstandingTransform } from "./video-understanding"
import { createHubBridge } from "./hub-bridge"
import { createUnattendedState } from "./policy/unattended"
import type { ToolEditor, ToolContext } from "@opencode/plugin/promise/tool"
import type { VideoBridgeRequest } from "../../ui-mac/src/shared/video-understanding"
const producer = path.resolve(
  import.meta.dir,
  "../../codepuppy-contracts-consumer/vendor/alpha-platform-video-understanding/v1/fixtures/video-understanding",
)
test("verified understand wraps preparation and returns the final cloud result with progress and source ranges", async () => {
  const input = (await Bun.file(path.join(producer, "input.json")).json()).value,
    result = (await Bun.file(path.join(producer, "result.json")).json()).value
  const prepared = {
    sourceId: "a".repeat(64),
    sourceRange: { startMs: input.source_range.start_ms, endMs: input.source_range.end_ms },
    clip: { relativePath: "clips/one.mp4", sha256: "b".repeat(64), bytes: 1019, mime: "video/mp4" },
    sensitivity: { originalName: "speech.mp4", originalPath: "/work/speech.mp4" },
  }
  const calls: VideoBridgeRequest[] = []
  let request = 0
  const bridge = {
    available: true,
    unattended: createUnattendedState(),
    video: async (raw: Omit<VideoBridgeRequest, "type" | "id">) => {
      calls.push({ ...raw, type: "codepuppy.video.understand", id: ++request } as VideoBridgeRequest)
      return {
        type: "codepuppy.video.understand.reply" as const,
        id: request,
        ok: true as const,
        requestId: "request-id",
        state:
          raw.action === "start"
            ? { prepare: { start_ms: input.source_range.start_ms, end_ms: input.source_range.end_ms - 1 } }
            : raw.action === "query"
              ? {
                  progress: { phase: "understanding" as const, completed: 1, total: 1, unit: "items" as const },
                  upload:{file:"speech.mp4",sourceRange:input.source_range,bytes:1019},
                  result: { ...result, jobIds: ["job_one"], cached: false },
                }
              : {},
      }
    },
  } as Parameters<typeof videoUnderstandingTransform>[0]["bridge"]
  const prepares: unknown[] = [],
    progress: unknown[] = []
  const tool = {
    id: "video_understand",
    name: "understand",
    execute: async (args: unknown, _context: ToolContext) => {
      prepares.push(args)
      const value = args as { range?: { startMs: number; endMs: number } }
      return {
        output: { ...prepared, sourceRange: value.range ?? prepared.sourceRange },
        content: [{ type: "text", text: "internal preparation" }],
      }
    },
  }
  const editor = {
    list: () => [tool],
    update: (_id: string, update: (value: unknown) => void) => update(tool),
  } as unknown as ToolEditor
  videoUnderstandingTransform({ directory: "/work", bridge, verified: () => true })(editor)
  const context = {
    sessionID: "session",
    id: "call",
    messageID: "message",
    agent: "build",
    signal: new AbortController().signal,
    progress: async (value: unknown) => {
      progress.push(value)
    },
  } as ToolContext
  const actual = await tool.execute({ source: { kind: "path", path: "speech.mp4" }, question: input.question }, context)
  expect(actual).toEqual({
    output: { ...result, jobIds: ["job_one"], cached: false },
    metadata: { jobIds: ["job_one"],"codepuppy.video.upload":{file:"speech.mp4",sourceRange:input.source_range,bytes:1019} },
  })
  expect(calls.map((c) => c.action)).toEqual(["start", "prepare", "query"])
  expect(calls[0]?.call).toEqual({
    directory: "/work",
    sessionID: "session",
    agent: "build",
    callID: "call",
    messageID: "message",
  })
  expect(prepares).toHaveLength(2)
  expect(progress).toEqual([
    { "codepuppy.video.progress": { phase: "understanding", completed: 1, total: 1, unit: "items" } },
  ])
  expect("content" in actual).toBe(false)
  const ordinary = { ...tool, execute: async () => ({ output: "third party" }) }
  const untrusted = {
    list: () => [ordinary],
    update: (_id: string, update: (value: unknown) => void) => update(ordinary),
  } as unknown as ToolEditor
  videoUnderstandingTransform({ directory: "/work", bridge, verified: () => false })(untrusted)
  expect(await ordinary.execute()).toEqual({ output: "third party" })
  const controller = new AbortController()
  let cancelled = false
  bridge.video = async (raw) => {
    if (raw.action === "start") queueMicrotask(() => controller.abort(new Error("stopped")))
    if (raw.action === "cancel") {
      await Promise.resolve()
      cancelled = true
    }
    return { type: "codepuppy.video.understand.reply", id: 1, ok: true, requestId: "cancel-me", state: {} }
  }
  await expect(
    tool.execute(
      { source: { kind: "path", path: "speech.mp4" }, question: input.question },
      { ...context, signal: controller.signal },
    ),
  ).rejects.toThrow("stopped")
  expect(cancelled).toBe(true)
  cancelled=false
  bridge.video=async raw=>{if(raw.action === "cancel")cancelled=true;return {type:"codepuppy.video.understand.reply",id:1,ok:true,requestId:"failed-query",state:{error:"network"}}}
  await expect(tool.execute({source:{kind:"path",path:"speech.mp4"},question:input.question},{...context,signal:new AbortController().signal})).rejects.toThrow("network")
  expect(cancelled).toBe(true)
})
test("video bridge uses the original correlated request channel and rejects malformed full results", async () => {
  let listener: ((event: { data: unknown }) => void) | undefined
  const sent: unknown[] = []
  const bridge = createHubBridge({
    on: (_event, callback) => {
      listener = callback
    },
    postMessage: (message) => {
      sent.push(message)
    },
  })
  const call = { directory: "/work", sessionID: "session", agent: "build", callID: "call", messageID: "message" }
  const pending = bridge.video({ action: "query", requestId: "request-id", call })
  const request = sent[0] as VideoBridgeRequest
  expect(request.type).toBe("codepuppy.video.understand")
  listener!({
    data: {
      type: "codepuppy.video.understand.reply",
      id: request.id,
      ok: true,
      requestId: "request-id",
      state: { result: { text: "missing schema" } },
    },
  })
  expect(await pending).toMatchObject({ ok: false, reason: "error" })
})
