// `#1668` / REQ-142(l1r-review-turn-supply):右栏审阅面板读的回合改动,在 2.x 上由适配器供给。
//
// 生产链:2.x 事件 → 适配器投影 → 冻结 app 的 event-reducer → `session.data.message[sessionID]` → turnDiffsOf
// (review-panel.tsx 读的就是这一个函数);另一条入口是打开会话时的 `GET /session/:id/message` → 同一个 turnDiffsOf。
// 夹具 fixtures/turn-diff.json:真 2.x 引擎里一个写 b.txt 的回合,带每个步结束时的 `GET /api/session/:id/diff?from=`。
import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { applyDirectoryEvent } from "../../../../codepuppy-app/src/context/global-sync/event-reducer"
import { turnDiffsOf } from "../codepuppy-ui/session-rail/review/review-turn-diffs"
import fixture from "./fixtures/turn-diff.json"
import { createProjector, TURN_DIFF_EVENTS, type V1Payload } from "./events"
import { createEngineFetch } from "./index"

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
  const projector = createProjector(api as never, (directory, payload) => {
    if (directory === fixture.directory) events.push(payload)
  })
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
