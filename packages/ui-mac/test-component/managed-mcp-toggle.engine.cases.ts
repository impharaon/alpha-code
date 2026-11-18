// I-11 方案 A(alpha-code#1724;DESIGN-plugin-helper-and-hub v9 §4.4 / §5「MCP 组件开关」)的真引擎证明。
// 宿主:嵌进 sidecar 的那台 OpenCode 2,配置是生产 `injectCodePuppyConfig` 的产物(内联文档 + 显式文件),装着真 ext
// (test-component/codepuppy-engine.ts)。本机 MCP 是 core 的真 stdio 夹具(codepuppy-mcp-startup-stdio.ts,每次 tools/call
// 记一行);远程 MCP 是 core 的 `echoMcpHandler` 挂在本机一个真监听上。开关只走生产的持久写(setInstallStateByKey)与
// main 的唯一运行时入口 convergeManagedMcp;引擎状态一律经引擎自己的路由读回。
// 本文件由 src/main/managed-mcp-toggle.engine.test.ts 起独立子进程跑。
import { afterAll, beforeAll, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "./engine-sandbox"
import { codepuppyEngine, MCP_FIXTURE, probeSetups, scriptedModel, type Running } from "./codepuppy-engine"
import { echoMcpHandler } from "../../core/test/fixture/mcp-echo"
import { findRecordV2, skillsEnabledPath, upsertRecordV2 } from "../src/main/ext-receipt-v2"
import { setInstallStateByKey } from "../src/main/ext-install-planner"
import { writeMcpServerTruth } from "../src/main/mcp-server-truth-write"
import { createManagedMcpConvergence } from "../src/main/package-mcp-activation"
import { tryAcquireBundleLock } from "../src/main/ext-bundle-lock"
import { WORKSPACE_MARKER } from "../src/shared/office-advisories"
import type { EngineConnection } from "../src/main/engine-authorization"

const sandbox = engineSandbox()
const model = scriptedModel()
const engines: Running[] = []
const echo = echoMcpHandler()
let remoteRequests = 0
const remote = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    remoteRequests++
    return echo.fetch(request)
  },
})

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  for (const engine of engines) await engine.close().catch(() => undefined)
  model.stop()
  remote.stop(true)
  await echo.close()
})

type Listed = { name: string; status: { status: string } }

/** 一台机器:账本记录在引擎启动之前就位(启动注入读的就是它们),codepuppy.jsonc 放本机定义,真源放远程定义。 */
async function machine(
  name: string,
  options: { local?: Record<string, "enabled" | "disabled">; remote?: Record<string, "enabled" | "disabled">; unmanagedProbe?: boolean },
) {
  const stateRoot = path.join(sandbox.root, `${name}-state`, "codepuppy-state")
  const root = path.join(stateRoot, "env", "dev")
  fs.mkdirSync(root, { recursive: true })
  const calls = path.join(sandbox.root, `${name}-calls.log`)
  const local = Object.keys(options.local ?? {})
  const remotes = Object.keys(options.remote ?? {})
  for (const [server, desiredState] of [...Object.entries(options.local ?? {}), ...Object.entries(options.remote ?? {})]) {
    const written = upsertRecordV2(root, {
      id: `user:${server}`, name: server, kind: "mcp", environment: "dev", scope: { kind: "global" },
      desiredState, origin: "created", configKey: `mcp.${server}`, installedAt: "2026-11-18T00:00:00.000Z",
    })
    if (!written.ok) throw Error(written.reason)
  }
  if (remotes.length)
    writeMcpServerTruth(path.join(stateRoot, "mcp-servers", "dev.json"), remotes.map((server) => ({ name: server, url: `http://127.0.0.1:${remote.port}/${server}/mcp` })), {
      mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, rmSync: fs.rmSync,
    })
  const host = codepuppyEngine({
    sandbox, name, modelBaseURL: model.baseURL,
    ...(options.unmanagedProbe ? { mcpCallLog: path.join(sandbox.root, `${name}-probe-calls.log`) } : {}),
    mcp: Object.fromEntries(local.map((server) => [server, {
      // The Office identity carries the same `{workspace}` marker as its production command; ext's policy replaces it.
      type: "local", command: [process.execPath, MCP_FIXTURE, ...(server.startsWith("codepuppy-") ? [WORKSPACE_MARKER] : [])],
      environment: { CODEPUPPY_MCP_CALL_LOG: calls },
      ...(options.local![server] === "disabled" ? { enabled: false } : {}),
    }])),
  })
  const running = await host.start()
  engines.push(running)
  const connection: EngineConnection = { url: running.url, username: "opencode", password: `cp-${name}` }
  const at = (directory: string) => async (method: string, route: string, body?: unknown) => {
    const response = await running.fetch(new Request(`http://codepuppy-sidecar.invalid${route}`, {
      method,
      headers: { "x-opencode-directory": encodeURIComponent(directory), "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }))
    const raw = await response.text()
    return { status: response.status, json: raw ? JSON.parse(raw) : undefined }
  }
  const project = host.projectDirectory
  const status = async (directory = project) =>
    Object.fromEntries((((await at(directory)("GET", "/api/mcp")).json?.data ?? []) as Listed[]).map((server) => [server.name, server.status.status]))
  const until = async (read: () => Promise<Record<string, string>>, done: (value: Record<string, string>) => boolean, ms = 15000) => {
    let value = await read()
    for (const end = Date.now() + ms; !done(value) && Date.now() < end; await Bun.sleep(100)) value = await read()
    return value
  }
  const sessionIn = async (directory = project, agent?: string) =>
    (await at(directory)("POST", "/api/session", { location: { directory }, model: { id: "m", providerID: "codepuppy" }, ...(agent ? { agent } : {}) })).json.data as { id: string }
  /** 同一会话经 Code Mode 调一次 `<server>.echo`;返回这台机器的本机夹具累计收到的 tools/call 次数。 */
  const callCount = () => (fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").split("\n").filter((line) => line.trim()).length : 0)
  const callEcho = async (sessionID: string, server: string, directory = project) => {
    const send = at(directory)
    await send("POST", `/api/session/${sessionID}/prompt`, { text: `CP-CALL ${JSON.stringify({ name: "execute", args: { code: `return await tools[${JSON.stringify(server)}].echo({ text: "hi" })` } })}` })
    await send("POST", `/api/experimental/session/${sessionID}/wait`)
    return callCount()
  }
  const otherProject = path.join(sandbox.root, `${name}-other-project`)
  fs.mkdirSync(otherProject, { recursive: true })
  const write = (server: string, state: "enabled" | "disabled") => setInstallStateByKey({ type: "mcp", name: server, scope: "global", state }, {
    globalRoot: () => root, advisoryGate: () => ({ allowed: true }), resolveEntry: async () => null,
  })
  const convergence = (through: EngineConnection = connection) =>
    createManagedMcpConvergence({ root: () => root, awaitServer: async () => through, directory: () => project })
  const converge = convergence()
  /** 生产开关:持久写(账本 + 允许集 + codepuppy.jsonc 投影),再交 main 的唯一运行时入口(与 ext-ipc 同一顺序)。 */
  const toggle = async (server: string, state: "enabled" | "disabled") => {
    expect(await write(server, state)).toMatchObject({ ok: true })
    expect(findRecordV2(root, "mcp", server)?.desiredState).toBe(state)
    await converge([server])
  }
  return { root, project, otherProject, connection, running, at, status, until, sessionIn, callCount, callEcho, write, convergence, converge, toggle }
}

test("proof 1: a connector disabled at startup and enabled at runtime stays enabled after a Location rebuild and in another project", async () => {
  const m = await machine("startup-off", { local: { late: "disabled" } })
  expect((await m.until(() => m.status(), (s) => s.late !== undefined && s.late !== "pending")).late).toBe("disabled")
  const session = await m.sessionIn()
  await m.toggle("late", "enabled")
  expect((await m.until(() => m.status(), (s) => s.late === "connected")).late).toBe("connected")
  expect(await m.callEcho(session.id, "late")).toBe(1)
  expect([200, 204]).toContain((await m.at(m.project)("POST", "/api/location/reload", {})).status)
  expect((await m.until(() => m.status(), (s) => s.late === "connected", 8000)).late).toBe("connected")
  await m.sessionIn(m.otherProject)
  expect((await m.until(() => m.status(m.otherProject), (s) => s.late === "connected", 8000)).late).toBe("connected")
}, 90_000)

test("proof 2: a remote connector record disabled at runtime stays disabled after a Location rebuild and in a new Location", async () => {
  const m = await machine("remote-off", { remote: { "remote-echo": "enabled" } })
  expect((await m.until(() => m.status(), (s) => s["remote-echo"] === "connected"))["remote-echo"]).toBe("connected")
  await m.toggle("remote-echo", "disabled")
  expect((await m.until(() => m.status(), (s) => s["remote-echo"] === "disabled"))["remote-echo"]).toBe("disabled")
  expect([200, 204]).toContain((await m.at(m.project)("POST", "/api/location/reload", {})).status)
  await Bun.sleep(1500)
  const requests = remoteRequests
  expect((await m.until(() => m.status(), (s) => s["remote-echo"] === "connected", 5000))["remote-echo"]).toBe("disabled")
  await m.sessionIn(m.otherProject)
  expect((await m.until(() => m.status(m.otherProject), (s) => s["remote-echo"] === "connected", 5000))["remote-echo"]).toBe("disabled")
  expect(remoteRequests).toBe(requests)
}, 90_000)

test("proof 9: enable then disable of the same connector while the enable's add is held ends disabled, matching the ledger", async () => {
  const m = await machine("held-add", { local: { slow: "disabled" } })
  expect((await m.until(() => m.status(), (s) => s.slow !== undefined && s.slow !== "pending")).slow).toBe("disabled")
  // A real TCP hop in front of the engine: only the enable's PUT of this server waits until released.
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  let held = 0
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (request.method === "PUT" && url.pathname === "/api/experimental/mcp/slow") {
        held++
        await released
      }
      const target = new URL(url.pathname + url.search, m.connection.url)
      return fetch(new Request(target, { method: request.method, headers: request.headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer() }))
    },
  })
  try {
    const converge = m.convergence({ ...m.connection, url: `http://127.0.0.1:${proxy.port}` })
    expect(await m.write("slow", "enabled")).toMatchObject({ ok: true })
    const enabling = converge(["slow"])
    for (let i = 0; i < 200 && held === 0; i++) await Bun.sleep(25)
    expect(held).toBe(1)
    expect(await m.write("slow", "disabled")).toMatchObject({ ok: true })
    const disabling = converge(["slow"])
    await Bun.sleep(300)
    release()
    await Promise.all([enabling, disabling])
    await Bun.sleep(500)
    expect(findRecordV2(m.root, "mcp", "slow")?.desiredState).toBe("disabled")
    expect((await m.status()).slow).toBe("disabled")
  } finally {
    release()
    proxy.stop(true)
  }
}, 90_000)

test("proof 3: toggling a connector off rejects only its own pending approval; another session's approval and answer go on, with no Location reload", async () => {
  const m = await machine("approvals", { local: { alpha: "enabled", beta: "enabled" } })
  expect(await m.until(() => m.status(), (s) => s.alpha === "connected" && s.beta === "connected")).toMatchObject({ alpha: "connected", beta: "connected" })
  const send = m.at(m.project)
  type Pending = { id: string; action: string }
  const pendingOf = async (sessionID: string) => ((await send("GET", `/api/session/${sessionID}/permission`)).json?.data ?? []) as Pending[]
  const waitPending = async (sessionID: string) => {
    for (const end = Date.now() + 8000; Date.now() < end; await Bun.sleep(25)) {
      const list = await pendingOf(sessionID)
      if (list.length) return list
    }
    return []
  }
  const ask = async (server: string) => {
    const session = await m.sessionIn(m.project, "codepuppy-ask")
    await send("POST", `/api/session/${session.id}/prompt`, { text: `CP-CALL ${JSON.stringify({ name: "execute", args: { code: `return await tools[${JSON.stringify(server)}].echo({ text: "hi" })` } })}` })
    const pending = await waitPending(session.id)
    expect(pending.map((request) => request.action)).toEqual([`mcp:${server}:echo`])
    return { session, request: pending[0]! }
  }
  const a = await ask("alpha")
  const b = await ask("beta")
  const setups = probeSetups()
  // A refused durable write still requests convergence; the projection did not change, so nothing is rejected.
  const held = tryAcquireBundleLock(m.root, { txId: "proof-3-busy-ledger" })
  if (!held.ok) throw Error(held.reason)
  try {
    expect((await m.write("beta", "disabled")).ok).toBe(false)
  } finally {
    held.lock.release()
  }
  await m.converge(["beta"])
  expect((await pendingOf(b.session.id)).map((request) => request.id)).toEqual([b.request.id])
  await m.toggle("beta", "disabled")
  expect(await pendingOf(b.session.id)).toEqual([])
  expect((await pendingOf(a.session.id)).map((request) => request.id)).toEqual([a.request.id])
  expect((await m.status()).beta).toBe("disabled")
  expect(m.callCount()).toBe(0)
  expect((await send("POST", `/api/session/${a.session.id}/permission/${a.request.id}/reply`, { decision: "once" })).status).toBe(204)
  await send("POST", `/api/experimental/session/${a.session.id}/wait`)
  // A's answer went on: its approved call reached alpha (the only server call in this machine) and the turn succeeded.
  expect(m.callCount()).toBe(1)
  const transcript = JSON.stringify((await send("GET", `/api/session/${a.session.id}/message`)).json)
  expect(transcript).toContain('"tool":"alpha.echo","status":"completed"')
  expect(transcript).toContain('"outcome":"succeeded"')
  expect(probeSetups()).toBe(setups)
}, 120_000)

test("proof 4 (Office identity): codepuppy-pdf off at startup, on at runtime and callable, off again and unreachable from the same session, with no Location reload", async () => {
  const m = await machine("office", { local: { "codepuppy-pdf": "disabled" } })
  expect((await m.until(() => m.status(), (s) => s["codepuppy-pdf"] !== undefined && s["codepuppy-pdf"] !== "pending"))["codepuppy-pdf"]).toBe("disabled")
  const session = await m.sessionIn()
  const setups = probeSetups()
  await m.toggle("codepuppy-pdf", "enabled")
  expect((await m.until(() => m.status(), (s) => s["codepuppy-pdf"] === "connected"))["codepuppy-pdf"]).toBe("connected")
  expect(await m.callEcho(session.id, "codepuppy-pdf")).toBe(1)
  await m.toggle("codepuppy-pdf", "disabled")
  expect((await m.until(() => m.status(), (s) => s["codepuppy-pdf"] === "disabled"))["codepuppy-pdf"]).toBe("disabled")
  expect(await m.callEcho(session.id, "codepuppy-pdf")).toBe(1)
  expect(probeSetups()).toBe(setups)
}, 90_000)

test("proof 5 (engine): with an unreadable allow-set a new Location starts every managed and unmanaged MCP disabled", async () => {
  const m = await machine("unreadable", { local: { late: "enabled" }, unmanagedProbe: true })
  expect(await m.until(() => m.status(), (s) => s.late === "connected" && s.probe === "connected")).toMatchObject({ late: "connected", probe: "connected" })
  fs.writeFileSync(skillsEnabledPath(m.root), "{ not json")
  await m.sessionIn(m.otherProject)
  const later = await m.until(() => m.status(m.otherProject), (s) => s.late !== undefined && s.probe !== undefined && s.late !== "pending" && s.probe !== "pending")
  expect(later).toMatchObject({ late: "disabled", probe: "disabled" })
}, 90_000)

// Codex R1 #1(I-11):用户先答了那张审批,main 的拒绝随即落到引擎「已答」路径而失败 —— 收敛不能因此停下,断开照常。
// 远程记录没有 codepuppy.jsonc 叶子,没有配置刷新兜底:漏了这次断开就是「持久为关、连接仍开」。
test("R1 #1: an approval the user answered first does not stop the disconnect of a remote connector", async () => {
  const m = await machine("answered-first", { remote: { "remote-echo": "enabled" } })
  expect((await m.until(() => m.status(), (s) => s["remote-echo"] === "connected"))["remote-echo"]).toBe("connected")
  const send = m.at(m.project)
  const session = await m.sessionIn(m.project, "codepuppy-ask")
  await send("POST", `/api/session/${session.id}/prompt`, { text: `CP-CALL ${JSON.stringify({ name: "execute", args: { code: 'return await tools["remote-echo"].echo({})' } })}` })
  let pending: Array<{ id: string; action: string }> = []
  for (const end = Date.now() + 8000; !pending.length && Date.now() < end; await Bun.sleep(25))
    pending = ((await send("GET", `/api/session/${session.id}/permission`)).json?.data ?? []) as typeof pending
  expect(pending.map((request) => request.action)).toEqual(["mcp:remote-echo:echo"])
  // A real TCP hop in front of the engine: right before main's reject arrives, the user answers the same request.
  let answeredFirst = 0
  let rejectStatus = 0
  // fetch has already decoded the body; pass it on without the engine's encoding headers.
  const relay = async (response: Response) => {
    const headers = new Headers(response.headers)
    headers.delete("content-encoding")
    headers.delete("content-length")
    return new Response(await response.arrayBuffer(), { status: response.status, headers })
  }
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      const target = new URL(url.pathname + url.search, m.connection.url)
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer()
      if (request.method === "POST" && /\/permission\/[^/]+\/reply$/.test(url.pathname)) {
        answeredFirst++
        await fetch(new Request(target, { method: "POST", headers: request.headers, body: JSON.stringify({ decision: "once" }) }))
        const response = await fetch(new Request(target, { method: "POST", headers: request.headers, body }))
        rejectStatus = response.status
        return relay(response)
      }
      return relay(await fetch(new Request(target, { method: request.method, headers: request.headers, body })))
    },
  })
  try {
    expect(await m.write("remote-echo", "disabled")).toMatchObject({ ok: true })
    await m.convergence({ ...m.connection, url: `http://127.0.0.1:${proxy.port}` })(["remote-echo"])
    expect(answeredFirst).toBe(1)
    expect(rejectStatus).toBeGreaterThanOrEqual(400)
    expect((await m.status())["remote-echo"]).toBe("disabled")
  } finally {
    proxy.stop(true)
  }
}, 90_000)
