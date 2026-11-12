// `#1411` / `#1443`(REQ-1414、ADR-046 D1)在 OpenCode 2 上(`#1662` parity 第 9 项的合成判据;v1 的 server.test.ts `#1411` 一组
// 随换代退役):**真 fork env → 引擎这一刻交给模型的工具表**,按账户态合成来判,不手写任何一条规则。
//   · 登录代付:本地 `websearch` 与云端 web search 都在;
//   · 登出 / BYOK:只有本地 `websearch`,云端那条不在;
//   · kill-switch:两条都不在。
// 期望取自 ADR-046 D1 与 `#1411` 的退出条件,不从被测代码派生。
//
// 供数方全是生产的:main 的 `spawnLocalServer`(假 fork,记下它交给 sidecar 的 env;`applyWebSearchSovereignty` 与 `syncSecretFiles`
// 都在里面跑)→ 那份 env 里 Code Puppy 自己的键原样放进本进程(sidecar 里就是这份 env)→ 生产 `injectCodePuppyConfig` → 嵌入式引擎 +
// 真 ext(test-component/codepuppy-engine.ts)→ 模型桩记下第一次模型请求。本地腿看直连工具表;云端那条是 MCP 工具,2.x 默认进 Code Mode,
// 看这次请求里交给模型的 Code Mode 目录(云 server 的工具出现在请求里 = 模型拿得到)。云 MCP 端点是本机的 streamable-HTTP 桩,列的是
// 平台 vendored 的真实工具名(fixtures/cloud-mcp-tools)。登录信封里的令牌都是合成值;钥匙串后端与 electron 一律 mock,不碰真机。
// 已知的坏:kill-switch 下去掉注入写的那两条 deny(websearch / 云端 web search)⇒ 两条都回到工具表(判据确实能红)。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { mockElectron } from "../../test-component/electron-mock"

const sandbox = engineSandbox()

// ── main 的 fork 路径(同 server.test.ts 的 mock:electron、日志、设置存储、钥匙串后端)───────────────
class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  postMessage(message: { type: string }) {
    if (message.type === "start") queueMicrotask(() => this.emit("message", { type: "ready" }))
    if (message.type === "stop") queueMicrotask(() => this.emit("exit", 0))
  }
  kill() {
    queueMicrotask(() => this.emit("exit", 0))
  }
}
let userDataPath = ""
const forkCalls: Array<{ options: Record<string, unknown> }> = []
mockElectron(() => ({
  app: { isPackaged: false, on: () => {}, off: () => {}, getPath: () => userDataPath },
  utilityProcess: { fork: () => { throw new Error("unexpected utilityProcess.fork") } },
  BrowserWindow: class {},
  dialog: {},
  ipcMain: { handle: () => {} },
}))
mock.module("./logging", () => ({ getLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} }), write: () => {}, rotateServerLogs: () => {} }))
mock.module("./store", () => ({ getStore: () => ({ get: () => null, set: () => {}, delete: () => {} }) }))
mock.module("./codepuppy-keychain-backend", () => ({
  keychainBackend: () => ({ isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value, "utf8"), decryptString: (value: Buffer) => value.toString("utf8") }),
}))
const { spawnLocalServer } = await import("./server")
const { creditDanglingSweepForSpawn, resetDanglingSweepLatchForTests } = await import("./dangling-sweep-latch")
const { CLOUD_MCP_TOOLS } = await import("./fixtures/cloud-mcp-tools")
const { CLOUD_WEB_SEARCH_REMOTE_TOOL } = await import("./cloud-web-search")
const { codepuppyEngine, scriptedModel, textOf } = await import("../../test-component/codepuppy-engine")
const fakeFork = ((_file: string, _args: string[], options: Record<string, unknown>) => (forkCalls.push({ options }), new FakeChild())) as never
const fakePlanFence = () => ({ profile: "(version 1)\n(allow default)\n(deny file-write*)\n", addonPath: "/nonexistent/codepuppy_fence.node" })

// ── 云 MCP 端点(本机 streamable-HTTP 桩)与模型桩 ─────────────────────────────────────────────────
const cloud = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (request.method === "GET") return new Response(null, { status: 405 })
    if (request.method !== "POST") return new Response(null, { status: 200 })
    const message = (await request.json()) as { id?: number; method?: string; params?: { protocolVersion?: string } }
    if (message.id === undefined) return new Response(null, { status: 202 })
    const result =
      message.method === "initialize"
        ? { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-cloud", version: "1" } }
        : message.method === "tools/list"
          ? { tools: CLOUD_MCP_TOOLS.map((name) => ({ name, description: name, inputSchema: { type: "object", properties: {} } })) }
          : {}
    return Response.json({ jsonrpc: "2.0", id: message.id, result })
  },
})
const model = scriptedModel()
const CODEPUPPY_KEYS = /^CODEPUPPY_/

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(() => {
  cloud.stop(true)
  model.stop()
})

type State = "paying" | "logged-out" | "kill-switch"

/** 这个账户态下:main 真 fork 一次,拿它交给 sidecar 的 env;再在这份 env 下起引擎,看模型第一次请求拿到的工具。 */
async function toolTable(state: State, name: string, mutate?: (content: Record<string, any>) => void) {
  userDataPath = path.join(sandbox.root, `${name}-userdata`)
  for (const key of Object.keys(process.env)) if (CODEPUPPY_KEYS.test(key)) delete process.env[key]
  process.env.CODEPUPPY_GLOBAL_DIR = path.join(sandbox.root, `${name}-state`, "codepuppy-state", "env", "dev")
  process.env.SHELL = "nu" // 跳过登录 shell 探测(同 server.test.ts)
  process.env.CODEPUPPY_SECRETS_DISABLE = "1" // 不读任何 codepuppy.env(同 server.test.ts)
  if (state !== "logged-out") {
    // 登录信封落下的三样(main 的 applyAuthEnv;令牌是合成值)
    process.env.CODEPUPPY_CLOUD_MCP_URL = `http://127.0.0.1:${cloud.port}/mcp`
    process.env.CODEPUPPY_CLOUD_TOKEN = `synthetic-cloud-${name}`
    process.env.CODEPUPPY_MCP_TOKEN = `synthetic-mcp-${name}`
  }
  if (state === "kill-switch") process.env.CODEPUPPY_WEBSEARCH_DISABLE = "1"
  resetDanglingSweepLatchForTests()
  creditDanglingSweepForSpawn()
  forkCalls.length = 0
  const spawned = await spawnLocalServer("127.0.0.1", 4096, "password", { userDataPath, healthCheck: async () => true, planFence: fakePlanFence, fork: fakeFork })
  await spawned.health.wait
  await spawned.listener.stop()
  const forkEnv = (forkCalls.at(-1)?.options.env ?? {}) as Record<string, string | undefined>
  // sidecar 里就是这份 env:Code Puppy 自己的键原样放进来(HOME / XDG 由沙箱接管,不跟着 fork env 走)
  for (const key of Object.keys(process.env)) if (CODEPUPPY_KEYS.test(key)) delete process.env[key]
  for (const [key, value] of Object.entries(forkEnv)) if (CODEPUPPY_KEYS.test(key) && value !== undefined) process.env[key] = value

  const host = codepuppyEngine({ sandbox, name, modelBaseURL: model.baseURL })
  mutate?.(host.content as Record<string, any>)
  const engine = await host.start()
  try {
    if (state !== "logged-out")
      for (let i = 0; i < 200; i++) {
        const server = (((await engine.send("GET", "/api/mcp")).json?.data ?? []) as Array<{ name: string; status: { status: string } }>).find((item) => item.name === "codepuppy")
        if (!server || !["pending", "connecting"].includes(server.status.status)) break
        await Bun.sleep(50)
      }
    const before = model.requests.length
    const sessionID = (await engine.send("POST", "/api/session", { location: { directory: host.projectDirectory }, model: { id: "m", providerID: "codepuppy" } })).json.data.id as string
    await engine.send("POST", `/api/session/${sessionID}/prompt`, { text: "hello" })
    await engine.send("POST", `/api/experimental/session/${sessionID}/wait`)
    const request = model.requests.slice(before).toSorted((a, b) => b.tools.length - a.tools.length)[0]!
    const seen = request.messages.map((message) => textOf(message.content)).join("\n")
    return {
      local: request.tools.includes("websearch"),
      // 云 server 的 web_search 进了这次请求里交给模型的 Code Mode 目录(以云 server 的命名空间点名)
      cloud: new RegExp(`codepuppy[._]${CLOUD_WEB_SEARCH_REMOTE_TOOL}\\b`).test(seen),
      cloudServer: new RegExp(`codepuppy[._](?!${CLOUD_WEB_SEARCH_REMOTE_TOOL}\\b)[a-z_]+`).test(seen),
    }
  } finally {
    await engine.close()
  }
}

describe("#1411 / #1443:真 fork env 下,引擎这一刻交给模型的 web search 工具", () => {
  test("登录代付 ⇒ 本地 websearch 与云端 web search 都在", async () => {
    const table = await toolTable("paying", "table-paying")
    expect(table).toEqual({ local: true, cloud: true, cloudServer: true })
  }, 90_000)

  test("登出 / BYOK ⇒ 只有本地 websearch,云 server 整条不在", async () => {
    const table = await toolTable("logged-out", "table-logged-out")
    expect(table).toEqual({ local: true, cloud: false, cloudServer: false })
  }, 90_000)

  test("kill-switch ⇒ 本地与云端两条 web search 都不在(云 server 的其它工具照常)", async () => {
    const table = await toolTable("kill-switch", "table-kill")
    // 云 server 本身连着、别的工具还在 —— 云端那条「不在」不是因为云 server 根本没连上
    expect(table).toEqual({ local: false, cloud: false, cloudServer: true })
  }, 90_000)

  test("已知的坏:kill-switch 下去掉注入写的 web search deny ⇒ 本地与云端两条 web search 都回到工具表", async () => {
    const strip = (rules: unknown) => (Array.isArray(rules) ? rules.filter((rule: { action?: string; effect?: string }) => !(rule.effect === "deny" && /web_search|websearch/.test(String(rule.action)))) : rules)
    const table = await toolTable("kill-switch", "table-kill-stripped", (content) => {
      content.permissions = strip(content.permissions)
      for (const agent of Object.values(content.agents ?? {}) as Array<{ permissions?: unknown }>) agent.permissions = strip(agent.permissions)
    })
    expect([table.local, table.cloud]).toEqual([true, true])
  }, 90_000)
})
