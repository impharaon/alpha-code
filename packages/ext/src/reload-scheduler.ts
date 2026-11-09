// reload-scheduler — REQ-234 `#1531`(基线 §2.6,不变量 I5):引擎重载的**唯一执行者**。
//
// 一个引擎进程一份(`#1665` I2:OpenCode 2 给每个 Location 各求值一次 ext 模块,所以它挂在 plugin.ts 的进程级单例上,
// 不靠模块缓存)。三类来源都进同一个队列:
//   ① codepuppy_reload / codepuppy_register(进程内,无 generation,不向 main 报告);
//   ② main 经 parentPort 发来的 `codepuppy.reload.request`(定制中心按钮、安装体、信任门 / 外部导入,带 generation);
//   ③ 用户在定制中心点「现在重载」= ② 带 `force`。
//
// OpenCode 2 的事实(`#1665` 开工实测,2.x CLI + 最小插件 + 本地模型桩,临时 HOME/XDG):
//   · `POST /api/location/reload` 重建**全部**已加载的 Location(不是某一个目录),并取消所有待答的审批与表单
//     (被取消的工具调用记成 `aborted: Interaction cancelled because the location shut down`);
//   · `GET /api/session/active` 是**进程级**的:列出本进程所有前台运行的会话(`{ <sessionID>: { type: "running" } }`,
//     不在里面 = 不活跃);卡在审批上的会话**在**里面。
// 所以 v1 的「按实例查、按实例 dispose」收成一条:相关实例 = 已登记的全部目录;忙闲问一次进程级的 active;重载打一次
// `location/reload`,覆盖队列里的全部请求。
//
// 决定规则(I5,语义不变):
//   · { directory } 而该目录此刻没有加载着的实例 ⇒ 下一次加载自然读到盘上的新东西 ⇒ 直接算 reloaded,不去重载。
//   · 问 active(引擎本进程的权威,不靠事件流的快照 / 重放)。**查不到(超时 / 错误 / 形状不对 / 还没有进程内引擎)
//     ⇒ 本轮零重载**,`force` 也不例外 —— 查不到不等于空闲。
//   · 有会话在跑且不是 force ⇒ 零重载,等下一次会话事件再判(重载会取消任何一个会话里开着的审批卡,所以等的是全进程)。
//   · 全部明确空闲(或 force)⇒ **再查一次**(把「查到重载」的窗口压到一次进程内往返;这一次也不许查不到)
//     ⇒ 恰好一次 `location/reload` ⇒ 向 main 逐个 generation 报 reloaded。
//   · 重载失败 ⇒ 保留队列、报 failed、下一次事件再试;连败 3 次停止自动重试(仍报最后一条 failed)。绝不降级成「可用」。
//   · 一直忙(> 5 分钟):只记一行日志,继续等 —— 不打断(约束 4);用户要立刻生效走 force。
//
// 实例登记:每个 Location 的 ext `setup` 登记 { directory, token };**只因该 setup 返回的 Cleanup 注销**,且只注销
// 自己那一份(重建时新 setup 与旧 Cleanup 的先后不定)。登记接口缺口:引擎没有「暂停会话准入」,两次查空闲与重载之间
// 仍可能有新回合被准入(基线 §2.6 登记在案,本模块不假装覆盖)。
//
// 报给 main 的 `error` 文本会原样出现在定制中心(只进 title),所以只写给人看的短句,不放异常原文与内部细节;
// 细节进本进程日志。

import type { ReloadOutcome, ReloadScope } from "../../ui-mac/src/main/codepuppy-sidecar-messages"
import type { EngineFetch } from "../../ui-mac/src/main/in-process-engine"

/** 进程内调用的结果:非 2xx 记 `error.status`;2xx 时 `data` 是响应体(204 为 null)。 */
export type EngineResponse = { data?: unknown; error?: { status: number } }
export type EngineRequest = (method: "GET" | "POST", path: string) => Promise<EngineResponse>

/**
 * `#1665` I1:经 sidecar 发布的进程内 fetch 进引擎(围栏下连不上自己的回环端口,`#1531`)。目录只用请求头
 * `x-opencode-directory` 指定(2.x 不读 `?directory=`);**不带口令** —— L5 发布的 fetch 自己补 Basic,
 * ext 不再读 `OPENCODE_SERVER_PASSWORD`。fetch reject 原样抛给调用方,由它按失败处理。
 */
export function inProcessEngineRequest(engineFetch: EngineFetch, directory: string): EngineRequest {
  return async (method, path) => {
    const response = await engineFetch(
      new Request(new URL(path, "http://codepuppy-engine.invalid"), {
        method,
        headers: { "x-opencode-directory": encodeURIComponent(directory) },
      }),
    )
    if (!response.ok) return { error: { status: response.status } }
    if (response.status === 204) return { data: null }
    return { data: await response.json() }
  }
}

export type ReloadRequestInput = {
  /** main 的代际;进程内请求没有。 */
  generation?: number
  scope: ReloadScope
  reason: string
  force?: boolean
}

export type ReloadReport = { generation: number; scope: ReloadScope; outcome: ReloadOutcome; directories: string[]; error?: string }

export type ReloadScheduler = {
  /** token = 登记方自己的身份;同目录重建后,旧 Cleanup 迟到的注销不得注销新的那一份。 */
  register(directory: string, token: object): void
  unregister(directory: string, token: object): void
  request(input: ReloadRequestInput): void
  /** 一轮执行结束了(`session.execution.succeeded` / `failed` / `interrupted`)或别的值得重判的时刻。 */
  poke(): void
  /** 当前一轮判定(含它触发的后续轮)全部结束。 */
  settled(): Promise<void>
}

type Queued = { generation?: number; scope: ReloadScope; reason: string; force: boolean; since: number }

const STATUS_TIMEOUT_MS = 3_000
const MAX_FAILURES = 3
const LONG_WAIT_MS = 5 * 60 * 1000
const UNAVAILABLE = "engine status unavailable — restart the app if this persists"

export function createReloadScheduler(deps: {
  /** 进程内引擎;sidecar 在 `start()` 的 Transform 里同步发布,ext 只在 setup 之后取(I1 第 3 条)。 */
  engine: () => EngineFetch | undefined
  report: (report: ReloadReport) => void
  log: (line: string) => void
  error: (line: string) => void
  statusTimeoutMs?: number
  now?: () => number
}): ReloadScheduler {
  const statusTimeoutMs = deps.statusTimeoutMs ?? STATUS_TIMEOUT_MS
  const now = deps.now ?? Date.now
  const instances = new Map<string, object>()
  let queue: Queued[] = []
  let failures = 0
  let running: Promise<void> | undefined
  let again = false
  const lastWaiting = new Map<number, string>()
  let longWaitLogged: Queued | undefined

  /** 进程级 active 会话数;查不到 ⇒ "unknown"。 */
  async function busy(call: EngineRequest): Promise<number | "unknown"> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await Promise.race([
        call("GET", "/api/session/active"),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${statusTimeoutMs}ms`)), statusTimeoutMs)
        }),
      ])
      if (response.error) throw new Error(`HTTP ${response.error.status}`)
      const active = (response.data as { data?: unknown } | null | undefined)?.data
      if (!active || typeof active !== "object" || Array.isArray(active)) throw new Error("active sessions unreadable")
      return Object.keys(active).length
    } catch (error) {
      deps.error(`[@codepuppy/ext] reload: engine session activity unknown — ${error instanceof Error ? error.message : String(error)}`)
      return "unknown"
    } finally {
      clearTimeout(timer)
    }
  }

  function reportAll(members: Queued[], outcome: ReloadOutcome, directories: string[], error?: string) {
    for (const member of members) {
      if (member.generation === undefined) continue
      if (outcome === "waiting") {
        // 同一条原因不重复报(每个会话事件都会重判一次)。
        if (lastWaiting.get(member.generation) === error) continue
        lastWaiting.set(member.generation, error ?? "")
      } else lastWaiting.delete(member.generation)
      deps.report({ generation: member.generation, scope: member.scope, outcome, directories, ...(error ? { error } : {}) })
    }
  }

  function settle(members: Queued[]) {
    const done = new Set(members)
    queue = queue.filter((item) => !done.has(item))
    if (longWaitLogged && done.has(longWaitLogged)) longWaitLogged = undefined
  }

  async function runOnce(): Promise<void> {
    // 目录没加载 ⇒ 下一次加载读到新状态,直接结束(不为一个不存在的实例去重建全部 Location)。
    const unloaded = queue.filter((item) => item.scope !== "global" && !instances.has(item.scope.directory))
    for (const item of unloaded)
      deps.log(`[@codepuppy/ext] reload: nothing loaded for ${item.scope === "global" ? "any directory" : item.scope.directory} — the next load reads the new state (${item.reason})`)
    reportAll(unloaded, "reloaded", [])
    settle(unloaded)
    if (queue.length === 0) return
    const members = [...queue]
    const directories = [...instances.keys()]
    const reasons = [...new Set(members.map((member) => member.reason))].join("; ")
    if (directories.length === 0) {
      deps.log(`[@codepuppy/ext] reload: nothing loaded for any directory — the next load reads the new state (${reasons})`)
      reportAll(members, "reloaded", [])
      settle(members)
      return
    }
    const force = members.some((member) => member.force)
    const engine = deps.engine()
    if (!engine) {
      deps.error(`[@codepuppy/ext] reload: zero reload — no in-process engine in this host${force ? " (force does not override this)" : ""}`)
      reportAll(members, "waiting", directories, UNAVAILABLE)
      return
    }
    const call = inProcessEngineRequest(engine, directories[0]!)
    for (const pass of [1, 2]) {
      const seen = await busy(call)
      if (seen === "unknown") {
        deps.error(`[@codepuppy/ext] reload: zero reload — engine session activity unknown${force ? " (force does not override this)" : ""}`)
        reportAll(members, "waiting", directories, UNAVAILABLE)
        return
      }
      if (!force && seen > 0) {
        const first = members[0]!
        if (now() - first.since > LONG_WAIT_MS && longWaitLogged !== first) {
          longWaitLogged = first
          deps.log(`[@codepuppy/ext] reload: still waiting after 5 minutes — ${seen} session(s) busy (${reasons})`)
        }
        if (pass === 2) deps.log(`[@codepuppy/ext] reload: a session became busy between the two status checks — waiting again`)
        reportAll(members, "waiting", directories, `${seen} session(s) busy`)
        return
      }
    }
    try {
      const result = await call("POST", "/api/location/reload")
      if (result.error) throw new Error(`HTTP ${result.error.status}`)
    } catch (error) {
      deps.error(`[@codepuppy/ext] reload: location reload failed — ${error instanceof Error ? error.message : String(error)}`)
      failures += 1
      if (failures >= MAX_FAILURES) {
        failures = 0
        deps.error(`[@codepuppy/ext] reload FAILED ${MAX_FAILURES}x — giving up; changes appear after an app restart (${reasons})`)
        reportAll(members, "failed", directories, `reload failed ${MAX_FAILURES} times — restart the app to apply`)
        settle(members)
        return
      }
      reportAll(members, "failed", directories, `reload failed (attempt ${failures}/${MAX_FAILURES}); retrying when the engine is idle`)
      return
    }
    failures = 0
    deps.log(`[@codepuppy/ext] reload executed for ${directories.length} loaded director${directories.length === 1 ? "y" : "ies"}${force ? " (forced)" : ""} — ${reasons}`)
    reportAll(members, "reloaded", directories)
    settle(members)
  }

  function tick() {
    if (running) {
      again = true
      return
    }
    running = (async () => {
      try {
        do {
          again = false
          if (queue.length > 0) await runOnce()
        } while (again)
      } catch (error) {
        deps.error(`[@codepuppy/ext] reload scheduler failed: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        running = undefined
      }
    })()
  }

  return {
    register(directory, token) {
      // 不在这里重判:登记发生在该 Location 自己的 setup 里,此刻它还没加载完。
      instances.set(directory, token)
    },
    unregister(directory, token) {
      if (instances.get(directory) === token) instances.delete(directory)
    },
    request(input) {
      // main 在 sidecar ready 时会重发全部在途代际:同一 generation 只排一次(幂等)。
      if (input.generation !== undefined && queue.some((item) => item.generation === input.generation)) return tick()
      queue.push({
        ...(input.generation !== undefined ? { generation: input.generation } : {}),
        scope: input.scope === "global" ? "global" : { directory: input.scope.directory },
        reason: input.reason,
        force: input.force === true,
        since: now(),
      })
      tick()
    },
    poke() {
      if (queue.length > 0) tick()
    },
    async settled() {
      while (running) await running
    },
  }
}
