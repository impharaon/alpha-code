// `#1669`:回合停在审批上时追加的一句,回答审批之前就显示成用户气泡 —— 与 0.1.26 一样。
//
// 机制:0.1.26 的引擎一收到 prompt 就落一条用户消息并发出 message.updated(v0.1.26 packages/opencode/src/session/prompt.ts
// 的 prompt → createUserMessage,回合在跑也一样,loop 下一步照常读到它)。2.x 的 prompt 只把输入排进会话的收件箱
// (core session/inbox.ts admit → `session.inbox.enqueued`),到下一步边界才投递、落成同 id 的用户消息(core session/projector.ts
// InboxDelivered,时间 = 投递时间)。回合停在审批上,下一步要等审批回答 —— 这期间引擎里没有这条消息,界面上也就什么都没有。
//
// 判据都在真入口上:沙箱里真监听端口的嵌入式 OpenCode 2(生产注入 + 真 ext,test-component/codepuppy-engine.ts)→ 生产的引擎适配器
// (createEngineFetch)→ 冻结 app 的 v1 SDK / 兼容 API 与它的会话 store(createServerSession,时间线读的就是它的 data.message /
// data.part);每个窗口订一条 `/global/event`,每条 payload 照 server-sync.tsx 交给 store.apply。发送走 composer 同一个
// `session.promptAsync`(请求审批档),审批经冻结审批卡的提交入口 replyPermissionV1,停止走 `session.abort`。
//   · 审批等待中追加一句:回答之前,两个订阅的窗口与此刻重新加载的窗口里都已有这条用户消息(id = 引擎收件箱里那一条、正文 = 发的那句),
//     排在等待中的回合之后;引擎此刻仍停在审批上,消息表里还没有它。
//   · 回答审批(允许一次):回合照跑 —— 模型收到这句、回一条挂在它下面的助手消息;两个窗口 = 引擎 = 重新加载,这条用户消息只有一条,
//     顺序不变。
//   · 审批等待中停止:引擎把这句留在收件箱(不投递也不取消),气泡留着、重新加载也在 —— 同 0.1.26(用户消息留在历史里、没有回复);
//     再发一句时两句一起投递,各一条气泡,= 引擎 = 重新加载。
//   · 反向臂:同一条流去掉 `session.inbox.enqueued`(修之前的投影就是不认它)⇒ 回答之前这个窗口里没有这条消息。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录;凭据是合成的。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { adaptPermissionV1Request, replyPermissionV1 } from "../../../codepuppy-app/src/context/permission-v1-adapter"
import { createServerSession } from "../../../codepuppy-app/src/context/server-session"
import { normalizeSessionMessages } from "../../../codepuppy-app/src/utils/session-message"
import { createApiForServer, createSdkForServer } from "../../../codepuppy-app/src/utils/server"
import { createCompatibleApi } from "../../../codepuppy-app/src/utils/server-compat"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { createPermissionDecisionCommand } from "../renderer/codepuppy-ui/PermissionDialog"
import { createEngineFetch } from "./index"

const sandbox = engineSandbox()
const model = scriptedModel()
const ASK = "codepuppy-ask"
const FOLLOW_UP = "补充:内容改成 hello-follow-up"

let host: ReturnType<typeof codepuppyEngine>
let running: Running

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  host = codepuppyEngine({ sandbox, name: "queued", modelBaseURL: model.baseURL })
  running = await host.start()
}, 60_000)

afterAll(async () => {
  await running?.close().catch(() => undefined)
  model.stop()
})

/** main 的 onBeforeSendHeaders(I8)给发往引擎源的请求补口令。 */
const authorized = ((input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init)
  request.headers.set("authorization", running.authorization)
  return fetch(request)
}) as typeof fetch

/** 反向臂:2.x 事件流里去掉 `session.inbox.enqueued` 帧,其余原样(修之前的投影收到它也是丢掉)。 */
const withoutEnqueued = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await authorized(input, init)
  const path = new URL(new Request(input, init).url).pathname
  if (path !== "/api/event" || !response.body) return response
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""
  const frames = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, sink) {
      buffer += decoder.decode(chunk, { stream: true })
      for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
        const frame = buffer.slice(0, end + 2)
        buffer = buffer.slice(end + 2)
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5))
          .join("")
        const type = (() => {
          try {
            return (JSON.parse(data) as { type?: string }).type
          } catch {
            return undefined
          }
        })()
        if (type !== "session.inbox.enqueued") sink.enqueue(encoder.encode(frame))
      }
    },
  })
  return new Response(response.body.pipeThrough(frames), { status: response.status, headers: response.headers })
}) as typeof fetch

type Payload = { type: string; properties: any }

/** 一个窗口 = 一个 renderer:自己的生产适配器,冻结 app 的 serverSDK 那几样(server-sdk.tsx)与它的会话 store。 */
async function openWindow(options: { subscribe: boolean; fetch?: typeof fetch }) {
  const origin = new URL(running.url).origin
  const engineFetch = createEngineFetch({ isEngineOrigin: (candidate) => candidate === origin, fetch: options.fetch ?? authorized }) as typeof fetch
  const server = { url: origin }
  const client = createSdkForServer({ server, fetch: engineFetch, throwOnError: true })
  const legacy = (directory?: string) => createSdkForServer({ server, fetch: engineFetch, throwOnError: true, directory })
  const protocol = Promise.resolve("v1" as const)
  const api = createCompatibleApi({ protocol, current: createApiForServer({ server, fetch: engineFetch }), legacy })
  const store = createServerSession(client, api.session, api.message, { protocol })
  const abort = new AbortController()
  const idles = new Map<string, number>()
  if (options.subscribe) {
    const { stream } = await client.global.event({ signal: abort.signal, sseMaxRetryAttempts: 1 } as never)
    let ready: (() => void) | undefined
    const connected = new Promise<void>((resolve) => (ready = resolve))
    void (async () => {
      try {
        for await (const event of stream as AsyncIterable<{ payload?: Payload }>) {
          const payload = event.payload
          if (!payload) continue
          if (payload.type === "server.connected") ready?.()
          store.apply(payload)
          if (payload.type === "session.idle") idles.set(payload.properties.sessionID, (idles.get(payload.properties.sessionID) ?? 0) + 1)
        }
      } catch {}
    })()
    await connected
  }
  return {
    client: legacy(host.projectDirectory),
    store,
    idles: (sessionID: string) => idles.get(sessionID) ?? 0,
    /** 时间线进入会话(session.sync)后往上翻到头。 */
    async open(sessionID: string) {
      await store.sync(sessionID)
      while (store.history.more(sessionID)) await store.history.loadMore(sessionID)
    },
    ids: (sessionID: string) => (store.data.message[sessionID] ?? []).map((message) => message.id),
    text: (messageID: string) =>
      (store.data.part[messageID] ?? []).flatMap((part) => (part.type === "text" ? [(part as { text: string }).text] : [])).join(""),
    close: () => abort.abort(),
  }
}

type Window = Awaited<ReturnType<typeof openWindow>>

async function until(check: () => boolean | Promise<boolean>, message: string, ms = 15_000) {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(20)) if (await check()) return
  throw new Error(message)
}

type EngineMessage = { id: string; type: string; text?: string }

/** 引擎里的历史(进程内直读 2.x,不经适配器)。 */
async function engineHistory(sessionID: string) {
  const listed = await running.send("GET", `/api/session/${sessionID}/message?order=asc&limit=200`)
  expect(listed.status).toBe(200)
  return listed.json.data as EngineMessage[]
}

/** 引擎收件箱里还没投递的输入。 */
async function engineInbox(sessionID: string) {
  const listed = await running.send("GET", `/api/session/${sessionID}/inbox`)
  expect(listed.status).toBe(200)
  return listed.json.data as Array<{ id: string; type: string; payload?: { text?: string } }>
}

/** 引擎历史按冻结界面自己的投影(normalizeSessionMessages)显示成的那些消息 id —— 不经适配器。 */
const shown = async (sessionID: string) => normalizeSessionMessages(sessionID, (await engineHistory(sessionID)) as never).messages.map((message) => message.id)

const count = (ids: string[], id: string) => ids.filter((item) => item === id).length

/** composer 的发送(codepuppy-composer.tsx 的 session.promptAsync,请求审批档)。 */
async function send(from: Window, sessionID: string, text: string) {
  await from.client.session.promptAsync({
    sessionID,
    directory: host.projectDirectory,
    agent: ASK,
    parts: [{ type: "text", text }],
    model: { providerID: "codepuppy", modelID: "m" },
  } as never)
}

/** 冻结审批卡从 v1 通道拿到的这个会话的待审请求。 */
const pendingRequest = async (from: Window, sessionID: string) =>
  ((await from.client.permission.list()).data ?? []).find((item) => item.sessionID === sessionID)

/** 新会话的第一轮停在审批上(模型调 write);每个窗口先进入这个会话。 */
async function waitingTurn(from: Window, windows: Window[], file: string) {
  const created = await from.client.session.create({ directory: host.projectDirectory, title: `cp-1669-${file}` } as never)
  const sessionID = (created.data as { id: string }).id
  for (const window of windows) await window.open(sessionID)
  await send(from, sessionID, `CP-CALL ${JSON.stringify({ name: "write", args: { path: file, content: "hello" } })}`)
  await until(async () => !!(await pendingRequest(from, sessionID)), "the turn never reached an approval")
  return { sessionID, requestID: (await pendingRequest(from, sessionID))!.id }
}

/** 引擎此刻仍停在那张审批上(回合还在跑、请求还在)。 */
async function stillWaiting(sessionID: string, requestID: string) {
  const pending = (await running.send("GET", `/api/session/${sessionID}/permission`)).json.data as Array<{ id: string }>
  expect(pending.map((item) => item.id)).toContain(requestID)
  expect(((await running.send("GET", "/api/session/active")).json.data as Record<string, unknown>)[sessionID]).toBeDefined()
}

describe("#1669 审批等待中追加的一句当即显示成用户气泡(同 0.1.26)", () => {
  let a: Window
  let b: Window
  let unprojected: Window

  beforeAll(async () => {
    a = await openWindow({ subscribe: true })
    b = await openWindow({ subscribe: true })
    unprojected = await openWindow({ subscribe: true, fetch: withoutEnqueued })
  }, 30_000)

  afterAll(() => {
    for (const window of [a, b, unprojected]) window?.close()
  })

  describe("回答审批", () => {
    let sessionID: string
    let requestID: string
    let followUp: string

    test("回答之前:两个窗口与此刻重新加载的窗口里都已有这条用户消息,排在等待中的回合之后;引擎仍停在审批上、消息表里还没有它", async () => {
      const turn = await waitingTurn(a, [a, b, unprojected], "queued-reply.txt")
      sessionID = turn.sessionID
      requestID = turn.requestID
      const before = await shown(sessionID)
      await send(a, sessionID, FOLLOW_UP)

      const [queued] = await engineInbox(sessionID)
      expect(queued?.payload?.text).toBe(FOLLOW_UP)
      followUp = queued!.id
      for (const window of [a, b])
        await until(() => window.ids(sessionID).includes(followUp), "the follow-up never reached a subscribed window before the approval was answered")
      await stillWaiting(sessionID, requestID)
      expect((await engineHistory(sessionID)).map((message) => message.id)).not.toContain(followUp)

      const fresh = await openWindow({ subscribe: false })
      await fresh.open(sessionID)
      for (const window of [a, b, fresh]) {
        expect(window.ids(sessionID)).toEqual([...before, followUp])
        expect(window.text(followUp)).toBe(FOLLOW_UP)
      }
    }, 60_000)

    test("反向臂:同一条流去掉 session.inbox.enqueued ⇒ 回答之前这个窗口里没有这条消息", async () => {
      await stillWaiting(sessionID, requestID)
      expect(a.ids(sessionID)).toContain(followUp)
      expect(unprojected.ids(sessionID)).not.toContain(followUp)
    }, 30_000)

    test("允许一次:回合照跑,模型收到这句并回在它下面;两个窗口 = 引擎 = 重新加载,这条用户消息只有一条、顺序不变", async () => {
      const idles = [a, b, unprojected].map((window) => window.idles(sessionID))
      const request = await pendingRequest(a, sessionID)
      expect(request?.id).toBe(requestID)
      const card = adaptPermissionV1Request(request!, ASK)
      await replyPermissionV1({ client: a.client } as never, { sessionID, requestID, command: createPermissionDecisionCommand(card, "once") })
      await until(() => [a, b, unprojected].every((window, index) => window.idles(sessionID) > idles[index]!), "the turn did not end in every window")

      const history = await engineHistory(sessionID)
      expect(history.find((message) => message.id === followUp)).toMatchObject({ type: "user", text: FOLLOW_UP })
      expect(model.requests.some((request) => request.messages.some((message) => message.role === "user" && JSON.stringify(message.content).includes(FOLLOW_UP)))).toBe(true)
      const now = await shown(sessionID)
      const after = now.slice(now.indexOf(followUp) + 1)
      expect(after.length).toBeGreaterThan(0)
      expect(a.store.data.message[sessionID]!.find((message) => message.id === after[0])).toMatchObject({ role: "assistant", parentID: followUp })

      const fresh = await openWindow({ subscribe: false })
      await fresh.open(sessionID)
      expect(fresh.ids(sessionID)).toEqual(now)
      for (const window of [a, b, unprojected]) {
        expect(window.ids(sessionID)).toEqual(now)
        expect(count(window.ids(sessionID), followUp)).toBe(1)
        expect(window.text(followUp)).toBe(FOLLOW_UP)
      }
    }, 60_000)
  })

  describe("停止", () => {
    test("审批等待中停止:引擎把这句留在收件箱,气泡留着、重新加载也在(同 0.1.26);再发一句时两句各一条气泡,= 引擎 = 重新加载", async () => {
      const turn = await waitingTurn(a, [a, b], "queued-stop.txt")
      const { sessionID } = turn
      const before = await shown(sessionID)
      await send(a, sessionID, FOLLOW_UP)
      const [queued] = await engineInbox(sessionID)
      const followUp = queued!.id
      for (const window of [a, b]) await until(() => window.ids(sessionID).includes(followUp), "the follow-up never reached a subscribed window")

      const idles = [a, b].map((window) => window.idles(sessionID))
      await a.client.session.abort({ sessionID })
      await until(() => [a, b].every((window, index) => window.idles(sessionID) > idles[index]!), "the stopped turn did not end in every window")
      expect((await engineInbox(sessionID)).map((item) => item.id)).toEqual([followUp])
      expect((await engineHistory(sessionID)).map((message) => message.id)).not.toContain(followUp)
      const stopped = await openWindow({ subscribe: false })
      await stopped.open(sessionID)
      for (const window of [a, b, stopped]) {
        expect(window.ids(sessionID)).toEqual([...before, followUp])
        expect(window.text(followUp)).toBe(FOLLOW_UP)
      }

      const next = [a, b].map((window) => window.idles(sessionID))
      await send(a, sessionID, "next one")
      await until(() => [a, b].every((window, index) => window.idles(sessionID) > next[index]!), "the next turn did not end in every window")
      expect(await engineInbox(sessionID)).toEqual([])
      const now = await shown(sessionID)
      expect(now).toContain(followUp)
      const fresh = await openWindow({ subscribe: false })
      await fresh.open(sessionID)
      expect(fresh.ids(sessionID)).toEqual(now)
      for (const window of [a, b]) {
        expect(window.ids(sessionID)).toEqual(now)
        expect(count(window.ids(sessionID), followUp)).toBe(1)
      }
    }, 90_000)
  })
})
