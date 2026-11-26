import { randomUUID } from "node:crypto"
import type { Plugin } from "@opencode/plugin"
import { activitySession, networkActivityKey, parseNetworkActivity, type NetworkActivity, type NetworkActivityReply, type NetworkInbound, type NetworkOutbound } from "../../ui-mac/src/shared/network-egress-wire"

export function createNetworkEgress(deps: {
  send(build: (id: number) => NetworkInbound): Promise<NetworkActivityReply | undefined>
  log(line: string): void
}) {
  const activities = new Map<string, NetworkActivity>()
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
  const shell = (directory: string, sessionID: string, shellID: string) => parseNetworkActivity({ kind: "shell", session: { generation: generation ?? 0, directory, sessionID }, shellID })
  return {
    receive(message: NetworkOutbound) {
      if (message.type === "codepuppy.network.attached") {
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
      return false
    },
    async run(directory: string, tool: string, context: Record<string, unknown>, execute: () => Promise<unknown>) {
      const activity = parseNetworkActivity({ kind: "tool", invocationID: randomUUID(), ref: { generation: generation ?? 0, directory, sessionID: context.sessionID, messageID: context.messageID, callID: context.id }, tool })
      if (!activity) return execute()
      await update("enter", activity)
      try {
        const result = await execute()
        const metadata = result && typeof result === "object" && "metadata" in result ? result.metadata as { status?: unknown; shellID?: unknown } : undefined
        if (metadata?.status === "running" && typeof metadata.shellID === "string") {
          const running = shell(directory, activitySession(activity).sessionID, metadata.shellID)
          if (running && !endedShells.has(metadata.shellID)) await update("enter", running)
        }
        return result
      } finally {
        await update("leave", activity)
      }
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
