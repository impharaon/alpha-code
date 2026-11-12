// `#1668` I7a:审批的回复与回执。冻结界面按 0.1.26 的回执合同(PermissionV2DecisionReceipt:快照指纹、每次回复一张列明
// 它了结了哪些请求的收据、幂等重放、陈旧回复 409)提交决定;2.x 的回复路由只回 204。L4 实测了引擎的三条前提并给出
// 推导规格(docs/architecture/2026-11-09-1662-permission-reply-measurements.md §Receipt derivation spec,
// lane/1666-l4-takeover `29bb45dfe4`),这里照规格在适配器里合成回执,不改引擎:
//
//   1. 指纹 = 交给界面的那份请求快照 `{sessionID, action, resources, save, metadata, source}` 的 canonical JSON 的 sha256。
//      冻结界面的 v1 通道自己铸 `engine-v1:<id>` 当卡片指纹(permission-v1-adapter.ts),wire 上不带回来 ——
//      所以由适配器在**交出**请求的那一刻(`show`:GET /permission 与 permission.asked 投影,两处都只经这里)记下。
//   2. 回复前重读 `GET /api/session/:sessionID/permission/:requestID`:不在了 ⇒ 404(过期,什么都不发);
//      指纹变了 ⇒ 409(什么都不发)。
//   3. 了结集合取自 `permission.replied`:发出前先订阅 `/api/event`(等到 `server.connected` 才算订上),回复之后
//      收齐 —— 目标自己那条,加上 reject 在同一会话里连带了结的每一条(引擎先发目标、再逐条发连带,前提 ii)。
//      SSE 与回复的 HTTP 响应走两条连接,谁先到不保证:回复前先记下同会话的待审请求,回复后等到它们各自的
//      replied 到齐(或 SETTLE_MS 到点)再出收据,而不是赌「响应到时事件已经到了」。
//   4. 幂等:收据按请求记一辈子(窗口寿命,不落盘 —— 引擎重启后挂起请求全没了,前提 iii)。同一个 decisionID
//      再来一次 ⇒ 原样交回那张收据,不再碰引擎;同一请求换了 decisionID 或决定 ⇒ 409。v1 的两个回复入口不带
//      decisionID,按请求派生 `pdec_v1_<id>`(与冻结 adaptPermissionV1Receipt 的缺省同名)。
//
// 「本次会话内允许」(v1 `always`)不用 2.x 的 `always`(那是项目级持久授权),照 0.1.26 的 v1 `always` 做(编排器
// 2026-11-12 裁决;界面权威是当前正式版):给会话按请求的每个 `save` 模式追加一条 allow 规则 —— 审批卡「将记住」
// 的文案就是逐项写的 `save`(PermissionDialog.tsx rememberedText)—— 再回 `once`;然后把同一会话里新规则已覆盖的
// 其余待审请求逐条回 `once`,它们的 id 进收据的 resolvedRequestIDs(0.1.26 内核 reply() 的同一步)。
import type { OpenCodeClient, PermissionRequest } from "@opencode/client/promise"
import type { PermissionV2Decision, PermissionV2DecisionReceipt } from "@opencode-ai/sdk/v2/client"
import { toV1PermissionRequest } from "./v1-shapes"

/** 回复后等连带 replied 到齐的上限。正常路径在最后一条到达时就结束,不等满。 */
export const SETTLE_MS = 2_000

/** Canonical JSON:键排序、丢 undefined(与 packages/ext/src/policy/store.ts 的 canonicalJson 同一算法;那个模块连着 node:fs,进不了 renderer)。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error("permission request contains a non-JSON value")
  return encoded
}

/** 规格第 1 条:快照指纹(小写十六进制 sha256)。 */
export async function requestFingerprint(request: PermissionRequest) {
  const facts = {
    sessionID: request.sessionID,
    action: request.action,
    resources: request.resources,
    save: request.save,
    metadata: request.metadata,
    source: request.source,
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(facts)))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export type DecisionInput = {
  requestID: string
  /** v1 `/permission/:id/reply` 不带会话;取交出时记下的。 */
  sessionID?: string
  decision: PermissionV2Decision
  message?: string
  decisionID: string
  /** v2 命令自带;v1 入口取交出时记下的。 */
  requestFingerprint?: string
}

export type DecisionOutcome =
  | { type: "receipt"; receipt: PermissionV2DecisionReceipt }
  | { type: "conflict" }
  | { type: "expired" }

export const v1DecisionID = (requestID: string) => `pdec_v1_${requestID}`

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
      // 连带只有 reject(同一会话);`once` 不连带,`always` 从不发给引擎。窗口里别处的 once/reject 不算这次的。
      const cascade =
        input.decision === "reject"
          ? seen.filter(
              (item) =>
                item.afterSend && item.reply === "reject" && item.sessionID === input.sessionID && item.requestID !== input.target,
            )
          : []
      return [input.target, ...new Set(cascade.map((item) => item.requestID))]
    },
    close: () => controller.abort(),
  }
}

type Rule = { action: string; resource: string; effect: "allow" | "deny" | "ask" }

/**
 * 2.x 引擎的 `Wildcard.match`(packages/core/src/util/wildcard.ts)与 `evaluate`(packages/core/src/permission.ts:94-104)。
 * 不能直接引那两个文件:wildcard.ts 读 `process.platform`,renderer 是 sandbox + contextIsolation(main/windows.ts:182-184),
 * 没有 `process`,一调用就 ReferenceError;permission.ts 带着整个 Effect 服务层。这里只去掉 win32 的大小写不敏感分支 ——
 * 引擎只跑在 macOS 本机与 WSL(Linux)上,两者都走大小写敏感那一支。与引擎原件逐条比对的测试在 permission-reply.test.ts。
 */
export function wildcardMatch(input: string, pattern: string) {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
  return new RegExp("^" + escaped + "$", "s").test(normalized)
}

/** 最后一条命中的规则说了算;都不命中 ⇒ ask。 */
export function evaluateRules(rules: readonly Rule[], action: string, resource: string): Rule["effect"] {
  return rules.findLast((rule) => wildcardMatch(action, rule.action) && wildcardMatch(resource, rule.resource))?.effect ?? "ask"
}

/** 「本次会话内允许」:每个 `save` 模式一条 allow 规则追加到会话上(已有规则原样保留);交回写入后的会话规则。 */
async function allowForSession(api: OpenCodeClient, request: PermissionRequest) {
  const session = await api.session.get({ sessionID: request.sessionID })
  const permissions: Rule[] = [
    ...(session.permissions ?? []),
    ...(request.save ?? []).map((resource) => ({ action: request.action, resource, effect: "allow" as const })),
  ]
  await api.session.update({ sessionID: request.sessionID, permissions })
  return permissions
}

/**
 * 同一会话里其余待审请求,凡每个资源都被会话规则判为 allow 的,逐条回 `once`。只看会话这一层就够:引擎的判定顺序是
 * 档位规则 → 会话规则 → 项目保存的规则(只有 allow),取最后命中的一条 —— 会话层判 allow,重问一次引擎也是 allow。
 * 尽力而为:目标已经回复过了,这里某一条失败(别处先答了 ⇒ 404,或断网)只是不进收据,不让整张收据作废。
 */
async function releaseCovered(api: OpenCodeClient, sessionID: string, target: string, rules: readonly Rule[]) {
  const released: string[] = []
  const pending = await api.permission.list({ sessionID }).catch((error) => {
    console.error("[engine-adapter] could not list pending permissions to release", sessionID, error)
    return []
  })
  for (const item of pending) {
    if (item.id === target || !item.resources.every((resource) => evaluateRules(rules, item.action, resource) === "allow")) continue
    const ok = await api.permission.reply({ sessionID, requestID: item.id, decision: "once" }).then(
      () => true,
      (error) => {
        if (!isNotFound(error)) console.error("[engine-adapter] could not release a covered permission", item.id, error)
        return false
      },
    )
    if (ok) released.push(item.id)
  }
  return released
}

function sameDecision(receipt: PermissionV2DecisionReceipt, input: DecisionInput) {
  return (
    receipt.decisionID === input.decisionID &&
    receipt.decision === input.decision &&
    (receipt.message ?? undefined) === (input.message ?? undefined) &&
    (input.requestFingerprint === undefined || input.requestFingerprint === receipt.requestFingerprint)
  )
}

/** 一个引擎源一份:交出过的请求快照、已出的收据。 */
export function createPermissionReplies() {
  const shown = new Map<string, { sessionID: string; fingerprint: Promise<string> }>()
  const receipts = new Map<string, PermissionV2DecisionReceipt>()
  const decisionIDs = new Map<string, string>()
  const inflight = new Map<string, Promise<DecisionOutcome>>()

  async function decideNow(api: OpenCodeClient, input: DecisionInput): Promise<DecisionOutcome> {
    const { requestID } = input
    const previous = receipts.get(requestID)
    if (previous) return sameDecision(previous, input) ? { type: "receipt", receipt: previous } : { type: "conflict" }
    if (decisionIDs.has(input.decisionID)) return { type: "conflict" }

    const snapshot = shown.get(requestID)
    const sessionID = input.sessionID ?? snapshot?.sessionID
    if (snapshot && sessionID !== snapshot.sessionID) return { type: "expired" }
    const expected = input.requestFingerprint ?? (await snapshot?.fingerprint)
    // 这个窗口从没交出过它(也没有命令自带的指纹):决定没绑在任何显示过的快照上。
    if (!sessionID || !expected) {
      console.error(`[engine-adapter] permission reply for a request this window never displayed: ${requestID}`)
      return { type: "conflict" }
    }

    const current = await api.permission.get({ sessionID, requestID }).catch((error) => {
      if (isNotFound(error)) return undefined
      throw error
    })
    if (!current) return { type: "expired" }
    if ((await requestFingerprint(current)) !== expected) return { type: "conflict" }
    // 没有 `save` 就没有可记住的东西:0.1.26 的审批卡此时不给「本次会话内允许」(PermissionDialog canAlways),
    // 0.1.26 的 v2 内核对没有 save 的 always 也回冲突。
    if (input.decision === "always" && !current.save?.length) return { type: "conflict" }

    const engineDecision = input.decision === "always" ? "once" : input.decision
    const window = await openRepliedWindow(api)
    try {
      const sessionRules = input.decision === "always" ? await allowForSession(api, current) : undefined
      const expectedCascade =
        engineDecision === "reject" ? (await api.permission.list({ sessionID })).map((item) => item.id).filter((id) => id !== requestID) : []
      window.markSent()
      const sent = await api.permission
        .reply({ sessionID, requestID, decision: engineDecision, ...(input.message ? { message: input.message } : {}) })
        .then(
          () => true,
          (error) => {
            if (isNotFound(error)) return false
            throw error
          },
        )
      if (!sent) return { type: "expired" }
      const released = sessionRules ? await releaseCovered(api, sessionID, requestID, sessionRules) : []
      const settled = await window.settle({ target: requestID, sessionID, decision: engineDecision, expected: expectedCascade })
      const resolvedRequestIDs = [...settled, ...released]
      const receipt: PermissionV2DecisionReceipt = {
        requestID,
        sessionID,
        requestFingerprint: expected,
        decisionID: input.decisionID,
        decision: input.decision,
        ...(input.message ? { message: input.message } : {}),
        committedAt: Date.now(),
        resolvedRequestIDs,
      }
      receipts.set(requestID, receipt)
      decisionIDs.set(input.decisionID, requestID)
      for (const id of resolvedRequestIDs) shown.delete(id)
      return { type: "receipt", receipt }
    } finally {
      window.close()
    }
  }

  return {
    /** 把一条 2.x 请求交给界面(v1 形状),同时记下界面看到的那份快照的指纹。交出请求只能经这里。 */
    show(request: PermissionRequest) {
      const fingerprint = requestFingerprint(request)
      fingerprint.catch(() => {}) // 只在决定时才 await;wire 来的请求总是 JSON,这里不让它成为未处理的拒绝
      shown.set(request.id, { sessionID: request.sessionID, fingerprint })
      return toV1PermissionRequest(request as never)
    },
    /** 同一请求的决定排队处理:并发的重复提交等前一个落定后按幂等规则判。 */
    decide(api: OpenCodeClient, input: DecisionInput) {
      const before = inflight.get(input.requestID)
      const next = (before ? before.catch(() => undefined) : Promise.resolve()).then(() => decideNow(api, input))
      inflight.set(input.requestID, next)
      void next
        .finally(() => {
          if (inflight.get(input.requestID) === next) inflight.delete(input.requestID)
        })
        .catch(() => {})
      return next
    },
  }
}

export type PermissionReplies = ReturnType<typeof createPermissionReplies>
