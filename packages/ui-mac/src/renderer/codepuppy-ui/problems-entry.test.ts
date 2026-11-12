// `#1687` SPEC-error-message-lifetime v1 段二:未恢复问题入口与启动静默。
// 真挂生产 ToastViewport + ToastRouteFollower + ProblemsEntry(vite 构建同 toast-lifetime.test.ts),对真 DOM 断言;
// 假定时器推进时间。后台来源用公开入口 `reportProblem` / `resolveProblem` 注册测试来源 —— 工具服务连接的
// 观察件待 owner 裁决 R4,AC-05/06 的启动行为用「窗口内失败、随后恢复 / 一直失败」的测试来源证明。
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

const runtimeDirectory = mkdtempSync(join(tmpdir(), "codepuppy-problems-entry-"))
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

const disposers: Array<() => void> = []
const problemKeys: string[] = []
let page = 0

const advance = (ms: number) => jest.advanceTimersByTime(ms)
/** 只让出微任务,不推进假时钟(时刻断言要精确到毫秒)。 */
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
async function leavePage() {
  runtime.navigateTo(`/page-${++page}`)
  await settle()
}
function report(key: string, title: string, detail?: string, action?: { label: string; run: () => void }) {
  problemKeys.push(key)
  runtime.reportProblem({ key, title, detail, action })
}
const toasts = () => [...document.querySelectorAll<HTMLElement>(".a-toast")]
const entry = () => document.querySelector<HTMLButtonElement>(".codepuppy-problems-entry")
const entryLabel = () => entry()?.querySelector(".codepuppy-problems-label")?.textContent
const countLabel = (count: number) => zh["codepuppy.problems.entry"].replace("{{count}}", String(count))
const pop = () => document.querySelector<HTMLElement>(".codepuppy-problems-pop")
const items = () => [...document.querySelectorAll<HTMLElement>(".codepuppy-problems-item")]
async function openList() {
  entry()!.click()
  await settle()
  expect(pop()).not.toBeNull()
}
function foldByClose(title: string) {
  toasts()
    .find((el) => el.querySelector("b")?.textContent === title)!
    .querySelector<HTMLButtonElement>(".a-toast-x")!
    .click()
}

beforeAll(() => runtime.setLocale("zh"))

beforeEach(async () => {
  jest.useFakeTimers()
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(runtime.render(() => runtime.RoutedToastHarness(), host))
  await settle()
})

afterEach(async () => {
  problemKeys.splice(0).forEach((key) => runtime.resolveProblem(key))
  await leavePage()
  disposers.splice(0).forEach((dispose) => dispose())
  document.body.replaceChildren()
  jest.useRealTimers()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
  rmSync(runtimeDirectory, { recursive: true, force: true })
})

describe("#1687 unresolved-problems entry", () => {
  test("no unresolved problem ⇒ the entry row does not exist", () => {
    expect(entry()).toBeNull()
  })

  test("AC-02: after 8 s the toast folds, the entry shows 1, and the list shows its cause and action", async () => {
    const retried: string[] = []
    report("test:catalog", "平台模型清单暂时取不到", "网络连接失败", { label: "重试", run: () => retried.push("retry") })
    expect(entry(), "the entry counts only once the toast folds").toBeNull()
    advance(8_000)
    await settle()
    expect(toasts()).toHaveLength(0)
    expect(entryLabel()).toBe(countLabel(1))
    await openList()
    expect(items()).toHaveLength(1)
    expect(items()[0]!.querySelector("b")?.textContent).toBe("平台模型清单暂时取不到")
    expect(items()[0]!.querySelector("small")?.textContent).toBe("网络连接失败")
    // 后台问题的操作:跑它现有的处理入口,条目等恢复才离开。
    items()[0]!.querySelector<HTMLButtonElement>(".codepuppy-problems-act")!.click()
    await settle()
    expect(retried).toEqual(["retry"])
    expect(entryLabel()).toBe(countLabel(1))
  })

  test("AC-04 (entry side): the same cause reported 3 times counts 1", async () => {
    report("test:same", "同一原因")
    report("test:same", "同一原因")
    report("test:same", "同一原因")
    advance(8_000)
    await settle()
    expect(entryLabel()).toBe(countLabel(1))
  })

  test("AC-10 (entry side): folded and unresolved, the same cause again does not pop; count stays, text updates", async () => {
    report("test:again", "连接器未能连接", "第一次")
    advance(8_000)
    await settle()
    report("test:again", "连接器未能连接", "第二次")
    await settle()
    expect(toasts()).toHaveLength(0)
    expect(entryLabel()).toBe(countLabel(1))
    await openList()
    expect(items()[0]!.querySelector("small")?.textContent).toBe("第二次")
  })

  test("AC-11 (entry side): × folds into the entry; list items have no delete button", async () => {
    report("test:closed", "点掉的故障", undefined, { label: "查看", run: () => {} })
    foldByClose("点掉的故障")
    await settle()
    expect(toasts()).toHaveLength(0)
    expect(entryLabel()).toBe(countLabel(1))
    await openList()
    const buttons = [...items()[0]!.querySelectorAll("button")]
    expect(buttons.map((b) => b.className)).toEqual(["codepuppy-problems-act"])
    expect(pop()!.querySelector(".a-toast-x, [aria-label='关闭']")).toBeNull()
  })

  test("AC-08: with 2 in the open list, one recovering leaves 1; all recovering removes the row and the list", async () => {
    report("test:a", "故障 A")
    report("test:b", "故障 B")
    advance(8_000)
    await settle()
    expect(entryLabel()).toBe(countLabel(2))
    await openList()
    runtime.resolveProblem("test:a")
    await settle()
    expect(entryLabel()).toBe(countLabel(1))
    expect(items().map((li) => li.querySelector("b")?.textContent)).toEqual(["故障 B"])
    runtime.resolveProblem("test:b")
    await settle()
    expect(entry()).toBeNull()
    expect(pop()).toBeNull()
  })

  test("entry-only source form: putProblem shows no toast, counts in the entry, and resolveProblem removes it", async () => {
    // 后台来源的两种接法都不改仓与入口:提示后入口 = reportProblem;只进入口 = putProblem(attention:false)。
    runtime.putProblem({ key: "test:entry-only", title: "只进入口的后台问题", attention: false })
    await settle()
    expect(toasts()).toHaveLength(0)
    expect(entryLabel()).toBe(countLabel(1))
    await leavePage()
    expect(entryLabel(), "a background item does not leave with the page").toBe(countLabel(1))
    runtime.resolveProblem("test:entry-only")
    await settle()
    expect(entry()).toBeNull()
  })

  test("keyboard: opening moves focus to the first action; Escape closes and returns focus to the entry", async () => {
    report("test:kbd", "键盘", undefined, { label: "查看", run: () => {} })
    foldByClose("键盘")
    await settle()
    await openList()
    expect(entry()!.getAttribute("aria-expanded")).toBe("true")
    expect(document.activeElement?.className).toBe("codepuppy-problems-act")
    pop()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await settle()
    expect(pop()).toBeNull()
    expect(document.activeElement).toBe(entry())
  })
})

describe("#1687 startup quiet window", () => {
  test("AC-05: background failures inside the window that recover before it ends never show anything", async () => {
    expect(runtime.STARTUP_QUIET_MS).toBe(10_000)
    runtime.beginStartupQuiet()
    report("test:mcp-1", "「飞书」连接器未能连接")
    report("test:mcp-2", "「GitHub」连接器未能连接")
    for (let at = 0; at < 9_000; at += 1_000) {
      await settle()
      expect(toasts()).toHaveLength(0)
      expect(entry()).toBeNull()
      advance(1_000)
    }
    runtime.resolveProblem("test:mcp-1")
    runtime.resolveProblem("test:mcp-2")
    for (let at = 9_000; at < 30_000; at += 1_000) {
      advance(1_000)
      await settle()
      expect(toasts()).toHaveLength(0)
      expect(entry()).toBeNull()
    }
  })

  test("AC-06: a background failure still failing when the window ends shows one toast, then folds into the entry", async () => {
    runtime.beginStartupQuiet()
    advance(1_000)
    report("test:mcp-down", "「飞书」连接器未能连接")
    report("test:mcp-down", "「飞书」连接器未能连接")
    advance(8_999)
    await settle()
    expect(toasts()).toHaveLength(0)
    expect(entry()).toBeNull()
    advance(1)
    await settle()
    expect(toasts()).toHaveLength(1)
    advance(8_000)
    await settle()
    expect(toasts()).toHaveLength(0)
    expect(entryLabel()).toBe(countLabel(1))
  })

  test("AC-09: two attention notices inside the window go straight into the entry with their actions", async () => {
    runtime.beginStartupQuiet()
    const viewed: string[] = []
    const view = { label: zh["codepuppy.problems.view"], run: () => viewed.push("hub") }
    runtime.pushToast({ kind: "error", title: zh["codepuppy.ext.externalSkipped"], detail: "「飞书文档」未能导入", action: view })
    runtime.pushToast({ kind: "error", title: zh["codepuppy.ext.trustPersistFailed"], action: view })
    // 确认类照常(R5)。
    runtime.pushToast({ kind: "success", title: "已复制" })
    await settle()
    expect(toasts().map((el) => el.querySelector("b")?.textContent)).toEqual(["已复制"])
    advance(4_000)
    await settle()
    for (let at = 4_000; at < 10_000; at += 1_000) {
      expect(toasts()).toHaveLength(0)
      advance(1_000)
      await settle()
    }
    expect(entryLabel()).toBe(countLabel(2))
    await openList()
    expect(items().map((li) => li.querySelector(".codepuppy-problems-act")?.textContent)).toEqual(["查看", "查看"])
    // R2:需要用户处理的项,做了它的操作就离开入口。
    items()[0]!.querySelector<HTMLButtonElement>(".codepuppy-problems-act")!.click()
    await settle()
    expect(viewed).toEqual(["hub"])
    expect(entryLabel()).toBe(countLabel(1))
    items().length || (await openList())
    items()[0]!.querySelector<HTMLButtonElement>(".codepuppy-problems-act")!.click()
    await settle()
    expect(entry()).toBeNull()
  })

  test("BR-05: an attention notice without an action, entered during the window, leaves with the page", async () => {
    runtime.beginStartupQuiet()
    runtime.pushToast({ kind: "error", title: "删除失败" })
    await settle()
    expect(toasts()).toHaveLength(0)
    expect(entryLabel()).toBe(countLabel(1))
    await leavePage()
    expect(entry()).toBeNull()
    advance(10_000)
  })
})

test("R6: a platform catalog refresh failure is a background problem; refresh success clears it; 重试 calls the manual refresh", async () => {
  let publish: ((health: unknown) => void) | undefined
  const refreshes: string[] = []
  ;(window as unknown as { api: unknown }).api = {
    models: {
      refreshHealth: async () => ({ platform: { code: "network", at: "2026-11-12T00:00:00Z" }, byok: null }),
      subscribeRefreshHealth: (listener: (health: unknown) => void) => {
        publish = listener
        return () => {}
      },
      refresh: async () => void refreshes.push("manual"),
    },
  }
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(runtime.render(() => runtime.CatalogProblemWatcher(), host))
  await settle()
  const catalogToast = () => toasts().find((el) => el.querySelector("b")?.textContent === zh["codepuppy.model.catalogUnavailable"])
  expect(catalogToast()?.querySelector("small")?.textContent).toBe(zh["codepuppy.model.catalogReasonNetwork"])
  advance(8_000)
  await settle()
  await openList()
  items()[0]!.querySelector<HTMLButtonElement>(".codepuppy-problems-act")!.click()
  expect(refreshes).toEqual(["manual"])
  publish!({ platform: null, byok: null })
  await settle()
  expect(entry()).toBeNull()
})

test("production wiring: index.tsx starts the quiet window at renderer boot and mounts the catalog source", () => {
  const source = readFileSync(join(import.meta.dir, "../index.tsx"), "utf8")
  expect(source).toMatch(/^beginStartupQuiet\(\)$/m)
  const app = source.indexOf("<AppInterface")
  const watcher = source.indexOf("<CatalogProblemWatcher />")
  expect(watcher).toBeGreaterThan(app)
  expect(watcher).toBeLessThan(source.indexOf("</AppInterface>"))
})
