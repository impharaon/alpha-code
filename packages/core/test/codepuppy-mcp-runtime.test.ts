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
//   #1690 closing the service while a stdio server's handshake hangs interrupts that start: closed within 5 s, process gone
//   #1565 with the shipped manifest: the command main writes ({workspace} marker) and the one the engine sees after the
//        extension substitutes the folder both get the declaration; the real python server lists exactly it (#1666 Unit E)
//
// HOME, XDG_*, TMPDIR and the database are isolated by the shared test preload (bunfig.toml, I-08) before any module loads.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Client, InMemoryTransport, fromJsonSchema, type MetaObject } from "@modelcontextprotocol/client"
import { Server } from "@modelcontextprotocol/server"
import { registerPinnedFilesHandler } from "@opencode/core/mcp/codepuppy-pinned-files"
import type { ConnectorLaunchHost, LaunchSnapshot, PinnedPreparationProgress } from "@opencode/util/codepuppy-connector-launch"
import { publishConnectorLaunchHost } from "@opencode/util/codepuppy-connector-launch"
import { Tool } from "@opencode/schema/tool"
import { createHash } from "node:crypto"
import type { LauncherEnvironment } from "@opencode/util/codepuppy-connector-launch"
import { canonicalJsonDigest } from "@opencode/util/codepuppy-hash"
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
const { McpConnection } = await import("@opencode/core/mcp/connection")
const { Environment } = await import("@opencode/core/environment/index")
const { classifyStartFailure } = await import("@opencode/core/mcp/codepuppy-startup")
const { McpPool } = await import("@opencode/core/mcp/pool")
const { declaredListedTools, declaredFirstPartyTools, expandFirstPartyCommand, commandMatchesTemplate, listsDeclaration } = await import("@opencode/core/mcp/codepuppy-first-party-mcp")
const { __resetCodePuppyBootstrapForTests, parseCodePuppyBootstrap, publishCodePuppyBootstrap, tryCodePuppyBootstrap } = await import("@opencode/util/codepuppy-bootstrap")
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
const mcpLayer = (servers: Record<string, unknown>, busLayer = Layer.mock(Bus.Service, { subscribe: () => Stream.never, publish: (definition: any, data: any) => Effect.succeed({ id: "evt", type: definition.type, data } as never) })) =>
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
        busLayer,
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
// Red if startup waited for every server: `ok` would stay pending behind the 30 s handshake timeout of `hang`, and
// `connected("ok")` gives up after its own 10 s wait. `#1705`: no wall-clock ceiling on top — `hang` still pending and the
// tool list holding only `ok` are the structural proof.
// `hang` is killed once the assertions ran: before #1690 closing the layer waited for its handshake timeout (the teardown
// time followed `timeout.startup`: 8 s ⇒ 10.3 s, the 30 s default ⇒ 32 s), which overran the 5 s test budget.
describe("AC1: one server never answering does not hold back another", () => {
  const pidFile = file("hang.pid")
  const killHang = Effect.sync(() => {
    if (fs.existsSync(pidFile)) process.kill(Number(fs.readFileSync(pidFile, "utf8")), "SIGKILL")
  })
  testEffect(mcpLayer({ hang: local({ CODEPUPPY_MCP_HANG: "1", CODEPUPPY_MCP_PID_FILE: pidFile }), ok: local() })).live("ok is connected and listed while hang is still pending", () =>
    Effect.gen(function* () {
      yield* connected("ok")
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
/**
 * #1698: the engine reads the Office manifest path from Code Puppy's bootstrap document (the sidecar publishes it before the
 * engine starts). The fixture goes through the production parser, so a wrong shape fails here.
 */
function publishOfficeManifest(officeMcpManifest: string) {
  __resetCodePuppyBootstrapForTests()
  publishCodePuppyBootstrap(
    parseCodePuppyBootstrap({
      v: 1,
      paths: { userData: ROOT, globalRoot: ROOT, initialDirectory: ROOT, database: ":memory:", engineConfigDirectory: ROOT, officeMcpManifest },
      // G2 / G3 fields are required in every document; this one carries no cloud MCP, no policy account, no egress proxy,
      // the desktop's default engine toggles, no factory skills, the default ask deadline and every switch off.
      platform: { credentialRef: `{file:${path.join(ROOT, "codepuppy-secrets", "CODEPUPPY_API_KEY")}}` },
      webSearch: { killSwitch: false },
      policy: {},
      network: {},
      engine: { modelsFetch: false, filewatcher: true },
      skills: { factoryDirs: [] },
      permission: {},
      switches: { modelsDisabled: false, identityDisabled: false, behaviorDisabled: false, promptRebrandDisabled: false, automationDisabled: false, readonlyDisabled: false, ecosystemInherit: false, extVerbose: false },
    }),
  )
}

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
      // Only entries with the bundled command (here: an extra `--office` token) are first-party.
      formats: { docx: { command: [process.execPath, FIXTURE, "--office"], environment: {}, cwd: null, codeSha256: { "office-mcp/server.py": createHash("sha256").update("# bundled server\n").digest("hex") }, tools: [declaredTool] } },
    }),
  )
  publishOfficeManifest(manifest)
  const office = (tools: unknown[]) => {
    const environment = { CODEPUPPY_MCP_INIT_DELAY_MS: "1500", CODEPUPPY_MCP_TOOLS_FILE: toolsFile(tools) }
    const document = JSON.parse(fs.readFileSync(manifest, "utf8"))
    document.formats[`docx-${Object.keys(document.formats).length}`] = { ...document.formats.docx, environment }
    fs.writeFileSync(manifest, JSON.stringify(document))
    return new ConfigMCP.Local({ type: "local", command: [process.execPath, FIXTURE, "--office"], environment } as never)
  }
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

// `#1690`: a stdio server that never answers its handshake does not hold back shutdown. The proof is structural, not a
// wall-clock bound (scripts/wall-clock-assertions.tsv): the hung server's startup timeout is ten minutes, so closing
// the service can only finish inside the test's 15 s budget if shutdown interrupts the start instead of waiting it out.
// Red without the fix: closing waits for that timeout and the test runs out its budget. The premise arm: the server is
// alive and still pending when the service closes; afterwards its process is gone. Measured with the fix: about 2 s
// (the transport's 2 s stdin grace, then SIGTERM), printed below for the record.
describe("#1690: closing the service while a server's handshake hangs", () => {
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  testEffect(Layer.empty).live(
    "closing does not wait out a hung start's timeout, and the hung server's process is gone",
    () =>
      Effect.gen(function* () {
        const pidFile = file("hang-close.pid")
        const hang = local(
          { CODEPUPPY_MCP_HANG: "1", CODEPUPPY_MCP_PID_FILE: pidFile },
          { timeout: new ConfigMCP.Timeout({ startup: 600_000 }) },
        )
        const { pid, started } = yield* Effect.scoped(
          Effect.gen(function* () {
            const pid = yield* until(
              Effect.sync(() => (fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, "utf8")) || undefined : undefined)),
              "hung server spawned",
            )
            expect(alive(pid)).toBe(true)
            expect((yield* statusOf("hang"))?.status).toBe("pending")
            return { pid, started: Date.now() }
          }).pipe(Effect.provide(mcpLayer({ hang }))),
        )
        process.stderr.write(`[#1690] service closed ${Date.now() - started} ms after a hung handshake\n`)
        expect(alive(pid)).toBe(false)
      }),
    15_000,
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
    methods: [] as string[],
    proxyHeaders: [] as (string | null)[],
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
      state.methods.push(request.method)
      state.proxyHeaders.push(request.headers.get("proxy-authorization"))
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
  const template: string[] = JSON.parse(fs.readFileSync(manifest, "utf8")).formats.word.command
  const asWritten = template.map((token) => token.split("{codepuppyResources}").join(resources))
  const afterExtension = asWritten.map((token) => (token === "{workspace}" ? ROOT : token))
  const word = (command: string[]) => new ConfigMCP.Local({ type: "local", command } as never)
  const declaredNames = (command: unknown[]) => (declaredListedTools("codepuppy-word", { type: "local", command }, manifest, fs.readFileSync) ?? []).map((tool: any) => tool.name)

  testEffect(Layer.empty).effect("the command main writes and the one after the folder substitution both get the declaration", () =>
    Effect.sync(() => {
      expect(declaredNames(asWritten)).toEqual(["read_docx"])
      expect(declaredNames(afterExtension)).toEqual(["read_docx"])
      expect(declaredNames(asWritten.map((token) => (token === "{workspace}" ? "relative/folder" : token)))).toEqual([])
      expect(declaredNames(asWritten.map((token) => (token === "{workspace}" ? `${ROOT}/../elsewhere` : token)))).toEqual([])
      expect(declaredNames([...afterExtension, "--debug"])).toEqual([])
    }),
  )

  testEffect(Layer.empty).effect("Office declarations bind the exact trusted Python environment", () => Effect.sync(() => {
    const expected = { CODEPUPPY_DOCUMENT_HOST: "/private/python-host/7/registration/host.json" }
    const entry = { type: "local", command: afterExtension, environment: expected }
    expect(declaredListedTools("codepuppy-word", entry, manifest, fs.readFileSync, expected)?.length).toBeGreaterThan(0)
    expect(declaredListedTools("codepuppy-word", entry, manifest, fs.readFileSync)).toBeUndefined()
    expect(declaredListedTools("codepuppy-word", { ...entry, environment: { CODEPUPPY_DOCUMENT_HOST: "/foreign/host.json" } }, manifest, fs.readFileSync, expected)).toBeUndefined()
    expect(declaredListedTools("codepuppy-word", { type: "local", command: afterExtension }, manifest, fs.readFileSync, expected)).toBeUndefined()
  }))

  // Integration layer: own manifest format, derived from the shipped declaration and protected server bytes.
  testEffect(Layer.empty).effect("bundled slots bind only the host Node and stable declaration cache root before assets exist", () => Effect.sync(() => {
    const native = JSON.parse(fs.readFileSync(manifest, "utf8")).formats.word
    const declaration = { ...native, command: ["{codepuppyNode}", "{codepuppyResources}/office-mcp/server.py", "{workspace}", "{codepuppyCacheRoot}"] }
    const slotManifest = path.join(resources, "office-mcp", "slots.json")
    fs.writeFileSync(slotManifest, JSON.stringify({ formats: { stable: declaration } }))
    for (const node of [path.join(resources, "connector-launchers/node/bin/node"), path.join(ROOT, "not-expanded/pin/node/bin/node")]) {
      const launchers: LauncherEnvironment = { platform: "darwin-arm64", pinSet: "a".repeat(64), uv: "/runtime/uv", uvx: "/runtime/uvx", node, npmCli: "/runtime/npm.js", npxCli: "/runtime/npx.js", runtimeRoot: path.join(ROOT, "runtime"), pythonFileId: "python/darwin-arm64/3.12.16-20261124", packageManagerEnv: {}, environment: {}, firstPartyCacheRoots: { stable: path.join(ROOT, "first-party-cache/stable") } }
      const command = expandFirstPartyCommand(declaration.command, resources, launchers, "stable")
      expect(command).toEqual([node, path.join(resources, "office-mcp/server.py"), "{workspace}", launchers.firstPartyCacheRoots.stable])
      expect(commandMatchesTemplate(declaration.command, command, resources, launchers, "stable")).toBe(true)
      const entry = { type: "local", command }
      const declared = declaredFirstPartyTools("user-renamed-server", entry, slotManifest, fs.readFileSync, undefined, launchers)
      expect(declared?.tools).toEqual(native.tools)
      expect(declaredFirstPartyTools("stable", entry, slotManifest, fs.readFileSync)).toBeUndefined()
      expect(declaredFirstPartyTools("stable", { ...entry, command: ["/usr/local/bin/node", ...command.slice(1)] }, slotManifest, fs.readFileSync, undefined, launchers)).toBeUndefined()
      expect(declaredFirstPartyTools("stable", { ...entry, command: [...command.slice(0, 3), "/foreign/cache"] }, slotManifest, fs.readFileSync, undefined, launchers)).toBeUndefined()
      expect(declaredFirstPartyTools("stable", entry, slotManifest, fs.readFileSync, undefined, { ...launchers, firstPartyCacheRoots: { "user-renamed-server": launchers.firstPartyCacheRoots.stable! } })).toBeUndefined()
      const recipeSha256 = canonicalJsonDigest({ kind: "codepuppy-pinned-entry-recipe", recipe: [] }).slice(7)
      expect(declared?.recipeSha256).toBe(recipeSha256)
      expect(declared?.declarationSha256).toBe(canonicalJsonDigest({ kind: "codepuppy-bundled-mcp-declaration", command: declaration.command, environment: {}, cwd: null, codeSha256: declaration.codeSha256, tools: native.tools, recipeSha256 }).slice(7))
      for (const bad of [["{workspace}"], ["{codepuppyNode}/suffix"], ["/node", "{codepuppyNode}"], ["{codepuppyCacheRoot}"], ["/node", "{codepuppyCacheRoot}/suffix"]]) {
        expect(() => expandFirstPartyCommand(bad, resources, launchers, "stable")).toThrow()
        expect(commandMatchesTemplate(bad, bad, resources, launchers, "stable")).toBe(false)
      }
    }
  }))

  testEffect(Layer.empty).effect("bundled declarations reject extra environment cwd malformed recipes and escaped code", () => Effect.sync(() => {
    const entry = { type: "local", command: afterExtension }
    for (const environment of [{ NODE_OPTIONS: "--inspect" }, { PYTHONPATH: ROOT }, { EXTRA: "value" }, []]) expect(declaredFirstPartyTools("word", { ...entry, environment }, manifest, fs.readFileSync)).toBeUndefined()
    expect(declaredFirstPartyTools("word", { ...entry, cwd: ROOT }, manifest, fs.readFileSync)).toBeUndefined()
    const original = JSON.parse(fs.readFileSync(manifest, "utf8")).formats.word
    const file = path.join(resources, "office-mcp", "invalid.json")
    for (const change of [{ codeSha256: {} }, { codeSha256: { "../escape": "a".repeat(64) } }, { codeSha256: { "office-mcp/server.py": "0".repeat(64) } }, { recipe: [{ id: "python/darwin-arm64/3.12.16-20261124", archive: "tar.gz", entry: "../escape", required: ["../escape"] }] }]) {
      fs.writeFileSync(file, JSON.stringify({ formats: { word: { ...original, ...change } } }))
      expect(declaredFirstPartyTools("word", entry, file, fs.readFileSync)).toBeUndefined()
    }
    const expected = { CODEPUPPY_DOCUMENT_HOST: "/private/python-host/7/registration/host.json" }
    expect(declaredFirstPartyTools("word", { ...entry, environment: { ...expected, NODE_OPTIONS: "--inspect" } }, manifest, fs.readFileSync, expected)).toBeUndefined()
  }))

  let previous: string | undefined
  beforeAll(() => {
    previous = tryCodePuppyBootstrap()?.paths.officeMcpManifest
    publishOfficeManifest(manifest)
  })
  afterAll(() => {
    if (previous) publishOfficeManifest(previous)
    else __resetCodePuppyBootstrapForTests()
  })
  testEffect(mcpLayer({ "codepuppy-word": word(afterExtension) })).live("the real server.py, started as the engine starts it, lists exactly the shipped declaration", () =>
    Effect.gen(function* () {
      yield* connected("codepuppy-word")
      const declared = declaredListedTools("codepuppy-word", word(afterExtension), manifest, fs.readFileSync)
      const listed = (yield* (yield* Mcp.Service).tools()).filter((tool: any) => tool.server === "codepuppy-word")
      expect(listed.map((tool: any) => tool.name)).toEqual(["read_docx"])
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


testEffect(Layer.empty).live("explicit SSE opens the declared GET URL and never probes HTTP codemode", () => Effect.gen(function* () {
  const { Schema } = yield* Effect.promise(() => import("effect"))
  const seen: Array<{ method: string; path: string; authorization: string | null }> = []
  const endpoint = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    seen.push({ method: request.method, path: new URL(request.url).pathname + new URL(request.url).search, authorization: request.headers.get("authorization") })
    return new Response(null, { status: 403 })
  } })
  yield* Effect.addFinalizer(() => Effect.promise(() => endpoint.stop(true)))
  const config = Schema.decodeUnknownSync(ConfigMCP.Remote)({ type: "remote", url: `http://127.0.0.1:${endpoint.port}/events?source=plugin`, transport: "sse", oauth: false, headers: { Authorization: "Bearer invalid-sse-test" } })
  const result = yield* McpClient.connect({ server: "sse", config, directory: ROOT }).pipe(Effect.provide(hostEnvironmentLayer), Effect.scoped, Effect.exit)
  expect(Exit.isFailure(result)).toBe(true)
  expect(seen).toEqual([{ method: "GET", path: "/events?source=plugin", authorization: "Bearer invalid-sse-test" }])
}))


testEffect(Layer.empty).live("absent and explicit HTTP retain the same streamable HTTP request", () => Effect.gen(function* () {
  const seen: Array<{ method: string; search: string }> = []
  const endpoint = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    seen.push({ method: request.method, search: new URL(request.url).search })
    return new Response(null, { status: 403 })
  } })
  yield* Effect.addFinalizer(() => Effect.promise(() => endpoint.stop(true)))
  for (const transport of [undefined, "http"] as const) {
    const config = new ConfigMCP.Remote({ type: "remote", url: `http://127.0.0.1:${endpoint.port}/mcp?source=plugin`, ...(transport ? { transport } : {}), oauth: false })
    const result = yield* McpClient.connect({ server: "http", config, directory: ROOT }).pipe(Effect.provide(hostEnvironmentLayer), Effect.scoped, Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
  }
  expect(seen).toEqual([{ method: "POST", search: "?source=plugin" }, { method: "POST", search: "?source=plugin" }])
}))

function packageElicitationHandlers(input: Pick<import("@opencode/plugin/codepuppy-package-runtime").PackageRuntimeHandlers, "beforeElicitation" | "afterElicitationResult">): import("@opencode/plugin/codepuppy-package-runtime").PackageRuntimeHandlers {
  return { ...input, hasElicitationHandlers: () => true, beforeConfigChange: async () => ({ apply: true }), instructionsLoaded: async () => {}, beforeCompaction: async () => ({ proceed: true }), afterCompaction: async () => {} }
}

for (const concurrent of [false, true]) testEffect(Layer.empty).live(`stdio package elicitation keeps one process for ${concurrent ? "same-session concurrent" : "one"} calls`, () => Effect.gen(function* () {
  const runtime = yield* Effect.promise(() => import("@opencode/plugin/codepuppy-package-runtime"))
  const { Session } = yield* Effect.promise(() => import("@opencode/schema/session"))
  const sessionID = Session.ID.make("ses_stdio_elicitation")
  const before: string[] = []
  const after: string[] = []
  const registration = runtime.registerPackageRuntime({ directory: ROOT }, packageElicitationHandlers({ beforeElicitation: async input => { before.push(input.sessionID); return { handled: true, answer: { action: "accept", content: { answer: "from package" } } } }, afterElicitationResult: async input => { after.push(input.sessionID); return input.answer } }))
  yield* Effect.addFinalizer(() => Effect.sync(() => registration.dispose()))
  const starts = file("elicitation-starts")
  yield* Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const forms = yield* Form.Service
    yield* connected("local")
    const calls = yield* Effect.all(Array.from({ length: concurrent ? 2 : 1 }, () => mcp.callTool({ server: "local", name: "elicit", sessionID, args: concurrent ? { waitForPeer: true } : {} })), { concurrency: "unbounded" }).pipe(Effect.forkScoped)
    yield* until(forms.list().pipe(Effect.map(list => list.length || before.length ? true : undefined)), "elicitation boundary")
    expect(before).toHaveLength(concurrent ? 2 : 1)
    expect(yield* forms.list()).toHaveLength(0)
    const results = yield* Fiber.join(calls)
    expect(results.every(result => JSON.stringify(result).includes("from package"))).toBe(true)
    expect(after).toHaveLength(0)
    expect(fs.readFileSync(starts, "utf8").split("+").length - 1).toBe(1)
  }).pipe(Effect.provide(mcpLayer({ local: local({ CODEPUPPY_MCP_STARTUP_LOG: starts }, { protocol: "legacy" }) })))
}))

testEffect(Layer.empty).live("stdio cross-session elicitation only diagnoses ambiguous ownership and retains native forms", () => Effect.gen(function* () {
  const runtime = yield* Effect.promise(() => import("@opencode/plugin/codepuppy-package-runtime"))
  const { Session } = yield* Effect.promise(() => import("@opencode/schema/session"))
  const seen: string[] = []
  const logs: string[] = []
  const registration = runtime.registerPackageRuntime({ directory: ROOT }, packageElicitationHandlers({ beforeElicitation: async input => { seen.push(input.sessionID); return { handled: true, answer: { action: "decline" } } }, afterElicitationResult: async input => { seen.push(input.sessionID); return input.answer } }))
  yield* Effect.addFinalizer(() => Effect.sync(() => registration.dispose()))
  const starts = file("ambiguous-starts")
  yield* Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const forms = yield* Form.Service
    yield* connected("local")
    const calls = yield* Effect.all(["ses_stdio_left", "ses_stdio_right"].map(id => mcp.callTool({ server: "local", name: "elicit", sessionID: Session.ID.make(id), args: { waitForPeer: true } })), { concurrency: "unbounded" }).pipe(Effect.forkScoped)
    const pending = yield* until(forms.list().pipe(Effect.map(list => list.length === 2 ? list : undefined)), "two native forms")
    expect(pending.map(form => form.sessionID)).toEqual(["global", "global"])
    expect(seen).toHaveLength(0)
    expect(logs.some(log => log.includes("ambiguous") && log.includes("local"))).toBe(true)
    for (const form of pending) yield* forms.reply({ id: form.id, answer: { answer: "native user" } })
    expect((yield* Fiber.join(calls)).every(result => JSON.stringify(result).includes("native user"))).toBe(true)
    expect(seen).toHaveLength(0)
    expect(fs.readFileSync(starts, "utf8").split("+").length - 1).toBe(1)
  }).pipe(Effect.provide(mcpLayer({ local: local({ CODEPUPPY_MCP_STARTUP_LOG: starts }, { protocol: "legacy" }) })), Effect.provide(Logger.layer([Logger.make(entry => { logs.push(JSON.stringify(entry.message)) })], { mergeWithExisting: true })))
}))

const { PluginTestLayer } = await import("./plugin/fixture")
const { Session: NativeSession } = await import("@opencode/core/session")

testEffect(PluginTestLayer).live("a real session owns matching remote MCP transports until SessionEnd and removal while stdio stays open", () => Effect.gen(function* () {
  const runtime = yield* Effect.promise(() => import("@opencode/plugin/codepuppy-package-runtime"))
  const sessions = yield* NativeSession.Service
  const session = yield* sessions.create({ location: Location.Ref.make({ directory: AbsolutePath.make(ROOT) }) })
  const bus = yield* Bus.Service
  const transports = new Map<string, InstanceType<typeof WebStandardStreamableHTTPServerTransport>>()
  const counts = { opened: 0, closed: 0 }
  const http = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async request => {
    const id = request.headers.get("mcp-session-id")
    if (id) return transports.get(id)?.handleRequest(request) ?? new Response(null, { status: 404 })
    const server = new McpServer({ name: "session-owner-fixture", version: "1" }, { capabilities: { tools: {} } })
    server.setRequestHandler("tools/list", async () => ({ tools: [{ name: "probe", inputSchema: { type: "object", properties: {} } }] }))
    server.setRequestHandler("tools/call", async () => ({ content: [{ type: "text", text: "owned call" }] }))
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), enableJsonResponse: true, onsessioninitialized: id => { transports.set(id, transport); counts.opened++ }, onsessionclosed: id => { transports.delete(id); counts.closed++ } })
    await server.connect(transport)
    return transport.handleRequest(request)
  } })
  yield* Effect.addFinalizer(() => Effect.sync(() => { http.stop(true) }))
  const registration = runtime.registerPackageRuntime({ directory: ROOT }, packageElicitationHandlers({ beforeElicitation: async () => ({ handled: false }), afterElicitationResult: async input => input.answer }))
  yield* Effect.addFinalizer(() => Effect.sync(() => registration.dispose()))
  const starts = file("session-remote-stdio-starts")
  yield* Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    yield* connected("remote")
    yield* connected("local")
    expect(counts.opened).toBe(1)
    yield* mcp.callTool({ server: "remote", name: "probe", sessionID: session.id })
    expect(counts.opened).toBe(2)
    expect(counts.closed).toBe(0)
    yield* mcp.callTool({ server: "local", name: "echo", sessionID: session.id })
    yield* Effect.promise(() => runtime.releasePackageSessionMcp({ directory: ROOT }, session.id))
    expect(counts.closed).toBe(1)
    expect(transports.size).toBe(1)
    yield* mcp.callTool({ server: "local", name: "echo", sessionID: session.id })
    expect(fs.readFileSync(starts, "utf8").split("+").length - 1).toBe(1)
    yield* mcp.callTool({ server: "remote", name: "probe", sessionID: session.id })
    expect(counts.opened).toBe(3)
    yield* sessions.remove(session.id)
    yield* until(Effect.sync(() => counts.closed === 2 ? true : undefined), "session removal closes owned remote transport")
    expect(transports.size).toBe(1)
    yield* mcp.disconnect("remote")
    expect(transports.size).toBe(0)
  }).pipe(Effect.provide(mcpLayer({ remote: new ConfigMCP.Remote({ type: "remote", url: `http://127.0.0.1:${http.port}/mcp`, oauth: false }), local: local({ CODEPUPPY_MCP_STARTUP_LOG: starts }, { protocol: "legacy" }) }, Layer.succeed(Bus.Service, bus))))
}))

testEffect(Layer.empty).live("unmatched remote MCP connectors keep the Location transport when other package handlers exist", () => Effect.gen(function* () {
  const runtime = yield* Effect.promise(() => import("@opencode/plugin/codepuppy-package-runtime"))
  const { Session } = yield* Effect.promise(() => import("@opencode/schema/session"))
  const server = httpServer()
  yield* Effect.addFinalizer(() => Effect.sync(() => { server.stop() }))
  const registration = runtime.registerPackageRuntime({ directory: ROOT }, { ...packageElicitationHandlers({ beforeElicitation: async () => ({ handled: false }), afterElicitationResult: async input => input.answer }), hasElicitationHandlers: name => name === "another-server" })
  yield* Effect.addFinalizer(() => Effect.sync(() => registration.dispose()))
  yield* Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    yield* connected("remote")
    yield* mcp.callTool({ server: "remote", name: "probe", sessionID: Session.ID.make("ses_remote_without_matching_handler") })
    expect(server.state.lists).toBe(1)
    expect(server.state.calls).toBe(1)
  }).pipe(Effect.provide(mcpLayer({ remote: new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false }) })))
}))

testEffect(Layer.empty).live("stdio native form keeps its request owner through ElicitationResult", () => Effect.gen(function* () {
  const runtime = yield* Effect.promise(() => import("@opencode/plugin/codepuppy-package-runtime"))
  const { Session } = yield* Effect.promise(() => import("@opencode/schema/session"))
  const sessionID = Session.ID.make("ses_stdio_form_result")
  const seen: string[] = []
  const registration = runtime.registerPackageRuntime({ directory: ROOT }, packageElicitationHandlers({
    beforeElicitation: async input => { seen.push("before:" + input.sessionID); return { handled: false } },
    afterElicitationResult: async input => { seen.push("after:" + input.sessionID); return { action: "accept", content: { answer: "modified " + (input.answer.content as { answer: string }).answer } } },
  }))
  yield* Effect.addFinalizer(() => Effect.sync(() => registration.dispose()))
  yield* Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const forms = yield* Form.Service
    yield* connected("local")
    const call = yield* mcp.callTool({ server: "local", name: "elicit", sessionID }).pipe(Effect.forkScoped)
    const pending = yield* until(forms.list().pipe(Effect.map(list => list.length ? list[0] : undefined)), "owned native form")
    expect(pending.sessionID).toBe(sessionID)
    yield* forms.reply({ id: pending.id, answer: { answer: "user response" } })
    expect(JSON.stringify(yield* Fiber.join(call))).toContain("modified user response")
    expect(seen).toEqual(["before:" + sessionID, "after:" + sessionID])
  }).pipe(Effect.provide(mcpLayer({ local: local({}, { protocol: "legacy" }) })))
}))

testEffect(Layer.empty).live("withdrawing the matching package handlers releases only owned remote transports on reload", () => Effect.gen(function* () {
  const { sessionMcpHandler } = yield* Effect.promise(() => import("./fixture/codepuppy-mcp-session"))
  const runtime = yield* Effect.promise(() => import("@opencode/plugin/codepuppy-package-runtime"))
  const { Session } = yield* Effect.promise(() => import("@opencode/schema/session"))
  const handler = yield* Effect.promise(sessionMcpHandler)
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler.fetch })
  yield* Effect.addFinalizer(() => Effect.sync(() => { server.stop(true) }))
  let enabled = true
  const registration = runtime.registerPackageRuntime({ directory: ROOT }, { ...packageElicitationHandlers({ beforeElicitation: async () => ({ handled: false }), afterElicitationResult: async input => input.answer }), hasElicitationHandlers: () => enabled })
  yield* Effect.addFinalizer(() => Effect.sync(() => registration.dispose()))
  yield* Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    yield* connected("remote")
    yield* mcp.callTool({ server: "remote", name: "echo", sessionID: Session.ID.make("ses_handler_off") })
    expect(handler.counts).toEqual({ opened: 2, closed: 0 })
    enabled = false
    yield* mcp.reload()
    expect(handler.counts).toEqual({ opened: 2, closed: 1 })
    yield* mcp.callTool({ server: "remote", name: "echo", sessionID: Session.ID.make("ses_handler_off") })
    expect(handler.counts).toEqual({ opened: 2, closed: 1 })
  }).pipe(Effect.provide(mcpLayer({ remote: new ConfigMCP.Remote({ type: "remote", url: server.url.href, oauth: false }) })), Effect.scoped)
  expect(handler.counts).toEqual({ opened: 2, closed: 2 })
}))

testEffect(Layer.empty).live("explicit SSE keeps a session-owned stream until SessionEnd without closing its Location stream", () => Effect.gen(function* () {
  // Same real legacy SDK peer as plugin-mcp-proxy.test.ts; no hand-written MCP messages.
  const { createServer } = yield* Effect.promise(() => import("node:http"))
  const peer = path.dirname(Bun.resolveSync("@anthropic-ai/claude-agent-sdk", path.resolve(import.meta.dir, "..")))
  const sdk = yield* Effect.promise(() => import(Bun.resolveSync("@modelcontextprotocol/sdk/server/mcp.js", peer)))
  const sse = yield* Effect.promise(() => import(Bun.resolveSync("@modelcontextprotocol/sdk/server/sse.js", peer)))
  const runtime = yield* Effect.promise(() => import("@opencode/plugin/codepuppy-package-runtime"))
  const { Session } = yield* Effect.promise(() => import("@opencode/schema/session"))
  const counts = { opened: 0, closed: 0 }
  const transports = new Map<string, InstanceType<typeof sse.SSEServerTransport>>()
  const endpoint = createServer(async (request, response) => {
    if (request.method === "GET" && request.url?.startsWith("/events")) {
      const server = new sdk.McpServer({ name: "real-session-sse", version: "1" })
      server.registerTool("probe", { inputSchema: {} }, async () => ({ content: [{ type: "text", text: "sse-owned" }] }))
      const transport = new sse.SSEServerTransport("/messages", response)
      transports.set(transport.sessionId, transport)
      counts.opened++
      response.once("close", () => { counts.closed++; transports.delete(transport.sessionId) })
      await server.connect(transport)
      return
    }
    const transport = transports.get(new URL(request.url!, "http://localhost").searchParams.get("sessionId") ?? "")
    if (request.method === "POST" && transport) { await transport.handlePostMessage(request, response); return }
    response.writeHead(404); response.end()
  })
  yield* Effect.promise(() => new Promise<void>(resolve => endpoint.listen(0, "127.0.0.1", resolve)))
  yield* Effect.addFinalizer(() => Effect.promise(() => new Promise<void>(resolve => { endpoint.closeAllConnections(); endpoint.close(() => resolve()) })))
  const address = endpoint.address()
  if (!address || typeof address === "string") throw Error("SSE fixture has no port")
  const registration = runtime.registerPackageRuntime({ directory: ROOT }, packageElicitationHandlers({ beforeElicitation: async () => ({ handled: false }), afterElicitationResult: async input => input.answer }))
  yield* Effect.addFinalizer(() => Effect.sync(() => registration.dispose()))
  yield* Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    yield* connected("remote")
    const sessionID = Session.ID.make("ses_explicit_sse_owned")
    expect(counts).toEqual({ opened: 1, closed: 0 })
    expect(JSON.stringify(yield* mcp.callTool({ server: "remote", name: "probe", sessionID }))).toContain("sse-owned")
    expect(counts).toEqual({ opened: 2, closed: 0 })
    yield* Effect.promise(() => runtime.releasePackageSessionMcp({ directory: ROOT }, sessionID))
    yield* until(Effect.sync(() => counts.closed === 1 ? true : undefined), "owned SSE stream closed")
    expect(counts).toEqual({ opened: 2, closed: 1 })
    expect(JSON.stringify(yield* mcp.callTool({ server: "remote", name: "probe" }))).toContain("sse-owned")
    yield* mcp.disconnect("remote")
    yield* until(Effect.sync(() => counts.closed === 2 ? true : undefined), "Location SSE stream closed")
  }).pipe(Effect.provide(mcpLayer({ remote: new ConfigMCP.Remote({ type: "remote", transport: "sse", url: `http://127.0.0.1:${address.port}/events`, oauth: false }) })))
}))
describe("video progress", () => {
  const definitions = toolsFile([{ name: "video_progress", description: "progress wire fixture", inputSchema: { type: "object", properties: { completed: { type: "number" } } } }])
  testEffect(mcpLayer({ progress: local({ CODEPUPPY_MCP_TOOLS_FILE: definitions }) })).live("video progress follows each real SDK request instead of the connection's last caller", () =>
    Effect.gen(function* () {
      yield* connected("progress")
      const mcp = yield* Mcp.Service
      const first: unknown[] = []
      const second: unknown[] = []
      yield* Effect.all([
        mcp.callTool({ server: "progress", name: "video_progress", args: { completed: 1000 } }, async (update) => { first.push(update) }),
        mcp.callTool({ server: "progress", name: "video_progress", args: { completed: 2000 } }, async (update) => { second.push(update) }),
      ], { concurrency: 2 })
      expect(first).toEqual([{ phase: "decoding", completed: 1000, total: 10000, unit: "ms" }, { phase: "transcribing", completed: 1000, total: 10000, unit: "ms" }])
      expect(second).toEqual([{ phase: "decoding", completed: 2000, total: 10000, unit: "ms" }, { phase: "transcribing", completed: 2000, total: 10000, unit: "ms" }])
    }),
  )
})

// Integration layer, pure source classification: a coarse network code must never imply retry.
testEffect(Layer.empty).effect("launcher download classification uses final transport facts and preserves deterministic failures", () => Effect.sync(() => {
  for (const failure of [{ kind: "connect", detail: "refused" }, { kind: "timeout", detail: "idle" }, { kind: "http", status: 503, detail: "upstream" }, { kind: "http", status: 429, detail: "busy" }] as const) {
    expect(classifyStartFailure(undefined, { type: "local" }, { download: { result: { ok: false, error: "network" }, failure } }).failure).toEqual({ kind: "download", detail: failure.detail })
  }
  for (const failure of [{ kind: "http", status: 404, detail: "not published" }, { kind: "http", status: 403, detail: "registry forbidden" }, { kind: "integrity", detail: "digest mismatch" }, { kind: "disk", detail: "disk full" }, { kind: "resolution", detail: "requires-python conflict" }] as const) {
    expect(classifyStartFailure(undefined, { type: "local" }, { download: { result: { ok: false, error: "network" }, failure } }).failure).toEqual({ kind: "unknown", detail: failure.detail })
  }
  expect(classifyStartFailure(undefined, { type: "local" }, { download: { result: { ok: false, error: "network" } } }).failure?.kind).toBe("unknown")
}))

// Integration, affected PR/nightly: real SDK peers and our own tool/recipe. No runtime archive or timer fixture.
async function pinnedFilesPeers(prepare: ConnectorLaunchHost["prepareFiles"]) {
  const client = new Client({ name: "owned-pinned-client", version: "1" }, { versionNegotiation: { mode: "legacy" } })
  const server = new Server({ name: "owned-pinned-server", version: "1" }, { capabilities: { tools: {} } })
  const id = "speech-model/any/own-fixture" as const
  const tools = [{ name: "own", inputSchema: { type: "object" as const } }]
  const managed = {
    binding: { identity: { directory: ROOT, server: "own", attempt: crypto.randomUUID() }, sidecarGeneration: "owned-generation", entry: { type: "local" as const, command: ["owned-service"] }, declarationSha256: "a".repeat(64), recipeSha256: "b".repeat(64) },
    declaration: { tools, recipe: [{ id, archive: "file" as const, entry: "model", required: ["model"] }], declarationSha256: "a".repeat(64), recipeSha256: "b".repeat(64) },
  }
  const pinned = registerPinnedFilesHandler(client, managed, prepare)
  const [left, right] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(left), server.connect(right)])
  const request = (meta: MetaObject, params: Record<string, unknown> = { ids: [id] }) => server.request({ method: "codepuppy/pinned-files.ensure", params: { ...params, _meta: meta } }, fromJsonSchema({ type: "object" }))
  return { client, server, pinned, managed, id, tools, request, async close() { pinned.close(); await Promise.all([client.close(), server.close()]) } }
}

test("managed pinned requests validate all ids and active call metadata before host IO", async () => {
  const requests: unknown[] = []
  const f = await pinnedFilesPeers(async (input) => { requests.push(input); return { ok: true, files: input.ids.map((id) => ({ id, path: "/owned/model" })) } })
  try {
    await expect(f.request({})).rejects.toMatchObject({ code: -32600 })
    f.pinned.listed(f.tools)
    await expect(f.request({ "codepuppy/pinned-files.call": crypto.randomUUID(), "codepuppy/pinned-files.deadline": Date.now() })).rejects.toMatchObject({ code: -32600 })
    let previous: MetaObject = {}
    await f.pinned.withCall({ preparation: { callID: Tool.CallID.make("owned-call"), report: async () => {} }, signal: new AbortController().signal, deadline: Date.now() + 10_000, run: async (meta) => {
      previous = meta
      await expect(f.request({ ...meta, "codepuppy/pinned-files.deadline": Number(meta["codepuppy/pinned-files.deadline"]) + 1 })).rejects.toMatchObject({ code: -32600 })
      for (const params of [{ ids: [] }, { ids: [f.id], url: "https://outside.invalid" }, { ids: [f.id, "speech-model/any/not-in-recipe"] }])
        await expect(f.request(meta, params)).rejects.toMatchObject({ code: -32602 })
      expect(requests).toEqual([])
      expect(await f.request(meta, { ids: [f.id, f.id] })).toEqual({ ok: true, files: [{ id: f.id, path: "/owned/model" }] })
    } })
    expect(requests).toEqual([{ binding: f.managed.binding, ids: [f.id] }])
    await expect(f.request(previous)).rejects.toMatchObject({ code: -32600 })
  } finally { await f.close() }
})

test("managed pinned calls keep concurrent progress with its own call and revoke on finish", async () => {
  const callbacks: Array<{ signal: AbortSignal; progress: (update: PinnedPreparationProgress) => void; finish: () => void }> = []
  let both: () => void = () => {}
  const ready = new Promise<void>((resolve) => { both = resolve })
  const f = await pinnedFilesPeers((_input, signal, progress) => new Promise((resolve) => {
    callbacks.push({ signal, progress, finish: () => resolve({ ok: false, error: "network" }) })
    if (callbacks.length === 2) both()
  }))
  try {
    f.pinned.listed(f.tools)
    const updates: PinnedPreparationProgress[][] = [[], []]
    const metadata: MetaObject[] = []
    const run = (index: number) => f.pinned.withCall({ preparation: { callID: Tool.CallID.make(`owned-${index}`), report: async (update) => { updates[index]!.push(update) } }, signal: new AbortController().signal, deadline: Date.now() + 10_000, run: (meta) => { metadata[index] = meta; return f.request(meta) } })
    const first = run(0)
    const second = run(1)
    await ready
    callbacks[1]!.progress({ id: f.id, phase: "download", sequence: 999, receivedBytes: 2, totalBytes: 4 })
    callbacks[0]!.progress({ id: f.id, phase: "verify", sequence: 999 })
    callbacks.forEach((entry) => entry.finish())
    expect(await Promise.all([first, second])).toEqual([{ ok: false, error: "network" }, { ok: false, error: "network" }])
    expect(metadata[0]!["codepuppy/pinned-files.call"]).not.toBe(metadata[1]!["codepuppy/pinned-files.call"])
    expect(updates).toEqual([[{ id: f.id, phase: "verify", sequence: 1 }], [{ id: f.id, phase: "download", sequence: 1, receivedBytes: 2, totalBytes: 4 }]])
    callbacks[0]!.progress({ id: f.id, phase: "ready", sequence: 1000 })
    expect(updates[0]).toHaveLength(1)
    expect(callbacks.every((entry) => entry.signal.aborted)).toBe(true)
  } finally { await f.close() }
})

test("refuted managed tools and ordinary calls get no pinned correlation", async () => {
  const f = await pinnedFilesPeers(async () => { throw Error("must not reach host") })
  try {
    f.pinned.listed(f.tools)
    const ordinary = await f.pinned.withCall({ signal: new AbortController().signal, deadline: Date.now() + 10_000, run: async (meta) => meta })
    expect(ordinary).toEqual({})
    f.pinned.listed([{ ...f.tools[0]!, description: "changed" }])
    f.pinned.listed(f.tools)
    const refuted = await f.pinned.withCall({ preparation: { callID: Tool.CallID.make("owned-refuted"), report: async () => {} }, signal: new AbortController().signal, deadline: Date.now() + 10_000, run: async (meta) => meta })
    expect(refuted).toEqual({})
    await expect(f.request({})).rejects.toMatchObject({ code: -32600 })
  } finally { await f.close() }
})

test("managed pinned waiters cancel with their original call and reject late progress", async () => {
  let entered: () => void = () => {}
  const ready = new Promise<void>((resolve) => { entered = resolve })
  let hostSignal: AbortSignal | undefined
  let late: (() => void) | undefined
  const updates: PinnedPreparationProgress[] = []
  const f = await pinnedFilesPeers((_input, signal, progress) => new Promise((resolve) => {
    hostSignal = signal
    late = () => progress({ id: f.id, phase: "ready", sequence: 99 })
    signal.addEventListener("abort", () => resolve({ ok: false, error: "cancelled" }), { once: true })
    entered()
  }))
  try {
    f.pinned.listed(f.tools)
    const cancellation = new AbortController()
    const call = f.pinned.withCall({ preparation: { callID: Tool.CallID.make("owned-cancel"), report: async (update) => { updates.push(update) } }, signal: cancellation.signal, deadline: Date.now() + 10_000, run: (meta) => f.request(meta) })
    await ready
    cancellation.abort()
    expect(await call).toEqual({ ok: false, error: "cancelled" })
    expect(hostSignal?.aborted).toBe(true)
    late?.()
    expect(updates).toEqual([])
  } finally { await f.close() }
})

// Integration, affected PR/nightly: actual connection constructs the binding, real stdio/SDK
// sends the nested request. Host is the frozen port, not the #1759-dependent app root.
test("production MCP connection registers pinned requests only for its verified managed context", async () => {
  const id = "speech-model/any/own-production-fixture" as const
  const tools = [{ name: "echo", description: "echo", inputSchema: { type: "object" as const, properties: { text: { type: "string" } } } }]
  const calls: unknown[] = []
  const updates: PinnedPreparationProgress[] = []
  const snapshots: LaunchSnapshot[] = []
  const config = local({}, { protocol: "legacy" })
  const launchers: LauncherEnvironment = { platform: "darwin-arm64", pinSet: "a".repeat(64), uv: path.join(ROOT, "uv"), uvx: path.join(ROOT, "uvx"), node: process.execPath, npmCli: path.join(ROOT, "npm.js"), npxCli: path.join(ROOT, "npx.js"), runtimeRoot: path.join(ROOT, "runtime"), pythonFileId: "python/darwin-arm64/3.12.16-20261124", packageManagerEnv: {}, environment: {}, firstPartyCacheRoots: {} }
  const declaration = { tools, recipe: [{ id, archive: "file" as const, entry: "model", required: ["model"] }], declarationSha256: "a".repeat(64), recipeSha256: "b".repeat(64) }
  const unused = async (): Promise<never> => { throw Error("unused host port") }
  const host: ConnectorLaunchHost = {
    ensureFile: unused,
    changed: (snapshot) => { snapshots.push(structuredClone(snapshot)) },
    runtimeDependencies: async () => ({ runtimeDep: [], executables: {}, missing: [] }),
    beginEgress: unused, egressEvidence: unused, endEgress() {}, resolveAssets: async () => launchers,
    prepareFiles: async (input, signal, progress) => {
      calls.push(input)
      expect(signal.aborted).toBe(false)
      progress({ id, phase: "ready", sequence: 500 })
      return { ok: true, files: [{ id, path: "/owned/production-model" }] }
    },
  }
  // The publication contract remains once per process. This is still the only publisher.
  publishConnectorLaunchHost(host)
  const output = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const environment = yield* Environment.Service
    const scope = yield* Effect.scope
    const connection = McpConnection.make({
      name: "own", config, directory: ROOT, environment, scope, fetch: globalThis.fetch,
      authProvider: Effect.succeed(undefined), elicitation: { create: () => Effect.die("unused"), complete: () => Effect.void },
      lock: (effect) => effect, callbacks: (effect) => Effect.runFork(effect), fork: (effect) => Effect.runFork(effect),
      localLaunch: { sidecarGeneration: "owned-generation", runtimeRoot: launchers.runtimeRoot, secrets: [], host, firstParty: { launchers, declaration } },
      events: { connecting: Effect.void, connected: Effect.void, failed: () => Effect.die("must connect"), settled: Effect.void, closed: () => Effect.void, changed: () => Effect.void },
    })
    expect(calls).toEqual([])
    yield* connection.start
    expect(connection.client).toBeDefined()
    expect(calls).toEqual([])
    const callContext = yield* Effect.context()
    return yield* connection.client!.callTool({ name: "echo", args: { ensure_pin: id }, preparation: { callID: Tool.CallID.make("owned-production-call"), report: (update) => Effect.runPromiseWith(callContext)(Effect.sync(() => { updates.push(update) })) } })
  })).pipe(Effect.provide(hostEnvironmentLayer)))
  expect(output.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true, files: [{ id, path: "/owned/production-model" }] }) }])
  expect(snapshots.map((row) => row.state.phase)).toEqual(["preparing", "connecting", "connected"])
  expect(calls).toEqual([{ binding: { identity: snapshots[0]!.identity, sidecarGeneration: "owned-generation", entry: { type: "local", command: config.command, environment: config.environment, cwd: config.cwd }, declarationSha256: declaration.declarationSha256, recipeSha256: declaration.recipeSha256 }, ids: [id] }])
  expect(updates).toEqual([{ id, phase: "ready", sequence: 1 }])
})

test("ordinary MCP client exposes no managed pinned-file request handler", async () => {
  const server = new Server({ name: "owned-ordinary-server", version: "1" }, { capabilities: { tools: {} } })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await server.connect(right)
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      yield* McpClient.connect({ server: "ordinary", directory: ROOT, config: { type: "attached", transport: left } })
      yield* Effect.promise(async () => {
        await expect(server.request({ method: "codepuppy/pinned-files.ensure", params: { ids: ["speech-model/any/owned-fixture"] } }, fromJsonSchema({ type: "object" }))).rejects.toMatchObject({ code: -32601 })
      })
    })).pipe(Effect.provide(hostEnvironmentLayer)))
  } finally { await server.close() }
})
