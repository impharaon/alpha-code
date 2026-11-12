// REQ-236 AC2 / AC3(`#1562`)的云连接器一半在 OpenCode 2 上(`#1662` parity 第 5 项;v1 的
// packages/opencode/test/mcp/codepuppy-cloud-credential-hot.test.ts 随换代删除):Code Puppy 治理的云连接器**每个请求**现读凭据文件,
// 同一身份续期热应用后不重启引擎、不重新连接,同一条连接上的下一个请求就带新凭据。
//
// 宿主:test-component/codepuppy-engine.ts(生产注入 + 真 ext);代付态 —— `CODEPUPPY_CLOUD_MCP_URL` 指向本文件的本机
// streamable-HTTP MCP 端点、登录铸的 `CODEPUPPY_MCP_TOKEN` 文件在场 ⇒ 注入面写出带 `{file:}` 引用的云 MCP 定义,并在 sidecar
// 环境里置 `CODEPUPPY_CLOUD_MCP_SERVER` / `CODEPUPPY_CLOUD_MCP_DEF`。凭据文件由生产 `syncSecretFiles`(fork 时)与
// `applyPlatformCredentialsHot`(续期时)写。端点记下每个请求的方法、JSON-RPC 方法、会话 id 与 Authorization 是哪个合成令牌(用例输出只有判定)。
//
// 端点按 2.x 客户端认的「会话时代」应答(initialize 回 2025-06-18 并发 `Mcp-Session-Id`),所以 2.x 的三条请求路径都在:
// 同一会话上的 POST、独立的 GET / SSE 流(断了由 SDK 重连)、会话过期(404 ⇒ 引擎的 SessionExpiredError ⇒ 重新 initialize)。
// 整个文件**一次都不**经 `/api/experimental/mcp/codepuppy/{disconnect,connect}` 重新连接;同一条连接上的请求由端点经 SSE 流推
// `notifications/tools/list_changed` 触发(引擎随之 POST tools/list)。
//   ① 令牌 A 连上 ⇒ 每个请求(含 GET 流)都带 A;
//   ② 热应用 B(不重启、不重连)⇒ 同一会话上的下一个 POST 带 B,其间没有 initialize;
//   ③ 端点断开 GET 流 ⇒ SDK 在同一会话上重连 GET,带的是 B;
//   ④ 热应用 C,端点让会话过期 ⇒ 同一会话上的那个 POST 收到 404,引擎重新 initialize,新会话上的每个请求都带 C;
//   ⑤ 删掉凭据文件 ⇒ 同一条连接上的下一个请求不出网(端点零请求、没有重新 initialize),引擎记下 401。
// 已知的坏(实测,`#1662` r6):凭据在建连时读一次(把 codepuppy(#1562) 块的读文件改成每条连接只读一次)⇒ ② ③ 带的仍是 A、⑤ 照样出网;
// r3 的那一条(连接不经 governedCredentialFetch ⇒ `{file:}` 只在装配置时解析一次)同样红在 ②。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { applyPlatformCredentialsHot, secretFilePath, syncSecretFiles } from "./codepuppy-secret-files"

const sandbox = engineSandbox()
const model = scriptedModel()
const TOKEN_A = `SENTINEL-CLOUD-MCP-A-${crypto.randomUUID()}`
const TOKEN_B = `SENTINEL-CLOUD-MCP-B-${crypto.randomUUID()}`
const TOKEN_C = `SENTINEL-CLOUD-MCP-C-${crypto.randomUUID()}`
const API_KEY = `SENTINEL-CLOUD-API-${crypto.randomUUID()}`
type Seen = "A" | "B" | "C" | "other" | "none"
type Hit = { method: string; rpc?: string; session?: string; seen: Seen; status: number }
const hits: Hit[] = []

// ── 会话时代的 streamable-HTTP MCP 端点 ────────────────────────────────────────────────────────────
const encoder = new TextEncoder()
let sessions = 0
const expired = new Set<string>()
let stream: { session?: string; controller: ReadableStreamDefaultController<Uint8Array> } | undefined
const seenOf = (authorization: string | null): Seen =>
  authorization === `Bearer ${TOKEN_A}` ? "A" : authorization === `Bearer ${TOKEN_B}` ? "B" : authorization === `Bearer ${TOKEN_C}` ? "C" : authorization ? "other" : "none"
const endpoint = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 0,
  async fetch(request) {
    const seen = seenOf(request.headers.get("authorization"))
    const session = request.headers.get("mcp-session-id") ?? undefined
    const message = request.method === "POST" ? ((await request.json()) as { id?: number | string; method?: string; params?: { protocolVersion?: string } }) : undefined
    const hit: Hit = { method: request.method, rpc: message?.method, session, seen, status: 200 }
    hits.push(hit)
    if (session && expired.has(session)) return (hit.status = 404), new Response("session not found", { status: 404 })
    if (request.method === "DELETE") return new Response(null, { status: 200 })
    if (request.method === "GET") {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          stream = { session, controller }
          controller.enqueue(encoder.encode("retry: 100\n\n"))
        },
      })
      return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })
    }
    if (!message) return new Response(null, { status: 405 })
    if (message.id === undefined) return (hit.status = 202), new Response(null, { status: 202 })
    if (message.method === "initialize") {
      const id = `S${++sessions}`
      return Response.json(
        { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: true } }, serverInfo: { name: "fake-cloud", version: "1" } } },
        { headers: { "mcp-session-id": id } },
      )
    }
    const result = message.method === "tools/list" ? { tools: [] } : {}
    return Response.json({ jsonrpc: "2.0", id: message.id, result })
  },
})
const push = (payload: unknown) => stream!.controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(payload)}\n\n`))
const listChanged = () => push({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })

const userData = path.join(sandbox.root, "cloud-hot-userdata")
let running: Running | undefined
let forked: Set<string>
beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  // fork 时:生产 syncSecretFiles 物化登录铸的云 MCP 令牌 A(和平台凭据),记下 fork 时的凭据集合(server.ts 同形)
  forked = new Set(syncSecretFiles(userData, { CODEPUPPY_MCP_TOKEN: TOKEN_A, CODEPUPPY_API_KEY: API_KEY }).written)
  process.env.CODEPUPPY_CLOUD_MCP_URL = `http://127.0.0.1:${endpoint.port}/mcp`
  running = await codepuppyEngine({ sandbox, name: "cloud-hot", modelBaseURL: model.baseURL }).start()
}, 60_000)
afterAll(async () => {
  await running?.close().catch(() => undefined)
  endpoint.stop(true)
  model.stop()
  delete process.env.CODEPUPPY_CLOUD_MCP_URL
})

const status = async () =>
  (((await running!.send("GET", "/api/mcp")).json?.data ?? []) as Array<{ name: string; status: { status: string; error?: string } }>).find((server) => server.name === "codepuppy")?.status
async function settled() {
  for (let i = 0; i < 200; i++) {
    const current = await status()
    if (current && current.status !== "pending" && current.status !== "connecting") return current
    await Bun.sleep(50)
  }
  return status()
}
/** 等到 `since` 之后出现满足条件的请求;超时 ⇒ undefined。 */
async function waitHit(since: number, match: (hit: Hit) => boolean, ms = 8_000) {
  for (const until = Date.now() + ms; Date.now() < until; await Bun.sleep(25)) {
    const found = hits.slice(since).find(match)
    if (found) return found
  }
  return undefined
}
const initializes = (since: number) => hits.slice(since).filter((hit) => hit.rpc === "initialize")

describe("REQ-236 #1562 云连接器:同一条连接上每个请求现读凭据,续期热应用不重启、不重连", () => {
  let session = ""

  test("① 令牌 A 连上 ⇒ 每个请求(含 GET 流)都带 A", async () => {
    expect((await settled())?.status).toBe("connected")
    const get = await waitHit(0, (hit) => hit.method === "GET")
    expect(get?.session).toBe("S1")
    session = get!.session!
    expect(initializes(0)).toHaveLength(1)
    expect([...new Set(hits.map((hit) => hit.seen))]).toEqual(["A"])
  }, 30_000)

  test("② 热应用 B(不重连)⇒ 同一会话上的下一个 POST 带 B,其间没有 initialize", async () => {
    expect(applyPlatformCredentialsHot(userData, { CODEPUPPY_MCP_TOKEN: TOKEN_B, CODEPUPPY_API_KEY: API_KEY }, forked)).toBe("applied")
    const mark = hits.length
    listChanged()
    const post = await waitHit(mark, (hit) => hit.rpc === "tools/list")
    expect({ session: post?.session, seen: post?.seen }).toEqual({ session, seen: "B" })
    expect(initializes(mark)).toEqual([])
  }, 30_000)

  test("③ 端点断开 GET 流 ⇒ SDK 在同一会话上重连 GET,带 B", async () => {
    const mark = hits.length
    stream!.controller.close()
    const get = await waitHit(mark, (hit) => hit.method === "GET")
    expect({ session: get?.session, seen: get?.seen }).toEqual({ session, seen: "B" })
    expect(initializes(mark)).toEqual([])
  }, 30_000)

  test("④ 热应用 C,会话过期 ⇒ 那个 POST 收到 404,引擎重新 initialize,新会话上的每个请求都带 C", async () => {
    expect(applyPlatformCredentialsHot(userData, { CODEPUPPY_MCP_TOKEN: TOKEN_C, CODEPUPPY_API_KEY: API_KEY }, forked)).toBe("applied")
    const mark = hits.length
    expired.add(session)
    listChanged()
    const rejected = await waitHit(mark, (hit) => hit.status === 404 && hit.method === "POST")
    expect({ session: rejected?.session, seen: rejected?.seen }).toEqual({ session, seen: "C" })
    const init = await waitHit(mark, (hit) => hit.rpc === "initialize")
    expect({ session: init?.session, seen: init?.seen }).toEqual({ session: undefined, seen: "C" })
    expect((await settled())?.status).toBe("connected")
    const fresh = await waitHit(mark, (hit) => hit.method === "GET" && hit.session !== session)
    expect(fresh?.session).toBe(`S${sessions}`)
    session = fresh!.session!
    expect([...new Set(hits.slice(mark).filter((hit) => hit.method !== "DELETE").map((hit) => hit.seen))]).toEqual(["C"])
  }, 30_000)

  test("⑤ 删掉凭据文件 ⇒ 同一条连接上的下一个请求不出网(引擎记下 HTTP 401),不重新 initialize", async () => {
    fs.rmSync(secretFilePath(userData, "CODEPUPPY_MCP_TOKEN"))
    const mark = hits.length
    // 引擎在本进程里,它的日志走 stdout / stderr / console —— 这一步期间全部记下来(照常输出),证明请求确实被发起、在出网前被拒
    const logged: string[] = []
    const restore: Array<() => void> = []
    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream)
      stream.write = ((value: unknown, ...rest: unknown[]) => (logged.push(String(value)), write(value as never, ...(rest as never[])))) as typeof stream.write
      restore.push(() => void (stream.write = write))
    }
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      const original = console[level]
      console[level] = (...args: unknown[]) => (logged.push(args.map((arg) => (typeof arg === "string" ? arg : Bun.inspect(arg))).join(" ")), original(...args))
      restore.push(() => void (console[level] = original))
    }
    try {
      listChanged()
      for (const until = Date.now() + 8_000; Date.now() < until && !logged.some((line) => /failed to list MCP tools[\s\S]*codepuppy[\s\S]*HTTP 401/.test(line)); ) await Bun.sleep(25)
      await Bun.sleep(300)
    } finally {
      for (const undo of restore.reverse()) undo()
    }
    expect(logged.some((line) => /failed to list MCP tools[\s\S]*codepuppy[\s\S]*HTTP 401/.test(line))).toBe(true)
    expect(hits.slice(mark)).toEqual([])
    expect(logged.some((line) => [TOKEN_A, TOKEN_B, TOKEN_C].some((token) => line.includes(token)))).toBe(false)
  }, 30_000)
})
