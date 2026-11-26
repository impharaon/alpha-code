import { expect, test } from "bun:test"
import { createNetworkEgressActivity } from "./network-egress-activity"
import type { NetworkActivity, NetworkInbound, NetworkOutbound } from "../shared/network-egress-wire"

test("活动快照按代次和序列恢复，共 callID 的 invocation 独立，旧 child 不能写新集合", async () => {
  const activity = createNetworkEgressActivity()
  const sent: NetworkOutbound[] = []
  const replies = new Map<number, () => void>()
  const post = (message: NetworkOutbound) => { sent.push(message); if (message.type === "codepuppy.network.activity.reply") replies.get(message.id)?.() }
  const inspection = { session: async () => ({}), shell: async () => true }
  const detach = activity.attach(1, post, inspection)
  const send = (message: NetworkInbound) => new Promise<void>((resolve) => { replies.set(message.id, resolve); activity.receive(message, post) })
  const ref = { generation: 1, sessionID: "ses_a", directory: "/project", messageID: "msg_a", callID: "same" }
  const parent: NetworkActivity = { kind: "tool", invocationID: "parent", ref, tool: "code" }
  const child: NetworkActivity = { kind: "tool", invocationID: "child", ref, tool: "shell" }
  await send({ type: "codepuppy.network.snapshot", id: 1, generation: 1, seq: 1, activities: [] })
  expect(activity.snapshot().complete).toBe(true)
  await send({ type: "codepuppy.network.activity", id: 2, seq: 2, op: "enter", activity: parent })
  await send({ type: "codepuppy.network.activity", id: 3, seq: 3, op: "enter", activity: child })
  await send({ type: "codepuppy.network.activity", id: 4, seq: 4, op: "leave", activity: child })
  expect(activity.snapshot().activities).toEqual([parent])
  await send({ type: "codepuppy.network.activity", id: 5, seq: 6, op: "leave", activity: parent })
  expect(activity.snapshot().complete).toBe(false)
  expect(sent.some((message) => message.type === "codepuppy.network.snapshot.request")).toBe(true)
  await send({ type: "codepuppy.network.snapshot", id: 6, generation: 1, seq: 7, activities: [] })
  expect(activity.snapshot()).toMatchObject({ complete: true, activities: [] })
  const newer: NetworkOutbound[] = []
  activity.attach(2, (message) => { newer.push(message) }, inspection)
  detach()
  activity.receive({ type: "codepuppy.network.snapshot", id: 7, generation: 1, seq: 8, activities: [parent] }, post)
  expect(activity.snapshot()).toMatchObject({ generation: 2, complete: false, activities: [] })
})

test("shell 终态胜过迟到 enter，可信档位绑定及祖先继承只在当前代生效", async () => {
  const activity = createNetworkEgressActivity()
  const session = { generation: 1, sessionID: "ses_a", directory: "/project" }
  const pending = new Map<number, () => void>()
  const post = (message: NetworkOutbound) => { if (message.type === "codepuppy.network.activity.reply") pending.get(message.id)?.() }
  activity.attach(1, post, { session: async (ref) => ref.sessionID === "ses_missing" ? undefined : ref.sessionID === "ses_child" ? { parentID: "ses_a" } : {}, shell: async () => true })
  const send = (message: NetworkInbound) => new Promise<void>((resolve) => { pending.set(message.id, resolve); activity.receive(message, post) })
  const shell: NetworkActivity = { kind: "shell", shellID: "sh_a", session }
  await send({ type: "codepuppy.network.snapshot", id: 1, generation: 1, seq: 1, activities: [] })
  await send({ type: "codepuppy.network.activity", id: 2, seq: 2, op: "leave", activity: shell })
  await send({ type: "codepuppy.network.activity", id: 3, seq: 3, op: "enter", activity: shell })
  expect(activity.snapshot().activities).toEqual([])
  expect(await activity.setTier(session, "allow")).toBeNumber()
  expect(await activity.tier({ ...session, sessionID: "ses_child" })).toBe("allow")
  expect(await activity.setTier({ ...session, sessionID: "ses_missing" }, "allow")).toBeUndefined()
  expect(await activity.tier({ ...session, generation: 0 })).toBe("unknown")
})
