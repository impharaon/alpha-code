import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"
import { pathToFileURL } from "node:url"
import { videoToolDefinitions } from "./contracts"
import { callVideoTool } from "./tools"
import type { VideoRuntime } from "./runtime"

export function createVideoServer(runtime?: VideoRuntime) {
  const server = new Server({ name: "codepuppy-video", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler("tools/list", async () => ({ tools: videoToolDefinitions() }) as never)
  server.setRequestHandler("tools/call", async (request, context) =>
    callVideoTool(
      request.params.name,
      request.params.arguments,
      runtime && {
        ...runtime,
        signal: AbortSignal.any([runtime.signal, context.mcpReq.signal]),
        progress: async (update) => {
          await runtime.progress(update)
          const token = context.mcpReq._meta?.progressToken
          if (typeof token === "string" || typeof token === "number")
            await context.mcpReq.notify({
              method: "notifications/progress",
              params: {
                progressToken: token,
                progress: update.completed,
                ...(update.total === undefined ? {} : { total: update.total }),
                message: update.phase,
              },
            })
        },
      },
    ),
  )
  return server
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  await createVideoServer().connect(new StdioServerTransport())
