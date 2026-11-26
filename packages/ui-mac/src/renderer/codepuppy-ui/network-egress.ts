import { ServerScope } from "../../../../codepuppy-app/src/utils/server-scope"
import { createStore, reconcile } from "solid-js/store"
import type { EgressApproval, NetworkEgressApi, RuntimeTier, SessionRef } from "../../shared/network-egress-wire"
import { sandboxApplied, sandboxGeneration } from "./sandbox-state"

export async function networkSessionRef(identity: { serverKey?: string; directory: string; sessionID: string }): Promise<SessionRef | undefined> {
  const generation = sandboxGeneration()
  if (!sandboxApplied() || generation === undefined || typeof window === "undefined") return
  if (identity.serverKey) {
    const key = identity.serverKey as Parameters<typeof ServerScope.fromServerKey>[0]
    if (ServerScope.fromServerKey(key) !== ServerScope.local) {
      const local = await window.api.awaitInitialization()
      if (ServerScope.fromServerKey(key, local.url as typeof key) !== ServerScope.local) return
    }
  }
  if (generation !== sandboxGeneration()) throw new Error("network egress: engine generation changed")
  return { generation, directory: identity.directory, sessionID: identity.sessionID }
}

export async function setSessionNetworkTier(identity: { serverKey?: string; directory: string; sessionID: string }, tier: RuntimeTier): Promise<void> {
  const session = await networkSessionRef(identity)
  if (!session) return
  const result = await window.api.networkEgress.setTier({ session, tier })
  if (!result.ok) throw new Error(`network egress: ${result.code}`)
}

export function createNetworkEgressFeed(api: NetworkEgressApi, session: SessionRef) {
  const [state, setState] = createStore<{ cards: EgressApproval[]; ready: boolean; failed: boolean }>({ cards: [], ready: false, failed: false })
  let disposed = false
  let requested = 0
  let completed = 0
  let loading = false
  let revision = -1
  const load = async () => {
    requested++
    setState({ ready: false, failed: false })
    if (loading) return
    loading = true
    try {
      while (!disposed && completed < requested) {
        const current = requested
        const result = await api.listApprovals({ session })
        if (disposed) return
        if (current !== requested) continue
        completed = current
        if (!result.ok) { setState({ ready: false, failed: true }); return }
        setState("cards", reconcile(result.value, { key: "requestID" }))
        setState({ ready: true, failed: false })
      }
    } catch {
      if (!disposed) setState({ ready: false, failed: true })
    } finally { loading = false }
  }
  // Subscribe before taking the snapshot. An invalidation during the read forces another read.
  const unsubscribe = api.subscribe((event) => {
    if (event.kind !== "approvals" || event.revision <= revision) return
    revision = event.revision
    void load()
  })
  void load()
  return { state, load, dispose() { disposed = true; unsubscribe() } }
}
