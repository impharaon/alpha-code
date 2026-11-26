import type { PackageSessionMessage } from "./codepuppy-sidecar-messages"

type Action = Omit<Extract<PackageSessionMessage, { action: "leave" }>, "id" | "type"> | Omit<Extract<PackageSessionMessage, { action: "notification" }>, "id" | "type">
const viewed = new Map<number, string>()
let current: ReturnType<typeof createPluginSessionRequester> | undefined

export function notePluginSessionViewed(renderer: number, sessionId: string | undefined) {
  if (sessionId === undefined) viewed.delete(renderer)
  else viewed.set(renderer, sessionId)
}

/** Main remembers view facts only; ext owns active lifetimes and decides whether a hook runs. */
export async function sendPluginSessionAction(action: Action): Promise<void> {
  await current?.request(action).catch(error => console.warn("runtime-failed: package session action", String(error)))
}

export function endViewedPluginSessions(reason: Extract<Action, { action: "leave" }>["reason"]) {
  if (!current || viewed.size === 0) return
  return Promise.all([...new Set(viewed.values())].map(sessionId => sendPluginSessionAction({ sessionId, action: "leave", reason }))).then(() => {})
}

export function createPluginSessionRequester(post: (message: PackageSessionMessage) => void) {
  let seq = 0
  const pending = new Map<number, { resolve(): void; reject(error: Error): void }>()
  const requester = {
    request(action: Action): Promise<void> {
      return new Promise((resolve, reject) => {
        const id = ++seq
        pending.set(id, { resolve, reject })
        try { post({ ...action, type: "codepuppy.plugin.session", id }) }
        catch { pending.delete(id); reject(Error("runtime-failed: package session transport unavailable")) }
      })
    },
    receive(value: unknown) {
      if (!value || typeof value !== "object" || "type" in value || !("id" in value) || typeof value.id !== "number" || !("ok" in value) || typeof value.ok !== "boolean") return false
      const waiting = pending.get(value.id)
      if (!waiting) return false
      pending.delete(value.id)
      if (value.ok) waiting.resolve()
      else waiting.reject(Error("runtime-failed: package session receiver failed"))
      return true
    },
    close() {
      if (current === requester) current = undefined
      for (const waiting of pending.values()) waiting.reject(Error("runtime-failed: package session engine exited"))
      pending.clear()
    },
  }
  current = requester
  return requester
}
