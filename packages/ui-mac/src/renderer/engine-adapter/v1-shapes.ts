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
  SessionMessageInfo,
} from "@opencode/client/promise"
import type {
  Command,
  FileNode,
  Message,
  Part,
  Path,
  Project,
  ProviderListResponse,
  QuestionRequest,
} from "@opencode-ai/sdk/v2/client"
import { STAGED_ATTACHMENT_PART_NAME, stagedAttachmentPart } from "../../../../ext/src/staged-attachment-part"
import { ATTACHMENT_METADATA_KEY, type StagedAttachmentMeta } from "../../shared/attachment-path"
import { normalizeProviderList, normalizeSessionMessages } from "./frozen-shapes"

type FrozenSource = Parameters<typeof normalizeSessionMessages>[1]

// ── part 的有序 id ──────────────────────────────────────────────────────────────────────────────
// 冻结 app 的 v1 store 按 part.id 排序(event-reducer 的 Binary.search、server-session 加载时 sort),时间线按
// 这个顺序渲染。0.1.26 的 v1 引擎发的是按创建先后递增的 id,于是「思考 → 正文 → 工具」照内容顺序出现。
// 冻结 app 的投影给 2.x 内容起的是语义 id(`<msg>:text:0`、`<msg>:reasoning:0`、工具 id 本身),按字典序排会
// 把 `call_…` 工具排到正文前面、把多段正文挤在一起。所以适配器统一换成「消息 id + 四位序号」:助手消息的
// 序号 = 2.x `content` 数组下标(空正文被投影丢掉也不错位,流式阶段与快照阶段同一个号),其余消息按投影顺序。
export const partID = (messageID: string, index: number) => `${messageID}:${String(index).padStart(4, "0")}`

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

/** 全部 part 都是 synthetic 文本(时间线的「继续」)⇒ 这条消息在 2.x 是一条 synthetic,不是用户说的话。 */
export function syntheticText(parts: readonly V1PartInput[]) {
  if (parts.length === 0 || !parts.every((part) => part.type === "text" && part.synthetic && !isStagedAttachmentPart(part)))
    return undefined
  return parts.map((part) => part.text ?? "").join("\n")
}

// ── 读回:2.x 消息 → v1 {info, parts} ───────────────────────────────────────────────────────────────
export type V1MessageWithParts = { info: Message; parts: Part[] }

/**
 * 2.x 的消息列表(时间升序)→ v1 `{info, parts}`。投影本身是冻结 app 的 normalizeSessionMessages;这里只把
 * part id 换成有序 id,并把 I11 的暂存附件文件合成回 v1 的 synthetic part。
 */
export function toV1Messages(sessionID: string, source: readonly SessionMessageInfo[]): V1MessageWithParts[] {
  const normalized = normalizeSessionMessages(sessionID, source as unknown as FrozenSource)
  const assistantKeys = new Map<string, string[]>()
  for (const message of source) {
    if (message.type === "assistant") assistantKeys.set(message.id, contentKeys(message.content as never))
  }
  return normalized.messages.map((info) => {
    const parts = normalized.parts.get(info.id) ?? []
    const keys = assistantKeys.get(info.id)
    const renumbered = parts.map((part, index) => {
      const restored = restoreStagedAttachment(part)
      const position = keys ? keys.indexOf(semanticKey(info.id, part)) : -1
      return { ...restored, id: partID(info.id, position >= 0 ? position : index) } as Part
    })
    return { info, parts: renumbered.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) }
  })
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
  const normalized = normalizeProviderList(providers as never, models as never, defaultModel as never)
  return {
    all: [...normalized.all.values()],
    default: normalized.default,
    connected: normalized.connected,
  } as ProviderListResponse
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
  return Object.fromEntries(servers.map((server) => [server.name, server.status]))
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
