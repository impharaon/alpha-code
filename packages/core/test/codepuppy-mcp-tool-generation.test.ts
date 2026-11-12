// #1563 AC6 on OpenCode 2 (#1662 L4 Units E and R1): a call the model planned against an MCP tool's definition is sent
// only if the server still lists that definition at the moment of sending. After a server generation (reconnect,
// restart) changed the tool under the same name — even while the call waited for approval — the call fails by name and
// nothing reaches the server; an unchanged definition runs on the new connection.
//
// Production all the way down: the tool registry and McpTool (packages/core/src/tool/mcp.ts passes the definition it
// registered), the MCP service (packages/core/src/mcp/index.ts checks it at each send) and a real stdio server
// (fixture/codepuppy-mcp-startup-stdio.ts) whose listing the test rewrites before reconnecting it. Only the approval
// is a gate the test opens, so the server generation can change while the call waits.
//
// Red if the check runs before the approval wait (review R1 #3: the old arguments were sent) or is removed.
// HOME, XDG_* and the database are isolated before any engine module loads.
import { describe, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-mcp-generation-"))
for (const [key, dir] of Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data", XDG_CACHE_HOME: "cache", XDG_STATE_HOME: "state" })) {
  fs.mkdirSync(path.join(ROOT, dir), { recursive: true })
  process.env[key] = path.join(ROOT, dir)
}
process.env.OPENCODE_DB = ":memory:"

const { Deferred, Effect, Fiber, Layer, Stream } = await import("effect")
const { Document, Info } = await import("@opencode/schema/config")
const { ConfigMCP } = await import("@opencode/schema/config/mcp")
const { Config } = await import("@opencode/core/config")
const { ConfigMcpPlugin } = await import("@opencode/core/config/plugin/mcp")
const { AppNodeBuilder } = await import("@opencode/core/effect/app-node-builder")
const { LayerNode } = await import("@opencode/util/effect/layer-node")
const { Bus } = await import("@opencode/core/bus")
const { Credential } = await import("@opencode/core/credential")
const { Form } = await import("@opencode/core/form")
const { Image } = await import("@opencode/core/image")
const { Integration } = await import("@opencode/core/integration")
const { Location } = await import("@opencode/core/location")
const { Mcp } = await import("@opencode/core/mcp/index")
const { McpPool } = await import("@opencode/core/mcp/pool")
const { Permission } = await import("@opencode/core/permission")
const { AbsolutePath } = await import("@opencode/core/schema")
const { Session } = await import("@opencode/core/session")
const { State } = await import("@opencode/core/state")
const { Tool } = await import("@opencode/core/tool")
const { McpTool } = await import("@opencode/core/tool/mcp")
const { CrossSpawnSpawner } = await import("@opencode/util/cross-spawn-spawner")
const { Global } = await import("@opencode/util/global")
const { hostEnvironmentLayer } = await import("./fixture/environment")
const { tempGlobalLayer } = await import("./fixture/global")
const { location } = await import("./fixture/location")
const { registerIntegrationPolicy } = await import("./fixture/policy")
const { imagePassthrough } = await import("./lib/image")
const { testEffect } = await import("./lib/effect")
const { executeTool, toolIdentity } = await import("./lib/tool")

const FIXTURE = path.join(import.meta.dir, "fixture/codepuppy-mcp-startup-stdio.ts")
const unused = () => Effect.die("unused integration service")
const lookup = (properties: Record<string, unknown>) => [{ name: "lookup", description: "Look a record up", inputSchema: { type: "object", properties } }]
const OLD = lookup({ id: { type: "string" } })

/** One case's world: a stdio server listing `tools.json`, logging each tools/call, and an approval the test opens. */
const world = () => {
  const toolsFile = path.join(ROOT, `tools-${crypto.randomUUID()}.json`)
  const callLog = path.join(ROOT, `calls-${crypto.randomUUID()}.log`)
  fs.writeFileSync(toolsFile, JSON.stringify(OLD))
  const approve = Deferred.makeUnsafe<void>()
  const servers = {
    gen: new ConfigMCP.Local({
      type: "local",
      command: [process.execPath, FIXTURE],
      environment: { CODEPUPPY_MCP_TOOLS_FILE: toolsFile, CODEPUPPY_MCP_CALL_LOG: callLog },
      codemode: false,
    } as never),
  }
  // The production MCP service over the configured server (codepuppy-mcp-runtime.test.ts wiring).
  const mcp = Layer.effectDiscard(
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const service = yield* Mcp.Service
      yield* State.batch(
        Effect.gen(function* () {
          yield* ConfigMcpPlugin.register(bus.subscribe())
          yield* registerIntegrationPolicy({ mcp: service, events: bus.subscribe() })
        }),
      )
    }),
  ).pipe(
    Layer.provideMerge(Mcp.layer()),
    Layer.provideMerge(Form.layer),
    Layer.provide(
      Layer.mergeAll(
        McpPool.layer.pipe(Layer.provide(LayerNode.compile(CrossSpawnSpawner.node))),
        Config.testLayer([new Document({ type: "document", info: new Info({ policies: [], mcp: new ConfigMCP.Info({ servers: servers as never }) }) })]),
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(ROOT) } as never))),
        Layer.mock(Bus.Service, { subscribe: () => Stream.never, publish: (definition: any, data: any) => Effect.succeed({ id: "evt", type: definition.type, data } as never) }),
        Layer.mock(Integration.Service, {
          revision: () => 0,
          transform: () => Effect.succeed({ dispose: Effect.void }),
          connection: { active: unused, resolve: unused, key: unused, external: unused, activate: unused, update: unused, remove: unused, status: unused },
          oauth: { connect: unused, status: unused, complete: unused, cancel: unused },
          command: { connect: unused, status: unused, cancel: unused },
        } as never),
        Layer.mock(Credential.Service, { list: () => Effect.succeed([]) } as never),
        hostEnvironmentLayer,
      ),
    ),
  )
  const layer = AppNodeBuilder.build(LayerNode.group([Tool.node, McpTool.node, Mcp.node, Global.node]), [
    Mcp.node.replace(mcp as never),
    Permission.node.replace(Layer.mock(Permission.Service, { assert: () => Deferred.await(approve) })),
    // The bus never delivers, so the registry keeps the registration the call was planned against.
    Bus.node.replace(Layer.mock(Bus.Service, { subscribe: () => Stream.never })),
    Image.node.replace(imagePassthrough),
    Global.node.replace(tempGlobalLayer),
  ])
  const calls = () => (fs.existsSync(callLog) ? fs.readFileSync(callLog, "utf8").split("\n").filter(Boolean) : [])
  return { toolsFile, approve, layer, calls }
}

const statusOf = (name: string) =>
  Effect.gen(function* () {
    return (yield* (yield* Mcp.Service).servers()).find((server: any) => server.name === name)?.status as any
  })
const connected = (name: string) =>
  Effect.gen(function* () {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if ((yield* statusOf(name))?.status === "connected") return
      yield* Effect.promise(() => Bun.sleep(20))
    }
    return yield* Effect.die(new Error(`timed out: ${name} connected`))
  })

/** Starts the call, changes the server generation while it waits for approval, then approves it. */
const callAcrossGeneration = (w: ReturnType<typeof world>, next: unknown[]) =>
  Effect.gen(function* () {
    const registry = yield* Tool.Service
    const mcp = yield* Mcp.Service
    yield* connected("gen")
    yield* (yield* McpTool.Service).flush
    const call = yield* Effect.forkChild(
      executeTool(registry, {
        sessionID: Session.ID.make("ses_codepuppy_generation"),
        ...toolIdentity,
        call: { type: "tool-call", id: `call_${crypto.randomUUID()}`, name: "gen_lookup", input: { id: "r1" } },
      }),
    )
    yield* Effect.promise(() => Bun.sleep(100))
    fs.writeFileSync(w.toolsFile, JSON.stringify(next))
    yield* mcp.disconnect("gen")
    yield* mcp.connect("gen")
    yield* connected("gen")
    yield* Deferred.succeed(w.approve, undefined)
    return yield* Fiber.join(call)
  })

describe("#1563 AC6: a call planned against a definition the server no longer lists", () => {
  const changed = world()
  testEffect(changed.layer).live("the next server generation changed the tool's schema: the call fails by name and never reaches the server", () =>
    Effect.gen(function* () {
      const result = yield* callAcrossGeneration(changed, lookup({ key: { type: "number" } }))
      expect(result.status).toBe("error")
      expect(result.error?.message).toContain('MCP tool "lookup" on server "gen" changed after this request was prepared')
      expect(changed.calls()).toEqual([])
    }),
  )

  const same = world()
  testEffect(same.layer).live("the next server generation lists the same definition: the call runs on it", () =>
    Effect.gen(function* () {
      expect(yield* callAcrossGeneration(same, OLD)).toMatchObject({ status: "completed" })
      expect(same.calls()).toEqual(["lookup"])
    }),
  )
})

// Review R1 #10: no root of the engine's Global (data, log, repos, cache, config, state) is the real user directory.
describe("test isolation", () => {
  testEffect(world().layer).live("every Global root is under the temp folder", () =>
    Effect.gen(function* () {
      const global = yield* Global.Service
      const temp = [os.tmpdir(), fs.realpathSync(os.tmpdir())]
      for (const dir of [global.data, global.log, global.repos, global.cache, global.config, global.state])
        expect(temp.some((root) => dir.startsWith(root))).toBe(true)
    }),
  )
})
