import { expect, test } from "bun:test"
import { createNetworkEgressFeed } from "./network-egress"
import type { EgressApproval, EgressChange, NetworkEgressApi, Result } from "../../shared/network-egress-wire"

test("先订阅再拉取；读取期间的失效重拉，销毁后的旧结果不进入其它会话", async () => {
  let listener: ((event: EgressChange) => void) | undefined
  let unsubscribed = false
  const pending: Array<(result: Result<EgressApproval[]>) => void> = []
  const api: NetworkEgressApi = {
    subscribe: (callback) => { listener = callback; return () => { unsubscribed = true } },
    listApprovals: () => { expect(listener).toBeFunction(); return new Promise((resolve) => { pending.push(resolve) }) },
    setTier: async () => ({ ok: true, value: { revision: 1 } }), decide: async () => ({ ok: false, code: "not-found" }),
    settings: async () => ({ ok: true, value: { available: false } }), revoke: async () => ({ ok: false, code: "unavailable" }),
  }
  const feed = createNetworkEgressFeed(api, { generation: 1, sessionID: "ses_a", directory: "/project" })
  listener!({ revision: 1, kind: "approvals" })
  pending.shift()!({ ok: true, value: [] })
  await Promise.resolve()
  expect(pending).toHaveLength(1)
  expect(feed.state.ready).toBe(false)
  pending.shift()!({ ok: true, value: [] })
  await Promise.resolve()
  expect(feed.state.ready).toBe(true)
  listener!({ revision: 2, kind: "approvals" })
  feed.dispose()
  pending.shift()!({ ok: false, code: "unavailable" })
  await Promise.resolve()
  expect(unsubscribed).toBe(true)
  expect(feed.state.failed).toBe(false)
})
