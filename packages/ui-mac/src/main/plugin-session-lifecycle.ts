import type { EngineClient } from "./engine-client"
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
  const notices = new Map<string, Promise<void>>()
  const requester = {
    request(action: Action): Promise<void> {
      const occurrence = action.action === "notification" ? JSON.stringify([action.sessionId, action.notification.occurrenceId]) : undefined
      if (occurrence && notices.has(occurrence)) return notices.get(occurrence)!
      const result = new Promise<void>((resolve, reject) => {
        const id = ++seq
        pending.set(id, { resolve, reject })
        try { post({ ...action, type: "codepuppy.plugin.session", id }) }
        catch { pending.delete(id); reject(Error("runtime-failed: package session transport unavailable")) }
      })
      if (occurrence) notices.set(occurrence, result)
      return result
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
      notices.clear()
    },
  }
  current = requester
  return requester
}


/** Consume original native identities once; OS notification settings do not control package events. */
export function watchPluginSessionNotifications(client: Pick<EngineClient, "event"> & { session: Pick<EngineClient["session"], "get"> }) {
  const controller = new AbortController()
  const active = new Set<Promise<void>>()
  const subscription = (async () => {
    for await (const event of client.event.subscribe({ types: ["permission.asked", "session.execution.succeeded", "form.created"], signal: controller.signal })) {
      if (event.type === "server.connected") continue
      if (event.type === "form.created" && event.data.form.metadata?.kind !== "mcp-elicitation") continue
      const notify = (async () => {
        const sessionId = event.type === "form.created" ? event.data.form.sessionID : event.data.sessionID
        if (sessionId === "global") return
        const session = await client.session.get({ sessionID: sessionId }, { signal: controller.signal })
        if (controller.signal.aborted || (event.type === "session.execution.succeeded" && session.parentID)) return
        await sendPluginSessionAction({ sessionId, action: "notification", notification: {
          occurrenceId: event.id,
          notificationType: event.type === "permission.asked" ? "permission_prompt" : event.type === "form.created" ? "elicitation_dialog" : "idle_prompt",
          message: event.type === "permission.asked" ? event.data.message ?? event.data.action : event.type === "form.created" ? event.data.form.title : session.title ?? sessionId,
          ...(session.title === undefined ? {} : { title: session.title }),
        } })
      })().catch(error => { if (!controller.signal.aborted) console.warn("runtime-failed: package notification source", String(error)) })
      active.add(notify)
      void notify.finally(() => { active.delete(notify) })
    }
  })().catch(error => { if (!controller.signal.aborted) console.warn("runtime-failed: package notification stream", String(error)) })
  return { stop: async () => { controller.abort(); await subscription; await Promise.all(active) } }
}
