// #1662 L4, ruling item 5: Code Puppy's MCP runtime rules on OpenCode 2, measured on the production `Mcp.Service`
// with real stdio servers (fixture/codepuppy-mcp-startup-stdio.ts) and real HTTP endpoints. The re-taken files are
// packages/core/src/mcp/{client,connection,index}.ts; the rules live in codepuppy-startup.ts and
// codepuppy-first-party-mcp.ts. What turns each case red is written above it.
//
//   AC1  a server that never answers does not hold back another (native on OpenCode 2; pinned here)
//   AC2  a start that fails names its cause (workspace_missing / dependency_missing / the network layer), and the
//        failed status the desktop reads carries it (#1564; parseFailureCode in packages/schema/src/codepuppy-net-failure.ts)
//   AC3  a failed remote server reconnects in the background: 30 s, then 60 s; an auth answer does not reconnect
//   AC5  at most four servers start at once
//   #1565 a bundled first-party server is offered from its declaration while it starts; a connection that lists
//        something else fails the call planned against the declaration and drops it; a third party gets none
//   ADR-041 two MCP tools that would share an effective name are both refused; a near miss keeps both
//   AC4  closing the service ends a server's process and its descendants (#1666 Unit D, v1 successor)
//   AC7  tools/list runs on the catalog budget, and a call's wait for its server's handshake is not cut by the
//        execution budget (#1666 Unit D, v1 successor)
//   #1645 a tools/list failure that another attempt may fix reconnects after 30 s and lists in the same service; an
//        auth answer to tools/list is named auth and not retried (#1666 Units D/E)
//   #1653 a server waiting out its backoff holds back no other server, and calling it does not reconnect early
//   #1645 a refusing server's body and a crashing server's stderr reach no log line and no failed status
//        (#1666 Unit F; v1 kept the typed code only)
//   #1565 with the shipped manifest: the command main writes ({workspace} marker) and the one the engine sees after the
//        extension substitutes the folder both get the declaration; the real python server lists exactly it (#1666 Unit E)
//
// HOME, XDG_*, TMPDIR and the database are isolated by the shared test preload (bunfig.toml, I-08) before any module loads.
import { afterAll, beforeAll, describe, expect } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-mcp-runtime-"))

const { Effect, Exit, Fiber, Layer, Logger, Stream } = await import("effect")
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
const { OFFICE_MCP_MANIFEST_ENV, declaredListedTools, listsDeclaration } = await import("@opencode/core/mcp/codepuppy-first-party-mcp")
const { parseFailureCode } = await import("@opencode/schema/codepuppy-net-failure")
const { Server: McpServer, WebStandardStreamableHTTPServerTransport } = await import("@modelcontextprotocol/server")
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
const until = <A, R>(probe: import("effect").Effect.Effect<A | undefined, never, R>, label: string, ms = 10_000) =>
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
// `hang` is killed once the assertions ran: closing the layer otherwise waits for its handshake timeout (the teardown
// time follows `timeout.startup`: 8 s ⇒ 10.3 s, the 30 s default ⇒ 32 s), which overran the 5 s test budget.
describe("AC1: one server never answering does not hold back another", () => {
  const pidFile = file("hang.pid")
  const killHang = Effect.sync(() => {
    if (fs.existsSync(pidFile)) process.kill(Number(fs.readFileSync(pidFile, "utf8")), "SIGKILL")
  })
  testEffect(mcpLayer({ hang: local({ CODEPUPPY_MCP_HANG: "1", CODEPUPPY_MCP_PID_FILE: pidFile }), ok: local() })).live("ok is connected and listed while hang is still pending", () =>
    Effect.gen(function* () {
      const started = Date.now()
      yield* connected("ok")
      expect(Date.now() - started).toBeLessThan(5_000)
      expect((yield* statusOf("hang"))?.status).toBe("pending")
      expect(yield* toolNames).toEqual(["ok/echo"])
    }).pipe(Effect.ensuring(killHang)),
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

  // Red if index.ts stops prefixing the failed status (parseFailureCode reads nothing back), or a cause goes unnamed.
  testEffect(
    mcpLayer({
      nodir: local({}, { cwd: path.join(ROOT, "no-such-dir") }),
      nocmd: new ConfigMCP.Local({ type: "local", command: [path.join(ROOT, "no-such-command")] }),
      refused: new ConfigMCP.Remote({ type: "remote", url: "http://127.0.0.1:1/mcp", oauth: false }),
    }),
  ).live("the failed status the desktop reads carries the named cause", () =>
    Effect.gen(function* () {
      const failed = (name: string) =>
        until(statusOf(name).pipe(Effect.map((s: any) => (s?.status === "failed" ? s : undefined))), `${name} failed`)
      for (const [name, code] of [["nodir", "workspace_missing"], ["nocmd", "dependency_missing"], ["refused", "tcp"]] as const) {
        const read = parseFailureCode((yield* failed(name)).error)
        expect(read?.code).toBe(code)
        expect(read?.text).not.toBe("")
      }
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

// Review R1 #6: a reconnect timer belongs to the failure that scheduled it. 501 schedules one; a manual reconnect then
// gets an auth answer (401, never retried); the old timer must not send a third request when its 30 s come.
describe("AC3: a reconnect timer from an earlier failure", () => {
  const answer = { status: 501, hits: 0 }
  const endpoint = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => (answer.hits++, new Response("no", { status: answer.status })) })
  testEffect(mcpLayer({ flip: new ConfigMCP.Remote({ type: "remote", url: `http://127.0.0.1:${endpoint.port}/mcp`, oauth: false }) })).effect(
    "does not fire after a manual reconnect ended in an auth answer",
    () =>
      Effect.gen(function* () {
        const failed = () => until(statusOf("flip").pipe(Effect.map((s: any) => (s?.status === "failed" ? s : undefined))), "flip failed")
        yield* until(Effect.sync(() => (answer.hits > 0 ? true : undefined)), "first attempt")
        yield* failed()
        answer.status = 401
        yield* (yield* Mcp.Service).connect("flip")
        const status: any = yield* failed()
        expect(parseFailureCode(status.error)?.code).toBe("auth")
        const hits = answer.hits
        yield* TestClock.adjust("31 seconds")
        yield* Effect.promise(() => Bun.sleep(300))
        expect(answer.hits).toBe(hits)
      }).pipe(Effect.ensuring(Effect.sync(() => endpoint.stop(true)))),
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

// ── AC4 (v1 successor) ───────────────────────────────────────────────────────────────────────────────────────────
// Red if closing the service leaves the server's process or its child running (the spawner kills the process group
// when the connection's scope closes, packages/core/src/mcp/stdio.ts). The premise arm: both are alive while connected.
describe("AC4: closing the service ends a server's process tree", () => {
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  testEffect(Layer.empty).live("the server and its child are alive while connected and gone after the service closes", () =>
    Effect.gen(function* () {
      const pidFile = file("tree.pid")
      const childFile = file("tree-child.pid")
      const pids = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* connected("tree")
          const pids = [Number(fs.readFileSync(pidFile, "utf8")), Number(fs.readFileSync(childFile, "utf8"))]
          expect(pids.map(alive)).toEqual([true, true])
          return pids
        }).pipe(Effect.provide(mcpLayer({ tree: local({ CODEPUPPY_MCP_PID_FILE: pidFile, CODEPUPPY_MCP_CHILD_PID_FILE: childFile }) }))),
      )
      yield* until(Effect.sync(() => (pids.some(alive) ? undefined : true)), "process tree reaped", 5_000)
    }),
  )
})

// ── AC7 (v1 successor) ───────────────────────────────────────────────────────────────────────────────────────────
// Red if tools/list ran on the execution budget (a 300 ms execution budget would fail an 800 ms listing), or if a call
// that waits for its server's handshake had that wait counted against its execution budget.
describe("AC7: each wait has its own budget", () => {
  const slowTool = { name: "slow", description: "slow", inputSchema: { type: "object", properties: { ms: { type: "number" } } } }
  testEffect(
    mcpLayer({ "slow-list": local({ CODEPUPPY_MCP_LIST_DELAY_MS: "800" }, { timeout: new ConfigMCP.Timeout({ execution: 300 }) }) }),
  ).live("an 800 ms tools/list connects under a 300 ms execution budget", () =>
    Effect.gen(function* () {
      yield* connected("slow-list")
      expect(yield* toolNames).toEqual(["slow-list/echo"])
    }),
  )

  testEffect(
    mcpLayer({
      "slow-start": local(
        { CODEPUPPY_MCP_INIT_DELAY_MS: "700", CODEPUPPY_MCP_TOOLS_FILE: toolsFile([slowTool]) },
        { timeout: new ConfigMCP.Timeout({ execution: 1_200 }) },
      ),
    }),
  ).live("a call that first waits for the handshake still gets its whole execution budget; past the budget it fails", () =>
    Effect.gen(function* () {
      const mcp = yield* Mcp.Service
      const started = Date.now()
      const result = yield* mcp.callTool({ server: "slow-start", name: "slow", args: { ms: 900 } })
      expect(result.content).toEqual([{ type: "text", text: "slow" }])
      expect(Date.now() - started).toBeGreaterThan(1_200)
      const exit = yield* mcp.callTool({ server: "slow-start", name: "slow", args: { ms: 1_600 } }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})

/** A real streamable-HTTP MCP server (one tool, `probe`) whose tools/list can be made to answer with an HTTP status. */
const httpServer = () => {
  const state = {
    lists: 0,
    listStatus: 0,
    listBody: "no",
    calls: 0,
    probe: { name: "probe", description: "probe", inputSchema: { type: "object" as const, properties: {} as Record<string, unknown> } },
  }
  const build = async () => {
    const server = new McpServer({ name: "codepuppy-remote", version: "1.0.0" }, { capabilities: { tools: {} } })
    server.setRequestHandler("tools/list", async () => ({ tools: [state.probe] }) as never)
    server.setRequestHandler("tools/call", async () => (state.calls++, { content: [{ type: "text" as const, text: "probed" }] }))
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), enableJsonResponse: true })
    await server.connect(transport)
    return transport
  }
  let current: Promise<InstanceType<typeof WebStandardStreamableHTTPServerTransport>> | undefined
  const http = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const body: any = request.method === "POST" ? await request.clone().json().catch(() => undefined) : undefined
      if (body?.method === "initialize") current = build()
      if (body?.method === "tools/list") {
        state.lists += 1
        if (state.listStatus) return new Response(state.listBody, { status: state.listStatus })
      }
      return (await (current ??= build())).handleRequest(request)
    },
  })
  return {
    state,
    url: `http://127.0.0.1:${http.port}/mcp`,
    stop: () => http.stop(true),
    /** A new server generation: the client's session is unknown to it, so the next request expires the session. */
    restart: () => void (current = build()),
  }
}

// ── #1563 AC6 at the retry after a recovered session (review R1 #3) ──────────────────────────────────────────────
// Red if the retry after the session recovery is sent although the new server generation lists the tool with another
// schema; an unchanged definition is retried and runs.
describe("#1563 AC6: the retry after a recovered session", () => {
  for (const [label, schema, sent] of [
    ["the new generation changed the tool: the retry is not sent and the call fails by name", { key: { type: "number" } }, 0],
    ["the new generation lists the same tool: the retry runs", {}, 1],
  ] as const) {
    const server = httpServer()
    testEffect(mcpLayer({ remote: new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false }) })).live(label, () =>
      Effect.gen(function* () {
        yield* connected("remote")
        server.state.probe = { ...server.state.probe, inputSchema: { type: "object", properties: schema } }
        server.restart()
        const exit = yield* (yield* Mcp.Service).callTool({ server: "remote", name: "probe", args: {} }).pipe(Effect.exit)
        expect(server.state.calls).toBe(sent)
        if (sent) expect(Exit.isSuccess(exit)).toBe(true)
        else expect(String(Exit.isFailure(exit) ? exit.cause : "")).toContain("changed after this request was prepared")
      }).pipe(Effect.ensuring(Effect.sync(server.stop))),
    )
  }
})

// ── #1645 (v1 successor) ─────────────────────────────────────────────────────────────────────────────────────────
// Red if a tools/list failure another attempt may fix is not retried in the background (no list after 30 s, server
// stays failed). 501 is a 5xx upstream does not retry inside the attempt (client.ts isTransient), so the background
// reconnect is what recovers it.
describe("#1645: a failed tools/list", () => {
  const flaky = httpServer()
  flaky.state.listStatus = 501
  testEffect(mcpLayer({ cloud: new ConfigMCP.Remote({ type: "remote", url: flaky.url, oauth: false }) })).effect(
    "a 5xx listing reconnects after 30 s and the tools appear in the same service",
    () =>
      Effect.gen(function* () {
        yield* until(statusOf("cloud").pipe(Effect.map((s: any) => (s?.status === "failed" ? s : undefined))), "cloud failed")
        const lists = flaky.state.lists
        flaky.state.listStatus = 0
        yield* TestClock.adjust("29 seconds")
        yield* Effect.promise(() => Bun.sleep(300))
        expect(flaky.state.lists).toBe(lists)
        yield* TestClock.adjust("1 second")
        yield* connected("cloud")
        expect(yield* toolNames).toEqual(["cloud/probe"])
      }).pipe(Effect.ensuring(Effect.sync(flaky.stop))),
  )

  // Red if a tools/list 401 is named without its HTTP status (it would read as `transport` and reconnect every 30 s
  // up to 10 min).
  const denied = httpServer()
  denied.state.listStatus = 401
  testEffect(mcpLayer({ locked: new ConfigMCP.Remote({ type: "remote", url: denied.url, oauth: false }) })).effect(
    "an auth answer to tools/list is named auth and not retried",
    () =>
    Effect.gen(function* () {
      const settled: any = yield* until(statusOf("locked").pipe(Effect.map((s: any) => (s?.status !== "pending" && s?.status !== "connected" ? s : undefined))), "locked settled")
      expect(parseFailureCode(settled.error)?.code).toBe("auth")
      const lists = denied.state.lists
      denied.state.listStatus = 0
      yield* TestClock.adjust("15 minutes")
      yield* Effect.promise(() => Bun.sleep(300))
      expect(denied.state.lists).toBe(lists)
    }).pipe(Effect.ensuring(Effect.sync(denied.stop))),
  )
})

// ── #1653 (v1 successor) ─────────────────────────────────────────────────────────────────────────────────────────
// Red if a server in backoff held back another server's tools or calls, or if calling it reconnected before its turn
// (a new request reaching the endpoint). OpenCode 2 shows such a server as failed, not pending (constraints.md).
describe("#1653: a server waiting out its backoff", () => {
  const hits = { count: 0 }
  const down = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => (hits.count++, new Response("no", { status: 501 })) })
  testEffect(
    mcpLayer({ ready: local(), cloud: new ConfigMCP.Remote({ type: "remote", url: `http://127.0.0.1:${down.port}/mcp`, oauth: false }) }),
  ).effect("holds back no other server, and calling it fails without reaching its endpoint", () =>
    Effect.gen(function* () {
      yield* until(statusOf("cloud").pipe(Effect.map((s: any) => (s?.status === "failed" ? s : undefined))), "cloud failed")
      yield* connected("ready")
      const before = hits.count
      expect(before).toBeGreaterThan(0)
      const mcp = yield* Mcp.Service
      expect(yield* toolNames).toEqual(["ready/echo"])
      expect((yield* mcp.callTool({ server: "ready", name: "echo", args: { text: "ready" } })).content).toEqual([{ type: "text", text: "ready" }])
      expect(Exit.isFailure(yield* mcp.callTool({ server: "cloud", name: "probe", args: {} }).pipe(Effect.exit))).toBe(true)
      yield* Effect.promise(() => Bun.sleep(300))
      expect(hits.count).toBe(before)
    }).pipe(Effect.ensuring(Effect.sync(() => down.stop(true)))),
  )
})

// ── #1565 with the shipped manifest (#1666 Unit E) ───────────────────────────────────────────────────────────────
// The real bundled tools.json and server.py (packages/ui-mac/resources/office-mcp), the command shape main writes
// (ui-mac office-advisories codepuppyOfficeInstallCommand: {codepuppyResources} slots and the {workspace} marker), and
// the same command after the extension replaced the marker with the folder (packages/ext/src/policy/index.ts).
// Red if the template comparison stops accepting the substituted folder (the engine would see no declaration), or if
// the shipped server.py stops listing exactly what the shipped manifest declares.
describe("#1565: the shipped Office manifest and server", () => {
  const shipped = path.resolve(import.meta.dir, "../../ui-mac/resources/office-mcp")
  const resources = path.join(ROOT, `Resources-${crypto.randomUUID()}`)
  fs.mkdirSync(path.join(resources, "office-mcp"), { recursive: true })
  fs.mkdirSync(path.join(resources, "office-runtime", "bin"), { recursive: true })
  for (const name of ["server.py", "tools.json"]) fs.copyFileSync(path.join(shipped, name), path.join(resources, "office-mcp", name))
  // The bundled interpreter: this machine's python3 runs the real server.py.
  fs.writeFileSync(path.join(resources, "office-runtime", "bin", "python3"), '#!/bin/sh\nexec python3 "$@"\n', { mode: 0o755 })
  const manifest = path.join(resources, "office-mcp", "tools.json")
  const env = { [OFFICE_MCP_MANIFEST_ENV]: manifest }
  const template: string[] = JSON.parse(fs.readFileSync(manifest, "utf8")).formats.word.command
  const asWritten = template.map((token) => token.split("{codepuppyResources}").join(resources))
  const afterExtension = asWritten.map((token) => (token === "{workspace}" ? ROOT : token))
  const word = (command: string[]) => new ConfigMCP.Local({ type: "local", command } as never)
  const declaredNames = (command: unknown[]) => (declaredListedTools("codepuppy-word", { type: "local", command }, env, fs.readFileSync) ?? []).map((tool: any) => tool.name)

  testEffect(Layer.empty).effect("the command main writes and the one after the folder substitution both get the declaration", () =>
    Effect.sync(() => {
      expect(declaredNames(asWritten)).toEqual(["read_docx", "write_docx"])
      expect(declaredNames(afterExtension)).toEqual(["read_docx", "write_docx"])
      expect(declaredNames(asWritten.map((token) => (token === "{workspace}" ? "relative/folder" : token)))).toEqual([])
      expect(declaredNames(asWritten.map((token) => (token === "{workspace}" ? `${ROOT}/../elsewhere` : token)))).toEqual([])
      expect(declaredNames([...afterExtension, "--debug"])).toEqual([])
    }),
  )

  let previous: string | undefined
  beforeAll(() => {
    previous = process.env[OFFICE_MCP_MANIFEST_ENV]
    process.env[OFFICE_MCP_MANIFEST_ENV] = manifest
  })
  afterAll(() => {
    process.env[OFFICE_MCP_MANIFEST_ENV] = previous
  })
  testEffect(mcpLayer({ "codepuppy-word": word(afterExtension) })).live("the real server.py, started as the engine starts it, lists exactly the shipped declaration", () =>
    Effect.gen(function* () {
      yield* connected("codepuppy-word")
      const declared = declaredListedTools("codepuppy-word", word(afterExtension), env, fs.readFileSync)
      const listed = (yield* (yield* Mcp.Service).tools()).filter((tool: any) => tool.server === "codepuppy-word")
      expect(listed.map((tool: any) => tool.name)).toEqual(["read_docx", "write_docx"])
      expect(listsDeclaration(declared ?? [], listed)).toBe(true)
    }),
  )
})

// ── #1645 no remote text in logs or the failed status (#1666 Unit F) ─────────────────────────────────────────────
// v1's sample: the refusing server answers with a body carrying a secret; a local server writes one to stderr and dies.
// Red if any captured log line (the MCP client's transport and request logs, the service's connect log) or the
// public failed status carries it; the status still names the cause and, for HTTP, the status code.
describe("#1645: a failure's remote text stays out of logs and the failed status", () => {
  const SECRET = "synthetic-secret-1645"
  const capture = (logs: string[]) =>
    Logger.layer([Logger.make((entry: any) => void logs.push(JSON.stringify(entry.message)))], { mergeWithExisting: true })

  const refusing = httpServer()
  refusing.state.listStatus = 401
  refusing.state.listBody = `denied for ${SECRET}`
  const remoteLogs: string[] = []
  testEffect(
    mcpLayer({ locked: new ConfigMCP.Remote({ type: "remote", url: refusing.url, oauth: false }) }).pipe(Layer.provide(capture(remoteLogs))),
  ).effect("a remote refusal: the body is in no log line and not in the status, which reads auth and HTTP 401", () =>
    Effect.gen(function* () {
      const status: any = yield* until(statusOf("locked").pipe(Effect.map((s: any) => (s?.status === "failed" ? s : undefined))), "locked failed")
      expect(parseFailureCode(status.error)).toMatchObject({ code: "auth" })
      expect(status.error).toContain("HTTP 401")
      expect(status.error).not.toContain(SECRET)
      expect(remoteLogs.some((line) => line.includes("locked"))).toBe(true)
      expect(remoteLogs.filter((line) => line.includes(SECRET))).toEqual([])
    }).pipe(Effect.ensuring(Effect.sync(refusing.stop))),
  )

  // Review R1 #4: a 503 is transient, so the client retries the connect first; the retry log lines are failure logs too.
  const overloaded = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(`overloaded ${SECRET}`, { status: 503 }) })
  const retryLogs: string[] = []
  testEffect(
    mcpLayer({ busy: new ConfigMCP.Remote({ type: "remote", url: `http://127.0.0.1:${overloaded.port}/mcp`, oauth: false }) }).pipe(Layer.provide(capture(retryLogs))),
  ).live("a 503 the client retries: the body is in no retry log line and not in the status", () =>
    Effect.gen(function* () {
      const status: any = yield* until(statusOf("busy").pipe(Effect.map((s: any) => (s?.status === "failed" ? s : undefined))), "busy failed")
      expect(retryLogs.filter((line) => line.includes("retrying")).length).toBeGreaterThan(0)
      expect(retryLogs.filter((line) => line.includes(SECRET))).toEqual([])
      expect(status.error).not.toContain(SECRET)
    }).pipe(Effect.ensuring(Effect.sync(() => overloaded.stop(true)))),
  )

  const localLogs: string[] = []
  testEffect(mcpLayer({ crash: local({ CODEPUPPY_MCP_EXIT_STDERR: `boom ${SECRET}` }) }).pipe(Layer.provide(capture(localLogs)))).live(
    "a local server that writes a secret to stderr and exits: it is in no log line and not in the status",
    () =>
      Effect.gen(function* () {
        const status: any = yield* until(statusOf("crash").pipe(Effect.map((s: any) => (s?.status === "failed" ? s : undefined))), "crash failed")
        expect(status.error).toContain("MCP server process exited with code 3")
        expect(status.error).not.toContain(SECRET)
        expect(localLogs.some((line) => line.includes("crash"))).toBe(true)
        expect(localLogs.filter((line) => line.includes(SECRET))).toEqual([])
      }),
  )
})
