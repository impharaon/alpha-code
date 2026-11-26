import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"
import { pathToFileURL } from "node:url"
import { videoToolDefinitions } from "./contracts"

export function createVideoServer() {
  const server = new Server({ name: "codepuppy-video", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler("tools/list", async () => ({ tools: videoToolDefinitions() }) as never)
  server.setRequestHandler("tools/call", async () => ({ isError: true, content: [{ type: "text" as const, text: JSON.stringify({ code: "processing_failed", message: "Video processing components are not ready.", action: "Retry after component preparation completes.", retryable: true }) }] }))
  return server
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  await createVideoServer().connect(new StdioServerTransport())
