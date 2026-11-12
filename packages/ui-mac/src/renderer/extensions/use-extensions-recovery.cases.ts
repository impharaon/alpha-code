import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "vite"
import solid from "vite-plugin-solid"
import type { createRoot } from "solid-js"
import type { SidecarGenerationState } from "../../preload/types"
import type { useExtensions } from "./use-extensions"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../../test-component/engine-sandbox"
import { buildEngineServerOptions } from "../../main/engine-server-options"
import { engineAuthorization } from "../../main/engine-authorization"
import { createEngineFetch } from "../../engine-adapter"

// `#1662` parity B6:v1 版起的是已删的 `packages/opencode/src/index.ts serve`。现在引擎是嵌进 sidecar 的那台 OpenCode 2
// (沙箱里、本进程内、真监听端口);冻结界面的 v1 SDK 请求经生产的引擎适配器(src/engine-adapter,`engineFetch` 的同一个
// createEngineFetch)译成 2.x 的 `/api/*` 再到引擎,口令由这里按 main 的做法补上。沙箱必须在任何引擎模块装载之前就位。
const sandbox = engineSandbox()
const PASSWORD = "cp-parity-recovery"

const transport = fetch
const root = await mkdtemp(join(tmpdir(), "codepuppy-1505-"))
const listeners = new Set<(state: SidecarGenerationState) => void>()
let generation = 0
let runtime: { createRoot: typeof createRoot; useExtensions: typeof useExtensions }
let engine: { url: string; close: () => Promise<void> } | undefined
let engineUrl: string
let projectDirectory: string
/** 生产的引擎适配器:v1 路径 → 2.x `/api/*`;出网前补上引擎口令(生产里由 main 的 onBeforeSendHeaders 补)。 */
const adapter = createEngineFetch({
  isEngineOrigin: (origin) => origin === new URL(engineUrl).origin,
  fetch: (input, init) => {
    const request = new Request(input, init)
    request.headers.set("authorization", engineAuthorization(PASSWORD))
    return transport(request)
  },
})
let statusPath: string
let captured: Record<string, { status: string }>
const disposers: (() => void)[] = []
const proxies: ReturnType<typeof Bun.serve>[] = []

async function until(check: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (await check()) return
    await Bun.sleep(10)
  }
  throw new Error("timed out waiting for production hook/engine")
}

function emit(status: SidecarGenerationState["status"]) {
  if (status === "recovering") generation++
  listeners.forEach((listener) => listener({ generation, status, reason: "structural" }))
}

function closedPort() {
  const socket = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = socket.port!
  socket.stop(true)
  return port
}

function recover(port: number) {
  // Relay the actual engine response unchanged; no fabricated HTTP status/body.
  proxies.push(Bun.serve({
    hostname: "127.0.0.1", port,
    fetch: (request) => {
      const url = new URL(new URL(request.url).pathname, engineUrl)
      url.searchParams.set("directory", projectDirectory)
      return adapter(new Request(url, request))
    },
  }))
  emit("ready")
}

function mount(port: number, delayFailure?: Promise<void>) {
  let requests = 0
  let refused = 0
  let settled = 0
  // The hook does not expose SDK fetch injection. Observe its real transport boundary only;
  // delaying an actual refused request makes the late-error arm deterministic.
  globalThis.fetch = (async (input, init) => {
    const status = new URL(input instanceof Request ? input.url : String(input)).pathname === statusPath
    if (status) requests++
    try {
      return await transport(input, init)
    } catch (error) {
      if (status) {
        refused++
        if (delayFailure) await delayFailure
      }
      throw error
    } finally {
      if (status) settled++
    }
  }) as typeof fetch
  const hook = runtime.createRoot((dispose) => {
    disposers.push(dispose)
    return runtime.useExtensions(() => ({ baseUrl: `http://127.0.0.1:${port}` }))
  })
  return { hook, requests: () => requests, refused: () => refused, settled: () => settled }
}

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  const slot = engineSlot(sandbox, "recovery")
  projectDirectory = slot.projectDirectory
  // Own configuration bytes; the asserted response shape is captured from the real status route below.
  await Bun.write(join(projectDirectory, "opencode.json"), JSON.stringify({
    mcp: { "recovery-sample": { type: "remote", url: "http://127.0.0.1:1", enabled: false } },
  }))
  const { startEngine } = await import("../../../engine/engine-embed")
  engine = await startEngine(buildEngineServerOptions({
    hostname: "127.0.0.1", port: 0, password: PASSWORD, engineVersion: "test",
    databasePath: slot.databasePath, configDirectory: slot.configDirectory, config: { content: "{}" },
    models: { fetch: false }, filewatcher: false, platform: process.platform,
  }))
  engineUrl = engine.url
  // OpenCode 2 boots a Location (and loads its MCP configuration) on the first request for that directory: wait for
  // the project's server to be listed before capturing the shape the hook will be compared against.
  await until(async () => {
    const listed = await transport(new Request(`${engineUrl}/api/mcp`, {
      headers: { authorization: engineAuthorization(PASSWORD), "x-opencode-directory": encodeURIComponent(projectDirectory) },
    }))
    return ((await listed.json()) as { data?: Array<{ name: string }> }).data?.some((server) => server.name === "recovery-sample") === true
  })
  // Derive the observed HTTP path from the SDK operation that the production hook uses.
  const client = createOpencodeClient({ baseUrl: engineUrl, fetch: async (request) => {
    statusPath = new URL(request instanceof Request ? request.url : String(request)).pathname
    return adapter(request)
  } })
  const response = await client.mcp.status({ directory: projectDirectory }, { signal: AbortSignal.timeout(10_000) })
  expect(response.response.ok).toBe(true)
  captured = response.data!
  expect(captured["recovery-sample"]).toEqual({ status: "disabled" })

  const entry = join(root, "runtime.ts")
  await Bun.write(entry, `export { createRoot } from "solid-js"; export { useExtensions } from ${JSON.stringify(join(import.meta.dir, "use-extensions.ts"))};`)
  await build({
    configFile: false, logLevel: "silent", root: resolve(import.meta.dir, "../../.."),
    plugins: [solid()],
    resolve: { alias: [
      { find: /^solid-js\/store$/, replacement: import.meta.resolve("solid-js/store/dist/store.js").replace("file://", "") },
      { find: /^solid-js\/web$/, replacement: import.meta.resolve("solid-js/web/dist/web.js").replace("file://", "") },
      { find: /^solid-js$/, replacement: import.meta.resolve("solid-js/dist/solid.js").replace("file://", "") },
    ] },
    build: {
      outDir: join(root, "bundle"), lib: { entry, formats: ["es"], fileName: () => "runtime.js" },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  })
  // happy-dom brings its own fetch-layer globals; the engine adapter (and Bun's fetch it calls) run on the runtime's
  // own Request / Headers / AbortSignal, as in the renderer's real browser. Keep those.
  const native = { Request, Response, Headers, AbortController, AbortSignal, URL, URLSearchParams, ReadableStream, Blob, FormData }
  GlobalRegistrator.register()
  Object.assign(globalThis, native)
  Object.defineProperty(window, "api", { value: {
    sidecarGeneration: { subscribe: (listener: (state: SidecarGenerationState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    } },
    ext: {
      listInstalls: async () => ({ global: [], project: [] }),
      sessionGrants: async () => ({ grants: [] }),
      onSessionGrantsEnded: () => () => {}, factorySkillIds: async () => [],
      // `#1529`:三档状态面 —— 本文件不验它;空视图、推送不触发。
      hubView: async () => ({ directory: "/", rows: [], warnings: [] }),
      onHubViewChanged: () => () => {},
    },
  } })
  runtime = await import(pathToFileURL(join(root, "bundle/runtime.js")).href)
})

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  proxies.splice(0).forEach((proxy) => proxy.stop(true))
  globalThis.fetch = transport
})

afterAll(async () => {
  await engine?.close().catch(() => undefined)
  if (typeof window !== "undefined") await GlobalRegistrator.unregister()
  await rm(root, { recursive: true, force: true })
})

function expectLoaded(hook: ReturnType<typeof useExtensions>) {
  expect(hook.store.error).toBe(false)
  expect(hook.store.ready).toBe(true)
  expect(Object.keys(hook.store.mcp)).toEqual(Object.keys(captured))
  expect(hook.store.mcp["recovery-sample"]).toMatchObject({ name: "recovery-sample", enabled: false, connected: false })
}

test("AC1: same renderer/address automatically rereads after ready and clears the installed-list error", async () => {
  const port = closedPort()
  const probe = mount(port)
  await until(() => probe.hook.store.error)
  expect(probe.requests()).toBe(1)
  emit("recovering")
  expect(probe.requests()).toBe(1)
  recover(port)
  await until(() => probe.hook.store.ready)
  expect(probe.requests()).toBe(2)
  expectLoaded(probe.hook)
  // Normal ten-minute renewal must not reread an already successful list.
  emit("recovering")
  emit("ready")
  await Bun.sleep(20)
  expect(probe.requests()).toBe(2)
})

test("AC2: a late real connection-refused error cannot overwrite the new generation's successful list", async () => {
  const delayed = Promise.withResolvers<void>()
  const port = closedPort()
  const probe = mount(port, delayed.promise)
  try {
    await until(() => probe.refused() === 1)
    emit("recovering")
    recover(port)
    await until(() => probe.hook.store.ready)
    expect(probe.requests()).toBe(2)
    expectLoaded(probe.hook)
    delayed.resolve()
    await until(() => probe.settled() === 2)
    await Bun.sleep(20)
    expectLoaded(probe.hook)
  } finally {
    delayed.resolve()
  }
})

test("AC2: cleanup unsubscribes recovery and invalidates an in-flight status result", async () => {
  const delayed = Promise.withResolvers<void>()
  const probe = mount(closedPort(), delayed.promise)
  try {
    await until(() => probe.refused() === 1)
    disposers.pop()!()
    emit("recovering")
    emit("ready")
    delayed.resolve()
    await until(() => probe.settled() === 1)
    await Bun.sleep(20)
    expect(probe.requests()).toBe(1)
    expect(probe.hook.store.error).toBe(false)
    expect(probe.hook.store.ready).toBe(false)
  } finally {
    delayed.resolve()
  }
})

test("AC3: unavailable/failed recovery keeps the real refusal error and manual retry remains usable", async () => {
  const probe = mount(closedPort())
  await until(() => probe.hook.store.error)
  emit("recovering")
  emit("failed")
  expect(probe.requests()).toBe(1)
  expect(probe.hook.store.error).toBe(true)
  await probe.hook.refresh()
  expect(probe.requests()).toBe(2)
  emit("recovering")
  emit("ready")
  await until(() => probe.settled() === 3)
  expect(probe.hook.store.error).toBe(true)
  expect(probe.hook.store.ready).toBe(false)
  expect(probe.hook.store.mcp).toEqual({})
  await probe.hook.refresh()
  expect(probe.requests()).toBe(4)
  expect(probe.hook.store.error).toBe(true)
})
