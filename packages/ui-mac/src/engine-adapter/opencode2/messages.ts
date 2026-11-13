// `#1697`(I-04,设计 §4.3、§6 K2、R6):2.x 会话消息 → v1 `{info, parts}` 的代际转换,翻译器自有,入参按 2.x 类型写。
//
// 它逐支沿用冻结 app 的 `normalizeSessionMessages`(codepuppy-app/src/utils/session-message.ts)在 2.x 输入上会走的分支 ——
// 那个原件只在冻结 app 的 v2 支路里调用,Code Puppy 不运行,保持逐字不变;现用路径上的这一步转换只有翻译器在跑,所以改由
// 翻译器自己写,不再借 `as never` 把 2.x 的值喂给按 1.17.13 类型写的冻结函数。两者在全部采样夹具上逐个相等,由
// projection-parity.test.ts 钉住。1.17.13 谱系有、2.x 没有的字段(推理块的 `state`、工具的 `providerState` /
// `providerResultState`)原件读到的恒为 undefined,序列化后不出现,这里不再写。
import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageShell,
  SessionMessageUser,
} from "@opencode/client/promise"
import type { AssistantMessage, FilePart, Message, Part, ToolPart, UserMessage } from "../contract/v1"

type ModelSelection = { id: string; providerID: string; variant?: string }

const emptyTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
const emptyModel: ModelSelection = { id: "", providerID: "" }

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

/** 流式阶段的工具入参是一段还没写完的 JSON 文本:解得开就用,解不开当空入参。 */
function decodeToolInput(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function normalizeToolInput(name: string, input: Record<string, unknown>) {
  if (!["edit", "write"].includes(name) || typeof input.path !== "string" || typeof input.filePath === "string") return input
  return { ...input, filePath: input.path }
}

function normalizeToolMetadata(name: string, metadata: Record<string, unknown>) {
  if (name !== "edit" || !Array.isArray(metadata.files)) return metadata
  const file = metadata.files.find(record)
  if (!file || typeof file.file !== "string") return metadata
  return {
    ...metadata,
    filediff: {
      file: file.file,
      patch: typeof file.patch === "string" ? file.patch : undefined,
      additions: typeof file.additions === "number" ? file.additions : 0,
      deletions: typeof file.deletions === "number" ? file.deletions : 0,
    },
  }
}

const textPartID = (messageID: string, type: "text" | "reasoning", ordinal: number) => `${messageID}:${type}:${ordinal}`

/** 2.x 的消息列表(时间升序)→ v1 消息与各自的 part(part 的有序 id、暂存附件等在 v1-shapes 的 toV1Messages 里再处理)。 */
export function projectSessionMessages(sessionID: string, source: readonly SessionMessageInfo[]) {
  const messages: Message[] = []
  const parts = new Map<string, Part[]>()
  let agent = ""
  let model = emptyModel
  let parentID: string | undefined

  for (const message of source) {
    if (message.type === "agent-switched") {
      agent = message.agent
      continue
    }
    if (message.type === "model-switched") {
      model = message.model
      continue
    }
    if (message.type === "user") {
      parentID = message.id
      messages.push(userMessage(sessionID, message, agent, model))
      parts.set(message.id, userParts(sessionID, message))
      continue
    }
    if (message.type === "synthetic" && message.description?.trim()) {
      parentID = message.id
      messages.push({
        id: message.id,
        sessionID,
        role: "user",
        time: message.time,
        agent,
        model: { providerID: model.providerID, modelID: model.id, variant: model.variant },
      })
      parts.set(message.id, [textPart(sessionID, message.id, 0, message.description, true)])
      continue
    }
    if (message.type === "shell") {
      messages.push(...shellMessages(sessionID, message, agent, model))
      parts.set(message.id, [textPart(sessionID, message.id, 0, message.command)])
      parts.set(`${message.id}:assistant`, [shellPart(sessionID, message)])
      parentID = undefined
      continue
    }
    if (message.type === "assistant") {
      agent = message.agent
      model = message.model
      if (!parentID) continue
      const parent = messages.findLast((item) => item.id === parentID)
      if (parent?.role === "user") {
        parent.agent = message.agent
        parent.model = { providerID: message.model.providerID, modelID: message.model.id, variant: message.model.variant }
      }
      messages.push(assistantMessage(sessionID, parentID, message))
      parts.set(message.id, assistantParts(sessionID, message))
      continue
    }
    if (message.type !== "compaction" || !parentID) continue
    parts.set(parentID, [
      ...(parts.get(parentID) ?? []),
      { id: `${message.id}:compaction`, sessionID, messageID: parentID, type: "compaction", auto: message.reason === "auto" },
    ])
  }

  return { messages, parts }
}

function shellMessages(sessionID: string, message: SessionMessageShell, agent: string, model: ModelSelection): [UserMessage, AssistantMessage] {
  return [
    {
      id: message.id,
      sessionID,
      role: "user",
      time: { created: message.time.created },
      agent,
      model: { providerID: model.providerID, modelID: model.id, variant: model.variant },
    },
    {
      id: `${message.id}:assistant`,
      sessionID,
      role: "assistant",
      time: message.time,
      parentID: message.id,
      modelID: model.id,
      providerID: model.providerID,
      variant: model.variant,
      mode: agent,
      agent,
      path: { cwd: "", root: "" },
      cost: 0,
      tokens: emptyTokens,
    },
  ]
}

function shellPart(sessionID: string, message: SessionMessageShell): ToolPart {
  const input = { command: message.command }
  const start = message.time.created
  const state: ToolPart["state"] =
    message.status === "running"
      ? { status: "running", input, time: { start } }
      : {
          status: "completed",
          input,
          output: message.output?.output ?? "",
          title: "Shell",
          metadata: { status: message.status, exit: message.exit, truncated: message.output?.truncated },
          time: { start, end: message.time.completed ?? start },
        }
  return { id: `${message.id}:tool`, sessionID, messageID: `${message.id}:assistant`, type: "tool", callID: message.shellID, tool: "bash", state }
}

function userMessage(sessionID: string, message: SessionMessageUser, agent: string, model: ModelSelection): UserMessage {
  return {
    id: message.id,
    sessionID,
    role: "user",
    time: message.time,
    agent,
    model: { providerID: model.providerID, modelID: model.id, variant: model.variant },
  }
}

function userParts(sessionID: string, message: SessionMessageUser): Part[] {
  return [
    textPart(sessionID, message.id, 0, message.text),
    ...(message.files ?? []).map(
      (file, index): FilePart => ({
        id: `${message.id}:file:${index}`,
        sessionID,
        messageID: message.id,
        type: "file",
        mime: file.mime,
        filename: file.name,
        url: file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`,
        source: file.mention
          ? {
              type: "file",
              text: { value: file.mention.text, start: file.mention.start, end: file.mention.end },
              path: file.mention.text.startsWith("@") ? file.mention.text.slice(1) : (file.name ?? file.mention.text),
            }
          : undefined,
      }),
    ),
    ...(message.agents ?? []).map(
      (item, index): Part => ({
        id: `${message.id}:agent:${index}`,
        sessionID,
        messageID: message.id,
        type: "agent",
        name: item.name,
        source: item.mention ? { value: item.mention.text, start: item.mention.start, end: item.mention.end } : undefined,
      }),
    ),
  ]
}

function assistantMessage(sessionID: string, parentID: string, message: SessionMessageAssistant): AssistantMessage {
  const error = message.error
    ? message.error.type.toLowerCase().includes("abort") || message.error.type.toLowerCase().includes("interrupt")
      ? { name: "MessageAbortedError" as const, data: { message: message.error.message } }
      : { name: "UnknownError" as const, data: { message: message.error.message } }
    : undefined
  return {
    id: message.id,
    sessionID,
    role: "assistant",
    time: message.time,
    error,
    parentID,
    modelID: message.model.id,
    providerID: message.model.providerID,
    variant: message.model.variant,
    mode: message.agent,
    agent: message.agent,
    path: { cwd: "", root: "" },
    cost: message.cost ?? 0,
    tokens: message.tokens ?? emptyTokens,
    finish: message.finish,
  }
}

function assistantParts(sessionID: string, message: SessionMessageAssistant): Part[] {
  const ordinals = { text: 0, reasoning: 0 }
  return message.content.flatMap((content): Part[] => {
    if (content.type === "text") {
      const part = textPart(sessionID, message.id, ordinals.text++, content.text)
      return content.text.trim() ? [part] : []
    }
    if (content.type === "reasoning") {
      const part: Part = {
        id: textPartID(message.id, "reasoning", ordinals.reasoning++),
        sessionID,
        messageID: message.id,
        type: "reasoning",
        text: content.text,
        time: { start: content.time?.created ?? message.time.created, end: content.time?.completed },
      }
      return content.text.trim() ? [part] : []
    }
    return [toolPart(sessionID, message.id, content)]
  })
}

function textPart(sessionID: string, messageID: string, ordinal: number, text: string, synthetic?: boolean): Part {
  return { id: textPartID(messageID, "text", ordinal), sessionID, messageID, type: "text", text, synthetic }
}

function toolPart(sessionID: string, messageID: string, tool: SessionMessageAssistantTool): ToolPart {
  const start = tool.time.ran ?? tool.time.created
  const state = ((): ToolPart["state"] => {
    if (tool.state.status === "streaming") {
      const value = decodeToolInput(tool.state.input)
      return { status: "pending", input: normalizeToolInput(tool.name, record(value) ? value : {}), raw: tool.state.input }
    }
    if (tool.state.status === "running")
      return {
        status: "running",
        input: normalizeToolInput(tool.name, tool.state.input),
        metadata: normalizeToolMetadata(tool.name, tool.state.metadata),
        time: { start },
      }
    if (tool.state.status === "error")
      return {
        status: "error",
        input: normalizeToolInput(tool.name, tool.state.input),
        error: tool.state.error.message,
        metadata: normalizeToolMetadata(tool.name, tool.state.metadata ?? {}),
        time: { start, end: tool.time.completed ?? start },
      }
    const attachments = tool.state.content.flatMap((item, index): FilePart[] =>
      item.type === "file"
        ? [
            {
              id: `${tool.id}:file:${index}`,
              sessionID,
              messageID,
              type: "file",
              mime: item.mime,
              // 2.x 允许 name 为 null,原样交出(冻结原件同样原样给;v1 类型里没有 null)
              filename: item.name as string | undefined,
              url: item.uri,
            },
          ]
        : [],
    )
    return {
      status: "completed",
      input: normalizeToolInput(tool.name, tool.state.input),
      output: tool.state.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n"),
      title: tool.name,
      metadata: normalizeToolMetadata(tool.name, tool.state.metadata ?? {}),
      time: { start, end: tool.time.completed ?? start },
      attachments: attachments.length ? attachments : undefined,
    }
  })()
  return { id: tool.id, sessionID, messageID, type: "tool", callID: tool.id, tool: tool.name, state, metadata: {} }
}
