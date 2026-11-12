// `#1687` SPEC-error-message-lifetime v2 AC-01 / AC-05 / AC-06:连不上的工具服务只进「未恢复问题」入口,不弹提示。
// 真挂生产 BackgroundProblemWatcher + ToastViewport + ProblemsEntry(vite 构建同 toast-lifetime.test.ts);
// 状态来源是替身 fetch:`GET /mcp` 回当前状态表,`GET /global/event` 是可推送的 SSE 流 —— 走的是
// 观察件真实使用的 SDK 客户端与订阅,不是绕过它们的内部函数。假定时器推进时间。
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from "bun:test"
import appPlugin from "@opencode-ai/app/vite"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "vite"
import type * as Runtime from "./toast-lifetime-test-runtime"
import { dict as zh } from "../i18n/zh"

const runtimeDirectory = mkdtempSync(join(tmpdir(), "codepuppy-connector-watcher-"))
await build({
  configFile: false,
  logLevel: "silent",
  plugins: [appPlugin.at(-1)!],
  build: {
    emptyOutDir: true,
    outDir: runtimeDirectory,
    lib: {
      entry: join(import.meta.dir, "toast-lifetime-test-runtime.tsx"),
      formats: ["es"],
      fileName: () => "toast-lifetime-test-runtime.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})

GlobalRegistrator.register()
const runtime = (await import(
  pathToFileURL(join(runtimeDirectory, "toast-lifetime-test-runtime.js")).href
)) as typeof Runtime

/** 引擎替身:状态表 + 每次 `GET /mcp` 的时刻 + 可推送的事件流。 */
function engine(initial: Record<string, unknown>) {
  let status = initial
  const statusReads: number[] = []
  const auths: string[] = []
  let push: ((type: string) => void) | undefined
  const encoder = new TextEncoder()
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const path = new URL(request.url).pathname
    if (path === "/mcp" && request.method === "GET") {
      statusReads.push(Date.now())
      return new Response(JSON.stringify(status), { headers: { "content-type": "application/json" } })
    }
    const auth = path.match(/^\/mcp\/([^/]+)\/auth\/authenticate$/)
    if (auth) {
      auths.push(decodeURIComponent(auth[1]!))
      return new Response(JSON.stringify({ status: "connected" }), { headers: { "content-type": "application/json" } })
    }
    if (path === "/global/event") {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          push = (type) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ directory: "/w", payload: { type, properties: {} } })}\n\n`))
        },
      })
      return new Response(body, { headers: { "content-type": "text/event-stream" } })
    }
    return new Response("{}", { status: 404 })
  }
  return {
    server: () => ({ baseUrl: "http://127.0.0.1:4096", fetch: fetch as typeof globalThis.fetch }),
    statusReads,
    auths,
    set(next: Record<string, unknown>) {
      status = next
    },
    /** 引擎报一次 MCP 变化事件(观察件据此重读状态)。 */
    emit(type = "mcp.tools.changed") {
      push?.(type)
    },
  }
}

const disposers: Array<() => void> = []
let page = 0
const advance = (ms: number) => jest.advanceTimersByTime(ms)
/** 让出足够多的微任务与 I/O 轮次:SDK 的 fetch → json / SSE 解析都是 promise 链。 */
async function settle() {
  for (let i = 0; i < 40; i++) await Promise.resolve()
}
const toasts = () => [...document.querySelectorAll<HTMLElement>(".a-toast")]
const entry = () => document.querySelector<HTMLButtonElement>(".codepuppy-problems-entry")
const entryLabel = () => entry()?.querySelector(".codepuppy-problems-label")?.textContent
const countLabel = (count: number) => zh["codepuppy.problems.entry"].replace("{{count}}", String(count))
const items = () => [...document.querySelectorAll<HTMLElement>(".codepuppy-problems-item")]
const failed = (name: string) => zh["codepuppy.problems.connectorFailed"].replace("{{name}}", name)
async function openList() {
  entry()!.click()
  await settle()
}

function mount(source: ReturnType<typeof engine>) {
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(runtime.render(() => runtime.RoutedToastHarness(), host))
  const watcher = document.createElement("div")
  document.body.append(watcher)
  disposers.push(runtime.render(() => runtime.BackgroundProblemWatcher({ server: source.server }), watcher))
}

beforeAll(() => runtime.setLocale("zh"))
beforeEach(() => jest.useFakeTimers())
afterEach(async () => {
  disposers.splice(0).forEach((dispose) => dispose())
  for (const problem of runtime.unresolvedProblems()) runtime.resolveProblem(problem.key)
  runtime.navigateTo(`/page-${++page}`)
  await settle()
  document.body.replaceChildren()
  jest.useRealTimers()
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
  rmSync(runtimeDirectory, { recursive: true, force: true })
})

describe("#1687 v2 connector failures go only to the entry", () => {
  test("AC-01: a disconnected connector is listed without a toast; on reconnect it leaves the entry within 1 s", async () => {
    const source = engine({ feishu: { status: "connected" } })
    mount(source)
    await settle()
    source.emit()
    source.set({ feishu: { status: "failed", error: "spawn ENOENT" } })
    source.emit()
    await settle()
    expect(toasts()).toHaveLength(0)
    expect(entryLabel()).toBe(countLabel(1))
    await openList()
    expect(items()[0]!.querySelector("b")?.textContent).toBe(failed("feishu"))
    expect(items()[0]!.querySelector(".codepuppy-problems-act")?.textContent).toBe(zh["codepuppy.problems.view"])
    advance(30_000)
    await settle()
    expect(toasts(), "a connector failure never pops").toHaveLength(0)
    source.set({ feishu: { status: "connected" } })
    source.emit()
    advance(1_000)
    await settle()
    expect(entry()).toBeNull()
    expect(toasts()).toHaveLength(0)
  })

  test("AC-01: 查看 opens the Customization Center on its connectors page; the item stays until reconnect", async () => {
    const source = engine({ github: { status: "failed" } })
    mount(source)
    await settle()
    runtime.setHubSection("skills")
    await openList()
    items()[0]!.querySelector<HTMLButtonElement>(".codepuppy-problems-act")!.click()
    await settle()
    expect(runtime.hubState()).toEqual({ open: true, section: "connectors" })
    expect(entryLabel()).toBe(countLabel(1))
  })

  test("needs_auth is an attention item whose action signs in; it leaves when the action is taken", async () => {
    const source = engine({ notion: { status: "needs_auth" } })
    mount(source)
    await settle()
    await openList()
    expect(items()[0]!.querySelector("b")?.textContent).toBe(zh["codepuppy.problems.connectorNeedsAuth"].replace("{{name}}", "notion"))
    source.set({ notion: { status: "connected" } })
    items()[0]!.querySelector<HTMLButtonElement>(".codepuppy-problems-act")!.click()
    await settle()
    expect(source.auths).toEqual(["notion"])
    expect(entry()).toBeNull()
  })

  test("AC-05: two connectors failing at startup and reconnecting inside the window: no status request, no toast, no mark", async () => {
    runtime.beginStartupQuiet()
    const source = engine({ feishu: { status: "failed" }, github: { status: "failed" } })
    mount(source)
    for (let at = 0; at < 9_000; at += 1_000) {
      await settle()
      expect(source.statusReads, "an MCP status request was made inside the quiet window").toHaveLength(0)
      expect(toasts()).toHaveLength(0)
      expect(entry()).toBeNull()
      advance(1_000)
    }
    source.set({ feishu: { status: "connected" }, github: { status: "connected" } })
    for (let at = 9_000; at < 30_000; at += 1_000) {
      advance(1_000)
      await settle()
      expect(toasts()).toHaveLength(0)
      expect(entry()).toBeNull()
    }
    expect(source.statusReads.length, "the first read happens once the window ends").toBeGreaterThan(0)
  })

  test("a service that is off on purpose is not a problem: user-disabled connector and the kill-switched cloud service", async () => {
    // 2.x 引擎对配置 `disabled: true` 的服务报 `{ status: "disabled" }`(packages/core/src/mcp/index.ts 启动 reconcile
    // 与 replaceServer 两处);kill-switch 下注入面写的云服务中和条目 `WITHHELD_CLOUD_MCP` 正是 `disabled: true`,
    // 服务名 `codepuppy`。用户在定制中心关掉的连接器走 disconnect,同样报 `disabled`。
    runtime.beginStartupQuiet()
    const source = engine({ codepuppy: { status: "disabled" }, notion: { status: "disabled" }, feishu: { status: "failed" } })
    mount(source)
    advance(10_000)
    await settle()
    expect(source.statusReads.length).toBeGreaterThan(0)
    expect(entryLabel(), "only the genuinely failed connector is listed").toBe(countLabel(1))
    // 用户把正在失败的那一个也关掉 → 它离开入口,入口为空。
    source.set({ codepuppy: { status: "disabled" }, notion: { status: "disabled" }, feishu: { status: "disabled" } })
    source.emit("mcp.status.changed")
    await settle()
    expect(entry()).toBeNull()
    expect(toasts()).toHaveLength(0)
  })

  test("AC-06: a connector still failing after the window is listed (count 1, cause and action); no toast", async () => {
    runtime.beginStartupQuiet()
    const start = Date.now()
    const source = engine({ feishu: { status: "failed" } })
    mount(source)
    advance(9_999)
    await settle()
    expect(source.statusReads).toHaveLength(0)
    expect(entry()).toBeNull()
    advance(1)
    await settle()
    expect(source.statusReads[0]! - start).toBe(10_000)
    expect(entryLabel()).toBe(countLabel(1))
    expect(toasts()).toHaveLength(0)
    await openList()
    expect(items()[0]!.querySelector("b")?.textContent).toBe(failed("feishu"))
    expect(items()[0]!.querySelector(".codepuppy-problems-act")).not.toBeNull()
    advance(30_000)
    await settle()
    expect(toasts()).toHaveLength(0)
  })
})

test("production wiring: index.tsx mounts the connector watcher inside the app", () => {
  const source = readFileSync(join(import.meta.dir, "../index.tsx"), "utf8")
  const watcher = source.indexOf("<BackgroundProblemWatcher server={sidebarServer} />")
  expect(watcher).toBeGreaterThan(source.indexOf("<AppInterface"))
  expect(watcher).toBeLessThan(source.indexOf("</AppInterface>"))
})
