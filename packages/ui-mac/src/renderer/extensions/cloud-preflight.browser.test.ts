import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import { chromium, type Browser, type Page } from "playwright-core"
import { createServer, type ViteDevServer } from "vite"

// alpha-code#1686:两种云发送框预检区与账户弹层卡片的**几何**检查(不是截图比对)。挂的是生产组件 + 生产 CSS
// (test-visual/cloud-preflight.tsx,只桩 IPC 与数据),在本机 Chrome 里量。期望值是在同一台机器的 headless
// Chrome 里打开 owner 2026-11-13 批准的帧(alpha-code a35bb81c26:
// docs/design/2026-11-13-1686-cloud-form-preflight-r3/frame.html 的 #form-ok / #form-wallet / #legacy-ok /
// #row-form-running,以及 docs/design/2026-11-13-library-card-kv/frame.html#popover 的「改后」)实测的数,
// 宽度同帧(880)。截图另存 node_modules/.cache/1686-preflight/ 供人核对,不参与判定。
const evidence = resolve("node_modules/.cache/1686-preflight")
let browser: Browser
let server: ViteDevServer
let base: string

beforeAll(async () => {
  rmSync(evidence, { recursive: true, force: true })
  mkdirSync(evidence, { recursive: true })
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

const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.5)

async function open(query: string, theme: "light" | "dark" = "light") {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, locale: "zh-CN", colorScheme: theme })
  await page.goto(`${base}cloud-preflight.html?${query}${theme === "dark" ? "&theme=dark" : ""}`, { waitUntil: "networkidle" })
  return page
}

/** 预检区与按钮行的量表(与帧里量的是同一组量)。 */
function measure(page: Page) {
  return page.evaluate(() => {
    const r = (element: Element | null) => element?.getBoundingClientRect()
    const box = document.querySelector("[data-harness-box]")!
    const card = box.querySelector(".a-card")
    const banner = box.querySelector(".a-banner")
    const row = box.querySelector(".codepuppy-ext-cloudrun")!
    const primary = row.querySelector("[data-variant=primary]")!
    const input = box.querySelector("textarea")
    const round = (n: number) => Math.round(n * 10) / 10
    const items = Array.from(row.children).filter((child) => !child.matches(".a-card, .a-banner, label"))
    return {
      card: card ? round(r(card)!.height) : null,
      rows: Array.from(box.querySelectorAll(".a-kv-row"), (element) => round(r(element)!.height)),
      banner: banner ? round(r(banner)!.height) : null,
      cardToBanner: card && banner ? round(r(banner)!.top - r(card)!.bottom) : null,
      bannerToPrimary: banner ? round(r(primary)!.top - r(banner)!.bottom) : null,
      cardBelowInput: card && input ? r(card)!.top >= r(input)!.bottom : null,
      primaryRightGap: round(r(row)!.right - r(primary)!.right),
      primaryIsRightmost: items.every((item) => r(item)!.right <= r(primary)!.right + 0.5),
    }
  })
}

const FRAME = {
  // r3 #form-ok / #legacy-ok:卡片四行 25.5、卡片 128、能发提示条 54.5;目录表单与输入框分支在按钮行里(间距 10),
  // 代码审查在按钮行之前(卡片→提示条 8、提示条→按钮 14)。
  ok: { card: 128, row: 25.5, banner: 54.5 },
  // r3 #form-wallet:没有会员两行卡片 77,两行说明的提示条 72.9。
  wallet: { card: 77, row: 25.5, banner: 72.9 },
  // D1(owner 2026-11-13)的新状态:warning、一行说明、没有按钮 —— 与 r3 #form-suspended / #legacy-suspended
  // 同形,帧实测卡片 128、提示条 54.5,间距同上。
  uncopied: { card: 128, row: 25.5, banner: 54.5 },
}

for (const box of ["form", "legacy", "code-review"] as const) {
  const inRow = box !== "code-review"
  for (const theme of ["light", "dark"] as const) {
    test(`#1686 ${box} ${theme}: preflight geometry matches the approved frame; the primary button is rightmost`, async () => {
      for (const state of ["ok", "wallet", "uncopied"] as const) {
        const page = await open(`box=${box}&state=${state}`, theme)
        try {
          await page.locator(".a-banner").waitFor()
          const m = await measure(page)
          await page.screenshot({ path: resolve(evidence, `${box}-${state}-${theme}.png`), fullPage: true })
          near(m.card!, FRAME[state].card)
          m.rows.forEach((height) => near(height, FRAME[state].row))
          near(m.banner!, FRAME[state].banner)
          near(m.cardToBanner!, inRow ? 10 : 8)
          near(m.bannerToPrimary!, inRow ? 10 : 14)
          if (box !== "code-review") expect(m.cardBelowInput).toBe(true)
          near(m.primaryRightGap, 0)
          expect(m.primaryIsRightmost).toBe(true)
        } finally {
          await page.close()
        }
      }
    }, 60_000)
  }

  test(`#1686 ${box}: running keeps the card only, cancel sits left of the rightmost primary`, async () => {
    const page = await open(`box=${box}&state=ok`)
    try {
      await page.locator(".a-banner").waitFor()
      if (box !== "code-review") await page.locator("textarea").fill("2026 年国内中小企业使用 AI 编程助手的情况")
      await page.locator(".codepuppy-ext-cloudrun [data-variant=primary]").click()
      await page.locator("[data-cancel-job]").waitFor()
      const m = await measure(page)
      await page.screenshot({ path: resolve(evidence, `${box}-running.png`), fullPage: true })
      near(m.card!, FRAME.ok.card)
      expect(m.banner).toBeNull()
      near(m.primaryRightGap, 0)
      expect(m.primaryIsRightmost).toBe(true)
      const cancelLeftOfPrimary = await page.evaluate(() => {
        const cancel = document.querySelector("[data-cancel-job]")!.getBoundingClientRect()
        const primary = document.querySelector(".codepuppy-ext-cloudrun [data-variant=primary]")!.getBoundingClientRect()
        return cancel.right <= primary.left
      })
      expect(cancelLeftOfPrimary).toBe(true)
    } finally {
      await page.close()
    }
  }, 60_000)

  // R1 m5:主按钮视觉最右靠 CSS order;键盘 Tab 顺序保持原样 —— 主按钮在前、次按钮其次、「取消任务」最后。
  test(`#1686 ${box}: keyboard order keeps the primary first while it sits rightmost`, async () => {
    const page = await open(`box=${box}&state=ok`)
    try {
      await page.locator(".a-banner").waitFor()
      const focused = () =>
        page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          return el?.matches("[data-variant=primary]") ? "primary" : el?.matches("[data-cloud-secondary]") ? "secondary" : el?.matches("[data-cancel-job]") ? "cancel" : el?.tagName.toLowerCase()
        })
      if (box === "code-review") {
        await page.locator(".codepuppy-ext-cloudrun [data-variant=primary]").focus()
        expect(await focused()).toBe("primary")
        await page.keyboard.press("Tab")
        expect(await focused()).toBe("secondary")
      } else {
        await page.locator("textarea").fill("2026 年国内中小企业使用 AI 编程助手的情况")
        await page.locator("textarea").focus()
        await page.keyboard.press("Tab")
        expect(await focused()).toBe("primary")
        await page.keyboard.press("Enter")
        await page.locator("[data-cancel-job]").waitFor()
        await page.locator("textarea").focus()
        await page.keyboard.press("Tab")
        // 执行中主按钮被禁用、跳过;下一个可聚焦的是视觉上在它左边的「取消任务」。
        expect(await focused()).toBe("cancel")
      }
      const m = await measure(page)
      near(m.primaryRightGap, 0)
      expect(m.primaryIsRightmost).toBe(true)
    } finally {
      await page.close()
    }
  }, 60_000)

  test(`#1686 ${box}: not ready shows the sign-in note left of the rightmost primary and no preflight`, async () => {
    const page = await open(`box=${box}&state=not-ready`)
    try {
      await page.locator(".codepuppy-ext-cloudrun [data-variant=primary]").waitFor()
      const m = await measure(page)
      expect(m.card).toBeNull()
      expect(m.banner).toBeNull()
      near(m.primaryRightGap, 0)
      expect(m.primaryIsRightmost).toBe(true)
    } finally {
      await page.close()
    }
  }, 60_000)
}

// 组件稿 #popover「改后」实测:卡片 282 × 164.5、四个文字行 25.5、走势行 36.5、读取中的值 11.5px。
for (const theme of ["light", "dark"] as const) {
  test(`#1686 account popover card ${theme}: same geometry as the approved component frame`, async () => {
    for (const state of ["value", "pending"] as const) {
      const page = await open(`scene=popover&state=${state}`, theme)
      try {
        await page.locator(".a-card").waitFor()
        const m = await page.evaluate(() => {
          const pop = document.querySelector("[data-harness-popover]")!.getBoundingClientRect()
          const card = document.querySelector(".a-card")!.getBoundingClientRect()
          const rows = Array.from(document.querySelectorAll(".a-kv-row"), (row) => Math.round(row.getBoundingClientRect().height * 10) / 10)
          const pending = document.querySelector(".a-kv-v[data-state=pending]")
          return {
            left: card.left - pop.left,
            top: card.top - pop.top,
            width: Math.round(card.width * 10) / 10,
            height: Math.round(card.height * 10) / 10,
            rows,
            pendingFont: pending ? getComputedStyle(pending).fontSize : null,
          }
        })
        await page.screenshot({ path: resolve(evidence, `popover-${state}-${theme}.png`) })
        near(m.left, 15) // 弹层边框 1 + 外边距 14,与改前相同
        near(m.top, 13) // 弹层边框 1 + padding-top 12(帧外壳)
        near(m.width, 282)
        near(m.height, 164.5)
        expect(m.rows.slice(0, 4).every((height) => Math.abs(height - 25.5) <= 0.5)).toBe(true)
        near(m.rows[4]!, 36.5)
        expect(m.pendingFont).toBe(state === "pending" ? "11.5px" : null)
      } finally {
        await page.close()
      }
    }
  }, 60_000)
}
