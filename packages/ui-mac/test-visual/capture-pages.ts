// 页面级视觉证据:起 pages.vite.config.ts → headless Chromium 逐场景截图(1440×900 与 1280×800,浅 / 深),
// 同时截冻结稿 frame.html 对应锚点。运行:`bun test-visual/capture-pages.ts [outDir]`(在 packages/ui-mac 下)。
// 浏览器:CHROMIUM_PATH(默认取本机 Playwright 缓存的 Chromium)。
import { createServer } from "vite"
import { chromium } from "playwright-core"
import { mkdirSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { resolve } from "node:path"
import { homedir } from "node:os"
import { readdirSync } from "node:fs"

const here = fileURLToPath(new URL(".", import.meta.url))
const out = resolve(process.argv[2] ?? "/tmp/ui-shots-pages")
const frameFile = resolve(here, "../../../docs/design/2026-11-18-ui-refresh/frame.html")
mkdirSync(out, { recursive: true })

// 名字 → 查询串;session-steps = 对话页不带批准面板(看展开的步骤列表)
const SCENES = ["session", "session-steps", "install-card", "not-found", "onboarding", "automation", "settings"] as const
const QUERY: Record<string, string> = { "session-steps": "scene=session&panel=0" }
const SIZES = [
  { w: 1440, h: 900 },
  { w: 1280, h: 800 },
]

const cache = resolve(homedir(), "Library/Caches/ms-playwright")
const guess = (() => {
  try {
    const dir = readdirSync(cache).find((name) => name.startsWith("chromium-"))
    return dir ? resolve(cache, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing") : undefined
  } catch {
    return undefined
  }
})()

const server = await createServer({ configFile: resolve(here, "pages.vite.config.ts"), logLevel: "warn" })
await server.listen()
const base = `http://localhost:${server.config.server.port}/pages.html`
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? guess })
const report: string[] = []
try {
  for (const { w, h } of SIZES) {
    for (const scene of SCENES) {
      for (const theme of ["light", "dark"]) {
        if (theme === "dark" && !["session", "session-steps", "settings"].includes(scene)) continue
        const page = await browser.newPage({ viewport: { width: w, height: h }, locale: "zh-CN" })
        const errors: string[] = []
        page.on("pageerror", (e) => errors.push(String(e)))
        page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
        await page.goto(`${base}?${QUERY[scene] ?? `scene=${scene}`}&theme=${theme}`, { waitUntil: "networkidle" })
        await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true)
        await page.waitForTimeout(900)
        await page.screenshot({ path: resolve(out, `${scene}${theme === "dark" ? "-dark" : ""}-${w}.png`) })
        report.push(`${scene} ${theme} ${w}: ${errors.length ? "ERRORS " + errors.slice(0, 3).join(" | ") : "ok"}`)
        await page.close()
      }
    }
  }
} finally {
  await browser.close()
  await server.close()
}
// 冻结稿对应锚点(逐个截图,供肉眼对照)
const browser2 = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? guess })
try {
  const page = await browser2.newPage({ viewport: { width: 1600, height: 1000 } })
  await page.goto(pathToFileURL(frameFile).href, { waitUntil: "load" })
  await page.waitForTimeout(500)
  for (const id of ["session", "session-dark", "install-card", "not-found", "onboarding", "automation", "settings"]) {
    const el = page.locator(`#${id}`)
    await el.screenshot({ path: resolve(out, `frame-${id}.png`) })
  }
} finally {
  await browser2.close()
}
console.log(report.join("\n"))
