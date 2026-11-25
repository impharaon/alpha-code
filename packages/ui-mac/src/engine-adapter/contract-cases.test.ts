// `#1697`(I-04 M5c,设计 §4.10 c、R11):约定里每条**翻译**路由(非直通、非固定答复)都至少有一个经真入口的用例,输入来自
// 本代采样器对真引擎的采样,期望来自翻译器之外 —— UC 不变量、冻结消费方自己的归一函数(只在测试里 import)、或样本里的
// 引擎原值;不拿被测翻译器算出来的值当期望。
//   · 台账(LEDGER):每条翻译路由及 0.2.0 的固定健康探针 → 这里的回放用例,或已有的、经 createEngineFetch 的那条测试(文件 + 测试名);少一条、
//     多一条、指向不存在的测试都红。
//   · 回放:fixtures/routes.json(采样器 `routes` 剧本)里每条路由的 v1 请求原样经 createEngineFetch 发出,假 2.x 上游按记下的
//     往返逐个作答,并记下适配器这次实际发给引擎的请求(方法、路径、请求体、头)。
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { normalizeAgentList } from "../../../codepuppy-app/src/context/global-sync/utils"
import { normalizeSessionInfo } from "../../../codepuppy-app/src/utils/session"
import { SERVED, FIXED, type TranslatedKey } from "./contract/routes"
import type { ContractEventType } from "./contract/events"
import events from "./fixtures/events.json"
import routes from "./fixtures/routes.json"
import { createEngineFetch } from "./index"
import { passthrough, ROUTES } from "./opencode2/routes"

const ENGINE = "http://127.0.0.1:47071"
type Upstream = { method: string; path: string; status: number; contentType: string | null; body: unknown }
type Case = { request: { method: string; path: string; body?: unknown; headers?: Record<string, string> }; upstream: Upstream[]; status: number }
const CASES = routes.cases as unknown as Record<string, Case>

type Sent = { method: string; path: string; body: any; headers: Headers }
type Replayed = { status: number; body: any; sent: Sent[]; raw: (index: number) => any; request: Case["request"] }

async function replay(key: string): Promise<Replayed> {
  const recorded = CASES[key]!
  const queue = [...recorded.upstream]
  const sent: Sent[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text()
    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {}
    sent.push({ method: request.method, path: `${url.pathname}${url.search}`, body, headers: request.headers })
    const index = queue.findIndex((item) => item.method === request.method && item.path === `${url.pathname}${url.search}`)
    if (index < 0) return new Response(`no recorded exchange for ${request.method} ${url.pathname}${url.search}`, { status: 599 })
    const [exchange] = queue.splice(index, 1)
    if (exchange!.body === null) return new Response(null, { status: exchange!.status })
    const payload = typeof exchange!.body === "string" && !exchange!.contentType?.includes("json") ? exchange!.body : JSON.stringify(exchange!.body)
    return new Response(payload, { status: exchange!.status, headers: exchange!.contentType ? { "content-type": exchange!.contentType } : {} })
  }) as typeof globalThis.fetch
  const engineFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch })
  const { method, path, body, headers } = recorded.request
  const response = await engineFetch(`${ENGINE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {}
  return { status: response.status, body: parsed, sent, raw: (index) => recorded.upstream[index]!.body, request: recorded.request }
}

const sentTo = (replayed: Replayed, method: string, pathPrefix: string) =>
  replayed.sent.find((item) => item.method === method && item.path.startsWith(pathPrefix))
const pathOf = (replayed: Replayed) => replayed.request.path.split("?")[0]!
const sessionsOf = (raw: any) => (raw.data as any[]).map((session) => normalizeSessionInfo(session))

/** 每条采样路由的期望:只用 v1 请求、采样里的引擎原值、UC 与冻结消费方。 */
const CHECKS: Record<string, (r: Replayed) => void> = {
  "GET /global/health": (r) => expect(r.body).toEqual({ healthy: true, version: r.raw(0).version }), // UC-01
  // 0.2.0:约定侧固定答 v1,期望是冻结探协议消费方认的形状,不从适配器录下的响应取。
  "GET /api/health": (r) => {
    expect(r.body).toEqual({ healthy: true })
    expect(r.sent).toEqual([])
  },
  "GET /path": (r) => expect(r.body).toEqual({ home: "", state: "", config: "", worktree: r.raw(0).project.canonical, directory: r.raw(0).directory }),
  "GET /project": (r) =>
    expect(r.body.map((project: any) => [project.id, project.worktree])).toEqual(r.raw(0).map((project: any) => [project.id, project.canonical])),
  "GET /project/current": (r) => expect(r.body).toMatchObject({ id: r.raw(0).project.id, worktree: r.raw(0).project.canonical }),
  "GET /api/project/current": (r) => expect(r.body).toEqual({ id: r.raw(0).project.id, directory: r.raw(0).project.canonical }),
  "PATCH /project/:projectID": (r) => {
    expect(sentTo(r, "PATCH", "/api/project/")!.body.name).toBe(r.request.body && (r.request.body as any).name)
    expect(r.body).toMatchObject({ id: r.raw(0).id, worktree: r.raw(0).canonical, name: r.raw(0).name })
  },
  "POST /project/git/init": (r) => {
    expect(sentTo(r, "POST", "/api/vcs/init")).toBeDefined()
    expect(r.body).toMatchObject({ id: r.raw(1).project.id, worktree: r.raw(1).project.canonical })
  },
  "GET /session": (r) => expect(r.body).toEqual(sessionsOf(r.raw(0))),
  "GET /experimental/session": (r) => expect(r.body).toEqual(sessionsOf(r.raw(0)).map((session) => ({ ...session, project: null }))),
  "POST /session": (r) => {
    expect(sentTo(r, "POST", "/api/session")!.body.title).toBe((r.request.body as any).title)
    expect(r.body).toEqual(normalizeSessionInfo(r.raw(0).data))
  },
  "GET /session/status": (r) =>
    expect(r.body).toEqual(Object.fromEntries(Object.keys(r.raw(0).data).map((sessionID) => [sessionID, { type: "busy" }]))),
  "GET /session/:sessionID": (r) => expect(r.body).toEqual(normalizeSessionInfo(r.raw(0).data)),
  "PATCH /session/:sessionID": (r) => {
    expect(sentTo(r, "PATCH", "/api/session/")!.body.title).toBe((r.request.body as any).title)
    expect(r.body).toEqual(normalizeSessionInfo(r.raw(1).data))
  },
  "POST /session/:sessionID/fork": (r) => {
    expect(JSON.stringify(sentTo(r, "POST", "/api/session/")!.body)).toContain((r.request.body as any).messageID)
    expect(r.body).toEqual(normalizeSessionInfo(r.raw(0).data))
  },
  "POST /session/:sessionID/abort": (r) => {
    expect(sentTo(r, "POST", `/api/session/${pathOf(r).split("/")[2]}/interrupt`)).toBeDefined()
    expect(r.body).toBe(true)
  },
  "POST /session/:sessionID/prompt_async": (r) => {
    expect(r.status).toBe(204)
    expect(sentTo(r, "POST", "/api/session/")!.body.text).toBe((r.request.body as any).parts[0].text)
  },
  "POST /session/:sessionID/shell": (r) => {
    expect(sentTo(r, "POST", `/api/session/${pathOf(r).split("/")[2]}/agent`)!.body).toMatchObject({ agent: (r.request.body as any).agent })
    expect(sentTo(r, "POST", `/api/session/${pathOf(r).split("/")[2]}/shell`)!.body.command).toBe((r.request.body as any).command)
    expect(r.body).toEqual({})
  },
  "GET /session/:sessionID/message/:messageID": (r) => {
    const messageID = pathOf(r).split("/")[4]!
    const stored = (r.raw(0).data as any[]).find((message) => message.id === messageID)
    expect(r.body.info).toMatchObject({ id: messageID, role: stored.type === "user" ? "user" : "assistant" })
    expect(r.body.parts.filter((part: any) => part.type === "text").map((part: any) => part.text)).toEqual([stored.text])
  },
  "POST /session/:sessionID/revert": (r) => {
    expect(sentTo(r, "POST", "/api/session/")!.body.messageID).toBe((r.request.body as any).messageID)
    expect(r.body).toEqual(normalizeSessionInfo(r.raw(1).data))
  },
  "POST /session/:sessionID/unrevert": (r) => {
    expect(sentTo(r, "DELETE", `/api/session/${pathOf(r).split("/")[2]}/revert`)).toBeDefined()
    expect(r.body).toEqual(normalizeSessionInfo(r.raw(1).data))
  },
  "POST /session/:sessionID/summarize": (r) => {
    expect(sentTo(r, "POST", `/api/session/${pathOf(r).split("/")[2]}/compact`)).toBeDefined()
    expect(r.body).toBe(true)
  },
  "POST /api/session/:sessionID/rename": (r) => {
    expect(r.status).toBe(204)
    expect(sentTo(r, "PATCH", "/api/session/")!.body.title).toBe((r.request.body as any).title)
  },
  "DELETE /session/:sessionID": (r) => {
    expect(sentTo(r, "DELETE", "/api/session/")).toBeDefined()
    expect(r.body).toBe(true)
  },
  "GET /agent": (r) => expect(r.body).toEqual(normalizeAgentList(r.raw(0).data)),
  "GET /command": (r) => {
    expect(r.body.map((command: any) => [command.name, command.source])).toEqual([
      ...r.raw(0).data.map((command: any) => [command.name, "command"]),
      ...r.raw(1).data.map((skill: any) => [skill.id, "skill"]),
    ])
  },
  "GET /mcp": (r) =>
    expect(Object.entries(r.body).map(([name, status]: [string, any]) => [name, status.status])).toEqual(
      r.raw(0).data.map((server: any) => [server.name, server.status.status]),
    ),
  "GET /experimental/resource": (r) =>
    expect(Object.keys(r.body)).toEqual(r.raw(0).data.resources.map((resource: any) => `${resource.server}:${resource.uri}`)),
  "POST /mcp/:name/connect": (r) => {
    expect(sentTo(r, "POST", `/api/experimental/mcp/${pathOf(r).split("/")[2]}/connect`)).toBeDefined()
    expect(r.body).toBe(true)
  },
  "POST /mcp/:name/disconnect": (r) => {
    expect(sentTo(r, "POST", `/api/experimental/mcp/${pathOf(r).split("/")[2]}/disconnect`)).toBeDefined()
    expect(r.body).toBe(true)
  },
  "POST /api/mcp/:server/connect": (r) => {
    expect(sentTo(r, "POST", `/api/experimental/mcp/${pathOf(r).split("/")[3]}/connect`)).toBeDefined()
    expect(r.status).toBe(204)
  },
  "POST /api/mcp/:server/disconnect": (r) => {
    expect(sentTo(r, "POST", `/api/experimental/mcp/${pathOf(r).split("/")[3]}/disconnect`)).toBeDefined()
    expect(r.status).toBe(204)
  },
  "GET /vcs": (r) => expect(r.body).toEqual({ branch: r.raw(0).data.branch.current, default_branch: r.raw(0).data.branch.default }),
  "GET /vcs/status": (r) => expect(r.body).toEqual(r.raw(0).data),
  "GET /vcs/diff": (r) => {
    expect(sentTo(r, "GET", "/api/vcs/diff")!.path).toContain("mode=working")
    expect(r.body).toEqual(r.raw(0).data)
  },
  "GET /file": (r) => {
    const directory = r.raw(0).location.directory as string
    expect(r.body.map((node: any) => [node.path, node.absolute, node.type])).toEqual(
      r.raw(0).data.map((entry: any) => [entry.path.replace(/\/$/, ""), `${directory}/${entry.path.replace(/\/$/, "")}`, entry.type]),
    )
  },
  "GET /file/content": (r) => expect(r.body).toEqual({ type: "text", content: r.raw(0) }),
  "GET /find/file": (r) =>
    expect(r.body).toEqual(r.raw(0).data.map((entry: any) => entry.path).filter((path: string) => path !== "/" && path !== "")),
  "GET /question": (r) => {
    // UC-13:v1 QuestionRequest 由 2.x 表单的字段直接对上(题干 = description,标题 = title,选项文字原样)
    const forms = (r.raw(0).data as any[]).filter((form) => form.metadata?.kind === "question")
    expect(r.body.map((question: any) => [question.id, question.sessionID, question.questions.map((item: any) => [item.question, item.header, item.options.map((option: any) => option.label)])])).toEqual(
      forms.map((form) => [form.id, form.sessionID, form.fields.map((field: any) => [field.description ?? "", field.title ?? "", (field.options ?? []).map((option: any) => option.label)])]),
    )
  },
  "POST /question/:requestID/reply": (r) => {
    // UC-13:回答按题序,单选给第一项
    expect(sentTo(r, "POST", "/api/session/")!.body).toMatchObject({ answer: { q0: (r.request.body as any).answers[0][0] } })
    expect(r.body).toBe(true)
  },
  "POST /question/:requestID/reject": (r) => {
    expect(sentTo(r, "DELETE", "/api/session/")!.path).toContain(`/form/${pathOf(r).split("/")[2]}`)
    expect(r.body).toBe(true)
  },
  "POST /pty": (r) => {
    expect(sentTo(r, "POST", "/api/pty")!.body.title).toBe((r.request.body as any).title)
    expect(r.body).toEqual(r.raw(0).data)
  },
  "GET /pty": (r) => expect(r.body).toEqual(r.raw(0).data),
  "GET /pty/shells": (r) => expect(r.body).toEqual(r.raw(0)),
  "GET /pty/:ptyID": (r) => expect(r.body).toEqual(r.raw(0).data),
  "PUT /pty/:ptyID": (r) => {
    expect(sentTo(r, "PUT", "/api/pty/")!.body).toMatchObject(r.request.body as object)
    expect(r.body).toEqual(r.raw(0).data)
  },
  "POST /pty/:ptyID/connect-token": (r) => {
    expect(sentTo(r, "POST", "/api/pty/")!.headers.get("x-opencode-ticket")).toBe(r.request.headers!["x-opencode-ticket"]!)
    expect(r.body).toEqual(r.raw(0).data)
  },
  "DELETE /pty/:ptyID": (r) => {
    expect(sentTo(r, "DELETE", "/api/pty/")).toBeDefined()
    expect(r.body).toBe(true)
  },
  "GET /api/model": (r) =>
    expect(r.body.data.map((model: any) => [model.providerID, model.id])).toEqual(r.raw(0).data.map((model: any) => [model.providerID, model.id])),
  "POST /instance/dispose": (r) => {
    expect(sentTo(r, "POST", "/api/location/reload")).toBeDefined()
    expect(r.body).toBe(true)
  },
}

/** 已有测试证明的翻译路由(都经 createEngineFetch,输入来自采样夹具或沙箱真引擎)。 */
const EXISTING: Record<string, { file: string; test: string }> = {
  "GET /global/event": { file: "event-projection.test.ts", test: "v1 SDK 订阅的 /global/event 是 2.x /api/event 的投影:SSE 帧为 {directory, payload},订阅方中止即退订" },
  "POST /session/:sessionID/command": { file: "command-reply.test.ts", test: "v1 响应的 info.id = 这条命令那个回合的助手消息,命令来源 chip 对得上回合" },
  "GET /session/:sessionID/message": { file: "engine-cases.test.ts", test: "模型不可用 / BYOK 401 / 平台 401 / 402 两种 / 429 / 平台凭据读不到(开头 / 两步之间)/ 拒连,两条入口的回合错误行(turn-failure.engine.cases.ts,9 条)" },
  "GET /session/:sessionID/todo": { file: "todo-route.test.ts", test: "AC-01 2000+ 条消息、写过多次清单:只读最近一段(≤ 两页),结果 = 最后一次写入" },
  "GET /provider": { file: "projection-parity.test.ts", test: "provider 经真入口:createEngineFetch 的 GET /provider 回的就是这份转换(deprecated 模型在 HTTP 输出里)" },
  "POST /mcp/:name/auth/authenticate": { file: "mcp-auth.test.ts", test: "complete ⇒ 回 connected;紧接着的 /mcp 也是 connected(定制中心判成功)" },
  "GET /permission": { file: "permission-reply.test.ts", test: "v1 通道(审批卡的实际路径):once 经 replyPermissionV1 落到引擎,冻结 feed 收卡;v2 入口回 `{data: 收据}`,收据各字段齐" },
  "POST /permission/:requestID/reply": { file: "permission-reply.test.ts", test: "v1 通道(审批卡的实际路径):once 经 replyPermissionV1 落到引擎,冻结 feed 收卡;v2 入口回 `{data: 收据}`,收据各字段齐" },
  "POST /session/:sessionID/permissions/:permissionID": { file: "permission-shape.test.ts", test: "三个回复入口都接到回执逻辑(不再是 501 桩):这个窗口没交出过的请求 ⇒ 409,一个字节都不发往引擎" },
  "POST /api/session/:sessionID/permission/:requestID/reply": { file: "permission-reply.test.ts", test: "同一命令再来一次 ⇒ 同一张收据,引擎只收到一次;反向臂:真引擎对同一 id 的第二次回复是 404(采样)" },
}

/** 约定里的翻译路由(非直通、非固定答复)。 */
const TRANSLATED = (Object.keys(SERVED) as TranslatedKey[]).filter((key) => !(key in FIXED) && ROUTES[key] !== passthrough).sort()
/** 翻译路由之外,也核 0.2.0 新增的固定健康探针;其余固定答复仍由 unsupported.test.ts 核。 */
const CASE_ROUTES = [...TRANSLATED, "GET /api/health"].sort()

/** 台账核对:交回缺口(空 = 每条翻译路由都有用例)。 */
export function ledgerProblems(translated: readonly string[], checks: Record<string, unknown>, existing: Record<string, { file: string; test: string }>, cases: Record<string, unknown>) {
  const out: string[] = []
  for (const key of translated) {
    if (key in checks && key in existing) out.push(`${key}: 同时登记了回放用例与已有测试`)
    else if (key in checks) {
      if (!(key in cases)) out.push(`${key}: routes.json 里没有它的样本`)
    } else if (key in existing) {
      const file = join(import.meta.dir, existing[key]!.file)
      if (!existsSync(file)) out.push(`${key}: ${existing[key]!.file} 不存在`)
      else if (!readFileSync(file, "utf8").includes(`"${existing[key]!.test}"`)) out.push(`${key}: ${existing[key]!.file} 里没有「${existing[key]!.test}」`)
    } else out.push(`${key}: 没有用例`)
  }
  for (const key of [...Object.keys(checks), ...Object.keys(existing)]) if (!translated.includes(key)) out.push(`${key}: 不是约定里的翻译路由`)
  return out
}

describe("#1697 每条翻译路由都有经真入口的采样用例(设计 §4.10 c)", () => {
  test("台账:每条翻译路由恰好登记一次 —— 回放用例或已有测试", () => {
    expect(TRANSLATED.length).toBeGreaterThanOrEqual(59)
    expect(ledgerProblems(CASE_ROUTES, CHECKS, EXISTING, CASES)).toEqual([])
  })

  test("反向臂:台账少一条、指向不存在的测试名、多一条目录外的键 —— 各被点名", () => {
    const { "GET /vcs": _dropped, ...fewer } = CHECKS
    expect(ledgerProblems(CASE_ROUTES, fewer, EXISTING, CASES)).toEqual(["GET /vcs: 没有用例"])
    const renamed = { ...EXISTING, "GET /provider": { file: "projection-parity.test.ts", test: "no such test" } }
    expect(ledgerProblems(CASE_ROUTES, CHECKS, renamed, CASES)).toEqual(["GET /provider: projection-parity.test.ts 里没有「no such test」"])
    expect(ledgerProblems([...CASE_ROUTES, "GET /brand-new"], CHECKS, EXISTING, CASES)).toEqual(["GET /brand-new: 没有用例"])
    expect(ledgerProblems(CASE_ROUTES, { ...CHECKS, "GET /not-in-catalog": () => {} }, EXISTING, CASES)).toEqual(["GET /not-in-catalog: 不是约定里的翻译路由"])
  })

  for (const key of Object.keys(CHECKS).sort())
    test(`回放 ${key}`, async () => {
      const replayed = await replay(key)
      expect(replayed.status, JSON.stringify(replayed.body).slice(0, 300)).toBeLessThan(300)
      CHECKS[key]!(replayed)
    })
})

// ── 事件(设计 §4.5、§4.10 c):约定事件表里的每种事件都有用例 ─────────────────────────────────────────────────────────
// 回放:fixtures/events.json(采样器 `events` 剧本)里的一帧经 createEngineFetch 的 GET /global/event 投影;假 2.x 上游只放这一帧,
// 会话读取与消息页按采样作答。期望来自帧本身的引擎原值、UC 与冻结消费方(normalizeSessionInfo)。

type Frame = { type: string; location?: { directory?: string } | null; data: any }
const FRAMES = (events.frames as Array<{ frame: Frame; snapshot?: unknown }>).map((item) => item.frame)
const SESSIONS = events.sessions as Record<string, unknown>
const frameOf = (type: string, where: (frame: Frame) => boolean = () => true) => FRAMES.find((frame) => frame.type === type && where(frame))!

async function project(frame: Frame) {
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url)
    if (url.pathname === "/api/event")
      return new Response(`data: ${JSON.stringify(frame)}\n\n`, { headers: { "content-type": "text/event-stream" } })
    const session = /^\/api\/session\/([^/]+)$/.exec(url.pathname)?.[1]
    if (session)
      return session in SESSIONS
        ? Response.json({ data: SESSIONS[session] })
        : Response.json({ _tag: "SessionNotFoundError", message: `Session not found: ${session}` }, { status: 404 })
    if (url.pathname.endsWith("/message")) return Response.json({ data: [], cursor: {} })
    if (url.pathname.endsWith("/diff")) return Response.json({ data: [] })
    return new Response(`unexpected ${url.pathname}`, { status: 599 })
  }) as typeof globalThis.fetch
  const engineFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch })
  const response = await engineFetch(`${ENGINE}/global/event`)
  const text = await response.text()
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)) as { directory: string; payload: { type: string; properties: any } })
}

const directoryOf = (frame: Frame) => frame.location?.directory ?? "global"
const sameShape = (type: ContractEventType, source = type as string) => async () => {
  const frame = frameOf(source)
  expect(await project(frame)).toContainEqual({ directory: directoryOf(frame), payload: { type, properties: frame.data } })
}

const EVENT_CHECKS: Partial<Record<ContractEventType, () => Promise<void>>> = {
  // 两代同形的直通:载荷原样(设计 §4.5)
  "pty.created": sameShape("pty.created"),
  "pty.updated": sameShape("pty.updated"),
  "pty.exited": sameShape("pty.exited"),
  "pty.deleted": sameShape("pty.deleted"),
  "vcs.branch.updated": sameShape("vcs.branch.updated"),
  "reference.updated": sameShape("reference.updated"),
  "mcp.status.changed": sameShape("mcp.status.changed"),
  "mcp.resources.changed": sameShape("mcp.resources.changed"),
  "server.connected": async () => {
    const frame = events.serverConnected as Frame
    expect(await project(frame)).toContainEqual({ directory: "global", payload: { type: "server.connected", properties: frame.data } })
  },
  // 改名与派生
  "server.instance.disposed": async () => {
    const frame = frameOf("location.shutdown")
    expect(await project(frame)).toContainEqual({
      directory: directoryOf(frame),
      payload: { type: "server.instance.disposed", properties: { directory: directoryOf(frame) } },
    })
  },
  "catalog.updated": async () => {
    for (const source of ["agent.updated", "command.updated", "skill.updated"]) {
      const frame = frameOf(source)
      expect(await project(frame)).toContainEqual({ directory: directoryOf(frame), payload: { type: "catalog.updated", properties: {} } })
    }
  },
  "project.updated": async () => {
    const frame = frameOf("project.updated")
    const [event] = (await project(frame)).filter((item) => item.payload.type === "project.updated")
    expect(event!.payload.properties).toMatchObject({ id: frame.data.id, worktree: frame.data.canonical })
    expect("canonical" in event!.payload.properties).toBe(false)
  },
  "session.created": async () => {
    const frame = frameOf("session.created", (item) => item.data.sessionID in SESSIONS)
    expect(await project(frame)).toContainEqual({
      directory: directoryOf(frame),
      payload: { type: "session.created", properties: { info: normalizeSessionInfo(SESSIONS[frame.data.sessionID] as never) } },
    })
  },
  "session.updated": async () => {
    const frame = frameOf("session.renamed", (item) => item.data.sessionID in SESSIONS)
    expect(await project(frame)).toContainEqual({
      directory: directoryOf(frame),
      payload: { type: "session.updated", properties: { info: normalizeSessionInfo(SESSIONS[frame.data.sessionID] as never) } },
    })
  },
  "session.deleted": async () => {
    const frame = frameOf("session.deleted")
    const [event] = (await project(frame)).filter((item) => item.payload.type === "session.deleted")
    expect(event!.payload.properties.sessionID).toBe(frame.data.sessionID)
  },
  "session.usage.updated": async () => {
    const frame = frameOf("session.usage.updated", (item) => item.data.sessionID in SESSIONS)
    const [event] = (await project(frame)).filter((item) => item.payload.type === "session.usage.updated")
    expect(event!.payload.properties).toEqual(frame.data)
  },
  "question.rejected": async () => {
    const frame = frameOf("form.cancelled")
    expect(await project(frame)).toContainEqual({
      directory: directoryOf(frame),
      payload: { type: "question.rejected", properties: { sessionID: frame.data.sessionID, requestID: frame.data.id } },
    })
  },
}

/** 已有测试证明的事件(记录或现场采集的真引擎帧,交冻结 app 的归约 / 冻结消费方判)。 */
const EXISTING_EVENTS: Partial<Record<ContractEventType, { file: string; test: string }>> = {
  "message.updated": { file: "engine-cases.test.ts", test: "#1669 审批等待中追加一句:回答前两个窗口与重新加载都有这条用户消息、反向臂(去掉 session.inbox.enqueued)没有、允许一次后一条气泡 = 引擎 = 重新加载、停止后留在收件箱气泡留着(queued-prompt.engine.cases.ts,4 条)" },
  "message.removed": { file: "engine-cases.test.ts", test: "#1669 长对话编辑重发:暂存不删、重发后两个窗口 = 引擎 = 重新加载、暂存期间落下的消息一并删、反向臂(去掉 message.removed)旧问答残留(revert-removal.engine.cases.ts,5 条)" },
  "message.part.updated": { file: "event-projection.test.ts", test: "读文件回合:事件流归约出的消息与 part,与重新加载这个会话的投影逐字相同" },
  "message.part.delta": { file: "event-projection.test.ts", test: "流式增量:正文先以 message.part.delta 一段段到达,part id 与最终快照同一个号" },
  "session.status": { file: "event-projection.test.ts", test: "会话状态:execution.started ⇒ busy,succeeded ⇒ idle + session.idle" },
  "session.idle": { file: "event-projection.test.ts", test: "会话状态:execution.started ⇒ busy,succeeded ⇒ idle + session.idle" },
  "session.error": { file: "failure-code.test.ts", test: "会话错误(事件流):session.error 与重试状态的文本同样去掉前缀,网络层同样带上" },
  "todo.updated": { file: "event-projection.test.ts", test: "U1 任务清单:todowrite 的输入投影成 todo.updated,归约后清单三条、状态原样" },
  "question.asked": { file: "event-projection.test.ts", test: "提问:2.x 表单 ⇒ question.asked(v1 形状),回答后 question.replied 把它从待答里拿掉" },
  "question.replied": { file: "event-projection.test.ts", test: "提问:2.x 表单 ⇒ question.asked(v1 形状),回答后 question.replied 把它从待答里拿掉" },
  "file.watcher.updated": { file: "file-watcher.test.ts", test: "filesystem.changed(不带 sessionID)→ 那个目录频道上的 file.watcher.updated,面板照原样收下" },
  "permission.asked": { file: "engine-cases.test.ts", test: "命令卡标题与记忆范围、patch 改文件卡(command-approval.engine.cases.ts,2 条)" },
  "permission.replied": { file: "permission-reply.test.ts", test: "v1 通道:连带的 replied 帧经投影器成为 v1 permission.replied,冻结 feed 逐条收卡" },
}

/**
 * 引擎不发的四种(R17,编排器 2026-11-13):引擎的公开事件流(`/api/event` 只发 packages/schema/src/event-manifest.ts 的
 * `ServerDefinitions`)不含它们,约定事件表与直通集合因此不收。这里守着引擎自己的清单:哪天它开始发其中任何一种,下面那条就红,
 * 约定要有意识地扩(加进事件表、补采样用例)。冻结界面里收它们的处理只是永远不触发,与今天相同。
 */
const ENGINE_DOES_NOT_EMIT = ["lsp.updated", "global.disposed", "mcp.tools.changed", "mcp.prompts.changed"] as const

const EVENT_TYPES: ContractEventType[] = [
  "pty.created", "pty.updated", "pty.exited", "pty.deleted", "vcs.branch.updated", "reference.updated",
  "server.connected", "mcp.status.changed", "mcp.resources.changed", "server.instance.disposed", "catalog.updated",
  "project.updated", "permission.asked",
  "permission.replied", "question.asked", "question.replied", "question.rejected", "file.watcher.updated",
  "session.created", "session.updated", "session.deleted", "session.usage.updated", "message.updated", "message.removed",
  "message.part.updated", "message.part.delta", "todo.updated", "session.status", "session.error", "session.idle",
] satisfies ContractEventType[]

/** 约定里声明的事件表的键(读 contract/events.ts 的 ContractEventMap,台账据此核「恰好全部」)。 */
function declaredEventTypes() {
  const source = readFileSync(join(import.meta.dir, "contract/events.ts"), "utf8")
  const block = source.slice(source.indexOf("export type ContractEventMap = {"), source.indexOf("\n}\n", source.indexOf("export type ContractEventMap = {")))
  return [...block.matchAll(/^  "([a-z.]+)":/gm)].map((match) => match[1]!).sort()
}

describe("#1697 事件表里每种事件都有用例(设计 §4.10 c)", () => {
  test("台账:事件表里每种事件恰好一处 —— 回放用例或已有测试;引擎不发的四种不在表里", async () => {
    expect([...EVENT_TYPES].sort()).toEqual(declaredEventTypes())
    expect(EVENT_TYPES.length).toBe(30)
    expect(declaredEventTypes().filter((type) => (ENGINE_DOES_NOT_EMIT as readonly string[]).includes(type))).toEqual([])
    const covered = (type: ContractEventType) => [type in EVENT_CHECKS, type in EXISTING_EVENTS].filter(Boolean).length
    expect(EVENT_TYPES.filter((type) => covered(type) !== 1)).toEqual([])
    for (const [type, existing] of Object.entries(EXISTING_EVENTS)) {
      const file = join(import.meta.dir, existing!.file)
      expect(existsSync(file) && readFileSync(file, "utf8").includes(`"${existing!.test}"`), `${type}: ${existing!.file}`).toBe(true)
    }
  })

  test("守卫:引擎公开事件流(event-manifest 的 Server)不含约定不收的那四种;对照:mcp.status.changed、pty.created 在", async () => {
    const { Server } = await import("../../../schema/src/event-manifest")
    expect(ENGINE_DOES_NOT_EMIT.filter((type) => Server.has(type))).toEqual([])
    expect(Server.has("mcp.status.changed")).toBe(true)
    expect(Server.has("pty.created")).toBe(true)
  })

  for (const type of Object.keys(EVENT_CHECKS).sort() as ContractEventType[]) test(`回放事件 ${type}`, () => EVENT_CHECKS[type]!())
})
