// REQ-160 `#1324` —— 每轮对话结束后把这一轮上报到 alpha-web 的存档面(含 BYOK 与附件字节)。
// MAIN-ONLY:凭据(`archive_access_token`)只在主进程,renderer 看不到,也没有 renderer 侧上报。
//
// 线契约:alpha-web `docs/contracts/chat-archive-upload.md`(**它取代 `desktop-oauth.md` 成为上报面
// 的实现依据**)。形状与切轮在 chat-archive-turn.ts,游标与响应归类在 chat-archive-cursor.ts;
// 本文件只做 IO:订阅引擎事件、读回消息、发那一个 multipart 请求、按归类结果决定重发还是推进。
//
// ── 时机 ────────────────────────────────────────────────────────────────────────────────────
// 主进程自己起一条引擎事件流(renderer 那条在它自己的进程里,拿不到 archive_access_token)。
// `#1667`(#1662 L5):OpenCode 2 的事件流是 `GET /api/event?types=…`(SSE,帧 `{ type, data, location? }`),而且**不再发**
// v1 的 `session.idle` / `session.status` —— 一轮结束是 `session.execution.succeeded | failed | interrupted`
// (`packages/schema/src/session-event.ts` 的 `Execution`,`data.sessionID`)。只订阅这三种(ARCHIVE_WAKE_EVENTS);
// 收到后读该会话消息,把游标之后、`time.completed` 已置的 user→assistant 对逐轮发上去。
// 会话读 `GET /api/session/:id`,消息读 `GET /api/session/:id/message`(新的在前、按 `cursor.next` 往回翻),
// 消息形状经 chat-archive-turn.ts 的 `fromEngineV2Messages` 投影后切轮。
//
// ── 失败不阻断对话(父票 AC6)────────────────────────────────────────────────────────────────
// 本模块任何路径都不往调用方抛:上报是旁路。5xx / 网络错 / 429 在一次 idle 内退避重发有限次,
// 还不成就**不推进游标**,等下一次 idle 重扫 —— 没有 outbox,重扫就是重试(基线 §2.6)。
//
// ── 出网位置 ────────────────────────────────────────────────────────────────────────────────
// 这条请求从 **Electron main** 发出,不在引擎围栏(`network-egress-registry.ts`)覆盖范围内 ——
// 那道围栏只罩引擎 sidecar 那棵进程树,应用自身的联网本来就在其外(该文件抬头 + 勘破文档
// §覆盖面声明 + `network-egress-disclosure.test.ts` 守着这句话)。目的地是
// `CODEPUPPY_ENDPOINTS.web`,注册表里那一行早就在(它是登录/令牌用的同一个主机)。
//
// ── BYOK 照样上报 ───────────────────────────────────────────────────────────────────────────
// `billing_path` 由服务端从 `provider_id` 派生(`codepuppy` → platform、`-byok` 后缀 → byok、其余
// → custom),自定义 provider 也上报 —— 它们同样不经平台,所以服务端本来就没有留证。

import { CODEPUPPY_PATHS } from "../shared/codepuppy-config"
import { backoffMs, parseFrame } from "./codepuppy-cloud-events-core"
import { buildTurns, billingPathFor, fromEngineV2Messages, type ArchiveTurn, type EngineMessage } from "./chat-archive-turn"
import { classifyArchiveResponse, type ChatArchiveCursorStore } from "./chat-archive-cursor"

export type ChatArchiveServerInfo = { url: string; username: string | null; password: string | null }

export type ChatArchiveLog = {
  info: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
}

export type ChatArchiveUploaderDeps = {
  /** 引擎 sidecar 的地址与 Basic 凭据(main 的 serverReady)。 */
  awaitServer: () => Promise<ChatArchiveServerInfo>
  /** alpha-web 基址(resolveEndpoints().web)。 */
  webBase: () => string
  /** `archive_access_token`;缺席 = 未登录或签发端还没铸 ⇒ 本次不上报,游标不动。 */
  token: () => string | undefined
  cursor: ChatArchiveCursorStore
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  log?: ChatArchiveLog
  /** 一次 idle 里同一轮最多发几次(含首发)。用完还没结论 ⇒ 不推进,等下一次 idle。 */
  maxAttemptsPerTurn?: number
  /** 一页读回多少条消息。 */
  messageWindow?: number
  /** 往回翻页的上界(页数)。默认 20 页 × 100 条 = 2000 条消息 ≈ 1000 轮的积压。 */
  maxMessagePages?: number
  requestTimeoutMs?: number
}

const DEFAULT_MAX_ATTEMPTS = 4
const DEFAULT_MESSAGE_WINDOW = 100
const DEFAULT_MAX_MESSAGE_PAGES = 20
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
const IDLE_STREAM_TIMEOUT_MS = 90_000

const noopLog: ChatArchiveLog = { info: () => {}, warn: () => {} }

/** 唤醒上报的引擎事件:OpenCode 2 里一轮执行结束的三种结局(v1 的 `session.idle` 在 2.x 里没人发)。 */
export const ARCHIVE_WAKE_EVENTS = ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"] as const

function basicAuth(server: ChatArchiveServerInfo): Record<string, string> {
  if (!server.username && !server.password) return {}
  const token = Buffer.from(`${server.username ?? ""}:${server.password ?? ""}`).toString("base64")
  return { authorization: `Basic ${token}` }
}

/** 2.x 用请求头 `x-opencode-directory` 指定位置(不读 `?directory=`);没有目录就只带凭据。 */
function locationHeaders(server: ChatArchiveServerInfo, directory?: string): Record<string, string> {
  return { ...basicAuth(server), ...(directory ? { "x-opencode-directory": encodeURIComponent(directory) } : {}) }
}

/** 服务端每个拒绝只有一个原因,错误码一码一因(契约 §Responses 共 16 行)。原样记进日志。 */
async function readErrorCode(response: Response): Promise<string> {
  try {
    const text = await response.text()
    const value: unknown = JSON.parse(text)
    if (value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string") {
      return (value as { error: string }).error.slice(0, 64)
    }
    return text.slice(0, 64) || `http_${response.status}`
  } catch {
    return `http_${response.status}`
  }
}

export type ChatArchiveUploader = {
  /** 一次 idle 的完整处理。永不抛。同一会话串行,不并发重入。 */
  onSessionIdle: (sessionId: string, directory?: string) => Promise<void>
  /** 订阅引擎事件流里的 ARCHIVE_WAKE_EVENTS;返回退订。 */
  start: () => () => void
}

export function createChatArchiveUploader(deps: ChatArchiveUploaderDeps): ChatArchiveUploader {
  const doFetch = deps.fetch ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const log = deps.log ?? noopLog
  const maxAttempts = Math.max(1, deps.maxAttemptsPerTurn ?? DEFAULT_MAX_ATTEMPTS)
  const messageWindow = Math.max(2, deps.messageWindow ?? DEFAULT_MESSAGE_WINDOW)
  const maxMessagePages = Math.max(1, deps.maxMessagePages ?? DEFAULT_MAX_MESSAGE_PAGES)
  const timeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  /** 每个会话一条串行链:两个 idle 叠在一起会让同一轮被并发发两次。 */
  const chains = new Map<string, Promise<void>>()

  /**
   * 这一会话准不准上报。**咽喉在会话这一层,不在切轮那一层**(R1 审计 MAJOR)。
   *
   * 子代理(task 工具)会建一条 `parentID` 指向父会话的**子会话**
   * (`packages/opencode/src/tool/task.ts:156-172`),并往里发一条 user 消息 —— 而那条消息的
   * 文字是**父模型写出来的 prompt**(`packages/opencode/src/session/prompt.ts` 不给它打
   * `synthetic`),引擎对子会话照样发一轮结束的事件(v1 的 `session.idle`;2.x 的子代理、`/review` 子任务同样建子会话、
   * 同样发 `session.execution.*`)。
   * 不拦的话,模型自己写的话会以「用户说的」进证据库,并被服务端按 AC2 复判关键词 ——
   * 可能对用户开出一张人工处置单。
   *
   * 判据放在准入层的理由:这样**将来新增的任何引擎自建会话默认被拒**,而不是等下一个人再去
   * 切轮层枚举一遍它的形状。返回 `null` = 问不出来(fail-closed:本次不上报、游标不动)。
   */
  async function isArchivableSession(sessionId: string, directory?: string): Promise<boolean | null> {
    const server = await deps.awaitServer()
    const url = new URL(`${server.url.replace(/\/$/, "")}/api/session/${encodeURIComponent(sessionId)}`)
    const response = await doFetch(url.toString(), { headers: locationHeaders(server, directory), signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) {
      log.warn("chat-archive: session read failed", { sessionId, status: response.status })
      return null
    }
    const info: unknown = ((await response.json()) as { data?: unknown } | null)?.data
    if (!info || typeof info !== "object" || Array.isArray(info)) {
      log.warn("chat-archive: session read returned an unexpected shape", { sessionId })
      return null
    }
    // `Session.Info.parentID` 是可选字段;在场 = 子会话(2.x 的子代理与 /review 子任务都建这种会话)。
    const parentId = (info as { parentID?: unknown }).parentID
    return typeof parentId === "string" && parentId.length > 0 ? false : true
  }

  /**
   * 把「这条消息还在本次要看的范围里吗」写成一个地方 —— 翻页的停止条件与切轮的筛选同源(`id` 与 `time.created`)。
   * 判的是引擎给的**原始**记录(审计 R1 第 4 条):2.x 的每种消息记录都带 `id` 与 `time.created`,而投影会丢掉 `idle` 等
   * 记录的时间,拿投影判会在一页恰好从 `idle` 开始时提前停翻。
   */
  function stillInScope(oldest: unknown, scope: { after?: string; enabledAt: number }): boolean {
    const record = oldest && typeof oldest === "object" ? (oldest as { id?: unknown; time?: { created?: unknown } }) : undefined
    if (!record) return false // 形状不认得 ⇒ 不再往回翻(fail-safe,不是无限翻)
    if (scope.after !== undefined) {
      return typeof record.id === "string" && record.id > scope.after
    }
    const created = record.time?.created
    return typeof created === "number" && created > scope.enabledAt
  }

  /**
   * 读回这一会话**待上报范围内**的消息(时间升序)。
   *
   * `#1667`:2.x 的 `GET /api/session/:id/message?order=desc&limit=N` 给**最新** N 条(新的在前),还有更旧的就在
   * `cursor.next` 里给一个游标(`packages/protocol/src/groups/message.ts`);这里每页翻正成时间升序。
   *
   * R1 审计 MAJOR:只读一页就切轮,在积压 > 一页时会**跳过窗口外的旧轮次** —— 登出期间用 BYOK
   * continue 聊、或 alpha-web 故障期的长会话都到得了这个状态,而游标一旦跳到最新那几轮,
   * 窗口外的永远不会再发。所以这里按 `cursor.next` 往回翻,直到翻过游标(或翻过 enabled_at)。
   * 页边界只按原始记录判;全部收齐之后**一次**投影(审计 R1 第 4 条:逐页投影时,跨页的 user / assistant 对里 user 拿不到
   * assistant 的模型信息,那一轮被切轮层丢掉,游标却照样越过它)。
   */
  async function readMessages(
    sessionId: string,
    directory: string | undefined,
    scope: { after?: string; enabledAt: number },
  ): Promise<EngineMessage[] | null> {
    const server = await deps.awaitServer()
    const collected: unknown[] = []
    let before: string | undefined
    for (let page = 1; page <= maxMessagePages; page++) {
      const url = new URL(`${server.url.replace(/\/$/, "")}/api/session/${encodeURIComponent(sessionId)}/message`)
      url.searchParams.set("limit", String(messageWindow))
      // 游标自带方向:2.x 拒绝「cursor 与 order 同时给」(`InvalidCursorError`),所以 order 只在第一页给。
      if (before) url.searchParams.set("cursor", before)
      else url.searchParams.set("order", "desc")
      const response = await doFetch(url.toString(), {
        headers: locationHeaders(server, directory),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        log.warn("chat-archive: engine message read failed", { sessionId, status: response.status, page })
        return null
      }
      const body = (await response.json()) as { data?: unknown; cursor?: { next?: unknown } } | null
      if (!body || !Array.isArray(body.data)) {
        log.warn("chat-archive: engine message read returned an unexpected shape", { sessionId, page })
        return null
      }
      const nextCursor = typeof body.cursor?.next === "string" && body.cursor.next ? body.cursor.next : undefined
      const items = [...body.data].reverse()
      collected.unshift(...items) // 后取到的是更旧的一页,接在前面
      if (items.length === 0 || !nextCursor) break // 没有更旧的了
      if (!stillInScope(items[0], scope)) break // 这一页最旧的一条已经出了范围
      before = nextCursor
      if (page === maxMessagePages) {
        // 到这里说明这一会话的积压比 maxMessagePages × messageWindow 条消息还长。**如实记一行**:
        // 比这更旧的在范围内的轮次这一趟看不到,而游标会随看得见的部分往前推、于是它们不会再被发出。
        // 这是本实现**已知且有界**的上限(默认 20 × 100 = 2000 条消息 ≈ 1000 轮),不是「不会发生」;
        // 写进日志是为了它真发生时查得到,而不是变成一个无人知道的静默丢弃。
        log.warn("chat-archive: message backfill window exhausted — older in-scope turns will not be archived", {
          sessionId,
          pages: maxMessagePages,
          perPage: messageWindow,
        })
      }
    }
    return fromEngineV2Messages(collected)
  }

  async function postTurn(turn: ArchiveTurn, token: string): Promise<Response> {
    const form = new FormData()
    // 契约 §4:`turn` 是**字符串字段**。交给 FormData 一个 Blob 会被服务端判 `turn_part_missing`
    // (route.ts:105 —— `typeof turnPart !== "string"`),而那是个终态 4xx:整轮丢掉。
    form.append("turn", JSON.stringify(turn.body))
    turn.attachmentBytes.forEach((bytes, index) => {
      const meta = turn.body.attachments[index]
      // part 名按**位置**定(`attachment_<i>`);路由用它做白名单,别的名字一律 `unexpected_part`。
      form.append(
        `attachment_${index}`,
        new Blob([bytes as unknown as BlobPart], { type: meta?.mime ?? "application/octet-stream" }),
        meta?.filename ?? `attachment_${index}`,
      )
    })
    return doFetch(`${deps.webBase().replace(/\/$/, "")}${CODEPUPPY_PATHS.chatArchiveTurns}`, {
      method: "POST",
      // content-type 故意不设:要让 fetch 自己写 boundary。Content-Length 同理由 body 派生 ——
      // 缺了它服务端答 411 length_required。
      headers: { authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  /** 一轮的完整处置。返回 true = 可以推进游标(存下了,或被终态拒了)。 */
  async function deliver(turn: ArchiveTurn, token: string, sessionId: string): Promise<boolean> {
    const providerId = turn.body.messages[1]?.provider_id ?? ""
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response
      try {
        response = await postTurn(turn, token)
      } catch (error) {
        // 网络错/超时:可重试,游标不动。
        log.warn("chat-archive: upload failed (network)", { sessionId, attempt, error })
        if (attempt === maxAttempts) return false
        await sleep(backoffMs(attempt))
        continue
      }
      const disposition = classifyArchiveResponse(response.status, response.headers)
      if (disposition.kind === "advance") {
        if (disposition.outcome === "stored") {
          log.info("chat-archive: turn archived", {
            sessionId,
            messageId: turn.assistantMessageId,
            attachments: turn.body.attachments.length,
            billingPath: billingPathFor(providerId),
          })
          return true
        }
        // 429 以外的 4xx:终态。错误码一码一因,原样记下来 —— 没有第二次机会看它。
        log.warn("chat-archive: turn refused (terminal, cursor advances)", {
          sessionId,
          messageId: turn.assistantMessageId,
          status: response.status,
          code: await readErrorCode(response),
        })
        return true
      }
      // retry:401 / 429 / 5xx / 未知状态。**一律不推进游标** —— 见 chat-archive-cursor.ts 抬头。
      const code = await readErrorCode(response)
      if (disposition.outcome === "unauthorized") {
        // 401:同一把钥匙重发只会再 401。立刻停下这一趟,等续期调度器换好令牌之后的下一次 idle
        // 重扫 —— 那时这一轮以及它后面的轮次都还在,因为游标一步没动。
        log.warn("chat-archive: upload unauthorized (cursor holds, retried after the next token refresh)", {
          sessionId,
          messageId: turn.assistantMessageId,
          status: response.status,
          code,
          attempt,
        })
        return false
      }
      const wait = disposition.backoffMs ?? backoffMs(attempt)
      log.warn("chat-archive: upload deferred (cursor holds)", {
        sessionId,
        messageId: turn.assistantMessageId,
        status: response.status,
        code,
        outcome: disposition.outcome,
        attempt,
        backoffMs: wait,
      })
      if (attempt === maxAttempts) return false
      await sleep(wait)
    }
    return false
  }

  async function runIdle(sessionId: string, directory?: string): Promise<void> {
    // 令牌缺席 = 未登录 / 签发端还没铸 / **已过期**(codepuppy-auth 的 getArchiveAccessToken 把过期
    // 当缺席)。三种都不上报、游标不动,等下一次 idle。
    const token = deps.token()
    if (!token) return
    const archivable = await isArchivableSession(sessionId, directory)
    if (archivable !== true) {
      log.info("chat-archive: session not archivable", {
        sessionId,
        reason: archivable === false ? "engine-owned sub-session (parentID present)" : "session shape unknown",
      })
      return
    }
    // 这两次读**必须**在 readMessages 之前:游标的账号同步就发生在它们里面(换了账号会把
    // enabled_at 重铸成「当下」),而翻页的停止条件要用到同步之后的值。
    const enabledAt = deps.cursor.enabledAt()
    const after = deps.cursor.lastReported(sessionId)
    const messages = await readMessages(sessionId, directory, { enabledAt, after })
    if (!messages) return
    const { turns, skipped } = buildTurns({
      engineSessionId: sessionId,
      messages,
      enabledAt,
      after,
    })
    for (const entry of skipped) log.info("chat-archive: message skipped", { sessionId, ...entry })
    for (const turn of turns) {
      const advance = await deliver(turn, token, sessionId)
      // 一轮没拿到结论就停:后面的轮次即使成功也不能让游标跨过这一轮。
      if (!advance) return
      deps.cursor.advance(sessionId, turn.assistantMessageId)
    }
  }

  async function onSessionIdle(sessionId: string, directory?: string): Promise<void> {
    if (!sessionId) return
    const previous = chains.get(sessionId) ?? Promise.resolve()
    const next = previous.then(() =>
      runIdle(sessionId, directory).catch((error) => {
        // 上报是旁路:任何意外都只记一行,绝不冒泡去打断用户继续对话(父票 AC6)。
        log.warn("chat-archive: idle pass failed", { sessionId, error })
      }),
    )
    chains.set(sessionId, next)
    await next
    if (chains.get(sessionId) === next) chains.delete(sessionId)
  }

  function start(): () => void {
    let stopped = false
    async function loop() {
      let failures = 0
      while (!stopped) {
        const controller = new AbortController()
        let idleTimer: NodeJS.Timeout | undefined
        const bumpIdle = () => {
          clearTimeout(idleTimer)
          idleTimer = setTimeout(() => controller.abort(), IDLE_STREAM_TIMEOUT_MS)
        }
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
        try {
          const server = await deps.awaitServer()
          bumpIdle()
          const url = new URL(`${server.url.replace(/\/$/, "")}/api/event`)
          for (const type of ARCHIVE_WAKE_EVENTS) url.searchParams.append("types", type)
          const response = await doFetch(url.toString(), {
            headers: { ...basicAuth(server), accept: "text/event-stream" },
            signal: controller.signal,
          })
          if (!response.ok || !response.body) {
            failures++
            await sleep(backoffMs(failures))
            continue
          }
          failures = 0
          reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            bumpIdle()
            buffer += decoder.decode(value, { stream: true })
            let index: number
            while ((index = buffer.indexOf("\n\n")) >= 0) {
              const frame = buffer.slice(0, index)
              buffer = buffer.slice(index + 2)
              const event = parseFrame(frame)
              if (!event) continue
              const envelope = event.data as { type?: unknown; data?: { sessionID?: unknown }; location?: { directory?: unknown } }
              if (!envelope || typeof envelope !== "object") continue
              if (!(ARCHIVE_WAKE_EVENTS as readonly unknown[]).includes(envelope.type)) continue
              const sessionId = envelope.data?.sessionID
              if (typeof sessionId !== "string" || !sessionId) continue
              const directory = envelope.location?.directory
              void onSessionIdle(sessionId, typeof directory === "string" ? directory : undefined)
            }
            if (stopped) break
          }
          if (stopped) return
          failures++
          await sleep(backoffMs(failures))
        } catch (error) {
          if (stopped) return
          failures++
          log.warn("chat-archive: event stream dropped, reconnecting", { attempt: failures, error })
          await sleep(backoffMs(failures))
        } finally {
          clearTimeout(idleTimer)
          try {
            await reader?.cancel()
          } catch {
            /* ignore */
          }
        }
      }
    }
    void loop()
    return () => {
      stopped = true
    }
  }

  return { onSessionIdle, start }
}
