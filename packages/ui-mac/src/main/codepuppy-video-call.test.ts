import { expect, test } from "bun:test"
import { Schema } from "effect"
import { mkdtemp, copyFile, realpath, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { Session } from "../../../schema/src/session"
import { SessionMessage } from "../../../schema/src/session-message"
import { sourceOf } from "../../resources/video-mcp/source"
import { engineClient } from "./engine-client"
import { verifyVideoCall } from "./codepuppy-video-call"
import type { VideoBridgeRequest } from "../shared/video-understanding"

test("main verifies the engine minted running video call and original admitted source instead of bridge authority", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "video-call-")))
  try {
    await copyFile(path.join(import.meta.dir, "fixtures/video/platform-sample.mp4"), path.join(root, "speech.mp4"))
    const source = await sourceOf(
      { kind: "path", path: "speech.mp4" },
      {
        directory: root,
        cacheRoot: root,
        signal: new AbortController().signal,
        recipe: "test",
        progress: () => {},
        platform: "darwin-arm64",
        component: async () => {
          throw new Error("unused")
        },
      },
    )
    // Own repository schema constructors/encoders, never a hand-written engine response format.
    const session = Schema.decodeUnknownSync(Schema.toEncoded(Session.Info))({
      id: "ses_video",
      projectID: "proj_video",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
      location: { directory: root },
    })
    const display = {
      identity: { source: "mcp", origin: "codepuppy-video", name: "understand" },
      technicalId: "video_understand",
      authority: { kind: "codepuppy-bundled", bindingId: "video", evidenceDigest: `sha256:${"a".repeat(64)}` },
    }
    const message = Schema.decodeUnknownSync(Schema.toEncoded(SessionMessage.Assistant))({
      id: "msg_video",
      time: { created: 1 },
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content: [
        {
          type: "tool",
          id: "call",
          name: "video_understand",
          time: { created: 1 },
          state: {
            status: "running",
            input: { source: { kind: "path", path: "speech.mp4" }, question: "question" },
            metadata: { codepuppyDisplay: display },
          },
        },
      ],
    })
    const server = Bun.serve({
      port: 0,
      fetch: (request) =>
        Response.json({ data: new URL(request.url).pathname.includes("/message/") ? message : session }),
    })
    try {
      const client = engineClient({ url: `http://127.0.0.1:${server.port}`, username: null, password: null })
      const request: Extract<VideoBridgeRequest, { action: "start" }> = {
        type: "codepuppy.video.understand",
        id: 1,
        action: "start",
        call: { directory: root, sessionID: "ses_video", messageID: "msg_video", agent: "build", callID: "call" },
        request: {
          sourceId: source.sourceId,
          input: { schema_version: 1, question: "question", source_range: { start_ms: 0, end_ms: 40 } },
          clip: { relativePath: "clips/one.mp4", sha256: source.sourceId, bytes: 1019, mime: "video/mp4" },
          sensitivity: { originalName: "speech.mp4" },
        },
      }
      await verifyVideoCall(request, client, root)
      await expect(
        verifyVideoCall({ ...request, call: { ...request.call, agent: "other" } }, client, root),
      ).rejects.toThrow("video_request_invalid")
      await expect(
        verifyVideoCall({ ...request, request: { ...request.request, sourceId: "b".repeat(64) } }, client, root),
      ).rejects.toThrow("video_request_invalid")
      Object.assign(message.content[0]!.state.input, { range: { startMs: 10, endMs: 40 } })
      await expect(verifyVideoCall(request, client, root)).rejects.toThrow("video_request_invalid")
      delete message.content[0]!.state.input.range
      message.content[0]!.state.metadata.codepuppyDisplay.authority.kind = "not-asserted"
      await expect(verifyVideoCall(request, client, root)).rejects.toThrow("video_request_invalid")
    } finally {
      await server.stop(true)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
