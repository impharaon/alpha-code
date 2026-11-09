// `#1668`:事件流投影(方案 §5 event-projection.test.ts)。
//
// 夹具 = 真 2.x 引擎采样(fixtures/*.json 的 `_source`):每条 `/api/event` 帧 + 该帧之后适配器那一刻读到的消息页。
// 这里把帧逐条喂给投影器(假 API 在每一帧回放那一刻的消息页),把投影出的 v1 事件交给**冻结 app 自己的**
// event-reducer 归约,再与同一会话最终 `GET /api/session/:id/message` 的投影逐字比:界面经事件流看到的,必须与
// 重新加载这个会话时看到的一样。反向臂:拿掉 `*.ended` / 工具终态之后的快照重取 ⇒ 工具 part 停在中间态 ⇒ 红。
import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { applyDirectoryEvent } from "../../../codepuppy-app/src/context/global-sync/event-reducer"
import readTool from "./fixtures/read-tool.json"
import todo from "./fixtures/todo.json"
import question from "./fixtures/question.json"
import { createProjector, SNAPSHOT_EVENTS, TURN_DIFF_EVENTS, TURN_END_EVENTS, type V1Payload } from "./events"
import { toV1Messages } from "./v1-shapes"

type Fixture = {
  directory: string
  sessionID: string
  records: Array<{ frame: { type: string; data: Record<string, any> }; snapshot?: { data: any[]; cursor: unknown } }>
  final: any[]
}

/** 假 2.x 客户端:消息页按「当前帧」回放采样;会话信息取自该会话的 session.created 帧。 */
function replayApi(fixture: Fixture) {
  let current: Fixture["records"][number] | undefined
  const created = fixture.records.find((record) => record.frame.type === "session.created")?.frame.data
  const api = {
    message: {
      list: async (input: { cursor?: string }) => {
        if (input.cursor) return { data: [], cursor: {} }
        return current?.snapshot ?? { data: [], cursor: {} }
      },
    },
    session: {
      diff: async () => [],
      get: async ({ sessionID }: { sessionID: string }) => ({
        id: sessionID,
        projectID: created?.projectID ?? "p",
        location: created?.location ?? { directory: fixture.directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 0, updated: 0 },
      }),
    },
  }
  return { api, at: (record: Fixture["records"][number]) => (current = record) }
}

async function project(fixture: Fixture) {
  const events: Array<{ directory: string; payload: V1Payload }> = []
  const { api, at } = replayApi(fixture)
  const projector = createProjector(api as never, (directory, payload) => events.push({ directory, payload }))
  for (const record of fixture.records) {
    at(record)
    await projector(record.frame as never)
  }
  return events
}

/** 冻结 app 的 v1 归约器 —— 与生产同一个函数。 */
function reduce(events: Array<{ directory: string; payload: V1Payload }>, directory: string) {
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
  const todos: Record<string, unknown> = {}
  for (const event of events) {
    if (event.directory !== directory) continue
    applyDirectoryEvent({
      event: event.payload,
      store,
      setStore,
      push: () => {},
      directory,
      loadLsp: () => {},
      setSessionTodo: (sessionID, list) => (todos[sessionID] = list),
    })
  }
  return { store, todos }
}

const plain = (value: unknown) => JSON.parse(JSON.stringify(value))

function expectSameAsReload(fixture: Fixture, store: any) {
  const reload = toV1Messages(fixture.sessionID, fixture.final)
  expect(plain(store.message[fixture.sessionID]).map((message: any) => message.id)).toEqual(reload.map((item) => item.info.id))
  for (const item of reload) {
    expect(plain(store.part[item.info.id] ?? [])).toEqual(plain(item.parts))
  }
}

describe("#1668 2.x 事件 → v1 事件(按冻结 app 的归约器)", () => {
  test("读文件回合:事件流归约出的消息与 part,与重新加载这个会话的投影逐字相同", async () => {
    const fixture = readTool as unknown as Fixture
    const { store } = reduce(await project(fixture), fixture.directory)
    expectSameAsReload(fixture, store)
    // 内容顺序:思考 → 正文 → 工具(part id 有序,0.1.26 的观感)
    const assistant = toV1Messages(fixture.sessionID, fixture.final).find((item) => item.info.role === "assistant")!
    expect(store.part[assistant.info.id].map((part: any) => part.type)).toEqual(["reasoning", "text", "tool"])
    expect(store.part[assistant.info.id][2].state.status).toBe("completed")
  })

  test("流式增量:正文先以 message.part.delta 一段段到达,part id 与最终快照同一个号", async () => {
    const fixture = readTool as unknown as Fixture
    const events = await project(fixture)
    const deltas = events.filter((event) => event.payload.type === "message.part.delta")
    expect(deltas.length).toBeGreaterThan(0)
    const final = toV1Messages(fixture.sessionID, fixture.final).flatMap((item) => item.parts.map((part) => part.id))
    for (const delta of deltas) expect(final).toContain((delta.payload.properties as { partID: string }).partID)
  })

  test("会话状态:execution.started ⇒ busy,succeeded ⇒ idle + session.idle", async () => {
    const fixture = readTool as unknown as Fixture
    const events = await project(fixture)
    const statuses = events
      .filter((event) => event.payload.type === "session.status")
      .map((event) => (event.payload.properties as { status: { type: string } }).status.type)
    expect(statuses[0]).toBe("busy")
    expect(statuses.at(-1)).toBe("idle")
    expect(events.some((event) => event.payload.type === "session.idle")).toBe(true)
  })

  test("忙闲:2.x 不发 session.status / session.idle,适配器由 execution.* 合成 —— 回合结束后 store 里是 idle", async () => {
    const fixture = readTool as unknown as Fixture
    expect(fixture.records.some((record) => record.frame.type === "session.status" || record.frame.type === "session.idle")).toBe(false)
    const { store } = reduce(await project(fixture), fixture.directory)
    expect(plain(store.session_status[fixture.sessionID])).toEqual({ type: "idle" })
  })

  test("反向臂:不合成回合结束 ⇒ 界面停在 busy(发送键一直是停止键)", async () => {
    const fixture = readTool as unknown as Fixture
    const removed = [...TURN_END_EVENTS]
    for (const type of removed) TURN_END_EVENTS.delete(type)
    try {
      const { store } = reduce(await project(fixture), fixture.directory)
      expect(plain(store.session_status[fixture.sessionID])).toEqual({ type: "busy" })
    } finally {
      for (const type of removed) TURN_END_EVENTS.add(type)
    }
  })

  test("U1 任务清单:todowrite 的输入投影成 todo.updated,归约后清单三条、状态原样", async () => {
    const fixture = todo as unknown as Fixture
    const { store, todos } = reduce(await project(fixture), fixture.directory)
    expectSameAsReload(fixture, store)
    expect(plain(store.todo[fixture.sessionID])).toEqual([
      { content: "Step one", status: "in_progress", priority: "medium" },
      { content: "Step two", status: "pending", priority: "medium" },
      { content: "Step three", status: "pending", priority: "medium" },
    ])
    expect(todos[fixture.sessionID]).toBeDefined()
  })

  test("提问:2.x 表单 ⇒ question.asked(v1 形状),回答后 question.replied 把它从待答里拿掉", async () => {
    const fixture = question as unknown as Fixture
    const events = await project(fixture)
    const asked = events.find((event) => event.payload.type === "question.asked")!
    expect(asked.payload.properties).toEqual({
      id: expect.stringMatching(/^frm_/),
      sessionID: fixture.sessionID,
      questions: [
        {
          question: "Which color?",
          header: "Color",
          options: [
            { label: "Red", description: "warm" },
            { label: "Blue", description: "cool" },
          ],
          multiple: false,
          custom: true,
        },
      ],
      tool: { messageID: expect.stringMatching(/^msg_/), callID: "call_mock_question_1" },
    })
    const replied = events.find((event) => event.payload.type === "question.replied")!
    expect((replied.payload.properties as { answers: string[][] }).answers).toEqual([["Blue"]])
    const { store } = reduce(events, fixture.directory)
    expect(plain(store.question[fixture.sessionID] ?? [])).toEqual([])
    expectSameAsReload(fixture, store)
  })

  // 采样里「工具调用」那一帧之后取的消息页已经是完成态(引擎几毫秒就跑完了 read),下一步开头的重取也会把上一条
  // 消息补成完成态 —— 所以反向臂只留回合起点那次重取(inbox.delivered),其余结构性重取全拿掉:正是「只靠流式
  // 增量、不按存储重取」的实现。
  test("反向臂:只靠流式增量、不按存储重取 ⇒ 工具 part 到不了完成态,与重新加载不一致", async () => {
    const fixture = readTool as unknown as Fixture
    const removed = [...SNAPSHOT_EVENTS].filter((type) => type !== "session.inbox.delivered")
    const turnBoundaries = [...TURN_DIFF_EVENTS]
    for (const type of removed) SNAPSHOT_EVENTS.delete(type)
    for (const type of turnBoundaries) TURN_DIFF_EVENTS.delete(type)
    try {
      const { store } = reduce(await project(fixture), fixture.directory)
      const assistant = toV1Messages(fixture.sessionID, fixture.final).find((item) => item.info.role === "assistant")!
      const tool = (store.part[assistant.info.id] ?? []).find((part: any) => part.type === "tool")
      expect(tool?.state.status).not.toBe("completed")
    } finally {
      for (const type of removed) SNAPSHOT_EVENTS.add(type)
      for (const type of turnBoundaries) TURN_DIFF_EVENTS.add(type)
    }
  })
})

describe("#1668 GET /global/event 经适配器的生产链", () => {
  test("v1 SDK 订阅的 /global/event 是 2.x /api/event 的投影:SSE 帧为 {directory, payload},订阅方中止即退订", async () => {
    const ENGINE = "http://127.0.0.1:47001"
    let upstreamAborted = false
    const frames = [
      { id: "evt_1", type: "server.connected", data: {} },
      { id: "evt_2", type: "pty.created", location: { directory: "/w" }, data: { info: { id: "pty_1", title: "t", command: "zsh", args: [], cwd: "/w", status: "running", pid: 1 } } },
    ]
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname !== "/api/event") return new Response("unexpected", { status: 500 })
      request.signal.addEventListener("abort", () => (upstreamAborted = true))
      const body = new ReadableStream({
        start(controller) {
          for (const frame of frames) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`))
        },
      })
      return new Response(body, { headers: { "content-type": "text/event-stream" } })
    }) as typeof globalThis.fetch
    const { createEngineFetch } = await import("./index")
    const engineFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch })
    const subscriber = new AbortController()
    const response = await engineFetch(`${ENGINE}/global/event`, { signal: subscriber.signal })
    expect(response.headers.get("content-type")).toBe("text/event-stream")
    const reader = response.body!.getReader()
    let text = ""
    while (text.split("\n\n").length < 3) text += new TextDecoder().decode((await reader.read()).value)
    const received = text.split("\n\n").filter(Boolean).map((block) => JSON.parse(block.replace(/^data: /, "")))
    expect(received).toEqual([
      { directory: "global", payload: { type: "server.connected", properties: {} } },
      { directory: "/w", payload: { type: "pty.created", properties: frames[1]!.data } },
    ])
    subscriber.abort()
    await reader.cancel().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(upstreamAborted).toBe(true)
  })
})
