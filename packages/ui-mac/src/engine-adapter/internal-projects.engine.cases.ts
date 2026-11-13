// `#1669`:全新数据上,界面的项目清单是空的;Code Puppy 自己的目录不进任何项目清单(0.1.26 的行为)。
//
// 按生产的起法在临时 HOME/XDG 沙箱里真起嵌进 sidecar 的 OpenCode 2:
//   · 进程工作目录 = main 建的 `<userData>/engine-scratch-cwd`(server.ts fork 的 cwd,index.ts 的 chdir 同一个函数);
//   · `~/code-puppy` 先由 main 建好(server.ts 的围栏计划 ensureUserWorkspaceDir),再由 sidecar 的启动预热打开
//     (sidecar.ts → prewarmInitialLocation,同一个函数);
//   · 界面经生产的引擎适配器(createEngineFetch,认目录用 main 的 engineInternalDirectories)发冻结界面启动时那几个
//     不带目录的请求(bootstrapGlobal:GET /path、GET /provider、GET /project)。
// 反向臂:同一台引擎、适配器不认这两个目录 ⇒ 清单里出现 engine-scratch-cwd 与 code-puppy(打包回归看到的那两行)。
//
// 本文件由 internal-projects.engine.test.ts 起独立 `bun test` 子进程来跑(沙箱改的环境变量与 chdir 不出那个进程)。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../test-component/engine-sandbox"
import { codepuppyUserWorkspaceDir, ensureUserWorkspaceDir } from "../main/codepuppy-user-workspace"
import { engineAuthorization, withEngineAuthorization } from "../main/engine-authorization"
import { engineInternalDirectories } from "../main/engine-internal-directories"
import { ensureEngineScratchCwd } from "../main/engine-scratch-cwd"
import { buildEngineServerOptions } from "../main/engine-server-options"
import { prewarmInitialLocation } from "../main/sidecar-location-prewarm"
import { createEngineFetch, type EngineFetch } from "./index"

const sandbox = engineSandbox()
const PASSWORD = "cp-1669-internal-projects"
const userData = join(sandbox.root, "userData")
let engine: { url: string; close: () => Promise<void> }
let scratch: string
let defaultWorkspace: string

/** 与 main 的 onBeforeSendHeaders 同一件事:发往引擎源的请求补口令(I8)。 */
const engineHttp: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init)
  request.headers.set("authorization", engineAuthorization(PASSWORD))
  return fetch(request)
}) as typeof fetch

function adapter(internal: () => ReturnType<typeof engineInternalDirectories>): EngineFetch {
  const origin = new URL(engine.url).origin
  return createEngineFetch({
    isEngineOrigin: (candidate) => candidate === origin,
    fetch: engineHttp,
    internalDirectories: async () => internal(),
  })
}

/** 生产适配器:认目录用的就是 main 交给 IPC 的那个函数。 */
const production = () => adapter(() => engineInternalDirectories(userData))
/** 反向臂:不认 Code Puppy 自己的目录。 */
const unaware = () => adapter(() => ({ scratch: [], defaultWorkspace: [] }))

const url = (path: string, directory?: string) => {
  const target = new URL(path, engine.url)
  if (directory) target.searchParams.set("directory", directory)
  return target
}

async function listed(engineFetch: EngineFetch): Promise<string[]> {
  const response = await engineFetch(url("/project"))
  expect(response.status).toBe(200)
  return ((await response.json()) as Array<{ worktree: string }>).map((project) => project.worktree).sort()
}

/** 引擎自己的项目表(不经适配器):证明那两行确实在库里,判据不是空跑。 */
async function engineRows(): Promise<string[]> {
  const response = await engineHttp(new URL("/api/project", engine.url))
  expect(response.status).toBe(200)
  return ((await response.json()) as Array<{ canonical: string }>).map((project) => project.canonical).sort()
}

/** 冻结界面 bootstrapGlobal 不带目录的启动请求(loadPathQuery(null)、v1 的 loadProvidersQuery(null)、loadProjectsQuery)。 */
async function frozenGlobalBootstrap(engineFetch: EngineFetch) {
  for (const path of ["/path", "/provider", "/project"]) {
    const response = await engineFetch(url(path))
    expect(response.status, path).toBe(200)
    await response.arrayBuffer()
  }
}

/** 订阅适配器的 `/global/event`,收集投影出来的 v1 事件。 */
function events(engineFetch: EngineFetch) {
  const controller = new AbortController()
  const seen: Array<{ type: string; properties: any }> = []
  const done = (async () => {
    const response = await engineFetch(url("/global/event"), { signal: controller.signal })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split("\n\n")
      buffer = frames.pop() ?? ""
      for (const frame of frames) if (frame.startsWith("data: ")) seen.push(JSON.parse(frame.slice(6)).payload)
    }
  })().catch(() => undefined)
  return {
    projects: () => seen.filter((event) => event.type === "project.updated").map((event) => event.properties.worktree as string),
    stop: async () => {
      controller.abort()
      await done
    },
  }
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  // main:进程工作目录与 fork 的 cwd 都是 ensureEngineScratchCwd(userData);默认对话目录在 fork 前建好。
  scratch = ensureEngineScratchCwd(userData)
  process.chdir(scratch)
  defaultWorkspace = ensureUserWorkspaceDir()!
  expect(defaultWorkspace).toEndWith("/code-puppy")
  const slot = engineSlot(sandbox, "internal-projects")
  const { startEngine } = await import("../../engine/engine-embed")
  let published: EngineFetch | undefined
  engine = await startEngine(
    buildEngineServerOptions({
      hostname: "127.0.0.1",
      port: 0,
      password: PASSWORD,
      engineVersion: "test",
      databasePath: slot.databasePath,
      configDirectory: slot.configDirectory,
      config: { content: "{}" },
      models: { fetch: false },
      filewatcher: false,
      platform: process.platform,
    }),
    { onDispatch: (dispatch) => (published = withEngineAuthorization(dispatch, PASSWORD)) },
  )
  // sidecar:ready 之前对初始目录(main 给的 codepuppyUserWorkspaceDir())做预热。
  await prewarmInitialLocation({ request: published! }, codepuppyUserWorkspaceDir(), { password: PASSWORD })
})

afterAll(async () => {
  await engine?.close().catch(() => undefined)
})

describe("#1669 Code Puppy 自己的目录不是项目", () => {
  test("全新数据:引擎库里有 engine-scratch-cwd 与 code-puppy 两行,界面拿到的项目清单是空的,事件流也不报它们", async () => {
    // 来源:code-puppy 那行是 sidecar 的启动预热建的;engine-scratch-cwd 那行是冻结界面不带目录的启动请求建的。
    expect(await engineRows()).toEqual([defaultWorkspace])
    const stream = events(production())
    const unfiltered = events(unaware())
    await settle(300)
    await frozenGlobalBootstrap(production())
    await settle(500)
    await stream.stop()
    await unfiltered.stop()

    expect(await engineRows()).toEqual([defaultWorkspace, scratch].sort())
    expect(await listed(production())).toEqual([])
    // 引擎确实为 engine-scratch-cwd 发了 project.updated(不认目录的投影照发),生产投影不发。
    expect(unfiltered.projects()).toContain(scratch)
    expect(stream.projects()).not.toContain(scratch)
    expect(stream.projects()).not.toContain(defaultWorkspace)
    // 没有开在内部目录里的会话(Code Puppy 建会话处都带目录)。
    const sessions = await engineHttp(new URL("/api/session", engine.url))
    expect(((await sessions.json()) as { data: unknown[] }).data).toEqual([])
  }, 60_000)

  test("反向臂:适配器不认这两个目录 ⇒ 清单里就是打包回归看到的 engine-scratch-cwd 与 code-puppy", async () => {
    expect(await listed(unaware())).toEqual([defaultWorkspace, scratch].sort())
  }, 30_000)

  test("用户打开一个真实目录 ⇒ 清单里恰好是它一个", async () => {
    const project = join(sandbox.root, "projects", "my-app")
    mkdirSync(project, { recursive: true })
    const response = await production()(url("/path", project))
    expect(response.status).toBe(200)
    await response.arrayBuffer()
    expect(await listed(production())).toEqual([project])
  }, 30_000)

  test("默认对话目录有了对话 ⇒ 它作为项目出现(0.1.26:非 Git 目录按会话出现);engine-scratch-cwd 仍不在", async () => {
    const created = await production()(url("/session", defaultWorkspace), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "cp-1669" }),
    })
    expect(created.status).toBe(200)
    await created.arrayBuffer()
    expect(await listed(production())).toEqual([join(sandbox.root, "projects", "my-app"), defaultWorkspace].sort())
  }, 30_000)
})
