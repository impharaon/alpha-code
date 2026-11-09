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
import { Location } from "../../core/src/location.ts"
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
        engine.busy = false
        processState().reloads.poke()
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
