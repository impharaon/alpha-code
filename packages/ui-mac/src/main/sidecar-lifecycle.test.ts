import { describe, expect, test } from "bun:test"
import { initialSelfHealState, noteSpawn, SELF_HEAL_MAX_ATTEMPTS } from "./sidecar-self-heal"
import type { SidecarGenerationState } from "../preload/types"
import {
  createDeferredRespawn,
  armRespawnGenerationTerminal,
  createSidecarRespawnQueue,
  planUnhealthyForkRetry,
  SIDECAR_RESPAWN_TRIGGERS,
  type SidecarRespawnTrigger,
} from "./sidecar-lifecycle"

// REQ-236 §2.6 AC6(`#1562`):引擎重启原因是一张白名单,每一项都是具名原因;令牌续期不在里面。
describe("sidecar respawn triggers", () => {
  test("the trigger union is exactly the §2.6 whitelist, and token renewal is not a restart reason", () => {
    expect([...SIDECAR_RESPAWN_TRIGGERS]).toEqual([
      "crash-self-heal",
      "log-runaway",
      "catalog-watchdog",
      "identity-change",
      "provider-change",
      "byok-change",
      "connector-change",
      "credential-change",
      "retry-engine",
    ])
    expect(SIDECAR_RESPAWN_TRIGGERS.filter((trigger) => /token|renew|rotation|structural/.test(trigger))).toEqual([])
  })

  test("coalesced requests run one follow-up that carries the first queued named trigger", async () => {
    let release!: () => void
    const first = new Promise<void>((resolve) => {
      release = resolve
    })
    const runs: SidecarRespawnTrigger[] = []
    const request = createSidecarRespawnQueue(async (trigger) => {
      runs.push(trigger)
      if (runs.length === 1) await first
      return true
    })

    const active = request("byok-change")
    request("credential-change")
    request("provider-change")
    release()
    await active
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runs).toEqual(["byok-change", "credential-change"])
  })
})

// REQ-236 `#1562`:credential-change 的 fork 没健康 ⇒ 走崩溃自愈同一阶梯重试,有界;其它原因、或崩溃路径已排了定时器 ⇒ 不排。
describe("unhealthy credential-change fork retry", () => {
  test("only credential-change retries, and never on top of an armed self-heal timer", () => {
    const selfHeal = noteSpawn(initialSelfHealState(), 1_000)
    const others = SIDECAR_RESPAWN_TRIGGERS.filter((trigger) => trigger !== "credential-change")
    expect(others.map((trigger) => planUnhealthyForkRetry({ trigger, timerArmed: false, selfHeal, now: 2_000 }))).toEqual(
      others.map(() => undefined),
    )
    expect(planUnhealthyForkRetry({ trigger: "credential-change", timerArmed: true, selfHeal, now: 2_000 })).toBeUndefined()
    expect(planUnhealthyForkRetry({ trigger: "credential-change", timerArmed: false, selfHeal, now: 2_000 })).toEqual({
      action: "heal",
      delayMs: 1_000,
      state: { attempts: 1, lastSpawnAt: 1_000 },
    })
  })

  test("consecutive unhealthy forks climb the self-heal ladder and give up after its bound", () => {
    let selfHeal = initialSelfHealState()
    const delays: number[] = []
    for (let now = 1_000; ; now += 1_000) {
      selfHeal = noteSpawn(selfHeal, now)
      const plan = planUnhealthyForkRetry({ trigger: "credential-change", timerArmed: false, selfHeal, now: now + 500 })!
      selfHeal = plan.state
      if (plan.action === "give-up") break
      delays.push(plan.delayMs)
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000])
    expect(delays).toHaveLength(SELF_HEAL_MAX_ATTEMPTS)
  })
})

// #600 B1:respawn 一旦发出 recovering,终态必须可达。旧接线只在健康通过时发 ready ——
// spawn reject 与健康失败/超时都只 return false,generation 永久停在 recovering。
type SpawnResult = { health: { wait: Promise<unknown> } }

describe("respawn generation terminal", () => {
  const collect = () => {
    const published: SidecarGenerationState[] = []
    const errors: string[] = []
    return {
      published,
      errors,
      publish: (state: SidecarGenerationState) => published.push(state),
      logError: (message: string) => errors.push(message),
    }
  }

  test("a spawn that rejects before the health handshake publishes exactly one failed", async () => {
    const sink = collect()
    const settled = await armRespawnGenerationTerminal({
      generation: 7,
      spawning: Promise.reject(new Error("fork failed")),
      timeoutMs: 50,
      publish: sink.publish,
      logError: sink.logError,
    })

    expect(settled).toBe(false)
    expect(sink.published).toEqual([{ status: "failed", generation: 7, reason: "structural" }])
    expect(sink.errors).toHaveLength(1)
  })

  test("a rejected health handshake publishes exactly one failed", async () => {
    const sink = collect()
    const settled = await armRespawnGenerationTerminal({
      generation: 8,
      spawning: Promise.resolve({ health: { wait: Promise.reject(new Error("unhealthy")) } }),
      timeoutMs: 5_000,
      publish: sink.publish,
      logError: sink.logError,
    })

    expect(settled).toBe(false)
    expect(sink.published).toEqual([{ status: "failed", generation: 8, reason: "structural" }])
  })

  test("a health handshake that never settles times out into exactly one failed", async () => {
    const sink = collect()
    const settled = await armRespawnGenerationTerminal({
      generation: 9,
      spawning: Promise.resolve({ health: { wait: new Promise(() => {}) } }),
      timeoutMs: 10,
      publish: sink.publish,
      logError: sink.logError,
    })

    expect(settled).toBe(false)
    expect(sink.published).toEqual([{ status: "failed", generation: 9, reason: "structural" }])
  })

  // R1 Major3:终态生产者常常无人 await(spawn reject 路径)。publish 抛出时它若变成
  // rejected promise,就是 main 进程的 unhandled rejection。
  const throwingPublishCases: Array<[string, () => Promise<SpawnResult>]> = [
    ["a spawn rejection", () => Promise.reject(new Error("fork failed"))],
    ["a health rejection", () => Promise.resolve({ health: { wait: Promise.reject(new Error("unhealthy")) } })],
    ["a healthy handshake", () => Promise.resolve({ health: { wait: Promise.resolve("ok") } })],
  ]
  test.each(throwingPublishCases)("a throwing publish on %s still settles instead of rejecting", async (_label, spawning) => {
    const errors: string[] = []
    const settled = await armRespawnGenerationTerminal({
      generation: 11,
      spawning: spawning(),
      timeoutMs: 50,
      publish: () => {
        throw new Error("renderer gone")
      },
      logError: (message) => errors.push(message),
    })

    expect(typeof settled).toBe("boolean")
    expect(errors.some((message) => message.includes("terminal publish failed"))).toBe(true)
  })

  test("a healthy handshake publishes exactly one ready and never a failed", async () => {
    const sink = collect()
    const settled = await armRespawnGenerationTerminal({
      generation: 10,
      spawning: Promise.resolve({ health: { wait: Promise.resolve("ok") } }),
      timeoutMs: 10,
      publish: sink.publish,
      logError: sink.logError,
    })

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(settled).toBe(true)
    expect(sink.published).toEqual([{ status: "ready", generation: 10, reason: "structural" }])
    expect(sink.errors).toEqual([])
  })

  // REQ-159 `#1322`:respawn 半场与 boot 同构 —— 围栏字段只随引擎在线的终态上车。
  test("#1322 respawn 终态:spawning 带 fence:applied ⇒ ready 带 fence;健康失败的 failed 不带", async () => {
    const ready = collect()
    await armRespawnGenerationTerminal({
      generation: 21,
      spawning: Promise.resolve({ health: { wait: Promise.resolve("ok") }, fence: "applied" as const }),
      timeoutMs: 10,
      publish: ready.publish,
      logError: ready.logError,
    })
    expect(ready.published).toEqual([{ status: "ready", generation: 21, reason: "structural", fence: "applied" }])

    const failed = collect()
    await armRespawnGenerationTerminal({
      generation: 22,
      spawning: Promise.resolve({ health: { wait: Promise.reject(new Error("dead")) }, fence: "applied" as const }),
      timeoutMs: 10,
      publish: failed.publish,
      logError: failed.logError,
    })
    expect(failed.published).toEqual([{ status: "failed", generation: 22, reason: "structural" }])
    expect("fence" in failed.published[0]!).toBe(false)
  })

  // #613 反向闸门(respawn 半场):健康通过但注入失败 → 终态必须是 injection-failed 而非 ready,
  // 且 main 侧 error 出声;返回值保持「健康线通过」(reload/token 记账语义不变,sidecar 真实可达)。
  // 把 settle 的 injectionFailure 分支删掉(回退成一律 ready),本用例转红。
  test("#613 a healthy handshake with an injection failure publishes exactly one injection-failed", async () => {
    const sink = collect()
    const settled = await armRespawnGenerationTerminal({
      generation: 12,
      spawning: Promise.resolve({
        health: { wait: Promise.resolve("ok") },
        injectionFailure: { message: "ENOTDIR: mkdir userdata" },
      }),
      timeoutMs: 10,
      publish: sink.publish,
      logError: sink.logError,
    })

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(settled).toBe(true)
    expect(sink.published).toEqual([{ status: "injection-failed", generation: 12, reason: "structural" }])
    expect(sink.errors.some((line) => line.includes("alpha config injection failed") && line.includes("ENOTDIR"))).toBe(
      true,
    )
  })
})


// SPEC-stored-credentials-fence §4.2(② 审查第 1 条):引擎拉取凭据表超时 / 主进程读不出表时请求的 credential-change 重启,在 boot 那一代
// main 的重启队列还没建好时不能丢 —— 记下,队列建好后补发一次(同 pendingAuthRespawn)。
describe("createDeferredRespawn", () => {
  test("队列建好之前的请求记下、建好时补发恰好一次;之后的请求直接转给队列", () => {
    const deferred = createDeferredRespawn()
    deferred.request("credential-change")
    deferred.request("credential-change")
    const sent: string[] = []
    deferred.attach((trigger) => void sent.push(trigger))
    expect(sent).toEqual(["credential-change"])
    deferred.request("credential-change")
    expect(sent).toEqual(["credential-change", "credential-change"])
  })
  test("没有请求过 ⇒ 建好时什么都不补", () => {
    const deferred = createDeferredRespawn()
    const sent: string[] = []
    deferred.attach((trigger) => void sent.push(trigger))
    expect(sent).toEqual([])
  })
})
