// `#1668`:当前代(OpenCode 2)翻译器的路由处理 —— 约定路由目录(contract/routes.ts)里每条翻译路由的 2.x 实现,按
// TranslatedKey 索引(`#1697` I-04,设计 §4.8、§4.10 b)。路由的成员、不支持名单、探活回退与三条固定答复都归约定,
// 这里只管「这一条在 2.x 上怎么做」。
//
// 路径两类:无 `/api` 前缀的是 v1 SDK 发的(冻结 app 的 v1 路径与 renderer 自己的客户端);`/api/…` 是 v1 SDK
// 的 `v2.*` 命名空间与冻结 app 自带的 1.17.13 客户端发的,在 2.x 合并目标 `33f94fce96` 上路径与形状仍在的直通,
// 已删或挪走的改写。
import type { OpenCodeClient } from "@opencode/client/promise"
import type {
  AssistantMessage,
  Part,
  PermissionV2Decision,
  PermissionV2DecisionCommand,
  PermissionV2DecisionReceipt,
  QuestionRequest,
} from "../contract/v1"
import type { RouteContext, RouteHandler, Translator } from "../contract/translator"
import type { TranslatedKey } from "../contract/routes"
import { toContractSession } from "../contract/session"
import { projectEventStream } from "./events"
import { decisionError, errorResponse, invalidDecision } from "../contract/errors"
import { v1DecisionID, type DecisionInput } from "../contract/receipts"
import { approvals } from "./approvals"
import { MESSAGE_PAGE, recentMessages, sessionDirectory } from "./session-cache"
import {
  syntheticText,
  toFormAnswer,
  toPrompt,
  toV1Agents,
  toV1Commands,
  toV1FileNodes,
  toV1McpStatus,
  v1McpStatus,
  toV1Messages,
  toV1Path,
  toV1PermissionRequest,
  toV1Project,
  toV1ModelList,
  toV1ProviderList,
  toV1Question,
  todosOf,
  turnAnchor,
  withTurnDiffs,
  CONTINUE_METADATA_KEY,
  type V1PromptBody,
} from "./v1-shapes"

/** 这次约定请求的 2.x 引擎连接(`Translator.connect` 的产物)。 */
export type Opencode2Engine = {
  api: OpenCodeClient
  origin: string
  /** 对引擎源地址发一个原始请求(SSE、二进制读文件这类不经类型化客户端的)。 */
  upstream: (path: string, init?: RequestInit) => Promise<Response>
  /** 出网的 fetch(直通与原始请求用;直通的请求自己带着取消信号)。 */
  fetch: typeof globalThis.fetch
}

/** 处理函数内部用的上下文 = 约定的 RouteContext + 引擎连接 + 直通。`reply` 与 `body` 的类型随路由(K)。 */
export type TranslatorContext<K extends TranslatedKey = TranslatedKey> = RouteContext<K> &
  Opencode2Engine & {
    /** 把这次请求原样转给引擎(2.x 上路径与形状都没变的那些)。 */
    passthrough: () => Promise<Response>
  }
/** 与路由无关的那部分,给几条路由共用的辅助函数。 */
export type SharedContext = Omit<TranslatorContext, "body" | "reply">

/** 错误信封(ContractError 的形状)与 404 这类非约定响应体;成功的 JSON 一律经 `context.reply`。 */
const json = (value: unknown, init?: ResponseInit) => Response.json(value, init)
const noContent = () => new Response(null, { status: 204 })
const at = (context: { directory?: string }) => (context.directory ? { location: { directory: context.directory } } : {})
const number = (value: string | null) => (value === null || value === "" ? undefined : Number(value))

const bind =
  <K extends TranslatedKey>(handle: (context: TranslatorContext<K>) => Promise<Response>): RouteHandler<K, Opencode2Engine> =>
  (context, engine) =>
    handle({ ...context, ...engine, passthrough: () => engine.fetch(context.request) })
/** 直通:请求原样转给引擎,响应原样交回(类型按约定登记,翻译器不碰响应体)。 */
const passthrough = <K extends TranslatedKey>(context: RouteContext<K>, engine: Opencode2Engine) => engine.fetch(context.request)

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

// ── 权限回复(I7a):回执由约定的回执账本合成(contract/receipts.ts),引擎一侧经 approvals.ts ─────────────────────────
// 三个回复入口:v1 `/permission/:id/reply`(审批卡、定制中心、连接器停用)、v1 旧 `/session/:id/permissions/:id`
// (冻结 app 的自动允许,经 server-compat 的 legacy 客户端)、0.1.26 的 v2 `/api/session/:id/permission/:id/reply`
// (带命令,回收据)。错误体与 0.1.26 同形:过期 404 PermissionNotFoundError,陈旧 409 ConflictError(审批卡的
// permissionDecisionSubmitError 据 409 判为冲突)。
const DECISIONS = new Set(["once", "always", "reject"])

async function decide(context: SharedContext, input: DecisionInput, success: (receipt: PermissionV2DecisionReceipt) => Response) {
  if (!DECISIONS.has(input.decision) || !input.decisionID) return errorResponse(invalidDecision())
  const outcome = await context.receipts.decide(approvals(context), input)
  return outcome.type === "receipt" ? success(outcome.receipt) : errorResponse(decisionError(outcome.type, input.requestID))
}

/** 提问(2.x 表单)的 requestID → sessionID:v1 回答只带 requestID,2.x 要会话。先查列表,再查全局。 */
async function questionOf(context: SharedContext, requestID: string) {
  const forms = await context.api.form.list(at(context))
  const form = forms.data.find((item) => item.id === requestID)
  return form ? { sessionID: form.sessionID, question: toV1Question(form) } : undefined
}

async function prompt(context: TranslatorContext<"POST /session/:sessionID/prompt_async">) {
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
    // 时间线的「继续」:v1 落一条只含 synthetic 文本的用户消息(界面不显示正文、但开一个新回合)。2.x 落成带
    // CONTINUE_METADATA_KEY 的真用户消息 —— 那个回合的改动才查得到(REQ-142);读回时 toV1Messages 把正文标回 synthetic。
    await context.api.session.prompt({
      sessionID,
      ...(body.messageID ? { id: body.messageID } : {}),
      text: synthetic,
      metadata: { [CONTINUE_METADATA_KEY]: true },
    })
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
async function messages(context: TranslatorContext<"GET /session/:sessionID/message">) {
  const sessionID = context.params.sessionID!
  const limit = number(context.query.get("limit"))
  const before = context.query.get("before") ?? undefined
  const page = await recentMessages(context.api, sessionID, { limit, cursor: before })
  const listed = toV1Messages(sessionID, page.context).filter((item) => page.ids.has(baseID(item.info.id)))
  // REQ-142:最近一个回合的改动挂回它的用户消息(只在最新一页取,turnDiffsOf 只读最近一个回合)。取不到改动不让整个会话
  // 打不开:记下(不静默),消息照回。
  const anchor = before ? undefined : turnAnchor(listed, page.context)
  const diff = anchor
    ? await context.api.session.diff({ sessionID, from: anchor.from }).catch((error) => {
        if (context.signal.aborted) throw error
        console.error("[engine-adapter] turn diff failed", sessionID, anchor.from, error)
        return undefined
      })
    : undefined
  const response = context.reply(anchor && diff ? withTurnDiffs(listed, new Map([[anchor.attach, diff]])) : listed)
  if (page.next) response.headers.set("x-next-cursor", page.next)
  return response
}

const baseID = (id: string) => id.replace(/:assistant$/, "")

const COMMAND_POLL_MS = 200

/**
 * REQ-125 C7:v1 的 command 回这条命令那个回合的助手消息 `{info, parts}`,composer 用 `info.id` 把命令来源 chip 对到回合
 * 上(codepuppy-composer.tsx、timeline-model.ts slashOriginForTurn)。2.x 的 command / prompt 只受理、不等回复,于是在这里
 * 等:`after` 之后出现的第一条助手消息就是它。命令没开回合(子代理命令、插件命令)或回合没产出助手消息就结束,回 `{}`
 * (与今天无关联时同一形状)。判「没开回合」先读 active 再读消息:读 active 时已不在跑,那个执行写下的消息此刻都已落库。
 * 消息 id 按时间升序(`msg_` + ascending),所以「之后」= id 更大。
 */
async function commandReply(context: TranslatorContext<"POST /session/:sessionID/command">, sessionID: string, after: string | undefined) {
  for (;;) {
    context.signal.throwIfAborted()
    const running = sessionID in (await context.api.session.active())
    const page = await recentMessages(context.api, sessionID, { limit: 20 })
    const fresh = page.context.filter((message) => after === undefined || message.id > after)
    const assistant = fresh.find((message) => message.type === "assistant")
    const found =
      assistant &&
      toV1Messages(sessionID, page.context).find(
        (item): item is { info: AssistantMessage; parts: Part[] } => item.info.id === assistant.id && item.info.role === "assistant",
      )
    if (found) return context.reply(found)
    if (!running || fresh.some((message) => message.type === "idle")) return context.reply({})
    await new Promise((resolve) => setTimeout(resolve, COMMAND_POLL_MS))
  }
}


/** 约定里每条翻译路由的 2.x 处理(设计 §4.10 b:按 TranslatedKey 的映射类型,少一条、多一条都编译不过)。 */
export const ROUTES: Translator<Opencode2Engine>["routes"] = {
  // ── 探活与引擎实例 ──
  "GET /global/health": bind(async (context) => {
    const info = await context.api.server.info()
    return context.reply({ healthy: true, version: info.version })
  }),
  "POST /instance/dispose": bind(async (context) => {
    // 2.x 的重载重建**全部** Location(seams Q5),v1 的 instance.dispose 只释放一个目录;语义更宽、方向安全。
    await context.api.location.reload()
    return context.reply(true)
  }),
  "GET /global/event": bind((context) => Promise.resolve(projectEventStream(context))),
  "GET /path": bind(async (context) => context.reply(toV1Path(await context.api.location.get(at(context))))),
  // `GET /global/config`、`GET /config` 是约定侧的固定答复(contract/routes.ts FIXED)。

  // ── 项目(U2 选 A:2.x 自己有项目清单,`canonical` 改名 `worktree`)──
  "GET /project": bind(async (context) => context.reply((await context.api.project.list()).map((p) => toV1Project(p)))),
  "GET /project/current": bind(async (context) => context.reply(await currentProject(context))),
  "GET /api/project/current": bind(async (context) => {
    const project = await currentProject(context)
    return context.reply({ id: project.id, directory: project.worktree })
  }),
  "PATCH /project/:projectID": bind(async (context) => {
    const { name, icon, commands } = (context.body ?? {}) as { name?: string; icon?: never; commands?: never }
    const updated = await context.api.project.update({ projectID: context.params.projectID!, name, icon, commands })
    return context.reply(toV1Project(updated))
  }),
  "POST /project/git/init": bind(async (context) => {
    await context.api.vcs.init(at(context))
    return context.reply(await currentProject(context))
  }),

  // ── 会话 ──
  "GET /session": bind(async (context) => {
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
    const out = sessions.map((session) => toContractSession(session))
    return context.reply(limit ? out.slice(0, limit) : out)
  }),
  "GET /experimental/session": bind(async (context) => {
    const roots = context.query.get("roots") === "true"
    const search = context.query.get("search") ?? undefined
    // v1 的游标是数字时间戳,2.x 是不透明字符串:一次拉完、不给 x-next-cursor(调用方读不到游标即止)。
    const sessions = await allSessions(context.api, { ...(roots ? { parentID: null } : {}), ...(search ? { search } : {}) })
    return context.reply(sessions.map((session) => ({ ...toContractSession(session), project: null })))
  }),
  "POST /session": bind(async (context) => {
    const body = (context.body ?? {}) as { parentID?: string; title?: string }
    const created = await context.api.session.create({
      ...at(context),
      ...(body.parentID ? { parentID: body.parentID } : {}),
      ...(body.title ? { title: body.title } : {}),
    })
    return context.reply(toContractSession(created))
  }),
  "GET /session/status": bind(async (context) => {
    const active = await context.api.session.active()
    return context.reply(Object.fromEntries(Object.keys(active).map((sessionID) => [sessionID, { type: "busy" }])))
  }),
  "GET /session/:sessionID": bind(async (context) =>
    context.reply(toContractSession((await context.api.session.get({ sessionID: context.params.sessionID! })))),
  ),
  "PATCH /session/:sessionID": bind(async (context) => {
    const sessionID = context.params.sessionID!
    const body = (context.body ?? {}) as { title?: string; time?: { archived?: number } }
    await context.api.session.update({
      sessionID,
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.time && "archived" in body.time ? { archived: !!body.time.archived } : {}),
    })
    return context.reply(toContractSession((await context.api.session.get({ sessionID }))))
  }),
  "DELETE /session/:sessionID": bind(async (context) => {
    await context.api.session.remove({ sessionID: context.params.sessionID! })
    return context.reply(true)
  }),
  "POST /session/:sessionID/fork": bind(async (context) => {
    const body = (context.body ?? {}) as { messageID?: string }
    const forked = await context.api.session.fork({
      sessionID: context.params.sessionID!,
      ...(body.messageID ? { before: body.messageID } : {}),
    })
    return context.reply(toContractSession(forked))
  }),
  "POST /session/:sessionID/abort": bind(async (context) => {
    await context.api.session.interrupt({ sessionID: context.params.sessionID! })
    return context.reply(true)
  }),
  "POST /session/:sessionID/prompt_async": bind(prompt),
  "POST /session/:sessionID/command": bind(async (context) => {
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
      const admitted = await context.api.session.prompt({ sessionID, text: body.arguments ?? "", skills: [{ id: body.command }] })
      return commandReply(context, sessionID, admitted.id)
    }
    const newest = (await context.api.message.list({ sessionID, limit: 1, order: "desc" })).data[0]?.id
    await context.api.session.command({ sessionID, name: body.command, text: body.arguments ?? "" })
    return commandReply(context, sessionID, newest)
  }),
  "POST /session/:sessionID/shell": bind(async (context) => {
    const body = (context.body ?? {}) as { command: string; agent?: string }
    const sessionID = context.params.sessionID!
    if (body.agent) await context.api.session.switchAgent({ sessionID, agent: body.agent })
    await context.api.session.shell({ sessionID, command: body.command })
    return context.reply({})
  }),
  "POST /session/:sessionID/summarize": bind(async (context) => {
    await context.api.session.compact({ sessionID: context.params.sessionID! })
    return context.reply(true)
  }),
  "POST /session/:sessionID/revert": bind(async (context) => {
    const sessionID = context.params.sessionID!
    const body = (context.body ?? {}) as { messageID: string }
    await context.api.session.revert.stage({ sessionID, messageID: body.messageID })
    return context.reply(toContractSession((await context.api.session.get({ sessionID }))))
  }),
  "POST /session/:sessionID/unrevert": bind(async (context) => {
    const sessionID = context.params.sessionID!
    await context.api.session.revert.clear({ sessionID })
    return context.reply(toContractSession((await context.api.session.get({ sessionID }))))
  }),
  "GET /session/:sessionID/message": bind(messages),
  // U1:2.x 没有 todo 查询端点;清单就是会话里最近一次 todowrite 的输入(与事件流的 todo.updated 同一来源)。
  // `#1692`:从最近一页往前一页页找,找到即停 —— 长会话不再整段读取;一直没有写入才读到会话开头。
  "GET /session/:sessionID/todo": bind(async (context) => {
    const sessionID = context.params.sessionID!
    let cursor: string | undefined
    for (;;) {
      const page = await recentMessages(context.api, sessionID, { limit: MESSAGE_PAGE, cursor })
      const parts = toV1Messages(sessionID, page.context).flatMap((item) => item.parts)
      const last = parts.findLast((part) => part.type === "tool" && part.tool === "todowrite")
      // todowrite 的入参还在流式阶段时 todosOf 回 undefined,Response.json 当场抛错、经错误信封回 500 —— `#1668` 起如此,不改
      if (last) return context.reply(todosOf(last)!)
      if (!page.next) return context.reply([])
      cursor = page.next
    }
  }),
  "GET /session/:sessionID/message/:messageID": bind(async (context) => {
    const sessionID = context.params.sessionID!
    const messageID = context.params.messageID!
    const page = await recentMessages(context.api, sessionID, { through: messageID })
    const found = toV1Messages(sessionID, page.context).find((item) => item.info.id === messageID)
    return found ? context.reply(found) : json({ name: "NotFoundError", data: { message: `Message not found: ${messageID}` } }, { status: 404 })
  }),

  // ── 目录内的只读查询 ──
  "GET /agent": bind(async (context) => context.reply(toV1Agents((await context.api.agent.list(at(context))).data))),
  "GET /command": bind(async (context) => {
    const [commands, skills] = await Promise.all([context.api.command.list(at(context)), context.api.skill.list(at(context))])
    return context.reply(toV1Commands(commands.data, skills.data))
  }),
  "GET /provider": bind(async (context) => {
    const [providers, models, defaultModel] = await Promise.all([
      context.api.provider.list(at(context)),
      context.api.model.list(at(context)),
      context.api.model.default(at(context)).catch(() => undefined),
    ])
    return context.reply(toV1ProviderList(providers.data, models.data, defaultModel?.data))
  }),
  "GET /mcp": bind(async (context) => context.reply(toV1McpStatus((await context.api.mcp.list(at(context))).data))),
  "GET /experimental/resource": bind(async (context) => {
    const catalog = (await context.api.mcp.resource.catalog(at(context))).data
    return context.reply(
      Object.fromEntries(catalog.resources.map((resource) => [`${resource.server}:${resource.uri}`, { ...resource, client: resource.server }])),
    )
  }),
  "GET /vcs": bind(async (context) => {
    const vcs = (await context.api.vcs.get(at(context))).data as { branch?: { current?: string; default?: string } }
    return context.reply({ branch: vcs.branch?.current, default_branch: vcs.branch?.default })
  }),
  "GET /vcs/status": bind(async (context) => context.reply((await context.api.vcs.status(at(context))).data)),
  "GET /vcs/diff": bind(async (context) => {
    const mode = context.query.get("mode")
    const diff = await context.api.vcs.diff({
      ...at(context),
      mode: mode === "branch" ? "branch" : mode === "committed" ? "committed" : "working",
      ...(number(context.query.get("context")) !== undefined ? { context: number(context.query.get("context")) } : {}),
    })
    return context.reply(diff.data)
  }),
  "GET /file": bind(async (context) => {
    const path = context.query.get("path") ?? ""
    const listed = await context.api.file.list({ ...at(context), ...(path ? { path } : {}) })
    const base = context.directory ?? listed.location.directory
    return context.reply(toV1FileNodes(path ? `${base}/${path}` : base, listed.data))
  }),
  "GET /file/content": bind(async (context) => {
    const path = context.query.get("path") ?? ""
    const location = context.directory ? `?location%5Bdirectory%5D=${encodeURIComponent(context.directory)}` : ""
    const response = await context.upstream(`/api/fs/read/${path.split("/").map(encodeURIComponent).join("/")}${location}`, {
      signal: context.signal,
    })
    if (!response.ok) return json({ name: "NotFoundError", data: { message: `File not found: ${path}` } }, { status: response.status })
    const mime = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream"
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (mime.startsWith("text/") || mime === "application/json") return context.reply({ type: "text", content: new TextDecoder().decode(bytes) })
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return context.reply({ type: "binary", content: btoa(binary), encoding: "base64", mimeType: mime })
  }),
  "GET /find/file": bind(async (context) => {
    const dirs = context.query.get("dirs")
    const found = await context.api.file.find({
      ...at(context),
      query: context.query.get("query") ?? "",
      ...(dirs === "true" ? { type: "directory" as const } : dirs === "false" ? { type: "file" as const } : {}),
      ...(number(context.query.get("limit")) !== undefined ? { limit: number(context.query.get("limit")) } : {}),
    })
    // 2.x 的结果里带搜索根本身(`/`),它不是一个匹配项。
    return context.reply(found.data.flatMap((entry) => (entry.path === "/" || entry.path === "" ? [] : [entry.path])))
  }),

  // ── MCP 连接(2.x 在 /api/experimental 下)与授权(U6:2.x 把远端 MCP 登记成 OAuth 集成)──
  "POST /mcp/:name/connect": bind(async (context) => {
    await context.api.experimental.mcp.connect({ ...at(context), server: context.params.name! })
    return context.reply(true)
  }),
  "POST /mcp/:name/disconnect": bind(async (context) => {
    await context.api.experimental.mcp.disconnect({ ...at(context), server: context.params.name! })
    return context.reply(true)
  }),
  "POST /api/mcp/:server/connect": bind(async (context) => {
    await context.api.experimental.mcp.connect({ ...at(context), server: context.params.server! })
    return noContent()
  }),
  "POST /api/mcp/:server/disconnect": bind(async (context) => {
    await context.api.experimental.mcp.disconnect({ ...at(context), server: context.params.server! })
    return noContent()
  }),
  "POST /mcp/:name/auth/authenticate": bind((context) => authenticateMcp(context)),

  // ── 权限 ──
  "GET /permission": bind(async (context) =>
    context.reply((await context.api.permission.request.list(at(context))).data.map((item) => context.receipts.show(toV1PermissionRequest(item)))),
  ),
  "POST /permission/:requestID/reply": bind((context) => {
    const requestID = context.params.requestID!
    const body = (context.body ?? {}) as { reply: PermissionV2Decision; message?: string }
    return decide(context, { requestID, decision: body.reply, message: body.message, decisionID: v1DecisionID(requestID) }, () => context.reply(true))
  }),
  "POST /session/:sessionID/permissions/:permissionID": bind((context) => {
    const requestID = context.params.permissionID!
    const body = (context.body ?? {}) as { response: PermissionV2Decision }
    return decide(
      context,
      { requestID, sessionID: context.params.sessionID!, decision: body.response, decisionID: v1DecisionID(requestID) },
      () => context.reply(true),
    )
  }),
  "POST /api/session/:sessionID/permission/:requestID/reply": bind((context) => {
    const command = (context.body ?? {}) as PermissionV2DecisionCommand
    return decide(
      context,
      {
        requestID: context.params.requestID!,
        sessionID: context.params.sessionID!,
        decision: command.decision,
        message: command.message,
        decisionID: command.decisionID,
        requestFingerprint: command.requestFingerprint,
      },
      (receipt) => context.reply({ data: receipt }),
    )
  }),
  // `GET /api/session/:sessionID/permission`(v2 审批通道列表)是约定侧的固定答复(contract/routes.ts FIXED)。

  // ── 提问(2.x 表单)──
  "GET /question": bind(async (context) => {
    const forms = await context.api.form.list(at(context))
    return context.reply(forms.data.flatMap((form) => toV1Question(form) ?? []))
  }),
  "POST /question/:requestID/reply": bind(async (context) => {
    const requestID = context.params.requestID!
    const found = await questionOf(context, requestID)
    if (!found) return json({ name: "NotFoundError", data: { message: `Question not found: ${requestID}` } }, { status: 404 })
    const body = (context.body ?? {}) as { answers: string[][] }
    await context.api.session.form.reply({
      sessionID: found.sessionID,
      formID: requestID,
      answer: toFormAnswer(found.question as QuestionRequest | undefined, body.answers ?? []),
    })
    return context.reply(true)
  }),
  "POST /question/:requestID/reject": bind(async (context) => {
    const requestID = context.params.requestID!
    const found = await questionOf(context, requestID)
    if (!found) return json({ name: "NotFoundError", data: { message: `Question not found: ${requestID}` } }, { status: 404 })
    await context.api.session.form.cancel({ sessionID: found.sessionID, formID: requestID })
    return context.reply(true)
  }),

  // ── 终端(2.x 的 Pty 与 v1 同形)──
  "GET /pty": bind(async (context) => context.reply((await context.api.pty.list(at(context))).data)),
  "POST /pty": bind(async (context) => {
    const body = (context.body ?? {}) as { command?: string; args?: string[]; cwd?: string; title?: string; env?: Record<string, string> }
    return context.reply((await context.api.pty.create({ ...at(context), ...body })).data)
  }),
  "GET /pty/shells": bind(async (context) => context.reply(await context.api.config.shells())),
  "GET /pty/:ptyID": bind(async (context) => context.reply((await context.api.pty.get({ ...at(context), ptyID: context.params.ptyID! })).data)),
  "PUT /pty/:ptyID": bind(async (context) => {
    const body = (context.body ?? {}) as { title?: string; size?: { rows: number; cols: number } }
    return context.reply((await context.api.pty.update({ ...at(context), ptyID: context.params.ptyID!, ...body })).data)
  }),
  "DELETE /pty/:ptyID": bind(async (context) => {
    await context.api.pty.remove({ ...at(context), ptyID: context.params.ptyID! })
    return context.reply(true)
  }),
  "POST /pty/:ptyID/connect-token": bind(async (context) =>
    // 2.x 与 v1 一样要求调用方带 `x-opencode-ticket`(防跨站取票);冻结终端带着它,原样转过去。
    context.reply(
      (
        await context.api.pty.connect.token({
          ...at(context),
          ptyID: context.params.ptyID!,
          ...(context.request.headers.get("x-opencode-ticket")
            ? { "x-opencode-ticket": context.request.headers.get("x-opencode-ticket")! }
            : {}),
        })
      ).data,
    ),
  ),

  // ── `/api/…`:v1 SDK 的 v2 命名空间与 1.17.13 客户端;2.x 路径与形状仍在的直通 ──
  "GET /api/agent": passthrough,
  // composer 的模型清单(model-contract.ts 的 `client.v2.model.list`;不进 routes-coverage 的扫描 —— 调用跨行写)。`#1662`:漏了它
  // composer 的模型链一直 recovering,发送按钮永远不亮。
  "GET /api/model": bind(async (context) => context.reply(toV1ModelList(await context.api.model.list(at(context))))),
  "GET /api/provider/:providerID": passthrough,
  "GET /api/reference": passthrough,
  "GET /api/session": passthrough,
  "POST /api/session": passthrough,
  "GET /api/session/active": passthrough,
  "GET /api/session/:sessionID": passthrough,
  "DELETE /api/session/:sessionID": passthrough,
  "POST /api/session/:sessionID/model": passthrough,
  "POST /api/session/:sessionID/fork": passthrough,
  "POST /api/session/:sessionID/interrupt": passthrough,
  "POST /api/session/:sessionID/command": passthrough,
  "POST /api/session/:sessionID/compact": passthrough,
  "POST /api/session/:sessionID/shell": passthrough,
  "POST /api/session/:sessionID/rename": bind(async (context) => {
    await context.api.session.update({ sessionID: context.params.sessionID!, title: (context.body as { title: string }).title })
    return noContent()
  }),
  "GET /api/fs/find": passthrough,
  "GET /api/vcs/status": passthrough,
  "GET /api/vcs/diff": passthrough,
  "POST /api/pty": passthrough,
  "GET /api/pty/:ptyID": passthrough,
  "PUT /api/pty/:ptyID": passthrough,
  "DELETE /api/pty/:ptyID": passthrough,
  "GET /api/integration/:integrationID": passthrough,
  "POST /api/integration/:integrationID/connect/key": passthrough,
  "POST /api/integration/:integrationID/connect/oauth": passthrough,
  "GET /api/integration/:integrationID/connect/oauth/:attemptID": passthrough,
  "POST /api/integration/:integrationID/connect/oauth/:attemptID/complete": passthrough,
}

async function currentProject(context: SharedContext) {
  const location = await context.api.location.get(at(context))
  const listed = (await context.api.project.list()).find((project) => project.id === location.project.id)
  return listed
    ? toV1Project(listed)
    : toV1Project({ id: location.project.id, canonical: location.project.canonical, time: { created: 0, updated: 0 }, sandboxes: [] })
}

/** 设计 docs/specs/1662-opencode2/design.md「MCP OAuth on OpenCode 2」§4(7cba42b10d):轮询间隔,固定常量。 */
const MCP_AUTH_POLL_MS = 1_000

/**
 * U6:v1 的「去授权」是一个长调用(引擎开浏览器、等回调、落凭证,回 MCP 状态)。2.x 把每个远端 MCP 登记成
 * OAuth 集成(core/src/mcp/index.ts:238-275,`metadata.source === "mcp"`、名字 = MCP 名):这里发起 OAuth、
 * 交给系统浏览器打开授权地址、轮询到终态,再回这台 MCP 的状态 —— 调用方看到的仍是 v1 的那个长调用。
 */
async function authenticateMcp(context: TranslatorContext<"POST /mcp/:name/auth/authenticate">) {
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
  const poll = async () => {
    context.signal.throwIfAborted()
    await new Promise((resolve) => setTimeout(resolve, MCP_AUTH_POLL_MS))
  }
  let outcome: string
  do {
    await poll()
    outcome = (await context.api.integration.oauth.status({ ...at(context), integrationID: integration.id, attemptID: attempt.data.attemptID }))
      .data.status
  } while (outcome === "pending")
  // 设计 §4 第 6 步:`complete` 时引擎先写凭证、MCP 随后异步重连(实测 ~250 ms 后才从 pending 变 connected),立刻读会把
  // 成功报成失败(use-extensions 要 connected)。所以 complete 之后每 POLL_MS 读一次,直到这台不是 pending;引擎用 MCP 启动
  // 超时收口,一定停在 connected / failed / needs_auth 之一。failed / expired 直接回当前状态。
  for (;;) {
    if (outcome === "complete") await poll()
    const server = (await context.api.mcp.list(at(context))).data.find((item) => item.name === name)
    if (outcome !== "complete" || server?.status.status !== "pending")
      return context.reply(server ? v1McpStatus(server.status) : { status: "failed", error: outcome })
  }
}
