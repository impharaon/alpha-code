// `#1692`:长对话里取任务清单(`GET /session/:id/todo`,UC-18)不再读整段会话。
//
// 生产链:冻结界面的请求 → createEngineFetch → 路由表 → 2.x 客户端 → 假 2.x 上游。上游是一段按真引擎采样
// (fixtures/todo.json 的 `final`:用户消息、调 todowrite 的助手消息、收尾的助手消息、idle)复制出来的长会话,
// 分页语义同 2.x 消息接口(desc 首页 + `cursor.next` 往更早翻;asc 是整段读取),并记下一共交出去多少条消息。
import { describe, expect, test } from "bun:test"
import fixture from "./fixtures/todo.json"
import { createEngineFetch } from "./index"

const ENGINE = "http://127.0.0.1:47019"
const SESSION = fixture.sessionID
const [userTemplate, todoTemplate, replyTemplate, idleTemplate] = fixture.final as any[]

type Todo = { content: string; status: string }
const todosOf = (turn: number): Todo[] => [
  { content: `turn ${turn} step one`, status: "completed" },
  { content: `turn ${turn} step two`, status: "in_progress" },
]

/** 一个回合 = 采样里的四条消息;`write` 时助手消息调 todowrite(清单带回合号),否则只回一段文字。 */
function turnMessages(turn: number, write: boolean) {
  const base = 1_794_222_887_000 + turn * 10
  const id = (slot: number) => `msg_${String(turn).padStart(8, "0")}${slot}`
  const tool = todoTemplate.content.find((item: any) => item.type === "tool")
  const content = write
    ? [todoTemplate.content[0], { ...tool, id: `call_${turn}`, state: { ...tool.state, input: { todos: todosOf(turn) }, metadata: { ...tool.state.metadata, todos: todosOf(turn) } } }]
    : [todoTemplate.content[0]]
  return [
    { ...userTemplate, id: id(0), time: { created: base } },
    { ...todoTemplate, id: id(1), time: { ...todoTemplate.time, created: base + 1 }, content },
    { ...replyTemplate, id: id(2), time: { ...replyTemplate.time, created: base + 2 } },
    { ...idleTemplate, id: id(3), time: { created: base + 3 } },
  ]
}

/** 假 2.x 上游:`turns` 个回合(升序存),`writes` 里的回合写过任务清单。 */
function engine(turns: number, writes: Set<number>) {
  const all = Array.from({ length: turns }, (_, turn) => turnMessages(turn, writes.has(turn))).flat()
  const served = { messages: 0, requests: 0 }
  const cursorOf = (position: number, order: string) => Buffer.from(JSON.stringify({ position, order })).toString("base64url")
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url)
    if (url.pathname !== `/api/session/${SESSION}/message`) return new Response("unexpected", { status: 500 })
    const limit = Number(url.searchParams.get("limit"))
    const cursor = url.searchParams.get("cursor")
    const { position, order } = cursor
      ? (JSON.parse(Buffer.from(cursor, "base64url").toString()) as { position: number; order: string })
      : { position: url.searchParams.get("order") === "asc" ? 0 : all.length, order: url.searchParams.get("order") ?? "desc" }
    const data = order === "asc" ? all.slice(position, position + limit) : all.slice(Math.max(0, position - limit), position).reverse()
    const end = order === "asc" ? position + data.length : position - data.length
    const more = order === "asc" ? end < all.length : end > 0
    served.messages += data.length
    served.requests++
    return Response.json({ data, cursor: more ? { next: cursorOf(end, order) } : {} })
  }) as typeof globalThis.fetch
  return { total: all.length, served, engineFetch: createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch }) }
}

async function readTodo(source: ReturnType<typeof engine>) {
  const response = await source.engineFetch(`${ENGINE}/session/${SESSION}/todo`)
  expect(response.status).toBe(200)
  return (await response.json()) as Array<Todo & { priority: string }>
}

const withPriority = (todos: Todo[]) => todos.map((item) => ({ ...item, priority: "medium" }))

describe("#1692 任务清单不再读整段会话", () => {
  test("AC-01 2000+ 条消息、写过多次清单:只读最近一段(≤ 两页),结果 = 最后一次写入", async () => {
    // 525 回合 × 4 = 2100 条;每 10 个回合写一次,最后一次在倒数第 5 个回合。
    const writes = new Set(Array.from({ length: 53 }, (_, index) => index * 10).filter((turn) => turn <= 520))
    const source = engine(525, writes)
    expect(source.total).toBeGreaterThan(2000)
    expect(await readTodo(source)).toEqual(withPriority(todosOf(520)))
    expect(source.served.messages, `read ${source.served.messages} of ${source.total} messages`).toBeLessThanOrEqual(400)
  })

  test("AC-02 最近一段没有写入、更早有:往前找到那次更早的写入,不返回空", async () => {
    const source = engine(525, new Set([3]))
    expect(await readTodo(source)).toEqual(withPriority(todosOf(3)))
  })

  test("AC-02 写入就在第二页:找到即停,不再往更早翻", async () => {
    // 最新一页 200 条 = 最后 50 个回合(475..524);回合 460 在第二页。
    const source = engine(525, new Set([10, 460]))
    expect(await readTodo(source)).toEqual(withPriority(todosOf(460)))
    expect(source.served.messages).toBeLessThanOrEqual(600)
  })

  test("AC-03 从未写过清单的会话返回空列表(短会话与长会话)", async () => {
    expect(await readTodo(engine(3, new Set()))).toEqual([])
    const long = engine(525, new Set())
    expect(await readTodo(long)).toEqual([])
  })
})
