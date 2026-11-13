// `#1669`(独立审计 UNKNOWN):冻结界面每个服务器上下文只判一次协议 —— `server-sdk.tsx` 建上下文时
// `const protocol = detectServerProtocol(server.http, platform.fetch)`(之后不再重判;`context/global.tsx` 按服务器 key 缓存上下文,
// 服务器还在列表里就一直是它)。判法(`utils/server-protocol.ts`):先探 `/global/health`(答 `healthy: true` ⇒ v1),探不通再探
// `/api/health`(带 `pid` ⇒ v2、`healthy: true` ⇒ v1),**都不成立 ⇒ v2**。v2 的事件流走 `/api/event`、审批与提问清单走
// `/api/permission/request` 等 —— 适配器只说 v1,这些一律 501(routes.ts UNSUPPORTED)。所以首探 `/global/health` 一旦失败一次,
// 界面在这个上下文里就再也收不到事件。
//
// 判据在真入口上:冻结 app 的 detectServerProtocol 与 server-sdk 事件循环里按协议选订阅的那两支(v1 `eventSdk.global.event`、
// v2 `eventApi.event.subscribe`,server-sdk.tsx 的 start())→ 生产 createEngineFetch → 真监听端口的嵌入式 OpenCode 2
// (生产注入 + 真 ext,test-component/codepuppy-engine.ts)。故障注在适配器的出网 fetch 上:适配器答 `/global/health` 要问引擎
// `GET /api/info`,第一次这样的请求失败(传输错误)或挂到调用方的期限(冻结探针 5 秒),之后照常。
// 已知的坏(2026-11-13 实跑,适配器还没有 `/api/health`):两条都判 v2,v2 那支订阅回 501(`UnexpectedStatus: 501`),
// 同一时刻再判一次却是 v1 —— 界面停在 v2,直到重开窗口。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录;凭据是合成的。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { detectServerProtocol } from "../../../codepuppy-app/src/utils/server-protocol"
import { createApiForServer, createSdkForServer } from "../../../codepuppy-app/src/utils/server"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { createEngineFetch } from "./index"

const sandbox = engineSandbox()
const model = scriptedModel()
let running: Running

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  running = await codepuppyEngine({ sandbox, name: "protocol", modelBaseURL: model.baseURL }).start()
}, 60_000)

afterAll(async () => {
  await running?.close().catch(() => undefined)
  model.stop()
})

type Fault = "error" | "timeout"

/**
 * 界面经的那条路:生产适配器接在真引擎的监听端口上(口令补法同 main 的 onBeforeSendHeaders)。适配器问引擎 `GET /api/info`
 * 的**第一次**按 fault 失败:`error` = 传输错误(fetch 抛 TypeError);`timeout` = 不答,直到这次请求被取消(冻结探针 5 秒的期限)。
 */
function faultyUi(fault: Fault) {
  const origin = new URL(running.url).origin
  let faulted = false
  const upstream = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    request.headers.set("authorization", running.authorization)
    const path = new URL(request.url).pathname
    if (!faulted && path === "/api/info") {
      faulted = true
      if (fault === "error") throw new TypeError("fetch failed")
      await new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true }))
    }
    return fetch(request)
  }) as typeof fetch
  const engineFetch = createEngineFetch({ isEngineOrigin: (candidate) => candidate === origin, fetch: upstream })
  // 冻结探针只看状态码:记下每次 `/global/health` 的结果,证明故障确实落在了首探上。
  const health: Array<number | string> = []
  const platformFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname
    try {
      const response = await engineFetch(input, init)
      if (path === "/global/health") health.push(response.status)
      return response
    } catch (error) {
      if (path === "/global/health") health.push(error instanceof Error ? error.name : String(error))
      throw error
    }
  }) as typeof fetch
  return { server: { url: origin }, platformFetch, health, faulted: () => faulted }
}

/** server-sdk.tsx start() 里按协议选订阅的那两支,原样;返回第一个事件的类型。 */
async function firstEvent(kind: "v1" | "v2", server: { url: string }, platformFetch: typeof fetch) {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(new Error("no event within 5 s")), 5_000)
  try {
    const events =
      kind === "v1"
        ? (await createSdkForServer({ server, fetch: platformFetch }).global.event({ signal: abort.signal })).stream
        : createApiForServer({ server, fetch: platformFetch }).event.subscribe({ signal: abort.signal })
    for await (const event of events as AsyncIterable<{ payload?: { type: string }; type?: string }>) return event.payload?.type ?? event.type
  } finally {
    clearTimeout(timer)
    abort.abort()
  }
}

describe("`#1669` 首探 /global/health 失败一次,冻结界面的协议判定仍是 v1、事件照常到达", () => {
  for (const fault of ["error", "timeout"] as const)
    test(`首探${fault === "error" ? "传输报错" : "超过冻结探针的 5 秒期限"} ⇒ 判 v1,v1 事件流收到 server.connected`, async () => {
      const ui = faultyUi(fault)
      const kind = await detectServerProtocol(ui.server, ui.platformFetch)
      expect(ui.faulted()).toBe(true)
      expect(ui.health[0]).not.toBe(200)
      expect(kind).toBe("v1")
      expect(await firstEvent(kind, ui.server, ui.platformFetch)).toBe("server.connected")
    }, 30_000)
})
