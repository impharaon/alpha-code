import { createServer } from "vite"
import { chromium } from "playwright-core"
import { resolve } from "node:path"
import { homedir } from "node:os"
const here = new URL(".", import.meta.url).pathname
const server = await createServer({ configFile: resolve(here, "pages.vite.config.ts"), logLevel: "info" })
await server.listen()
const browser = await chromium.launch({ executablePath: resolve(homedir(), "Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing") })
const page = await browser.newPage()
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 600)))
page.on("console", (m) => console.log("CONSOLE", m.type(), m.text().slice(0, 400)))
page.on("requestfailed", (r) => console.log("REQFAIL", r.url().slice(0, 200)))
await page.goto(`http://localhost:${server.config.server.port}/pages.html?scene=${process.argv[2] ?? "not-found"}`, { waitUntil: "load" })
await page.waitForTimeout(8000)
console.log(await page.evaluate(() => document.body.innerText.slice(0, 300)))
await browser.close(); await server.close()
