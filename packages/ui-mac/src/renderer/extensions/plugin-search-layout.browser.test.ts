import { afterAll, beforeAll, expect, test } from "bun:test"
import { resolve, sep } from "node:path"
import { chromium, type Browser } from "playwright-core"
import { dict } from "../i18n/zh"

// The approved #search frame loads production CSS. Use the shipped placeholder and a real
// browser's font/layout metrics: happy-dom has no geometry and cannot detect truncation.
const repo = resolve(import.meta.dir, "../../../../..")
let browser: Browser
let server: ReturnType<typeof Bun.serve>
beforeAll(async () => {
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = resolve(repo, "." + new URL(request.url).pathname)
    if (!path.startsWith(repo + sep)) return new Response(null, { status: 404 })
    const file = Bun.file(path)
    return await file.exists() ? new Response(file) : new Response(null, { status: 404 })
  } })
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ??
    (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined) })
}, 60_000)
afterAll(async () => { await browser?.close(); server?.stop(true) })

test("the shipped search placeholder fits the approved header at the default window size", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: "zh-CN" })
  try {
    await page.goto(new URL("docs/design/2026-11-15-plugin-package-install-and-card/frame.html#search", server.url).href)
    const input = page.locator("#search .codepuppy-ext-search input")
    await input.evaluate((element, placeholder) => {
      const field = element as HTMLInputElement
      field.placeholder = placeholder
      field.value = ""
    }, dict["codepuppy.ext.sourceSearchPlaceholder"])
    await page.evaluate(() => document.fonts.ready)
    const box = await input.evaluate(element => {
      const field = element as HTMLInputElement
      const style = getComputedStyle(field)
      const context = document.createElement("canvas").getContext("2d")!
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      return { height: field.parentElement!.getBoundingClientRect().height, placeholder: field.placeholder, available: field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        required: context.measureText(field.placeholder).width + (parseFloat(style.letterSpacing) || 0) * Array.from(field.placeholder).length }
    })
    expect(box.height).toBe(34)
    expect(box.placeholder).toBe("搜索插件、技能或 MCP")
    expect(box.available).toBeGreaterThanOrEqual(box.required)
  } finally { await page.close() }
})
