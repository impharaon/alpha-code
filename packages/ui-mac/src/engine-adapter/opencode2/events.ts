// `#1668`:`GET /global/event` —— 把 2.x 的 `/api/event` 投影成冻结界面要的 v1 GlobalEvent 流
// (`data: {"directory", "payload": {"type", "properties"}}`)。
//
// 投影规则(方案 §2.3「事件流」):
//   · 直通:pty.*、lsp.updated、vcs.branch.updated、mcp 的四种、reference.updated、server.connected、global.disposed;
//     filesystem.changed → file.watcher.updated(另由回合改动补出项目文件的增删改,见 fileChanges);
//   · 改名:location.shutdown → server.instance.disposed;agent/command/skill.updated → catalog.updated;
//     project.updated(`canonical` → `worktree`);permission.asked(I7a 字段映射)/ replied;
//     form.*(`metadata.kind === "question"`)→ question.asked / replied / rejected;
//   · 派生:session.execution.* → session.status / session.idle / session.error;retry → session.status retry;
//     会话属性变化 → 重取会话发 session.created / updated;
//   · 消息:流式增量(text / reasoning)直接转 message.part.delta;其余每个结构性事件之后重取最近一页消息,
//     经 toV1Messages 投影,**只发有变化的** message.updated / message.part.updated —— 增量只用来让字一个个出来,
//     内容以 2.x 存储为准。todowrite 工具的输入同时投影成 todo.updated(U1)。
// 不认识的事件丢弃(它们在 v1 没有对应,冻结界面也不读)。发出的事件只能是约定事件表里的类型(contract/events.ts,`#1697` I-04)。
import type { OpenCodeClient, OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import type { Part, Session } from "@opencode-ai/sdk/v2/client"
import type { ContractEvent } from "../contract/events"
import { toContractSession } from "../contract/session"
import type { PermissionReplies } from "./permission-replies"
import type { SharedContext } from "./routes"
import { recentMessages, rememberSessionDirectory, sessionDirectory } from "./session-cache"
import {
  contentKeys,
  partID,
  todosOf,
  toV1Messages,
  toV1Project,
  toV1Question,
  turnAnchor,
  v1ErrorData,
  withTurnDiffs,
} from "./v1-shapes"

/** 投影出的一个事件:类型与载荷都按约定的事件表(contract/events.ts)。 */
export type V1Payload = ContractEvent
type Emit = (directory: string, payload: V1Payload) => void

const SNAPSHOT_WINDOW = 20

/** 结构性的消息事件:之后按存储重取最近一页并发出变化。 */
export const SNAPSHOT_EVENTS = new Set([
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
  "session.tool.progress",
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

/**
 * 回合结束。2.x core/server 不发 `session.status` / `session.idle`(只剩弃用的 schema 项);回合以
 * `session.execution.succeeded|failed|interrupted` 收尾(schema/src/session-event.ts:248-259,上游自己在
 * core/src/session/message-updater.ts:149-152 也这样映射成 idle)。冻结界面靠 v1 的 session.status / session.idle
 * 判忙闲 —— 适配器在这里合成;回合开始由 `session.execution.started` 合成 busy。
 */
export const TURN_END_EVENTS = new Set([
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
])

/** REQ-142:回合改动在这些边界上按 2.x 的逐回合 diff 刷新(0.1.26 在第一步与每步结束时写 summary.diffs)。 */
export const TURN_DIFF_EVENTS = new Set([
  "session.step.ended",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
])

const SHELL_POLL_MS = 250
/** 0.1.26 shell 工具的 metadata.output 截法(packages/opencode/src/tool/shell.ts preview):超过 3 万字只留尾部。 */
const SHELL_PREVIEW_MAX = 30_000
const shellPreview = (text: string) => (text.length <= SHELL_PREVIEW_MAX ? text : "...\n\n" + text.slice(-SHELL_PREVIEW_MAX))

/** 2.x 回合改动的 status → v1 文件监视事件(files-core.ts watcherRefreshTarget:add / unlink 重列父目录)。 */
const WATCH_EVENTS: Record<string, "add" | "unlink" | "change"> = { added: "add", deleted: "unlink", modified: "change" }

type PassThroughType =
  | "pty.created"
  | "pty.updated"
  | "pty.exited"
  | "pty.deleted"
  | "lsp.updated"
  | "vcs.branch.updated"
  | "reference.updated"
  | "server.connected"
  | "global.disposed"
  | "mcp.status.changed"
  | "mcp.resources.changed"
  | "mcp.tools.changed"
  | "mcp.prompts.changed"

const PASS_THROUGH: ReadonlySet<string> = new Set<PassThroughType>([
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

/** 2.x 的 MCP 事件,两代同形直通。2.x 只定义这四种(schema/src/mcp-event.ts 三种、core/src/mcp/index.ts 的 prompts.changed)。 */
const MCP_EVENTS: ReadonlySet<string> = new Set<PassThroughType>([
  "mcp.status.changed",
  "mcp.resources.changed",
  "mcp.tools.changed",
  "mcp.prompts.changed",
])

/** 两代同形的事件:2.x 的载荷原样作为约定载荷发出。 */
const isPassThrough = (type: string): type is PassThroughType => PASS_THROUGH.has(type) || MCP_EVENTS.has(type)

export function createProjector(api: OpenCodeClient, emit: Emit, permissions: PermissionReplies) {
  /** 助手消息 → content 块的语义键(按出现顺序 = content 下标),流式 part 的 id 由它定。 */
  const blocks = new Map<string, string[]>()
  /** 已发出的 v1 对象(按 id)的 JSON,用于只发变化。 */
  const emitted = new Map<string, string>()
  const sessions = new Map<string, Session>()
  /** 用户消息 → 它那个回合的改动(REQ-142),快照发 message.updated 时挂回去。 */
  const turnDiffs = new Map<string, readonly unknown[]>()
  /** F3:会话 → 当前回合已报给文件面板的改动(文件 → 状态 + 补丁),只报变化。 */
  const reported = new Map<string, { anchor: string; files: Map<string, string> }>()
  /**
   * F1:运行中工具的进度(subagent 的子会话 id)2.x 只放在 `session.tool.progress` 事件里,存下的 running 状态 metadata 为空
   * (真引擎采样 fixtures/tools.json);0.1.26 的任务卡在运行中就能「打开子会话」。见过的进度按工具调用 id 记下,投影前并回
   * 那个调用的 running 状态;调用结束即丢。
   */
  const progress = new Map<string, Record<string, unknown>>()
  const withProgress = (source: readonly SessionMessageInfo[]): readonly SessionMessageInfo[] =>
    progress.size === 0
      ? source
      : source.map((message) =>
          message.type !== "assistant"
            ? message
            : ({
                ...message,
                content: message.content.map((item) =>
                  item.type === "tool" && item.state.status === "running" && progress.has(item.id)
                    ? { ...item, state: { ...item.state, metadata: { ...progress.get(item.id), ...item.state.metadata } } }
                    : item,
                ),
              } as SessionMessageInfo),
        )

  const remember = (key: string, value: unknown) => {
    const encoded = JSON.stringify(value)
    if (emitted.get(key) === encoded) return false
    emitted.set(key, encoded)
    if (emitted.size > 5_000) emitted.delete(emitted.keys().next().value!)
    return true
  }

  async function snapshot(directory: string, sessionID: string, refreshTurnDiff = false) {
    const page = await recentMessages(api, sessionID, { limit: SNAPSHOT_WINDOW })
    for (const message of page.context) {
      if (message.type === "assistant") blocks.set(message.id, contentKeys(message.content))
    }
    const listed = toV1Messages(sessionID, withProgress(page.context))
    const anchor = turnAnchor(listed, page.context)
    if (refreshTurnDiff && anchor) {
      // 取不到这一步的回合改动不该让消息也停更:记下(不静默),消息照发,下一个边界再取。
      const diff = await api.session.diff({ sessionID, from: anchor.from }).catch((error) => {
        console.error("[engine-adapter] turn diff failed", sessionID, anchor.from, error)
        return undefined
      })
      if (diff) {
        turnDiffs.set(anchor.attach, diff)
        fileChanges(directory, sessionID, anchor.from, diff)
      }
    }
    for (const { info, parts } of withTurnDiffs(listed, turnDiffs)) {
      if (remember(`message:${info.id}`, info)) emit(directory, { type: "message.updated", properties: { info } })
      for (const part of parts) {
        if (remember(`part:${part.id}`, part)) emit(directory, { type: "message.part.updated", properties: { part } })
        todo(directory, sessionID, part)
      }
    }
  }

  /**
   * F3:右栏文件面板只认 v1 的 `file.watcher.updated`(session-rail-files.tsx)刷新已加载目录。2.x 的
   * `filesystem.changed` 只给两种来源 —— 显式 `fs.watch` 的单个文件与 VCS 的 HEAD(core/src/filesystem/file-watch.ts、
   * location-watcher.ts),项目里新建 / 删除文件没有任何事件(真引擎实测 fixtures/files.json)。所以助手改了哪些文件,
   * 从适配器本来就在回合边界取的逐回合改动里出:added → add、deleted → unlink、modified → change;同一回合里先报过、
   * 后来又不在改动里的(建了又删)报 unlink —— 面板据此重列父目录,存在与否以重列为准。
   */
  function fileChanges(directory: string, sessionID: string, anchor: string, diff: readonly unknown[]) {
    const previous = reported.get(sessionID)
    const before = previous?.anchor === anchor ? previous.files : new Map<string, string>()
    const after = new Map<string, string>()
    for (const entry of diff as Array<{ file?: unknown; status?: unknown; patch?: unknown }>) {
      if (typeof entry.file !== "string" || typeof entry.status !== "string" || !(entry.status in WATCH_EVENTS)) continue
      after.set(entry.file, `${entry.status}\n${String(entry.patch ?? "")}`)
      if (before.get(entry.file) !== after.get(entry.file))
        emit(directory, { type: "file.watcher.updated", properties: { file: entry.file, event: WATCH_EVENTS[entry.status] } })
    }
    for (const file of before.keys())
      if (!after.has(file)) emit(directory, { type: "file.watcher.updated", properties: { file, event: "unlink" } })
    reported.set(sessionID, { anchor, files: after })
  }

  /**
   * 运行中 shell 的输出:0.1.26 的 bash 卡在运行中读 `metadata.output`(引擎边跑边写,超长只留尾部 3 万字)。2.x 的 shell 工具
   * 只在进度帧里给 `shellID`,输出按字节游标从 `GET /api/shell/:id/output` 读(没有推送事件;真引擎采样 fixtures/parity.json)。
   * 所以工具在跑期间按游标轮询,把读到的输出照 0.1.26 的截法并进进度(快照合并它),并直接重发那个工具 part;工具结束即停。
   */
  async function streamShell(directory: string, sessionID: string, messageID: string, callID: string, shellID: string) {
    let cursor = 0
    let output = ""
    const id = await streamPartID(sessionID, messageID, `tool:${callID}`)
    while (progress.has(callID)) {
      const page = await api.shell.output({ id: shellID, cursor, location: { directory } }).catch((error) => {
        if (progress.has(callID)) console.error("[engine-adapter] shell output read failed", shellID, error)
        return undefined
      })
      if (!page || !progress.has(callID)) return
      cursor = page.data.cursor
      if (page.data.output) {
        output = shellPreview(output + page.data.output)
        progress.set(callID, { ...progress.get(callID), output })
        const last = emitted.get(`part:${id}`)
        // 这个 id 只给过工具 part(streamPartID 的 `tool:` 键),发出时序列化过,读回仍是那个 v1 part
        const part = last ? (JSON.parse(last) as Part) : undefined
        if (part?.type === "tool" && part.state.status === "running") {
          part.state.metadata = { ...part.state.metadata, output }
          if (remember(`part:${id}`, part)) emit(directory, { type: "message.part.updated", properties: { part } })
        }
      }
      await new Promise((resolve) => setTimeout(resolve, SHELL_POLL_MS))
    }
  }

  /** U1:todowrite 的输入就是清单,投影成 v1 todo.updated。 */
  function todo(directory: string, sessionID: string, part: Part) {
    const todos = todosOf(part)
    if (todos && remember(`todo:${sessionID}`, todos)) emit(directory, { type: "todo.updated", properties: { sessionID, todos } })
  }

  async function sessionInfo(directory: string, sessionID: string, type: "session.created" | "session.updated") {
    const info = toContractSession((await api.session.get({ sessionID })))
    sessions.set(sessionID, info)
    emit(directory, { type, properties: { info } })
  }

  /** 流式块的 v1 part id:块的语义键在该消息里第几个出现。没见过这条消息(中途接上)就先按存储初始化。 */
  async function streamPartID(sessionID: string, messageID: string, key: string) {
    let keys = blocks.get(messageID)
    if (!keys) {
      const page = await recentMessages(api, sessionID, { through: messageID })
      const message = page.context.find((item) => item.id === messageID)
      keys = message?.type === "assistant" ? contentKeys(message.content) : []
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
      // 2.x 的事件载荷;按类型取用时各分支自己收窄(带类型的几支直接读 `event.data`)
      data: any
    }
    const data = frame.data ?? {}
    const sessionID: string | undefined = typeof data.sessionID === "string" ? data.sessionID : undefined
    if (sessionID && frame.location?.directory) rememberSessionDirectory(sessionID, frame.location.directory)
    const directory =
      frame.location?.directory ?? (sessionID ? await sessionDirectory(api, sessionID).catch(() => "global") : "global")
    const type = frame.type

    if (isPassThrough(type)) return emit(directory, { type, properties: data })
    if (type === "location.shutdown") return emit(directory, { type: "server.instance.disposed", properties: { directory } })
    if (type === "agent.updated" || type === "command.updated" || type === "skill.updated")
      return emit(directory, { type: "catalog.updated", properties: {} })
    if (event.type === "project.updated") return emit(directory, { type: event.type, properties: toV1Project(event.data) })
    if (event.type === "permission.asked") return emit(directory, { type: event.type, properties: permissions.show(event.data) })
    if (type === "permission.replied") return emit(directory, { type, properties: data })
    if (type === "form.created") {
      const question = toV1Question(data.form)
      return question ? emit(directory, { type: "question.asked", properties: question }) : undefined
    }
    if (event.type === "form.replied") {
      const answer = event.data.answer as Record<string, string | string[]>
      const answers = Object.keys(answer)
        .filter((key) => /^q\d+$/.test(key))
        .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
        .map((key) => (Array.isArray(answer[key]) ? answer[key] : [String(answer[key])]))
      return emit(directory, { type: "question.replied", properties: { sessionID: event.data.sessionID, requestID: event.data.id, answers } })
    }
    if (event.type === "form.cancelled")
      return emit(directory, { type: "question.rejected", properties: { sessionID: event.data.sessionID, requestID: event.data.id } })
    // F3:不带 sessionID,按帧的位置投到那个目录的频道(载荷两代同形:file + add/change/unlink)。
    if (type === "filesystem.changed")
      return emit(directory, { type: "file.watcher.updated", properties: { file: data.file, event: data.event } })
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
    if (type === "session.tool.progress") {
      progress.set(data.id, data.metadata ?? {})
      if (typeof data.metadata?.shellID === "string")
        void streamShell(directory, sessionID, data.assistantMessageID, data.id, data.metadata.shellID)
    }
    if (type === "session.tool.success" || type === "session.tool.failed") progress.delete(data.id)
    if (SNAPSHOT_EVENTS.has(type) || TURN_DIFF_EVENTS.has(type)) await snapshot(directory, sessionID, TURN_DIFF_EVENTS.has(type))
    if (SESSION_INFO_EVENTS.has(type)) await sessionInfo(directory, sessionID, "session.updated")

    if (type === "session.execution.started") return emit(directory, { type: "session.status", properties: { sessionID, status: { type: "busy" } } })
    if (type === "session.retry.scheduled")
      return emit(directory, {
        type: "session.status",
        properties: {
          sessionID,
          status: { type: "retry", attempt: data.attempt, message: v1ErrorData(data.error?.message ?? "").message, next: data.at },
        },
      })
    if (type === "session.execution.failed")
      emit(directory, {
        type: "session.error",
        properties: { sessionID, error: { name: "UnknownError", data: v1ErrorData(data.error?.message ?? "") } },
      })
    if (TURN_END_EVENTS.has(type)) {
      emit(directory, { type: "session.status", properties: { sessionID, status: { type: "idle" } } })
      emit(directory, { type: "session.idle", properties: { sessionID } })
    }
  }
}

/** `GET /global/event` 的 handler:一个 SSE Response,订阅方中止即退订 2.x。 */
export function projectEventStream(context: SharedContext): Response {
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
      const project = createProjector(context.api, emit, context.permissions)
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

