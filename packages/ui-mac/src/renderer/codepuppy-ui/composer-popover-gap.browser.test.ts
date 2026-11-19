import { afterAll, beforeAll, expect, test } from "bun:test"
import { resolve } from "node:path"
import { chromium, type Browser, type Page } from "playwright-core"
import { createServer, type ViteDevServer } from "vite"

// 界面优化 BR-04(SPEC-desktop-ui-refresh,冻结稿 #session / #plus-menu):对话页输入框的弹层一律朝上,下沿停在
// 输入框上沿之上 6px。挂的是 test-visual/main.tsx 的 composer-session 场景 —— 生产 CodePuppyComposerRuntime 装在
// 会话页同一套 dock 外壳里(.a-swk-composer-dock › .a-swk-composer-host › .a-swk-dock)+ 生产 CSS,只桩数据与 IPC。
// happy-dom 没有几何,只能在真浏览器里量。量的是**入场动画结束后**的终态:.a-pop 的 a-pop-in 首帧带
// translateY(6px) scale(0.98),那一帧下沿恰好贴住输入框(0px、宽 ×0.98)—— 0.2.4 实包验收量到的 0px / 333.2 宽
// 就是这一帧(窗口没在出帧),不是终态版式。
let browser: Browser
let server: ViteDevServer
let base: string

beforeAll(async () => {
  server = await createServer({
    configFile: resolve("test-visual/vite.config.ts"),
    envFile: false,
    logLevel: "error",
    server: { port: 0, strictPort: false },
  })
  await server.listen()
  base = server.resolvedUrls!.local[0]!
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ??
      (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined),
  })
}, 180_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

const POPOVERS = [
  { name: "「+」菜单", trigger: ".a-comp-bar .a-chip-icon", popover: ".a-comp-auto" },
  { name: "权限档", trigger: ".a-chip-perm", popover: ".a-pop-fixed" },
  { name: "模型", trigger: ".a-chip-model", popover: ".a-pop-fixed" },
  { name: "推理强度", trigger: "[data-kind='effort'] .a-chip", popover: ".a-pop-fixed" },
] as const

async function settledGap(page: Page, trigger: string, popover: string) {
  await page.locator(trigger).first().click()
  await page.locator(popover).first().waitFor({ state: "visible" })
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)))
  return page.evaluate((selector) => {
    const composer = document.querySelector(".a-comp")!.getBoundingClientRect()
    const menu = document.querySelector(selector)!.getBoundingClientRect()
    return { gap: composer.top - menu.bottom, above: menu.top < composer.top, height: menu.height }
  }, popover)
}

for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
  test(`BR-04 对话页 ${size.width}×${size.height}:+ / 权限 / 模型 / 推理强度弹层朝上,终态下沿离输入框上沿 6px`, async () => {
    const page = await browser.newPage({ viewport: size, locale: "zh-CN" })
    try {
      await page.goto(`${base}?scene=composer-session`, { waitUntil: "networkidle" })
      await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true)
      for (const item of POPOVERS) {
        const measured = await settledGap(page, item.trigger, item.popover)
        expect(measured.height, `${item.name}没有打开 —— 本次测量作废`).toBeGreaterThan(20)
        expect(measured.above, `${item.name}应朝上展开`).toBe(true)
        expect(Math.abs(measured.gap - 6), `${item.name}与输入框间距 ${measured.gap}px`).toBeLessThanOrEqual(0.5)
        await page.keyboard.press("Escape")
        await page.locator(item.popover).first().waitFor({ state: "detached" })
      }
    } finally {
      await page.close()
    }
  })
}
