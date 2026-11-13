// `#1669`:编辑中间一条消息并重发之后,界面上的对话与引擎里的历史一致 —— 被引擎删掉的旧问答不再留在屏幕上。
//
// 机制:时间线「编辑重发」先 revert 到那条用户消息(session-edit-user-message.ts),2.x 只把回退暂存;下一次发送时引擎提交回退,
// 删掉从那条消息起的全部消息(core session/projector.ts 的 RevertEvent.Committed)。冻结界面的会话 store 只在 `message.removed`
// 上删消息(server-session.ts);0.1.26 的 revert cleanup 对每条删掉的消息发它,2.x 不发 —— 适配器得自己投影出来。
//
// 判据都在真入口上:沙箱里真监听端口的嵌入式 OpenCode 2(生产注入 + 真 ext,test-component/codepuppy-engine.ts)→ 生产的引擎适配器
// (createEngineFetch)→ 冻结 app 的 v1 SDK / 兼容 API 与它的会话 store(createServerSession,时间线读的就是它的 data.message /
// data.part);每个窗口订一条 `/global/event`,每条 payload 照 server-sync.tsx 交给 store.apply。编辑走生产的
// createSessionEditUserMessageHandler,重发走 composer 同一个 `session.promptAsync`。
//   · 长对话:适配器重取的最近一页(按它自己的 recentMessages 读)在提交前不含回退边界、提交后不含一部分保留的消息。暂存期间
//     什么都不删;暂存期间引擎又落下的消息(这里用 shell 命令代表,每条投影成用户 + 助手两条)提交时也被删;重发后两个窗口里的
//     消息 = 引擎历史 = 重新加载,删掉的消息连 part 一起消失,不在最近一页的保留消息原样留着(「不在最近一页」不等于删了)。
//   · 反向臂:同一条流去掉 `message.removed` ⇒ 被删的旧问答仍在 store 里,与引擎不一致(修之前就是这样)。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录;凭据是合成的。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import { createServerSession } from "../../../codepuppy-app/src/context/server-session"
import { normalizeSessionMessages } from "../../../codepuppy-app/src/utils/session-message"
import { createApiForServer, createSdkForServer } from "../../../codepuppy-app/src/utils/server"
import { createCompatibleApi } from "../../../codepuppy-app/src/utils/server-compat"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { createSessionEditUserMessageHandler } from "../renderer/codepuppy-ui/session-workspace/session-edit-user-message"
import { SNAPSHOT_WINDOW } from "./events"
import { createEngineFetch } from "./index"
import { recentMessages } from "./session-cache"

const sandbox = engineSandbox()
const model = scriptedModel()
// 对话的形状。适配器读最近 20 条时,若最早那条不是回合起点(用户 / shell / 带说明的 synthetic),会往前多拉 200 条补起点
// (session-cache.ts recentMessages)—— 整段历史都进了那一页,「在那一页之外」就落空了。所以按实测的条数把最近一页的边沿
// 摆在回合起点上(前提用例与 shell 用例按适配器自己的读法核对,摆歪了就红):
//   · 一轮 3 条(用户、助手、idle),让模型调一次工具的那轮 4 条(多一条助手);
//   · 一条 shell 落 1 条 shell 消息,结果通知进收件箱,下一轮开始时落成不带说明的 synthetic(不是回合起点)。
// 第 1–12 轮保留(11、12 调工具:提交后最近一页从第 8 轮的用户消息开始);第 13 轮起被删,第 19 轮前跑 4 条 shell、
// 19–21 调工具:暂存时最近一页从第 1 条 shell 开始,暂存期间再落 3 条 shell 时边沿依次落在后面几条 shell 上。
const TURNS = 21
/** 编辑第 13 轮:被删的是第 13–21 轮(含其间的 shell),保留的是第 1–12 轮。 */
const EDITED = 13
const TOOL_TURNS = new Set([11, 12, 19, 20, 21])
const SHELLS_BEFORE = { turn: 19, commands: ["echo cp-1669-1", "echo cp-1669-2", "echo cp-1669-3", "echo cp-1669-4"] }
const prompt = (turn: number) => (TOOL_TURNS.has(turn) ? `turn ${turn} CP-CALL {"name":"cp_probe","args":{}}` : `turn ${turn}`)

let host: ReturnType<typeof codepuppyEngine>
let running: Running

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  host = codepuppyEngine({ sandbox, name: "revert", modelBaseURL: model.baseURL })
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

type Payload = { type: string; properties: any }

/**
 * 一个窗口 = 一个 renderer:自己的生产适配器,冻结 app 的 serverSDK 那几样(server-sdk.tsx:client、兼容 API、按目录的 legacy 客户端),
 * 与它的会话 store。`drop` 只给反向臂用:这个类型的事件不交给 store。
 */
async function openWindow(options: { subscribe: boolean; drop?: string }) {
  const origin = new URL(running.url).origin
  const engineFetch = createEngineFetch({ isEngineOrigin: (candidate) => candidate === origin, fetch: authorized }) as typeof fetch
  const server = { url: origin }
  const client = createSdkForServer({ server, fetch: engineFetch, throwOnError: true })
  const legacy = (directory?: string) => createSdkForServer({ server, fetch: engineFetch, throwOnError: true, directory })
  const protocol = Promise.resolve("v1" as const)
  const api = createCompatibleApi({ protocol, current: createApiForServer({ server, fetch: engineFetch }), legacy })
  const store = createServerSession(client, api.session, api.message, { protocol })
  const abort = new AbortController()
  const idles = new Map<string, number>()
  const received: Payload[] = []
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
          received.push(payload)
          if (payload.type !== options.drop) store.apply(payload)
          if (payload.type === "session.idle") idles.set(payload.properties.sessionID, (idles.get(payload.properties.sessionID) ?? 0) + 1)
        }
      } catch {}
    })()
    await connected
  }
  return {
    client: legacy(host.projectDirectory),
    store,
    received,
    idles: (sessionID: string) => idles.get(sessionID) ?? 0,
    /** 时间线进入会话(session.sync)后往上翻到头(history.loadMore)—— 整段历史都在 store 里。 */
    async open(sessionID: string) {
      await store.sync(sessionID)
      while (store.history.more(sessionID)) await store.history.loadMore(sessionID)
    },
    ids: (sessionID: string) => (store.data.message[sessionID] ?? []).map((message) => message.id),
    close: () => abort.abort(),
  }
}

type Window = Awaited<ReturnType<typeof openWindow>>

async function until(check: () => boolean | Promise<boolean>, message: string, ms = 15_000) {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(20)) if (await check()) return
  throw new Error(message)
}

/** composer 的发送(codepuppy-composer.tsx 的 session.promptAsync),等到每个订阅的窗口都收到这一轮的 session.idle。 */
async function send(from: Window, watching: Window[], sessionID: string, text: string) {
  const before = watching.map((window) => window.idles(sessionID))
  await from.client.session.promptAsync({
    sessionID,
    directory: host.projectDirectory,
    parts: [{ type: "text", text }],
    model: { providerID: "codepuppy", modelID: "m" },
  } as never)
  await until(() => watching.every((window, index) => window.idles(sessionID) > before[index]!), `the turn "${text}" did not end in every window`)
}

type EngineMessage = { id: string; type: string; text?: string }

/** 用户的 shell 命令,直接发给引擎(当前 composer 没有 shell 入口;这里代表任何「引擎自己落下的消息」)。 */
async function shell(sessionID: string, command: string) {
  expect((await running.send("POST", `/api/session/${sessionID}/shell`, { command })).status).toBeLessThan(300)
}

/** 引擎里的历史(进程内直读 2.x,不经适配器)。 */
async function engineHistory(sessionID: string) {
  const listed = await running.send("GET", `/api/session/${sessionID}/message?order=asc&limit=200`)
  expect(listed.status).toBe(200)
  return listed.json.data as EngineMessage[]
}

/** 适配器每个结构性事件之后重取的那一页,按它自己的读法(events.ts snapshot → recentMessages)。 */
async function adapterPage(sessionID: string) {
  const page = await recentMessages(OpenCode.make({ baseUrl: running.url, fetch: authorized }), sessionID, { limit: SNAPSHOT_WINDOW })
  return new Set(page.context.map((message) => message.id))
}

/** 引擎历史按冻结界面自己的投影(normalizeSessionMessages)显示成的那些消息 id —— 不经适配器。 */
const shown = (sessionID: string, history: EngineMessage[]) =>
  normalizeSessionMessages(sessionID, history as never).messages.map((message) => message.id)

const sorted = (ids: string[]) => [...ids].sort()

const partIDs = (window: Window, messageID: string) => (window.store.data.part[messageID] ?? []).map((part) => part.id)

describe("#1669 编辑重发:引擎删掉的旧问答也从界面上消失", () => {
  let sessionID: string
  let a: Window
  let b: Window
  let unprojected: Window
  let kept: string[]
  let doomed: string[]
  let edited: string

  beforeAll(async () => {
    a = await openWindow({ subscribe: true })
    b = await openWindow({ subscribe: true })
    unprojected = await openWindow({ subscribe: true, drop: "message.removed" })
    const created = await a.client.session.create({ directory: host.projectDirectory, title: "cp-1669-revert" } as never)
    sessionID = (created.data as { id: string }).id
    for (let turn = 1; turn <= TURNS; turn++) {
      if (turn === SHELLS_BEFORE.turn) for (const command of SHELLS_BEFORE.commands) await shell(sessionID, command)
      await send(a, [a, b, unprojected], sessionID, prompt(turn))
    }
    for (const window of [a, b, unprojected]) await window.open(sessionID)

    const history = await engineHistory(sessionID)
    edited = history.find((message) => message.type === "user" && message.text === `turn ${EDITED}`)!.id
    const boundary = history.findIndex((message) => message.id === edited)
    kept = shown(sessionID, history.slice(0, boundary))
    doomed = shown(sessionID, history.slice(boundary))
  }, 180_000)

  afterAll(() => {
    for (const window of [a, b, unprojected]) window?.close()
  })

  test("前提:长对话 —— 适配器重取的那一页里没有回退边界,被删的与保留的都有落在那一页之外的", async () => {
    const page = await adapterPage(sessionID)
    expect(page.has(edited)).toBe(false)
    expect(doomed.filter((id) => !page.has(id)).length).toBeGreaterThan(0)
    expect(kept.filter((id) => !page.has(id)).length).toBeGreaterThan(0)
    // 三个窗口都是整段历史,与引擎一致;被删的消息此刻都有 part。
    for (const window of [a, b, unprojected]) {
      expect(sorted(window.ids(sessionID))).toEqual(sorted([...kept, ...doomed]))
      for (const id of doomed) expect(partIDs(window, id).length).toBeGreaterThan(0)
    }
  }, 30_000)

  test("编辑中间一条:暂存回退期间什么都不删 —— 两个窗口都看到回退条,消息仍 = 引擎 = 重新加载", async () => {
    const prefilled: Array<{ text: string }> = []
    const rejected: unknown[] = []
    const identity = { serverKey: "local", directory: host.projectDirectory, sessionID }
    const edit = createSessionEditUserMessageHandler({
      current: () => ({ identity, project: "p", title: "t", activity: "idle" }),
      accepts: () => true,
      canEdit: () => true,
      session: () => ({ abort: (input) => a.client.session.abort(input), revert: (input) => a.client.session.revert(input) }),
      apply: (request) => prefilled.push(request),
      reject: (error) => rejected.push(error),
    })
    await edit({ sessionID, messageID: edited, text: `turn ${EDITED}` } as never)
    expect(rejected).toEqual([])
    expect(prefilled.map((request) => request.text)).toEqual([`turn ${EDITED}`])
    for (const window of [a, b])
      await until(() => window.store.data.info[sessionID]?.revert?.messageID === edited, "the staged revert never reached a window")

    const history = await engineHistory(sessionID)
    expect(sorted(shown(sessionID, history))).toEqual(sorted([...kept, ...doomed]))
    const fresh = await openWindow({ subscribe: false })
    await fresh.open(sessionID)
    for (const window of [a, b]) {
      expect(sorted(window.ids(sessionID))).toEqual(sorted(shown(sessionID, history)))
      expect(sorted(window.ids(sessionID))).toEqual(sorted(fresh.ids(sessionID)))
    }
  }, 30_000)

  test("暂存期间引擎又落下消息(三条 shell 命令):两个窗口照常显示它们,仍 = 引擎;适配器那一页里仍没有回退边界", async () => {
    // 每落一条,最近一页的边沿往后挪一条,仍落在暂存前那几条 shell 上:适配器不往前多拉,一直看不见回退边界。
    const before = new Set((await engineHistory(sessionID)).map((message) => message.id))
    for (const command of ["echo cp-1669-a", "echo cp-1669-b", "echo cp-1669-c"]) {
      await shell(sessionID, command)
      expect((await adapterPage(sessionID)).has(edited)).toBe(false)
    }
    const history = await engineHistory(sessionID)
    const shells = history.filter((message) => message.type === "shell" && !before.has(message.id))
    expect(shells.length).toBe(3)
    // shell 投影成两条:用户 `<id>` 与助手 `<id>:assistant`(冻结 normalizeSessionMessages)。
    const added = shown(sessionID, history).filter((id) => !kept.includes(id) && !doomed.includes(id))
    expect(sorted(added)).toEqual(sorted(shells.flatMap((shell) => [shell.id, `${shell.id}:assistant`])))
    for (const window of [a, b])
      await until(() => added.every((id) => window.ids(sessionID).includes(id)), "the shell messages never reached a window")
    for (const window of [a, b]) expect(sorted(window.ids(sessionID))).toEqual(sorted(shown(sessionID, history)))
    doomed = [...doomed, ...added]
  }, 30_000)

  test("重发:两个窗口的消息 = 引擎历史 = 重新加载;删掉的消息连 part 一起消失,不在最近一页的保留消息原样留着", async () => {
    await send(a, [a, b, unprojected], sessionID, `turn ${EDITED}, edited`)
    const now = shown(sessionID, await engineHistory(sessionID))
    // 引擎:边界起的全部删掉(连同暂存期间落下的 shell),剩边界之前的 + 新的一轮(用户 + 助手)。
    expect(now.slice(0, kept.length)).toEqual(kept)
    expect(now.length).toBe(kept.length + 2)
    for (const id of doomed) expect(now).not.toContain(id)
    // 提交之后,保留的消息里仍有不在适配器那一页的 —— 按「不在最近一页」判删除会把它们一起删掉。
    const page = await adapterPage(sessionID)
    expect(kept.filter((id) => !page.has(id)).length).toBeGreaterThan(0)

    const fresh = await openWindow({ subscribe: false })
    await fresh.open(sessionID)
    expect(fresh.ids(sessionID)).toEqual(now)
    for (const window of [a, b]) {
      expect(window.ids(sessionID)).toEqual(now)
      for (const id of doomed) expect(window.store.data.part[id]).toBeUndefined()
      for (const id of now) expect(partIDs(window, id)).toEqual(partIDs(fresh, id))
    }
    expect(a.store.data.info[sessionID]?.revert).toBeFalsy()
  }, 60_000)

  test("反向臂:同一条流去掉 message.removed ⇒ 被删的旧问答仍在界面上,与引擎不一致", async () => {
    const now = shown(sessionID, await engineHistory(sessionID))
    expect(unprojected.received.filter((payload) => payload.type === "message.removed").length).toBeGreaterThan(0)
    expect(unprojected.ids(sessionID)).not.toEqual(now)
    for (const id of doomed) {
      expect(unprojected.ids(sessionID)).toContain(id)
      expect(partIDs(unprojected, id).length).toBeGreaterThan(0)
    }
  }, 30_000)
})
