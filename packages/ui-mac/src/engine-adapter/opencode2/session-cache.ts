// `#1668`:读 2.x 会话消息时的上下文窗口。
//
// 冻结 app 的投影(normalizeSessionMessages)按时间顺序走一遍消息:助手消息挂在它前面那条用户消息下面
// (`parentID`),前面没有用户消息的助手消息被丢掉。2.x 的消息接口分页(每页 ≤ 200),一页的最早一条若是
// 助手消息,它的用户消息在更早的页里 —— 所以取一页时往前多拉,直到窗口里有一条能当父消息的为止,投影后
// 只交回这一页的消息。
import type { OpenCodeClient, SessionMessageInfo } from "@opencode/client/promise"

/** 2.x 消息接口一页的条数上限。 */
export const MESSAGE_PAGE = 200
/** 能当回合起点的消息(冻结投影里会设 parentID 的那几种)。 */
const startsTurn = (message: SessionMessageInfo) =>
  message.type === "user" ||
  message.type === "shell" ||
  (message.type === "synthetic" && !!(message as { description?: string }).description?.trim())

export async function recentMessages(
  api: OpenCodeClient,
  sessionID: string,
  options: { limit?: number; cursor?: string; through?: string },
) {
  // 不限条数(侧栏的整会话读取):升序拉全。
  if (options.limit === undefined && options.cursor === undefined && options.through === undefined) {
    const all: SessionMessageInfo[] = []
    let cursor: string | undefined
    for (;;) {
      const page = await api.message.list({ sessionID, limit: MESSAGE_PAGE, ...(cursor ? { cursor } : { order: "asc" }) })
      all.push(...page.data)
      if (page.data.length < MESSAGE_PAGE || !page.cursor.next) break
      cursor = page.cursor.next
    }
    return { context: all, ids: new Set(all.map((message) => message.id)), next: undefined }
  }
  const limit = options.limit ?? MESSAGE_PAGE
  const first = await api.message.list({
    sessionID,
    limit,
    ...(options.cursor ? { cursor: options.cursor } : { order: "desc" }),
  })
  const page = [...first.data]
  const ids = new Set(page.map((message) => message.id))
  const next = first.data.length >= limit && first.cursor.next ? first.cursor.next : undefined
  // `through`:单条消息的读取 —— 往前翻到这条为止(它通常就在最近一页里)。
  const older: SessionMessageInfo[] = []
  let cursor = first.cursor.next ?? undefined
  const needsContext = () => {
    const window = [...older, ...page].toReversed()
    if (options.through && !window.some((message) => message.id === options.through)) return true
    const oldest = page.at(-1)
    return !!oldest && !startsTurn(oldest) && ![...older].some(startsTurn)
  }
  while (cursor && first.data.length >= limit && needsContext()) {
    const more = await api.message.list({ sessionID, limit: MESSAGE_PAGE, cursor })
    older.push(...more.data)
    if (options.through) for (const message of more.data) ids.add(message.id)
    if (more.data.length < MESSAGE_PAGE || !more.cursor.next) break
    cursor = more.cursor.next
  }
  return { context: [...page, ...older].toReversed(), ids, next }
}

const directories = new Map<string, string>()

/** 会话 → 目录(2.x 的部分事件与请求不带目录)。见过的记住,没见过的查一次。 */
export async function sessionDirectory(api: OpenCodeClient, sessionID: string) {
  const known = directories.get(sessionID)
  if (known) return known
  const session = await api.session.get({ sessionID })
  directories.set(sessionID, session.location.directory)
  return session.location.directory
}

export function rememberSessionDirectory(sessionID: string, directory: string) {
  directories.set(sessionID, directory)
}
