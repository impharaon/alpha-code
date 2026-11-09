// REQ-234 `#1531` / `#1665`:ext 的重载接线在 OpenCode 2 真插件宿主里走一遍 —— parentPort 监听(模块求值时挂上)→ 重载请求进
// 进程级调度器 → 本 Location 的 setup 登记 → 经 sidecar 发布的进程内 fetch 问 `/api/session/active`、打 `/api/location/reload`
// (I1)→ 报告经同一个 port 回 main;Location 关掉(插件作用域释放)⇒ Cleanup 注销,之后的目录请求直接算 reloaded。
// 宿主 plugin-reload-wiring.test.ts 在**子进程**里跑本文件:parentPort 必须在 ext 模块求值**之前**就在(与 sidecar 预载一样)。
// 这里只替换 Electron 的 parentPort 与 sidecar 发布的进程内 fetch(引擎的那两条路由)。
import { expect } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { SessionEvent } from "../../schema/src/session-event.ts"
import { Bus } from "../../core/src/bus.ts"
import { Location } from "../../core/src/location.ts"
import { Session } from "../../core/src/session.ts"
import { buildReloadRequest, parseCodePuppySidecarInbound } from "../../ui-mac/src/main/codepuppy-sidecar-messages"
import { publishInProcessEngine } from "../../ui-mac/src/main/in-process-engine"

const sent: unknown[] = []
const listeners: Array<(event: { data: unknown }) => void> = []
;(process as unknown as { parentPort: unknown }).parentPort = {
  postMessage: (message: unknown) => void sent.push(message),
  on: (_event: string, listener: (event: { data: unknown }) => void) => void listeners.push(listener),
}
const deliver = (data: unknown) => listeners.forEach((listener) => listener({ data }))

const global = join(realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-plugin-reload-wiring-"))), "codepuppy-state", "env", "dev")
mkdirSync(global, { recursive: true })
process.env.CODEPUPPY_GLOBAL_DIR = global

const engine = { busy: true, reloads: 0, headers: [] as Array<[string | null, string | null]> }
publishInProcessEngine(async (request) => {
  engine.headers.push([request.headers.get("x-opencode-directory"), request.headers.get("authorization")])
  const path = new URL(request.url).pathname
  if (path === "/api/session/active") return Response.json({ data: engine.busy ? { ses_1: { type: "running" } } : {} })
  if (path === "/api/location/reload") return (engine.reloads++, new Response(null, { status: 204 }))
  return new Response("not found", { status: 404 })
})

const { default: CodePuppyExt, processState } = await import("./plugin")
const { activate, it } = await import("./plugin-host.harness")

const reports = () => sent.map((message) => parseCodePuppySidecarInbound(message)).filter((m) => m?.type === "codepuppy.reload.report")
const settled = () => Effect.promise(() => processState().reloads.settled())
/** 事件经 bus → 插件的异步订阅 → 调度器,是异步的;最多等 2 秒,等不到就让下面的断言去红。 */
const until = (done: () => boolean) =>
  Effect.gen(function* () {
    for (let waited = 0; waited < 2000 && !done(); waited += 20) yield* Effect.sleep("20 millis")
  })

it.live("main 的重载请求 ⇒ 等全部会话空闲 ⇒ 恰好一次 location/reload ⇒ 报 reloaded;Location 关掉之后不再算它", () =>
  Effect.gen(function* () {
    // 监听在 setup 之前就在了(模块求值时挂上)
    expect(listeners).toHaveLength(1)
    const directory = (yield* Location.Service).directory
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* activate(CodePuppyExt)
        deliver(buildReloadRequest({ generation: 7, scope: "global", items: [{ id: "skill:writer", scope: "global" }], reason: "installed skill writer" }))
        yield* settled()
        expect(reports()).toEqual([
          { type: "codepuppy.reload.report", generation: 7, scope: "global", outcome: "waiting", directories: [directory], error: "1 session(s) busy" },
        ])
        // 会话跑完:引擎经宿主 bus 发 2.x 的执行结束事件(不手动 poke)⇒ ext 的订阅叫醒调度器 ⇒ 重判、重载。
        // 反向臂(审计 R1):订阅名换回 v1 的 `session.idle` / `session.status`,这条事件到不了 ext ⇒ 下面等不到重载 ⇒ 红。
        engine.busy = false
        const session = yield* (yield* Session.Service).create({ location: { directory }, title: "reload wiring" })
        yield* (yield* Bus.Service).publish(SessionEvent.Execution.Succeeded, { sessionID: session.id })
        yield* until(() => engine.reloads > 0)
        yield* settled()
        expect(engine.reloads).toBe(1)
        expect(reports().at(-1)).toEqual({ type: "codepuppy.reload.report", generation: 7, scope: "global", outcome: "reloaded", directories: [directory] })
        // I1:目录走头,不带口令
        expect(engine.headers.every(([dir, auth]) => dir === encodeURIComponent(directory) && auth === null)).toBe(true)
      }),
    )
    // 插件作用域释放 ⇒ ext 的 Cleanup 注销本 Location ⇒ 该目录的请求不再触发重载
    deliver(buildReloadRequest({ generation: 8, scope: { directory }, items: [{ id: "mcp:x", scope: "project" }], reason: "project mcp" }))
    yield* settled()
    expect(engine.reloads).toBe(1)
    expect(reports().at(-1)).toEqual({ type: "codepuppy.reload.report", generation: 8, scope: { directory }, outcome: "reloaded", directories: [] })
  }),
)
