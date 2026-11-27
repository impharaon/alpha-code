import { VIDEO_PROGRESS_KEY } from "@opencode/schema/codepuppy-video-progress"
import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"
import { pathToFileURL, fileURLToPath } from "node:url"
import { createVideoRuntime, preparedFilesResult, videoInvocation, type VideoInvocation } from "./assets"
import { mediaFailure } from "./runtime"
import { videoToolDefinitions } from "./contracts"
import { callVideoTool } from "./tools"
import type { VideoRuntime } from "./runtime"

export function createVideoServer(input?: VideoRuntime | VideoInvocation) {
  const server = new Server({ name: "codepuppy-video", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler("tools/list", async () => ({ tools: videoToolDefinitions() }) as never)
  server.setRequestHandler("tools/call", async (request, context) => {
    let sequence = 0
    try {
      const runtime =
        input &&
        ("component" in input
          ? input
          : await createVideoRuntime(input, {
              signal: context.mcpReq.signal,
              meta: context.mcpReq._meta,
              ensure: (ids, metadata, options) =>
                server.request(
                  { method: "codepuppy/pinned-files.ensure", params: { ids: [...ids], _meta: metadata } },
                  preparedFilesResult,
                  { ...options, resetTimeoutOnProgress: false },
                ),
            }))
      return await callVideoTool(
        request.params.name,
        request.params.arguments,
        runtime && {
          ...runtime,
          signal: AbortSignal.any([runtime.signal, context.mcpReq.signal]),
          progress: async (update) => {
            if (context.mcpReq.signal.aborted) return
            await runtime.progress(update)
            const token = context.mcpReq._meta?.progressToken
            if (typeof token === "string" || typeof token === "number")
              await context.mcpReq.notify({
                method: "notifications/progress",
                params: {
                  progressToken: token,
                  progress: ++sequence,
                  _meta: { [VIDEO_PROGRESS_KEY]: update },
                  message: update.phase,
                },
              })
          },
        },
      )
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(mediaFailure(error)) }] }
    }
  })
  return server
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  await createVideoServer(videoInvocation(process.argv.slice(2), fileURLToPath(new URL(".", import.meta.url)))).connect(
    new StdioServerTransport(),
  )
