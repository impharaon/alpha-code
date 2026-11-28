import { randomUUID } from "node:crypto"
// Use the host constructor: local plugin reloads must not invalidate the shared tool schema.
import { Error } from "@opencode/plugin/promise/tool"
import type { Tool } from "../../schema/src/tool"
import { NETWORK_EGRESS_NOTE } from "./context-injection"
import type { Plugin } from "@opencode/plugin"
import { activitySession, networkActivityKey, parseNetworkActivity, sessionRefKey, type EgressNotice, type SessionRef, type NetworkActivity, type NetworkActivityReply, type NetworkInbound, type NetworkOutbound } from "../../ui-mac/src/shared/network-egress-wire"

// Core shallow-copies results before execute.after. An invocation-local marker survives that
// boundary and metadata spreads, without a serializable field or a shared-callID collision.
const RESULT_NOTICE = Symbol("network.egress.result")
type ResultNotice = { session: SessionRef; requests: string[]; hadMetadata: boolean }
// A failure reaches execute.after as the engine's own Tool.Error, rebuilt from the thrown one's message and metadata when
// the ext carries its own copy of the class (the shipped bundle, ADR-006); a symbol key does not survive that copy. The
// failure marker is a plain metadata entry, removed by `attachResult` before the engine records the failure.
const FAILURE_NOTICE = "codepuppyNetworkEgressNotice"
const failureNotice = (value: unknown): ResultNotice | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  const notice = value as Partial<ResultNotice>
  const session = notice.session as Partial<SessionRef> | undefined
  if (typeof session?.generation !== "number" || typeof session.directory !== "string" || typeof session.sessionID !== "string") return undefined
  if (!Array.isArray(notice.requests) || !notice.requests.every((id) => typeof id === "string") || typeof notice.hadMetadata !== "boolean") return undefined
  return { session: { generation: session.generation, directory: session.directory, sessionID: session.sessionID }, requests: notice.requests, hadMetadata: notice.hadMetadata }
}
type Terminal =
  | { status: "completed"; result: { content?: unknown; metadata?: Record<string, unknown> } & Record<string, unknown> }
  | { status: "error"; error: Tool.Error }

export function createNetworkEgress(deps: {
  send(build: (id: number) => NetworkInbound): Promise<NetworkActivityReply | undefined>
  log(line: string): void
}) {
  const activities = new Map<string, NetworkActivity>()
  const notices = new Map<string, Map<string, EgressNotice>>()
  const endedShells = new Set<string>()
  const locations = new Map<string, AbortController>()
  let generation: number | undefined
  let seq = 0
  let queue = Promise.resolve()

  const wireActivity = (activity: NetworkActivity): NetworkActivity => activity.kind === "tool"
    ? { ...activity, ref: { ...activity.ref, generation: generation ?? 0 } }
    : { ...activity, session: { ...activity.session, generation: generation ?? 0 } }
  const synchronize = () => {
    queue = queue.then(async () => {
      if (generation === undefined) return
      const current = generation
      const reply = await deps.send((id) => ({ type: "codepuppy.network.snapshot", id, seq: ++seq, generation: current, activities: [...activities.values()].map(wireActivity) }))
      if (!reply?.ok) deps.log("network egress: full activity snapshot unavailable")
    }).catch(() => { deps.log("network egress: full activity snapshot failed") })
    return queue
  }
  const update = (op: "enter" | "leave", activity: NetworkActivity) => {
    const key = networkActivityKey({ ...wireActivity(activity) })
    if (op === "enter") activities.set(key, activity)
    else activities.delete(key)
    queue = queue.then(async () => {
      if (generation === undefined) return
      const reply = await deps.send((id) => ({ type: "codepuppy.network.activity", id, seq: ++seq, op, activity: wireActivity(activity) }))
      if (!reply?.ok) {
        deps.log("network egress: activity delivery unavailable")
        void synchronize()
      }
    }).catch(() => { deps.log("network egress: activity delivery failed"); void synchronize() })
    return queue
  }
  const consume = (session: SessionRef, requests: string[]) => {
    const current = notices.get(sessionRefKey(session))
    requests.forEach((id) => { if (current?.get(id)?.state !== "waiting") current?.delete(id) })
    if (!current?.size) notices.delete(sessionRefKey(session))
  }
  const stamp = (activity: NetworkActivity, value: unknown, failed: boolean) => {
    const session = activitySession(wireActivity(activity))
    const requests = [...(notices.get(sessionRefKey(session))?.values() ?? [])]
      .filter((notice) => notice.activities.some((item) => networkActivityKey(item) === networkActivityKey(wireActivity(activity))))
      .map((notice) => notice.requestID)
    if (!requests.length) return value
    if (failed) {
      const error = value instanceof Error ? value : new Error({ message: value instanceof globalThis.Error ? value.message : String(value), error: value })
      const marker: ResultNotice = { session, requests, hadMetadata: error.metadata !== undefined }
      return new Error({ message: error.message, ...(error.error === undefined ? {} : { error: error.error }), metadata: { ...error.metadata, [FAILURE_NOTICE]: marker } })
    }
    if (!value || typeof value !== "object") return value
    const original = "metadata" in value ? value.metadata as Record<string, unknown> | undefined : undefined
    const metadata = { ...original, [RESULT_NOTICE]: { session, requests, hadMetadata: original !== undefined } }
    return { ...value, metadata }
  }
  const shell = (directory: string, sessionID: string, shellID: string) => parseNetworkActivity({ kind: "shell", session: { generation: generation ?? 0, directory, sessionID }, shellID })
  return {
    receive(message: NetworkOutbound) {
      if (message.type === "codepuppy.network.attached") {
        if (generation !== message.generation) notices.clear()
        generation = message.generation
        // IDs stay stable when attach arrives after an enter was observed.
        const previous = [...activities.values()]
        activities.clear()
        previous.forEach((item) => { const activity = wireActivity(item); activities.set(networkActivityKey(activity), activity) })
        void synchronize()
        return true
      }
      if (message.type === "codepuppy.network.snapshot.request") {
        if (message.generation === generation) void synchronize()
        return true
      }
      if (message.type === "codepuppy.network.notice") {
        if (message.state === "allowed") {
          notices.forEach((current) => { current.delete(message.requestID) })
          return true
        }
        message.sessions.filter((session) => session.generation === generation).forEach((session) => {
          const key = sessionRefKey(session)
          const current = notices.get(key) ?? new Map<string, EgressNotice>()
          current.set(message.requestID, message)
          notices.set(key, current)
        })
        return true
      }
      return false
    },
    attachResult(event: Terminal) {
      if (event.status === "error") {
        const { [FAILURE_NOTICE]: carried, ...rest } = event.error.metadata ?? {}
        const marker = failureNotice(carried)
        if (!marker) return false
        const requests = marker.requests.filter((id) => notices.get(sessionRefKey(marker.session))?.has(id))
        // The incoming class: Core recognises its errors by class (as policy/display.ts and secret-mask.ts rebuild them).
        const Constructor = event.error.constructor as typeof Error
        event.error = new Constructor({
          message: requests.length ? `${event.error.message}\n\n${NETWORK_EGRESS_NOTE}` : event.error.message,
          ...(event.error.error === undefined ? {} : { error: event.error.error }),
          ...(marker.hadMetadata || Object.keys(rest).length ? { metadata: rest } : {}),
        })
        if (!requests.length) return false
        consume(marker.session, requests)
        return true
      }
      const metadata = event.result.metadata as (Record<string, unknown> & { [RESULT_NOTICE]?: ResultNotice }) | undefined
      const marker = metadata?.[RESULT_NOTICE]
      if (!marker) return false
      delete metadata![RESULT_NOTICE]
      if (!marker.hadMetadata && !Object.keys(metadata!).length) delete event.result.metadata
      const requests = marker.requests.filter((id) => notices.get(sessionRefKey(marker.session))?.has(id))
      if (!requests.length) return false
      const content = event.result.content
      event.result = { ...event.result, content: Array.isArray(content) ? [...content, { type: "text", text: NETWORK_EGRESS_NOTE }] : typeof content === "string" ? `${content}\n\n${NETWORK_EGRESS_NOTE}` : [{ type: "text", text: NETWORK_EGRESS_NOTE }] }
      consume(marker.session, requests)
      return true
    },
    context(directory: string, event: { sessionID: string; system: Array<{ type: "text"; text: string }> }) {
      if (generation === undefined) return
      const session = { generation, directory, sessionID: event.sessionID }
      const current = notices.get(sessionRefKey(session))
      if (!current?.size) return
      event.system.push({ type: "text", text: NETWORK_EGRESS_NOTE })
      consume(session, [...current.keys()])
    },
    async run(directory: string, tool: string, context: Record<string, unknown>, execute: () => Promise<unknown>) {
      const activity = parseNetworkActivity({ kind: "tool", invocationID: randomUUID(), ref: { generation: generation ?? 0, directory, sessionID: context.sessionID, messageID: context.messageID, callID: context.id }, tool })
      if (!activity) return execute()
      await update("enter", activity)
      const outcome = await Promise.resolve().then(execute).then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
      try {
        const result = outcome.ok ? outcome.value : undefined
        const metadata = result && typeof result === "object" && "metadata" in result ? result.metadata as { status?: unknown; shellID?: unknown } : undefined
        if (metadata?.status === "running" && typeof metadata.shellID === "string") {
          const running = shell(directory, activitySession(activity).sessionID, metadata.shellID)
          if (running && !endedShells.has(metadata.shellID)) await update("enter", running)
        }
      } finally {
        await update("leave", activity)
      }
      if (!outcome.ok) throw stamp(activity, outcome.error, true)
      return stamp(activity, outcome.value, false)
    },
    watch(context: Plugin.Context) {
      const directory = context.location.directory
      locations.get(directory)?.abort()
      const controller = new AbortController()
      locations.set(directory, controller)
      void synchronize()
      void (async () => {
        for await (const event of context.event.subscribe({ types: ["shell.created", "shell.exited", "shell.deleted"], signal: controller.signal })) {
          if (event.type === "shell.created") {
            const info = event.data.info
            if (typeof info.metadata.sessionID !== "string" || endedShells.has(info.id)) continue
            const activity = shell(event.location?.directory ?? directory, info.metadata.sessionID, info.id)
            if (activity) await update("enter", activity)
            continue
          }
          endedShells.add(event.data.id)
          for (const activity of activities.values()) {
            if (activity.kind === "shell" && activity.shellID === event.data.id) await update("leave", activity)
          }
        }
      })().catch(() => { if (!controller.signal.aborted) deps.log("network egress: shell event stream unavailable") })
      return () => { if (locations.get(directory) === controller) locations.delete(directory); controller.abort() }
    },
    settled: () => queue,
  }
}
