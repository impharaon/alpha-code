// `#1667`(#1662 L5,接口文档 I1、基线 §2.4 / §2.7,裁决书 R13、N1、F7):sidecar 里嵌的 OpenCode 2 引擎 —— 在测试进程里真起
// (bun 直接跑 `engine/engine-embed.ts` 的源码,与打包时进 `dist-engine/engine.mjs` 的是同一个入口),HOME / XDG 全在临时沙箱里。
//
//   ① 发布出去的进程内 fetch 和监听端口是**同一张应用图**:经它建一个会话,监听端口的 `/api/event` 收到 `session.created`。
//      反向臂:用 `ServerFetch.make` 另建一张图(同一个库)建会话,监听端口收不到(判法同 L1a E2:事件总线每张图各一份)。
//   ② 发布出去的 fetch 不用调用方给口令,`GET /api/info` 就是 200;反向臂:去掉包装层(裸 dispatch)⇒ 401。
//   ③ 选项对象才是配置通道:只把注入设进环境变量 `OPENCODE_CONFIG_CONTENT`(v1 / CLI 的做法),引擎看不见;放进
//      `config.content` 才看得见。这是「每个 OPENCODE_* 断言传给 start() 的选项」那组测试(engine-server-options.test.ts)的前提。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../test-component/engine-sandbox"
import { buildEngineServerOptions } from "./engine-server-options"
import { engineAuthorization, withEngineAuthorization } from "./engine-authorization"

const sandbox = engineSandbox()
const PASSWORD = "cp-l5-engine-host"
type Embed = typeof import("../../engine/engine-embed")
let embed: Embed
const engines: Array<{ close: () => Promise<void> }> = []

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  embed = await import("../../engine/engine-embed")
})

afterAll(async () => {
  for (const engine of engines.reverse()) await engine.close().catch(() => undefined)
})

function options(slot: ReturnType<typeof engineSlot>, content: string) {
  return buildEngineServerOptions({
    hostname: "127.0.0.1",
    port: 0,
    password: PASSWORD,
    engineVersion: "test",
    databasePath: slot.databasePath,
    configDirectory: slot.configDirectory,
    config: { content },
    models: { fetch: false },
    filewatcher: false,
    platform: process.platform,
  })
}

async function start(name: string, content = "{}") {
  const slot = engineSlot(sandbox, name)
  let published: ((request: Request) => Response | Promise<Response>) | undefined
  const engine = await embed.startEngine(options(slot, content), {
    onDispatch: (dispatch) => {
      published = withEngineAuthorization(dispatch, PASSWORD)
    },
  })
  engines.push(engine)
  if (!published) throw new Error("onDispatch was not called synchronously inside start()")
  return { engine, published, slot }
}

/** 订阅监听端口上的事件流,收集到 `stop()` 为止。 */
function listen(url: string, directory: string) {
  const controller = new AbortController()
  const seen: string[] = []
  const done = (async () => {
    const response = await fetch(new URL("/api/event", url), {
      headers: { authorization: engineAuthorization(PASSWORD), "x-opencode-directory": encodeURIComponent(directory) },
      signal: controller.signal,
    })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      seen.push(decoder.decode(value))
    }
  })().catch(() => undefined)
  return {
    text: () => seen.join(""),
    stop: async () => {
      controller.abort()
      await done
    },
  }
}

function createSession(fetch: (request: Request) => Response | Promise<Response>, directory: string, title: string) {
  return fetch(
    new Request("http://codepuppy-sidecar.invalid/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-opencode-directory": encodeURIComponent(directory) },
      body: JSON.stringify({ title }),
    }),
  )
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("I1 进程内 fetch 的交接(start() + Transform)", () => {
  test("发布的 fetch 和监听端口是同一张应用图:进程内建的会话,监听端口的 /api/event 收得到", async () => {
    const { engine, published, slot } = await start("same-graph")
    const stream = listen(engine.url, slot.projectDirectory)
    await settle(300)
    const created = await createSession(published, slot.projectDirectory, "cp-l5-same-graph")
    expect(created.status).toBe(200)
    const session = ((await created.json()) as { data: { id: string } }).data
    await settle(300)
    await stream.stop()
    expect(stream.text()).toContain("session.created")
    expect(stream.text()).toContain(session.id)
  }, 30_000)

  test("反向臂:另建一张图(ServerFetch.make,同一个库)建的会话,监听端口收不到", async () => {
    const { engine, slot } = await start("second-graph")
    const { ServerFetch } = await import("@opencode/server/fetch")
    const { NodeServices } = await import("@effect/platform-node")
    const { LayerNode } = await import("@opencode/util/effect/layer-node")
    const { Global } = await import("@opencode/util/global")
    const { AppProcess } = await import("@opencode/util/process")
    const { Effect, Exit, Scope } = await import("effect")
    const scope = Scope.makeUnsafe()
    const separate = await Effect.runPromise(
      ServerFetch.make(options(slot, "{}") as Parameters<typeof ServerFetch.make>[0]).pipe(
        Effect.provide(LayerNode.compile(LayerNode.group([Global.node, AppProcess.node]))),
        Effect.provide(NodeServices.layer),
        Scope.provide(scope),
      ) as Effect.Effect<(request: Request) => Promise<Response>>,
    )
    engines.push({ close: () => Effect.runPromise(Scope.close(scope, Exit.void)) })
    const stream = listen(engine.url, slot.projectDirectory)
    await settle(300)
    const created = await createSession(withEngineAuthorization(separate, PASSWORD), slot.projectDirectory, "cp-l5-second-graph")
    expect(created.status).toBe(200)
    const session = ((await created.json()) as { data: { id: string } }).data
    await settle(300)
    await stream.stop()
    expect(stream.text()).not.toContain(session.id)
  }, 30_000)

  test("发布的 fetch 不用调用方给口令:GET /api/info 是 200;反向臂:裸 dispatch(不包这一层)是 401", async () => {
    const { engine, published } = await start("auth")
    const info = await published(new Request("http://codepuppy-sidecar.invalid/api/info"))
    expect(info.status).toBe(200)
    const raw = await engine.dispatch(new Request("http://codepuppy-sidecar.invalid/api/info"))
    expect(raw.status).toBe(401)
  }, 30_000)

  test("配置只经选项对象进引擎:只设进环境变量 OPENCODE_CONFIG_CONTENT 的 agent 引擎看不见,放进 config.content 的看得见", async () => {
    const agent = (name: string) => JSON.stringify({ agents: { [name]: { description: name, mode: "primary" } } })
    process.env.OPENCODE_CONFIG_CONTENT = agent("cp-l5-env-only")
    try {
      const { published, slot } = await start("config-channel", agent("cp-l5-options"))
      const response = await published(
        new Request("http://codepuppy-sidecar.invalid/api/agent", {
          headers: { "x-opencode-directory": encodeURIComponent(slot.projectDirectory) },
        }),
      )
      expect(response.status).toBe(200)
      const body = JSON.stringify(await response.json())
      expect(body).toContain("cp-l5-options")
      expect(body).not.toContain("cp-l5-env-only")
    } finally {
      delete process.env.OPENCODE_CONFIG_CONTENT
    }
  }, 30_000)

  test("会话库就是 database.path 给的那个文件(不是引擎自己按渠道推的 opencode.db)", async () => {
    const { published, slot } = await start("database-path")
    const created = await createSession(published, slot.projectDirectory, "cp-l5-db-path")
    expect(created.status).toBe(200)
    expect(readFileSync(slot.databasePath).subarray(0, 15).toString()).toBe("SQLite format 3")
  }, 30_000)

  test("停止 = 关掉 start() 的作用域(sidecar-stop.ts 的 stopSidecarEngine 调的就是它):关完监听端口不再应答", async () => {
    const { engine } = await start("close")
    const before = await fetch(new URL("/api/info", engine.url), { headers: { authorization: engineAuthorization(PASSWORD) } })
    expect(before.status).toBe(200)
    await engine.close()
    await expect(fetch(new URL("/api/info", engine.url), { headers: { authorization: engineAuthorization(PASSWORD) } })).rejects.toThrow()
  }, 30_000)

  // 分类与「这处锚守不住什么」登记在 ./source-text-anchors.ts。
  test("ANCHOR (not a gate): engine-embed.ts 调 start() 时 lifecycle 位传 undefined,Transform 里同步交出 dispatch(裁决书 N1、I1 第 3 条)", () => {
    const source = readFileSync(join(import.meta.dir, "..", "..", "engine", "engine-embed.ts"), "utf8")
    expect(source).toContain("start(options, undefined, (app) => {")
    expect(source).toMatch(/dispatch = HttpEffect\.toWebHandler\(app\)\s+hooks\.onDispatch\?\.\(dispatch\)/)
    expect(source).not.toMatch(/import[^\n]*ServerFetch|ServerFetch\.make\(/)
  })
})
