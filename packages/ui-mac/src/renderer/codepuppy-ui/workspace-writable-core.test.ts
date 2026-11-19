import { expect, test } from "bun:test"
import type { WorkspaceWriteProbeRequest, WorkspaceWriteProbeResult } from "../../preload/types"
import { createWorkspaceWritableTracker } from "./workspace-writable-core"

const on = (directory = "/B", server = "sidecar", generation = 1, sandbox = true) => ({ generation, server, directory, sandbox })
const deferred = () => {
  const calls: WorkspaceWriteProbeRequest[] = []
  const replies: Array<{ resolve: (result: WorkspaceWriteProbeResult) => void; reject: (error: Error) => void }> = []
  const probe = (input: WorkspaceWriteProbeRequest) => {
    calls.push(input)
    return new Promise<WorkspaceWriteProbeResult>((resolve, reject) => { replies.push({ resolve, reject }) })
  }
  const answer = async (index: number, result: WorkspaceWriteProbeResult) => { replies[index]!.resolve(result); await Promise.resolve(); await Promise.resolve() }
  return { calls, replies, probe, answer }
}
const denied: WorkspaceWriteProbeResult = { outcome: "denied", grant: "ineligible", reason: "not-opened-by-you" }
const writable: WorkspaceWriteProbeResult = { outcome: "writable", grant: "granted" }

test("probe consumes the exact server/directory, once per generation; pending and writable have no marker", async () => {
  const fake = deferred()
  const tracker = createWorkspaceWritableTracker(fake.probe)
  tracker.observe(on())
  tracker.observe(on())
  expect(fake.calls).toEqual([{ server: "sidecar", directory: "/B" }])
  expect(tracker.answer(on())).toBe("pending")
  expect(tracker.readonly(on())).toBe(false)
  await fake.answer(0, writable)
  expect(tracker.answer(on())).toBe("writable")
  expect(tracker.readonly(on())).toBe(false)
})

test("cache separates servers and generations even for an identical directory", async () => {
  const fake = deferred()
  const tracker = createWorkspaceWritableTracker(fake.probe)
  for (const observation of [on(), on("/B", "remote"), on("/B", "sidecar", 2)]) tracker.observe(observation)
  expect(fake.calls).toEqual([{ server: "sidecar", directory: "/B" }, { server: "remote", directory: "/B" }, { server: "sidecar", directory: "/B" }])
  await fake.answer(0, denied)
  await fake.answer(1, { outcome: "unknown", grant: "not-local" })
  await fake.answer(2, writable)
  expect(tracker.readonly(on())).toBe(true)
  expect(tracker.readonly(on("/B", "remote"))).toBe(false)
  expect(tracker.readonly(on("/B", "sidecar", 2))).toBe(false)
})

test("the single marker predicate requires a known reason and a non-writable outcome", async () => {
  const fake = deferred()
  const tracker = createWorkspaceWritableTracker(fake.probe)
  const results: WorkspaceWriteProbeResult[] = [denied, { outcome: "unknown", grant: "failed", reason: "grant-failed" }, { outcome: "denied", grant: "granted" }, { outcome: "unknown", grant: "no-fence" }, { ...denied, outcome: "writable" }]
  for (const [i, result] of results.entries()) {
    tracker.observe(on(`/B${i}`))
    await fake.answer(i, result)
    expect(tracker.readonly(on(`/B${i}`))).toBe(i < 2)
    expect(tracker.result(on(`/B${i}`))).toEqual(result)
  }
})

test("absent sandbox/generation/server/directory never probes", () => {
  const fake = deferred()
  const tracker = createWorkspaceWritableTracker(fake.probe)
  for (const observation of [{ ...on(), generation: undefined }, { ...on(), server: undefined }, { ...on(), directory: undefined }, on("", "sidecar"), on("/B", "", 1), on("/B", "sidecar", 1, false)]) {
    tracker.observe(observation)
    expect(tracker.answer(observation)).toBe("unknown")
    expect(tracker.readonly(observation)).toBe(false)
  }
  expect(fake.calls).toEqual([])
})

test("eligibility notification evicts a denial in the same generation and a fresh observation asks immediately", async () => {
  const fake = deferred()
  const tracker = createWorkspaceWritableTracker(fake.probe)
  tracker.observe(on())
  await fake.answer(0, denied)
  tracker.invalidate({ server: "sidecar", directory: "/B" })
  tracker.observe(on())
  expect(fake.calls).toHaveLength(2)
  await fake.answer(1, writable)
  expect(tracker.readonly(on())).toBe(false)
})

test("late pending answer cannot overwrite the new request after notification", async () => {
  const fake = deferred()
  const tracker = createWorkspaceWritableTracker(fake.probe)
  tracker.observe(on())
  tracker.invalidate({ server: "sidecar", directory: "/B" })
  tracker.observe(on())
  await fake.answer(1, writable)
  await fake.answer(0, denied)
  expect(tracker.result(on())).toEqual(writable)
})

test("notification is scoped to its server/directory; reset rejects even a late reply for the same key", async () => {
  const fake = deferred()
  const tracker = createWorkspaceWritableTracker(fake.probe)
  tracker.observe(on())
  tracker.invalidate({ server: "remote", directory: "/B" })
  tracker.observe(on())
  expect(fake.calls).toHaveLength(1)
  tracker.reset()
  tracker.observe(on())
  await fake.answer(0, denied)
  expect(tracker.answer(on())).toBe("pending")
  await fake.answer(1, writable)
  expect(tracker.result(on())).toEqual(writable)
})

test("IPC rejection is grant-failed even when its write outcome is unknown; notification permits recovery", async () => {
  const fake = deferred()
  const tracker = createWorkspaceWritableTracker(fake.probe)
  tracker.observe(on())
  fake.replies[0]!.reject(new Error("bridge down"))
  await Promise.resolve()
  await Promise.resolve()
  expect(tracker.result(on())).toEqual({ outcome: "unknown", grant: "failed", reason: "grant-failed" })
  expect(tracker.readonly(on())).toBe(true)
  tracker.invalidate({ server: "sidecar", directory: "/B" })
  tracker.observe(on())
  await fake.answer(1, writable)
  expect(tracker.result(on())).toEqual(writable)
})

test("synchronous probe throw is also grant-failed and never escapes to a host", () => {
  const tracker = createWorkspaceWritableTracker(() => { throw new Error("bridge down") })
  expect(() => tracker.observe(on())).not.toThrow()
  expect(tracker.result(on())?.reason).toBe("grant-failed")
})

test("invalid replies cannot crash or manufacture a writable answer", async () => {
  const tracker = createWorkspaceWritableTracker(async () => ({ outcome: "yes" }) as unknown as WorkspaceWriteProbeResult)
  tracker.observe(on())
  await Promise.resolve()
  expect(tracker.answer(on())).toBe("unknown")
  expect(tracker.result(on())?.grant).toBe("failed")
})

test("first work waits for the exact current entry to settle", async () => {
  const fake = deferred()
  const tracker = createWorkspaceWritableTracker(fake.probe)
  let started = false
  const work = tracker.whenSettled(on()).then(() => { started = true })
  await Promise.resolve()
  expect(started).toBe(false)
  expect(fake.calls).toEqual([{ server: "sidecar", directory: "/B" }])
  await fake.answer(0, writable)
  await work
  expect(started).toBe(true)
})

test("first work has a 1 second upper bound, without turning a pending answer into a final grant", async () => {
  const tracker = createWorkspaceWritableTracker(() => new Promise(() => {}))
  const start = performance.now()
  await tracker.whenSettled(on())
  expect(performance.now() - start).toBeGreaterThanOrEqual(950)
  expect(performance.now() - start).toBeLessThan(1800)
  expect(tracker.answer(on())).toBe("pending")
})

test("notification during first-work wait follows the replacement request; the evicted reply cannot release work", async () => {
  const fake = deferred()
  const tracker = createWorkspaceWritableTracker(fake.probe)
  let started = false
  const work = tracker.whenSettled(on()).then(() => { started = true })
  tracker.invalidate({ server: "sidecar", directory: "/B" })
  await Promise.resolve()
  await Promise.resolve()
  expect(fake.calls).toHaveLength(2)
  await fake.answer(0, denied)
  expect(started).toBe(false)
  await fake.answer(1, writable)
  await work
  expect(started).toBe(true)
})

test("no fence or identity waits for nothing; remote status settles without any local assumption", async () => {
  const fake = deferred()
  const tracker = createWorkspaceWritableTracker(fake.probe)
  await tracker.whenSettled(on("/B", "sidecar", 1, false))
  await tracker.whenSettled({ ...on(), server: undefined })
  expect(fake.calls).toEqual([])
  const remote = tracker.whenSettled(on("/B", "remote"))
  await fake.answer(0, { outcome: "unknown", grant: "not-local" })
  await remote
  expect(tracker.result(on("/B", "remote"))).toEqual({ outcome: "unknown", grant: "not-local" })
})
