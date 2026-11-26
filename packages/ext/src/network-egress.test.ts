import { expect, test } from "bun:test"
import { createHubBridge, type HubPort } from "./hub-bridge"
import { createNetworkEgressActivity } from "../../ui-mac/src/main/network-egress-activity"
import type { NetworkOutbound } from "../../ui-mac/src/shared/network-egress-wire"

function connected() {
  const activity = createNetworkEgressActivity()
  const listeners: Array<(event: { data: unknown }) => void> = []
  const messages: NetworkOutbound[] = []
  const post = (message: NetworkOutbound) => { messages.push(message); listeners.forEach((listener) => listener({ data: message })) }
  const port: HubPort = { on: (_event, listener) => { listeners.push(listener) }, postMessage: (message) => { activity.receive(message, post) } }
  const bridge = createHubBridge(port, { timeoutMs: 50, log: () => {} })
  activity.attach(1, post, { session: async () => ({}), shell: async () => true })
  return { activity, bridge, messages }
}

test("真实执行外层先收到 enter 应答，finally 清取消与错误，共 callID 不互删", async () => {
  const c = connected()
  await c.bridge.network.settled()
  expect(c.activity.snapshot().complete).toBe(true)
  const context = { sessionID: "ses_a", messageID: "msg_a", id: "shared" }
  await expect(c.bridge.network.run("/project", "code", context, async () => {
    expect(c.activity.snapshot().activities).toHaveLength(1)
    await c.bridge.network.run("/project", "shell", context, async () => {
      expect(c.activity.snapshot().activities).toHaveLength(2)
      return {}
    })
    expect(c.activity.snapshot().activities).toHaveLength(1)
    throw new Error("cancelled")
  })).rejects.toThrow("cancelled")
  expect(c.activity.snapshot().activities).toEqual([])
})

test("后台 shell 在 tool leave 前登记，工具结束后仍在活动集合", async () => {
  const c = connected()
  await c.bridge.network.settled()
  await c.bridge.network.run("/project", "shell", { sessionID: "ses_a", messageID: "msg_a", id: "call" }, async () => ({ metadata: { status: "running", shellID: "sh_background" } }))
  expect(c.activity.snapshot().activities).toEqual([{ kind: "shell", session: { generation: 1, sessionID: "ses_a", directory: "/project" }, shellID: "sh_background" }])
})
