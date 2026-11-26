import { expect, test } from "bun:test"
import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
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

test("bundled video discovers its actual definitions without preparing models and never reports an unimplemented call as success", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createVideoServer()
  const client = new Client({ name: "video-test", version: "1" })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    expect((await client.listTools()).tools).toEqual(videoToolDefinitions())
    expect((await client.callTool({ name: "info", arguments: { source: { kind: "path", path: "/missing.mp4" } } })).isError).toBe(true)
  } finally {
    await client.close()
    await server.close()
  }
})
