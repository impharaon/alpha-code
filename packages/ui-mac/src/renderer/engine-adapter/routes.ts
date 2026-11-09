// `#1668`:适配器的路由表 —— v1 形状的唯一权威(方案 §2.3、§10)。冻结界面发出的每个引擎请求要么在这里有
// handler,要么落在 UNSUPPORTED(写明为什么到不了 / 为什么不支持);两者都没有的请求由 index.ts 响亮 501。
// 覆盖由 engine-adapter/routes-coverage.test.ts 从冻结源码里扫出的全部调用来判。
//
// 路径两类:无 `/api` 前缀的是 v1 SDK 发的(冻结 app 的 v1 路径与 renderer 自己的客户端);`/api/…` 是 v1 SDK
// 的 `v2.*` 命名空间与冻结 app 自带的 1.17.13 客户端发的,在 2.x 合并目标 `33f94fce96` 上路径与形状仍在的直通,
// 已删或挪走的改写。
import type { OpenCodeClient } from "@opencode/client/promise"
import type { QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { normalizeAgentList, normalizePermissionRequest, normalizeSessionInfo } from "./frozen-shapes"
import { projectEventStream } from "./events"
import { recentMessages, sessionDirectory } from "./session-cache"
import {
  syntheticText,
  toFormAnswer,
  toPrompt,
  toV1Commands,
  toV1FileNodes,
  toV1McpStatus,
  toV1Messages,
  toV1Path,
  toV1Project,
  toV1ProviderList,
  toV1Question,
  todosOf,
  type V1PromptBody,
} from "./v1-shapes"

export type RouteContext = {
  params: Record<string, string>
  query: URLSearchParams
  body: any
  directory?: string
  request: Request
  signal: AbortSignal
  api: OpenCodeClient
  origin: string
  /** 对引擎源地址发一个原始请求(SSE、二进制读文件这类不经类型化客户端的)。 */
  upstream: (path: string, init?: RequestInit) => Promise<Response>
  /** 把这次请求原样转给引擎(2.x 上路径与形状都没变的那些)。 */
  passthrough: () => Promise<Response>
}

export type Route = { method: string; path: string; handle: (context: RouteContext) => Promise<Response> }

const json = (value: unknown, init?: ResponseInit) => Response.json(value, init)
const ok = () => json(true)
const noContent = () => new Response(null, { status: 204 })
const at = (context: RouteContext) => (context.directory ? { location: { directory: context.directory } } : {})
const number = (value: string | null) => (value === null || value === "" ? undefined : Number(value))

const route = (method: string, path: string, handle: Route["handle"]): Route => ({ method, path, handle })
const passthrough = (method: string, path: string) => route(method, path, (context) => context.passthrough())

/** 2.x 的会话分页拉全(v1 的列表不分页;侧栏的全局索引按「一页拉完」处理,见 experimental.session.list)。 */
async function allSessions(api: OpenCodeClient, input: Parameters<OpenCodeClient["session"]["list"]>[0]) {
  const out: Awaited<ReturnType<OpenCodeClient["session"]["list"]>>["data"] = []
  let cursor: string | undefined
  for (;;) {
    const page = await api.session.list({ ...input, limit: 200, cursor })
    out.push(...page.data)
    if (page.data.length < 200 || !page.cursor.next) return out
    cursor = page.cursor.next
  }
}

// ── 权限回复(I7a):暂缓,等 L4 的回执规格(编排器 2026-11-09,#1666 评论 6737732975)───────────────────
// 冻结界面读 PermissionV2DecisionReceipt(session-permission-feed.ts、PermissionDialog.tsx、permission-surface.tsx、
// permission-v1-adapter.ts);2.x 的回复语义由 L4 实测后给出回执规格,适配器照规格合成。在那之前这里是
// **明确标注的桩**:回复请求一律 501,不猜回执形状、不静默吞掉。
const PERMISSION_REPLY_PENDING = "permission reply awaits the L4 receipt spec (#1666)"
const permissionReplyPending = (context: RouteContext) => {
  console.error(`[engine-adapter] ${PERMISSION_REPLY_PENDING}: ${context.request.method} ${new URL(context.request.url).pathname}`)
  return Promise.resolve(
    json({ name: "CodePuppyEngineAdapterUnsupported", data: { reason: PERMISSION_REPLY_PENDING } }, { status: 501 }),
  )
}

/** 提问(2.x 表单)的 requestID → sessionID:v1 回答只带 requestID,2.x 要会话。先查列表,再查全局。 */
async function questionOf(context: RouteContext, requestID: string) {
  const forms = await context.api.form.list(at(context))
  const form = forms.data.find((item) => item.id === requestID)
  return form ? { sessionID: form.sessionID, question: toV1Question(form) } : undefined
}

async function prompt(context: RouteContext) {
  const sessionID = context.params.sessionID!
  const body = context.body as V1PromptBody
  // v1 的档位与模型随每条消息走;2.x 落在会话上 —— 发送前切到这条消息要的档位与模型。
  if (body.agent) await context.api.session.switchAgent({ sessionID, agent: body.agent })
  if (body.model)
    await context.api.session.switchModel({
      sessionID,
      model: { providerID: body.model.providerID, id: body.model.modelID, ...(body.variant ? { variant: body.variant } : {}) },
    })
  const synthetic = syntheticText(body.parts)
  if (synthetic !== undefined) {
    // 时间线的「继续」:v1 落一条只含 synthetic 文本的用户消息(界面不显示正文、但开一个新回合)。
    await context.api.session.synthetic({ sessionID, text: synthetic, description: synthetic, resume: true })
    return noContent()
  }
  const { text, files, agents } = toPrompt(body.parts)
  await context.api.session.prompt({
    sessionID,
    ...(body.messageID ? { id: body.messageID } : {}),
    text,
    ...(files.length ? { files } : {}),
    ...(agents.length ? { agents } : {}),
  })
  return noContent()
}

/** v1 `session.messages`:最近 `limit` 条(或全部),`before` 翻更早的页,`x-next-cursor` 给下一页。 */
async function messages(context: RouteContext) {
  const sessionID = context.params.sessionID!
  const limit = number(context.query.get("limit"))
  const before = context.query.get("before") ?? undefined
  const page = await recentMessages(context.api, sessionID, { limit, cursor: before })
  const response = json(toV1Messages(sessionID, page.context).filter((item) => page.ids.has(baseID(item.info.id))))
  if (page.next) response.headers.set("x-next-cursor", page.next)
  return response
}

const baseID = (id: string) => id.replace(/:assistant$/, "")


export const ROUTES: readonly Route[] = [
  // ── 探活与引擎实例 ──
  route("GET", "/global/health", async (context) => {
    const info = await context.api.server.info()
    return json({ healthy: true, version: info.version })
  }),
  route("POST", "/instance/dispose", async (context) => {
    // 2.x 的重载重建**全部** Location(seams Q5),v1 的 instance.dispose 只释放一个目录;语义更宽、方向安全。
    await context.api.location.reload()
    return ok()
  }),
  route("GET", "/global/event", (context) => Promise.resolve(projectEventStream(context))),
  route("GET", "/path", async (context) => json(toV1Path(await context.api.location.get(at(context))))),
  // v1 的配置对象在 2.x 拆成多份配置文档(`GET /api/config` 回文档数组,键名也换了)。冻结 app 的 v2 支路对配置给的就是
  // 空对象(bootstrap.ts loadGlobalConfigQuery / bootstrapDirectory 的 config 步);这里同一约定。v1 路径上读它的只有
  // local.tsx 的默认模型回落(先读 provider 列表的 defaultModel,2.x 的 model.default 已经给了)与 permission.tsx 的
  // 客户端自动回复判断(`config.permission === "allow"`,空对象 ⇒ 不自动回复,审批由引擎与 ext 决定)。
  route("GET", "/global/config", async () => json({})),
  route("GET", "/config", async () => json({})),

  // ── 项目(U2 选 A:2.x 自己有项目清单,`canonical` 改名 `worktree`)──
  route("GET", "/project", async (context) => json((await context.api.project.list()).map((p) => toV1Project(p as never)))),
  route("GET", "/project/current", async (context) => json(await currentProject(context))),
  route("GET", "/api/project/current", async (context) => {
    const project = await currentProject(context)
    return json({ id: project.id, directory: project.worktree })
  }),
  route("PATCH", "/project/:projectID", async (context) => {
    const { name, icon, commands } = (context.body ?? {}) as { name?: string; icon?: never; commands?: never }
    const updated = await context.api.project.update({ projectID: context.params.projectID!, name, icon, commands })
    return json(toV1Project(updated as never))
  }),
  route("POST", "/project/git/init", async (context) => {
    await context.api.vcs.init(at(context))
    return json(await currentProject(context))
  }),

  // ── 会话 ──
  route("GET", "/session", async (context) => {
    const roots = context.query.get("roots") === "true"
    const search = context.query.get("search") ?? undefined
    const limit = number(context.query.get("limit"))
    const directory = context.directory
    // 侧栏的 `scope: "project"`:同一项目全部目录下的会话(v1 语义),2.x 按项目 id 查。
    const project =
      context.query.get("scope") === "project" && directory
        ? (await context.api.location.get({ location: { directory } })).project.id
        : undefined
    const sessions = await allSessions(context.api, {
      ...(project ? { project } : directory ? { directory } : {}),
      ...(roots ? { parentID: null } : {}),
      ...(search ? { search } : {}),
    })
    const out = sessions.map((session) => normalizeSessionInfo(session as never))
    return json(limit ? out.slice(0, limit) : out)
  }),
  route("GET", "/experimental/session", async (context) => {
    const roots = context.query.get("roots") === "true"
    const search = context.query.get("search") ?? undefined
    // v1 的游标是数字时间戳,2.x 是不透明字符串:一次拉完、不给 x-next-cursor(调用方读不到游标即止)。
    const sessions = await allSessions(context.api, { ...(roots ? { parentID: null } : {}), ...(search ? { search } : {}) })
    return json(sessions.map((session) => ({ ...normalizeSessionInfo(session as never), project: null })))
  }),
  route("POST", "/session", async (context) => {
    const body = (context.body ?? {}) as { parentID?: string; title?: string }
    const created = await context.api.session.create({
      ...at(context),
      ...(body.parentID ? { parentID: body.parentID } : {}),
      ...(body.title ? { title: body.title } : {}),
    })
    return json(normalizeSessionInfo(created as never))
  }),
  route("GET", "/session/status", async (context) => {
    const active = await context.api.session.active()
    return json(Object.fromEntries(Object.keys(active).map((sessionID) => [sessionID, { type: "busy" }])))
  }),
  route("GET", "/session/:sessionID", async (context) =>
    json(normalizeSessionInfo((await context.api.session.get({ sessionID: context.params.sessionID! })) as never)),
  ),
  route("PATCH", "/session/:sessionID", async (context) => {
    const sessionID = context.params.sessionID!
    const body = (context.body ?? {}) as { title?: string; time?: { archived?: number } }
    await context.api.session.update({
      sessionID,
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.time && "archived" in body.time ? { archived: !!body.time.archived } : {}),
    })
    return json(normalizeSessionInfo((await context.api.session.get({ sessionID })) as never))
  }),
  route("DELETE", "/session/:sessionID", async (context) => {
    await context.api.session.remove({ sessionID: context.params.sessionID! })
    return ok()
  }),
  route("POST", "/session/:sessionID/fork", async (context) => {
    const body = (context.body ?? {}) as { messageID?: string }
    const forked = await context.api.session.fork({
      sessionID: context.params.sessionID!,
      ...(body.messageID ? { before: body.messageID } : {}),
    })
    return json(normalizeSessionInfo(forked as never))
  }),
  route("POST", "/session/:sessionID/abort", async (context) => {
    await context.api.session.interrupt({ sessionID: context.params.sessionID! })
    return ok()
  }),
  route("POST", "/session/:sessionID/prompt_async", prompt),
  route("POST", "/session/:sessionID/command", async (context) => {
    const sessionID = context.params.sessionID!
    const body = (context.body ?? {}) as { command: string; arguments?: string; agent?: string; model?: string; variant?: string }
    if (body.agent) await context.api.session.switchAgent({ sessionID, agent: body.agent })
    const [providerID, ...rest] = body.model?.split("/") ?? []
    if (providerID && rest.length)
      await context.api.session.switchModel({
        sessionID,
        model: { providerID, id: rest.join("/"), ...(body.variant ? { variant: body.variant } : {}) },
      })
    // v1 引擎把技能列成命令(toV1Commands);2.x 的技能经 prompt 的 `skills` 调用。
    const skills = await context.api.skill.list({ location: { directory: await sessionDirectory(context.api, sessionID) } })
    if (skills.data.some((skill) => skill.id === body.command)) {
      await context.api.session.prompt({ sessionID, text: body.arguments ?? "", skills: [{ id: body.command }] })
      return json({})
    }
    await context.api.session.command({ sessionID, name: body.command, text: body.arguments ?? "" })
    return json({})
  }),
  route("POST", "/session/:sessionID/shell", async (context) => {
    const body = (context.body ?? {}) as { command: string; agent?: string }
    const sessionID = context.params.sessionID!
    if (body.agent) await context.api.session.switchAgent({ sessionID, agent: body.agent })
    await context.api.session.shell({ sessionID, command: body.command })
    return json({})
  }),
  route("POST", "/session/:sessionID/summarize", async (context) => {
    await context.api.session.compact({ sessionID: context.params.sessionID! })
    return ok()
  }),
  route("POST", "/session/:sessionID/revert", async (context) => {
    const sessionID = context.params.sessionID!
    const body = (context.body ?? {}) as { messageID: string }
    await context.api.session.revert.stage({ sessionID, messageID: body.messageID })
    return json(normalizeSessionInfo((await context.api.session.get({ sessionID })) as never))
  }),
  route("POST", "/session/:sessionID/unrevert", async (context) => {
    const sessionID = context.params.sessionID!
    await context.api.session.revert.clear({ sessionID })
    return json(normalizeSessionInfo((await context.api.session.get({ sessionID })) as never))
  }),
  route("GET", "/session/:sessionID/message", messages),
  // U1:2.x 没有 todo 查询端点;清单就是会话里最近一次 todowrite 的输入(与事件流的 todo.updated 同一来源)。
  route("GET", "/session/:sessionID/todo", async (context) => {
    const sessionID = context.params.sessionID!
    const page = await recentMessages(context.api, sessionID, {})
    const parts = toV1Messages(sessionID, page.context).flatMap((item) => item.parts)
    const last = parts.findLast((part) => part.type === "tool" && part.tool === "todowrite")
    return json(last ? todosOf(last) : [])
  }),
  route("GET", "/session/:sessionID/message/:messageID", async (context) => {
    const sessionID = context.params.sessionID!
    const messageID = context.params.messageID!
    const page = await recentMessages(context.api, sessionID, { through: messageID })
    const found = toV1Messages(sessionID, page.context).find((item) => item.info.id === messageID)
    return found ? json(found) : json({ name: "NotFoundError", data: { message: `Message not found: ${messageID}` } }, { status: 404 })
  }),

  // ── 目录内的只读查询 ──
  route("GET", "/agent", async (context) => json(normalizeAgentList((await context.api.agent.list(at(context))).data as never))),
  route("GET", "/command", async (context) => {
    const [commands, skills] = await Promise.all([context.api.command.list(at(context)), context.api.skill.list(at(context))])
    return json(toV1Commands(commands.data, skills.data))
  }),
  route("GET", "/provider", async (context) => {
    const [providers, models, defaultModel] = await Promise.all([
      context.api.provider.list(at(context)),
      context.api.model.list(at(context)),
      context.api.model.default(at(context)).catch(() => undefined),
    ])
    return json(toV1ProviderList(providers.data, models.data, defaultModel?.data))
  }),
  route("GET", "/mcp", async (context) => json(toV1McpStatus((await context.api.mcp.list(at(context))).data))),
  route("GET", "/experimental/resource", async (context) => {
    const catalog = (await context.api.mcp.resource.catalog(at(context))).data
    return json(
      Object.fromEntries(catalog.resources.map((resource) => [`${resource.server}:${resource.uri}`, { ...resource, client: resource.server }])),
    )
  }),
  route("GET", "/vcs", async (context) => {
    const vcs = (await context.api.vcs.get(at(context))).data as { branch?: { current?: string; default?: string } }
    return json({ branch: vcs.branch?.current, default_branch: vcs.branch?.default })
  }),
  route("GET", "/vcs/status", async (context) => json((await context.api.vcs.status(at(context))).data)),
  route("GET", "/vcs/diff", async (context) => {
    const mode = context.query.get("mode")
    const diff = await context.api.vcs.diff({
      ...at(context),
      mode: mode === "branch" ? "branch" : mode === "committed" ? "committed" : "working",
      ...(number(context.query.get("context")) !== undefined ? { context: number(context.query.get("context")) } : {}),
    })
    return json(diff.data)
  }),
  route("GET", "/file", async (context) => {
    const path = context.query.get("path") ?? ""
    const listed = await context.api.file.list({ ...at(context), ...(path ? { path } : {}) })
    const base = context.directory ?? listed.location.directory
    return json(toV1FileNodes(path ? `${base}/${path}` : base, listed.data))
  }),
  route("GET", "/file/content", async (context) => {
    const path = context.query.get("path") ?? ""
    const location = context.directory ? `?location%5Bdirectory%5D=${encodeURIComponent(context.directory)}` : ""
    const response = await context.upstream(`/api/fs/read/${path.split("/").map(encodeURIComponent).join("/")}${location}`, {
      signal: context.signal,
    })
    if (!response.ok) return json({ name: "NotFoundError", data: { message: `File not found: ${path}` } }, { status: response.status })
    const mime = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream"
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (mime.startsWith("text/") || mime === "application/json") return json({ type: "text", content: new TextDecoder().decode(bytes) })
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return json({ type: "binary", content: btoa(binary), encoding: "base64", mimeType: mime })
  }),
  route("GET", "/find/file", async (context) => {
    const dirs = context.query.get("dirs")
    const found = await context.api.file.find({
      ...at(context),
      query: context.query.get("query") ?? "",
      ...(dirs === "true" ? { type: "directory" as const } : dirs === "false" ? { type: "file" as const } : {}),
      ...(number(context.query.get("limit")) !== undefined ? { limit: number(context.query.get("limit")) } : {}),
    })
    return json(found.data.map((entry) => entry.path))
  }),

  // ── MCP 连接(2.x 在 /api/experimental 下)与授权(U6:2.x 把远端 MCP 登记成 OAuth 集成)──
  route("POST", "/mcp/:name/connect", async (context) => {
    await context.api.experimental.mcp.connect({ ...at(context), server: context.params.name! })
    return ok()
  }),
  route("POST", "/mcp/:name/disconnect", async (context) => {
    await context.api.experimental.mcp.disconnect({ ...at(context), server: context.params.name! })
    return ok()
  }),
  route("POST", "/api/mcp/:server/connect", async (context) => {
    await context.api.experimental.mcp.connect({ ...at(context), server: context.params.server! })
    return noContent()
  }),
  route("POST", "/api/mcp/:server/disconnect", async (context) => {
    await context.api.experimental.mcp.disconnect({ ...at(context), server: context.params.server! })
    return noContent()
  }),
  route("POST", "/mcp/:name/auth/authenticate", (context) => authenticateMcp(context)),

  // ── 权限 ──
  route("GET", "/permission", async (context) =>
    json((await context.api.permission.request.list(at(context))).data.map((item) => normalizePermissionRequest(item as never))),
  ),
  route("POST", "/permission/:requestID/reply", permissionReplyPending),
  route("POST", "/session/:sessionID/permissions/:permissionID", permissionReplyPending),
  route("POST", "/api/session/:sessionID/permission/:requestID/reply", permissionReplyPending),
  passthrough("GET", "/api/session/:sessionID/permission"),

  // ── 提问(2.x 表单)──
  route("GET", "/question", async (context) => {
    const forms = await context.api.form.list(at(context))
    return json(forms.data.flatMap((form) => toV1Question(form) ?? []))
  }),
  route("POST", "/question/:requestID/reply", async (context) => {
    const requestID = context.params.requestID!
    const found = await questionOf(context, requestID)
    if (!found) return json({ name: "NotFoundError", data: { message: `Question not found: ${requestID}` } }, { status: 404 })
    const body = (context.body ?? {}) as { answers: string[][] }
    await context.api.session.form.reply({
      sessionID: found.sessionID,
      formID: requestID,
      answer: toFormAnswer(found.question as QuestionRequest | undefined, body.answers ?? []),
    })
    return ok()
  }),
  route("POST", "/question/:requestID/reject", async (context) => {
    const requestID = context.params.requestID!
    const found = await questionOf(context, requestID)
    if (!found) return json({ name: "NotFoundError", data: { message: `Question not found: ${requestID}` } }, { status: 404 })
    await context.api.session.form.cancel({ sessionID: found.sessionID, formID: requestID })
    return ok()
  }),

  // ── 终端(2.x 的 Pty 与 v1 同形)──
  route("GET", "/pty", async (context) => json((await context.api.pty.list(at(context))).data)),
  route("POST", "/pty", async (context) => {
    const body = (context.body ?? {}) as { command?: string; args?: string[]; cwd?: string; title?: string; env?: Record<string, string> }
    return json((await context.api.pty.create({ ...at(context), ...body })).data)
  }),
  route("GET", "/pty/shells", async (context) => json(await context.api.config.shells())),
  route("GET", "/pty/:ptyID", async (context) => json((await context.api.pty.get({ ...at(context), ptyID: context.params.ptyID! })).data)),
  route("PUT", "/pty/:ptyID", async (context) => {
    const body = (context.body ?? {}) as { title?: string; size?: { rows: number; cols: number } }
    return json((await context.api.pty.update({ ...at(context), ptyID: context.params.ptyID!, ...body })).data)
  }),
  route("DELETE", "/pty/:ptyID", async (context) => {
    await context.api.pty.remove({ ...at(context), ptyID: context.params.ptyID! })
    return ok()
  }),
  route("POST", "/pty/:ptyID/connect-token", async (context) =>
    json((await context.api.pty.connect.token({ ...at(context), ptyID: context.params.ptyID! })).data),
  ),

  // ── `/api/…`:v1 SDK 的 v2 命名空间与 1.17.13 客户端;2.x 路径与形状仍在的直通 ──
  passthrough("GET", "/api/agent"),
  passthrough("GET", "/api/provider/:providerID"),
  passthrough("GET", "/api/reference"),
  passthrough("GET", "/api/session"),
  passthrough("POST", "/api/session"),
  passthrough("GET", "/api/session/active"),
  passthrough("GET", "/api/session/:sessionID"),
  passthrough("DELETE", "/api/session/:sessionID"),
  passthrough("POST", "/api/session/:sessionID/model"),
  passthrough("POST", "/api/session/:sessionID/fork"),
  passthrough("POST", "/api/session/:sessionID/interrupt"),
  passthrough("POST", "/api/session/:sessionID/command"),
  passthrough("POST", "/api/session/:sessionID/compact"),
  passthrough("POST", "/api/session/:sessionID/shell"),
  route("POST", "/api/session/:sessionID/rename", async (context) => {
    await context.api.session.update({ sessionID: context.params.sessionID!, title: (context.body as { title: string }).title })
    return noContent()
  }),
  passthrough("GET", "/api/fs/find"),
  passthrough("GET", "/api/vcs/status"),
  passthrough("GET", "/api/vcs/diff"),
  passthrough("POST", "/api/pty"),
  passthrough("GET", "/api/pty/:ptyID"),
  passthrough("PUT", "/api/pty/:ptyID"),
  passthrough("DELETE", "/api/pty/:ptyID"),
  passthrough("GET", "/api/integration/:integrationID"),
  passthrough("POST", "/api/integration/:integrationID/connect/key"),
  passthrough("POST", "/api/integration/:integrationID/connect/oauth"),
  passthrough("GET", "/api/integration/:integrationID/connect/oauth/:attemptID"),
  passthrough("POST", "/api/integration/:integrationID/connect/oauth/:attemptID/complete"),
]

/**
 * 冻结源码里扫得到、但适配器**不接**的引擎请求。每条一个理由;路由覆盖测试要求扫出的每个调用要么在 ROUTES、
 * 要么在这里。这里的请求真发出来时由 index.ts 回 501 + console.error。
 */
export const UNSUPPORTED: ReadonlyArray<{ method: string; path: string; reason: string }> = [
  { method: "DELETE", path: "/auth/:providerID", reason: "U5:上游设置页的凭证增删,Code Puppy 界面挂不上(设置入口 settings.open 由 codepuppy-sidebar.tsx 注册到 Code Puppy 设置页);BYOK 由主进程管" },
  { method: "PUT", path: "/auth/:providerID", reason: "U5:同上(另一个发出点 server-compat.ts 的 integration.connect.key 只被上游连接对话框调用)" },
  { method: "POST", path: "/global/dispose", reason: "U5:只在上游设置页的凭证增删之后调用" },
  { method: "GET", path: "/provider/auth", reason: "U5:只在 server-compat.ts 的 integration.get(上游连接对话框)里调用" },
  { method: "POST", path: "/provider/:providerID/oauth/authorize", reason: "U5:上游连接对话框的 OAuth" },
  { method: "POST", path: "/provider/:providerID/oauth/callback", reason: "U5:上游连接对话框的 OAuth" },
  { method: "GET", path: "/lsp", reason: "U4:2.x 只有 lsp.updated 事件、没有查询端点;请求由冻结 app 的数据层发出,显示它的状态弹层只挂在上游会话头与新会话页,Code Puppy 界面挂不上(编排器 2026-11-09 认可进本单)" },
  { method: "POST", path: "/session/:sessionID/share", reason: "R6:owner 裁定拿掉「分享对话」;不把会话发到任何外部地址" },
  { method: "DELETE", path: "/session/:sessionID/share", reason: "R6:取消分享,随「分享对话」一起拿掉(上游 use-session-commands / message-timeline 里的入口 Code Puppy 界面挂不上)" },
  { method: "PATCH", path: "/global/config", reason: "U5:只被上游设置页与自定义 provider 对话框调用(server-sync.tsx updateConfig 的全部调用方),Code Puppy 界面挂不上" },
  { method: "POST", path: "/experimental/worktree", reason: "U4:worktree 增删重置只在上游 LegacyLayout(pages/layout.tsx)里,它只挂在 /:dir 路由下,Code Puppy 不导航到那里(app.tsx:321 那条只在 newLayoutDesigns 关时走,codepuppy-defaults.ts 恒开)" },
  { method: "GET", path: "/experimental/worktree", reason: "U4:同上(server-compat.ts 的 project.directories → layout.tsx:1188)" },
  { method: "DELETE", path: "/experimental/worktree", reason: "U4:worktree 删除,同在上游 LegacyLayout(layout.tsx:1392)" },
  { method: "POST", path: "/experimental/worktree/reset", reason: "U4:同上;2.x 也没有 reset" },
  { method: "GET", path: "/api/project/:projectID/directories", reason: "U4:同上;2.2.x 已删" },
  { method: "POST", path: "/api/session/:sessionID/question/:requestID/reply", reason: "v1 模式下 createCompatibleApi 改走 v1 的 /question/:id/reply(server-compat.ts:508);2.2.x 已删" },
  { method: "POST", path: "/api/session/:sessionID/question/:requestID/reject", reason: "v1 模式下改走 /question/:id/reject(server-compat.ts:514);2.2.x 已删" },
]

async function currentProject(context: RouteContext) {
  const location = await context.api.location.get(at(context))
  const listed = (await context.api.project.list()).find((project) => project.id === location.project.id)
  return listed
    ? toV1Project(listed as never)
    : toV1Project({ id: location.project.id, canonical: location.project.canonical, time: { created: 0, updated: 0 }, sandboxes: [] })
}

/**
 * U6:v1 的「去授权」是一个长调用(引擎开浏览器、等回调、落凭证,回 MCP 状态)。2.x 把每个远端 MCP 登记成
 * OAuth 集成(core/src/mcp/index.ts:238-275,`metadata.source === "mcp"`、名字 = MCP 名):这里发起 OAuth、
 * 交给系统浏览器打开授权地址、轮询到终态,再回这台 MCP 的状态 —— 调用方看到的仍是 v1 的那个长调用。
 */
async function authenticateMcp(context: RouteContext) {
  const name = context.params.name!
  const integrations = await context.api.integration.list(at(context))
  const integration = integrations.data.find(
    (item) => (item as { metadata?: { source?: string } }).metadata?.source === "mcp" && item.name === name,
  )
  if (!integration) return json({ name: "NotFoundError", data: { message: `MCP integration not found: ${name}` } }, { status: 404 })
  const detail = await context.api.integration.get({ ...at(context), integrationID: integration.id })
  const method = detail.data.methods.find((item) => item.type === "oauth") as { type: "oauth"; id: string } | undefined
  if (!method) return json({ name: "UnknownError", data: { message: `MCP ${name} has no OAuth method` } }, { status: 400 })
  const attempt = await context.api.integration.oauth.connect({ ...at(context), integrationID: integration.id, methodID: method.id })
  window.api.openLink(attempt.data.url)
  for (;;) {
    if (context.signal.aborted) throw new DOMException("aborted", "AbortError")
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const status = await context.api.integration.oauth.status({
      ...at(context),
      integrationID: integration.id,
      attemptID: attempt.data.attemptID,
    })
    if (status.data.status === "pending") continue
    const servers = (await context.api.mcp.list(at(context))).data
    const server = servers.find((item) => item.name === name)
    return json(server?.status ?? { status: "failed", error: status.data.status })
  }
}
