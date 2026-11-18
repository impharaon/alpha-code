// AC-07:打开不存在的对话显示 Code Puppy 自己的「找不到对话」(#not-found)——
// 一句话 + 「回到新对话」;不写 Local Server、对话编号、「标签页」。真 Solid 挂载,文案取生产中文词典。
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, afterEach, describe, expect, test } from "bun:test"
import appPlugin from "@opencode-ai/app/vite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "vite"
import type { createComponent } from "solid-js"
import type { render } from "solid-js/web"
import type { SessionNotFound } from "../../../../codepuppy-app/src/pages/session-not-found"
import type { setLocale, t } from "../i18n"

type TestRuntime = {
  createComponent: typeof createComponent
  render: typeof render
  SessionNotFound: typeof SessionNotFound
  setLocale: typeof setLocale
  t: typeof t
}

const runtimeDirectory = mkdtempSync(join(tmpdir(), "codepuppy-not-found-render-"))
await build({
  configFile: false,
  logLevel: "silent",
  plugins: [appPlugin.at(-1)!],
  build: {
    emptyOutDir: true,
    outDir: runtimeDirectory,
    lib: {
      entry: join(import.meta.dir, "session-not-found-test-runtime.ts"),
      formats: ["es"],
      fileName: () => "session-not-found-test-runtime.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})

const disposers: Array<() => void> = []
GlobalRegistrator.register()
const runtime = (await import(pathToFileURL(join(runtimeDirectory, "session-not-found-test-runtime.js")).href)) as TestRuntime
runtime.setLocale("zh")

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  document.body.replaceChildren()
})
afterAll(() => {
  GlobalRegistrator.unregister()
  rmSync(runtimeDirectory, { recursive: true, force: true })
})

function mount(onAction: () => void) {
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(
    runtime.render(
      () =>
        runtime.createComponent(runtime.SessionNotFound, {
          // 与 SessionErrorFallback 同一组键:这里取生产词典,词典里的词一变,这条就跟着看。
          title: runtime.t("session.error.notFound" as never),
          description: runtime.t("session.error.notFound.description" as never),
          action: runtime.t("session.error.notFound.newChat" as never),
          onAction,
        }),
      host,
    ),
  )
  return host
}

describe("找不到对话 #not-found", () => {
  test("一句话 + 回到新对话;没有 Local Server、对话编号、标签页", () => {
    const host = mount(() => {})
    const page = host.querySelector("[data-codepuppy-session-not-found]")!
    expect(page).not.toBeNull()
    expect(page.querySelector("h4")!.textContent).toBe("找不到这段对话")
    expect(page.querySelector("p")!.textContent).toBe("它可能已经被删除。")
    expect([...page.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["回到新对话"])
    expect(page.querySelector("code")).toBeNull()
    expect(page.textContent).not.toMatch(/Local Server|ses_|标签页|服务器/)
  })

  test("点「回到新对话」交给调用方的出口(只调用一次)", () => {
    const calls: string[] = []
    const host = mount(() => calls.push("back"))
    host.querySelector<HTMLButtonElement>("button")!.click()
    expect(calls).toEqual(["back"])
  })
})
