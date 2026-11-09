// #1662 L4, ruling item 5: Code Puppy's MCP runtime rules on OpenCode 2, measured on the production `Mcp.Service`
// with real stdio servers (fixture/codepuppy-mcp-startup-stdio.ts) and real HTTP endpoints. The re-taken files are
// packages/core/src/mcp/{client,connection,index}.ts; the rules live in codepuppy-startup.ts and
// codepuppy-first-party-mcp.ts. What turns each case red is written above it.
//
//   AC1  a server that never answers does not hold back another (native on OpenCode 2; pinned here)
//   AC2  a start that fails names its cause (workspace_missing / dependency_missing / the network layer)
//   AC3  a failed remote server reconnects in the background: 30 s, then 60 s; an auth answer does not reconnect
//   AC5  at most four servers start at once
//   #1565 a bundled first-party server is offered from its declaration while it starts; a connection that lists
//        something else fails the call planned against the declaration and drops it; a third party gets none
//   ADR-041 two MCP tools that would share an effective name are both refused; a near miss keeps both
//
// HOME, XDG_* and the database are isolated before any engine module loads.
import { describe, expect } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-mcp-runtime-"))
for (const [key, dir] of Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data", XDG_CACHE_HOME: "cache", XDG_STATE_HOME: "state" })) {
  fs.mkdirSync(path.join(ROOT, dir), { recursive: true })
  process.env[key] = path.join(ROOT, dir)
}
process.env.OPENCODE_DB = ":memory:"

const { Effect, Exit, Fiber, Layer, Stream } = await import("effect")
const { TestClock } = await import("effect/testing")
const { Document, Info } = await import("@opencode/schema/config")
const { ConfigMCP } = await import("@opencode/schema/config/mcp")
const { Config } = await import("@opencode/core/config")
const { ConfigMcpPlugin } = await import("@opencode/core/config/plugin/mcp")
const { Bus } = await import("@opencode/core/bus")
const { Credential } = await import("@opencode/core/credential")
const { Form } = await import("@opencode/core/form")
const { Integration } = await import("@opencode/core/integration")
const { Location } = await import("@opencode/core/location")
const { Mcp } = await import("@opencode/core/mcp/index")
const { McpClient } = await import("@opencode/core/mcp/client")
const { McpPool } = await import("@opencode/core/mcp/pool")
const { OFFICE_MCP_MANIFEST_ENV } = await import("@opencode/core/mcp/codepuppy-first-party-mcp")
const { AbsolutePath } = await import("@opencode/core/schema")
const { State } = await import("@opencode/core/state")
const { CrossSpawnSpawner } = await import("@opencode/util/cross-spawn-spawner")
const { LayerNode } = await import("@opencode/util/effect/layer-node")
const { hostEnvironmentLayer } = await import("./fixture/environment")
const { location } = await import("./fixture/location")
const { registerIntegrationPolicy } = await import("./fixture/policy")
const { testEffect } = await import("./lib/effect")

const FIXTURE = path.join(import.meta.dir, "fixture/codepuppy-mcp-startup-stdio.ts")
const file = (name: string) => path.join(ROOT, `${name}-${crypto.randomUUID()}`)
const local = (environment: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
  new ConfigMCP.Local({ type: "local", command: [process.execPath, FIXTURE], environment, ...extra } as never)
const toolsFile = (tools: unknown[]) => {
  const target = file("tools.json")
  fs.writeFileSync(target, JSON.stringify(tools))
  return target
}
const unused = () => Effect.die("unused integration service")

/** The production MCP service over the given configured servers (the upstream mcp.test.ts wiring). */
const mcpLayer = (servers: Record<string, unknown>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const mcp = yield* Mcp.Service
      yield* State.batch(
        Effect.gen(function* () {
          yield* ConfigMcpPlugin.register(bus.subscribe())
          yield* registerIntegrationPolicy({ mcp, events: bus.subscribe() })
        }),
      )
    }),
  ).pipe(
    Layer.provideMerge(Mcp.layer()),
    Layer.provideMerge(Form.layer),
    Layer.provide(
      Layer.mergeAll(
        McpPool.layer.pipe(Layer.provide(LayerNode.compile(CrossSpawnSpawner.node))),
        Config.testLayer([
          new Document({ type: "document", info: new Info({ policies: [], mcp: new ConfigMCP.Info({ servers: servers as never }) }) }),
        ]),
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

const statusOf = (name: string) =>
  Effect.gen(function* () {
    return (yield* (yield* Mcp.Service).servers()).find((server: any) => server.name === name)?.status
  })
const until = <A>(probe: Effect.Effect<A | undefined>, label: string, ms = 10_000) =>
  Effect.gen(function* () {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const value = yield* probe
      if (value !== undefined) return value
      yield* Effect.promise(() => Bun.sleep(20))
    }
    return yield* Effect.die(new Error(`timed out: ${label}`))
  })
const connected = (name: string) => until(statusOf(name).pipe(Effect.map((s: any) => (s?.status === "connected" ? s : undefined))), `${name} connected`)
const toolNames = Effect.gen(function* () {
  return (yield* (yield* Mcp.Service).tools()).map((tool: any) => `${tool.server}/${tool.name}`)
})

// ── AC1 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// Red if startup waited for every server: `ok` would stay pending behind the 30 s handshake timeout of `hang`.
describe("AC1: one server never answering does not hold back another", () => {
  testEffect(mcpLayer({ hang: local({ CODEPUPPY_MCP_HANG: "1" }), ok: local() })).live("ok is connected and listed while hang is still pending", () =>
    Effect.gen(function* () {
      const started = Date.now()
      yield* connected("ok")
      expect(Date.now() - started).toBeLessThan(5_000)
      expect((yield* statusOf("hang"))?.status).toBe("pending")
      expect(yield* toolNames).toEqual(["ok/echo"])
    }),
  )
})

// ── AC2 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// Red if the client stopped naming the cause (the message alone is upstream wording a consumer would have to parse).
describe("AC2: a start that fails names its cause", () => {
  const cause = (config: unknown) =>
    McpClient.connect({ server: "p", config: config as never, directory: ROOT } as never).pipe(
      Effect.provide(hostEnvironmentLayer),
      Effect.scoped,
      Effect.flip,
      Effect.map((error: any) => ({ code: error.code, reconnect: error.reconnect })),
    )
  testEffect(Layer.empty).live("a missing working directory, a missing command, a refused remote", () =>
    Effect.gen(function* () {
      expect(yield* cause({ type: "local", command: [process.execPath, FIXTURE], cwd: path.join(ROOT, "no-such-dir") })).toEqual({ code: "workspace_missing", reconnect: false })
      expect(yield* cause({ type: "local", command: [path.join(ROOT, "no-such-command")] })).toEqual({ code: "dependency_missing", reconnect: false })
      expect(yield* cause({ type: "remote", url: "http://127.0.0.1:1/mcp", oauth: false })).toEqual({ code: "tcp", reconnect: true })
    }),
  )
})

// ── AC3 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// Red if the background reconnect is removed (no second request), fires early (a request before 30 s), does not
// double (a request before 60 s more), or also retries an auth answer.
describe("AC3: background reconnect", () => {
  const endpoint = (status: number) => {
    const hits = { count: 0 }
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => (hits.count++, new Response("no", { status })) })
    return { url: `http://127.0.0.1:${server.port}/mcp`, hits, stop: () => server.stop(true) }
  }
  // 501 is an HTTP 5xx Code Puppy reconnects on, and one upstream does not retry inside the attempt (client.ts isTransient).
  const failing = endpoint(501)
  const denied = endpoint(401)
  const settle = (fn: () => boolean, label: string) => until(Effect.sync(() => (fn() ? true : undefined)), label)
  const quiet = Effect.promise(() => Bun.sleep(300))
  const failedOn = (name: string) =>
    until(statusOf(name).pipe(Effect.map((s: any) => (s?.status === "failed" ? s : undefined))), `${name} failed`)

  testEffect(mcpLayer({ down: new ConfigMCP.Remote({ type: "remote", url: failing.url, oauth: false }) })).effect("a 5xx answer (501) reconnects after 30 s, then after 60 s more", () =>
    Effect.gen(function* () {
      yield* settle(() => failing.hits.count > 0, "first attempt")
      yield* failedOn("down")
      const first = failing.hits.count
      yield* TestClock.adjust("29 seconds")
      yield* quiet
      expect(failing.hits.count).toBe(first)
      yield* TestClock.adjust("1 second")
      yield* settle(() => failing.hits.count > first, "reconnect after 30 s")
      yield* failedOn("down")
      const second = failing.hits.count
      yield* TestClock.adjust("59 seconds")
      yield* quiet
      expect(failing.hits.count).toBe(second)
      yield* TestClock.adjust("1 second")
      yield* settle(() => failing.hits.count > second, "reconnect after 60 s more")
    }).pipe(Effect.ensuring(Effect.sync(failing.stop))),
  )

  testEffect(mcpLayer({ denied: new ConfigMCP.Remote({ type: "remote", url: denied.url, oauth: false }) })).effect("an auth answer stays failed", () =>
    Effect.gen(function* () {
      yield* settle(() => denied.hits.count > 0, "first attempt")
      yield* until(statusOf("denied").pipe(Effect.map((s: any) => (s?.status !== "pending" ? s : undefined))), "settled")
      const first = denied.hits.count
      yield* TestClock.adjust("15 minutes")
      yield* quiet
      expect(denied.hits.count).toBe(first)
    }).pipe(Effect.ensuring(Effect.sync(denied.stop))),
  )
})

// ── AC5 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// Red if the shared start permit is removed: six slow handshakes overlap six deep.
describe("AC5: at most four servers start at once", () => {
  const log = file("startup.log")
  const slow = () => local({ CODEPUPPY_MCP_INIT_DELAY_MS: "400", CODEPUPPY_MCP_STARTUP_LOG: log })
  testEffect(mcpLayer({ s1: slow(), s2: slow(), s3: slow(), s4: slow(), s5: slow(), s6: slow() })).live("six slow servers never overlap more than four deep", () =>
    Effect.gen(function* () {
      for (const name of ["s1", "s2", "s3", "s4", "s5", "s6"]) yield* connected(name)
      let depth = 0
      let peak = 0
      for (const mark of fs.readFileSync(log, "utf8")) {
        depth += mark === "+" ? 1 : -1
        peak = Math.max(peak, depth)
      }
      expect(peak).toBeLessThanOrEqual(4)
      expect(peak).toBeGreaterThan(1)
    }),
  )
})

// ── #1565 ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Red if declarations are not offered while starting, survive a contradicting connection, or reach a third party.
describe("#1565: bundled declarations while a first-party server starts", () => {
  const declaredTool = { name: "read_docx", description: "Read a Word document", inputSchema: { type: "object", properties: { path: { type: "string" } } } }
  const resources = path.join(ROOT, "Resources")
  fs.mkdirSync(path.join(resources, "office-mcp"), { recursive: true })
  fs.writeFileSync(path.join(resources, "office-mcp", "server.py"), "# bundled server\n")
  const manifest = path.join(resources, "office-mcp", "tools.json")
  fs.writeFileSync(
    manifest,
    JSON.stringify({
      serverSha256: createHash("sha256").update("# bundled server\n").digest("hex"),
      // Only entries with the bundled command (here: an extra `--office` token) are first-party.
      formats: { docx: { command: [process.execPath, FIXTURE, "--office"], tools: [declaredTool] } },
    }),
  )
  process.env[OFFICE_MCP_MANIFEST_ENV] = manifest
  const office = (tools: unknown[]) =>
    new ConfigMCP.Local({
      type: "local",
      command: [process.execPath, FIXTURE, "--office"],
      environment: { CODEPUPPY_MCP_INIT_DELAY_MS: "1500", CODEPUPPY_MCP_TOOLS_FILE: toolsFile(tools) },
    } as never)
  const thirdParty = local({ CODEPUPPY_MCP_INIT_DELAY_MS: "1500", CODEPUPPY_MCP_TOOLS_FILE: toolsFile([declaredTool]) }, { cwd: ROOT })

  testEffect(mcpLayer({ office: office([declaredTool]), other: thirdParty })).live("offered while starting; the third party is not; the listing replaces it once connected", () =>
    Effect.gen(function* () {
      expect((yield* statusOf("office"))?.status).toBe("pending")
      expect(yield* toolNames).toEqual(["office/read_docx"])
      yield* connected("office")
      yield* connected("other")
      expect(yield* toolNames).toEqual(["office/read_docx", "other/read_docx"])
    }),
  )

  testEffect(mcpLayer({ office: office([{ ...declaredTool, description: "something else" }]) })).live("a contradicting connection fails the planned call and drops the declaration", () =>
    Effect.gen(function* () {
      const mcp = yield* Mcp.Service
      expect(yield* toolNames).toEqual(["office/read_docx"])
      const call = yield* mcp.callTool({ server: "office", name: "read_docx", args: {} }).pipe(Effect.exit, Effect.forkChild)
      const exit: any = yield* Fiber.join(call)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(String(exit.cause)).toContain("bundled declaration")
      const listed = yield* mcp.tools()
      expect(listed.map((tool: any) => tool.description)).toEqual(["something else"])
    }),
  )
})

// ── ADR-041 ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Red if collisions go back to last-wins (one of the pair would be listed) or if a near miss is refused too.
describe("ADR-041: MCP tool name collisions are refused", () => {
  const x = { name: "x", inputSchema: { type: "object" } }
  testEffect(mcpLayer({ "a.b": local({ CODEPUPPY_MCP_TOOLS_FILE: toolsFile([x]) }), a_b: local({ CODEPUPPY_MCP_TOOLS_FILE: toolsFile([x]) }), ab: local({ CODEPUPPY_MCP_TOOLS_FILE: toolsFile([x]) }) })).live(
    "a.b/x and a_b/x share an effective name and are both refused; ab/x stays",
    () =>
      Effect.gen(function* () {
        for (const name of ["a.b", "a_b", "ab"]) yield* connected(name)
        expect(yield* toolNames).toEqual(["ab/x"])
      }),
  )
})
