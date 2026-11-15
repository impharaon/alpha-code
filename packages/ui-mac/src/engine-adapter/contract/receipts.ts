// `#1668` I7a → `#1697`(I-04 M3,设计 §4.8、UC-11、§6 安全面、R7):审批回执账本 —— ADR-033 的回执合同,代际无关。
// 冻结界面按 0.1.26 的回执合同(PermissionV2DecisionReceipt:快照指纹、每次回复一张列明它了结了哪些请求的收据、幂等重放、
// 陈旧回复 409)提交决定;引擎的回复只回 204。账本在约定侧照这份合同合成回执,引擎那一侧只经 `ApprovalEngine` 的两个调用:
//
//   1. 指纹 = 交给界面的那份 v1 PermissionRequest(GET /permission 与 permission.asked 投影之后的值)的
//      `{sessionID, permission, patterns, always, metadata, tool}` 按 canonicalJson 序列化后的 sha256(小写十六进制)。
//      冻结界面的 v1 通道自己铸 `engine-v1:<id>` 当卡片指纹,wire 上不带回来 —— 所以账本在**交出**请求的那一刻(`show`)记下。
//   2. 回复前经 `current` 重读:引擎已经没有这条请求 ⇒ 过期(404,什么都不发);指纹变了 ⇒ 409(什么都不发);
//      `always` 而请求没有可记住的模式 ⇒ 409(0.1.26 的审批卡此时不给这个按钮,内核也以冲突拒)。
//   3. 了结集合由 `decide` 交回(目标在首,连带的在后;怎么从引擎收齐归翻译器)。交回空集合 = 回复时引擎已经没有这条请求 ⇒ 过期。
//   4. 幂等:收据按请求记一辈子(窗口寿命,不落盘 —— 引擎重启后挂起请求全没了)。同一个 decisionID 再来一次 ⇒ 原样交回那张
//      收据,不再碰引擎;同一请求换了 decisionID 或决定 ⇒ 409。v1 的两个回复入口不带 decisionID,按请求派生 `pdec_v1_<id>`
//      (与冻结 adaptPermissionV1Receipt 的缺省同名)。同一请求的决定排队处理。
// 「本次会话内允许」(v1 `always`)原样交给引擎;放行只限本会话、只在内存,由接管的权限内核做(I-05 契约 A),账本不判定。
import type * as V1 from "@opencode-ai/sdk/v2/client"

/** 回复后等连带的了结信号到齐的上限(随账本,设计 §4.12)。正常路径在最后一条到达时就结束,不等满。 */
export const SETTLE_MS = 2_000

export const v1DecisionID = (requestID: string) => `pdec_v1_${requestID}`

/** 账本用的审批端口:每代引擎一个实现(Translator.approvals)。 */
export interface ApprovalEngine {
  /** 按界面所见的形状重读一条待审请求;引擎已经没有这条请求 → undefined。 */
  current(input: { requestID: string; sessionID: string }): Promise<V1.PermissionRequest | undefined>
  /** 把决定交给引擎;返回这次决定了结的全部请求 id,目标排第一(引擎已经没有这条请求 → [])。`always` 的语义见 UC-11。 */
  decide(input: { requestID: string; sessionID: string; decision: V1.PermissionV2Decision; message?: string }): Promise<string[]>
}

export type DecisionInput = {
  requestID: string
  /** v1 `/permission/:id/reply` 不带会话;取交出时记下的。 */
  sessionID?: string
  decision: V1.PermissionV2Decision
  message?: string
  decisionID: string
  /** v2 命令自带;v1 入口取交出时记下的。 */
  requestFingerprint?: string
}

export type DecisionOutcome =
  | { type: "receipt"; receipt: V1.PermissionV2DecisionReceipt }
  | { type: "conflict" }
  | { type: "expired" }

export interface ReceiptLedger {
  /** 交给界面的每一条请求都经这里(列表与 permission.asked 两处):记下会话与快照指纹,原样返回。 */
  show(request: V1.PermissionRequest): V1.PermissionRequest
  /** 已有收据 → 同决定原样交回(不碰引擎),不同 → conflict;重读不到 → expired;指纹变了 → conflict;否则调 decide 出收据。 */
  decide(engine: ApprovalEngine, input: DecisionInput): Promise<DecisionOutcome>
}

/** Canonical JSON:键按 localeCompare 排序、丢 undefined、数组保序。 */
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

/** 所显示请求的指纹(第 1 条)。 */
export async function requestFingerprint(request: V1.PermissionRequest) {
  const facts = {
    sessionID: request.sessionID,
    permission: request.permission,
    patterns: request.patterns,
    always: request.always,
    metadata: request.metadata,
    tool: request.tool,
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(facts)))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function sameDecision(receipt: V1.PermissionV2DecisionReceipt, input: DecisionInput) {
  return (
    receipt.decisionID === input.decisionID &&
    receipt.decision === input.decision &&
    (receipt.message ?? undefined) === (input.message ?? undefined) &&
    (input.requestFingerprint === undefined || input.requestFingerprint === receipt.requestFingerprint)
  )
}

/** 一个引擎源一本(管道持有):交出过的请求快照、已出的收据。 */
export function createReceiptLedger(): ReceiptLedger {
  const shown = new Map<string, { sessionID: string; fingerprint: Promise<string> }>()
  const receipts = new Map<string, V1.PermissionV2DecisionReceipt>()
  const decisionIDs = new Map<string, string>()
  const inflight = new Map<string, Promise<DecisionOutcome>>()

  async function decideNow(engine: ApprovalEngine, input: DecisionInput): Promise<DecisionOutcome> {
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

    const current = await engine.current({ sessionID, requestID })
    if (!current) return { type: "expired" }
    if ((await requestFingerprint(current)) !== expected) return { type: "conflict" }
    if (input.decision === "always" && !current.always.length) return { type: "conflict" }

    const resolvedRequestIDs = await engine.decide({
      sessionID,
      requestID,
      decision: input.decision,
      ...(input.message ? { message: input.message } : {}),
    })
    if (resolvedRequestIDs[0] !== requestID) return { type: "expired" }
    const receipt: V1.PermissionV2DecisionReceipt = {
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
  }

  return {
    show(request) {
      const fingerprint = requestFingerprint(request)
      fingerprint.catch(() => {}) // 只在决定时才 await;wire 来的请求总是 JSON,这里不让它成为未处理的拒绝
      shown.set(request.id, { sessionID: request.sessionID, fingerprint })
      return request
    },
    decide(engine, input) {
      const before = inflight.get(input.requestID)
      const next = (before ? before.catch(() => undefined) : Promise.resolve()).then(() => decideNow(engine, input))
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
