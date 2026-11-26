import { expect, test } from "bun:test"
import { createNetworkEgressActivity } from "./network-egress-activity"
import { createNetworkEgressApproval } from "./network-egress-approval"
import type { EgressApproval, NetworkActivity, NetworkOutbound, RememberedSite, SessionRef } from "../shared/network-egress-wire"

test("通放只取非空完整的全 allow 快照，等待窗口恢复后无用户点击也能继续", async () => {
  const f = await approvalFixture()
  try {
    expect(await f.service.pass()).toBeUndefined()
    await f.setActivities([])
    const waiting = f.service.request("recover.example.com", 443)
    await f.service.api.setTier({ session: f.session(), tier: "allow" })
    expect(await f.service.pass()).toBeUndefined()
    await f.setActivities(["ses_a"])
    expect(await waiting).toBe("granted")
    expect(await f.cards()).toEqual([])
    expect(f.service.authorized("recover.example.com", 443)).toBe(false)
    await f.setActivities(["ses_a", "ses_b"])
    expect(await f.service.pass()).toBeUndefined()
    for (const tier of ["ask", "readonly"] as const) {
      await f.service.api.setTier({ session: f.session("ses_b"), tier })
      expect(await f.service.pass()).toBeUndefined()
    }
    await f.service.api.setTier({ session: f.session("ses_b"), tier: "allow" })
    expect((await f.service.pass())?.sessions).toHaveLength(2)
    f.activity.attach(2, () => {}, { session: async () => ({}), shell: async () => true })
    expect(await f.service.pass()).toBeUndefined()
  } finally { f.service.close() }
})

async function approvalFixture(options: { timeoutMs?: number; unreadable?: boolean } = {}) {
  const activity = createNetworkEgressActivity()
  const messages: NetworkOutbound[] = []
  const replies = new Map<number, () => void>()
  const post = (message: NetworkOutbound) => { messages.push(message); if (message.type === "codepuppy.network.activity.reply") replies.get(message.id)?.() }
  activity.attach(1, post, { session: async () => ({}), shell: async () => true })
  let sites: RememberedSite[] = []
  let failWrite = false
  let sequence = 0
  const store = {
    read: () => options.unreadable ? { ok: false as const, reason: "bad file" } : { ok: true as const, absent: false, sites: structuredClone(sites) },
    write: (value: readonly RememberedSite[]) => { if (failWrite) throw new Error("io"); sites = structuredClone([...value]) },
  }
  const service = createNetworkEgressApproval({ available: true, activity, store, log: () => {}, timeoutMs: options.timeoutMs ?? 1000 })
  const session = (sessionID = "ses_a"): SessionRef => ({ generation: 1, sessionID, directory: "/project" })
  const setActivities = (sessions: string[]) => new Promise<void>((resolve) => {
    const id = ++sequence
    replies.set(id, resolve)
    const activities: NetworkActivity[] = sessions.map((sessionID) => ({ kind: "tool", invocationID: sessionID, ref: { ...session(sessionID), messageID: "msg_a", callID: sessionID }, tool: "shell" }))
    activity.receive({ type: "codepuppy.network.snapshot", id, seq: id, generation: 1, activities }, post)
  })
  const cards = async (sessionID = "ses_a"): Promise<EgressApproval[]> => {
    const result = await service.api.listApprovals({ session: session(sessionID) })
    if (!result.ok) throw new Error(result.code)
    return result.value
  }
  await setActivities(["ses_a"])
  return { activity, service, store, cards, session, setActivities, messages, failWrite: (value: boolean) => { failWrite = value } }
}

test("同地址合并、收件人取并集、相反点击只结算一次，无拒绝冷却或目的地上限", async () => {
  const f = await approvalFixture()
  try {
    const first = f.service.request("a.example.com", 443)
    const same = f.service.request("a.example.com", 443)
    await f.setActivities(["ses_b"])
    const a = (await f.cards())[0]!
    expect((await f.cards("ses_b"))[0]?.requestID).toBe(a.requestID)
    expect(a.attribution).toEqual({ kind: "unknown" })
    expect(a.recipients.map((ref) => ref.sessionID).sort()).toEqual(["ses_a", "ses_b"])
    const [allow, deny] = await Promise.all([f.service.api.decide({ requestID: a.requestID, decision: "allow-session" }), f.service.api.decide({ requestID: a.requestID, decision: "deny" })])
    expect(allow).toEqual(deny)
    expect(await Promise.all([first, same])).toEqual(["granted", "granted"])
    expect(f.service.authorized("a.example.com", 443)).toBe(true)
    expect(f.service.authorized("a.example.com", 80)).toBe(false)
    const pending = ["one.org", "two.org", "three.org", "four.org"].map((host) => f.service.request(host, 443))
    const open = (await f.cards("ses_b")).filter((card) => card.state === "pending")
    expect(open).toHaveLength(4)
    for (const card of open) await f.service.api.decide({ requestID: card.requestID, decision: "deny" })
    expect(await Promise.all(pending)).toEqual(Array(4).fill("user-denied"))
    const retry = f.service.request("one.org", 443)
    expect((await f.cards("ses_b")).filter((card) => card.state === "pending")).toHaveLength(1)
    f.service.close()
    await retry
  } finally { f.service.close() }
})

test("记住结算站点全部 pending 并保留租户边界，撤销立即失效且废弃晚到请求", async () => {
  const f = await approvalFixture()
  try {
    const a = f.service.request("a.example.com", 443)
    const b = f.service.request("b.example.com", 8443)
    const card = (await f.cards())[0]!
    expect(await f.service.api.decide({ requestID: card.requestID, decision: "allow-persist" })).toMatchObject({ ok: true, value: { remembered: true } })
    expect(await Promise.all([a, b])).toEqual(["granted", "granted"])
    expect((await f.cards()).every((item) => item.state === "resolved")).toBe(true)
    expect(f.messages.filter((message) => message.type === "codepuppy.network.notice" && message.state === "allowed")).toHaveLength(2)
    expect(f.service.authorized("example.com", 81)).toBe(true)
    expect(f.service.authorized("otherexample.com", 443)).toBe(false)
    const restored = createNetworkEgressApproval({ available: true, activity: f.activity, store: f.store, log: () => {} })
    expect(restored.authorized("b.example.com", 1234)).toBe(true)
    restored.close()
    await f.service.api.revoke({ site: card.site })
    expect(f.service.authorized("b.example.com", 8443)).toBe(false)
    const again = f.service.request("a.example.com", 443)
    const fresh = (await f.cards()).find((item) => item.state === "pending")!
    await f.service.api.revoke({ site: card.site })
    expect(await again).toBe("approval-unavailable")
    expect(await f.service.api.decide({ requestID: fresh.requestID, decision: "allow-persist" })).toEqual({ ok: false, code: "not-found" })
  } finally { f.service.close() }
})

test("连接过期保留晚到允许，但新连接使用新请求，不重用旧等待期限", async () => {
  const f = await approvalFixture({ timeoutMs: 20 })
  try {
    const first = f.service.request("a.example.com", 443)
    const expired = (await f.cards())[0]!
    expect(await first).toBe("approval-timeout")
    expect((await f.cards())[0]?.state).toBe("connection-expired")
    const retry = f.service.request("a.example.com", 443)
    const fresh = (await f.cards()).find((card) => card.state === "pending")!
    expect(fresh.requestID).not.toBe(expired.requestID)
    await f.service.api.decide({ requestID: expired.requestID, decision: "allow-session" })
    expect(await retry).toBe("granted")
  } finally { f.service.close() }
})

test("空集合在原窗口等待后加入活动，换代失效，不为私网发卡", async () => {
  const f = await approvalFixture({ timeoutMs: 20 })
  try {
    await f.setActivities([])
    const first = f.service.request("empty.example.com", 443)
    expect(await f.cards()).toEqual([])
    expect(await first).toBe("approval-unavailable")
    const next = f.service.request("pending.example.com", 443)
    await f.setActivities(["ses_a"])
    expect((await f.cards()).some((card) => card.destination.host === "pending.example.com")).toBe(true)
    f.activity.attach(2, () => {}, { session: async () => ({}), shell: async () => true })
    expect(await next).toBe("approval-unavailable")
    expect(await f.service.request("127.0.0.1", 443)).toBe("not-asked")
  } finally { f.service.close() }
})

test("保存失败只给精确临时授权，撤销失败保持内存撤销且可重试；坏文件不被覆盖", async () => {
  const f = await approvalFixture()
  try {
    f.failWrite(true)
    const request = f.service.request("a.example.com", 443)
    const card = (await f.cards())[0]!
    expect(await f.service.api.decide({ requestID: card.requestID, decision: "allow-persist" })).toMatchObject({ ok: true, value: { remembered: false, persistenceError: "io" } })
    expect(await request).toBe("granted")
    expect(f.service.authorized("b.example.com", 443)).toBe(false)
    expect(await f.service.api.revoke({ site: card.site })).toEqual({ ok: false, code: "io" })
    expect(f.service.authorized("a.example.com", 443)).toBe(false)
    f.failWrite(false)
    expect(await f.service.api.revoke({ site: card.site })).toMatchObject({ ok: true })
  } finally { f.service.close() }
  const bad = await approvalFixture({ unreadable: true })
  try {
    const request = bad.service.request("a.example.com", 443)
    await bad.service.api.decide({ requestID: (await bad.cards())[0]!.requestID, decision: "allow-persist" })
    expect(await request).toBe("granted")
    expect(bad.store.read()).toEqual({ ok: false, reason: "bad file" })
  } finally { bad.service.close() }
})


test("已决结果读取一次后退休，重复点击仍取原回执，后续卡片不积累历史", async () => {
  const f = await approvalFixture()
  try {
    const first = f.service.request("a.example.com", 443)
    const card = (await f.cards())[0]!
    const receipt = await f.service.api.decide({ requestID: card.requestID, decision: "deny" })
    expect(await first).toBe("user-denied")
    expect(await f.service.api.decide({ requestID: card.requestID, decision: "allow-session" })).toEqual(receipt)
    expect((await f.cards()).map((item) => item.state)).toEqual(["resolved"])
    expect(await f.cards()).toEqual([])
    expect(await f.service.api.decide({ requestID: card.requestID, decision: "allow-session" })).toEqual({ ok: false, code: "not-found" })
    const next = f.service.request("b.example.com", 443)
    expect((await f.cards()).map((item) => item.destination.host)).toEqual(["b.example.com"])
    f.service.close()
    await next
  } finally { f.service.close() }
})

test("准入失败的回环与私网只保留原拒绝通路，不向活动会话发等待说明", async () => {
  const f = await approvalFixture()
  try {
    for (const host of ["127.0.0.1", "10.0.0.1"]) expect(await f.service.request(host, 443)).toBe("not-asked")
    expect(await f.cards()).toEqual([])
    expect(f.messages.filter((message) => message.type === "codepuppy.network.notice")).toEqual([])
  } finally { f.service.close() }
})
