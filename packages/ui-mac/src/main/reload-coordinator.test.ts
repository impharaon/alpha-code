// REQ-234 `#1529`(基线 §2.6):main 是重载的请求方与记录方 —— generation 记录、sidecar ready 时重发、报告决定「待重载」原因。
import { describe, expect, test } from "bun:test"
import type { ReloadRequestMessage } from "./codepuppy-sidecar-messages"
import { createReloadCoordinator } from "./reload-coordinator"

function setup() {
  const logs: string[] = []
  let changes = 0
  const coordinator = createReloadCoordinator({ log: (line) => logs.push(line), onChange: () => changes++, now: () => 1_000 })
  const sent: ReloadRequestMessage[] = []
  return { coordinator, sent, logs, changes: () => changes, post: (message: ReloadRequestMessage) => void sent.push(message) }
}

describe("reload-coordinator", () => {
  test("sidecar 连着:请求立刻发出,generation 单调递增,items/reason/force 原样上线", () => {
    const { coordinator, sent, post, changes } = setup()
    coordinator.attach(post)
    expect(coordinator.request({ scope: "global", items: [{ id: "skill:writer", scope: "global" }], reason: "installed skill writer" })).toEqual({
      generation: 1,
    })
    expect(coordinator.request({ scope: { directory: "/p" }, items: [], reason: "user: reload now", force: true })).toEqual({ generation: 2 })
    expect(sent).toEqual([
      { type: "codepuppy.reload.request", generation: 1, scope: "global", items: [{ id: "skill:writer", scope: "global" }], reason: "installed skill writer" },
      { type: "codepuppy.reload.request", generation: 2, scope: { directory: "/p" }, items: [], reason: "user: reload now", force: true },
    ])
    expect(changes()).toBe(3)
  })

  test("sidecar 不在:只记不发;ready 时按序重发全部在途,已 reloaded 的不再重发", () => {
    const { coordinator, sent, post } = setup()
    coordinator.request({ scope: "global", items: [], reason: "a" })
    coordinator.request({ scope: { directory: "/p" }, items: [], reason: "b" })
    expect(sent).toEqual([])
    expect(coordinator.pendingFor("/p")).toEqual({ code: "reload-waiting", detail: "engine not running" })
    coordinator.attach(post)
    expect(sent.map((m) => m.generation)).toEqual([1, 2])
    coordinator.receiveReport({ type: "codepuppy.reload.report", generation: 2, scope: { directory: "/p" }, outcome: "reloaded", directories: ["/p"] })
    const second: ReloadRequestMessage[] = []
    coordinator.attach((m) => void second.push(m))
    expect(second.map((m) => m.generation)).toEqual([1])
  })

  test("原因:无报告 ⇒ waiting(queued);waiting 报告带细节;failed ⇒ reload-failed;覆盖按目录", () => {
    const { coordinator, post } = setup()
    coordinator.attach(post)
    expect(coordinator.pendingFor("/p")).toBeUndefined()
    coordinator.request({ scope: { directory: "/p" }, items: [], reason: "x" })
    expect(coordinator.pendingFor("/p")).toEqual({ code: "reload-waiting", detail: "queued" })
    expect(coordinator.pendingFor("/q")).toBeUndefined()
    coordinator.receiveReport({ type: "codepuppy.reload.report", generation: 1, scope: { directory: "/p" }, outcome: "waiting", directories: ["/p"], error: "2 session(s) busy" })
    expect(coordinator.pendingFor("/p")).toEqual({ code: "reload-waiting", detail: "2 session(s) busy" })
    coordinator.receiveReport({ type: "codepuppy.reload.report", generation: 1, scope: { directory: "/p" }, outcome: "failed", directories: ["/p"], error: "dispose refused" })
    expect(coordinator.pendingFor("/p")).toEqual({ code: "reload-failed", detail: "dispose refused" })
    coordinator.request({ scope: "global", items: [], reason: "y" })
    expect(coordinator.pendingFor("/q")).toEqual({ code: "reload-waiting", detail: "queued" })
  })

  test("一次 global reloaded 让它之前的在途请求(含失败的目录请求)一并退场;之后的不受影响", () => {
    const { coordinator, post } = setup()
    coordinator.attach(post)
    coordinator.request({ scope: { directory: "/p" }, items: [], reason: "a" })
    coordinator.receiveReport({ type: "codepuppy.reload.report", generation: 1, scope: { directory: "/p" }, outcome: "failed", directories: ["/p"], error: "boom" })
    coordinator.request({ scope: "global", items: [], reason: "b" })
    coordinator.request({ scope: { directory: "/q" }, items: [], reason: "c" })
    coordinator.receiveReport({ type: "codepuppy.reload.report", generation: 2, scope: "global", outcome: "reloaded", directories: ["/p", "/q"] })
    expect(coordinator.pendingFor("/p")).toBeUndefined()
    expect(coordinator.pendingFor("/q")).toEqual({ code: "reload-waiting", detail: "queued" })
  })

  test("目录 reloaded 不让同时在途的 global 请求退场", () => {
    const { coordinator, post } = setup()
    coordinator.attach(post)
    coordinator.request({ scope: "global", items: [], reason: "a" })
    coordinator.request({ scope: { directory: "/p" }, items: [], reason: "b" })
    coordinator.receiveReport({ type: "codepuppy.reload.report", generation: 2, scope: { directory: "/p" }, outcome: "reloaded", directories: ["/p"] })
    expect(coordinator.pendingFor("/q")).toEqual({ code: "reload-waiting", detail: "queued" })
  })

  test("sidecar 退出:已收到的 waiting/failed 作废、原因改说引擎没在跑;晚到的旧连接断开不影响新连接", () => {
    const { coordinator, post } = setup()
    const detachOld = coordinator.attach(post)
    coordinator.request({ scope: "global", items: [], reason: "a" })
    coordinator.receiveReport({ type: "codepuppy.reload.report", generation: 1, scope: "global", outcome: "failed", directories: [], error: "x" })
    detachOld("sidecar exited with code 1")
    expect(coordinator.pendingFor("/p")).toEqual({ code: "reload-waiting", detail: "sidecar exited with code 1" })
    const fresh: ReloadRequestMessage[] = []
    coordinator.attach((m) => void fresh.push(m))
    detachOld("late exit of the previous sidecar")
    expect(coordinator.pendingFor("/p")).toEqual({ code: "reload-waiting", detail: "queued" })
    expect(fresh.map((m) => m.generation)).toEqual([1])
  })

  test("未知 generation 的报告只记一行,不改任何状态", () => {
    const { coordinator, post, logs } = setup()
    coordinator.attach(post)
    coordinator.request({ scope: "global", items: [], reason: "a" })
    coordinator.receiveReport({ type: "codepuppy.reload.report", generation: 99, scope: "global", outcome: "reloaded", directories: [] })
    expect(coordinator.pendingFor("/p")).toEqual({ code: "reload-waiting", detail: "queued" })
    expect(logs.some((line) => line.includes("unknown generation 99"))).toBe(true)
  })
})

// Existing ext scheduler is the only busy/idle authority; main only completes the full generation.
// `#1667`(#1665 L3 交回):ext 的调度器在 OpenCode 2 上只问一次**进程级**的 `GET /api/session/active`、只打一次
// `POST /api/location/reload`(重建全部已加载的 Location),经 sidecar 发布的进程内 fetch 进引擎 —— 下面的引擎桩只回这两条路由,
// 别的路由一律 404(调度器若改打别的路由,这里会以「查不到 ⇒ 零重载」红掉,而不是假绿)。
type EngineStub = { busy: boolean; reloads: number; reload?: () => Response }
function engineStub(state: EngineStub) {
  return async (request: Request) => {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/api/session/active")
      return Response.json({ data: state.busy ? { ses_1: { type: "running" } } : {} })
    if (request.method === "POST" && url.pathname === "/api/location/reload") {
      state.reloads++
      return state.reload?.() ?? new Response(null, { status: 204 })
    }
    return new Response("not found", { status: 404 })
  }
}

test("#1646 AC1 waits for all instances to be idle, then keeps pending until connector generation is ready", async () => {
  const { createReloadScheduler } = await import("../../../ext/src/reload-scheduler")
  const engine: EngineStub = { busy: true, reloads: 0 }
  let refreshes = 0
  let finish!: (ok: boolean) => void
  const coordinator = createReloadCoordinator({ log: () => {}, onChange: () => {}, restartConnectors: () => {
    refreshes++
    return new Promise<boolean>((resolve) => { finish = resolve })
  } })
  const scheduler = createReloadScheduler({
    engine: () => engineStub(engine),
    log: () => {},
    error: () => {},
    report: (report) => coordinator.receiveReport({ type: "codepuppy.reload.report", ...report }),
  })
  for (const dir of ["/current", "/other"]) scheduler.register(dir, {})
  coordinator.attach((request) => scheduler.request(request))
  coordinator.request({ scope: "global", items: [{ id: "mcp:codepuppy-pdf", scope: "global" }], reason: "set mcp codepuppy-pdf disabled", connectorChange: true })
  await scheduler.settled()
  expect([engine.reloads, refreshes]).toEqual([0, 0])
  expect(coordinator.pendingFor("/current")?.code).toBe("reload-waiting")
  engine.busy = false
  scheduler.poke()
  await scheduler.settled()
  expect([engine.reloads, refreshes]).toEqual([1, 1])
  expect(coordinator.pendingFor("/current")?.code).toBe("reload-waiting")
  const replay: unknown[] = []
  coordinator.attach((request) => replay.push(request))
  expect(replay).toEqual([])
  finish(true)
  for (let n = 0; n < 8; n++) await Promise.resolve()
  expect(coordinator.pendingFor("/current")).toBeUndefined()
})

test("#1646 AC2 reload-now forces a queued connector change and a failed generation remains retryable", async () => {
  const { createReloadScheduler } = await import("../../../ext/src/reload-scheduler")
  const engine: EngineStub = { busy: true, reloads: 0 }
  let refreshes = 0
  let succeeds = false
  const coordinator = createReloadCoordinator({ log: () => {}, onChange: () => {}, restartConnectors: async () => { refreshes++; return succeeds } })
  const scheduler = createReloadScheduler({
    engine: () => engineStub(engine),
    log: () => {},
    error: () => {},
    report: (report) => coordinator.receiveReport({ type: "codepuppy.reload.report", ...report }),
  })
  scheduler.register("/current", {})
  coordinator.attach((request) => scheduler.request(request))
  coordinator.request({ scope: "global", items: [], reason: "enable PDF", connectorChange: true })
  await scheduler.settled()
  expect([engine.reloads, refreshes]).toEqual([0, 0])
  coordinator.request({ scope: "global", items: [], reason: "user: reload now", force: true })
  await scheduler.settled()
  for (let n = 0; n < 8; n++) await Promise.resolve()
  expect([engine.reloads, refreshes]).toEqual([1, 1])
  expect(coordinator.pendingFor("/current")?.code).toBe("reload-failed")
  succeeds = true
  coordinator.request({ scope: "global", items: [], reason: "user: reload now", force: true })
  await scheduler.settled()
  for (let n = 0; n < 8; n++) await Promise.resolve()
  expect([engine.reloads, refreshes]).toEqual([2, 2])
  expect(coordinator.pendingFor("/current")).toBeUndefined()
})
