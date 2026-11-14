// `#1669` G2:打包版里点「拒绝」,卡片停在「正在提交…」、引擎直到 300 秒期限才结束这次调用 —— 回复根本没到引擎。
//
// 机制(本文件把它在真路径上复现出来):renderer 直连引擎源(I8:main 只在 onBeforeSendHeaders 里补口令),Chromium 对同一个
// http 源最多同时开 6 条连接(alpha-code#1554 在同一 Electron 上实测:SSE 流计入,第 7 个请求排队到有连接空出来为止)。
// 冻结界面与 renderer 自己的订阅方各开一条 `GET /global/event`(冻结 app server-sdk、侧栏 use-projects、cloud-run-watcher、
// background-problem-watcher,打开过定制中心后再加 use-extensions —— 一共 5 个);适配器若给每个订阅方各开一条 2.x 的
// `/api/event`,再给每次审批回复另开一条等 `permission.replied`,那第 6 条连接被回复自己的事件窗口占住,回复接下来的
// 短请求(重读待审、发回复)永远排不上 —— 回复发不出去,窗口也就永远不关。
//
// 判据都在真入口上:冻结 v1 SDK(审批卡 replyPermissionV1 经 createPermissionV2Feed 的那一条)→ 生产的 createEngineFetch →
// 真监听端口的嵌入式 OpenCode 2(生产注入 + 真 ext,test-component/codepuppy-engine.ts)。出网的 fetch 按 Chromium 的
// HTTP/1.1 连接池建模:同一个源最多 6 个请求同时占连接,连接从发出占到响应体读完 / 取消 / 出错,其余先进先出排队。
//   · 拒绝、允许一次、本次会话内允许:挂着与界面同样多的订阅时,回复在 5 秒内落到引擎,卡片的消费方拿到回执,引擎按这个决定结束调用
//     (拒绝 ⇒ 工具没执行、文件不存在、不是超时那句;允许 ⇒ 文件写下)。
//   · 等待中的其他动作(停止、回答提问、追加一条消息)与「拒绝」同时发出时也都在 5 秒内到达。
//   · 量具自检:6 条直连的 2.x 事件流占满连接池 ⇒ 同一个回复 5 秒内到不了(连接池模型真的会饿死请求)。
// 已知的坏(修之前每个订阅方、每次回复各开一条 2.x 事件流,实测):5 个订阅方 + 回复的事件窗口 = 6 条事件流占满连接池、6 个请求排队,
// 拒绝 / 允许一次 / 本次会话内允许 5 秒内都没有回执,同时发出的停止、回答、追加也都没到;同一份代码只挂 4 个订阅方或连接不设上限时,回执 10–12 ms 就到。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录;凭据是合成的。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { createOpencodeClient, type PermissionV2DecisionReceipt } from "@opencode-ai/sdk/v2/client"
import { adaptPermissionV1Request, replyPermissionV1 } from "../../../codepuppy-app/src/context/permission-v1-adapter"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { createPermissionDecisionCommand } from "../renderer/codepuppy-ui/PermissionDialog"
import { createPermissionV2Feed } from "../renderer/codepuppy-ui/session-workspace/session-permission-feed"
import { createEngineFetch } from "./index"

const sandbox = engineSandbox()
const model = scriptedModel()
const ASK = "codepuppy-ask"
/** Chromium 每个 http 源的连接上限(net/socket/client_socket_pool_manager.cc 的 g_max_sockets_per_group[NORMAL] = 6)。 */
const SOCKETS_PER_HOST = 6
/** 「当即生效」的上限:0.1.26 的审批卡点了就关,这里给 5 秒。 */
const BOUND_MS = 5_000
/** 挂载的界面里各自订阅 `/global/event` 的地方(定制中心那条在第一次打开后常驻,按打开过算)。 */
const SUBSCRIBERS = [
  "codepuppy-app/src/context/server-sdk.tsx",
  "ui-mac/src/renderer/sidebar/use-projects.ts",
  "ui-mac/src/renderer/codepuppy-ui/cloud-run-watcher.tsx",
  "ui-mac/src/renderer/codepuppy-ui/background-problem-watcher.tsx",
  "ui-mac/src/renderer/extensions/use-extensions.ts",
] as const

let host: ReturnType<typeof codepuppyEngine>
let running: Running
const send = (method: string, route: string, body?: unknown) => running.send(method, route, body)

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  host = codepuppyEngine({ sandbox, name: "budget", modelBaseURL: model.baseURL })
  running = await host.start()
}, 60_000)

afterAll(async () => {
  await running?.close().catch(() => undefined)
  model.stop()
})

/**
 * Chromium 的 HTTP/1.1 连接池,只建模一个源:同时占连接的请求不超过 `limit`(不做 pipelining);连接从发出占到响应体读完、
 * 被取消或出错为止;占不上的先进先出排队,排队中被取消的请求离队。另记下此刻占着连接的请求路径,用来数长连接。
 */
function chromiumSocketPool(limit: number, authorization: string) {
  let active = 0
  const queue: Array<() => void> = []
  const held = new Map<symbol, string>()
  let stalls = 0
  const release = () => {
    const next = queue.shift()
    if (next) next()
    else active--
  }
  const acquire = (signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (active < limit) {
        active++
        return resolve()
      }
      stalls++
      const granted = () => {
        signal.removeEventListener("abort", aborted)
        resolve()
      }
      const aborted = () => {
        const index = queue.indexOf(granted)
        if (index >= 0) queue.splice(index, 1)
        reject(signal.reason)
      }
      queue.push(granted)
      signal.addEventListener("abort", aborted, { once: true })
    })

  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    // main 的 onBeforeSendHeaders(I8)给发往引擎源的请求补口令。
    request.headers.set("authorization", authorization)
    request.signal.throwIfAborted()
    await acquire(request.signal)
    const token = Symbol()
    held.set(token, new URL(request.url).pathname)
    let open = true
    const done = () => {
      if (!open) return
      open = false
      held.delete(token)
      release()
    }
    let response: Response
    try {
      response = await globalThis.fetch(request)
    } catch (error) {
      done()
      throw error
    }
    if (!response.body || [204, 205, 304].includes(response.status)) {
      done()
      return response
    }
    const reader = response.body.getReader()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read()
          if (chunk.done) {
            done()
            controller.close()
          } else controller.enqueue(chunk.value)
        } catch (error) {
          done()
          controller.error(error)
        }
      },
      cancel(reason) {
        done()
        return reader.cancel(reason)
      },
    })
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
  return {
    fetch: fetch as typeof globalThis.fetch,
    /** 此刻占着连接的 2.x 事件流条数。 */
    eventStreams: () => [...held.values()].filter((path) => path === "/api/event").length,
    stalls: () => stalls,
  }
}

/** 一个挂载的界面:生产适配器接在连接池上;SUBSCRIBERS 各经 v1 SDK 订一条 `/global/event`,收到 `server.connected` 才算挂上。 */
async function mountedUi() {
  const pool = chromiumSocketPool(SOCKETS_PER_HOST, running.authorization)
  const origin = new URL(running.url).origin
  const engineFetch = createEngineFetch({ isEngineOrigin: (candidate) => candidate === origin, fetch: pool.fetch })
  const client = createOpencodeClient({ baseUrl: origin, fetch: engineFetch as typeof fetch, throwOnError: true, directory: host.projectDirectory })
  const abort = new AbortController()
  const frozenAppEvents: Array<{ type: string; properties: any }> = []
  const connected = SUBSCRIBERS.map(async (name, index) => {
    const subscriber = createOpencodeClient({ baseUrl: origin, fetch: engineFetch as typeof fetch })
    const { stream } = await subscriber.global.event({ signal: abort.signal, sseMaxRetryAttempts: 1 } as never)
    let ready: (() => void) | undefined
    const first = new Promise<void>((resolve) => (ready = resolve))
    void (async () => {
      try {
        for await (const event of stream as AsyncIterable<{ payload?: { type: string; properties: any } }>) {
          if (event.payload?.type === "server.connected") ready?.()
          if (index === 0 && event.payload) frozenAppEvents.push(event.payload)
        }
      } catch {}
    })()
    await within(first, `${name} never received server.connected`)
  })
  await Promise.all(connected)
  return { pool, client, frozenAppEvents, close: () => abort.abort() }
}

async function within<T>(work: Promise<T>, message: string, ms = BOUND_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`${message} (bound ${ms} ms)`)), ms)))
  try {
    return await Promise.race([work, late])
  } finally {
    clearTimeout(timer)
  }
}

type ToolPart = { type: string; name: string; state: { status: string; error?: { type?: string; message?: string } } }

/** 一轮停在审批上:请求审批档,模型调 `call` 那个工具。观察走进程内分发(不占 renderer 的连接)。 */
async function waitingTurn(call: { name: string; args: Record<string, unknown> }) {
  const created = await send("POST", "/api/session", { location: { directory: host.projectDirectory }, agent: ASK, model: { id: "m", providerID: "codepuppy" } })
  const sessionID = created.json.data.id as string
  const projectID = created.json.data.projectID as string
  await send("POST", `/api/session/${sessionID}/prompt`, { text: `CP-CALL ${JSON.stringify(call)}` })
  for (const until = Date.now() + 10_000; Date.now() < until; await Bun.sleep(25)) {
    const pending = ((await send("GET", `/api/session/${sessionID}/permission`)).json?.data ?? []) as Array<{ id: string }>
    if (pending.length) return { sessionID, projectID, requestID: pending[0]!.id }
  }
  throw new Error("the turn never reached an approval")
}

async function waitingQuestion() {
  const created = await send("POST", "/api/session", { location: { directory: host.projectDirectory }, agent: ASK, model: { id: "m", providerID: "codepuppy" } })
  const sessionID = created.json.data.id as string
  const questions = [{ question: "Which one?", header: "Pick", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }]
  await send("POST", `/api/session/${sessionID}/prompt`, { text: `CP-CALL ${JSON.stringify({ name: "question", args: { questions } })}` })
  for (const until = Date.now() + 10_000; Date.now() < until; await Bun.sleep(25)) {
    const permission = ((await send("GET", `/api/session/${sessionID}/permission`)).json?.data ?? []) as Array<{ id: string }>
    // 提问本身若要审批(请求审批档),先放行它 —— 这里要的是一张等着回答的提问卡。
    if (permission.length) await send("POST", `/api/session/${sessionID}/permission/${permission[0]!.id}/reply`, { decision: "once" })
    const forms = ((await send("GET", `/api/form?location[directory]=${encodeURIComponent(host.projectDirectory)}`)).json?.data ?? []) as Array<{ id: string; sessionID: string }>
    const form = forms.find((item) => item.sessionID === sessionID)
    if (form) return { sessionID, formID: form.id }
  }
  throw new Error("the turn never reached a question")
}

async function toolPart(sessionID: string, name: string) {
  const messages = (await send("GET", `/api/session/${sessionID}/message?order=asc`)).json.data as Array<{ type: string; content?: ToolPart[] }>
  return messages.flatMap((message) => (message.type === "assistant" ? (message.content ?? []) : [])).find((part) => part.type === "tool" && part.name === name)
}

/** 引擎结束了这次调用(工具部件不再是进行中),在上限内。 */
async function settledTool(sessionID: string, name: string) {
  for (const until = Date.now() + BOUND_MS; Date.now() < until; await Bun.sleep(25)) {
    const part = await toolPart(sessionID, name)
    if (part && part.state.status !== "pending" && part.state.status !== "running") return part
  }
  throw new Error(`the engine did not end the ${name} call within ${BOUND_MS} ms`)
}

const active = async (sessionID: string) => ((await send("GET", "/api/session/active")).json.data as Record<string, unknown>)[sessionID] !== undefined

/** 审批卡的消费方:冻结 v1 通道的卡(GET /permission 交出)+ createPermissionV2Feed,回复经 replyPermissionV1。 */
async function cardFeed(ui: Awaited<ReturnType<typeof mountedUi>>, sessionID: string) {
  const cards = async () =>
    ((await ui.client.permission.list()).data ?? [])
      .filter((request) => request.sessionID === sessionID)
      .map((request) => adaptPermissionV1Request(request, ASK))
  const feed = createPermissionV2Feed({
    list: cards,
    reply: (requestID, command) => replyPermissionV1({ client: ui.client } as never, { sessionID, requestID, command }),
  })
  feed.load()
  for (let attempt = 0; attempt < 200 && !feed.state.ready; attempt++) await Bun.sleep(10)
  expect(feed.state.ready).toBe(true)
  return feed
}

describe("#1669 G2:挂着界面的订阅时,审批回复当即落到引擎", () => {
  for (const decision of ["reject", "once", "always"] as const) {
    test(`${decision}:5 个订阅方挂着,回复 ${BOUND_MS} ms 内拿到回执、引擎按决定结束调用;长连接只有 1 条`, async () => {
      const ui = await mountedUi()
      try {
        const file = `g2-${decision}.txt`
        const turn = await waitingTurn({ name: "write", args: { path: file, content: "should only exist when allowed" } })
        const feed = await cardFeed(ui, turn.sessionID)
        const card = feed.state.requests.find((request) => request.id === turn.requestID)
        expect(card?.id).toBe(turn.requestID)
        const streamsWhileWaiting = ui.pool.eventStreams()

        const receipt: PermissionV2DecisionReceipt = await within(
          feed.reply(turn.requestID, createPermissionDecisionCommand(card!, decision, turn.projectID)),
          `the ${decision} reply got no receipt`,
        )
        expect(receipt).toMatchObject({ requestID: turn.requestID, sessionID: turn.sessionID, decision })
        expect(feed.state.requests.map((request) => request.id)).not.toContain(turn.requestID)

        const part = await settledTool(turn.sessionID, "write")
        const written = fs.existsSync(path.join(host.projectDirectory, file))
        if (decision === "reject") {
          expect(part.state.status).toBe("error")
          expect(part.state.error?.message ?? "").not.toContain("无人应答")
          expect(written).toBe(false)
        } else {
          expect(part.state.status).toBe("completed")
          expect(written).toBe(true)
        }
        // 冻结 app 那条流也看到了引擎的 permission.replied(审批卡据此收起)。
        for (let attempt = 0; attempt < 100 && !ui.frozenAppEvents.some((event) => event.type === "permission.replied" && event.properties.requestID === turn.requestID); attempt++)
          await Bun.sleep(10)
        expect(ui.frozenAppEvents.some((event) => event.type === "permission.replied" && event.properties.requestID === turn.requestID)).toBe(true)
        // 5 个订阅方共用 1 条 2.x 事件流;回复不另开(0.1.26:3 条,打开过定制中心 4 条,回复是一个 POST)。
        expect(streamsWhileWaiting).toBe(1)
        expect(ui.pool.eventStreams()).toBe(1)
      } finally {
        ui.close()
      }
    }, 60_000)
  }

  test("等待中的其他动作与「拒绝」同时发出:停止、回答提问、追加消息都在上限内到达引擎", async () => {
    const ui = await mountedUi()
    try {
      const question = await waitingQuestion()
      const rejected = await waitingTurn({ name: "write", args: { path: "g2-concurrent-reject.txt", content: "x" } })
      const stopped = await waitingTurn({ name: "write", args: { path: "g2-concurrent-stop.txt", content: "x" } })
      const followed = await waitingTurn({ name: "write", args: { path: "g2-concurrent-follow.txt", content: "x" } })
      const feed = await cardFeed(ui, rejected.sessionID)
      const card = feed.state.requests.find((request) => request.id === rejected.requestID)!

      // 用户先点「拒绝」,紧接着在别处停止、回答提问、追加一句(全部经冻结 v1 SDK → 生产适配器)。
      const reply = feed.reply(rejected.requestID, createPermissionDecisionCommand(card, "reject"))
      const stop = ui.client.session.abort({ sessionID: stopped.sessionID })
      const answer = ui.client.question.reply({ requestID: question.formID, answers: [["A"]] })
      const follow = ui.client.session.promptAsync({ sessionID: followed.sessionID, parts: [{ type: "text", text: "and one more thing" }] })
      await within(Promise.all([reply, stop, answer, follow]), "the concurrent actions did not all arrive")

      expect((await settledTool(rejected.sessionID, "write")).state.status).toBe("error")
      expect((await settledTool(stopped.sessionID, "write")).state.status).toBe("error")
      expect(fs.existsSync(path.join(host.projectDirectory, "g2-concurrent-stop.txt"))).toBe(false)
      expect((await settledTool(question.sessionID, "question")).state.status).toBe("completed")
      for (const until = Date.now() + BOUND_MS; Date.now() < until && (await active(stopped.sessionID)); ) await Bun.sleep(25)
      expect(await active(stopped.sessionID)).toBe(false)
      // 追加的那句被引擎收下:回合还停在审批上,2.x 把它排进会话的收件箱(回合结束后才落成用户消息)。
      const messages = (await send("GET", `/api/session/${followed.sessionID}/message?order=asc`)).json.data as Array<{ type: string; text?: string }>
      const inbox = (await send("GET", `/api/session/${followed.sessionID}/inbox`)).json
      expect(messages.some((message) => message.type === "user" && message.text === "and one more thing") || JSON.stringify(inbox).includes("and one more thing")).toBe(true)
    } finally {
      ui.close()
    }
  }, 90_000)

  test("量具自检:6 条直连的 2.x 事件流占满连接池 ⇒ 同一个回复在上限内到不了引擎", async () => {
    const pool = chromiumSocketPool(SOCKETS_PER_HOST, running.authorization)
    const origin = new URL(running.url).origin
    const engineFetch = createEngineFetch({ isEngineOrigin: (candidate) => candidate === origin, fetch: pool.fetch })
    const client = createOpencodeClient({ baseUrl: origin, fetch: engineFetch as typeof fetch, throwOnError: true, directory: host.projectDirectory })
    const turn = await waitingTurn({ name: "write", args: { path: "g2-saturated.txt", content: "x" } })
    // 先在空池里交出这张卡(适配器的快照指纹),再占满。
    const listed = ((await client.permission.list()).data ?? []).filter((request) => request.sessionID === turn.sessionID)
    expect(listed.map((request) => request.id)).toEqual([turn.requestID])
    const abort = new AbortController()
    try {
      const streams = await Promise.all(
        Array.from({ length: SOCKETS_PER_HOST }, () => pool.fetch(`${origin}/api/event`, { signal: abort.signal })),
      )
      expect(pool.eventStreams()).toBe(SOCKETS_PER_HOST)
      // 经审批卡同一个提交入口(replyPermissionV1)发出,与上面几条用例走同一条路。
      const card = adaptPermissionV1Request(listed[0]!, ASK)
      const reply = replyPermissionV1({ client } as never, { sessionID: turn.sessionID, requestID: turn.requestID, command: createPermissionDecisionCommand(card, "reject") })
      reply.catch(() => {})
      const error = await within(reply, "starved").then(() => undefined, (caught: Error) => caught)
      expect(error?.message).toBe(`starved (bound ${BOUND_MS} ms)`)
      expect(await active(turn.sessionID)).toBe(true)
      expect(((await send("GET", `/api/session/${turn.sessionID}/permission`)).json.data as unknown[]).length).toBe(1)
      for (const stream of streams) await stream.body?.cancel().catch(() => {})
      // 放开连接之后同一个回复照常落定(请求只是排队,不是丢了)。
      await within(reply, "the queued reply never landed after the pool freed up")
      expect((await settledTool(turn.sessionID, "write")).state.status).toBe("error")
    } finally {
      abort.abort()
    }
  }, 60_000)
})
