// AC-07 / #onboarding:首次引导卡用小狗图标(不是「α」方块),三步是发丝线分隔的行,
// 跳过的文字是「跳过，使用自己的 API 密钥」,没有 BYOK / Key 这类工程词。真 Solid 挂载,文案取生产中文词典。
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import appPlugin from "@opencode-ai/app/vite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "vite"
import type { createComponent } from "solid-js"
import type { render } from "solid-js/web"
import type { CodePuppyOnboarding } from "./CodePuppyOnboarding"
import type { setLocale } from "../i18n"

type TestRuntime = {
  createComponent: typeof createComponent
  render: typeof render
  CodePuppyOnboarding: typeof CodePuppyOnboarding
  resetAuthRecoveryForTests: () => void
  setLocale: typeof setLocale
}

const runtimeDirectory = mkdtempSync(join(tmpdir(), "codepuppy-onboarding-render-"))
await build({
  configFile: false,
  logLevel: "silent",
  plugins: [appPlugin.at(-1)!],
  build: {
    emptyOutDir: true,
    outDir: runtimeDirectory,
    lib: {
      entry: join(import.meta.dir, "onboarding-test-runtime.ts"),
      formats: ["es"],
      fileName: () => "onboarding-test-runtime.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})

const disposers: Array<() => void> = []
GlobalRegistrator.register()
const runtime = (await import(pathToFileURL(join(runtimeDirectory, "onboarding-test-runtime.js")).href)) as TestRuntime
runtime.setLocale("zh")

const flush = async () => {
  for (let n = 0; n < 4; n++) await new Promise((resolve) => setTimeout(resolve, 0))
}
let started = 0
beforeEach(() => {
  started = 0
  localStorage.clear()
  runtime.resetAuthRecoveryForTests()
  Object.defineProperty(window, "api", {
    configurable: true,
    writable: true,
    value: {
      auth: {
        getState: () => new Promise(() => {}),
        subscribe: () => () => {},
        start: () => {
          started += 1
          return Promise.resolve()
        },
      },
    },
  })
})
afterEach(async () => {
  disposers.splice(0).forEach((dispose) => dispose())
  await flush()
  document.body.replaceChildren()
  Reflect.deleteProperty(window, "api")
})
afterAll(() => {
  GlobalRegistrator.unregister()
  rmSync(runtimeDirectory, { recursive: true, force: true })
})

function mount() {
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(runtime.render(() => runtime.createComponent(runtime.CodePuppyOnboarding, {}), host))
}
const card = () => document.querySelector<HTMLElement>("[data-codepuppy-onboarding] .a-ob-card")

describe("首次引导卡 #onboarding", () => {
  test("小狗图标 + 三步 + 登录 + 「跳过，使用自己的 API 密钥」;没有 α 方块与工程词", async () => {
    mount()
    await flush()
    const root = card()!
    expect(root).not.toBeNull()
    const mark = root.querySelector<HTMLImageElement>("img.a-ob-mark")!
    expect(mark).not.toBeNull()
    // 生产构建里品牌图是内联的 data URI;测试构建同理 —— 只认「是一张 png」,不认路径。
    expect(mark.getAttribute("src")).toMatch(/^data:image\/png|brand-mark/)
    expect(root.textContent).not.toContain("α")
    expect([...root.querySelectorAll(".a-ob-step")].map((step) => step.textContent)).toEqual([
      "1登录账号进行中",
      "2选择模型",
      "3打开第一个项目",
    ])
    expect(root.querySelector(".a-ob-step.now")?.textContent).toContain("登录账号")
    expect(root.querySelector(".a-btn")!.textContent).toBe("登录")
    expect(root.querySelector(".a-ob-skip")!.textContent).toBe("跳过，使用自己的 API 密钥")
    expect(root.textContent).not.toMatch(/BYOK|Key/)
  })

  test("默认焦点不在任何按钮上:启动即在前台时,误触 Enter 不会发起登录", async () => {
    mount()
    await flush()
    const active = document.activeElement as HTMLElement
    expect(active).toBe(card())
    expect(active.tagName).not.toBe("BUTTON")
    active.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await flush()
    expect(started).toBe(0)
  })

  test("跳过 = 收起并记住(不再弹);登录钮发起真实登录", async () => {
    mount()
    await flush()
    card()!.querySelector<HTMLButtonElement>(".a-btn")!.click()
    expect(started).toBe(1)
    card()!.querySelector<HTMLButtonElement>(".a-ob-skip")!.click()
    await flush()
    expect(card()).toBeNull()
    expect(localStorage.getItem("codepuppy.onboarding.done")).toBe("1")
  })
})
