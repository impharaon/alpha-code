// Fixture copied from upstream test/mcp/catalog.test.ts: real paginated MCP envelopes and SDK validation.
import { expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js"
import { Effect, Result } from "effect"
import { CodePuppyToolDiscovery } from "@/mcp/codepuppy-tool-discovery"

test("#1645 tool discovery preserves output schema validation across pages", async () => {
  const server = new Server({ name: "pagination", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, ({ params }) =>
    Promise.resolve(
      params?.cursor === "page-2"
        ? {
            tools: [
              {
                name: "second",
                inputSchema: { type: "object" },
                outputSchema: {
                  type: "object",
                  properties: { value: { type: "number" } },
                  required: ["value"],
                },
              },
            ],
          }
        : {
            tools: [
              {
                name: "first",
                inputSchema: { type: "object" },
                outputSchema: {
                  type: "object",
                  properties: { value: { type: "string" } },
                  required: ["value"],
                },
              },
            ],
            nextCursor: "page-2",
          },
    ),
  )
  server.setRequestHandler(CallToolRequestSchema, ({ params }) =>
    Promise.resolve({
      content: [],
      structuredContent: { value: params.name === "first" ? 42 : 1 },
    }),
  )

  const client = new Client({ name: "pagination-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

  try {
    const tools = await Effect.runPromise(CodePuppyToolDiscovery.listTools(client, 30_000))
    expect(Result.getOrThrow(tools).map((tool) => tool.name)).toEqual(["first", "second"])
    await expect(client.callTool({ name: "first", arguments: {} })).rejects.toThrow(
      "Structured content does not match the tool's output schema",
    )
  } finally {
    await Promise.all([client.close(), server.close()])
  }
})


test("#1645 tool discovery returns SDK protocol errors as typed failures", async () => {
  const server = new Server({ name: "discovery-error", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => { throw new McpError(ErrorCode.InvalidParams, "fixture rejection") })
  const client = new Client({ name: "discovery-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  try {
    const result = await Effect.runPromise(CodePuppyToolDiscovery.listTools(client, 30_000))
    expect(Result.isFailure(result)).toBe(true)
    if (!Result.isFailure(result)) throw new Error("expected typed discovery failure")
    expect(result.failure).toBeInstanceOf(McpError)
    expect(result.failure).toMatchObject({ code: ErrorCode.InvalidParams })
  } finally {
    await Promise.all([client.close(), server.close()])
  }
})

test("#1645 tool discovery forwards the request timeout and preserves its typed cause", async () => {
  const server = new Server({ name: "discovery-timeout", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, () => new Promise(() => {}))
  const client = new Client({ name: "discovery-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  try {
    const result = await Effect.runPromise(CodePuppyToolDiscovery.listTools(client, 7))
    expect(Result.isFailure(result)).toBe(true)
    if (!Result.isFailure(result)) throw new Error("expected typed timeout failure")
    expect(result.failure).toBeInstanceOf(McpError)
    expect(result.failure).toMatchObject({ code: ErrorCode.RequestTimeout, data: { timeout: 7 } })
  } finally {
    await Promise.all([client.close(), server.close()])
  }
})
