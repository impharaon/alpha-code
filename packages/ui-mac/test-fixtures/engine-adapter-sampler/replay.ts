// `#1697`(I-04):夹具差分 —— 把全部采样夹具回放进适配器,输出逐个写成一份按键排序的 JSON。不进任何门;用法见 README.md
// 「前后差分」一节:改适配器之前跑一次、改完再跑一次,两份 `diff` 为空才算翻译器输出逐个相等(设计 §4.10 c、§9)。
//
// HTTP 一半走生产的 createEngineFetch:假 2.x 上游只用夹具里的数据答(消息分页同 2.x 语义),冻结界面会发的 v1 请求逐个发。
// 事件一半逐帧喂投影器(做法同 event-projection.test.ts:每帧之后的消息页取那一帧采样时读到的)。
// 前后两次跑之间只有下面「怎样建投影器」这几行可以不同(搬家改路径、换参数时在同一个提交里改)。
import { createEngineFetch } from "../../src/engine-adapter/index"
import { createProjector } from "../../src/engine-adapter/opencode2/events"
import { createReceiptLedger } from "../../src/engine-adapter/contract/receipts"
const projector = (api: unknown, emit: (directory: string, payload: unknown) => void) =>
  createProjector(api as never, emit as never, createReceiptLedger())

import catalog from "../../src/engine-adapter/fixtures/catalog.json"
import command from "../../src/engine-adapter/fixtures/command.json"
import continued from "../../src/engine-adapter/fixtures/continue.json"
import files from "../../src/engine-adapter/fixtures/files.json"
import lineage from "../../src/engine-adapter/fixtures/lineage.json"
import parity from "../../src/engine-adapter/fixtures/parity.json"
import permissionAsked from "../../src/engine-adapter/fixtures/permission-asked.json"
import permissionReply from "../../src/engine-adapter/fixtures/permission-reply.json"
import question from "../../src/engine-adapter/fixtures/question.json"
import readTool from "../../src/engine-adapter/fixtures/read-tool.json"
import todo from "../../src/engine-adapter/fixtures/todo.json"
import tools from "../../src/engine-adapter/fixtures/tools.json"
import turnDiff from "../../src/engine-adapter/fixtures/turn-diff.json"

const ENGINE = "http://127.0.0.1:47099"
type Message = { id: string; type: string }
type Store = {
  sessionID: string
  directory: string
  messages: readonly Message[]
  diffs?: Record<string, unknown[]>
  forms?: unknown
  permissions?: unknown
  /** 命令剧本:引擎在收到 command 之前没有这些消息。 */
  afterCommand?: boolean
  /** 目录类读取(catalog.json):`/api/agent`、`/api/provider`、`/api/model`、`/api/model/default`、`/api/session`。 */
  catalog?: typeof catalog
}

const cursorOf = (position: number, order: string) => Buffer.from(JSON.stringify({ position, order })).toString("base64url")

/** 假 2.x 上游:只认适配器为这些 v1 请求会打的端点,别的一律 500(也进输出,前后照比)。 */
function upstream(store: Store) {
  let commanded = !store.afterCommand
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const path = url.pathname
    const session = `/api/session/${store.sessionID}`
    if (path === `${session}/message`) {
      const all = commanded ? store.messages : []
      const limit = Number(url.searchParams.get("limit") ?? 200)
      const cursor = url.searchParams.get("cursor")
      const { position, order } = cursor
        ? (JSON.parse(Buffer.from(cursor, "base64url").toString()) as { position: number; order: string })
        : { position: url.searchParams.get("order") === "asc" ? 0 : all.length, order: url.searchParams.get("order") ?? "desc" }
      const data = order === "asc" ? all.slice(position, position + limit) : all.slice(Math.max(0, position - limit), position).reverse()
      const end = order === "asc" ? position + data.length : position - data.length
      const more = order === "asc" ? end < all.length : end > 0
      return Response.json({ data, cursor: more ? { next: cursorOf(end, order) } : {} })
    }
    if (path === `${session}/diff`) return Response.json({ data: store.diffs?.[url.searchParams.get("from") ?? ""] ?? [] })
    if (path === session)
      return Response.json({ data: { id: store.sessionID, projectID: "p", location: { directory: store.directory }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 0, updated: 0 } } })
    if (path === `${session}/command`) {
      commanded = true
      return new Response(null, { status: 204 })
    }
    if (path === "/api/session/active") return Response.json({ data: {} })
    if (path === "/api/skill") return Response.json({ data: [] })
    if (path === "/api/form" && store.forms) return Response.json(store.forms)
    if (path === "/api/permission/request" && store.permissions) return Response.json(store.permissions)
    if (store.catalog) {
      const table: Record<string, unknown> = {
        "/api/agent": store.catalog.agents,
        "/api/provider": store.catalog.providers,
        "/api/model": store.catalog.models,
        "/api/model/default": store.catalog.defaultModel,
        "/api/session": store.catalog.sessions,
      }
      if (path in table) return Response.json(table[path])
    }
    return new Response(`unexpected ${request.method} ${path}`, { status: 500 })
  }) as typeof globalThis.fetch
}

async function exchange(engineFetch: ReturnType<typeof createEngineFetch>, method: string, path: string, body?: unknown) {
  const response = await engineFetch(`${ENGINE}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const text = await response.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {}
  return { request: `${method} ${path}`, status: response.status, next: response.headers.get("x-next-cursor"), body: parsed }
}

/** 一个会话的消息读取:全量、两条一页往前翻、逐条、任务清单。 */
async function messages(store: Store) {
  const engineFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch: upstream(store) })
  const base = `/session/${store.sessionID}`
  const out = [await exchange(engineFetch, "GET", `${base}/message?directory=${encodeURIComponent(store.directory)}`)]
  let before: string | null = null
  do {
    const page = await exchange(engineFetch, "GET", `${base}/message?limit=2${before ? `&before=${encodeURIComponent(before)}` : ""}`)
    out.push(page)
    before = page.next
  } while (before && out.length < 50)
  for (const message of store.messages) out.push(await exchange(engineFetch, "GET", `${base}/message/${message.id}`))
  out.push(await exchange(engineFetch, "GET", `${base}/todo`))
  return out
}

type Records = ReadonlyArray<{ frame: unknown; snapshot?: unknown; diff?: { data: unknown[] } }>

/** 事件:逐帧喂投影器,记下投影出的每个 v1 帧。 */
async function events(directory: string, records: Records) {
  let current: Records[number] | undefined
  let lastDiff: unknown[] = []
  const out: unknown[] = []
  const api = {
    message: { list: async (input: { cursor?: string }) => (input.cursor ? { data: [], cursor: {} } : (current?.snapshot ?? { data: [], cursor: {} })) },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, projectID: "p", location: { directory }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 0, updated: 0 } }),
      diff: async () => {
        if (current?.diff) lastDiff = current.diff.data
        return lastDiff
      },
    },
    shell: { output: async () => ({ data: { cursor: 0, output: "" } }) },
  }
  const project = projector(api, (frameDirectory, payload) => out.push({ directory: frameDirectory, payload }))
  for (const record of records) {
    current = record
    await project(record.frame)
  }
  return out
}

const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, sorted(item)]))
      : value

const session = (sessionID: string, directory: string, final: unknown[], extra: Partial<Store> = {}): Store => ({
  sessionID,
  directory,
  messages: final as Message[],
  ...extra,
})

const result: Record<string, unknown> = {}
for (const [name, fixture] of Object.entries({ "read-tool": readTool, todo, question, command, files } as Record<string, any>)) {
  if (fixture.final) result[`${name}.messages`] = await messages(session(fixture.sessionID, fixture.directory, fixture.final))
  result[`${name}.events`] = await events(fixture.directory, fixture.records)
}
result["turn-diff.messages"] = await messages(session(turnDiff.sessionID, turnDiff.directory, turnDiff.final, { diffs: { [turnDiff.userID]: turnDiff.diff.data } }))
result["turn-diff.events"] = await events(turnDiff.directory, turnDiff.records as Records)
result["continue.messages"] = await messages(session(continued.sessionID, continued.directory, continued.final, { diffs: { [continued.continueID]: continued.diff.data } }))
result["continue.events"] = await events(continued.directory, continued.records as Records)
for (const [name, entry] of Object.entries(tools.sessions as Record<string, any>)) {
  result[`tools.${name}.messages`] = await messages(session(entry.sessionID, tools.directory, entry.final))
  if (entry.records) result[`tools.${name}.events`] = await events(tools.directory, entry.records)
}
for (const name of ["dir", "shell", "background"] as const)
  result[`parity.${name}.messages`] = await messages(session(parity[name].sessionID, parity.directory, parity[name].final))
result["parity.shell.events"] = await events(parity.directory, parity.shell.records as Records)
{
  const store = session(question.sessionID, question.directory, question.final, { forms: question.formList })
  const engineFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch: upstream(store) })
  result["question.list"] = await exchange(engineFetch, "GET", `/question?directory=${encodeURIComponent(question.directory)}`)
}
for (const [name, list] of Object.entries({
  "permission-asked": permissionAsked.list,
  "permission-reply": { data: [...permissionReply.pendingA.body.data, ...permissionReply.pendingB.body.data] },
})) {
  const engineFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch: upstream({ sessionID: "-", directory: "-", messages: [], permissions: list }) })
  result[`${name}.list`] = await exchange(engineFetch, "GET", "/permission")
}
result["permission-asked.events"] = await events("-", [{ frame: permissionAsked.frame }])
result["lineage.messages"] = await messages(session(lineage.sessionID, lineage.directory, lineage.final))
{
  const engineFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch: upstream({ sessionID: "-", directory: "-", messages: [], catalog }) })
  const at = `?directory=${encodeURIComponent(catalog.directory)}`
  for (const path of ["/agent", "/provider", "/session", "/session?roots=true&limit=1", "/experimental/session", "/api/model", "/api/agent", "/api/session"])
    result[`catalog GET ${path}`] = await exchange(engineFetch, "GET", `${path}${path.includes("?") ? "&" : "?"}${at.slice(1)}`)
}
{
  const store = session(command.sessionID, command.directory, command.final, { afterCommand: true })
  const engineFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch: upstream(store) })
  result["command.reply"] = await exchange(engineFetch, "POST", `/session/${command.sessionID}/command`, { command: "hello", arguments: "" })
}

process.stdout.write(`${JSON.stringify(sorted(result), null, 1)}\n`)
process.exit(0)
