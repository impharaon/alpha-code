// REQ-126 AC2(#655)覆盖层随导航关闭 —— **运行时**参数化闸门。
//
// 判据形制(方案基线 §3 不变量 7 / §4 序 2 指定):挂**真实**覆盖层宿主(生产 ExtensionHub /
// AutomationPanel)与**真实**侧栏(生产 CodePuppySidebar),路由是真的 @solidjs/router,断言
// 「覆盖层的 DOM 从 document 里消失」。刻意**不**断言 extHubOpen()/automationOpen() 的值:
// 信号可以被任何别处顺手置位,只有 DOM 才是用户看见的那个东西。更不断言源码文本。
//
// 矩阵 = 每个**已登记覆盖层** × 每类**导航路径**:
//   主轨(侧栏点击,与目标是否等于当前路由无关)
//     · 点当前正在看的那个会话 ← owner 报的动作;**URL 不变**,只靠 route effect 永远关不掉
//     · 点另一个会话 / 点「新对话」/ 点首页
//     · 点项目行的「+」——这一格的会话创建**保持未决**:关闭是导航**意图**的一部分,不能等
//       异步结果;用立即 resolve 的桩会把「关闭写在 await 之后」这个缺陷藏掉
//   兜底轨(不经侧栏点击)
//     · 程序化导航(深链、面板内回跳)
//     · 同 pathname 换 search(`/new-session?draftId=…` 的 draft 切换)—— 只看 pathname 会漏
//
// 每格自带前提自检(点之前必须**先**断言覆盖层真的在场),否则"覆盖层压根没打开"会让整格
// 空绿 —— 那是空闸门。
//
// 由 src/renderer/sidebar/overlay-close.test.ts 起子进程执行(本文件的 mock.module 会污染
// 同进程内其它测试:solid 实例、@opencode-ai/ui、SDK client 全被替身接管)。

import { transformAsync } from "@babel/core"
import presetTypescript from "@babel/preset-typescript"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import presetSolid from "babel-preset-solid"
import type { CodePuppyProject, CodePuppyProjectsApi } from "../src/renderer/sidebar/use-projects"
import { dict as zh } from "../src/renderer/i18n/zh"
import bundledCatalog from "../src/renderer/extensions/codepuppy-catalog.json"

GlobalRegistrator.register()
const solid = await import("solid-js/dist/solid.js")
mock.module("solid-js", () => solid)
const solidWeb = await import("solid-js/web/dist/web.js")
mock.module("solid-js/web", () => solidWeb)
const solidStore = await import("solid-js/store/dist/store.js")
mock.module("solid-js/store", () => solidStore)

Bun.plugin({
  name: "overlay-close-component-test",
  setup(builder) {
    builder.onLoad({ filter: /packages\/ui-mac\/src\/.*\.tsx$/ }, async (args) => {
      const transformed = await transformAsync(await Bun.file(args.path).text(), {
        filename: args.path,
        presets: [
          [presetSolid, { generate: "dom", hydratable: false }],
          [presetTypescript, { allExtensions: true, isTSX: true, onlyRemoveTypeImports: true }],
        ],
        sourceMaps: "inline",
      })
      return { contents: transformed?.code ?? "", loader: "js" }
    })
  },
})

// —— 替身面(全部是**装饰/传输**,不是被测语义)——————————————————————————————
// 上游 ui 组件(图标/头像/主题)与 SDK 传输层与「导航时覆盖层是否关闭」无关;侧栏与两个
// 覆盖层本体一律真实。useCommand 是上游命令面板句柄(ADR-016 借用面),本票不触发命令。
mock.module("@opencode-ai/ui/v2/icon", () => ({ Icon: () => null }))
mock.module("@opencode-ai/ui/v2/project-avatar-v2", () => ({ ProjectAvatar: () => null }))
mock.module("@opencode-ai/ui/theme/context", () => ({
  useTheme: () => ({ colorScheme: () => "dark", setColorScheme: () => {} }),
}))
// useTabs / useServer 是 REQ-126 CODE-C 起侧栏建 draft 用的上游 authority(同属 ADR-016 借用面)。
// 本闸门不测"建出什么 draft",只测"点下去覆盖层当场消失",所以给最小替身;`newDraft` 故意**保持
// 未决**,与「点项目行的 +」那格同理 —— 立即 resolve 会把「关闭写在 await 之后」的缺陷藏掉。
mock.module("../src/renderer/codepuppy-ui/providers", () => ({
  // `register` 是侧栏挂载期真会调的(REQ-126 AC7 的壳级命令注册);这里的替身只需存在,
  // 注册本身的真实判据在 src/renderer/sidebar/shell-commands.test.ts(真实命令总线)。
  useCommand: () => ({ options: [], register: () => {}, trigger: () => {}, show: () => {}, hide: () => {} }),
  // 侧栏用 `ServerConnection.key` 派生内嵌 sidecar 的稳定 key(不硬编码字面量);这里给同结果的
  // 最小替身,与下面 useServer 的 key 对齐,否则同源判定会把本闸门的 server 当成"别的 server"。
  // #925:startDraft 用 `ServerConnection.Key.make(props.serverKey())` 给 draft 钉 server 段;
  // 替身与上游同义(Key.make 是 brand 构造,运行时即恒等)。
  ServerConnection: { key: () => "sidecar", Key: { make: (value: string) => value } },
  useTabs: () => ({
    ready: Object.assign(() => true, { promise: undefined }),
    newDraft: () => new Promise<void>(() => {}),
  }),
  useServer: () => ({ key: "sidecar", isLocal: () => true, projects: { list: () => [] } }),
  useContractHealth: () => () => null,
  ContractHealthProvider: (props: { children?: unknown }) => props.children,
}))
mock.module("@opencode-ai/sdk/v2/client", () => ({ createOpencodeClient: () => sdkStub() }))

function sdkStub(): unknown {
  const fail = async () => ({ data: undefined, error: { message: "offline in test" } })
  return new Proxy(
    {},
    {
      get: (_t, prop) => (prop === "then" ? undefined : new Proxy(fail, { get: () => fail })),
    },
  )
}

// —— preload 桥替身:renderer 侧一切 IPC 都经 window.api ——————————————————————
// 形状明确的给真值(否则生产代码的 try/catch 会把"没数据"和"桥坏了"混为一谈);其余按名字
// 分两类兜底:`on*`/`subscribe*` 返回退订函数,别的返回已 resolve 的 Promise。
// I-17 用例要有一条已装连接器、并看得见「关闭」点下去时发出的那一次开关调用。
let installedReceipts: unknown[] = []
const setInstallStateCalls: unknown[] = []
const EXPLICIT: Record<string, (...args: unknown[]) => unknown> = {
  "auth.getState": async () => ({ status: "logged-out", mode: "byok" }),
  "automations.list": async () => ({ tasks: [], state: { pausedAll: false }, loginItem: false }),
  "automations.cloudSync": async () => ({}),
  "account.summary": async () => null,
  endpoints: async () => ({}),
  "ext.listInstalls": async () => ({ global: installedReceipts, project: [], warnings: [] }),
  "ext.setInstallState": async (...args: unknown[]) => {
    setInstallStateCalls.push(args[0])
    return { ok: true }
  },
  "ext.inventoryView": async () => ({ rows: [] }),
  "ext.sessionGrants": async () => ({ grants: [] }),
  "ext.factorySkillIds": async () => [],
  "ext.remoteCatalog": async () => ({ source: "none", catalog: undefined }),
}

function apiNode(path: string[]): unknown {
  const call = (...args: unknown[]) => {
    const key = path.join(".")
    if (key in EXPLICIT) return EXPLICIT[key]!(...args)
    const leaf = path[path.length - 1] ?? ""
    if (/^(on[A-Z]|subscribe)/.test(leaf)) return () => {}
    return Promise.resolve(undefined)
  }
  return new Proxy(call, {
    get: (_t, prop) => (prop === "then" || typeof prop === "symbol" ? undefined : apiNode([...path, prop])),
  })
}
;(globalThis as unknown as { window: { api: unknown } }).window.api = apiNode([])

// —— 生产组合体(真实侧栏 + 真实两个覆盖层 + 真实路由)—————————————————————————
const runtime = await import("../src/renderer/sidebar/overlay-close-test-runtime")
const { hrefFor } = await import("../src/shared/route-manifest")
const extHubState = await import("../src/renderer/extensions/ext-hub-state")
const automationState = await import("../src/renderer/automations/automation-state")
const toastApi = await import("../src/renderer/codepuppy-ui/Toast")
const sidebarState = await import("../src/renderer/sidebar/sidebar-state")

const DIR = "/Users/tester/proj-a"
const CURRENT_SESSION = "ses-current"
const OTHER_SESSION = "ses-other"

function makeProjects(overrides?: { createSession?: () => Promise<string | undefined> }): CodePuppyProjectsApi {
  const project: CodePuppyProject = {
    id: "prj-a",
    worktree: DIR,
    name: "proj-a",
    directories: [DIR],
    loaded: true,
    sessions: [
      { id: CURRENT_SESSION, title: "当前会话", directory: DIR, projectID: "prj-a", updated: 200 },
      { id: OTHER_SESSION, title: "另一个会话", directory: DIR, projectID: "prj-a", updated: 100 },
    ],
  }
  return {
    store: { projects: [project], ready: true, error: false },
    reload: async () => {},
    createSession: overrides?.createSession ?? (async () => "ses-created"),
    startChat: async () => "ses-created",
    sdk: () => undefined,
    renameSession: async () => true,
    shareSession: async () => undefined,
    deleteSession: async () => true,
    copySession: async () => undefined,
  } as unknown as CodePuppyProjectsApi
}

// —— 已登记的全页覆盖层。新增一个却不加进这里 = 本闸门漏掉它(方案基线 S2 明说:防漏靠
//    测试而非架构)。navLabel 是侧栏里打开它的那个 nav 项。 ——————————————————————
const OVERLAYS = [
  { name: "定制中心 ExtensionHub", navLabel: zh["codepuppy.sidebar.plugins"], host: "[data-codepuppy-ext-hub]", page: ".codepuppy-ext-page" },
  { name: "自动化 AutomationPanel", navLabel: zh["codepuppy.sidebar.automation"], host: "[data-codepuppy-automations]", page: ".codepuppy-auto-page" },
] as const

const disposers: Array<() => void> = []

async function flush() {
  for (let i = 0; i < 4; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  document.body.replaceChildren()
  const root = document.createElement("div")
  root.id = "root"
  document.body.append(root)
  extHubState.setExtHubOpen(false)
  automationState.setAutomationOpen(false)
})

afterEach(() =>
  disposers
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose()),
)

afterAll(() => GlobalRegistrator.unregister())

/** 挂真实组合体,并把位置摆到 `startPath`(冷启动落地 effect 自己会 navigate 一次,故挂完再摆)。 */
async function mount(startPath: string, projectOverrides?: Parameters<typeof makeProjects>[0]) {
  const history = runtime.createMemoryHistory()
  history.set({ value: startPath })
  const host = document.getElementById("root")!
  disposers.push(
    solidWeb.render(() => runtime.OverlayCloseHarness({ history, projects: makeProjects(projectOverrides) }), host),
  )
  await flush()
  history.set({ value: startPath })
  await flush()
  return history
}

function overlayPresent(overlay: (typeof OVERLAYS)[number]): boolean {
  return document.querySelector(`${overlay.host} ${overlay.page}`) !== null
}

/** 覆盖层的 portal 宿主必须被清空 —— 「关闭」= DOM 不在了,不是被藏起来。 */
function overlayHostChildren(overlay: (typeof OVERLAYS)[number]): number {
  return document.querySelector(overlay.host)?.childElementCount ?? -1
}

function query<T extends Element>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector)
  if (!el) throw new Error(`未找到元素:${selector}`)
  return el
}

function navItem(label: string): HTMLElement {
  for (const el of document.querySelectorAll<HTMLElement>(".codepuppy-sidebar-nav .codepuppy-sidebar-nav-item")) {
    // 窄轨按钮只有图标,名字在 aria-label 上。
    if ((el.getAttribute("aria-label") ?? el.textContent ?? "").includes(label)) return el
  }
  throw new Error(`窄轨 nav 项未找到:${label}`)
}

function click(el: Element) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
}

/** 真的点侧栏那个 nav 项来打开覆盖层 —— 不用信号直接置位,开与关走同一条生产路径。 */
async function open(overlay: (typeof OVERLAYS)[number]) {
  click(navItem(overlay.navLabel))
  await flush()
}

// #925:侧栏会话锚点已是 canonical 的 `/server/:serverKey/session/:id`(legacy 产生器已删);
// key 与 harness 传给侧栏的 serverKey 同值("sidecar")。
const CURRENT_HREF = hrefFor.session("sidecar", CURRENT_SESSION)
const OTHER_HREF = hrefFor.session("sidecar", OTHER_SESSION)
const DRAFT_A = hrefFor.newSession("draft-a")
const DRAFT_B = hrefFor.newSession("draft-b")

/**
 * 导航路径矩阵的另一维。`act` 拿到 history 以便执行**不经侧栏**的程序化导航;
 * `projects` 覆盖数据层桩,用来钉住"关闭必须发生在导航**意图**处、不等异步结果"。
 */
const NAVIGATIONS: Array<{
  name: string
  track: "click" | "route"
  projects?: Parameters<typeof makeProjects>[0]
  act: (history: ReturnType<typeof runtime.createMemoryHistory>) => void
}> = [
  // 主轨:侧栏点击。第一格是本票的核心缺口 —— 目标 == 当前路由,URL 一个字符都不变。
  { name: "点当前正在看的那个会话(URL 不变)", track: "click", act: () => click(query(`a.codepuppy-session[href="${CURRENT_HREF}"]`)) },
  { name: "点另一个会话", track: "click", act: () => click(query(`a.codepuppy-session[href="${OTHER_HREF}"]`)) },
  { name: "点「新对话」", track: "click", act: () => click(navItem(zh["codepuppy.sidebar.newChat"])) },
  { name: "点首页(品牌区)", track: "click", act: () => click(query(".codepuppy-sidebar-brand-mark")) },
  // 会话创建**保持未决**:生产 startChat 的导航在 `await createSession(...)` 之后,而真实创建是
  // 多个 await(use-projects.ts:294-307)。用立即 resolve 的桩会把「关闭发生在 await 之后」这个
  // 缺陷藏掉(#655 审计 Major 就是这么漏的)——所以这一格断言的是**点下去当场就关**,不等 resolve。
  {
    name: "点项目行的新对话「+」(会话创建未决 → 必须当场关,不等结果)",
    track: "click",
    projects: { createSession: () => new Promise<string | undefined>(() => {}) },
    act: () => click(query(".codepuppy-project-add")),
  },
  // 兜底轨:不经侧栏点击(深链、程序化导航、自动化面板内「回跳会话」)。
  { name: "程序化导航到首页(深链/面板内回跳)", track: "route", act: (history) => history.set({ value: hrefFor.home() }) },
  { name: "同 pathname 换 search(draft 之间切换)", track: "route", act: (history) => history.set({ value: DRAFT_B }) },
]

describe("REQ-126 AC2:覆盖层随导航关闭(真实宿主 × 真实点击)", () => {
  test("前提自检:两个覆盖层都能挂起来,且默认不在场", async () => {
    await mount(CURRENT_HREF)
    for (const overlay of OVERLAYS) {
      expect(document.querySelector(overlay.host), `${overlay.name} 的 portal 宿主未挂载`).not.toBeNull()
      expect(overlayPresent(overlay), `${overlay.name} 未打开却已在 DOM 里`).toBe(false)
    }
    for (const overlay of OVERLAYS) {
      await open(overlay)
      expect(overlayPresent(overlay), `点侧栏「${overlay.navLabel}」没能打开 ${overlay.name}`).toBe(true)
    }
  })

  test("前提自检:draft 切换那格确实只变 search —— 否则它退化成普通 pathname 变化", () => {
    const a = new URL(DRAFT_A, "http://x")
    const b = new URL(DRAFT_B, "http://x")
    expect(a.pathname).toBe(b.pathname)
    expect(a.search).not.toBe(b.search)
  })

  for (const overlay of OVERLAYS) {
    for (const nav of NAVIGATIONS) {
      test(`${overlay.name} × ${nav.name} → 覆盖层 DOM 消失`, async () => {
        const history = await mount(nav.name.includes("draft") ? DRAFT_A : CURRENT_HREF, nav.projects)

        await open(overlay)
        // 前提自检:没先打开就断言"消失"是空闸门。
        expect(overlayPresent(overlay), `前提不成立:${overlay.name} 没打开`).toBe(true)

        nav.act(history)
        await flush()

        expect(overlayPresent(overlay), `${nav.name} 之后 ${overlay.name} 仍压在页面上`).toBe(false)
        expect(overlayHostChildren(overlay), `${overlay.name} 的宿主还留着节点(只是藏起来不算关)`).toBe(0)
      })
    }
  }
})

// I-11 / BR-07(编排器裁决 2026-11-18,方案 C):连接器改动让 sidecar 换代,main 随之整页重载渲染进程(index.ts 的
// respawn)。重载后用户仍在定制中心:覆盖层仍开着、仍是原来的页签,路由不变;启动落地(新对话 draft)不在重载时
// 再跑一次、也不把覆盖层关掉。模拟重载 = 拆掉整页、模块状态回到初值,只有本窗口的 sessionStorage 留下(与真实重载同)。
// 新开的窗口 / 冷启动没有存下的位置 ⇒ 照旧落到新对话、覆盖层关着。
describe("I-11 BR-07:sidecar 换代引起的整页重载后仍在原处", () => {
  // 真实重载的页面由导航计时标为 "reload"(webContents.reload());新窗口 / 冷启动不是。测试进程里 sessionStorage 跨用例留存,
  // 所以「是不是重载」只能照真实信号模拟,不能拿「存储里有东西」充数。
  const navigationType = performance.getEntriesByType.bind(performance)
  afterEach(() => {
    performance.getEntriesByType = navigationType
  })
  async function reload(type: "reload" | "navigate" = "reload") {
    performance.getEntriesByType = ((entry: string) => (entry === "navigation" ? [{ type }] : navigationType(entry))) as typeof performance.getEntriesByType
    // 只有本窗口的 sessionStorage 跨过重载;拆页与把模块状态摆回初值都不能改动它(真实重载里模块是重新求值,不经 setter)。
    const kept = Object.entries(sessionStorage)
    disposers.splice(0).reverse().forEach((dispose) => dispose())
    document.body.replaceChildren()
    const root = document.createElement("div")
    root.id = "root"
    document.body.append(root)
    extHubState.setExtHubOpen(false)
    extHubState.setHubSection("connectors")
    sessionStorage.clear()
    for (const [key, value] of kept) sessionStorage.setItem(key, value)
    const place = await import("../src/renderer/reload-place")
    extHubState.restoreHubAfterReload()
    const history = place.restoredHistory()
    disposers.push(solidWeb.render(() => runtime.OverlayCloseHarness({ history, projects: makeProjects() }), document.getElementById("root")!))
    await flush()
    await flush()
    return history
  }

  test("定制中心开着、在技能页时重载 → 仍开着、仍在技能页,路由不变,启动落地不关它", async () => {
    await mount(CURRENT_HREF)
    await open(OVERLAYS[0])
    extHubState.setHubSection("skills")
    await flush()
    expect(overlayPresent(OVERLAYS[0]), "前提不成立:定制中心没打开").toBe(true)
    const history = await reload()
    expect(overlayPresent(OVERLAYS[0]), "重载后定制中心被关掉了").toBe(true)
    expect(extHubState.hubSection()).toBe("skills")
    expect(history.get()).toBe(CURRENT_HREF)
  })

  test("新开的窗口(不是重载)即使存储里留着位置,也照旧从冷启动开始:不恢复定制中心、不恢复路由", async () => {
    await mount(CURRENT_HREF)
    await open(OVERLAYS[0])
    await flush()
    const history = await reload("navigate")
    expect(overlayPresent(OVERLAYS[0])).toBe(false)
    expect(history.get()).not.toBe(CURRENT_HREF)
  })

  test("定制中心关着时重载 → 路由不变,覆盖层仍关着", async () => {
    await mount(CURRENT_HREF)
    const history = await reload()
    expect(overlayPresent(OVERLAYS[0])).toBe(false)
    expect(history.get()).toBe(CURRENT_HREF)
  })
})

// I-17(INT-plugin-helper-and-hub)/ SPEC-desktop-ui-refresh BR-06、BR-08、AC-06:定制中心是顶级页面。关闭一个不换代的连接器
// (旧式单连接器 markitdown:main 不发重载,渲染进程只做断开)时用户必须还在定制中心、路由一个字不变。
describe("I-17 / AC-06:顶级页面的定制中心", () => {
  afterEach(() => {
    installedReceipts = []
    setInstallStateCalls.length = 0
  })

  test("定制中心是顶级页面:用壳的页面容器 .codepuppy-page,页内没有会话顶栏;从任意会话打开、关掉后回到原会话", async () => {
    const history = await mount(CURRENT_HREF)
    await open(OVERLAYS[0])
    expect(overlayPresent(OVERLAYS[0]), "前提不成立:定制中心没打开").toBe(true)
    const page = query<HTMLElement>(`${OVERLAYS[0].host} ${OVERLAYS[0].page}`)
    expect(page.classList.contains("codepuppy-page")).toBe(true)
    expect(page.dataset.topLevelPage).toBe("hub")
    // 页内没有会话面包屑与右栏页签。
    expect(page.querySelector("[data-codepuppy-session-workspace-topbar], .a-swk-topbar")).toBeNull()
    // 再点一次定制中心入口 = 关闭,回到打开前的会话,路由没动。
    await open(OVERLAYS[0])
    expect(overlayPresent(OVERLAYS[0])).toBe(false)
    expect(history.get()).toBe(CURRENT_HREF)
  })

  test("关闭一个不换代的连接器(markitdown):定制中心仍开着,路由不变,开关只发出一次", async () => {
    installedReceipts = [
      { id: "mcp:markitdown", name: "markitdown", type: "mcp", scope: "global", installedAt: "2026-10-30T00:00:00.000Z", origin: "catalog", version: bundledCatalog.version },
    ]
    const history = await mount(CURRENT_HREF)
    await open(OVERLAYS[0])
    await flush()
    await flush()
    const row = query<HTMLElement>('[data-installed-row="mcp:markitdown"]')
    click(query<HTMLElement>("[data-more]", row))
    await flush()
    click(query<HTMLElement>('[data-menu-item="disable"]'))
    for (let i = 0; i < 6; i++) await flush()
    expect(setInstallStateCalls, "前提不成立:点「关闭」没有发出开关调用").toHaveLength(1)
    expect(overlayPresent(OVERLAYS[0]), "关闭连接器后离开了定制中心").toBe(true)
    expect(history.get()).toBe(CURRENT_HREF)
  })
})

// `#1687`:未恢复问题入口挂在**生产**侧栏里(同一真实组合体)—— 侧栏 footer 里;
// 侧栏收起时「显示侧边栏」按钮带小点与数量。入口自身的行为判据在
// src/renderer/codepuppy-ui/problems-entry.test.ts;这里只钉生产挂载位置与收起态的小点。
describe("#1687 未恢复问题入口在真实侧栏里", () => {
  const KEY = "overlay-close:#1687"
  afterEach(() => {
    toastApi.resolveProblem(KEY)
    sidebarState.setSidebarCollapsed(false)
  })

  /** 报一条后台问题,在生产提示视口里点 × 收起(生产里视口与侧栏同是 AppInterface 下的兄弟)。 */
  async function foldOneProblem() {
    const host = document.createElement("div")
    document.body.append(host)
    disposers.push(solidWeb.render(() => toastApi.ToastViewport(), host))
    toastApi.reportProblem({ key: KEY, title: "「飞书」连接器未能连接" })
    await flush()
    query<HTMLButtonElement>(".a-toast .a-toast-x").click()
    await flush()
  }

  test("入口在侧栏 footer 里(账户已移到窄轨);恢复后消失", async () => {
    await mount(CURRENT_HREF)
    expect(document.querySelector(".codepuppy-problems-entry")).toBeNull()
    await foldOneProblem()
    const entry = query<HTMLButtonElement>(".codepuppy-sidebar-footer > .codepuppy-problems-entry")
    expect(entry.textContent).toContain(zh["codepuppy.problems.entry"].replace("{{count}}", "1"))
    // 账户头像在窄轨上,不在侧栏 footer 里。
    expect(document.querySelector(".codepuppy-sidebar-footer .codepuppy-sidebar-account")).toBeNull()
    expect(document.querySelector(".codepuppy-rail .codepuppy-sidebar-account")).not.toBeNull()
    toastApi.resolveProblem(KEY)
    await flush()
    expect(document.querySelector(".codepuppy-problems-entry")).toBeNull()
  })

  test("侧栏收起时「显示侧边栏」按钮带小点,悬停文字带数量;全部恢复后小点消失", async () => {
    await mount(CURRENT_HREF)
    await foldOneProblem()
    sidebarState.setSidebarCollapsed(true)
    await flush()
    const toggle = query<HTMLButtonElement>(".codepuppy-topbar .codepuppy-topbar-btn")
    expect(toggle.hasAttribute("data-problems")).toBe(true)
    expect(toggle.getAttribute("aria-label")).toBe(zh["codepuppy.sidebar.showWithProblems"].replace("{{count}}", "1"))
    toastApi.resolveProblem(KEY)
    await flush()
    expect(toggle.hasAttribute("data-problems")).toBe(false)
    expect(toggle.getAttribute("aria-label")).toBe(zh["codepuppy.sidebar.show"])
  })
})
