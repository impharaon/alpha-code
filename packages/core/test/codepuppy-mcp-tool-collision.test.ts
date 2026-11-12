// ADR-041 decision 2 on OpenCode 2 (#1662 L4 Unit C; #1666 ruling 6756103246 item 4): an MCP tool whose effective name
// a builtin already holds is refused, never last-wins. The re-taken file is packages/core/src/tool/mcp.ts; the registry
// and the McpTool layer are production (`Tool.node` + `McpTool.node`), only the MCP runtime is a stand-in catalog.
//
// The reachable 2.x pairs (the ruling's `apply_patch` is v1's name; 2.x calls it `patch`): builtins registered under
// the `opencode` namespace (tool/plugin/{artifact,mcp-resource,opencode,schedule}.ts) against an MCP server named
// `opencode`, and `experimental_image_generate` against server `experimental`'s tool `image_generate`.
//
// Red if mcp.ts stops refusing: with the builtin registered first, the MCP tool's later `editor.add` overwrites it
// (tool.ts commit is last-wins) and the name holds the MCP tool.
import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Deferred, Effect, Layer, Schema, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Image } from "@opencode/core/image"
import { Mcp } from "@opencode/core/mcp/index"
import { Permission } from "@opencode/core/permission"
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import { Global } from "@opencode/util/global"
import { emptyMcp } from "./fixture/mcp"
import { imagePassthrough } from "./lib/image"
import { testEffect } from "./lib/effect"

const mcpTool = (server: string, name: string) =>
  ({ server: Mcp.ServerName.make(server), name, description: name, codemode: true, inputSchema: { type: "object", properties: {} } }) satisfies Mcp.Tool
const CATALOG = [mcpTool("opencode", "session_rename"), mcpTool("opencode", "session_renamed"), mcpTool("experimental", "image_generate")]

let gate = Deferred.makeUnsafe<void>()
// The catalog is held until the test opens the gate, so the test decides whether the builtins register first.
const mcp = Layer.succeed(
  Mcp.Service,
  Mcp.Service.of({
    ...emptyMcp,
    tools: () => Deferred.await(gate).pipe(Effect.as(CATALOG)),
  }),
)
const outputData = await fs.mkdtemp(path.join(os.tmpdir(), "codepuppy-mcp-collision-"))
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, McpTool.node]), [
    Mcp.node.replace(mcp),
    Permission.node.replace(Layer.mock(Permission.Service, { assert: () => Effect.void })),
    Bus.node.replace(Layer.mock(Bus.Service, { subscribe: () => Stream.never })),
    Image.node.replace(imagePassthrough),
    Global.node.replace(Global.layerWith({ data: outputData })),
  ]),
)

/** The two builtins as their plugins register them (opencode.ts: `opencode` namespace; image-generate.ts: none). */
const builtins = (registry: Tool.Interface) =>
  registry.transform((editor) => {
    for (const [name, namespace] of [["session_rename", "opencode"], ["experimental_image_generate", undefined]] as const)
      editor.add({
        name,
        options: { codemode: namespace !== undefined, ...(namespace ? { namespace } : {}) },
        description: "builtin",
        input: Schema.Struct({}),
        output: Schema.String,
        execute: () => Effect.succeed({ output: "builtin" }),
      })
  })

// What the registry holds under each effective name (Code Mode tools are not direct definitions; Code Mode runs the
// entry registered under the name). The builtins' description is "builtin", the MCP tools' is their own name.
const held = (registry: Tool.Interface) =>
  registry.list().pipe(Effect.map((tools) => Object.fromEntries(tools.map((tool) => [tool.id, tool.description]))))

const expectBuiltinsHold = (registry: Tool.Interface) =>
  Effect.gen(function* () {
    const names = yield* held(registry)
    expect(names["opencode_session_rename"]).toBe("builtin")
    expect(names["experimental_image_generate"]).toBe("builtin")
    expect(names["opencode_session_renamed"]).toBe("session_renamed")
  })

describe("ADR-041: an MCP tool never takes a builtin's effective name", () => {
  it.live("builtins registered first: the MCP tools with their names are refused; the near miss stays", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      yield* builtins(registry)
      yield* Deferred.succeed(gate, undefined)
      yield* (yield* McpTool.Service).flush
      yield* expectBuiltinsHold(registry)
      gate = Deferred.makeUnsafe<void>()
    }),
  )

  it.live("builtins registered after the MCP tools: the builtins still hold the names", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      yield* Deferred.succeed(gate, undefined)
      yield* (yield* McpTool.Service).flush
      yield* builtins(registry)
      yield* expectBuiltinsHold(registry)
      gate = Deferred.makeUnsafe<void>()
    }),
  )
})
