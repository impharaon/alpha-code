// `#1668` I7a → `#1697`(I-04 M3,设计 §4.8):回执账本(contract/receipts.ts)在 OpenCode 2 上的审批端口。账本只问两件事:
// 按界面所见的形状重读一条待审请求,把决定交给引擎并交回这次了结了哪些请求。L4 实测了引擎的三条前提并给出推导规格
// (docs/architecture/2026-11-09-1662-permission-reply-measurements.md §Receipt derivation spec),这里照规格做:
//
//   · 重读 = `GET /api/session/:sessionID/permission/:requestID`,投影成 v1(与 GET /permission、permission.asked 同一个投影);
//     不在了(PermissionNotFoundError)⇒ undefined。
//   · 了结集合取自 `permission.replied`:发出前先订阅 `/api/event`(等到 `server.connected` 才算订上),回复之后
//     收齐 —— 目标自己那条,加上这次回复在同一会话里连带了结的每一条(reject 连带同会话全部待审;always 连带同会话里
//     新放行覆盖的待审;引擎先发目标、再逐条发连带,前提 ii)。SSE 与回复的 HTTP 响应走两条连接,谁先到不保证:
//     回复前记下同会话的待审,回复返回后再读一次;「回复前在、回复后不在」的每一条等到它的 replied(或 SETTLE_MS
//     到点)再交回,到点仍未确认的不进集合 —— 不赌「响应到时事件已经到了」,也不猜。回复时请求已不在(404)⇒ 交回 []。
//   · 「本次会话内允许」(v1 `always`)原样发 2.x 的 `always`:Code Puppy 接管的权限内核把它做成 0.1.26 的会话内放行
//     (I-05 契约 A,design upgrade-fewer-takeovers §4)。这里不判定、不改会话规则。
import type { OpenCodeClient } from "@opencode/client/promise"
import { SETTLE_MS, type ApprovalEngine } from "../contract/receipts"
import { toV1PermissionRequest } from "./v1-shapes"

const isNotFound = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { _tag?: unknown })._tag === "PermissionNotFoundError"

type Replied = { requestID: string; sessionID: string; reply: string; afterSend: boolean }

/**
 * 规格第 3 条的事件窗口:订上(`server.connected` 到了)才返回;关掉即退订。客户端的事件流是同一引擎源共享的一条
 * 连接(SharedEvents):已经连着时,缓存的 `server.connected` 立刻交给新订阅者,而它此刻已挂在活连接上。
 */
async function openRepliedWindow(api: OpenCodeClient) {
  const controller = new AbortController()
  const iterator = api.event
    .subscribe({ types: ["permission.replied"], signal: controller.signal })
    [Symbol.asyncIterator]()
  const first = await iterator.next().catch((error) => {
    controller.abort()
    throw error
  })
  if (first.done || first.value.type !== "server.connected") {
    controller.abort()
    throw new Error("engine event stream did not confirm the subscription")
  }
  const seen: Replied[] = []
  let sent = false
  let wake: (() => void) | undefined
  void (async () => {
    try {
      for (;;) {
        const next = await iterator.next()
        if (next.done) return
        if (next.value.type !== "permission.replied") continue
        const data = next.value.data as { requestID: string; sessionID: string; reply: string }
        seen.push({ requestID: data.requestID, sessionID: data.sessionID, reply: data.reply, afterSend: sent })
        wake?.()
      }
    } catch {
      // 关窗(abort)或引擎断流:已收到的照用,等待由 settle 的上限兜底。
    }
  })()

  return {
    markSent: () => {
      sent = true
    },
    /** 等到目标与 `expected` 里的每一条都有了 replied(或到点),交回了结集合。 */
    async settle(input: { target: string; sessionID: string; decision: string; expected: readonly string[] }) {
      const done = () => {
        const settled = new Set(seen.map((item) => item.requestID))
        return seen.some((item) => item.afterSend && item.requestID === input.target) && input.expected.every((id) => settled.has(id))
      }
      const deadline = Date.now() + SETTLE_MS
      while (!done() && Date.now() < deadline) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, deadline - Date.now())
          wake = () => {
            clearTimeout(timer)
            resolve()
          }
        })
      }
      wake = undefined
      // 连带 = 发出后到达、同一会话、reply 等于本次决定的 replied(`once` 不连带)。窗口里别处的回复不算这次的。
      const cascade = seen.filter(
        (item) => item.afterSend && item.reply === input.decision && item.sessionID === input.sessionID && item.requestID !== input.target,
      )
      return [input.target, ...new Set(cascade.map((item) => item.requestID))]
    },
    close: () => controller.abort(),
  }
}

/** `Translator.approvals`:这次请求的引擎连接上的审批端口。 */
export const approvals = (engine: { api: OpenCodeClient }): ApprovalEngine => createApprovalEngine(engine.api)

function createApprovalEngine(api: OpenCodeClient): ApprovalEngine {
  return {
    async current({ sessionID, requestID }) {
      const request = await api.permission.get({ sessionID, requestID }).catch((error) => {
        if (isNotFound(error)) return undefined
        throw error
      })
      return request && toV1PermissionRequest(request)
    },
    async decide({ sessionID, requestID, decision, message }) {
      const window = await openRepliedWindow(api)
      try {
        // 同会话的其余待审:回复之后「前在后不在」的才是这次连带了结的(`once` 不连带)。
        const before =
          decision === "once" ? [] : (await api.permission.list({ sessionID })).map((item) => item.id).filter((id) => id !== requestID)
        window.markSent()
        const sent = await api.permission.reply({ sessionID, requestID, decision, ...(message ? { message } : {}) }).then(
          () => true,
          (error) => {
            if (isNotFound(error)) return false
            throw error
          },
        )
        if (!sent) return []
        // 回复已落定:重读失败不让这次决定作废,改为等「回复前在」的每一条(仍以 SETTLE_MS 为限,到点未确认的不进集合)。
        const after = before.length
          ? await api.permission.list({ sessionID }).then(
              (items) => new Set(items.map((item) => item.id)),
              (error) => {
                console.error("[engine-adapter] could not re-read pending permissions after a reply", sessionID, error)
                return new Set<string>()
              },
            )
          : new Set<string>()
        return await window.settle({ target: requestID, sessionID, decision, expected: before.filter((id) => !after.has(id)) })
      } finally {
        window.close()
      }
    },
  }
}
