// `#1314` 风险标签的真浏览器判据(AC-01 与已批稿对比、AC-02 在渲染结果上不是低危):
//   ① 与已批组件稿 docs/design/2026-11-13-1314-risk-tag/frame.html 逐项比较**计算样式**(浅 / 深 × 五档);
//   ② 几何:标题行高度不因标签变化、宽 440 时标签留在标题行内不换行、正文滚动时标签不动、授权框里标签与稿同大且留在行内、可读名称含档位;
//   ③ 对比度:浅 / 深 × 五档文字对比度 ≥ 4.5(与稿里实时量的同一算法:背景沿祖先逐层合成)。
// 形制同 tooltip.browser.test.ts:test-visual 的 vite + playwright-core + 本机 Chrome(CHROMIUM_PATH 或 macOS 默认路径)。
// 页面是**生产组件**(PermissionDialog / ExtStandaloneAuthzDialog / RiskTag)+ 真实 CSS,只有数据与 IPC 是桩。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { chromium, type Browser, type Page } from "playwright-core"
import { createServer, type ViteDevServer } from "vite"

const evidence = resolve("node_modules/.cache/1314-risk-tag")
const frameURL = pathToFileURL(resolve("../../docs/design/2026-11-13-1314-risk-tag/frame.html")).href
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
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

type Level = "low" | "medium" | "high" | "critical" | "unknown"
type Theme = "light" | "dark"
const LEVELS: Level[] = ["low", "medium", "high", "critical", "unknown"]
const THEMES: Theme[] = ["light", "dark"]
// 批准面板的分类参数(test-visual/main.tsx 的 ?risk=):unknown 取「请求不带分类」。
const RISK_PARAM: Record<Level, string> = { low: "low", medium: "medium", high: "high", critical: "critical", unknown: "none" }
const TEXT: Record<Level, string> = { low: "低风险", medium: "中风险", high: "高风险", critical: "极高风险", unknown: "风险未知" }

async function open(width: number, height: number, query: string, theme: Theme) {
  const page = await browser.newPage({ viewport: { width, height }, locale: "zh-CN" })
  await page.goto(`${base}?${query}&theme=${theme}`, { waitUntil: "networkidle" })
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true)
  await page.waitForTimeout(450) // 面板锚定与授权框滑入动画
  return page
}

/** 稿里实时量对比度的同一算法:背景沿祖先逐层合成(浏览器给的计算色),再算 WCAG 相对亮度比。 */
const TAG_FACTS = `(tag) => {
  const rgba = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const mix = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 })
  const lum = (c) => { const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const chain = []
  for (let n = tag; n && n.nodeType === 1; n = n.parentElement) chain.unshift(n)
  let back = { r: 255, g: 255, b: 255, a: 1 }
  for (const n of chain) { const b = rgba(getComputedStyle(n).backgroundColor); if (b && b.a > 0) back = mix(b, back) }
  const cs = getComputedStyle(tag)
  const own = rgba(cs.backgroundColor)
  const fill = own && own.a > 0 ? mix(own, chain.slice(0, -1).reduce((acc, n) => { const b = rgba(getComputedStyle(n).backgroundColor); return b && b.a > 0 ? mix(b, acc) : acc }, { r: 255, g: 255, b: 255, a: 1 })) : back
  const style = {}
  for (const k of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopLeftRadius", "fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight", "color", "backgroundColor", "boxShadow", "whiteSpace", "flexShrink", "flexGrow"]) style[k] = cs[k]
  const rect = tag.getBoundingClientRect()
  return { style, text: tag.textContent, level: tag.dataset.level, contrast: ratio(rgba(cs.color), fill), height: rect.height, width: rect.width }
}`

type Facts = { style: Record<string, string>; text: string; level: string; contrast: number; height: number; width: number }
const tagFacts = (page: Page, selector: string): Promise<Facts> => page.locator(selector).first().evaluate(new Function(`return (${TAG_FACTS})`)() as never)

async function frameFacts(theme: Theme) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" })
  await page.goto(frameURL, { waitUntil: "load" })
  if (theme === "dark") await page.click("#themeSeg button[data-theme='dark']")
  await page.waitForTimeout(200)
  const tags = {} as Record<Level, Facts>
  for (const level of LEVELS) tags[level] = await tagFacts(page, `#variant-table .a-risk-tag[data-level="${level}"]`)
  const header = await page.locator("#placement .a-permission-panel-header").first().evaluate((node) => node.getBoundingClientRect().height)
  // 稿里放在标题行 / 能力行(flex 子项)里的标签:行内排版的表格单元里量不到真实的盒高,取这两处。
  const headerTag = await tagFacts(page, '#placement .a-permission-panel-header .a-risk-tag[data-level="high"]')
  const authzTag = await tagFacts(page, '#placement-authz .a-risk-tag[data-level="high"]')
  await page.close()
  return { tags, header, headerTag, authzTag }
}

const report: Record<string, unknown> = {}

describe("#1314 风险标签 · 真浏览器", () => {
  for (const theme of THEMES) {
    test(`${theme}:五档与已批 frame.html 计算样式逐项相等,文字对比度 ≥ 4.5`, async () => {
      const frame = await frameFacts(theme)
      const rows: Record<string, unknown>[] = []
      for (const level of LEVELS) {
        const page = await open(1280, 860, `scene=approval&risk=${RISK_PARAM[level]}`, theme)
        const real = await tagFacts(page, ".a-permission-panel-header .a-risk-tag")
        await page.screenshot({ path: resolve(evidence, `approval-${level}-${theme}.png`) })
        await page.close()
        expect(real.level).toBe(level)
        expect(real.text).toBe(TEXT[level])
        expect(real.style, `${theme} ${level}`).toEqual(frame.tags[level].style)
        expect(real.contrast, `${theme} ${level} 对比度`).toBeGreaterThanOrEqual(4.5)
        rows.push({ level, contrast: Number(real.contrast.toFixed(2)), frame: Number(frame.tags[level].contrast.toFixed(2)), height: real.height })
      }
      // 分类器兜底(critical/unknown,真分类器输出)渲染出来也是「风险未知」:描边、不填色,不是绿也不是红。
      const fallback = await open(1280, 860, "scene=approval&risk=unknown", theme)
      const unknown = await tagFacts(fallback, ".a-permission-panel-header .a-risk-tag")
      await fallback.close()
      expect(unknown.level).toBe("unknown")
      expect(unknown.style.backgroundColor).toBe("rgba(0, 0, 0, 0)")
      expect(unknown.style.color).not.toBe((await frameTokenColors(theme)).success)
      expect(unknown.style.color).not.toBe((await frameTokenColors(theme)).error)
      report[`contrast-${theme}`] = rows
    }, 120_000)
  }

  test("几何:宽 440 下标题行高度不因标签变化(= 稿),标签在标题行内、标题右侧、不换行、垂直居中", async () => {
    const frame = await frameFacts("light")
    const page = await open(488, 860, "scene=approval&risk=high", "light") // 视口 488 ⇒ 输入框 440 ⇒ 面板 440(稿的最窄情形)
    const m = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(".a-permission-panel-root")!
      const panel = root.querySelector<HTMLElement>(".a-permission-panel")!
      const header = panel.querySelector<HTMLElement>(".a-permission-panel-header")!
      const title = header.querySelector<HTMLElement>(".a-permission-panel-title")!
      const tag = header.querySelector<HTMLElement>(".a-risk-tag")!
      const r = (e: Element) => e.getBoundingClientRect()
      const withTag = r(header).height
      tag.style.display = "none"
      const withoutTag = r(header).height
      tag.style.display = ""
      const pad = parseFloat(getComputedStyle(header).paddingRight)
      return {
        panelWidth: r(panel).width,
        withTag,
        withoutTag,
        headerRight: r(header).right - pad,
        headerTop: r(header).top,
        headerBottom: r(header).bottom,
        titleRight: r(title).right,
        titleMid: r(title).top + r(title).height / 2,
        tag: { top: r(tag).top, bottom: r(tag).bottom, left: r(tag).left, right: r(tag).right, height: r(tag).height },
        titleLines: Math.round(r(title).height / parseFloat(getComputedStyle(title).lineHeight)),
      }
    })
    report.geometry440 = { ...m, frameHeader: frame.header, frameTagHeight: frame.headerTag.height }
    await page.screenshot({ path: resolve(evidence, "approval-440.png") })
    await page.close()
    expect(Math.abs(m.panelWidth - 440)).toBeLessThan(0.5) // 先证明量的是 440 宽
    expect(Math.abs(m.withTag - m.withoutTag)).toBeLessThan(0.01) // 加标签后标题行一样高
    expect(Math.abs(m.withTag - frame.header)).toBeLessThan(0.05) // 与稿一样高(稿里 31.75)
    expect(m.titleLines).toBe(1)
    expect(m.tag.left).toBeGreaterThanOrEqual(m.titleRight)
    expect(m.tag.right).toBeLessThanOrEqual(m.headerRight + 0.01)
    expect(m.tag.top).toBeGreaterThanOrEqual(m.headerTop)
    expect(m.tag.bottom).toBeLessThanOrEqual(m.headerBottom)
    expect(Math.abs(m.tag.height - frame.headerTag.height)).toBeLessThan(0.5) // 单行,与稿同高
    expect(Math.abs(m.tag.top + m.tag.height / 2 - m.titleMid)).toBeLessThanOrEqual(1)
  }, 120_000)

  test("长命令:正文在面板里滚动,标题行里的标签不动、一直在视野内;可读名称含档位", async () => {
    const page = await open(488, 860, "scene=approval&risk=exfil&long=1", "light")
    const before = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>(".a-permission-panel-body")!
      const tag = document.querySelector<HTMLElement>(".a-permission-panel-header .a-risk-tag")!
      return { overflow: body.scrollHeight - body.clientHeight, top: tag.getBoundingClientRect().top }
    })
    expect(before.overflow).toBeGreaterThan(0) // 先证明正文真的在滚
    const after = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>(".a-permission-panel-body")!
      body.scrollTop = body.scrollHeight
      const tag = document.querySelector<HTMLElement>(".a-permission-panel-header .a-risk-tag")!
      const rect = tag.getBoundingClientRect()
      return { scrolled: body.scrollTop, top: rect.top, visible: rect.top >= 0 && rect.bottom <= window.innerHeight }
    })
    expect(after.scrolled).toBeGreaterThan(0)
    expect(after.top).toBe(before.top)
    expect(after.visible).toBe(true)
    // 极高风险 + 外发:说明句在正文最上面。
    expect(await page.locator(".a-permission-panel-description").innerText()).toBe("可能把密钥或私人数据发到外部")
    // 读屏:对话框的可读名称 = 标题 + 档位(Playwright 按浏览器的可访问性计算)。
    expect(await page.getByRole("dialog", { name: "允许这次操作吗？ 极高风险" }).count()).toBe(1)
    await page.screenshot({ path: resolve(evidence, "approval-440-long-scrolled.png") })
    await page.close()
  }, 120_000)

  for (const theme of THEMES) {
    test(`${theme}:能力授权框(真宿主)高风险行的标签与稿相同(同宽同高),留在行内不溢出`, async () => {
      const frame = await frameFacts(theme)
      const page = await open(1280, 860, "scene=authz", theme)
      const rows = await page.evaluate(() => {
        const out: Array<{ cap: string; tag: boolean; withTag: number; withoutTag: number; tagInRow: boolean; chip: string; overflow: number }> = []
        for (const row of document.querySelectorAll<HTMLElement>(".codepuppy-ext-authz-cap")) {
          const tag = row.querySelector<HTMLElement>(".a-risk-tag")
          const withTag = row.getBoundingClientRect().height
          if (tag) tag.style.display = "none"
          const withoutTag = row.getBoundingClientRect().height
          if (tag) tag.style.display = ""
          const rr = row.getBoundingClientRect()
          const tr = tag?.getBoundingClientRect()
          out.push({
            cap: row.querySelector(".codepuppy-ext-authz-id")!.textContent!,
            tag: !!tag,
            withTag,
            withoutTag,
            tagInRow: !tr || (tr.top >= rr.top && tr.bottom <= rr.bottom),
            chip: row.querySelector(".codepuppy-ext-authz-chip")!.getAttribute("data-kind")!,
            overflow: row.scrollWidth - row.clientWidth,
          })
        }
        return out
      })
      report[`authz-${theme}`] = rows
      const real = await tagFacts(page, '.codepuppy-ext-authz-cap .a-risk-tag[data-level="high"]')
      await page.screenshot({ path: resolve(evidence, `authz-${theme}.png`) })
      await page.close()
      expect(real.style).toEqual(frame.authzTag.style)
      expect(real.contrast).toBeGreaterThanOrEqual(4.5)
      expect(Math.abs(real.height - frame.authzTag.height)).toBeLessThan(0.5)
      // 标了的行(新增 process:spawn、已授权 engine:plugin)有标签,将收回 / 低 / 中档没有。
      expect(rows.filter((row) => row.tag).map((row) => `${row.cap}/${row.chip}`).sort()).toEqual(["engine:plugin/granted", "process:spawn/new"])
      // 标签盒子与稿一样大 ⇒ 对行排版的影响与稿(和改前的旧标签:同一个 padding / 字号)一致;真宿主对话框只有 420,
      // 行里的名称列本来就会折行(改前同样,与标签无关),所以这里不断言「行高不变」,只断言标签与稿同宽同高、留在行内、不溢出。
      expect(Math.abs(real.width - frame.authzTag.width)).toBeLessThan(0.5)
      for (const row of rows.filter((item) => item.tag)) {
        expect(row.tagInRow, row.cap).toBe(true)
        expect(row.overflow, row.cap).toBeLessThanOrEqual(0)
      }
    }, 120_000)
  }

  test("证据写盘", () => {
    writeFileSync(resolve(evidence, "report.json"), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  })
})

/** 稿里的 --a-success / --a-error 在当前主题的计算色(用来断言「风险未知」的文字色不是绿也不是红)。 */
async function frameTokenColors(theme: Theme) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  await page.goto(frameURL, { waitUntil: "load" })
  if (theme === "dark") await page.click("#themeSeg button[data-theme='dark']")
  const colors = await page.evaluate(() => {
    const probe = document.createElement("span")
    document.body.append(probe)
    const read = (token: string) => {
      probe.style.color = `var(${token})`
      return getComputedStyle(probe).color
    }
    return { success: read("--a-success-on-subtle"), error: read("--a-error-on-subtle") }
  })
  await page.close()
  return colors
}
