// `#1668`:2.x 结果 → 冻结界面要的 v1 形状。冻结 app 已有归一函数的形状(会话、消息、agent、权限、
// provider/model、项目)复用 frozen-shapes.ts;这里只放冻结 app 里没有的那部分,以及适配器自己必须
// 决定的两件事:part 的有序 id、暂存附件(I11)的往返。
import type {
  CommandInfo,
  FileSystemEntry,
  FormInfo,
  LocationPublicInfo,
  McpServer,
  ModelDefaultOutput,
  ModelListOutput,
  ProviderListOutput,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionStructuredError,
} from "@opencode/client/promise"
import type {
  AssistantMessage,
  Command,
  FileNode,
  Message,
  Part,
  Path,
  Project,
  ProviderListResponse,
  QuestionRequest,
} from "@opencode-ai/sdk/v2/client"
import { isNetFailureLayer, parseFailureCode } from "@opencode/schema/codepuppy-net-failure"
import { STAGED_ATTACHMENT_PART_NAME, stagedAttachmentPart } from "../../../ext/src/staged-attachment-part"
import { ATTACHMENT_METADATA_KEY, type StagedAttachmentMeta } from "../shared/attachment-path"
import { TITLE_VARIANT_ALIAS } from "../shared/codepuppy-model-types"
import { normalizePermissionRequest, normalizeProviderList, normalizeSessionMessages } from "./frozen-shapes"

type FrozenSource = Parameters<typeof normalizeSessionMessages>[1]

// ── part 的有序 id ──────────────────────────────────────────────────────────────────────────────
// 冻结 app 的 v1 store 按 part.id 排序(event-reducer 的 Binary.search、server-session 加载时 sort),时间线按
// 这个顺序渲染。0.1.26 的 v1 引擎发的是按创建先后递增的 id,于是「思考 → 正文 → 工具」照内容顺序出现。
// 冻结 app 的投影给 2.x 内容起的是语义 id(`<msg>:text:0`、`<msg>:reasoning:0`、工具 id 本身),按字典序排会
// 把 `call_…` 工具排到正文前面、把多段正文挤在一起。所以适配器统一换成「消息 id + 四位序号」:助手消息的
// 序号 = 2.x `content` 数组下标(空正文被投影丢掉也不错位,流式阶段与快照阶段同一个号),其余消息按投影顺序。
export const partID = (messageID: string, index: number) => `${messageID}:${String(index).padStart(4, "0")}`

/** v1 消息 id → 投影出它的那条 2.x 消息:shell 消息投影成用户 + 助手两条,助手那条是 `<id>:assistant`(冻结 normalizeSessionMessages)。 */
export const baseID = (id: string) => id.replace(/:assistant$/, "")

/** 助手消息 content 下标 ⇄ 冻结投影的语义 id(text/reasoning 按各自序号,工具按工具 id)。 */
export function contentKeys(content: ReadonlyArray<{ type: string; id?: string }>) {
  const counters = { text: 0, reasoning: 0 }
  return content.map((item) => {
    if (item.type === "text") return `text:${counters.text++}`
    if (item.type === "reasoning") return `reasoning:${counters.reasoning++}`
    return `tool:${item.id}`
  })
}

// ── I11':暂存附件(`#1553`)──────────────────────────────────────────────────────────────────────
// 冻结界面的 composer 把一个暂存的 PDF / Office 文件发成「空文本 + synthetic + `codepuppy.attachment` metadata」
// 的 v1 part(composer-attachments-core.ts 的 buildAttachmentParts)。2.x 的 prompt 没有这种 part;按编排器裁决
// (#1665 评论 6737733672 与之后的定稿),每个暂存附件译成一个 2.x `files` 条目 —— 构造函数与固定文件名由 ext 的
// staged-attachment-part.ts 定义(零依赖,ext 在 context 钩子里按同一个文件名认出它):`data:` URI 只装
// StagedAttachmentMeta 的 JSON,**从不**用 `file://`(引擎提交时会把整份文件字节读进库,PDF 还会绕过本机读取工具
// 直接发给模型)。引擎按字节嗅探,存下的 mime 恒为 `text/plain`,所以读回时按文件名认出它、解出 meta,原样合成回
// 那个 v1 part,附件卡与「已读取」判定不变。
function utf8FromBase64(data: string) {
  const binary = atob(data)
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

/** 存下的 v1 file part(投影把 2.x 的 `data` 拼成 data: URL)→ StagedAttachmentMeta;认不出返回 undefined。 */
export function stagedAttachmentOf(file: { filename?: string; url?: string }): StagedAttachmentMeta | undefined {
  if (file.filename !== STAGED_ATTACHMENT_PART_NAME) return undefined
  const data = file.url?.match(/^data:[^,]*;base64,(.*)$/)?.[1]
  if (!data) return undefined
  try {
    const value = JSON.parse(utf8FromBase64(data)) as StagedAttachmentMeta
    return value && value.v === 1 ? value : undefined
  } catch {
    return undefined
  }
}

function isStagedAttachmentPart(part: unknown): part is { metadata: Record<string, StagedAttachmentMeta> } {
  const value = part as { type?: string; synthetic?: boolean; metadata?: Record<string, unknown> }
  return value?.type === "text" && value.synthetic === true && !!value.metadata?.[ATTACHMENT_METADATA_KEY]
}

// ── 发送:v1 prompt_async → 2.x prompt ────────────────────────────────────────────────────────────
type V1PartInput = {
  type: string
  text?: string
  synthetic?: boolean
  metadata?: Record<string, unknown>
  mime?: string
  url?: string
  filename?: string
  name?: string
  source?: { value?: string; start?: number; end?: number; text?: { value: string; start: number; end: number } }
}

export type V1PromptBody = {
  messageID?: string
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  parts: V1PartInput[]
}

/**
 * v1 的 parts → 2.x prompt 的 `text` / `files` / `agents`。正文 = 非 synthetic 的文本 part 依次拼接(三个发送入口
 * 都只发一个正文 part);暂存附件按 I11 进 `files`;`synthetic` 的其它文本(「继续」)由调用方走 session.synthetic。
 */
export function toPrompt(parts: readonly V1PartInput[]) {
  const text = parts
    .filter((part) => part.type === "text" && !part.synthetic)
    .map((part) => part.text ?? "")
    .join("\n")
  type PromptFile = { uri: string; name?: string; mention?: { start: number; end: number; text: string } }
  const files = parts.flatMap((part): PromptFile[] => {
    if (isStagedAttachmentPart(part)) return [stagedAttachmentPart(part.metadata[ATTACHMENT_METADATA_KEY]!)]
    if (part.type !== "file" || !part.url) return []
    const mention = part.source?.text
    return [
      {
        uri: part.url,
        ...(part.filename ? { name: part.filename } : {}),
        ...(mention ? { mention: { start: mention.start, end: mention.end, text: mention.value } } : {}),
      },
    ]
  })
  type PromptAgent = { name: string; mention?: { start: number; end: number; text: string } }
  const agents = parts.flatMap((part): PromptAgent[] => {
    if (part.type !== "agent" || !part.name) return []
    const source = part.source
    return [
      {
        name: part.name,
        ...(source && source.value !== undefined && source.start !== undefined && source.end !== undefined
          ? { mention: { start: source.start, end: source.end, text: source.value } }
          : {}),
      },
    ]
  })
  return { text, files, agents }
}

/** 全部 part 都是 synthetic 文本(时间线的「继续」)⇒ 界面不显示正文、但开一个新回合。 */
export function syntheticText(parts: readonly V1PartInput[]) {
  if (parts.length === 0 || !parts.every((part) => part.type === "text" && part.synthetic && !isStagedAttachmentPart(part)))
    return undefined
  return parts.map((part) => part.text ?? "").join("\n")
}

/**
 * 「继续」在 2.x 落成一条真用户消息并带这个 metadata 键(prompt 的 `metadata` 原样存在消息上)。理由:REQ-142 的回合
 * 改动按用户消息查(2.x session/diff.ts 只认 `type === "user"` 的锚),2.x 的 synthetic 消息查不了;读回时按这个键把
 * 它的正文标成 v1 的 synthetic,时间线照旧不显示这句「继续」。只有适配器写、只有适配器读。
 */
export const CONTINUE_METADATA_KEY = "codepuppyContinue"

// ── 读回:2.x 消息 → v1 {info, parts} ───────────────────────────────────────────────────────────────
export type V1MessageWithParts = { info: Message; parts: Part[] }

/**
 * 2.x 的消息列表(时间升序)→ v1 `{info, parts}`。投影本身是冻结 app 的 normalizeSessionMessages;这里只把
 * part id 换成有序 id,把 I11 的暂存附件文件合成回 v1 的 synthetic part,并把回合失败交成 0.1.26 回合错误卡读的形状
 * (withFailedTurns、v1TurnError,`#1669`)。
 */
export function toV1Messages(sessionID: string, source: readonly SessionMessageInfo[]): V1MessageWithParts[] {
  const turns = withFailedTurns(source)
  const normalized = normalizeSessionMessages(sessionID, turns as unknown as FrozenSource)
  const assistantKeys = new Map<string, string[]>()
  const errors = new Map<string, SessionStructuredError>()
  const continued = new Set<string>()
  for (const message of turns) {
    if (message.type === "assistant") assistantKeys.set(message.id, contentKeys(message.content as never))
    if (message.type === "assistant" && message.error) errors.set(message.id, message.error)
    if (message.type === "user" && message.metadata?.[CONTINUE_METADATA_KEY] === true) continued.add(message.id)
  }
  return normalized.messages.map((info) => {
    const parts = normalized.parts.get(info.id) ?? []
    const keys = assistantKeys.get(info.id)
    const renumbered = parts.map((part, index) => {
      const restored = toV1ToolPart(restoreStagedAttachment(part))
      const position = keys ? keys.indexOf(semanticKey(info.id, part)) : -1
      return {
        ...restored,
        ...displayOf(restored),
        ...(continued.has(info.id) && restored.type === "text" ? { synthetic: true } : {}),
        id: partID(info.id, position >= 0 ? position : index),
      } as Part
    })
    const error = info.role === "assistant" ? info.error : undefined
    const structured = errors.get(info.id)
    const named = error && structured ? ({ ...info, error: v1TurnError(error, structured) } as Message) : info
    return { info: named, parts: renumbered.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) }
  })
}

// ── `#1669` 回合失败 → 0.1.26 回合错误卡读的形状 ─────────────────────────────────────────────────────────
// 0.1.26 的回合错误卡(timeline-model.ts turnErrorOf)读**助手消息**的 `error`,按错误名与状态码认原因(turnErrorCauseOf)。
// 2.x 在两处与它对不上,各自让失败从界面上消失:

/**
 * ① 一步没开出来就失败(模型不可用 `provider.no-route`、平台凭据读不到),2.x 只在回合末的 `idle` 上记错误,没有带错误的助手消息;
 * 冻结投影不读 `idle`,于是只剩用户气泡。这里在那条 `idle` 的位置换上一条同 id 的空助手消息带着这个错误(冻结投影照常把它挂到
 * 这个回合的用户消息下)。回合起点与冻结投影同一判据:用户消息、带说明的 synthetic 开回合;shell 自带助手消息。
 */
function withFailedTurns(source: readonly SessionMessageInfo[]): SessionMessageInfo[] {
  let agent = ""
  let model: SessionMessageAssistant["model"] = { id: "", providerID: "" }
  // 当前回合还没有哪条助手消息带着错误(回合外 = false)
  let unreported = false
  return source.map((message) => {
    if (message.type === "agent-switched") agent = message.agent
    if (message.type === "model-switched") model = message.model
    if (message.type === "user" || (message.type === "synthetic" && !!message.description?.trim())) unreported = true
    if (message.type === "shell") unreported = false
    if (message.type === "assistant") {
      agent = message.agent
      model = message.model
      if (message.error) unreported = false
    }
    if (message.type !== "idle" || message.outcome !== "failed" || !message.error || !unreported) return message
    unreported = false
    return {
      id: message.id,
      type: "assistant",
      time: { created: message.time.created, completed: message.time.created },
      agent,
      model,
      content: [],
      finish: "error",
      error: message.error,
    } satisfies SessionMessageAssistant
  })
}

/**
 * ② 冻结投影把 2.x 的结构化错误一律压成 `UnknownError{message}`,状态码与类型丢掉,卡片认不出原因,只剩「这轮回复没有完成」。
 * 这里按 0.1.26 引擎给同一类失败的名字还原(v0.1.26 packages/opencode/src/session/message-v2.ts fromError):
 *   · 带 HTTP 状态 ⇒ `APIError{statusCode, responseBody}`(v1 的 APICallError 分支;401 / 402 / 403 / 429 由卡片认原因);
 *   · `provider.auth` 不带状态(平台凭据读不到,引擎侧 to-session-error.ts 的 codepuppy 块)⇒ `ProviderAuthError`(v1 LoadAPIKeyError 分支);
 *   · `provider.transport` ⇒ `APIError`(v1 结算联网失败的同一个名字;网络层另由 v1ErrorData 读回);
 *   · 中断与其余照冻结投影的名字。文本一律经 v1ErrorData 去掉登记码前缀。
 */
function v1TurnError(frozen: NonNullable<AssistantMessage["error"]>, error: SessionStructuredError) {
  const data = v1ErrorData(error.message)
  if (frozen.name !== "MessageAbortedError" && error.status !== undefined)
    return { name: "APIError", data: { ...data, statusCode: error.status, ...(error.response ? { responseBody: error.response.body } : {}) } }
  if (frozen.name !== "MessageAbortedError" && error.type === "provider.auth") return { name: "ProviderAuthError", data }
  if (frozen.name !== "MessageAbortedError" && error.type === "provider.transport") return { name: "APIError", data }
  return { ...frozen, data: { ...frozen.data, ...data } }
}

// ── 工具 part:2.x 内建工具的入参 / metadata → 冻结工具卡读的 v1 键 ───────────────────────────────────────
// 冻结的 tool-card-model.ts 按 0.1.26 引擎的键读卡面;2.x 的同一工具改了名(K5,卡片分派已认新名)也改了键。逐个对过
// 卡片的读取点(真引擎采样 fixtures/tools.json):
//   · read      入参 `path`                         → 卡头 / 「已探索」行读 `filePath`;读目录的 `metadata.display`(目录网格卡)
//               由 ext 在 execute.after 从结构化结果写好(I-05 契约 B,packages/ext/src/policy/display.ts),原样透传;
//   · edit      metadata.files[].patch              → 展开的 diff 读 `metadata.diff`(filediff 冻结投影已给);
//   · patch     metadata.files[] {file, status}     → 文件行读 `relativePath|filePath` + `type`(add/update/delete);
//   · subagent  入参 `agent`、metadata.sessionID     → 任务卡读 `subagent_type`、`sessionId`(「打开子会话」)、`background`。
// 其余命中专用卡的工具(shell 的 command / exit,glob / grep 的 pattern、include、count、matches,webfetch 的 url,
// websearch 的 query,skill 的 metadata.name,question 的 questions / answers,write 的 path → filePath 由冻结投影给)
// 键名两代相同,不动。
const PATCH_TYPES: Record<string, string> = { added: "add", deleted: "delete", modified: "update" }

function toV1ToolPart(part: Part): Part {
  if (part.type !== "tool") return part
  const state = part.state as { status: string; input: Record<string, unknown>; output?: unknown; metadata?: Record<string, unknown> }
  const input = state.input
  const metadata = state.metadata
  const files = Array.isArray(metadata?.files) ? (metadata.files as Array<Record<string, unknown>>) : undefined
  const next = (changes: { input?: Record<string, unknown>; metadata?: Record<string, unknown> }) =>
    ({
      ...part,
      state: {
        ...state,
        ...(changes.input ? { input: { ...input, ...changes.input } } : {}),
        ...(changes.metadata ? { metadata: { ...metadata, ...changes.metadata } } : {}),
      },
    }) as Part
  if (part.tool === "read" && typeof input.path === "string" && input.filePath === undefined) return next({ input: { filePath: input.path } })
  if (part.tool === "edit" && files && metadata?.diff === undefined)
    return next({ metadata: { diff: files.flatMap((file) => (typeof file.patch === "string" ? [file.patch] : [])).join("\n") } })
  if (part.tool === "patch" && files)
    return next({
      metadata: {
        files: files.map((file) => ({ ...file, relativePath: file.file, type: PATCH_TYPES[String(file.status)] })),
      },
    })
  if (part.tool === "subagent") {
    // 0.1.26 只在转入后台时写 `background: true`;2.x 的后台 = 入参 background,或完成时子会话仍在跑(status running)。
    const background = input.background === true || (state.status === "completed" && metadata?.status === "running")
    return next({
      ...(typeof input.agent === "string" ? { input: { subagent_type: input.agent } } : {}),
      ...(metadata
        ? { metadata: { ...(typeof metadata.sessionID === "string" ? { sessionId: metadata.sessionID } : {}), ...(background ? { background } : {}) } }
        : {}),
    })
  }
  return part
}

/**
 * I7b(ADR-041):工具卡的来源快照。L4 把它写进 2.x 工具状态的 `metadata.codepuppyDisplay`(running / completed /
 * error 三态都带,streaming 没有);v1 时间线读 `part.display`(tool-card-model.ts 的 displaySnapshotOf)。原样搬过去,
 * 缺席就不带(时间线按「来源未知」降级,与今天同一条回落)。
 */
function displayOf(part: Part) {
  if (part.type !== "tool") return {}
  const display = (part.state as { metadata?: { codepuppyDisplay?: unknown } }).metadata?.codepuppyDisplay
  return display === undefined ? {} : { display }
}

function semanticKey(messageID: string, part: Part) {
  if (part.type === "tool") return `tool:${part.callID}`
  const prefix = `${messageID}:`
  return part.id.startsWith(prefix) ? part.id.slice(prefix.length) : part.id
}

function restoreStagedAttachment(part: Part): Part {
  if (part.type !== "file") return part
  const meta = stagedAttachmentOf({ filename: part.filename, url: part.url })
  if (!meta) return part
  return {
    id: part.id,
    sessionID: part.sessionID,
    messageID: part.messageID,
    type: "text",
    text: "",
    synthetic: true,
    metadata: { [ATTACHMENT_METADATA_KEY]: meta },
  } as Part
}

// ── 其余形状 ─────────────────────────────────────────────────────────────────────────────────────

/** 2.x 项目(`canonical`)→ v1 项目(`worktree`)。字段其余同名(schema/src/project.ts 对 v1 Project)。 */
export function toV1Project(project: { id: string; canonical: string; vcs?: string } & Record<string, unknown>): Project {
  const { canonical, ...rest } = project
  return { ...rest, worktree: canonical, vcs: project.vcs === "git" ? "git" : undefined } as Project
}

/** 冻结 app 的归一结果是 store 形状(`all` 为 Map);v1 HTTP 响应要数组。 */
export function toV1ProviderList(
  providers: ProviderListOutput["data"],
  models: ModelListOutput["data"],
  defaultModel: ModelDefaultOutput["data"] | undefined,
): ProviderListResponse {
  const normalized = normalizeProviderList(providers as never, withoutTitleAliases(models) as never, defaultModel as never)
  return {
    all: [...normalized.all.values()],
    default: normalized.default,
    connected: normalized.connected,
  } as ProviderListResponse
}

/**
 * `GET /api/model`(composer 的模型合同 `client.v2.model.list`,renderer/codepuppy-ui/model-contract.ts)。0.1.26 由 v1 引擎原生答
 * (origin/alpha packages/protocol/src/groups/model.ts:10);2.x 同一路径、同一 location 信封(`{ location, data }`),Code Puppy 读的
 * 字段(id / providerID / name / enabled / status / capabilities.input / variants[].id / limit)同名同义 —— 只剥标题用的 `none` 档。
 */
export function toV1ModelList<Listed extends { data: readonly { variants: readonly { id: string }[] }[] }>(listed: Listed) {
  return { ...listed, data: withoutTitleAliases(listed.data) }
}

const withoutTitleAliases = <Model extends { variants: readonly { id: string }[] }>(models: readonly Model[]) =>
  models.map((model) => ({ ...model, variants: withoutTitleAlias(model.variants) }))

/**
 * `#1662`:引擎配置给有档位的模型在末尾多写的 `none`(第一档的拷贝,只为 2.x 的标题选档,main/codepuppy-models.ts `engineModel`)
 * 不是用户的档位,冻结界面的 provider 列表里剥掉它。只剥「排在第一档之后、内容与第一档相同」的那一个;目录自己的 `none` 档原样。
 */
function withoutTitleAlias<Variant extends { id: string }>(variants: readonly Variant[]): Variant[] {
  const overlay = ({ id: _id, ...rest }: Variant) => JSON.stringify(rest)
  const first = variants[0]
  return variants.filter((variant, index) => !(index > 0 && variant.id === TITLE_VARIANT_ALIAS && overlay(variant) === overlay(first!)))
}

/**
 * v1 Path。2.x 的 location 没有家目录、状态与配置目录;冻结 app 的 v2 支路对它们给的就是空串
 * (bootstrap.ts loadPathQuery),这里同一约定。
 */
export function toV1Path(location: LocationPublicInfo): Path {
  return { home: "", state: "", config: "", worktree: location.project.canonical, directory: location.directory }
}

export function toV1FileNodes(directory: string, entries: readonly FileSystemEntry[]): FileNode[] {
  return entries.map((entry) => {
    const path = entry.path.replace(/\/$/, "")
    return {
      name: path.split("/").at(-1) ?? path,
      path,
      absolute: `${directory.replace(/\/$/, "")}/${path}`,
      type: entry.type,
      ignored: false,
    }
  })
}

/** 2.x 的 MCP 列表 → v1 `{ [name]: status }`(状态五种同形,seams 第 4 节)。 */
export function toV1McpStatus(servers: readonly McpServer[]) {
  return Object.fromEntries(servers.map((server) => [server.name, v1McpStatus(server.status)]))
}

// ── H2:Code Puppy 登记的失败码 ─────────────────────────────────────────────────────────────────────────
// 2.x 的公开形状(`Mcp.Status` 的 error、会话错误的 message)只有一段文本;我们接管的引擎代码在文本前加登记码
// (L4,`withFailureCode`)。前缀的形状只在 schema 包里定义,这里只用 `parseFailureCode` 读回,不手解。读回后去掉前缀,
// 码交给 0.1.26 界面读的那个字段;认不出(无前缀 / 码没登记)原样不动。

/** MCP 状态:failed 的码进 v1 的 `code`(定制中心据 `dependency_missing` 给「重新安装」,use-extensions.ts mcpRepair)。 */
export function v1McpStatus(status: McpServer["status"]) {
  if (!("error" in status) || typeof status.error !== "string") return status
  const parsed = parseFailureCode(status.error)
  if (!parsed) return status
  return { ...status, error: parsed.text, ...(status.status === "failed" ? { code: parsed.code } : {}) }
}

/** 会话错误:网络层的码进 `metadata.codepuppyNetLayer`(回合错误卡按层选句子,timeline-model.ts turnErrorOf)。 */
export function v1ErrorData(message: string): { message: string; metadata?: { codepuppyNetLayer: string } } {
  const parsed = parseFailureCode(message)
  if (!parsed) return { message }
  return { message: parsed.text, ...(isNetFailureLayer(parsed.code) ? { metadata: { codepuppyNetLayer: parsed.code } } : {}) }
}

/** 2.x 的命令(只有名字和说明)与技能 → v1 Command。v1 引擎的 `/command` 把技能列成 source=skill 的命令。 */
export function toV1Commands(
  commands: readonly CommandInfo[],
  skills: ReadonlyArray<{ id: string; description?: string }>,
): Command[] {
  return [
    ...commands.map((command) => ({
      name: command.name,
      description: command.description,
      source: "command" as const,
      template: "",
      hints: [],
    })),
    ...skills.map((skill) => ({
      name: skill.id,
      description: skill.description,
      source: "skill" as const,
      template: "",
      hints: [],
    })),
  ]
}

/** 2.x 的提问是一张 `metadata.kind === "question"` 的表单(core/src/tool/plugin/question.ts);别的表单 v1 没有对应。 */
export function toV1Question(form: FormInfo): QuestionRequest | undefined {
  const metadata = form.metadata as { kind?: string; tool?: { messageID?: string; id?: string } } | undefined
  if (metadata?.kind !== "question") return undefined
  const fields = form.fields as unknown as Array<{
    title?: string
    description?: string
    type: string
    options?: Array<{ label: string; description?: string }>
    custom?: boolean
  }>
  return {
    id: form.id,
    sessionID: form.sessionID,
    questions: fields.map((field) => ({
      question: field.description ?? "",
      header: field.title ?? "",
      options: (field.options ?? []).map((option) => ({ label: option.label, description: option.description ?? "" })),
      multiple: field.type === "multiselect",
      custom: field.custom,
    })),
    tool:
      metadata.tool?.messageID && metadata.tool.id
        ? { messageID: metadata.tool.messageID, callID: metadata.tool.id }
        : undefined,
  }
}

/** v1 的回答(每题一个字符串数组)→ 2.x 表单答案(`q<序号>`;多选给数组,单选给第一个)。 */
export function toFormAnswer(question: QuestionRequest | undefined, answers: ReadonlyArray<ReadonlyArray<string>>) {
  return Object.fromEntries(
    answers.map((answer, index) => {
      const multiple = question?.questions[index]?.multiple === true
      return [`q${index}`, multiple ? [...answer] : (answer[0] ?? "")]
    }),
  )
}

/** todowrite 的输入 → v1 Todo(v1 还要 priority,2.x 没有,补 medium)。事件流的 todo.updated 用同一个函数。 */
export function todosOf(part: Part) {
  if (part.type !== "tool" || part.tool !== "todowrite") return undefined
  const input = (part.state as { input?: { todos?: Array<{ content: string; status: string }> } }).input
  return input?.todos?.map((item) => ({ content: item.content, status: item.status, priority: "medium" }))
}

/**
 * I7a:2.x 审批请求 → v1。冻结 app 的 normalizePermissionRequest 按 1.17.13 的形状读工具来源(`source.callID`);
 * 2.x 的来源是 `{ type: "tool", messageID, id }`(真引擎采样 fixtures/permission-asked.json,seams I7a)。这里只补这一处
 * 漂移,其余字段(action → permission、resources → patterns、save → always、metadata 原样)仍由冻结函数映射。
 * `#1669` R17:能力轴(没有 `metadata.policy`)的委派动作名也漂了 —— 2.x 的 subagent 工具问 `subagent`(core
 * tool/plugin/subagent.ts),0.1.26 问 `task`;审批卡按 `task` 画委派卡(「派出子任务 / 交给助手 <名字> / 子任务里不再逐项询问」,
 * PermissionDialog.tsx),这里换回 v1 的名字。身份轴请求的 action 是 canonical(seams I7a 冻结),不动。
 */
export function toV1PermissionRequest(
  request: { action?: unknown; metadata?: { policy?: unknown }; source?: { type: string; messageID?: string; id?: string } } & Record<string, unknown>,
) {
  const source = request.source?.type === "tool" ? { ...request.source, callID: request.source.id } : request.source
  const delegation = request.action === "subagent" && request.metadata?.policy === undefined
  return normalizePermissionRequest({ ...request, ...(delegation ? { action: "task" } : {}), source } as never)
}

/**
 * REQ-142 回合改动:0.1.26 的引擎把每个回合改了哪些文件写进那个回合的**用户消息** `summary.diffs`,右栏审阅面板
 * 经 `turnDiffsOf`(session-rail/review/review-turn-diffs.ts)从 store 里读最近一个回合的。2.x 把它做成按回合的
 * `GET /api/session/:id/diff?from=<用户消息>`(FileDiffInfo 与 v1 SnapshotFileDiff 同形)。这里把取回的回合改动挂回
 * 那条 v1 用户消息,面板与 turnDiffsOf 不用改。
 */
export function withTurnDiffs(messages: V1MessageWithParts[], diffs: ReadonlyMap<string, readonly unknown[]>) {
  return messages.map((item) => {
    const found = item.info.role === "user" ? diffs.get(item.info.id) : undefined
    return found ? { ...item, info: { ...item.info, summary: { diffs: [...found] } } as Message } : item
  })
}

/**
 * REQ-142 的回合锚。turnDiffsOf 只读最近一条 v1 用户消息(`attach`,改动挂在它上面);2.x 的逐回合 diff 认用户消息与引擎的
 * synthetic 消息当 `from`(Code Puppy 接管的 core/src/session/diff.ts,`e27bec1704`;别的类型回 TurnRangeError)。
 *   · 最近一条 v1 用户消息本身是 2.x 用户消息(含「继续」):from = attach = 它;
 *   · 它是引擎自己发的 synthetic(带 description,如后台子代理的完成通知)且是在回合里插进来的(它与前一条 2.x 用户消息之间
 *     没有 idle 标记):那个回合的锚就是前一条用户消息,from = 那条,改动仍挂在 synthetic 上;
 *   · synthetic 在 idle 之后自己开了一个回合:这个回合的锚就是它自己,from = attach = 它(与 0.1.26 一致,审阅面板显示这个
 *     回合的改动)。
 */
export function turnAnchor(messages: readonly V1MessageWithParts[], source: readonly SessionMessageInfo[]) {
  const attach = messages.findLast((item) => item.info.role === "user")?.info.id
  const index = attach ? source.findIndex((message) => message.id === attach) : -1
  const latest = source[index]
  if (!attach || !latest) return undefined
  if (latest.type === "user") return { from: attach, attach }
  if (latest.type !== "synthetic") return undefined
  for (let at = index - 1; at >= 0; at--) {
    if (source[at]!.type === "idle") return { from: attach, attach }
    if (source[at]!.type === "user") return { from: source[at]!.id, attach }
  }
  return undefined
}
