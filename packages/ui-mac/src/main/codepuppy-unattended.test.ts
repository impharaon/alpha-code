import { afterEach, expect, test, vi } from "bun:test"
import { createUnattendedRuns } from "./codepuppy-unattended"
import { buildUnattendedAck, type UnattendedLive } from "./codepuppy-sidecar-messages"

afterEach(() => vi.useRealTimers())

test("登记只认当次 seq 与 nonce,注销立即推完整名单", async () => {
  const runs = createUnattendedRuns()
  const wire: UnattendedLive[] = []
  runs.attach((message) => wire.push(message))
  let ready = false
  const pending = runs.register("ses_a", { agent: "codepuppy-automation-standard", promptID: "msg_a" }).then((value) => { ready = value; return value })
  const live = wire.at(-1)!
  runs.acknowledge(buildUnattendedAck(live.seq, "wrong"))
  runs.acknowledge(buildUnattendedAck(live.seq - 1, live.nonce))
  await Promise.resolve()
  expect(ready).toBe(false)
  runs.acknowledge(buildUnattendedAck(live.seq, live.nonce))
  expect(await pending).toBe(true)
  expect(live.sessions).toEqual([{ sessionID: "ses_a", agent: "codepuppy-automation-standard", promptID: "msg_a" }])
  runs.unregister("ses_a")
  expect(wire.at(-1)!.sessions).toEqual([])
})

test("20 秒虚拟握手期限,断线/无通道/发送失败都不开始运行", async () => {
  vi.useFakeTimers()
  const runs = createUnattendedRuns()
  expect(await runs.register("ses_a", { promptID: "msg_a" })).toBe(false)
  const detach = runs.attach(() => {})
  const waiting = runs.register("ses_b", { promptID: "msg_b" })
  vi.advanceTimersByTime(20_000)
  expect(await waiting).toBe(false)
  const interrupted = runs.register("ses_c", { promptID: "msg_c" })
  detach("exited")
  expect(await interrupted).toBe(false)
  runs.attach(() => { throw new Error("closed") })
  expect(await runs.register("ses_d", { promptID: "msg_d" })).toBe(false)
})

test("新连接重推名单,旧连接晚到的断开与回执不影响新登记", async () => {
  const runs = createUnattendedRuns()
  const wire: UnattendedLive[] = []
  const oldDetach = runs.attach((message) => wire.push(message))
  const old = runs.register("ses_a", { promptID: "msg_a" })
  const oldLive = wire.at(-1)!
  const detach = runs.attach((message) => wire.push(message))
  expect(await old).toBe(false)
  expect(wire.at(-1)!.sessions).toEqual(oldLive.sessions)
  oldDetach("old exited")
  const pending = runs.register("ses_b", { promptID: "msg_b" })
  const live = wire.at(-1)!
  runs.acknowledge(buildUnattendedAck(oldLive.seq, oldLive.nonce))
  runs.acknowledge(buildUnattendedAck(live.seq, live.nonce))
  expect(await pending).toBe(true)
  detach("done")
})

test("同步回执不会丢,外部 abort 结束在途等待", async () => {
  const runs = createUnattendedRuns()
  runs.attach((message) => runs.acknowledge(buildUnattendedAck(message.seq, message.nonce)))
  expect(await runs.register("ses_a", { promptID: "msg_a" })).toBe(true)
  runs.attach(() => {})
  const controller = new AbortController()
  const pending = runs.register("ses_b", { promptID: "msg_b" }, controller.signal)
  controller.abort()
  expect(await pending).toBe(false)
})
