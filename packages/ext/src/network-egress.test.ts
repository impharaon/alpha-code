import { Tool } from "../../schema/src/tool"
import { NETWORK_EGRESS_NOTE } from "./context-injection"
import { activitySession } from "../../ui-mac/src/shared/network-egress-wire"
import { expect, test } from "bun:test"
import { createHubBridge, type HubPort } from "./hub-bridge"
import { createNetworkEgressActivity } from "../../ui-mac/src/main/network-egress-activity"
import type { NetworkOutbound } from "../../ui-mac/src/shared/network-egress-wire"
import { Cause, Effect } from "effect"
import { Plugin as Plugins } from "../../core/src/plugin.ts"
import { Tool as Tools } from "../../core/src/tool.ts"
import { activate, it } from "./plugin-host.harness"
import { separatelyBundledNetworkEgress } from "./engine-runtime.harness"
import * as sourceEgress from "./network-egress"

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

test("notice 跨 leave 屏障进入失败结果，保留 metadata；终态只消费一次", async () => {
  const c = connected()
  await c.bridge.network.settled()
  const failure = new Tool.Error({ message: "fetch failed", error: new Error("ENOTFOUND"), metadata: { original: 7 } })
  let caught: unknown
  try {
    await c.bridge.network.run("/project", "webfetch", { sessionID: "ses_a", messageID: "msg_a", id: "call" }, async () => {
      const activities = c.activity.snapshot().activities
      c.activity.publish({ type: "codepuppy.network.notice", requestID: "r1", destination: { host: "outside.test", port: 443 }, state: "denied", sessions: [activitySession(activities[0]!)], activities, attribution: "unknown" })
      throw failure
    })
  } catch (error) { caught = error }
  expect(c.activity.snapshot().activities).toEqual([])
  const event = { status: "error" as const, error: caught as Tool.Error }
  expect(c.bridge.network.attachResult(event)).toBe(true)
  expect(event.error.message).toBe(`fetch failed\n\n${NETWORK_EGRESS_NOTE}`)
  expect(event.error.error).toBe(failure.error)
  expect(event.error.metadata).toEqual({ original: 7 })
  const next = { sessionID: "ses_a", system: [] }
  c.bridge.network.context("/project", next)
  expect(next.system).toEqual([])
  expect(c.bridge.network.attachResult(event)).toBe(false)
})

test("共享 callID 的调用按 invocation 关联；waiting 成功结果与后台 context，allowed 清除", async () => {
  const c = connected()
  await c.bridge.network.settled()
  const context = { sessionID: "ses_a", messageID: "msg_a", id: "shared" }
  const result = await c.bridge.network.run("/project", "code", context, async () => {
    const inner = await c.bridge.network.run("/project", "shell", context, async () => {
      const activities = c.activity.snapshot().activities.filter((item) => item.kind === "tool" && item.tool === "shell")
      c.activity.publish({ type: "codepuppy.network.notice", requestID: "r2", destination: { host: "outside.test", port: 443 }, state: "waiting", sessions: [activitySession(activities[0]!)], activities, attribution: "unknown" })
      return { content: [{ type: "text", text: "running" }], output: "original", metadata: { status: "running", shellID: "sh_2" } }
    })
    // Core copies these three fields before execute.after; the association survives it.
    const after = { status: "completed" as const, result: { ...(inner as Record<string, unknown>) } }
    expect(c.bridge.network.attachResult(after)).toBe(true)
    expect(after.result).toEqual({ content: [{ type: "text", text: "running" }, { type: "text", text: NETWORK_EGRESS_NOTE }], output: "original", metadata: { status: "running", shellID: "sh_2" } })
    return { content: "outer" }
  })
  const after = { status: "completed" as const, result: result as Record<string, unknown> }
  expect(c.bridge.network.attachResult(after)).toBe(false)
  expect(after.result).toEqual({ content: "outer" })
  const other = { sessionID: "ses_other", system: [] }
  c.bridge.network.context("/project", other)
  expect(other.system).toEqual([])
  const wake = { sessionID: "ses_a", system: [] }
  c.bridge.network.context("/project", wake)
  expect(wake.system).toEqual([{ type: "text", text: NETWORK_EGRESS_NOTE }])
  c.activity.publish({ type: "codepuppy.network.notice", requestID: "r2", destination: { host: "outside.test", port: 443 }, state: "allowed", sessions: [], activities: [], attribution: "unknown" })
  const allowed = { sessionID: "ses_a", system: [] }
  c.bridge.network.context("/project", allowed)
  expect(allowed.system).toEqual([])
})

test("普通失败不注入，允许后未交付结果与换代丢弃旧 notice", async () => {
  const c = connected()
  await c.bridge.network.settled()
  await expect(c.bridge.network.run("/project", "webfetch", { sessionID: "ses_a", messageID: "msg_a", id: "ordinary" }, async () => { throw new Error("ENOTFOUND") })).rejects.toThrow("ENOTFOUND")
  const next = { sessionID: "ses_a", system: [] }
  c.bridge.network.context("/project", next)
  expect(next.system).toEqual([])
  const result = await c.bridge.network.run("/project", "shell", { sessionID: "ses_a", messageID: "msg_a", id: "pending" }, async () => {
    const activities = c.activity.snapshot().activities
    c.activity.publish({ type: "codepuppy.network.notice", requestID: "r3", destination: { host: "outside.test", port: 443 }, state: "timed-out", sessions: [activitySession(activities[0]!)], activities, attribution: "unknown" })
    return { content: "original" }
  })
  c.activity.publish({ type: "codepuppy.network.notice", requestID: "r3", destination: { host: "outside.test", port: 443 }, state: "allowed", sessions: [], activities: [], attribution: "unknown" })
  const after = { status: "completed" as const, result: result as Record<string, unknown> }
  expect(c.bridge.network.attachResult(after)).toBe(false)
  expect(after.result).toEqual({ content: "original" })
  c.bridge.network.receive({ type: "codepuppy.network.notice", requestID: "r4", destination: { host: "outside.test", port: 443 }, state: "unavailable", sessions: [{ generation: 1, sessionID: "ses_a", directory: "/project" }], activities: [], attribution: "unknown" })
  c.bridge.network.receive({ type: "codepuppy.network.attached", generation: 2 })
  c.bridge.network.context("/project", next)
  expect(next.system).toEqual([])
})

// The shipped ext bundle carries its own Tool.Error class (scripts/build.ts, ADR-006): the engine's Promise adapter hands
// execute.after a Tool.Error of its own, never the object the ext threw. 2026-11-28 probe through the real host and adapter:
// with the bundled tracker attachResult returned false and the failure kept only "fetch failed".
for (const layout of ["source", "separately bundled"] as const)
  it.live(`${layout} ext: a failed call keeps the network notice through the engine's adapter`, () => Effect.gen(function* () {
    const module = layout === "source" ? sourceEgress : yield* Effect.promise(separatelyBundledNetworkEgress)
    let entered: unknown
    const egress = module.createNetworkEgress({
      send: async (build) => {
        const message = build(1) as { type: string; op?: string; activity?: unknown }
        if (message.type === "codepuppy.network.activity" && message.op === "enter") entered = message.activity
        return { ok: true } as never
      },
      log: () => {},
    })
    egress.receive({ type: "codepuppy.network.attached", generation: 1 } as never)
    const after: Array<{ attached: boolean; message: string; metadata: unknown }> = []
    yield* activate({
      id: `network-egress-${layout}`,
      async setup(context) {
        await context.tool.hook("execute.after", async (event) => {
          if (event.tool !== "egress_fetch" || event.status !== "error") return
          const attached = egress.attachResult(event as never)
          after.push({ attached, message: event.error.message, metadata: event.error.metadata })
        })
        await context.tool.transform((editor) => editor.add({
          name: "egress_fetch", description: "fetch", input: { type: "object", properties: {} }, options: { codemode: false },
          execute: (_input, call) => egress.run("/project", "egress_fetch", { sessionID: call.sessionID, messageID: call.messageID, id: call.id }, async () => {
            await Promise.resolve()
            egress.receive({ type: "codepuppy.network.notice", requestID: "r1", destination: { host: "outside.test", port: 443 }, state: "denied", sessions: [{ generation: 1, directory: "/project", sessionID: call.sessionID }], activities: [entered], attribution: "unknown" } as never)
            throw new Error("fetch failed")
          }) as never,
        }))
      },
    })
    yield* (yield* Plugins.Service).awaitActivation
    const snapshot = yield* (yield* Tools.Service).snapshot()
    const exit = yield* snapshot.execute({ sessionID: "ses_egress", agent: "build" as never, messageID: "msg_egress" as never, call: { type: "tool-call", id: "call_egress", name: "egress_fetch", input: {} } } as never).pipe(Effect.exit)
    expect(after).toEqual([{ attached: true, message: `fetch failed\n\n${NETWORK_EGRESS_NOTE}`, metadata: undefined }])
    // The call fails with the engine's own Tool.Error, carrying the notice and no marker left in its metadata.
    const failure = exit._tag === "Failure" ? Cause.squash(exit.cause) : undefined
    expect({ engineClass: failure instanceof Tool.Error, message: (failure as Tool.Error | undefined)?.message, metadata: (failure as Tool.Error | undefined)?.metadata }).toEqual({ engineClass: true, message: `fetch failed\n\n${NETWORK_EGRESS_NOTE}`, metadata: undefined })
  }))
