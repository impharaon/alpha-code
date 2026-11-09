// `#1668`:`GET /global/event` —— 把 2.x 的 `/api/event` 投影成冻结界面要的 v1 GlobalEvent 流
// (`data: {"directory", "payload": {"type", "properties"}}`)。
//
// 投影规则(方案 §2.3「事件流」):
//   · 直通:pty.*、lsp.updated、vcs.branch.updated、mcp.*、reference.updated、server.connected、global.disposed;
//   · 改名:location.shutdown → server.instance.disposed;agent/command/skill.updated → catalog.updated;
//     project.updated(`canonical` → `worktree`);permission.asked(I7a 字段映射)/ replied;
//     form.*(`metadata.kind === "question"`)→ question.asked / replied / rejected;
//   · 派生:session.execution.* → session.status / session.idle / session.error;retry → session.status retry;
//     会话属性变化 → 重取会话发 session.created / updated;
//   · 消息:流式增量(text / reasoning)直接转 message.part.delta;其余每个结构性事件之后重取最近一页消息,
//     经 toV1Messages 投影,**只发有变化的** message.updated / message.part.updated —— 增量只用来让字一个个出来,
//     内容以 2.x 存储为准。todowrite 工具的输入同时投影成 todo.updated(U1)。
// 不认识的事件丢弃(它们在 v1 没有对应,冻结界面也不读)。
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client/promise"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { normalizePermissionRequest, normalizeSessionInfo } from "./frozen-shapes"
import type { RouteContext } from "./routes"
import { recentMessages, rememberSessionDirectory, sessionDirectory } from "./session-cache"
import { contentKeys, partID, todosOf, toV1Messages, toV1Project, toV1Question } from "./v1-shapes"

export type V1Payload = { type: string; properties: unknown }
type Emit = (directory: string, payload: V1Payload) => void

const SNAPSHOT_WINDOW = 20

/** 结构性的消息事件:之后按存储重取最近一页并发出变化。 */
const SNAPSHOT_EVENTS = new Set([
  "session.inbox.delivered",
  "session.step.started",
  "session.step.streamed",
  "session.step.ended",
  "session.step.failed",
  "session.text.ended",
  "session.reasoning.ended",
  "session.tool.input.started",
  "session.tool.input.ended",
  "session.tool.called",
  "session.tool.success",
  "session.tool.failed",
  "session.synthetic",
  "session.skill.activated",
  "session.shell.started",
  "session.shell.ended",
  "session.compaction.started",
  "session.compaction.ended",
  "session.compaction.failed",
  "session.message.content.updated",
  "session.revert.staged",
  "session.revert.cleared",
  "session.revert.committed",
])

/** 改变会话属性的事件:之后重取会话发 session.updated。 */
const SESSION_INFO_EVENTS = new Set([
  "session.renamed",
  "session.moved",
  "session.archived",
  "session.unarchived",
  "session.metadata.updated",
  "session.agent.selected",
  "session.model.selected",
  "session.permissions",
  "session.forked",
  "session.revert.staged",
  "session.revert.cleared",
  "session.revert.committed",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
])

const PASS_THROUGH = new Set([
  "pty.created",
  "pty.updated",
  "pty.exited",
  "pty.deleted",
  "lsp.updated",
  "vcs.branch.updated",
  "reference.updated",
  "server.connected",
  "global.disposed",
])

export function createProjector(api: OpenCodeClient, emit: Emit) {
  /** 助手消息 → content 块的语义键(按出现顺序 = content 下标),流式 part 的 id 由它定。 */
  const blocks = new Map<string, string[]>()
  /** 已发出的 v1 对象(按 id)的 JSON,用于只发变化。 */
  const emitted = new Map<string, string>()
  const sessions = new Map<string, unknown>()

  const remember = (key: string, value: unknown) => {
    const encoded = JSON.stringify(value)
    if (emitted.get(key) === encoded) return false
    emitted.set(key, encoded)
    if (emitted.size > 5_000) emitted.delete(emitted.keys().next().value!)
    return true
  }

  async function snapshot(directory: string, sessionID: string) {
    const page = await recentMessages(api, sessionID, { limit: SNAPSHOT_WINDOW })
    for (const message of page.context) {
      if (message.type === "assistant") blocks.set(message.id, contentKeys(message.content as never))
    }
    for (const { info, parts } of toV1Messages(sessionID, page.context)) {
      if (remember(`message:${info.id}`, info)) emit(directory, { type: "message.updated", properties: { info } })
      for (const part of parts) {
        if (remember(`part:${part.id}`, part)) emit(directory, { type: "message.part.updated", properties: { part } })
        todo(directory, sessionID, part)
      }
    }
  }

  /** U1:todowrite 的输入就是清单,投影成 v1 todo.updated。 */
  function todo(directory: string, sessionID: string, part: Part) {
    const todos = todosOf(part)
    if (todos && remember(`todo:${sessionID}`, todos)) emit(directory, { type: "todo.updated", properties: { sessionID, todos } })
  }

  async function sessionInfo(directory: string, sessionID: string, type: "session.created" | "session.updated") {
    const info = normalizeSessionInfo((await api.session.get({ sessionID })) as never)
    sessions.set(sessionID, info)
    emit(directory, { type, properties: { info } })
  }

  /** 流式块的 v1 part id:块的语义键在该消息里第几个出现。没见过这条消息(中途接上)就先按存储初始化。 */
  async function streamPartID(sessionID: string, messageID: string, key: string) {
    let keys = blocks.get(messageID)
    if (!keys) {
      const page = await recentMessages(api, sessionID, { through: messageID })
      const message = page.context.find((item) => item.id === messageID)
      keys = message?.type === "assistant" ? contentKeys(message.content as never) : []
      blocks.set(messageID, keys)
    }
    let index = keys.indexOf(key)
    if (index < 0) {
      keys.push(key)
      index = keys.length - 1
    }
    return partID(messageID, index)
  }

  return async function project(event: OpenCodeEvent) {
    const frame = event as unknown as {
      type: string
      created?: number
      location?: { directory?: string }
      data: Record<string, any>
    }
    const data = frame.data ?? {}
    const sessionID: string | undefined = typeof data.sessionID === "string" ? data.sessionID : undefined
    if (sessionID && frame.location?.directory) rememberSessionDirectory(sessionID, frame.location.directory)
    const directory =
      frame.location?.directory ?? (sessionID ? await sessionDirectory(api, sessionID).catch(() => "global") : "global")
    const type = frame.type

    if (PASS_THROUGH.has(type)) return emit(directory, { type, properties: data })
    if (type.startsWith("mcp.")) return emit(directory, { type, properties: data })
    if (type === "location.shutdown") return emit(directory, { type: "server.instance.disposed", properties: { directory } })
    if (type === "agent.updated" || type === "command.updated" || type === "skill.updated")
      return emit(directory, { type: "catalog.updated", properties: {} })
    if (type === "project.updated") return emit(directory, { type, properties: toV1Project(data as never) })
    if (type === "permission.asked") return emit(directory, { type, properties: normalizePermissionRequest(data as never) })
    if (type === "permission.replied") return emit(directory, { type, properties: data })
    if (type === "form.created") {
      const question = toV1Question(data.form)
      return question ? emit(directory, { type: "question.asked", properties: question }) : undefined
    }
    if (type === "form.replied") {
      const answer = data.answer as Record<string, string | string[]>
      const answers = Object.keys(answer)
        .filter((key) => /^q\d+$/.test(key))
        .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
        .map((key) => (Array.isArray(answer[key]) ? answer[key] : [String(answer[key])]))
      return emit(directory, { type: "question.replied", properties: { sessionID, requestID: data.id, answers } })
    }
    if (type === "form.cancelled")
      return emit(directory, { type: "question.rejected", properties: { sessionID, requestID: data.id } })
    if (!sessionID) return

    if (type === "session.created") return sessionInfo(directory, sessionID, "session.created")
    if (type === "session.deleted")
      return emit(directory, { type, properties: { sessionID, ...(sessions.has(sessionID) ? { info: sessions.get(sessionID) } : {}) } })
    if (type === "session.usage.updated") return emit(directory, { type, properties: data })

    if (type === "session.text.started" || type === "session.reasoning.started") {
      const kind = type === "session.text.started" ? "text" : "reasoning"
      const messageID = data.assistantMessageID as string
      const id = await streamPartID(sessionID, messageID, `${kind}:${data.ordinal}`)
      const part = {
        id,
        sessionID,
        messageID,
        type: kind,
        text: "",
        ...(kind === "reasoning" ? { time: { start: frame.created ?? Date.now() } } : {}),
      } as Part
      if (remember(`part:${id}`, part)) emit(directory, { type: "message.part.updated", properties: { part } })
      return
    }
    if (type === "session.text.delta" || type === "session.reasoning.delta") {
      const kind = type === "session.text.delta" ? "text" : "reasoning"
      const messageID = data.assistantMessageID as string
      const id = await streamPartID(sessionID, messageID, `${kind}:${data.ordinal}`)
      emitted.delete(`part:${id}`)
      return emit(directory, {
        type: "message.part.delta",
        properties: { sessionID, messageID, partID: id, field: "text", delta: data.delta },
      })
    }
    if (type === "session.tool.input.started") {
      await streamPartID(sessionID, data.assistantMessageID, `tool:${data.id}`)
    }
    if (SNAPSHOT_EVENTS.has(type)) await snapshot(directory, sessionID)
    if (SESSION_INFO_EVENTS.has(type)) await sessionInfo(directory, sessionID, "session.updated")

    if (type === "session.execution.started") return emit(directory, { type: "session.status", properties: { sessionID, status: { type: "busy" } } })
    if (type === "session.retry.scheduled")
      return emit(directory, {
        type: "session.status",
        properties: { sessionID, status: { type: "retry", attempt: data.attempt, message: data.error?.message ?? "", next: data.at } },
      })
    if (type === "session.execution.failed")
      emit(directory, {
        type: "session.error",
        properties: { sessionID, error: { name: "UnknownError", data: { message: data.error?.message ?? "" } } },
      })
    if (type === "session.execution.succeeded" || type === "session.execution.failed" || type === "session.execution.interrupted") {
      emit(directory, { type: "session.status", properties: { sessionID, status: { type: "idle" } } })
      emit(directory, { type: "session.idle", properties: { sessionID } })
    }
  }
}

/** `GET /global/event` 的 handler:一个 SSE Response,订阅方中止即退订 2.x。 */
export function projectEventStream(context: RouteContext): Response {
  const controller = new AbortController()
  const abort = () => controller.abort()
  context.signal.addEventListener("abort", abort)
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(sink) {
      const emit: Emit = (directory, payload) => {
        if (controller.signal.aborted) return
        sink.enqueue(encoder.encode(`data: ${JSON.stringify({ directory, payload })}\n\n`))
      }
      const project = createProjector(context.api, emit)
      void (async () => {
        try {
          for await (const event of context.api.event.subscribe({ signal: controller.signal })) {
            await project(event).catch((error) => console.error("[engine-adapter] event projection failed", event.type, error))
          }
        } catch (error) {
          if (!controller.signal.aborted) console.error("[engine-adapter] engine event stream failed", error)
        } finally {
          context.signal.removeEventListener("abort", abort)
          try {
            sink.close()
          } catch {}
        }
      })()
    },
    cancel: abort,
  })
  return new Response(stream, { headers: { "content-type": "text/event-stream" } })
}

