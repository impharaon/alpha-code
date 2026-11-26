import { activitySession, networkActivityKey, parseNetworkInbound, sessionRefKey, type NetworkActivity, type NetworkOutbound, type SessionRef, type RuntimeTier } from "../shared/network-egress-wire"
import { unattendedRuns } from "./codepuppy-unattended"

export type NetworkInspection = {
  session(ref: SessionRef): Promise<{ parentID?: string } | undefined>
  shell(ref: SessionRef, id: string): Promise<boolean>
}

export function createNetworkEgressActivity() {
  const listeners = new Set<() => void>()
  let revision = 0
  let connection: {
    generation: number
    post: (message: NetworkOutbound) => void
    inspect: NetworkInspection
    activities: Map<string, NetworkActivity>
    endedShells: Set<string>
    tiers: Map<string, RuntimeTier>
    seq: number
    complete: boolean
    queue: Promise<void>
  } | undefined
  const changed = () => { revision++; listeners.forEach((listener) => listener()) }
  const snapshot = () => ({ generation: connection?.generation, revision, complete: connection?.complete ?? false, activities: [...(connection?.activities.values() ?? [])] })

  return {
    snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    attach(generation: number, post: (message: NetworkOutbound) => void, inspect: NetworkInspection) {
      const current = { generation, post, inspect, activities: new Map<string, NetworkActivity>(), endedShells: new Set<string>(), tiers: new Map<string, RuntimeTier>(), seq: 0, complete: false, queue: Promise.resolve() }
      connection = current
      changed()
      post({ type: "codepuppy.network.attached", generation })
      return () => {
        if (connection !== current) return
        connection = undefined
        changed()
      }
    },
    receive(value: unknown, post: (message: NetworkOutbound) => void): boolean {
      if (!value || typeof value !== "object" || !("type" in value) || typeof value.type !== "string" || !value.type.startsWith("codepuppy.network.")) return false
      const current = connection
      const message = parseNetworkInbound(value)
      if (!current || current.post !== post || !message) return true
      current.queue = current.queue.then(async () => {
        if (connection !== current) return
        const generation = message.type === "codepuppy.network.snapshot" ? message.generation : activitySession(message.activity).generation
        const reply = (ok: boolean) => post({ type: "codepuppy.network.activity.reply", id: message.id, seq: message.seq, ok })
        if (generation !== current.generation || message.seq <= current.seq) { reply(false); return }
        if (message.type === "codepuppy.network.activity" && message.seq !== current.seq + 1) {
          current.complete = false
          changed()
          post({ type: "codepuppy.network.snapshot.request", generation })
          reply(false)
          return
        }
        const incoming = message.type === "codepuppy.network.snapshot" ? message.activities : [message.activity]
        if (incoming.some((activity) => activitySession(activity).generation !== current.generation)) { current.complete = false; changed(); reply(false); return }
        const accepted = await Promise.all(incoming.map(async (activity) => {
          if (activity.kind !== "shell") return activity
          const key = networkActivityKey(activity)
          if (message.type === "codepuppy.network.activity" && message.op === "leave") { current.endedShells.add(key); return activity }
          if (current.endedShells.has(key)) return undefined
          if (await current.inspect.shell(activity.session, activity.shellID)) return activity
          current.endedShells.add(key)
          return undefined
        }))
        if (connection !== current) return
        if (message.type === "codepuppy.network.snapshot") current.activities.clear()
        for (const activity of accepted) {
          if (!activity) continue
          const key = networkActivityKey(activity)
          if (message.type === "codepuppy.network.activity" && message.op === "leave") current.activities.delete(key)
          else current.activities.set(key, activity)
        }
        current.seq = message.seq
        if (message.type === "codepuppy.network.snapshot") current.complete = true
        changed() // Subscribers publish notices before the leave acknowledgement.
        reply(true)
      }).catch(() => {
        if (connection !== current) return
        current.complete = false
        changed()
        try { post({ type: "codepuppy.network.activity.reply", id: message.id, seq: message.seq, ok: false }) } catch { /* Detach invalidates the snapshot. */ }
      })
      return true
    },
    async contains(session: SessionRef) {
      const current = connection
      if (!current || session.generation !== current.generation) return false
      const found = await current.inspect.session(session).catch(() => undefined)
      return connection === current && found !== undefined
    },
    async setTier(session: SessionRef, tier: RuntimeTier) {
      const current = connection
      if (!current || session.generation !== current.generation || !await current.inspect.session(session).catch(() => undefined) || connection !== current) return undefined
      current.tiers.set(sessionRefKey(session), tier)
      changed()
      return revision
    },
    async tier(session: SessionRef): Promise<RuntimeTier | "unknown"> {
      const current = connection
      if (!current || session.generation !== current.generation) return "unknown"
      const seen = new Set<string>()
      let next: SessionRef | undefined = session
      while (next && connection === current && !seen.has(next.sessionID)) {
        if (unattendedRuns.has(next.sessionID)) return "unknown"
        seen.add(next.sessionID)
        const bound = current.tiers.get(sessionRefKey(next))
        if (bound) return bound
        const parent: Awaited<ReturnType<NetworkInspection["session"]>> = await current.inspect.session(next).catch(() => undefined)
        next = parent?.parentID ? { ...next, sessionID: parent.parentID } : undefined
      }
      return "unknown"
    },
    publish(message: NetworkOutbound) {
      if (!connection) return
      try { connection.post(message) } catch { if (connection.complete) { connection.complete = false; changed() } }
    },
  }
}

export const networkEgressActivity = createNetworkEgressActivity()
