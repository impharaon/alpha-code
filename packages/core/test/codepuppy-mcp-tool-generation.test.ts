// #1563 AC6 on OpenCode 2 (#1662 L4 Unit E): a call the model planned against an MCP tool's definition runs only if the
// server still lists that definition. After a server generation (restart, reconnect) changed the tool under the same
// name, the call fails by name and nothing reaches the server; an unchanged definition runs on the new connection.
// The re-taken file is packages/core/src/tool/mcp.ts; the registry and McpTool layer are production, the MCP runtime is
// a stand-in catalog whose listing the test replaces, as a new server generation would.
//
// Red if the comparison is removed: the old registration's call would reach the server with arguments shaped for the
// definition it no longer lists.
import { describe, expect } from "bun:test"
import os from "node:os"
import fs from "node:fs"
import { Effect, Layer, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Image } from "@opencode/core/image"
import { Mcp } from "@opencode/core/mcp/index"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import { Global } from "@opencode/util/global"
import { emptyMcp } from "./fixture/mcp"
import { tempGlobalLayer } from "./fixture/global"
import { imagePassthrough } from "./lib/image"
import { testEffect } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"

const lookup = (properties: Record<string, unknown>) =>
  ({ server: Mcp.ServerName.make("gen"), name: "lookup", description: "Look a record up", codemode: false, inputSchema: { type: "object", properties } }) satisfies Mcp.Tool

// What the current server generation lists, and every call that reached it.
const state = { listing: [lookup({ id: { type: "string" } })] as Mcp.Tool[], calls: [] as unknown[] }
const mcp = Layer.succeed(
  Mcp.Service,
  Mcp.Service.of({
    ...emptyMcp,
    tools: () => Effect.sync(() => state.listing),
    callTool: (input) =>
      Effect.sync(() => {
        state.calls.push(input.args)
        return { isError: false, content: [{ type: "text", text: "ran" }] } satisfies Mcp.ToolResult
      }),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, McpTool.node, Global.node]), [
    Mcp.node.replace(mcp),
    Permission.node.replace(Layer.mock(Permission.Service, { assert: () => Effect.void })),
    // The bus never delivers, so the registry keeps the registration the call was planned against.
    Bus.node.replace(Layer.mock(Bus.Service, { subscribe: () => Stream.never })),
    Image.node.replace(imagePassthrough),
    // Every Global root (data, log, repos, cache, ...) in a temp folder, not only data (review R1 #10).
    Global.node.replace(tempGlobalLayer),
  ]),
)

const call = (registry: Tool.Interface) =>
  executeTool(registry, {
    sessionID: Session.ID.make("ses_codepuppy_generation"),
    ...toolIdentity,
    call: { type: "tool-call", id: `call_${crypto.randomUUID()}`, name: "gen_lookup", input: { id: "r1" } },
  })

describe("#1563 AC6: a call planned against a definition the server no longer lists", () => {
  it.live("the next server generation changed the tool's schema: the call fails by name and never reaches the server", () =>
    Effect.gen(function* () {
      state.listing = [lookup({ id: { type: "string" } })]
      state.calls = []
      const registry = yield* Tool.Service
      yield* (yield* McpTool.Service).flush
      state.listing = [lookup({ key: { type: "number" } })]
      const result = yield* call(registry)
      expect(result.status).toBe("error")
      expect(result.error?.message).toContain('MCP tool "lookup" on server "gen" changed after this request was prepared')
      expect(state.calls).toEqual([])
    }),
  )

  it.live("the next server generation lists the same definition: the call runs on it", () =>
    Effect.gen(function* () {
      state.listing = [lookup({ id: { type: "string" } })]
      state.calls = []
      const registry = yield* Tool.Service
      yield* (yield* McpTool.Service).flush
      state.listing = [lookup({ id: { type: "string" } })]
      expect(yield* call(registry)).toMatchObject({ status: "completed" })
      expect(state.calls).toEqual([{ id: "r1" }])
    }),
  )
})

// Review R1 #10: no root of the engine's Global (data, log, repos, cache, config, state) is the real user directory.
describe("test isolation", () => {
  it.live("every Global root is under the temp folder", () =>
    Effect.gen(function* () {
      const global = yield* Global.Service
      const temp = [os.tmpdir(), fs.realpathSync(os.tmpdir())]
      for (const dir of [global.data, global.log, global.repos, global.cache, global.config, global.state])
        expect(temp.some((root) => dir.startsWith(root))).toBe(true)
    }),
  )
})
