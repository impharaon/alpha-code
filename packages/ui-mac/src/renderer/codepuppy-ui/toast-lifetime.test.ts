// `#1687` SPEC-error-message-lifetime v1 段一:弹出提示的去留与同因合并。
// 真挂生产 ToastViewport + ToastRouteFollower(vite 构建同 composer-a11y.test.ts),对真 DOM 断言;
// 计时用 bun 的假定时器(`advanceTimersByTime` 同时推进 Date.now,暂停的剩余时间按它算)。
// 后台状态来源用公开入口 `reportProblem` / `resolveProblem` 注册测试来源(工具服务连接的观察件待 R4 裁决)。
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import appPlugin from "@opencode-ai/app/vite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "vite"
import type * as Runtime from "./toast-lifetime-test-runtime"

const runtimeDirectory = mkdtempSync(join(tmpdir(), "codepuppy-toast-lifetime-"))
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
const pushed: number[] = []

function mount() {
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(runtime.render(() => runtime.RoutedToastHarness(), host))
}

function report(key: string, title: string, detail?: string) {
  problemKeys.push(key)
  runtime.reportProblem({ key, title, detail })
}

const toasts = (title: string) =>
  [...document.querySelectorAll<HTMLElement>(".a-toast")].filter((el) => el.querySelector("b")?.textContent === title)
const advance = (ms: number) => jest.advanceTimersByTime(ms)
/** 路由的位置更新经 transition 落地,要让出微任务(假定时器下 setTimeout 不会自己跑)。 */
async function leavePage(path: string) {
  runtime.navigateTo(path)
  for (let i = 0; i < 5; i++) {
    advance(0)
    await Promise.resolve()
  }
}

beforeEach(() => {
  jest.useFakeTimers()
  runtime.navigateTo("/a")
  mount()
})

afterEach(() => {
  problemKeys.splice(0).forEach((key) => runtime.resolveProblem(key))
  pushed.splice(0).forEach((id) => runtime.dismissToast(id))
  disposers.splice(0).forEach((dispose) => dispose())
  document.body.replaceChildren()
  jest.useRealTimers()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
  rmSync(runtimeDirectory, { recursive: true, force: true })
})

describe("#1687 background problems", () => {
  test("AC-02 (toast side): a background problem folds after 8 s", () => {
    expect(runtime.TOAST_BACKGROUND_MS).toBe(8000)
    report("test:folds", "后台故障")
    expect(toasts("后台故障")).toHaveLength(1)
    expect(toasts("后台故障")[0]!.hasAttribute("data-persistent")).toBe(false)
    advance(7_999)
    expect(toasts("后台故障")).toHaveLength(1)
    advance(1)
    expect(toasts("后台故障")).toHaveLength(0)
  })

  test("AC-01 / BR-01: recovery clears the shown toast within 1 s", () => {
    report("test:recover", "工具服务断开")
    advance(2_000)
    expect(toasts("工具服务断开")).toHaveLength(1)
    runtime.resolveProblem("test:recover")
    advance(1_000)
    expect(toasts("工具服务断开")).toHaveLength(0)
    // 恢复后同因再发生是一次新问题:照常弹出。
    report("test:recover", "工具服务断开")
    expect(toasts("工具服务断开")).toHaveLength(1)
  })

  test("AC-03: hover and keyboard focus pause the countdown; it resumes from the remainder", () => {
    report("test:hover", "悬停的故障")
    advance(3_000)
    const toast = () => toasts("悬停的故障")[0]
    toast()!.dispatchEvent(new MouseEvent("mouseenter"))
    advance(20_000)
    expect(toast()).toBeDefined()
    toast()!.dispatchEvent(new MouseEvent("mouseleave"))
    advance(4_900)
    expect(toast()).toBeDefined()
    toast()!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    advance(20_000)
    expect(toast()).toBeDefined()
    toast()!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
    advance(99)
    expect(toast()).toBeDefined()
    advance(2)
    expect(toast()).toBeUndefined()
  })

  test("AC-04 (toast side): the same cause reported 3 times in 1 s is one toast, updated, not re-timed", () => {
    report("test:same", "同一原因", "第一次")
    advance(400)
    report("test:same", "同一原因", "第二次")
    advance(400)
    report("test:same", "同一原因", "第三次")
    expect(toasts("同一原因")).toHaveLength(1)
    expect(toasts("同一原因")[0]!.querySelector("small")?.textContent).toBe("第三次")
    advance(8_000 - 800)
    expect(toasts("同一原因")).toHaveLength(0)
  })

  test("AC-10 (toast side): once folded and unresolved, the same cause does not pop again", () => {
    report("test:folded", "已收起的故障")
    advance(8_000)
    expect(toasts("已收起的故障")).toHaveLength(0)
    report("test:folded", "已收起的故障")
    expect(toasts("已收起的故障")).toHaveLength(0)
  })

  test("AC-11 (toast side): × closes the toast and the problem stays unresolved", () => {
    report("test:close", "点掉的故障")
    toasts("点掉的故障")[0]!.querySelector<HTMLButtonElement>(".a-toast-x")!.click()
    expect(toasts("点掉的故障")).toHaveLength(0)
    // 仍未恢复:同因再报不弹(入口计数在段二断言)。
    report("test:close", "点掉的故障")
    expect(toasts("点掉的故障")).toHaveLength(0)
  })

  test("leaving the page does not close a background problem toast", async () => {
    report("test:route", "换页的故障")
    pushed.push(runtime.pushToast({ kind: "error", title: "对照:操作失败" }))
    await leavePage("/b")
    expect(toasts("对照:操作失败"), "the page change never reached the follower — the check below would be vacuous").toHaveLength(0)
    expect(toasts("换页的故障")).toHaveLength(1)
  })
})

describe("#1687 user-action toasts", () => {
  test("AC-07: a failed user action stays past 8 s until closed or the page is left", async () => {
    pushed.push(runtime.pushToast({ kind: "error", title: "删除失败" }))
    expect(toasts("删除失败")[0]!.getAttribute("data-persistent")).toBe("true")
    advance(60_000)
    expect(toasts("删除失败")).toHaveLength(1)
    await leavePage("/b")
    expect(toasts("删除失败")).toHaveLength(0)
  })

  test("AC-07: × closes it", () => {
    pushed.push(runtime.pushToast({ kind: "error", title: "重命名失败" }))
    toasts("重命名失败")[0]!.querySelector<HTMLButtonElement>(".a-toast-x")!.click()
    expect(toasts("重命名失败")).toHaveLength(0)
  })

  test("BR-03: the same user-action message shown twice is one toast; a confirmation is not re-timed", () => {
    pushed.push(runtime.pushToast({ kind: "error", title: "发送失败" }))
    pushed.push(runtime.pushToast({ kind: "error", title: "发送失败" }))
    expect(toasts("发送失败")).toHaveLength(1)
    pushed.push(runtime.pushToast({ kind: "success", title: "已复制" }))
    advance(3_000)
    pushed.push(runtime.pushToast({ kind: "success", title: "已复制" }))
    expect(toasts("已复制")).toHaveLength(1)
    advance(1_000)
    expect(toasts("已复制")).toHaveLength(0)
  })

  test("leaving the page does not cut a self-expiring confirmation short", async () => {
    pushed.push(runtime.pushToast({ kind: "success", title: "已保存" }))
    pushed.push(runtime.pushToast({ kind: "error", title: "对照:操作失败" }))
    await leavePage("/b")
    expect(toasts("对照:操作失败"), "the page change never reached the follower — the check below would be vacuous").toHaveLength(0)
    expect(toasts("已保存")).toHaveLength(1)
  })
})

test("production wiring: index.tsx mounts the route follower inside the app's router, next to the viewport", () => {
  // 上面的用例挂的是同形 harness;这一条守住生产挂载点本身(删掉 index.tsx 那一行 ⇒ 红)。
  const source = readFileSync(join(import.meta.dir, "../index.tsx"), "utf8")
  const app = source.indexOf("<AppInterface")
  const follower = source.indexOf("<ToastRouteFollower />")
  expect(app).toBeGreaterThan(-1)
  expect(follower).toBeGreaterThan(app)
  expect(follower).toBeLessThan(source.indexOf("</AppInterface>"))
})
