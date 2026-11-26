import { mkdir } from "node:fs/promises"
import path from "node:path"

export async function buildVideoMcp(outdir = path.join(import.meta.dir, "../dist-video")) {
  await mkdir(outdir, { recursive: true })
  const result = await Bun.build({ entrypoints: [path.join(import.meta.dir, "../resources/video-mcp/server.ts")], outdir, naming: "server.js", target: "node", format: "esm" })
  if (!result.success) throw new AggregateError(result.logs, "Video MCP build failed")
  return path.join(outdir, "server.js")
}

if (import.meta.main) await buildVideoMcp()
