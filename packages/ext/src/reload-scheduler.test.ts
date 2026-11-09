// REQ-234 `#1531` I5 的规则一半(reload-scheduler.ts),`#1665` 起打 OpenCode 2 的进程级路由:
// `GET /api/session/active`(本进程全部前台会话)与 `POST /api/location/reload`(重建全部 Location)。
// 这里只替换 sidecar 发布的进程内 fetch(I1 的桩):断言请求头带 `x-opencode-directory`、不带 `authorization`,
// 并钉调度规则本身:合并、幂等、force 的边界、连败停止、注销身份。真宿主里的接线见 plugin-process-singleton.test.ts。
import { describe, expect, test } from "bun:test"
import type { EngineFetch } from "../../ui-mac/src/main/in-process-engine"
import { createReloadScheduler, inProcessEngineRequest, type ReloadReport } from "./reload-scheduler"

type Active = Record<string, { type: "running" }> | "hang" | "throw" | 500

function fakeEngine(initial: Active = {}) {
  const state = { active: initial as Active, reloads: 0, reloadFails: 0, requests: [] as Request[] }
  const fetch: EngineFetch = async (request) => {
    state.requests.push(request)
    const path = new URL(request.url).pathname
    if (request.method === "GET" && path === "/api/session/active") {
      if (state.active === "hang") return new Promise<Response>(() => {})
      if (state.active === "throw") throw new Error("ECONNRESET")
      if (state.active === 500) return new Response("boom", { status: 500 })
      return Response.json({ data: state.active })
    }
    if (request.method === "POST" && path === "/api/location/reload") {
      state.reloads++
      if (state.reloadFails > 0) {
        state.reloadFails--
        return new Response("unavailable", { status: 503, headers: { "retry-after": "1" } })
      }
      return new Response(null, { status: 204 })
    }
    return new Response("not found", { status: 404 })
  }
  return { fetch, state }
}

function scheduler(engine: EngineFetch | undefined) {
  const reports: ReloadReport[] = []
  const errors: string[] = []
  const s = createReloadScheduler({
    engine: () => engine,
    report: (r) => void reports.push(r),
    log: () => {},
    error: (line) => void errors.push(line),
    statusTimeoutMs: 20,
  })
  return { s, reports, errors }
}

const running = { type: "running" as const }

describe("inProcessEngineRequest(I1 消费端)", () => {
  test("目录只走 x-opencode-directory 头(编码后),不带 authorization、不带 ?directory=;非 2xx 记 status,204 给 null", async () => {
    const engine = fakeEngine({ ses_1: running })
    const call = inProcessEngineRequest(engine.fetch, "/Users/me/项目 a")
    expect(await call("GET", "/api/session/active")).toEqual({ data: { data: { ses_1: running } } })
    expect(await call("POST", "/api/location/reload")).toEqual({ data: null })
    expect(await call("GET", "/api/nope")).toEqual({ error: { status: 404 } })
    for (const request of engine.state.requests) {
      expect(request.headers.get("x-opencode-directory")).toBe(encodeURIComponent("/Users/me/项目 a"))
      expect(request.headers.has("authorization")).toBe(false)
      expect(new URL(request.url).searchParams.has("directory")).toBe(false)
    }
  })

  test("即使环境里有 OPENCODE_SERVER_PASSWORD,ext 也不拼口令(L5 发布的 fetch 自己补)", async () => {
    const before = process.env.OPENCODE_SERVER_PASSWORD
    process.env.OPENCODE_SERVER_PASSWORD = "should-not-leak"
    try {
      const engine = fakeEngine()
      await inProcessEngineRequest(engine.fetch, "/w")("GET", "/api/session/active")
      expect(engine.state.requests[0]!.headers.has("authorization")).toBe(false)
    } finally {
      if (before === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
      else process.env.OPENCODE_SERVER_PASSWORD = before
    }
  })
})

describe("reload-scheduler(I5 规则,OpenCode 2 进程级路由)", () => {
  test("有会话在跑 ⇒ 零重载、报 waiting(同一原因不重报);全部空闲 ⇒ 恰好一次 location/reload,逐个 generation 报 reloaded", async () => {
    const engine = fakeEngine({ ses_1: running })
    const { s, reports } = scheduler(engine.fetch)
    s.register("/a", {})
    s.register("/b", {})
    s.request({ generation: 1, scope: "global", reason: "installed skill writer" })
    s.request({ generation: 2, scope: "global", reason: "installed agent reviewer" })
    await s.settled()
    s.poke()
    await s.settled()
    expect(engine.state.reloads).toBe(0)
    expect(reports).toEqual([
      { generation: 1, scope: "global", outcome: "waiting", directories: ["/a", "/b"], error: "1 session(s) busy" },
      { generation: 2, scope: "global", outcome: "waiting", directories: ["/a", "/b"], error: "1 session(s) busy" },
    ])
    engine.state.active = {}
    s.poke()
    await s.settled()
    expect(engine.state.reloads).toBe(1)
    expect(reports.slice(2)).toEqual([
      { generation: 1, scope: "global", outcome: "reloaded", directories: ["/a", "/b"] },
      { generation: 2, scope: "global", outcome: "reloaded", directories: ["/a", "/b"] },
    ])
    s.poke()
    await s.settled()
    expect(engine.state.reloads).toBe(1)
  })

  test("卡在审批上的会话也算在跑(2.x 实测:它在 /api/session/active 里)⇒ 不重载,否则审批卡会被取消", async () => {
    const engine = fakeEngine({ ses_waiting_on_approval: running })
    const { s, reports } = scheduler(engine.fetch)
    s.register("/a", {})
    s.request({ generation: 12, scope: { directory: "/a" }, reason: "project mcp" })
    await s.settled()
    expect(engine.state.reloads).toBe(0)
    expect(reports).toEqual([{ generation: 12, scope: { directory: "/a" }, outcome: "waiting", directories: ["/a"], error: "1 session(s) busy" }])
  })

  test("查不到(超时 / 抛错 / 非 2xx / 没有进程内引擎)⇒ 零重载,force 也不例外;查询恢复后照常执行", async () => {
    for (const broken of ["hang", "throw", 500] as const) {
      const engine = fakeEngine(broken)
      const { s, reports, errors } = scheduler(engine.fetch)
      s.register("/ok", {})
      s.request({ generation: 7, scope: "global", reason: "user: reload now", force: true })
      await s.settled()
      expect(engine.state.reloads).toBe(0)
      expect(reports).toEqual([
        { generation: 7, scope: "global", outcome: "waiting", directories: ["/ok"], error: "engine status unavailable — restart the app if this persists" },
      ])
      expect(errors.some((line) => line.includes("zero reload"))).toBe(true)
      engine.state.active = {}
      s.poke()
      await s.settled()
      expect(engine.state.reloads).toBe(1)
    }
    const { s, reports } = scheduler(undefined)
    s.register("/ok", {})
    s.request({ generation: 8, scope: "global", reason: "x", force: true })
    await s.settled()
    expect(reports).toEqual([
      { generation: 8, scope: "global", outcome: "waiting", directories: ["/ok"], error: "engine status unavailable — restart the app if this persists" },
    ])
  })

  test("force 只跳过「等空闲」:有会话在跑也重载", async () => {
    const engine = fakeEngine({ ses_1: running, ses_2: running })
    const { s, reports } = scheduler(engine.fetch)
    s.register("/a", {})
    s.request({ generation: 3, scope: { directory: "/a" }, reason: "user: reload now", force: true })
    await s.settled()
    expect(engine.state.reloads).toBe(1)
    expect(reports).toEqual([{ generation: 3, scope: { directory: "/a" }, outcome: "reloaded", directories: ["/a"] }])
  })

  test("两次查空闲之间有会话变忙 ⇒ 第二次查到,零重载", async () => {
    const engine = fakeEngine({})
    let calls = 0
    const wrapped: EngineFetch = async (request) => {
      if (new URL(request.url).pathname === "/api/session/active" && ++calls === 2) engine.state.active = { ses_9: running }
      return engine.fetch(request)
    }
    const { s, reports } = scheduler(wrapped)
    s.register("/a", {})
    s.request({ generation: 4, scope: "global", reason: "x" })
    await s.settled()
    expect(calls).toBe(2)
    expect(engine.state.reloads).toBe(0)
    expect(reports).toEqual([{ generation: 4, scope: "global", outcome: "waiting", directories: ["/a"], error: "1 session(s) busy" }])
  })

  test("重载失败保留重试;连败 3 次停止自动重试,仍报最后一条 failed;绝不报 reloaded", async () => {
    const engine = fakeEngine()
    engine.state.reloadFails = 5
    const { s, reports } = scheduler(engine.fetch)
    s.register("/a", {})
    s.request({ generation: 5, scope: "global", reason: "x" })
    for (let i = 0; i < 4; i++) {
      await s.settled()
      s.poke()
    }
    await s.settled()
    expect(engine.state.reloads).toBe(3)
    expect(reports.map((r) => r.outcome)).toEqual(["failed", "failed", "failed"])
    expect(reports.at(-1)?.error).toBe("reload failed 3 times — restart the app to apply")
  })

  test("同一 generation 重发只排一次(sidecar ready 时 main 重发全部在途代际)", async () => {
    const engine = fakeEngine({ ses_1: running })
    const { s, reports } = scheduler(engine.fetch)
    s.register("/a", {})
    s.request({ generation: 6, scope: "global", reason: "x" })
    s.request({ generation: 6, scope: "global", reason: "x" })
    await s.settled()
    engine.state.active = {}
    s.poke()
    await s.settled()
    expect(engine.state.reloads).toBe(1)
    expect(reports.filter((r) => r.outcome === "reloaded")).toHaveLength(1)
  })

  test("目录作用域:目录没加载着 ⇒ 不重载直接 reloaded;一次重载结束队列里的全部请求(2.x 重建全部 Location);进程内请求不报", async () => {
    const engine = fakeEngine()
    const { s, reports } = scheduler(engine.fetch)
    s.register("/a", {})
    s.request({ generation: 8, scope: { directory: "/not-loaded" }, reason: "project mcp" })
    await s.settled()
    expect(engine.state.reloads).toBe(0)
    expect(reports).toEqual([{ generation: 8, scope: { directory: "/not-loaded" }, outcome: "reloaded", directories: [] }])
    engine.state.active = { ses_1: running }
    s.request({ scope: { directory: "/a" }, reason: "codepuppy_reload" })
    s.request({ generation: 9, scope: "global", reason: "installed" })
    await s.settled()
    engine.state.active = {}
    s.poke()
    await s.settled()
    expect(engine.state.reloads).toBe(1)
    expect(reports.slice(1).filter((r) => r.outcome === "reloaded")).toEqual([{ generation: 9, scope: "global", outcome: "reloaded", directories: ["/a"] }])
    s.poke()
    await s.settled()
    expect(engine.state.reloads).toBe(1)
  })

  test("只因同一个 token 注销:同目录重建后,旧 Cleanup 迟到的注销不注销新的那一份", async () => {
    const engine = fakeEngine()
    const { s, reports } = scheduler(engine.fetch)
    const old = {}
    const fresh = {}
    s.register("/a", old)
    s.register("/a", fresh)
    s.unregister("/a", old)
    s.request({ generation: 10, scope: { directory: "/a" }, reason: "x" })
    await s.settled()
    expect(engine.state.reloads).toBe(1)
    s.unregister("/a", fresh)
    s.request({ generation: 11, scope: { directory: "/a" }, reason: "y" })
    await s.settled()
    expect(engine.state.reloads).toBe(1)
    expect(reports.at(-1)).toEqual({ generation: 11, scope: { directory: "/a" }, outcome: "reloaded", directories: [] })
  })
})
