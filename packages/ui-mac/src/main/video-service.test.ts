import { expect, test } from "bun:test"
import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { buildVideoMcp } from "../../scripts/build-video-mcp"
import { createVideoServer } from "../../resources/video-mcp/server"
import { videoToolDefinitions } from "../../resources/video-mcp/contracts"
import { videoServerDefinition } from "./codepuppy-video"
import { VIDEO_SERVICE_COMMAND } from "../shared/video-service"

test("video declaration delegates the Node slot to the host expander without deriving an interpreter", () => {
  const seen: string[][] = []
  const definition = videoServerDefinition((template) => {
    seen.push([...template])
    return ["/host-verified/node", "/bundle/video-mcp/server.js", "{workspace}"]
  })
  expect(seen).toEqual([VIDEO_SERVICE_COMMAND])
  expect(definition.command[0]).toBe("/host-verified/node")
  expect(definition.environment).toEqual({})
})

test("built service exchanges actual stdio discovery and a typed cold call without native modules", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "video-service-"))
  const entry = await buildVideoMcp(directory)
  // This process verifies wire/build behavior. Launcher Node identity remains
  // the #1760 integration assertion, not a claim made by this Bun test process.
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: "pipe" })
  const client = new Client({ name: "video-stdio", version: "1" })
  try {
    await client.connect(transport)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
      videoToolDefinitions().map((tool) => tool.name),
    )
    const result = await client.callTool({ name: "info", arguments: { source: { kind: "path", path: "missing.wav" } } })
    expect(result.isError).toBe(true)
    if (result.content[0]?.type === "text")
      expect(JSON.parse(result.content[0].text).code).toBe("component_download_failed")
  } finally {
    await client.close()
    await transport.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("bundled video discovers its actual definitions without preparing models and never reports an unimplemented call as success", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createVideoServer()
  const client = new Client({ name: "video-test", version: "1" })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    expect((await client.listTools()).tools).toEqual(videoToolDefinitions())
    expect(
      (await client.callTool({ name: "info", arguments: { source: { kind: "path", path: "/missing.mp4" } } })).isError,
    ).toBe(true)
  } finally {
    await client.close()
    await server.close()
  }
})
