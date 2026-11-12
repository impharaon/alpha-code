// `#1668` / REQ-142(l1r-review-turn-supply):右栏审阅面板读的回合改动,在 2.x 上由适配器供给。
//
// 生产链:2.x 事件 → 适配器投影 → 冻结 app 的 event-reducer → `session.data.message[sessionID]` → turnDiffsOf
// (review-panel.tsx 读的就是这一个函数);另一条入口是打开会话时的 `GET /session/:id/message` → 同一个 turnDiffsOf。
// 夹具 fixtures/turn-diff.json:真 2.x 引擎里一个写 b.txt 的回合,带每个步结束时的 `GET /api/session/:id/diff?from=`。
import { describe, expect, spyOn, test } from "bun:test"
import { createStore } from "solid-js/store"
import { applyDirectoryEvent } from "../../../codepuppy-app/src/context/global-sync/event-reducer"
import { turnDiffsOf } from "../renderer/codepuppy-ui/session-rail/review/review-turn-diffs"
import fixture from "./fixtures/turn-diff.json"
import continued from "./fixtures/continue.json"
import parity from "./fixtures/parity.json"
import tools from "./fixtures/tools.json"
import { createProjector, TURN_DIFF_EVENTS, type V1Payload } from "./events"
import { createPermissionReplies } from "./permission-replies"
import { createEngineFetch } from "./index"
import { CONTINUE_METADATA_KEY, toV1Messages } from "./v1-shapes"

type Record_ = { frame: { type: string; data: Record<string, any> }; snapshot?: { data: any[] }; diff?: { data: unknown[] } }
const records = fixture.records as unknown as Record_[]

async function viaEvents() {
  let current: Record_ | undefined
  let lastDiff: unknown[] = []
  const api = {
    message: { list: async (input: { cursor?: string }) => (input.cursor ? { data: [], cursor: {} } : (current?.snapshot ?? { data: [], cursor: {} })) },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => ({
        id: sessionID,
        projectID: "p",
        location: { directory: fixture.directory },
        time: { created: 0, updated: 0 },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
      diff: async () => {
        if (current?.diff) lastDiff = current.diff.data
        return lastDiff
      },
    },
  }
  const events: V1Payload[] = []
  const projector = createProjector(
    api as never,
    (directory, payload) => {
      if (directory === fixture.directory) events.push(payload)
    },
    createPermissionReplies(),
  )
  for (const record of records) {
    current = record
    await projector(record.frame as never)
  }
  const [store, setStore] = createStore<any>({ session: [], session_diff: {}, session_message: {}, message: {}, part: {}, part_text_accum_delta: {}, session_status: {}, todo: {}, permission: {}, question: {}, limit: 50, sessionTotal: 0 })
  for (const event of events)
    applyDirectoryEvent({ event, store, setStore, push: () => {}, directory: fixture.directory, loadLsp: () => {} })
  return turnDiffsOf(JSON.parse(JSON.stringify(store.message[fixture.sessionID])))
}

describe("#1668 REQ-142 回合改动经适配器供给", () => {
  test("事件流 → 冻结归约器 → turnDiffsOf:读到 2.x 这个回合的改动(b.txt 新增一行)", async () => {
    expect(await viaEvents()).toEqual(fixture.diff.data)
    expect(fixture.diff.data).toHaveLength(1)
  })

  test("打开会话 → GET /session/:id/message → turnDiffsOf:最新回合的用户消息带着同一份改动", async () => {
    const ENGINE = "http://127.0.0.1:47003"
    const engineFetch = createEngineFetch({
      isEngineOrigin: (origin) => origin === ENGINE,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(new Request(input, init).url)
        if (url.pathname.endsWith("/diff")) {
          expect(url.searchParams.get("from")).toBe(fixture.userID)
          return Response.json({ data: fixture.diff.data })
        }
        if (url.pathname.endsWith("/message")) return Response.json({ data: [...fixture.final].reverse(), cursor: {} })
        return new Response("unexpected", { status: 500 })
      }) as typeof fetch,
    })
    const response = await engineFetch(`${ENGINE}/session/${fixture.sessionID}/message?limit=50`)
    const messages = (await response.json()) as Array<{ info: unknown }>
    expect(turnDiffsOf(messages.map((item) => item.info))).toEqual(fixture.diff.data)
  })

  test("反向臂:不在回合边界取 2.x 的逐回合 diff ⇒ 面板读到空(审阅面板显示「没有改动」)", async () => {
    const removed = [...TURN_DIFF_EVENTS]
    for (const type of removed) TURN_DIFF_EVENTS.delete(type)
    try {
      expect(await viaEvents()).toEqual([])
    } finally {
      for (const type of removed) TURN_DIFF_EVENTS.add(type)
    }
  })
})

// R1 F2:时间线「继续」之后的回合。夹具 fixtures/continue.json:真 2.x 引擎里第一回合读 a.txt,第二回合是经适配器发出的「继续」
// (它那个回合写 c.txt);`legacy` 是同一续写落成 2.x synthetic 消息、再拿它当 diff 的 from —— 引擎回 400 not a user message。
describe("#1668 F2 「继续」之后的回合改动", () => {
  type Continued = { records: Record_[]; final: any[]; continueID: string; diff: { data: unknown[] }; sessionID: string; directory: string }
  const source = continued as unknown as Continued & { legacy: { sessionID: string; syntheticID: string; final: any[]; diff: { status: number; body: unknown } } }

  /** 假 2.x 上游:消息页 = 夹具 final(倒序);diff 只认真用户消息当 from(与引擎同一判据),其余回 400。 */
  function upstream(final: any[], diffs: Record<string, unknown[]>, calls: string[] = []) {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      calls.push(`${request.method} ${url.pathname}${url.search}`)
      if (url.pathname.endsWith("/diff")) {
        const from = url.searchParams.get("from")!
        const found = final.find((message) => message.id === from)
        if (found?.type !== "user")
          return Response.json({ _tag: "InvalidRequestError", message: `Message ${from} is not a user message`, field: "from" }, { status: 400 })
        return Response.json({ data: diffs[from] ?? [] })
      }
      if (url.pathname.endsWith("/message")) return Response.json({ data: [...final].reverse(), cursor: {} })
      if (url.pathname.endsWith("/prompt")) return Response.json({ data: { id: "msg_x" } })
      return new Response("unexpected", { status: 500 })
    }) as typeof fetch
  }
  const ENGINE = "http://127.0.0.1:47004"

  test("事件流 → 冻结归约器 → turnDiffsOf:读到「继续」那个回合的改动(c.txt 新增)", async () => {
    let current: Record_ | undefined
    let lastDiff: unknown[] = []
    const froms: string[] = []
    const api = {
      message: { list: async (input: { cursor?: string }) => (input.cursor ? { data: [], cursor: {} } : (current?.snapshot ?? { data: [], cursor: {} })) },
      session: {
        get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, location: { directory: source.directory }, time: { created: 0, updated: 0 } }),
        diff: async ({ from }: { from: string }) => {
          froms.push(from)
          if (current?.diff) lastDiff = current.diff.data
          return lastDiff
        },
      },
    }
    const events: V1Payload[] = []
    const projector = createProjector(api as never, (directory, payload) => directory === source.directory && events.push(payload), createPermissionReplies())
    for (const record of source.records) {
      current = record
      await projector(record.frame as never)
    }
    const [store, setStore] = createStore<any>({ session: [], session_diff: {}, session_message: {}, message: {}, part: {}, part_text_accum_delta: {}, session_status: {}, todo: {}, permission: {}, question: {}, limit: 50, sessionTotal: 0 })
    for (const event of events) applyDirectoryEvent({ event, store, setStore, push: () => {}, directory: source.directory, loadLsp: () => {} })
    expect(turnDiffsOf(JSON.parse(JSON.stringify(store.message[source.sessionID])))).toEqual(source.diff.data)
    expect(source.diff.data).toMatchObject([{ file: "c.txt", status: "added" }])
    expect(froms.at(-1)).toBe(source.continueID)
  })

  test("打开会话 → GET /session/:id/message:最新回合(「继续」)的用户消息带着同一份改动", async () => {
    const engineFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch: upstream(source.final, { [source.continueID]: source.diff.data }) })
    const messages = (await (await engineFetch(`${ENGINE}/session/${source.sessionID}/message?limit=50`)).json()) as Array<{ info: unknown }>
    expect(turnDiffsOf(messages.map((item) => item.info))).toEqual(source.diff.data)
  })

  test("v1 synthetic 隐藏语义保住:「继续」那条用户消息的正文是 synthetic(时间线不出气泡)", () => {
    const user = toV1Messages(source.sessionID, source.final).find((item) => item.info.id === source.continueID)!
    expect(user.info.role).toBe("user")
    expect(user.parts.filter((part) => part.type === "text")).toEqual([expect.objectContaining({ text: "Continue", synthetic: true })])
    // 普通用户消息不受影响
    const first = toV1Messages(source.sessionID, source.final).find((item) => item.info.role === "user")!
    expect(first.parts.find((part) => part.type === "text")).not.toHaveProperty("synthetic", true)
  })

  test("「继续」经适配器落成带标记的 2.x 真用户消息(prompt),不再是 synthetic 消息", async () => {
    const calls: Array<{ path: string; body: any }> = []
    const engineFetch = createEngineFetch({
      isEngineOrigin: (origin) => origin === ENGINE,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        calls.push({ path: new URL(request.url).pathname, body: await request.json().catch(() => undefined) })
        return Response.json({ data: { id: "msg_x" } })
      }) as typeof fetch,
    })
    const response = await engineFetch(`${ENGINE}/session/ses_1/prompt_async`, {
      method: "POST",
      body: JSON.stringify({ parts: [{ type: "text", text: "Continue", synthetic: true }] }),
    })
    expect(response.status).toBe(204)
    expect(calls).toEqual([{ path: "/api/session/ses_1/prompt", body: { text: "Continue", metadata: { [CONTINUE_METADATA_KEY]: true } } }])
  })

  test("最新回合没有可查的 2.x 用户锚(引擎自己的 synthetic)⇒ 不发必被拒的 diff;diff 真失败时记下错误、消息照回", async () => {
    // legacy:同一续写落成 2.x synthetic —— 引擎拒绝把它当 from(夹具里的真实回应)。
    expect(source.legacy.diff).toMatchObject({ status: 400, body: { message: expect.stringContaining("is not a user message") } })
    const calls: string[] = []
    const legacyFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch: upstream(source.legacy.final, {}, calls) })
    const listed = (await (await legacyFetch(`${ENGINE}/session/${source.legacy.sessionID}/message?limit=50`)).json()) as unknown[]
    expect(listed.length).toBeGreaterThan(0)
    expect(calls.filter((call) => call.includes("/diff"))).toEqual([])

    const errors = spyOn(console, "error").mockImplementation(() => {})
    try {
      const failing = createEngineFetch({
        isEngineOrigin: (origin) => origin === ENGINE,
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(new Request(input, init).url)
          if (url.pathname.endsWith("/diff")) return Response.json({ _tag: "SessionNotFoundError", message: "gone" }, { status: 404 })
          return Response.json({ data: [...source.final].reverse(), cursor: {} })
        }) as typeof fetch,
      })
      const response = await failing(`${ENGINE}/session/${source.sessionID}/message?limit=50`)
      expect(response.status).toBe(200)
      expect(errors.mock.calls.some((call) => String(call[0]).includes("turn diff failed"))).toBe(true)
    } finally {
      errors.mockRestore()
    }
  })
})

// 0.1.26 对照:后台子代理的完成通知是引擎发的 2.x synthetic(带 description),冻结投影把它当成最近一条用户消息。
describe("#1668 后台子代理完成通知之后的回合改动", () => {
  const ENGINE = "http://127.0.0.1:47008"
  const change = (fixture.diff.data as unknown[])[0]

  test("通知插进还在跑的回合(fixtures/tools.json 后台会话):按前一条用户消息查,改动挂在通知上,面板读得到", async () => {
    const session = (tools as unknown as { sessions: { background: { sessionID: string; final: any[] } } }).sessions.background
    const user = session.final.find((message) => message.type === "user")!
    const notice = session.final.find((message) => message.type === "synthetic")!
    const froms: Array<string | null> = []
    const engineFetch = createEngineFetch({
      isEngineOrigin: (origin) => origin === ENGINE,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(new Request(input, init).url)
        if (url.pathname.endsWith("/diff")) {
          froms.push(url.searchParams.get("from"))
          return Response.json({ data: [change] })
        }
        return Response.json({ data: [...session.final].reverse(), cursor: {} })
      }) as typeof fetch,
    })
    const messages = (await (await engineFetch(`${ENGINE}/session/${session.sessionID}/message?limit=50`)).json()) as Array<{ info: any }>
    expect(messages.filter((item) => item.info.role === "user").at(-1)!.info.id).toBe(notice.id)
    expect(froms).toEqual([user.id])
    expect(turnDiffsOf(messages.map((item) => item.info))).toEqual([change])
    // 通知仍是 synthetic 正文(时间线不出气泡)
    expect(toV1Messages(session.sessionID, session.final).find((item) => item.info.id === notice.id)!.parts).toEqual([
      expect.objectContaining({ type: "text", synthetic: true }),
    ])
  })

  test("通知在 idle 之后自己开回合(fixtures/parity.json):2.x 没有能查它的锚 —— 不发请求", async () => {
    const background = (parity as unknown as { background: { sessionID: string; final: any[]; diffs: Record<string, { status: number; body: any }> } }).background
    // 实测:这个回合写了 b.txt,但从用户消息 / 不带 from 问到的是上一回合(空),从通知问回 400。
    const types = background.final.map((message) => message.type)
    expect(types.indexOf("synthetic")).toBeGreaterThan(types.indexOf("idle"))
    expect(background.final.some((message) => message.type === "assistant" && message.snapshot?.files?.includes("b.txt"))).toBe(true)
    expect(background.diffs.latest.body.data).toEqual([])
    expect(background.diffs.fromUser.body.data).toEqual([])
    expect(background.diffs.fromSynthetic.status).toBe(400)
    const calls: string[] = []
    const engineFetch = createEngineFetch({
      isEngineOrigin: (origin) => origin === ENGINE,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(new Request(input, init).url)
        calls.push(url.pathname)
        return Response.json({ data: [...background.final].reverse(), cursor: {} })
      }) as typeof fetch,
    })
    await engineFetch(`${ENGINE}/session/${background.sessionID}/message?limit=50`)
    expect(calls.filter((path) => path.endsWith("/diff"))).toEqual([])
  })
})
