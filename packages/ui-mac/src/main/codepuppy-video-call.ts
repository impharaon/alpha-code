import path from "node:path"
import { realpath } from "node:fs/promises"
import { parseToolDisplaySnapshot } from "@opencode/schema/tool-identity"
import { digest, readJson, cachePath } from "../../resources/video-mcp/cache"
import type { EngineClient } from "./engine-client"
import type { VideoBridgeRequest } from "../shared/video-understanding"

/** The main boundary reads the engine's minted running call, not authority claimed in a bridge message. */
export async function verifyVideoCall(
  request: Extract<VideoBridgeRequest, { action: "start" | "prepare" }>,
  client: EngineClient,
  root: string | undefined,
) {
  if (!root) throw new Error("component_download_failed")
  const call = request.call
  const [session, message] = await Promise.all([
    client.session.get({ sessionID: call.sessionID }),
    client.session.message.get({ sessionID: call.sessionID, messageID: call.messageID }),
  ])
  if (
    session.location.directory !== call.directory ||
    message.type !== "assistant" ||
    session.id !== call.sessionID ||
    message.id !== call.messageID ||
    message.agent !== call.agent
  )
    throw new Error("video_request_invalid")
  const tool = message.content.find((item) => item.type === "tool" && item.id === call.callID)
  if (!tool || tool.type !== "tool" || tool.state.status !== "running") throw new Error("video_request_invalid")
  const display = parseToolDisplaySnapshot(tool.state.metadata.codepuppyDisplay)
  if (
    tool.name !== display.technicalId ||
    display.identity.source !== "mcp" ||
    display.identity.origin !== "codepuppy-video" ||
    display.identity.name !== "understand" ||
    display.authority.kind !== "codepuppy-bundled"
  )
    throw new Error("video_request_invalid")
  const input = tool.state.input
  if (input.question !== request.request.input.question || input.model !== request.request.input.model)
    throw new Error("video_request_invalid")
  const range = input.range as { startMs: number; endMs: number } | undefined
  const selected = request.request.input.source_range
  if (
    range &&
    (request.action === "start"
      ? selected.start_ms !== range.startMs || selected.end_ms !== range.endMs
      : selected.start_ms < range.startMs || selected.end_ms > range.endMs)
  )
    throw new Error("video_request_invalid")
  const source = input.source as { kind?: unknown; id?: unknown; path?: unknown } | undefined
  if (source?.kind === "id" && source.id === request.request.sourceId) return
  if (source?.kind !== "path" || typeof source.path !== "string") throw new Error("video_request_invalid")
  // sourceOf's existing path index proves which content the admitted original path resolved to.
  // Main never opens the original media file on instructions from the connector.
  const index = cachePath(
    { cacheRoot: await realpath(root) },
    "paths",
    `${digest(path.resolve(call.directory, source.path))}.json`,
  )
  if ((await realpath(index)) !== index) throw new Error("upload-path-invalid")
  const resolved = await readJson<{ sourceId: string }>(index)
  if (resolved?.sourceId !== request.request.sourceId) throw new Error("video_request_invalid")
}
