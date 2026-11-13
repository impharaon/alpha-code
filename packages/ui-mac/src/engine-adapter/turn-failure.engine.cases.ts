// `#1669` 失败的回合在 OpenCode 2 上要说出原因(打包回归第五轮矩阵外的 FAIL:同一把假 DeepSeek Key,0.1.26 显示「登录或 Key 无效 /
// 重新登录 / 去设置」,2.x 只剩用户气泡;另一例是模型已不可用时继续发送)。
//
// 生产链:嵌进 sidecar 的那台 OpenCode 2(test-component/codepuppy-engine.ts:生产 injectCodePuppyConfig + 真 ext)+ 本机模型桩
// → 生产引擎适配器(createEngineFetch:`POST /session/:id/prompt_async`、`GET /global/event` 投影、`GET /session/:id/message`)
// → 冻结 app 的 event-reducer → 时间线模型 projectTimelineRows(session-timeline.tsx 用的同一个函数)的回合错误行。
// 每种失败判两条入口:事件流(发出后停在会话页)与重新打开会话(从侧栏打开)。行上的 `cause` 决定卡片标题与按钮
// (tool-cards.tsx TURN_ERROR_TITLE / TurnErrorActions;cause → 文案与按钮由 test-component/session-timeline.cases.ts 真 Solid 挂载判)。
//
// 测试只加两样:模型桩(按 `mode` 回各种失败)与一个把重试间隔改成 0 的插件(引擎照常重试 429 / 拒连,只是不等 ~84 秒退避)。
// 桩的应答体:402 两条是 alpha-platform 真实拒绝体(session-timeline.cases.ts 同一份采样);401 的原话取自打包回归引擎记录
// (alpha-code-verify-1669 results/r5-drill-raw.txt:49);引擎按 HTTP 状态分类,应答体只进「开发者详情」。
//
// 已知的坏(2026-11-12 实跑):712cafff27 之前的 v1-shapes.ts / to-session-error.ts ⇒ HTTP 类失败的行是 `UnknownError`、没有原因与
// 状态码(卡片只剩「这轮回复没有完成」),模型不可用与平台凭据读不到没有行(只剩用户气泡),拒连的名字是 `UnknownError`;只去掉
// to-session-error.ts 的 codepuppy(#1669) 块 ⇒ 凭据读不到那条红;withFailedTurns 改成「任一助手消息即关回合」⇒ 两步之间那条红。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { createStore } from "solid-js/store"
import { applyDirectoryEvent } from "../../../codepuppy-app/src/context/global-sync/event-reducer"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, type Running } from "../../test-component/codepuppy-engine"
import { pinAppliedCatalog } from "../main/codepuppy-live-allowlist"
import { secretFilePath } from "../main/codepuppy-secret-files"
import { projectTimelineRows, type TimelineRow } from "../renderer/codepuppy-ui/session-timeline/timeline-model"
import { createEngineFetch } from "./index"
import type { V1Payload } from "./events"

const sandbox = engineSandbox()
const ORIGIN = "http://127.0.0.1:47669"
const BYOK = { providerID: "deepseek-byok", id: "deepseek-flash" }
const PLATFORM = { providerID: "codepuppy", id: "m" }

const BYOK_401 = { error: { message: "Authentication Fails, Your api key: ****-key is invalid", type: "authentication_error", param: null, code: "invalid_request_error" } }
const WALLET_402 = '{"error":{"message":"预授权拒绝: 会员额度已用尽:本期额度窗口的额度已消费完。 [failure_code=account_wallet_insufficient]","code":"account_wallet_insufficient"}}'
const STOPPED_402 = '{"error":{"message":"预授权拒绝: 会员额度已用尽:本期额度窗口的额度已消费完。 [failure_code=route_usage_stopped]","code":"route_usage_stopped"}}'

let mode: "ok" | "401" | "wallet" | "stopped" | "429" | "tool-then-lose" = "ok"
let credentialFile = ""
const stub = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const body = JSON.parse((await request.text()) || "{}") as { tools?: unknown[] }
    if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
    if (url.pathname.startsWith("/byok/")) return Response.json(BYOK_401, { status: 401 })
    if (mode === "401") return Response.json({ error: { message: "invalid token", code: "unauthorized" } }, { status: 401 })
    if (mode === "wallet") return new Response(WALLET_402, { status: 402, headers: { "content-type": "application/json" } })
    if (mode === "stopped") return new Response(STOPPED_402, { status: 402, headers: { "content-type": "application/json" } })
    if (mode === "429") return Response.json({ error: { message: "rate limited: too many requests", code: "rate_limited" } }, { status: 429 })
    const chunk = (delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    // 第一步照常完成(调一次工具),凭据在两步之间没了:第二步的请求在 ext 的请求边界被拦下(标题请求不带工具表,不动它)
    if (mode === "tool-then-lose" && body.tools?.length) {
      mode = "ok"
      fs.rmSync(credentialFile)
      const call = { index: 0, id: "call_cp1669", type: "function", function: { name: "cp_probe", arguments: "{}" } }
      return new Response(chunk({ role: "assistant", tool_calls: [call] }, null) + chunk({}, "tool_calls") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
    }
    return new Response(chunk({ role: "assistant", content: "ok" }, null) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  },
})

let host: ReturnType<typeof codepuppyEngine>
let running: Running
let adapter: typeof fetch
const events: Array<{ directory: string; payload: V1Payload }> = []
const stream = new AbortController()

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  // BYOK:金库里有一把 DeepSeek Key(刻意不像真密钥)⇒ 生产注入给出 deepseek-byok 节点;只把它的端点改指桩。
  const userData = path.join(sandbox.root, "turn-failure-userdata")
  const keyFile = secretFilePath(userData, "DEEPSEEK_API_KEY")
  fs.mkdirSync(path.dirname(keyFile), { recursive: true })
  fs.writeFileSync(keyFile, "sk-cp1669-not-a-real-key", { mode: 0o600 })
  pinAppliedCatalog(userData, 1)
  host = codepuppyEngine({ sandbox, name: "turn-failure", modelBaseURL: `http://127.0.0.1:${stub.port}/v1` })
  const byok = host.content.providers["deepseek-byok"] as { settings: { baseURL: string }; models: Record<string, unknown> } | undefined
  if (!byok?.models[BYOK.id]) throw new Error(`production injection gave no ${BYOK.providerID}/${BYOK.id}`)
  byok.settings.baseURL = `http://127.0.0.1:${stub.port}/byok/v1`
  const retryNow = path.join(sandbox.root, "turn-failure-retry-now")
  fs.mkdirSync(retryNow, { recursive: true })
  fs.writeFileSync(
    path.join(retryNow, "server.js"),
    `export default { id: "codepuppy.test.retry-now", setup: async (ctx) => {
  await ctx.session.hook("retry", (event) => { if (event.decision.retry) event.decision = { retry: true, delay: 0 } })
} }\n`,
  )
  host.content.plugins.push(retryNow)
  running = await host.start()
  // 生产适配器;口令由 running.fetch 补(同生产 main 的 onBeforeSendHeaders)。
  adapter = createEngineFetch({
    isEngineOrigin: (origin) => origin === ORIGIN,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => running.fetch(new Request(input, init))) as typeof fetch,
  }) as typeof fetch
  const response = await adapter(`${ORIGIN}/global/event`, { signal: stream.signal })
  void (async () => {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      for (let index = buffer.indexOf("\n\n"); index >= 0; index = buffer.indexOf("\n\n")) {
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)))
      }
    }
  })().catch(() => undefined)
  await Bun.sleep(300)
}, 120_000)

afterAll(async () => {
  stream.abort()
  await running?.close().catch(() => undefined)
  stub.stop(true)
})

const headers = () => ({ "content-type": "application/json", "x-opencode-directory": encodeURIComponent(host.projectDirectory) })

/** 发一条(没给会话模型就经适配器建会话,同首页发送),等到适配器发出 session.idle。 */
async function failedTurn(text: string, options: { model?: typeof BYOK; sessionModel?: typeof BYOK }) {
  const sessionID = options.sessionModel
    ? ((await running.send("POST", "/api/session", { location: { directory: host.projectDirectory }, model: options.sessionModel })).json.data.id as string)
    : ((await (await adapter(`${ORIGIN}/session`, { method: "POST", headers: headers(), body: "{}" })).json()) as { id: string }).id
  const prompt = await adapter(`${ORIGIN}/session/${sessionID}/prompt_async`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      agent: "build",
      parts: [{ type: "text", text }],
      ...(options.model ? { model: { providerID: options.model.providerID, modelID: options.model.id } } : {}),
    }),
  })
  expect(prompt.status).toBe(204)
  const idle = () =>
    events.some((event) => event.payload.type === "session.idle" && (event.payload.properties as { sessionID: string }).sessionID === sessionID)
  for (let i = 0; i < 300 && !idle(); i++) await Bun.sleep(50)
  if (!idle()) throw new Error(`session ${sessionID} never went idle through the adapter`)
  return sessionID
}

type TurnErrorRow = Extract<TimelineRow, { kind: "turnError" }>
type Shown = Pick<TurnErrorRow, "name" | "message" | "cause" | "statusCode" | "netLayer">
const shown = (rows: TimelineRow[]): Shown | undefined => {
  const row = rows.find((item): item is TurnErrorRow => item.kind === "turnError")
  return row && { name: row.name, message: row.message, cause: row.cause, statusCode: row.statusCode, netLayer: row.netLayer }
}

/** 时间线上这个回合的错误行,两条入口各一份:事件流归约出的 store,与重新打开会话读到的消息页。 */
async function turnError(sessionID: string) {
  const [store, setStore] = createStore<any>({
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    message: {},
    session_message: {},
    part: {},
    part_text_accum_delta: {},
    limit: 50,
  })
  for (const event of events)
    if (event.directory === host.projectDirectory)
      applyDirectoryEvent({ event: event.payload, store, setStore, push: () => {}, directory: host.projectDirectory, loadLsp: () => {}, setSessionTodo: () => {} })
  const messages = JSON.parse(JSON.stringify(store.message[sessionID] ?? []))
  const live = projectTimelineRows({ messages, partsOf: (id) => store.part[id] ?? [], status: store.session_status[sessionID]?.type ?? "idle" })
  const page = (await (await adapter(`${ORIGIN}/session/${sessionID}/message?limit=50`, { headers: headers() })).json()) as Array<{ info: any; parts: any[] }>
  const reopened = projectTimelineRows({
    messages: page.map((item) => item.info),
    partsOf: (id) => page.find((item) => item.info.id === id)?.parts ?? [],
    status: "idle",
  })
  // 用户气泡两条入口都在(失败不吞掉用户说的话),回合已结束
  expect(live.some((row) => row.kind === "user")).toBe(true)
  expect(reopened.some((row) => row.kind === "user")).toBe(true)
  expect(store.session_status[sessionID]?.type).toBe("idle")
  return { live: shown(live), reopened: shown(reopened) }
}

async function expectShown(sessionID: string, expected: Partial<Shown>) {
  const { live, reopened } = await turnError(sessionID)
  expect({ live, reopened }).toMatchObject({ live: expected, reopened: expected })
  expect(live).toEqual(reopened)
  return live!
}

describe("#1669 失败的回合:嵌入式引擎 → 生产适配器 → 冻结归约器 → 时间线回合错误行", () => {
  test("模型不可用(会话的模型已不在任何 provider 里,provider.no-route):回合错误行带着引擎的原话", async () => {
    const sessionID = await failedTurn("continue after the model went away", { sessionModel: { providerID: "stub", id: "stub-model" } })
    await expectShown(sessionID, { name: "UnknownError", message: "Model unavailable: stub/stub-model", cause: undefined })
  }, 60_000)

  test("BYOK Key 无效(DeepSeek 401):登录或 Key 无效(auth),开发者详情 APIError 401", async () => {
    const sessionID = await failedTurn("fake key turn", { model: BYOK })
    await expectShown(sessionID, { name: "APIError", cause: "auth", statusCode: 401, message: BYOK_401.error.message })
  }, 60_000)

  test("平台拒收凭据(网关 401):登录或 Key 无效(auth)", async () => {
    mode = "401"
    const sessionID = await failedTurn("platform rejects the token", { model: PLATFORM })
    await expectShown(sessionID, { name: "APIError", cause: "auth", statusCode: 401 })
  }, 60_000)

  test("余额不足(平台 402 account_wallet_insufficient):余额或会员不足(billing)", async () => {
    mode = "wallet"
    const sessionID = await failedTurn("wallet empty", { model: PLATFORM })
    await expectShown(sessionID, { name: "APIError", cause: "billing", statusCode: 402 })
  }, 60_000)

  test("线路停收(平台 402 route_usage_stopped):这个模型暂时不可用(modelUnavailable)—— 应答体原样到卡片", async () => {
    mode = "stopped"
    const sessionID = await failedTurn("route stopped", { model: PLATFORM })
    await expectShown(sessionID, { name: "APIError", cause: "modelUnavailable", statusCode: 402 })
  }, 60_000)

  test("请求太频繁(429,引擎重试用尽):请求太频繁,稍后再试(rateLimit)", async () => {
    mode = "429"
    const sessionID = await failedTurn("too many", { model: PLATFORM })
    await expectShown(sessionID, { name: "APIError", cause: "rateLimit", statusCode: 429 })
  }, 60_000)

  test("平台凭据读不到(ext 在请求发出前抛 LoadAPIKeyError,引擎零请求):登录或 Key 无效(auth)", async () => {
    mode = "ok"
    credentialFile = secretFilePath(host.userData, "CODEPUPPY_API_KEY")
    const credential = fs.readFileSync(credentialFile)
    fs.rmSync(credentialFile)
    const sessionID = await failedTurn("credential gone", { model: PLATFORM })
    await expectShown(sessionID, { name: "ProviderAuthError", cause: "auth", statusCode: undefined })
    fs.writeFileSync(credentialFile, credential, { mode: 0o600 })
  }, 60_000)

  test("第一步做完、凭据在两步之间没了(第二步零请求):工作过程留着,回合错误行仍是登录或 Key 无效(auth)", async () => {
    mode = "tool-then-lose"
    const sessionID = await failedTurn("lose the credential mid-turn", { model: PLATFORM })
    // 前提:第一步的助手消息完成了工具调用、不带错误;失败只在回合末的 idle 上
    const stored = (await running.send("GET", `/api/session/${sessionID}/message?order=asc&limit=50`)).json.data as Array<{ type: string; finish?: string; error?: unknown }>
    expect(stored.filter((message) => message.type === "assistant").map((message) => [message.finish, message.error])).toEqual([["tool-calls", undefined]])
    expect(stored.at(-1)).toMatchObject({ type: "idle", outcome: "failed", error: { type: "provider.auth" } })
    await expectShown(sessionID, { name: "ProviderAuthError", cause: "auth", statusCode: undefined })
  }, 60_000)

  test("联网失败(端点拒连 ECONNREFUSED,重试用尽):卡片按网络层 tcp 说话,文本不带登记码前缀", async () => {
    stub.stop(true)
    const sessionID = await failedTurn("network down", { model: BYOK })
    const row = await expectShown(sessionID, { name: "APIError", netLayer: "tcp", cause: undefined, statusCode: undefined })
    expect(row.message).toContain("ECONNREFUSED")
    expect(row.message).not.toContain("[codepuppy:")
  }, 60_000)
})
