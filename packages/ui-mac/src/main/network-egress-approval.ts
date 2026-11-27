import { randomUUID } from "node:crypto"
import { activitySession, sessionRefKey, networkActivityKey, type Destination, type EgressPass, type EgressApproval, type EgressChange, type EgressDecisionReceipt, type NetworkActivity, type NetworkEgressApi, type RememberedSite } from "../shared/network-egress-wire"
import { admitUserEgressGrant, EGRESS_GRANT_PROMPT_TIMEOUT_MS, type EgressGrantOutcome, type EgressPassBasis } from "./network-egress-grants"
import type { createEgressPassLog } from "./network-egress-passes"
import { siteContains, siteForHost } from "./network-egress-sites"
import type { createNetworkEgressActivity } from "./network-egress-activity"
import { canonicalEgressGrantRecord, type EgressGrantTruthRead } from "./egress-grant-truth"

type ApprovalGroup = {
  approval: EgressApproval
  generation?: number
  activities: Map<string, NetworkActivity>
  waiters: Map<string, { deadline: number; finish(outcome: EgressGrantOutcome): void }>
  receipt?: EgressDecisionReceipt
}

export function createNetworkEgressApproval(deps: {
  available: boolean
  activity: ReturnType<typeof createNetworkEgressActivity>
  store: { read(): EgressGrantTruthRead; write(sites: readonly RememberedSite[]): void }
  log(line: string): void
  passes?: ReturnType<typeof createEgressPassLog>
  now?: () => number
  timeoutMs?: number
}) {
  const now = deps.now ?? Date.now
  const loaded = deps.available ? deps.store.read() : { ok: true as const, absent: true, sites: [] }
  let sites = loaded.ok ? loaded.sites : []
  let persistence: "ok" | "unreadable" | "write-failed" = loaded.ok ? "ok" : "unreadable"
  const temporary = new Map<string, { host: string; port: number }>()
  const cards = new Map<string, ApprovalGroup>()
  const pending = new Map<string, ApprovalGroup>()
  const listeners = new Set<(event: EgressChange) => void>()
  let revision = 0
  let serial = Promise.resolve()
  const key = (host: string, port: number) => JSON.stringify([host, port])
  const changed = (kind: EgressChange["kind"]) => { revision++; listeners.forEach((listener) => listener({ revision, kind })) }
  const authorized = (host: string, port: number) => {
    const target = admitUserEgressGrant(host, port)
    return !!target && (temporary.has(key(target.host, port)) || sites.some((entry) => siteContains(entry.site, target.host)))
  }
  const notice = (group: ApprovalGroup, state: "waiting" | "denied" | "timed-out" | "unavailable" | "allowed") => {
    if (!group.approval.recipients.length) return
    deps.activity.publish({ type: "codepuppy.network.notice", requestID: group.approval.requestID, destination: group.approval.destination, state,
      sessions: group.approval.recipients, activities: [...group.activities.values()], attribution: "unknown" })
  }
  const collect = (group: ApprovalGroup) => {
    const activities = deps.activity.snapshot().activities
    const recipients = new Map(group.approval.recipients.map((session) => [sessionRefKey(session), session]))
    const before = recipients.size
    const previousActivities = group.activities.size
    activities.forEach((activity) => {
      const session = activitySession(activity)
      recipients.set(sessionRefKey(session), session)
      group.activities.set(networkActivityKey(activity), activity)
    })
    group.approval.recipients = [...recipients.values()]
    if (recipients.size !== before || group.activities.size !== previousActivities) { changed("approvals"); notice(group, "waiting") }
  }
  const settle = (group: ApprovalGroup, receipt: EgressDecisionReceipt) => {
    group.receipt = receipt
    group.approval.state = "resolved"
    group.approval.decision = receipt.decision
    notice(group, receipt.decision === "deny" ? "denied" : "allowed")
    for (const waiter of [...group.waiters.values()]) waiter.finish(receipt.decision === "deny" ? "user-denied" : "granted")
    changed("approvals")
  }
  const invalidate = (group: ApprovalGroup) => {
    notice(group, "unavailable")
    for (const waiter of [...group.waiters.values()]) waiter.finish("approval-unavailable")
    cards.delete(group.approval.requestID)
    if (pending.get(key(group.approval.destination.host, group.approval.destination.port)) === group) pending.delete(key(group.approval.destination.host, group.approval.destination.port))
    changed("approvals")
  }
  const unsubscribe = deps.activity.subscribe(() => {
    const snapshot = deps.activity.snapshot()
    for (const group of [...cards.values()]) {
      if (group.generation !== undefined && group.generation !== snapshot.generation) { invalidate(group); continue }
      if (!group.waiters.size || group.receipt) continue
      group.generation ??= snapshot.generation
      collect(group)
    }
    void pass().then((basis) => {
      if (!basis || deps.activity.snapshot().revision !== basis.tierRevision) return
      for (const group of [...cards.values()]) {
        if (!group.waiters.size || group.receipt) continue
        notice(group, "allowed")
        for (const waiter of [...group.waiters.values()]) waiter.finish("granted")
        cards.delete(group.approval.requestID)
        changed("approvals")
      }
    })
  })
  async function pass(signal?: AbortSignal): Promise<EgressPassBasis | undefined> {
    if (!deps.available) return
    for (;;) {
      signal?.throwIfAborted()
      const snapshot = deps.activity.snapshot()
      if (!snapshot.complete || !snapshot.activities.length) return
      const sessions = [...new Map(snapshot.activities.map((activity) => { const session = activitySession(activity); return [sessionRefKey(session), session] })).values()]
      const tiers = await new Promise<Awaited<ReturnType<typeof deps.activity.tier>>[]>((resolve, reject) => {
        const abort = () => reject(signal?.reason)
        signal?.addEventListener("abort", abort, { once: true })
        Promise.all(sessions.map((session) => deps.activity.tier(session))).then(resolve, reject).finally(() => signal?.removeEventListener("abort", abort))
      })
      signal?.throwIfAborted()
      if (deps.activity.snapshot().revision !== snapshot.revision) continue
      if (tiers.some((tier) => tier !== "allow")) return
      return { sessions: sessions.map((session) => ({ session, tier: "allow" })), tierRevision: snapshot.revision }
    }
  }
  function linearize<T>(operation: () => T): Promise<T> {
    const next = serial.then(operation)
    serial = next.then(() => undefined, () => undefined)
    return next
  }
  const api: NetworkEgressApi = {
    async setTier(input) {
      if (!deps.available) return { ok: false, code: "unavailable" }
      if (await deps.activity.setTier(input.session, input.tier) === undefined) return { ok: false, code: "unavailable" }
      changed("approvals")
      return { ok: true, value: { revision } }
    },
    async listApprovals(input) {
      if (!deps.available || !await deps.activity.contains(input.session)) return { ok: false, code: "unavailable" }
      return linearize(() => {
        const visible = [...cards.values()].filter((group) => group.approval.recipients.some((session) => sessionRefKey(session) === sessionRefKey(input.session)))
        const value = visible.map((group) => structuredClone(group.approval))
        // A settled result is delivered once, then its request identity and receipt can retire.
        visible.forEach((group) => { if (group.receipt) cards.delete(group.approval.requestID) })
        return { ok: true as const, value }
      })
    },
    decide(input) {
      return linearize(() => {
        if (!deps.available) return { ok: false as const, code: "unavailable" as const }
        const group = cards.get(input.requestID)
        if (!group) return { ok: false as const, code: "not-found" as const }
        if (group.receipt) return { ok: true as const, value: group.receipt }
        const receipt: EgressDecisionReceipt = { requestID: input.requestID, decision: input.decision, remembered: false }
        if (input.decision !== "deny") {
          if (input.decision === "allow-persist") {
            const next = [...sites.filter((entry) => JSON.stringify(entry.site) !== JSON.stringify(group.approval.site)), { site: group.approval.site, at: new Date(now()).toISOString() }]
            try {
              if (!loaded.ok) throw new Error("egress sites are unreadable")
              deps.store.write(next)
              sites = next
              persistence = "ok"
              receipt.remembered = true
              changed("settings")
            } catch {
              persistence = "write-failed"
              receipt.persistenceError = "io"
              deps.log("egress sites: failed to remember site; only the exact destination is allowed for this run")
              changed("settings")
            }
          }
          if (!receipt.remembered) temporary.set(key(group.approval.destination.host, group.approval.destination.port), group.approval.destination)
        }
        settle(group, receipt)
        if (input.decision !== "deny") {
          for (const other of cards.values()) {
            if (other.receipt || !authorized(other.approval.destination.host, other.approval.destination.port)) continue
            settle(other, { requestID: other.approval.requestID, decision: input.decision, remembered: receipt.remembered })
          }
        }
        return { ok: true as const, value: receipt }
      })
    },
    async settings() {
      const recorded = deps.passes?.snapshot()
      return { ok: true, value: deps.available ? { available: true, revision, sites: sites.map(canonicalEgressGrantRecord), passes: recorded?.passes ?? [], persistence: persistence !== "ok" ? persistence : recorded?.persistence ?? "ok" } : { available: false } }
    },
    revoke(input) {
      return linearize(() => {
        if (!deps.available) return { ok: false as const, code: "unavailable" as const }
        sites = sites.filter((entry) => JSON.stringify(entry.site) !== JSON.stringify(input.site))
        for (const [id, target] of temporary) if (siteContains(input.site, target.host)) temporary.delete(id)
        for (const group of [...cards.values()]) if (!group.receipt && siteContains(input.site, group.approval.destination.host)) invalidate(group)
        try {
          if (!loaded.ok) throw new Error("egress sites are unreadable")
          deps.store.write(sites)
          persistence = "ok"
          changed("settings")
          return { ok: true as const, value: { revision } }
        } catch {
          persistence = "write-failed"
          deps.log("egress sites: revoked in memory but writing failed; retry before restarting")
          changed("settings")
          return { ok: false as const, code: "io" as const }
        }
      })
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return {
    api,
    authorized,
    pass,
    recordPass(record: EgressPass) { deps.passes?.record(record); changed("settings") },
    denyPass(id: string, destination: Destination, basis: EgressPassBasis) {
      deps.activity.publish({ type: "codepuppy.network.notice", requestID: id, destination, state: "denied", sessions: basis.sessions.map((entry) => entry.session), activities: deps.activity.snapshot().activities, attribution: "unknown" })
    },
    request(host: string, port: number, signal?: AbortSignal): Promise<EgressGrantOutcome> {
      if (!deps.available || signal?.aborted) return Promise.resolve("approval-unavailable")
      const target = admitUserEgressGrant(host, port)
      if (!target) return Promise.resolve("not-asked")
      if (authorized(target.host, port)) return Promise.resolve("granted")
      const destinationKey = key(target.host, port)
      const deadline = now() + (deps.timeoutMs ?? EGRESS_GRANT_PROMPT_TIMEOUT_MS)
      const group: ApprovalGroup = pending.get(destinationKey) ?? {
        approval: { requestID: randomUUID(), destination: target, site: siteForHost(target.host), attribution: { kind: "unknown" }, recipients: [], createdAt: new Date(now()).toISOString(), connectionDeadlineAt: new Date(deadline).toISOString(), state: "pending" },
        generation: deps.activity.snapshot().generation, activities: new Map(), waiters: new Map(),
      }
      pending.set(destinationKey, group)
      cards.set(group.approval.requestID, group)
      return new Promise((resolve) => {
        const id = randomUUID()
        const finish = (outcome: EgressGrantOutcome) => {
          if (!group.waiters.delete(id)) return
          clearTimeout(timer)
          signal?.removeEventListener("abort", abort)
          if (!group.waiters.size) {
            if (pending.get(destinationKey) === group) pending.delete(destinationKey)
            if (!group.receipt) { group.approval.state = "connection-expired"; changed("approvals") }
          } else group.approval.connectionDeadlineAt = new Date([...group.waiters.values()].reduce((latest, waiter) => Math.max(latest, waiter.deadline), 0)).toISOString()
          resolve(outcome)
        }
        const abort = () => { notice(group, group.waiters.size > 1 ? "waiting" : "unavailable"); finish("approval-unavailable") }
        const timer = setTimeout(() => {
          const outcome = group.approval.recipients.length ? "approval-timeout" : "approval-unavailable"
          notice(group, group.waiters.size > 1 ? "waiting" : outcome === "approval-timeout" ? "timed-out" : "unavailable")
          finish(outcome)
        }, deps.timeoutMs ?? EGRESS_GRANT_PROMPT_TIMEOUT_MS)
        group.waiters.set(id, { deadline, finish })
        signal?.addEventListener("abort", abort, { once: true })
        group.approval.connectionDeadlineAt = new Date([...group.waiters.values()].reduce((latest, waiter) => Math.max(latest, waiter.deadline), 0)).toISOString()
        collect(group)
        changed("approvals")
      })
    },
    close() { unsubscribe(); [...cards.values()].forEach(invalidate); listeners.clear() },
  }
}

export type NetworkEgressApprovalService = ReturnType<typeof createNetworkEgressApproval>
