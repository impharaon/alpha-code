// `#1594`(REQ-236 T18/T19):定制中心收成连接器 / 技能 / 助手三页 —— 每条 AC 一个具名判据。
//
// 独立进程运行:真实 Solid DOM 构建 + **真实** `useExtensions` + **真实** `ExtensionHub`(批准稿
// `docs/design/2026-10-30-req236-ux-config-pages/frame.html#hub`)。替身只有两处边界:SDK client
// (对面是引擎的 HTTP 服务)与 `window.api.ext`(对面是 main 进程);两者之内每一跳都是生产代码。
// 夹具形状取自生产类型:账本收据 = `preload/types.ts` `InstallReceipt`;三档状态 = `main/codepuppy-sidecar-messages.ts`
// `HubViewRow`;治理视图 = `main/ext-inventory.ts` `InventoryRow`;扩展包安全视图按 `main/package-installability.ts`
// `compatibleView` 的形状、以随包目录里 `package:github-official` 的真实呈现段与前置项 id 规则
// (`shared/package-secret-prerequisite.ts`:`<组件 id>#<变量名>`,label = 变量名)拼出。
//
// 「删掉该行为必须变红」的反向对照写在每条用例里:断言落在用户看得到 / 点得到的 DOM 上,
// 而不是「hub 调过某个函数」这类内部事实。

import { afterAll, expect, mock, test } from "bun:test"
import { transformAsync } from "@babel/core"
import presetTypescript from "@babel/preset-typescript"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import presetSolid from "babel-preset-solid"
import { hrefFor } from "../src/shared/route-manifest"
import bundledCatalog from "../src/renderer/extensions/codepuppy-catalog.json"
import { DEFAULT_BUILTIN_POLICY } from "../src/main/codepuppy-builtin-policy"
import { evaluatePackageForHost, packageActionForReason } from "../src/main/package-installability"
import type { CatalogPackageViewV1 } from "../src/shared/catalog-package-view"
import type { InstalledPackageV1 } from "../src/preload/types"
import { dict as zh } from "../src/renderer/i18n/zh"
import { v1McpStatus } from "../src/engine-adapter/opencode2/v1-shapes"

GlobalRegistrator.register()
const solid = await import("solid-js/dist/solid.js")
mock.module("solid-js", () => solid)
const solidWeb = await import("solid-js/web/dist/web.js")
mock.module("solid-js/web", () => solidWeb)
// `solid-js/store` 少这一行**不报错**,而是静默失去反应性(判据在 CLAUDE.md《本机验证陷阱》)。
const solidStore = await import("solid-js/store/dist/store.js")
mock.module("solid-js/store", () => solidStore)

Bun.plugin({
  name: "hub-three-pages-solid-components",
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

// ── 边界替身(用例可驱动)───────────────────────────────────────────────────────────────────
type Receipt = { id: string; name: string; type: string; scope: "global" | "project"; installedAt: string; origin: string; version?: string }
let receipts: Receipt[] = []
let projectReceipts: Receipt[] = []
let pathname = "/"
let removalPending: Promise<void> | undefined
let inventoryRows: unknown[] = []
let hubRows: unknown[] = []
let installedPackages: InstalledPackageV1[] = []
let packageAuthorizationItems: unknown[] = []
let factorySkillIds: string[] = []
let mcpStates: Record<string, { status: string; error?: string }> = {}
let authOutcome = "connected"
let authPending: Promise<void> | undefined
const hubListeners = new Set<() => void>()
let secretFailure: string | undefined
let stateFailure: string | undefined
let leaveApplying = false
let remoteCatalog: unknown = { source: "none" }
// D6 片 6b:本机文件条目走 main 的真实实现(createNativeSources + 临时账本),只替换引擎列表、项目同意与重载出口。
type NativeMain = ReturnType<(typeof import("../src/main/native-sources"))["createNativeSources"]>
let nativeMain: NativeMain | undefined
const calls = {
  importSkillFolder: 0,
  filePicker: [] as Array<{ title?: string }>,
  installCatalog: [] as Array<Record<string, unknown>>,
  setInstallState: [] as Array<Record<string, unknown>>,
  uninstall: [] as Array<Record<string, unknown>>,
  builtinApply: [] as unknown[],
  installPackage: [] as string[],
  packageState: [] as Array<{ packageId: string; state: string }>,
  packageSecrets: [] as Array<{ packageId: string; secrets: Record<string, string> }>,
  packageRemove: [] as string[],
  auth: [] as string[],
  links: [] as string[],
}

const emptyStream = { [Symbol.asyncIterator]: async function* () {} }
const fakeClient = {
  mcp: {
    status: async () => ({ data: mcpStates, error: undefined }),
    connect: async () => ({ data: {}, error: undefined }),
    disconnect: async () => ({ data: {}, error: undefined }),
    add: async () => ({ data: {}, error: undefined }),
    auth: { authenticate: async ({ name }: { name: string }) => { calls.auth.push(name); await authPending; if (authOutcome === "disabled") packageAuthorizationItems = packageAuthorizationItems.map((item) => ({ ...item as object, authenticated: true })); return { data: { status: authOutcome }, error: undefined } } },
  },
  app: {
    agents: async () => ({
      data: [
        { name: "build", mode: "primary", native: true },
        { name: "docs-writer", mode: "subagent", native: false, description: "写文档:报告、规范、设计说明。" },
      ],
      error: undefined,
    }),
  },
  global: {
    event: async () => ({ stream: emptyStream }),
    dispose: async () => ({ data: {}, error: undefined }),
  },
}
mock.module("@opencode-ai/sdk/v2/client", () => ({ createOpencodeClient: () => fakeClient }))
mock.module("../src/renderer/auth-recovery", () => ({
  subscribeAuthState: (listener: (state: { status: string; mode: string; platformStatus: string }) => void) => {
    listener({ status: "logged-out", mode: "byok", platformStatus: "ready" })
    return () => {}
  },
}))
mock.module("@solidjs/router", () => ({ useLocation: () => ({ get pathname() { return pathname } }) }))
mock.module("../src/renderer/codepuppy-ui/Banner", () => ({ Banner: () => null }))

Object.defineProperty(window, "api", {
  configurable: true,
  value: {
    openFilePicker: async (options: { title?: string }) => {
      calls.filePicker.push(options)
      return null
    },
    openLink: async (url: string) => { calls.links.push(url) },
    updater: { check: async () => {} },
    // 本机连接器的管理页带现有「权限」段;这里只要它读得到「暂时读不到」,不测策略编辑本身。
    toolPolicy: { inventory: async () => ({ ok: false as const, reason: "fixture" }) },
    auth: { start: async () => {}, setMode: async () => {} },
    ext: {
      listInstalls: async () => ({ global: receipts, project: projectReceipts, warnings: [] }),
      sessionGrants: async () => ({ grants: [] }),
      factorySkillIds: async () => factorySkillIds,
      onSessionGrantsEnded: () => () => {},
      inventoryView: async () => ({ catalogVersion: null, catalogChannel: null, rows: inventoryRows, warnings: [] }),
      installedPackages: async () => ({ ok: true as const, packages: installedPackages }),
      nativeSources: async (projectDir?: string) => (nativeMain ? { ok: true as const, rows: await nativeMain.rows(projectDir) } : { ok: true as const, rows: [] }),
      setNativeSourceState: async (intent: unknown) => (nativeMain ? nativeMain.setState(intent) : { ok: false as const, reason: "no native main" }),
      packageAuthorization: async (packageId: string) => ({ ok: true, packageId, items: packageAuthorizationItems }),
      installPackage: async (id: string) => { calls.installPackage.push(id); return { ok: true } },
      setPackageState: async (intent: { packageId: string; state: "enabled" | "disabled" }) => {
        calls.packageState.push(intent)
        if (stateFailure) return { ok: false, reason: stateFailure }
        installedPackages = installedPackages.map((pack) => pack.packageId === intent.packageId ? { ...pack, desiredState: intent.state, components: pack.components.map((component) => ({ ...component, desiredState: intent.state })) } : pack)
        const pack = installedPackages.find((entry) => entry.packageId === intent.packageId)!
        hubRows = pack.components.map((component) => hubRow(component.componentId, component.name, component.kind, leaveApplying ? "reload-pending" : intent.state === "disabled" ? "installed" : "available", leaveApplying ? "reload-waiting" : undefined))
        hubRows.push(hubRow(pack.packageId, pack.rootComponentName, "package", leaveApplying ? "reload-pending" : intent.state === "disabled" ? "installed" : "available", leaveApplying ? "reload-waiting" : undefined))
        if (!leaveApplying) for (const component of pack.components.filter((entry) => entry.kind === "mcp")) mcpStates[component.name] = { status: intent.state === "disabled" ? "disabled" : "connected" }
        return { ok: true }
      },
      savePackageSecrets: async (intent: { packageId: string; secrets: Record<string, string> }) => { calls.packageSecrets.push(intent); if (secretFailure) return { ok: false, reason: secretFailure }; packageAuthorizationItems = packageAuthorizationItems.map((item) => ({ ...item as object, saved: true })); return { ok: true } },
      uninstallPackage: async (packageId: string) => { calls.packageRemove.push(packageId); await removalPending; installedPackages = installedPackages.filter((pack) => pack.packageId !== packageId); receipts = []; hubRows = []; mcpStates = {}; return { ok: true, packageId, removed: [], retained: [] } },
      advisoryActive: async () => ({ ids: [], fresh: true }),
      migrateScan: async () => ({ enabled: false, inventory: { skills: [], mcp: [], plugins: [] } }),
      remoteCatalog: async () => remoteCatalog,
      checkRuntime: async () => ({ ok: true as const }),
      installCatalog: async (intent: Record<string, unknown>) => {
        calls.installCatalog.push(intent)
        return { ok: false as const, reason: "fixture: install not exercised here" }
      },
      setInstallState: async (intent: Record<string, unknown>) => {
        calls.setInstallState.push(intent)
        return { ok: true as const }
      },
      uninstallV2: async (intent: Record<string, unknown>) => {
        calls.uninstall.push(intent)
        return { ok: true as const }
      },
      preparePluginSource: async () => {
        calls.importSkillFolder++
        return { ok: false as const, canceled: true, detail: "canceled" }
      },
      hubView: async () => ({ directory: "/", rows: hubRows, warnings: [] }),
      reloadRequest: async () => ({ ok: true as const, generation: 1 }),
      onSourcesSearchProgress: () => () => {},
      onHubViewChanged: (listener: () => void) => { hubListeners.add(listener); return () => { hubListeners.delete(listener) } },
      builtinRead: async () => ({
        gov: structuredClone(DEFAULT_BUILTIN_POLICY),
        protection: { hard: [], codepuppyInjected: [], confirm: [] },
      }),
      builtinApply: async (next: unknown) => {
        calls.builtinApply.push(next)
        return { ok: true as const }
      },
      curationBlob: async () => undefined,
      migrateVerify: async () => ({ ok: true as const }),
    },
  },
})

const { createComponent } = solid
const { render } = solidWeb
// 必须**动态** import:静态 import 会在 registrator 之前牵出 solid-js。
const { ExtensionHub } = await import("../src/renderer/extensions/extension-hub")
const { openExtHubAt, openPackageManagement, extHubOpen, setExtHubOpen, setHubSection, takeHubLocateTarget } = await import("../src/renderer/extensions/ext-hub-state")

const disposals: Array<() => void> = []
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
async function waitFor(assertion: () => void) {
  let failure: unknown
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      assertion()
      return
    } catch (error) {
      failure = error
      await flush()
    }
  }
  throw failure
}

test("catalog package owns one installed row across pages with its switch in the menu", async () => {
  reset()
  const { hubPackageFixture } = await import("./hub-package.fixture")
  const sample = hubPackageFixture()
  installedPackages = sample.packages.map((entry) => ({
    packageId: entry.prelude.packageId,
    installedGraphDigest: "sha256:" + "a".repeat(64),
    displayName: entry.presentation.displayName,
    rootComponentName: entry.root.split(":")[1]!,
    version: entry.prelude.version,
    origin: "catalog",
    desiredState: "enabled",
    components: entry.components.map((component) => ({
      componentId: component.id, kind: component.profileId === "mcp-remote" ? "mcp" : component.profileId,
      name: component.id.split(":")[1]!, required: component.required, desiredState: "enabled" as const,
    })),
  }))
  receipts = installedPackages.flatMap((pack) => pack.components.map((component) => receipt(component.componentId, component.name, component.kind)))
  pathname = hrefFor.directory("/tmp/hub-project-control")
  projectReceipts = [{ ...receipt("skill:supabase", "supabase", "skill"), scope: "project" }]
  // A separate project-independent skill is a control: package filtering must not swallow it.
  receipts.push(receipt("skill:safe-refactor", "safe-refactor", "skill"))
  mount("skills")
  await waitFor(() => expect(q('[data-installed-package="package:supabase"]')).toBeInstanceOf(HTMLElement))
  expect(qa('[data-installed-row="skill:supabase"]')).toHaveLength(1)
  expect(q('[data-installed-row="skill:supabase-postgres-best-practices"]')).toBeNull()
  expect(q('[data-installed-row="skill:safe-refactor"]')).toBeInstanceOf(HTMLElement)
  expect(q('[data-group="project"] [data-installed-row="skill:supabase"]')?.textContent).toContain("supabase")
  const row = q('[data-installed-package="package:supabase"]')!
  expect(qa("button", row).map((button) => button.getAttribute("data-more") ?? "")).toEqual(["package:package:supabase"])
  click(q("[data-more]", row))
  await waitFor(() => expect(q('[role="switch"]')).toBeInstanceOf(HTMLElement))
  expect(document.body.textContent).toContain("管理")
  expect(document.body.textContent).toContain("移除")
})

test("package plus installs directly before separate credentials without an installation wall", async () => {
  reset()
  calls.installPackage.length = 0
  const { hubPackageFixture } = await import("./hub-package.fixture")
  const sample = hubPackageFixture()
  const view = await evaluatePackageForHost(sample.packages[0], { fetchPayload: sample.fetchBytes })
  remoteCatalog = { source: "remote", catalog: { version: "hub-real", entries: bundledCatalog.entries, packages: [view] } }
  mount()
  await waitFor(() => expect(q('[data-package-card="package:github"]')).toBeInstanceOf(HTMLElement))
  const card = q('[data-package-card="package:github"]')!
  expect(qa("button", card).map((button) => [button.hasAttribute("data-iact"), button.getAttribute("aria-label")?.startsWith("安装")])).toEqual([[true, true]])
  expect(q("button svg", card)).toBeInstanceOf(SVGElement)
  click(q("button", card))
  await waitFor(() => expect(calls.installPackage).toEqual(["package:github"]))
  expect(document.body.textContent).not.toContain("确认安装")
  expect(document.body.textContent).not.toContain("未经审核，装好后默认关闭")
  expect(document.body.textContent).not.toContain("codepuppy.secret-prerequisite.v1")
})

test("installed package management keeps token entry available after closing its window", async () => {
  reset()
  const { hubPackageFixture } = await import("./hub-package.fixture")
  const entry = hubPackageFixture().packages[0]!
  installedPackages = [{
    packageId: entry.prelude.packageId, installedGraphDigest: "sha256:" + "b".repeat(64),
    displayName: entry.presentation.displayName, rootComponentName: "github", version: entry.prelude.version,
    origin: "catalog", desiredState: "disabled",
    components: [{ componentId: entry.root, kind: "mcp", name: "github", required: true, desiredState: "disabled" }],
  }]
  packageAuthorizationItems = [{ kind: "secret", componentId: entry.root, prerequisiteId: `${entry.root}#GITHUB_PERSONAL_ACCESS_TOKEN`, serviceName: "github", label: "GITHUB_PERSONAL_ACCESS_TOKEN", saved: false }]
  receipts = [receipt(entry.root, "github", "mcp")]
  mount()
  await waitFor(() => expect(q('[data-installed-package="package:github"]')).toBeInstanceOf(HTMLElement))
  click(q('[data-installed-package="package:github"] [data-more]'))
  await waitFor(() => expect(q('[data-menu-item="manage"]')).toBeInstanceOf(HTMLElement))
  click(q('[data-menu-item="manage"]'))
  await waitFor(() => expect(q(".codepuppy-ext-detail")?.textContent).toContain("权限"))
  expect(q(".codepuppy-ext-detail")?.textContent).toContain("权限")
  expect(q(".codepuppy-ext-detail")?.textContent).toContain("关于")
  const openToken = () => click(q(".codepuppy-ext-detail [data-package-secret]"))
  // 账户段在读到账户项之后才画。
  await waitFor(() => expect(q(".codepuppy-ext-detail [data-package-secret]")).toBeInstanceOf(HTMLElement))
  openToken()
  await waitFor(() => expect(q('input[type="password"]')).toBeInstanceOf(HTMLInputElement))
  expect(q('[role="dialog"]')?.textContent).not.toContain("GITHUB_PERSONAL_ACCESS_TOKEN")
  click(q('[role="dialog"] .a-dialog-close'))
  await waitFor(() => expect(q('input[type="password"]')).toBeNull())
  openToken()
  await waitFor(() => expect(q('input[type="password"]')).toBeInstanceOf(HTMLInputElement))
})
const q = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector)
const qa = (selector: string, root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLElement>(selector))
function click(element: Element | null) {
  expect(element).toBeInstanceOf(HTMLElement)
  ;(element as HTMLElement).click()
}
/** 一个界面元素**整段**就是这句话(短标签用它判,不用子串 —— 「来源」「官方」也会出现在目录描述的正文里)。 */
const leavesSaying = (text: string, root: ParentNode = document) =>
  qa("*", root)
    .filter((node) => node.children.length === 0 && (node.textContent ?? "").trim() === text)
    .map((node) => node.outerHTML)
/** 断言「不在」时只把一小段 HTML 交给 expect —— 失败时 bun 会完整打印收到的值,而一个 DOM 节点的对象图大到能把进程拖死。 */
const html = (node: Element | null) => node?.outerHTML.slice(0, 300) ?? null
async function openMenu(trigger: Element | null) {
  click(trigger)
  await waitFor(() => expect(q("[data-menu]")).toBeInstanceOf(HTMLElement))
  return qa("[data-menu] [data-menu-item]").map((item) => item.getAttribute("data-menu-item"))
}

function mount(section: "connectors" | "skills" | "agents" = "connectors") {
  setHubSection(section)
  const root = document.createElement("div")
  root.id = "root"
  root.className = "a-ui"
  document.body.append(root)
  disposals.push(
    render(
      () => createComponent(ExtensionHub, { server: () => ({ baseUrl: "http://127.0.0.1:65535" }) as never, open: () => true, onClose: () => {} }),
      root,
    ),
  )
}
function reset() {
  secretFailure = undefined
  projectReceipts = []
  pathname = "/"
  removalPending = undefined
  for (const dispose of disposals.splice(0)) dispose()
  document.body.replaceChildren()
  receipts = []
  inventoryRows = []
  hubRows = []
  installedPackages = []
  factorySkillIds = []
  packageAuthorizationItems = []
  mcpStates = {}
  authOutcome = "connected"
  authPending = undefined
  stateFailure = undefined
  leaveApplying = false
  calls.importSkillFolder = 0
  nativeMain = undefined
  for (const list of [calls.filePicker, calls.installCatalog, calls.setInstallState, calls.uninstall, calls.builtinApply, calls.installPackage, calls.packageState, calls.packageSecrets, calls.packageRemove, calls.auth, calls.links]) list.length = 0
}
afterAll(async () => {
  reset()
  await GlobalRegistrator.unregister()
})

const receipt = (id: string, name: string, type: string): Receipt => ({
  id,
  name,
  type,
  scope: "global",
  installedAt: "2026-10-30T00:00:00.000Z",
  origin: "catalog",
  version: (bundledCatalog as { version: string }).version,
})
const inventoryRow = (id: string, name: string, kind: string, activation: "enabled" | "disabled") => ({
  id,
  name,
  kind,
  scope: "global",
  activation,
  health: { state: "healthy", issues: [] },
})
const hubRow = (id: string, name: string, kind: string, state: string, code?: string) => ({
  id,
  scope: "global",
  name,
  kind,
  displayName: name,
  description: "",
  installed: true,
  enabled: true,
  state,
  ...(code ? { stateReason: { code } } : {}),
  authorization: "none",
})

// ═══════════════════════════════════════════════════════════════════════════════════════

test("AC1 定制中心顶层只有「连接器」「技能」「助手」三个页签,点哪页显示哪页", async () => {
  reset()
  mount()
  await waitFor(() => expect(qa(".codepuppy-ext-tab").length).toBe(3))
  expect(qa(".codepuppy-ext-tab").map((tab) => tab.textContent)).toEqual([
    zh["codepuppy.ext.tabConnectors"],
    zh["codepuppy.ext.tabSkills"],
    zh["codepuppy.ext.tabAgents"],
  ])
  // 原推荐 / 插件 / 套件 / 已安装 / 导入 / 云能力不再是页签。
  for (const gone of ["codepuppy.ext.tabFeatured", "codepuppy.ext.tabPlugins", "codepuppy.ext.tabBundles", "codepuppy.ext.tabInstalled", "codepuppy.ext.tabCreate", "codepuppy.ext.tabCloud"] as const)
    expect(qa(".codepuppy-ext-tab").map((tab) => tab.textContent)).not.toContain(zh[gone])
  for (const [key, title] of [
    ["skills", zh["codepuppy.ext.tabSkills"]],
    ["agents", zh["codepuppy.ext.tabAgents"]],
    ["connectors", zh["codepuppy.ext.tabConnectors"]],
  ] as const) {
    click(q(`[data-tab="${key}"]`))
    await waitFor(() => expect(q(".codepuppy-ext-tab[data-active]")?.textContent).toBe(title))
    expect(q(`[data-tab="${key}"]`)?.hasAttribute("data-active")).toBe(true)
  }
  // 原页签的去处(批准稿「页签方案」表):套件与云能力是连接器页的两组。
  await waitFor(() => expect(q("[data-group='bundles']")).toBeInstanceOf(HTMLElement))
  expect(q("[data-group='cloud']")).toBeInstanceOf(HTMLElement)
})

test("AC2 每页只有标题、一行副标题、搜索框和「添加 ▾」;来源 / 许可证筛选、说明框、页脚说明与「尚未完成审核分级」整段都不再渲染", async () => {
  reset()
  mount()
  for (const [key, sub, placeholder] of [
    ["connectors", "codepuppy.ext.connectorsSub", "codepuppy.ext.searchConnectors"],
    ["skills", "codepuppy.ext.skillsSub", "codepuppy.ext.searchSkills"],
    ["agents", "codepuppy.ext.agentsSub", "codepuppy.ext.searchAgents"],
  ] as const) {
    click(q(`[data-tab="${key}"]`))
    await waitFor(() => expect(q(".codepuppy-ext-ph-desc")?.textContent).toBe(zh[sub]))
    const head = q(".codepuppy-ext-pagehd")!
    expect(q<HTMLInputElement>("input[type='search']", head)?.placeholder).toBe(zh["codepuppy.ext.sourceSearchPlaceholder"])
    expect(q("[data-more='add']", head)?.textContent).toBe(zh["codepuppy.ext.add"])
    // 页上不再有筛选条、说明框;技能页「推荐 / 系统」两个分段都看一遍。
    for (const segment of key === "connectors" ? [null] : ["recommended", "system"]) {
      if (segment) click(q(`[data-segment="${segment}"]`))
      await flush()
      expect(html(q(".codepuppy-ext-filters, .codepuppy-ext-fchip, .codepuppy-ext-callout, .codepuppy-ext-group-note, .codepuppy-ext-hero"))).toBeNull()
      // 筛选条与「未分级」组头是短标签:判「没有哪个元素整段就是它」。
      for (const gone of ["codepuppy.ext.filterSource", "codepuppy.ext.filterLicense", "codepuppy.ext.filterAll", "codepuppy.ext.ungradedGroup"] as const)
        expect(leavesSaying(zh[gone]), `${key}/${segment ?? "-"} 还在渲染 ${gone}`).toEqual([])
      // 说明框与页脚说明是整段话:判子串。
      const text = document.body.textContent ?? ""
      for (const gone of ["codepuppy.ext.ungradedNote", "codepuppy.ext.compatNote", "codepuppy.builtin.note", "codepuppy.ext.agentsNote", "codepuppy.ext.heroSub", "codepuppy.ext.pluginNote", "codepuppy.ext.createViaChatBody"] as const)
        expect(text, `${key}/${segment ?? "-"} 还在渲染 ${gone}`).not.toContain(zh[gone])
    }
  }
})

test("AC3 列表行 = 图标 + 名称 + 一行描述 + 一个动作,双列排布;行上不再挂来源、版本、兼容、就绪、运行位置标签", async () => {
  reset()
  mount()
  await waitFor(() => expect(qa("[data-group] > .codepuppy-ext-kit").length).toBeGreaterThan(10))
  for (const key of ["connectors", "skills", "agents"] as const) {
    click(q(`[data-tab="${key}"]`))
    await waitFor(() => expect(qa(".codepuppy-ext-grid > .codepuppy-ext-kit").length).toBeGreaterThan(0))
    for (const row of qa(".codepuppy-ext-grid > .codepuppy-ext-kit")) {
      // 每一行都住在双列网格里(`.codepuppy-ext-grid` = 两列,窄于 620px 时一列)。
      expect(row.parentElement?.classList.contains("codepuppy-ext-grid")).toBe(true)
      expect(q(":scope > .codepuppy-ext-kit-ic", row)).toBeInstanceOf(HTMLElement)
      expect(q(":scope > .codepuppy-ext-kit-body > .codepuppy-ext-kit-ttl > b", row)?.textContent?.length).toBeGreaterThan(0)
      expect(q(":scope > .codepuppy-ext-kit-body > .codepuppy-ext-kit-desc", row)).toBeInstanceOf(HTMLElement)
      // 恰好一个动作:一颗按钮,或一个「…」。
      expect(qa(":scope > button, :scope > .codepuppy-ext-more", row).length, row.textContent ?? "").toBe(1)
      expect(html(q(".codepuppy-ext-chip, .codepuppy-ext-meta, .codepuppy-ext-type-pill, .codepuppy-ext-ver, .codepuppy-ext-package-state, .codepuppy-ext-verify-chip", row))).toBeNull()
    }
    for (const gone of ["codepuppy.ext.sourceOfficial", "codepuppy.ext.sourceCommunity", "codepuppy.ext.sourceCodePuppy", "codepuppy.ext.packageVerdictCompatible", "codepuppy.ext.packagePrerequisiteReady", "codepuppy.ext.metaCloudExec", "codepuppy.ext.packageSourceRemote", "codepuppy.ext.packageSourceBuiltin", "codepuppy.ext.metaRestart", "codepuppy.ext.factoryBuiltin"] as const)
      for (const row of qa(".codepuppy-ext-grid > .codepuppy-ext-kit:not([data-factory-skill])"))
        expect(leavesSaying(zh[gone], row), `${key} 行上还有 ${gone}`).toEqual([])
  }
})

test("AC4 「添加 ▾」里是从文件夹导入 / 从 Git 地址导入 / 自定义连接器 / 导入助手,各自打开原来那个导入窗口", async () => {
  reset()
  mount("skills")
  const items = await openMenu(q("[data-more='add']"))
  expect(items).toEqual(["folder", "git", "custom-connector", "agent"])
  expect(qa("[data-menu] [data-menu-item]").map((item) => item.textContent)).toEqual([
    zh["codepuppy.ext.importFolder"],
    zh["codepuppy.ext.importGit"],
    zh["codepuppy.ext.customMcp"],
    zh["codepuppy.ext.importAgent"],
  ])
  // 文件夹 → main 的目录选择 + 导入(与原「导入」页的文件夹卡同一个入口)。
  click(q("[data-menu-item='folder']"))
  await waitFor(() => expect(calls.importSkillFolder).toBe(1))
  expect(html(q("[data-menu]"))).toBeNull()
  // Git → 原来那个 Git 地址窗口。
  await openMenu(q("[data-more='add']"))
  click(q("[data-menu-item='git']"))
  await waitFor(() => expect(q("[role='dialog']")?.textContent).toContain(zh["codepuppy.ext.importGitTitle"]))
  click(qa("[role='dialog'] .a-dialog-footer .a-btn")[0]!)
  await waitFor(() => expect(html(q("[role='dialog']"))).toBeNull())
  // 自定义连接器 → 原来那个填写窗口。
  await openMenu(q("[data-more='add']"))
  click(q("[data-menu-item='custom-connector']"))
  await waitFor(() => expect(q("[role='dialog']")?.textContent).toContain(zh["codepuppy.ext.customMcpTitle"]))
  click(qa("[role='dialog'] .a-dialog-footer .a-btn")[0]!)
  await waitFor(() => expect(html(q("[role='dialog']"))).toBeNull())
  // 导入助手 → 选 .md 文件(随后是原来那个映射预览窗口)。
  await openMenu(q("[data-more='add']"))
  click(q("[data-menu-item='agent']"))
  await waitFor(() => expect(calls.filePicker).toEqual([{ title: zh["codepuppy.ext.importAgentPick"], extensions: ["md"] } as never]))
})

test("AC5 每页顶部「已安装」一组,已装行的「…」含停用 / 移除 / 设置;应用自带的技能与助手在「系统」分段,隐藏 / 停用 / 自定义仍可用", async () => {
  reset()
  receipts = [receipt("skill:safe-refactor", "safe-refactor", "skill")]
  inventoryRows = [inventoryRow("skill:safe-refactor", "safe-refactor", "skill", "enabled")]
  factorySkillIds = ["skill-creator", "agent-creator", "cloud-capabilities"]
  mount("skills")
  await waitFor(() => expect(q("[data-group='installed'] [data-installed-row='skill:safe-refactor']")).toBeInstanceOf(HTMLElement))
  // 「已安装」是这一页的第一组。
  expect(q(".codepuppy-ext-ph-desc + .codepuppy-ext-grp .codepuppy-ext-grp-toggle")?.textContent).toContain(zh["codepuppy.ext.tabInstalled"])
  const row = q("[data-installed-row='skill:safe-refactor']")!
  expect(await openMenu(q("[data-more]", row))).toEqual(["disable", "remove", "settings"])
  expect(qa("[data-menu] [data-menu-item]").map((item) => item.textContent)).toEqual([
    zh["codepuppy.ext.turnOff"],
    zh["codepuppy.ext.remove"],
    zh["codepuppy.ext.rowSetup"],
  ])
  click(q("[data-menu-item='disable']"))
  await waitFor(() => expect(calls.setInstallState).toEqual([expect.objectContaining({ name: "safe-refactor", state: "disabled" })]))
  await openMenu(q("[data-more]", row))
  click(q("[data-menu-item='remove']"))
  await waitFor(() => expect(calls.uninstall).toEqual([expect.objectContaining({ type: "skill", name: "safe-refactor" })]))
  // 已装的不再在「推荐」里重复出现;出厂内置技能不在「推荐」里。
  expect(html(q("[data-entry='skill:safe-refactor']"))).toBeNull()
  expect(html(q("[data-entry='skill:skill-creator']"))).toBeNull()

  // 技能页「系统」:出厂内置技能 + 内置命令,命令的「…」是「自定义」。
  click(q("[data-segment='system']"))
  await waitFor(() => expect(q("[data-factory-skill='skill-creator']")).toBeInstanceOf(HTMLElement))
  // 应用自己起名的出厂技能显示中文名,id 只留在悬停提示里(技术详情才写 id)。
  await waitFor(() => expect(q("[data-factory-skill='agent-creator']")).toBeInstanceOf(HTMLElement))
  expect(q("[data-factory-skill='agent-creator'] b")!.textContent).toBe("助手创建助手")
  expect(q("[data-factory-skill='agent-creator'] b")!.getAttribute("title")).toBe("agent-creator")
  expect(q("[data-factory-skill='cloud-capabilities'] b")!.textContent).toBe("云端能力")
  await waitFor(() => expect(qa("[data-builtin-command]").map((n) => n.getAttribute("data-builtin-command"))).toEqual(["init", "review"]))
  expect(await openMenu(q("[data-builtin-command='init'] [data-more]"))).toEqual(["override"])
  click(q("[data-menu-item='override']"))
  await waitFor(() => expect(q(".codepuppy-gov-editor")).toBeInstanceOf(HTMLElement))

  // 助手页「系统」:应用自带的助手,「…」= 隐藏 / 停用 / 自定义,点下去真的写治理。
  click(q("[data-tab='agents']"))
  click(q("[data-segment='system']"))
  await waitFor(() => expect(q("[data-builtin-agent='build']")).toBeInstanceOf(HTMLElement))
  expect(await openMenu(q("[data-builtin-agent='build'] [data-more]"))).toEqual(["hide", "disable", "override"])
  click(q("[data-menu-item='hide']"))
  await waitFor(() => expect(calls.builtinApply.length).toBe(1))
  expect((calls.builtinApply[0] as { agents: { hide: string[] } }).agents.hide).toEqual(["build"])
  // 自己在对话里建的助手在助手页「已安装」组。
  click(q("[data-segment='recommended']"))
  expect(q("[data-group='installed'] [data-own-agent='docs-writer']")).toBeInstanceOf(HTMLElement)
})

test("AC6 需要令牌的扩展包仍可直接添加,安装与令牌填写分开", async () => {
  reset()
  const sample = (bundledCatalog as { packages: Array<{ prelude: { packageId: string; version: string }; presentation: { displayName: string; description: string } }> }).packages.find(
    (pack) => pack.prelude.packageId === "package:github-official",
  )!
  const github: CatalogPackageViewV1 = {
    catalogId: sample.prelude.packageId,
    verdict: "compatible",
    action: packageActionForReason("package-prerequisite-required"),
    components: [{ componentId: "mcp:github-official", role: "root", required: true, included: true, skipReasonCode: null }],
    prerequisites: {
      status: "required-action",
      items: [{ prerequisiteId: "mcp:github-official#GITHUB_PERSONAL_ACCESS_TOKEN", label: "GITHUB_PERSONAL_ACCESS_TOKEN", required: true }],
    },
    presentation: { ...sample.presentation, version: sample.prelude.version },
  }
  remoteCatalog = {
    source: "remote",
    catalog: { version: (bundledCatalog as { version: string }).version, entries: (bundledCatalog as { entries: unknown[] }).entries, packages: [github] },
  }
  mount("connectors")
  await waitFor(() => expect(q("[data-package-card='package:github-official']")).toBeInstanceOf(HTMLElement))
  const row = q("[data-package-card='package:github-official']")!
  expect(q(".codepuppy-ext-kit-desc", row)?.textContent).toBe(sample.presentation.description)
  expect(qa("button", row).map((button) => [button.hasAttribute("data-iact"), button.getAttribute("aria-label")?.startsWith("安装")])).toEqual([[true, true]])
  expect(row.textContent).not.toContain("GITHUB_PERSONAL_ACCESS_TOKEN")
  expect(document.body.textContent).not.toContain("需要先处理")
  expect(document.body.textContent).not.toContain("处理前置条件")
  // 「设置」= 原来的「处理前置条件」那一趟:同一条安装意图出站(随后由 main 的 authorize 臂打开填令牌的确认屏)。
  click(q("button", row))
  await waitFor(() => expect(calls.installPackage).toEqual(["package:github-official"]))
})

test("AC7 未完成审核的扩展装上默认关闭:行上「未开启」+「开启」;待生效的行「待生效 · …」+「立即生效」", async () => {
  reset()
  receipts = [receipt("mcp:fetch", "fetch", "mcp"), receipt("skill:mcp-builder", "mcp-builder", "skill"), receipt("skill:brand-guidelines", "brand-guidelines", "skill")]
  inventoryRows = [
    inventoryRow("mcp:fetch", "fetch", "mcp", "disabled"),
    inventoryRow("skill:mcp-builder", "mcp-builder", "skill", "enabled"),
    inventoryRow("skill:brand-guidelines", "brand-guidelines", "skill", "enabled"),
  ]
  hubRows = [hubRow("skill:mcp-builder", "mcp-builder", "skill", "reload-pending", "reload-waiting"), hubRow("skill:brand-guidelines", "brand-guidelines", "skill", "available")]
  mount("connectors")
  // 默认关闭的连接器:状态一句「未开启」,动作是「开启」,点下去走原来的启用通道。
  await waitFor(() => expect(q("[data-installed-row='mcp:fetch'] .codepuppy-ext-kit-desc")?.textContent).toBe(zh["codepuppy.ext.notOn"]))
  const enable = q("[data-installed-row='mcp:fetch'] [data-enable-row]")
  expect(enable?.textContent).toBe(zh["codepuppy.ext.turnOn"])
  click(enable)
  await waitFor(() => expect(calls.setInstallState).toEqual([expect.objectContaining({ name: "fetch", state: "enabled" })]))
  // 待生效:说「待生效 · 对话空闲后自动生效」,动作是「立即生效」;已生效的行照常描述 +「…」。
  click(q("[data-tab='skills']"))
  await waitFor(() => expect(q("[data-installed-row='skill:mcp-builder'] [data-hub-state='reload-pending']")).toBeInstanceOf(HTMLElement))
  expect(q("[data-installed-row='skill:mcp-builder'] .codepuppy-ext-kit-desc")?.textContent).toBe(
    `${zh["codepuppy.ext.hubStatePending"]} · ${zh["codepuppy.ext.hubReasonWaiting"]}`,
  )
  expect(q("[data-installed-row='skill:mcp-builder'] [data-hub-reload-now]")?.textContent).toBe(zh["codepuppy.ext.hubReloadNow"])
  expect(html(q("[data-installed-row='skill:brand-guidelines'] [data-hub-reload-now]"))).toBeNull()
  expect(q("[data-installed-row='skill:brand-guidelines'] [data-more]")).toBeInstanceOf(HTMLElement)
})

test("AC5 每页「已安装」组上的「全部更新」只更新这一页的条目(显示与执行同一判据)", async () => {
  reset()
  // 两条都落后于目录版本:一条技能(技能页)、一条连接器(连接器页)。技能排在前面 ——
  // 不按页过滤的实现会在连接器页先去更新那个技能。
  const old = "0.0.1" // 目录条目版本是 1.0.x(随包目录 `mcp:fetch` 1.0.1、`skill:safe-refactor` 1.0.0)
  receipts = [
    { ...receipt("skill:safe-refactor", "safe-refactor", "skill"), version: old },
    { ...receipt("mcp:fetch", "fetch", "mcp"), version: old },
  ]
  mount("connectors")
  await waitFor(() => expect(q("[data-installed-row='mcp:fetch'] [data-update-row]")).toBeInstanceOf(HTMLElement))
  const updateAll = () => qa(".codepuppy-ext-grp-h .codepuppy-ext-link").find((node) => node.textContent === zh["codepuppy.ext.updateAll"]) ?? null
  click(updateAll())
  // 连接器的更新走确认框重装(既有行为);技能一条都不许被碰。
  await waitFor(() => expect(q("[role='dialog']")).toBeInstanceOf(HTMLElement))
  expect(calls.installCatalog).toEqual([])
  click(qa("[role='dialog'] .a-dialog-footer .a-btn")[0]!)
  await waitFor(() => expect(html(q("[role='dialog']"))).toBeNull())
  // 技能页的「全部更新」只更新技能,不弹连接器的确认框。
  click(q("[data-tab='skills']"))
  await waitFor(() => expect(updateAll()).toBeInstanceOf(HTMLElement))
  click(updateAll())
  await waitFor(() => expect(calls.installCatalog).toEqual([expect.objectContaining({ catalogId: "skill:safe-refactor" })]))
  expect(html(q("[role='dialog']"))).toBeNull()
})

test("AC7 进不了详情页的默认关闭行:行上「开启」,「…」里只剩移除,不再重复一个「开启」", async () => {
  reset()
  receipts = [{ ...receipt("user:local-notes", "local-notes", "skill"), origin: "imported", version: undefined }]
  inventoryRows = [inventoryRow("user:local-notes", "local-notes", "skill", "disabled")]
  mount("skills")
  await waitFor(() => expect(q("[data-installed-row='skill:local-notes'] [data-enable-row]")).toBeInstanceOf(HTMLElement))
  const row = q("[data-installed-row='skill:local-notes']")!
  expect(q(".codepuppy-ext-kit-desc", row)?.textContent).toBe(zh["codepuppy.ext.notOn"])
  // 没有目录条目 ⇒ 进不了详情页 ⇒「…」留着,移除入口不丢;但「开启」只出现一次。
  expect(await openMenu(q("[data-more]", row))).toEqual(["remove"])
  // 装完默认关闭的提示指向的正是这颗「开启」(原来指向已拆掉的「已安装」页签与开关)。
  expect(zh["codepuppy.ext.addedDisabled"]).toContain(zh["codepuppy.ext.turnOn"])
  expect(zh["codepuppy.ext.addedDisabled"]).not.toContain("开关")
})

// #1658: prod installs.json, captured read-only on 2026-11-06; package uses ext-ipc.ts's real projection.
const cloudReceipt: Receipt = { id: "cloud:image", name: "image", type: "cloud", scope: "global", version: "1.0.0", installedAt: "2026-11-06T03:45:05.599Z", origin: "catalog" }
const cloudPackage: InstalledPackageV1 = { packageId: "package:cloud-image", installedGraphDigest: "sha256:041379893d634d990cbff7aa630239eaf7d92cfd668c41f3bfebd6a4d58e1e19", displayName: null, rootComponentName: "image", version: "1.0.0", origin: "catalog", components: [{ componentId: "cloud:image", kind: "cloud", name: "image", required: true, desiredState: "enabled" }] }
async function installedCloud() {
  reset()
  receipts = [cloudReceipt]
  installedPackages = [structuredClone(cloudPackage)]
  inventoryRows = [inventoryRow("cloud:image", "image", "cloud", "enabled")]
  // Real bundled envelope + existing producer payload; rebind its digest to exercise the host's own view projection.
  const envelope = structuredClone(bundledCatalog.packages.find((pack) => pack.prelude.packageId === cloudPackage.packageId)!)
  const payload = new Uint8Array(await Bun.file(new URL("../src/main/fixtures/hub-cloud-payload.json", import.meta.url)).arrayBuffer())
  envelope.components[0].payloadRef = { ...envelope.components[0].payloadRef, sha256: new Bun.CryptoHasher("sha256").update(payload).digest("hex"), bytes: payload.length }
  const view = await evaluatePackageForHost(envelope, { fetchPayload: async () => payload })
  expect(view.verdict).toBe("compatible")
  remoteCatalog = { source: "remote", catalog: { version: bundledCatalog.version, entries: bundledCatalog.entries, packages: [view] } }
}

test("#1658 AC1 installed cloud package and component use catalog names and cloud type, including legacy graphs", async () => {
  for (const displayName of [null, "云端图片生成"]) {
    await installedCloud()
    installedPackages[0].displayName = displayName
    mount()
    await waitFor(() => expect(q("[data-installed-package] b")?.textContent).toBe("云端图片生成"))
    expect(q("[data-installed-row='cloud:image']")).toBeNull()
    expect(q("[data-installed-package] .codepuppy-ext-type-pill")?.textContent).toBe("云能力")
    expect(q("[data-installed-package]")?.textContent).not.toContain("技能")
  }
})

test("#1658 AC2 installed cloud catalog card says installed and cannot add again; missing receipt remains addable", async () => {
  for (const installed of [true, false]) {
    await installedCloud()
    if (!installed) { receipts = []; installedPackages = [] }
    mount()
    await waitFor(() => expect(q(installed ? "[data-installed-package] [data-more]" : "[data-package-card] [data-iact]")).toBeInstanceOf(HTMLElement))
    if (installed) expect(q("[data-package-card]")).toBeNull()
    expect(calls.installCatalog).toEqual([])
  }
})

test("#1658 AC3 cloud verification identifies connection, tools or policy; raw details stay collapsed", async () => {
  for (const [code, detail, text] of [
    ["cloud-connection", "cloud MCP needs_auth", "云连接尚未通过核验"],
    ["cloud-tools", "dispatch is not in this directory's tool list", "工具清单尚未通过核验"],
    ["cloud-policy", "dispatch is ask by tool policy", "权限策略尚未通过核验"],
  ]) {
    await installedCloud()
    hubRows = [{ ...hubRow("cloud:image", "image", "cloud", "installed"), stateReason: { code, detail } }]
    mount()
    await waitFor(() => expect(q("[data-installed-package='package:cloud-image'] .codepuppy-ext-kit-desc")?.textContent).toBe(`已安装 · ${text}`))
    const row = q("[data-installed-package='package:cloud-image']")!
    const details = q<HTMLDetailsElement>("details", row)!
    expect(details.open).toBe(false)
    expect(details.textContent).toContain(detail)
    expect(q("summary", details)?.textContent).toBe("开发者详情")
    const visible = document.createElement("div")
    visible.append(row.cloneNode(true))
    visible.querySelectorAll("details").forEach((node) => node.remove())
    expect(visible.textContent).not.toContain(detail)
    expect(q(".codepuppy-ext-kit-desc", row)?.getAttribute("title")).toBeNull()
  }
})

// ── `#1691`「未恢复问题」入口的「查看」定位到出问题的那一行 ─────────────────────────────────────────
// 入口一侧(「查看」把服务身份交给 hub)的判据在 background-problem-watcher.test.ts;这里断言 hub 一侧:
// 目标行滚到可见、高亮约 2 秒后消退,目标不在时照常打开、什么都不高亮。滚动只记录调用(happy-dom 不排版)。
const scrolled: string[] = []
HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
  scrolled.push(this.getAttribute("data-installed-row") ?? this.getAttribute("data-cloud-connector") ?? "?")
}
const locatedRows = () => qa("[data-located]").map((node) => node.getAttribute("data-installed-row"))
const twoConnectors = () => [receipt("mcp:markitdown", "markitdown", "mcp"), { ...receipt("user:notes-mcp", "notes-mcp", "mcp"), origin: "created", version: undefined }]

test("#1691 AC-01 查看定位的连接器行:hub 打开后那一行滚到可见并高亮,约 2 秒后自行消退;别的行不动", async () => {
  reset()
  scrolled.length = 0
  receipts = twoConnectors()
  // 与真实路径同序:先由「查看」打开 hub 并给出目标,行随数据到达后才出现。
  openExtHubAt("connectors", "mcp:notes-mcp")
  mount()
  await waitFor(() => expect(locatedRows()).toEqual(["mcp:notes-mcp"]))
  expect(q("[data-installed-row='mcp:markitdown']")).toBeInstanceOf(HTMLElement)
  expect(scrolled).toEqual(["mcp:notes-mcp"])
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  expect(locatedRows(), "still highlighted before ~2 s").toEqual(["mcp:notes-mcp"])
  await new Promise((resolve) => setTimeout(resolve, 700))
  expect(locatedRows(), "highlight fades by itself after ~2 s").toEqual([])
  expect(scrolled, "located once, not again on re-render").toEqual(["mcp:notes-mcp"])
  setExtHubOpen(false)
})

test("#1691 AC-02 查看指向的连接器已不在:页面照常打开、不报错、不高亮任何行;关掉 hub 后目标作废", async () => {
  reset()
  scrolled.length = 0
  receipts = twoConnectors()
  openExtHubAt("connectors", "mcp:uninstalled-one")
  mount()
  await waitFor(() => expect(q("[data-installed-row='mcp:notes-mcp']")).toBeInstanceOf(HTMLElement))
  await flush()
  expect(qa(".codepuppy-ext-tab").length).toBe(3)
  expect(locatedRows()).toEqual([])
  expect(scrolled).toEqual([])
  expect(qa("[role='alert']").map((node) => node.textContent)).toEqual([])
  setExtHubOpen(false)
  expect(takeHubLocateTarget("mcp:uninstalled-one"), "a stale target does not survive closing the hub").toBe(false)
})

async function realInstalledPackage(index: number, state: "enabled" | "disabled" = "enabled") {
  const { hubPackageFixture } = await import("./hub-package.fixture")
  const sample = hubPackageFixture()
  const entry = sample.packages[index]!
  const view = await evaluatePackageForHost(entry, { fetchPayload: sample.fetchBytes })
  remoteCatalog = { source: "remote", catalog: { version: "hub-real", entries: bundledCatalog.entries, packages: [view] } }
  installedPackages = [{ packageId: entry.prelude.packageId, installedGraphDigest: "sha256:" + "c".repeat(64), displayName: entry.presentation.displayName, rootComponentName: entry.root.split(":")[1]!, version: entry.prelude.version, origin: "catalog", desiredState: state, components: entry.components.map((component) => ({ componentId: component.id, kind: component.profileId === "mcp-remote" ? "mcp" : component.profileId, name: component.id.split(":")[1]!, required: component.required, desiredState: state })) }]
  receipts = installedPackages[0]!.components.map((component) => receipt(component.componentId, component.name, component.kind))
  return entry
}
async function managePackage(packageId: string) {
  await waitFor(() => expect(q(`[data-installed-package="${packageId}"]`)).toBeInstanceOf(HTMLElement))
  click(q(`[data-installed-package="${packageId}"] [data-more]`))
  await waitFor(() => expect(q('[data-menu-item="manage"]')).toBeInstanceOf(HTMLElement))
  click(q('[data-menu-item="manage"]'))
  await waitFor(() => expect(q('[data-package-detail]')?.textContent).toContain(zh["codepuppy.ext.packagePermissions"]))
}

test("package idle switch converges from applying to off on the existing event and can turn on again", async () => {
  reset()
  const entry = await realInstalledPackage(0)
  packageAuthorizationItems = [{ kind: "secret", componentId: entry.root, prerequisiteId: `${entry.root}#GITHUB_PERSONAL_ACCESS_TOKEN`, serviceName: "github", label: "GITHUB_PERSONAL_ACCESS_TOKEN", saved: false }]
  mcpStates.github = { status: "connected" }
  mount()
  await waitFor(() => expect(q('[data-installed-package]')?.textContent).toContain("待填令牌"))
  leaveApplying = true
  click(q('[data-installed-package] [data-more]'))
  click(q('[role="switch"]'))
  await waitFor(() => expect(q('[data-installed-package]')?.textContent).toContain("正在生效"))
  expect(calls.packageState).toEqual([{ packageId: entry.prelude.packageId, state: "disabled" }])
  expect(document.body.textContent).not.toContain("这轮回答结束后生效")
  expect(q('[data-hub-reload-now]')).toBeNull()
  mcpStates.github = { status: "disabled" }
  hubRows = [hubRow(entry.root, "github", "mcp", "installed")]
  for (const listener of hubListeners) listener()
  await waitFor(() => expect(q('[data-installed-package]')?.textContent).toContain("已关闭"))
  leaveApplying = false
  click(q('[data-installed-package] [data-more]'))
  click(q('[role="switch"]'))
  await waitFor(() => expect(calls.packageState).toHaveLength(2))
  await waitFor(() => expect(q('[data-installed-package]')?.textContent).toContain("待填令牌"))
  expect(q('[data-installed-row="mcp:github"]')).toBeNull()
})

// `#1724`(签名 0.2.1 实测 12-state-poll):缺令牌的 MCP 引擎侧连不上 ⇒ hub-view 一直给 reload-pending,
// 行停在「正在生效」20 分钟以上。开启状态下缺前置项必须压过「待重载」,显示真实缺的东西。
test("enabled package missing its token shows the prerequisite even while its connector row stays reload-pending", async () => {
  reset()
  const entry = await realInstalledPackage(0)
  packageAuthorizationItems = [{ kind: "secret", componentId: entry.root, prerequisiteId: `${entry.root}#GITHUB_PERSONAL_ACCESS_TOKEN`, serviceName: "github", label: "GITHUB_PERSONAL_ACCESS_TOKEN", saved: false }]
  mcpStates.github = { status: "failed", error: "MCP failed" }
  hubRows = [hubRow(entry.root, "github", "mcp", "reload-pending", "not-loaded"), hubRow(entry.prelude.packageId, "github", "package", "reload-pending", "not-loaded")]
  mount()
  await waitFor(() => expect(q('[data-installed-package] [data-prerequisite]')?.textContent).toBe("待填令牌"))
  expect(q('[data-installed-package]')?.textContent).not.toContain("正在生效")
})

// `#1724`(编排器裁决,BR-04 显示准确状态):本地 MCP 握手失败后,hub-view 的核验一直不过 ⇒ reload-pending,包行停在
// 「正在生效」;失败原因若露出,也是引擎原文英文。失败要压过「待重载」,说的是本地化的短原因;原文留在开发者详情。
// 引擎状态按真实形状经 engine-adapter 的 v1McpStatus(去掉 `[codepuppy:<码>]` 前缀、码进 `code`)。
test("enabled package whose local connector failed to start shows a localized failure instead of applying forever", async () => {
  reset()
  const entry = await realInstalledPackage(0)
  packageAuthorizationItems = [{ kind: "secret", componentId: entry.root, prerequisiteId: `${entry.root}#GITHUB_PERSONAL_ACCESS_TOKEN`, serviceName: "github", label: "GITHUB_PERSONAL_ACCESS_TOKEN", saved: true }]
  mcpStates.github = v1McpStatus({ status: "failed", error: "[codepuppy:handshake_timeout] Request timed out (handshake_timeout)" }) as typeof mcpStates.github
  hubRows = [hubRow(entry.root, "github", "mcp", "reload-pending", "not-loaded"), hubRow(entry.prelude.packageId, "github", "package", "reload-pending", "not-loaded")]
  mount()
  await waitFor(() => expect(q('[data-installed-package] .codepuppy-ext-kit-desc[data-err]')?.textContent).toBe("启动超时"))
  expect(q('[data-installed-package] [data-row-status]')?.textContent).toBe("未能启用")
  expect(q('[data-installed-package]')?.textContent).not.toContain("正在生效")
  expect(q('[data-installed-package] .codepuppy-ext-kit-desc')?.textContent).not.toContain("Request timed out")
})

test("catalog connector row with a start failure shows the localized short reason, never the engine's English text", async () => {
  reset()
  receipts = [receipt("mcp:markitdown", "markitdown", "mcp")]
  mcpStates.markitdown = v1McpStatus({ status: "failed", error: "[codepuppy:spawn_failed] Connection closed: MCP server process exited with code 3 (spawn_failed)" }) as typeof mcpStates.markitdown
  hubRows = [hubRow("mcp:markitdown", "markitdown", "mcp", "reload-pending", "not-loaded")]
  mount()
  await waitFor(() => expect(q("[data-installed-row='mcp:markitdown'] .codepuppy-ext-kit-desc[data-err]")?.textContent).toBe("未能启动"))
  expect(q("[data-installed-row='mcp:markitdown'] .codepuppy-ext-kit-desc")?.getAttribute("title")).toContain("exited with code 3")
})

// `#1724`(体验约定不露内部原因码;BR-04):重载失败时 main 给的是内部英文原因(如 `official-connector-needs-reentry…`),
// 包行只说本地化的短原因,原文进开发者详情。
test("package whose last reload failed shows a localized short reason and keeps main's raw reason in developer details", async () => {
  reset()
  const entry = await realInstalledPackage(0)
  packageAuthorizationItems = [{ kind: "secret", componentId: entry.root, prerequisiteId: `${entry.root}#GITHUB_PERSONAL_ACCESS_TOKEN`, serviceName: "github", label: "GITHUB_PERSONAL_ACCESS_TOKEN", saved: true }]
  const raw = "official-connector-needs-reentry: runtime refresh failed"
  hubRows = [{ ...hubRow(entry.root, "github", "mcp", "reload-pending"), stateReason: { code: "reload-failed", detail: raw } }]
  mount()
  await waitFor(() => expect(q('[data-installed-package] .codepuppy-ext-kit-desc[data-err]')?.textContent).toBe("上次未能生效"))
  expect(q('[data-installed-package] [data-row-status]')?.textContent).toBe("未能启用")
  expect(q('[data-installed-package] details')?.textContent).toContain(raw)
})

test("package switch reflects failed and completed main results without a second apply action", async () => {
  reset()
  await realInstalledPackage(0, "disabled")
  stateFailure = "fixture: package write failed"
  mount()
  await waitFor(() => expect(q('[data-installed-package]')?.textContent).toContain("已关闭"))
  click(q('[data-installed-package] [data-more]'))
  click(q('[role="switch"]'))
  await waitFor(() => expect(q('[data-package-error]')).toBeInstanceOf(HTMLElement))
  click(q('[data-installed-package] [data-more]'))
  expect(q('[role="switch"]')?.getAttribute("aria-checked")).toBe("false")
  stateFailure = undefined
  click(q('[role="switch"]'))
  await waitFor(() => expect(installedPackages[0]?.desiredState).toBe("enabled"))
  await waitFor(() => expect(q('[data-installed-package]')?.textContent).not.toContain("正在生效"))
  expect(q('[data-hub-reload-now]')).toBeNull()
  expect(document.body.textContent).not.toContain("这轮回答结束后生效")
})

test("package token dialog explains purpose and real retrieval, clears cancelled input and saves to its package only", async () => {
  reset()
  const entry = await realInstalledPackage(0, "disabled")
  const prerequisiteId = `${entry.root}#GITHUB_PERSONAL_ACCESS_TOKEN`
  packageAuthorizationItems = [{ kind: "secret", componentId: entry.root, prerequisiteId, serviceName: "github", label: "GITHUB_PERSONAL_ACCESS_TOKEN", saved: false }]
  mount()
  await managePackage(entry.prelude.packageId)
  expect(q('[data-package-detail]')?.textContent).toContain("定制中心")
  expect(q('[data-package-detail]')?.textContent).toContain(entry.prelude.version)
  click(q('[data-package-secret]'))
  await waitFor(() => expect(q('input[type="password"]')).toBeInstanceOf(HTMLInputElement))
  expect(q('[role="dialog"]')?.textContent).toContain("连接 github")
  expect(q('input[type="password"]')?.getAttribute("placeholder")).toBe("粘贴令牌")
  expect(q('[role="dialog"]')?.textContent).toContain("助手用它访问你的 github，保存在这台电脑的专用密钥存储中。")
  expect(q('[role="dialog"]')?.textContent).toContain("专用密钥存储")
  click(q('[role="dialog"] .codepuppy-ext-link'))
  expect(calls.links).toEqual(["https://github.com/settings/personal-access-tokens/new"])
  const input = q<HTMLInputElement>('input[type="password"]')!
  input.value = "invalid-hub-token-canary-r2"
  input.dispatchEvent(new Event("input", { bubbles: true }))
  click(q('[role="dialog"] .a-dialog-close'))
  expect(calls.packageSecrets).toEqual([])
  click(q('[data-package-secret]'))
  await waitFor(() => expect(q<HTMLInputElement>('input[type="password"]')?.value).toBe(""))
  const fresh = q<HTMLInputElement>('input[type="password"]')!
  fresh.value = "invalid-hub-token-canary-r2"
  fresh.dispatchEvent(new Event("input", { bubbles: true }))
  click(q('[role="dialog"] .a-dialog-footer button'))
  await waitFor(() => expect(calls.packageSecrets).toEqual([{ packageId: entry.prelude.packageId, secrets: { [prerequisiteId]: "invalid-hub-token-canary-r2" } }]))
  await waitFor(() => expect(q('input[type="password"]')).toBeNull())
  expect(document.body.textContent).not.toContain("invalid-hub-token-canary-r2")
  expect(document.body.textContent).not.toContain("GITHUB_PERSONAL_ACCESS_TOKEN")
  expect(installedPackages[0]?.desiredState).toBe("disabled")
  expect(calls.installPackage).toEqual([])
})

test("package login cancellation and failure keep the same installed package; disabled login can complete", async () => {
  reset()
  const entry = await realInstalledPackage(1, "disabled")
  packageAuthorizationItems = [{ kind: "mcp-oauth", componentId: "mcp:supabase", prerequisiteId: "mcp:supabase#oauth", serviceName: "supabase", label: "Supabase", authenticated: false, status: "disabled" }]
  mcpStates.supabase = { status: "disabled" }
  authOutcome = "failed"
  mount()
  await managePackage(entry.prelude.packageId)
  let finishAuth: () => void = () => {}
  authPending = new Promise<void>((resolve) => { finishAuth = resolve })
  click(q('[data-package-login]'))
  await waitFor(() => expect(calls.auth).toEqual(["supabase"]))
  expect(q('[role="dialog"]')?.textContent).toContain("登录后，助手就能使用")
  expect(q('input[type="password"]')).toBeNull()
  click(q('[role="dialog"] .a-dialog-close'))
  finishAuth()
  authPending = undefined
  await flush()
  expect(installedPackages[0]?.packageId).toBe(entry.prelude.packageId)
  click(q('[data-package-login]'))
  await waitFor(() => expect(q('[role="dialog"] [role="alert"]')).toBeInstanceOf(HTMLElement))
  click(q('[role="dialog"] .a-dialog-close'))
  authOutcome = "disabled"
  click(q('[data-package-login]'))
  await waitFor(() => expect(q('[role="dialog"]')).toBeNull())
  await waitFor(() => expect(q('[data-package-detail]')?.textContent).toContain("已登录"))
  expect(q('[data-package-login]')?.textContent).toBe("重新登录")
  expect(calls.auth).toEqual(["supabase", "supabase", "supabase"])
  expect(calls.installPackage).toEqual([])
  expect(installedPackages[0]?.desiredState).toBe("disabled")
})

test("package management uses the existing permission editor and removes once without component remnants", async () => {
  reset()
  const entry = await realInstalledPackage(1)
  mount()
  await managePackage(entry.prelude.packageId)
  expect(q('[data-package-detail]')?.textContent).toContain("2 个技能 · 1 个连接器")
  const permissionButton = qa('.codepuppy-ext-kv-sec button').find((button) => button.textContent === "更改")!
  click(permissionButton)
  expect(q('[data-tools-live]')).toBeInstanceOf(HTMLElement)
  expect(q('[data-tools-state="no-project"]')).toBeInstanceOf(HTMLElement)
  click(q('[data-package-detail] [data-more]'))
  const remove = q('[data-menu-item="remove-package"]')!
  let finishRemoval: () => void = () => {}
  removalPending = new Promise<void>((resolve) => { finishRemoval = resolve })
  click(remove)
  await waitFor(() => expect(calls.packageRemove).toHaveLength(1))
  // A second activation admitted while the first IPC is unresolved must hit the action guard.
  // Use a live menu node; remove disabled only to model an already-admitted activation.
  click(q('[data-package-detail] [data-more]'))
  const again = q<HTMLButtonElement>('[data-menu-item="remove-package"]')!
  expect(again.isConnected).toBe(true)
  expect(again.disabled).toBe(true)
  again.disabled = false
  click(again)
  await flush()
  expect(calls.packageRemove).toHaveLength(1)
  finishRemoval()
  await waitFor(() => expect(calls.packageRemove).toEqual([entry.prelude.packageId]))
  await waitFor(() => expect(q('[data-installed-package]')).toBeNull())
  expect(q('[data-installed-row="mcp:supabase"]')).toBeNull()
  expect(q('[data-installed-row="skill:supabase"]')).toBeNull()
  expect(document.body.textContent).not.toContain(entry.prelude.packageId)
})

test("graph marketplace source and notRunning facts reach the installed row and the same management page", async () => {
  // Renderer boundary variants of the real GitHub package; source shape is DESIGN v5 §4.4,
  // repository and abbreviated pinned commit come from its captured E-02 sample.
  for (const ecosystem of ["claude", "codex"] as const) {
    reset()
    const entry = await realInstalledPackage(0)
    Object.assign(installedPackages[0]!, {
      origin: "imported-claude",
      source: { kind: "marketplace", ecosystem, repository: "anthropics/claude-plugins-official", commit: "b5b01ac4", path: "external_plugins/github", entryName: "github" },
      notRunning: [{ kind: "plugin", sourceName: "native-addon", reason: "native-js-plugin" }],
    })
    mount()
    const source = ecosystem === "claude" ? "Claude 插件市场" : "Codex 插件市场"
    await waitFor(() => expect(q('[data-installed-package]')?.textContent).toContain(source))
    expect(q('[data-installed-package] [data-row-status]')?.textContent).toBe("未能启用")
    expect(q('[data-installed-package]')?.textContent).toContain("Code Puppy 不在引擎里运行第三方插件代码")
    await managePackage(entry.prelude.packageId)
    expect(q('[data-package-detail]')?.textContent).toContain(source)
    expect(q('[data-package-detail]')?.textContent).not.toContain("本地文件夹")
    expect(q('[data-package-detail]')?.textContent).toContain("anthropics/claude-plugins-official")
    expect(q('[data-package-detail]')?.textContent).toContain("b5b01ac4")
    expect(q('[data-package-detail]')?.textContent).toContain("native-addon")
    expect(q('[data-package-detail]')?.textContent).toContain("未能启用：Code Puppy 不在引擎里运行第三方插件代码")
    expect(q('[data-package-detail]')?.textContent).not.toContain("native-js-plugin")
  }
})

test("language server runtime states reach the enabled installed row on its reason line", async () => {
  // Renderer boundary values in the design v3.4 R-l DTO; the program name is the real pyright-lsp command.
  for (const [state, detail, text, failed] of [
    ["dependency-missing", "pyright-langserver", "pyright · 本机缺少程序 pyright-langserver", true],
    ["diagnostics-ready", undefined, "pyright · 语言服务诊断已就绪", false],
  ] as const) {
    reset()
    await realInstalledPackage(0)
    Object.assign(installedPackages[0]!, { desiredState: "enabled", languageServers: [{ sourceName: "pyright", state, ...(detail ? { detail } : {}) }] })
    mount()
    await waitFor(() => expect(q('[data-installed-package]')?.textContent).toContain(text))
    expect(q('[data-installed-package] [data-row-status]')?.textContent === "未能启用").toBe(failed)
  }
  reset()
  await realInstalledPackage(0)
  Object.assign(installedPackages[0]!, { desiredState: "disabled", languageServers: [{ sourceName: "pyright", state: "dependency-missing", detail: "pyright-langserver" }] })
  mount()
  await waitFor(() => expect(q('[data-installed-package]')).toBeInstanceOf(HTMLElement))
  expect(q('[data-installed-package]')?.textContent).not.toContain("pyright-langserver")
})

test("openPackageManagement opens the requested installed identity from another tab without installing", async () => {
  reset()
  await realInstalledPackage(0)
  const github = installedPackages[0]!
  await realInstalledPackage(1)
  const supabase = installedPackages[0]!
  installedPackages = [github, supabase]
  receipts = installedPackages.flatMap((pack) => pack.components.map((component) => receipt(component.componentId, component.name, component.kind)))
  mount("skills")
  await waitFor(() => expect(q('[data-installed-package="package:supabase"]')).toBeInstanceOf(HTMLElement))
  expect(typeof openPackageManagement).toBe("function")
  openPackageManagement(github.packageId)
  await waitFor(() => expect(q('[data-package-detail]')?.getAttribute("data-package-detail")).toBe(github.packageId))
  expect(extHubOpen()).toBe(true)
  expect(q('[data-tab="connectors"]')?.hasAttribute("data-active")).toBe(true)
  expect(q('[data-package-detail="package:supabase"]')).toBeNull()
  openPackageManagement(supabase.packageId)
  await waitFor(() => expect(q('[data-package-detail]')?.getAttribute("data-package-detail")).toBe(supabase.packageId))
  expect(q('[data-package-detail]')?.textContent).toContain("2 个技能 · 1 个连接器")
  expect(calls.installPackage).toEqual([])
  expect(calls.packageState).toEqual([])
  openPackageManagement("package:removed")
  await waitFor(() => expect(q('[data-package-detail]')).toBeNull())
})

test("package management navigation survives a closed hub and a later reopen", async () => {
  reset()
  const entry = await realInstalledPackage(1)
  setExtHubOpen(false)
  const root = document.createElement("div")
  root.id = "root"
  root.className = "a-ui"
  document.body.append(root)
  disposals.push(render(() => createComponent(ExtensionHub, {
    server: () => ({ baseUrl: "http://127.0.0.1:65535" }) as never,
    open: extHubOpen,
    onClose: () => setExtHubOpen(false),
  }), root))
  expect(q('[data-package-detail]')).toBeNull()
  openPackageManagement(entry.prelude.packageId)
  await waitFor(() => expect(q('[data-package-detail]')?.getAttribute("data-package-detail")).toBe(entry.prelude.packageId))
  // 顶级页面没有关闭按钮(冻结稿):Esc 先退出管理页、再离开定制中心(侧栏入口同样关闭)。
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
  await waitFor(() => expect(q('[data-package-detail]')).toBeNull())
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
  await waitFor(() => expect(extHubOpen()).toBe(false))
  expect(q('[data-package-detail]')).toBeNull()
  openPackageManagement(entry.prelude.packageId)
  await waitFor(() => expect(q('[data-package-detail]')?.getAttribute("data-package-detail")).toBe(entry.prelude.packageId))
  expect(calls.installPackage).toEqual([])
  expect(calls.packageState).toEqual([])
})


test("official credential dialogs reuse DSN and PAT help and report credential save failures", async () => {
  for (const [name, variable, help] of [["dbhub-readonly", "DSN", "codepuppy.ext.officialSqliteDsn"], ["github-official", "GITHUB_PERSONAL_ACCESS_TOKEN", "codepuppy.ext.officialGithubPat"]] as const) {
    reset()
    const entry = bundledCatalog.packages.find((entry) => entry.prelude.packageId === `package:${name}`)!
    // Actual bundled catalog entry; only the renderer IPC read model is constructed here.
    installedPackages = [{ packageId: entry.prelude.packageId, installedGraphDigest: "sha256:" + "a".repeat(64), displayName: entry.presentation.displayName, rootComponentName: name, version: entry.prelude.version, origin: "catalog", desiredState: "enabled", components: entry.components.map((component) => ({ componentId: component.id, kind: "mcp", name, required: component.required, desiredState: "enabled" })) }]
    receipts = [receipt(entry.root, name, "mcp")]
    packageAuthorizationItems = [{ kind: "secret", componentId: entry.root, prerequisiteId: `${entry.root}#${variable}`, serviceName: name, label: variable, saved: false }]
    secretFailure = "package credentials could not be saved"
    mount()
    await managePackage(entry.prelude.packageId)
    click(q('[data-package-secret]'))
    await waitFor(() => expect(q('input[type="password"]')).toBeInstanceOf(HTMLInputElement))
    expect(q('[role="dialog"]')?.textContent).toContain(zh[help])
    const input = q<HTMLInputElement>('input[type="password"]')!
    expect(input.placeholder).toBe(zh[help])
    expect(input.required).toBe(false)
    input.value = "invalid-local-credential-r4"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    click(q('[role="dialog"] .a-dialog-footer button'))
    await waitFor(() => expect(q('[role="dialog"] [role="alert"]')?.textContent).toBe("凭据未能保存，请检查填写内容后重试。"))
    expect(q('[role="dialog"]')?.textContent).not.toContain(zh["codepuppy.ext.mcpAuthFailed"])
    expect(installedPackages[0]?.packageId).toBe(entry.prelude.packageId)
  }
})

test.each([undefined, { kind: "project" as const, projectPath: "/project/alpha", projectPathHash: "a".repeat(64) }])("installed package management displays its effective scope: %j", async (effect) => {
  reset()
  installedPackages = [{
    packageId: "mine:scope-display", installedGraphDigest: "sha256:" + "b".repeat(64),
    displayName: "Scope display", rootComponentName: "scope-display", version: "1.0.0",
    origin: "created", desiredState: "enabled", source: { kind: "created" },
    ...(effect ? { effect } : {}),
    components: [{ componentId: "user:scope-display", kind: "skill", name: "scope-display", required: true, desiredState: "enabled" }],
  }]
  receipts = [receipt("user:scope-display", "scope-display", "skill")]
  mount()
  await waitFor(() => expect(q('[data-installed-package="mine:scope-display"]')).toBeInstanceOf(HTMLElement))
  click(q('[data-installed-package="mine:scope-display"] [data-more]'))
  await waitFor(() => expect(q('[data-menu-item="manage"]')).toBeInstanceOf(HTMLElement))
  click(q('[data-menu-item="manage"]'))
  await waitFor(() => expect(q(".codepuppy-ext-detail")?.textContent).toContain("生效范围"))
  expect(q(".codepuppy-ext-detail")?.textContent).toContain(effect ? "仅当前项目" : "我的所有项目")
})

test("D4 factory plugin helper has its shipped name and purpose without an install or switch", async () => {
  reset()
  factorySkillIds = ["plugin-helper"]
  mount("skills")
  click(q('[data-segment="system"]'))
  await waitFor(() => expect(q('[data-factory-skill="plugin-helper"]')).toBeInstanceOf(HTMLElement))
  const row = q('[data-factory-skill="plugin-helper"]')!
  expect(q("b", row)?.textContent).toBe("插件助手")
  expect(q(".codepuppy-ext-kit-desc", row)?.textContent).toBe("查找并安装插件和 MCP")
  expect(q("[data-more], button, input", row)).toBeNull()
  expect(q('[data-installed-package]')).toBeNull()
  expect(calls.installCatalog).toEqual([])
  expect(calls.installPackage).toEqual([])
  expect(calls.packageState).toEqual([])
})

test("D4 created source stays My plugin through its package row, management and whole removal", async () => {
  reset()
  // This is our renderer read model; source, rather than an ID prefix or name, owns provenance.
  const packageId = "package:photoshop-report"
  installedPackages = [{
    packageId, installedGraphDigest: "sha256:" + "c".repeat(64),
    displayName: "PSD report", rootComponentName: "photoshop-report", version: "1.0.0",
    origin: "created", desiredState: "enabled", source: { kind: "created" },
    components: [{ componentId: "user:photoshop-report", kind: "skill", name: "photoshop-report", required: true, desiredState: "enabled" }],
  }]
  receipts = [receipt("user:photoshop-report", "photoshop-report", "skill")]
  mount()
  await waitFor(() => expect(q('[data-installed-package]')?.textContent).toContain("我的插件"))
  expect(q('[data-installed-package]')?.textContent).not.toContain("官方")
  await managePackage(packageId)
  expect(q('[data-package-detail]')?.textContent).toContain("我的插件")
  expect(q('[data-package-detail]')?.textContent).not.toContain("官方")
  click(q('[data-package-detail] [data-more]'))
  click(q('[data-menu-item="remove-package"]'))
  await waitFor(() => expect(calls.packageRemove).toEqual([packageId]))
  await waitFor(() => expect(q('[data-installed-package]')).toBeNull())
  expect(calls.uninstall).toEqual([])
})

test("BC1 the one Hub search input reaches sources and its plus reaches the single install entry",async()=>{
 reset();mount()
 const {createPluginSources}=await import("../src/main/plugin-sources")
 const {fixtureFetch}=await import("../test-fixtures/plugin-helper/source-fetch")
 const answer=await createPluginSources({catalog:async()=>[],fetch:fixtureFetch}).searchSources("context7")
 const calls:unknown[]=[]
 Object.assign(window.api.ext,{sourcesSearch:async(query:string)=>{calls.push(["search",query]);return answer},installFromSource:async(request:unknown)=>{calls.push(["install",request]);return {ok:true,packageId:"claude:context7",displayName:"context7",source:{kind:"marketplace",ecosystem:"claude",repository:"anthropics/claude-plugins-official",commit:"b5b01ac4",path:"external_plugins/context7",entryName:"context7"},installed:[],notRunning:[]}}})
 const input=q<HTMLInputElement>('input[type="search"]')!
 expect(input.placeholder).toBe("搜索插件、技能或 MCP")
 input.value="context7";input.dispatchEvent(new Event("input",{bubbles:true}))
 await waitFor(()=>expect(q("[data-source-candidate]" )).not.toBeNull())
 expect(qa('input[type="search"]')).toHaveLength(1)
 click(q("[data-source-candidate] button"))
 await waitFor(()=>expect(calls.filter((call)=>Array.isArray(call)&&call[0]==="install")).toHaveLength(1))
 expect(calls).toMatchObject([["search","context7"],["install",{source:{kind:"candidate",candidateId:answer.candidates[0]!.id},effect:{kind:"all-projects"},via:"hub"}]])
 expect(q('[role="dialog"]')).toBeNull()
 expect(qa('[data-group="installed"]')).toHaveLength(0)
})


test("BC2b folder menu installs the main-minted whole package without an install confirmation",async()=>{
 reset();mount("skills")
 const {createPluginSources}=await import("../src/main/plugin-sources")
 const {captureFixture}=await import("../test-fixtures/plugin-helper/fixture")
 const sources=createPluginSources({catalog:async()=>[]})
 const prepared=await sources.prepareCapture(await captureFixture("plugins/frontend-design"))
 expect(prepared.kind).toBe("package")
 const wire:unknown[]=[]
 const previous={preparePluginSource:window.api.ext.preparePluginSource,installFromSource:window.api.ext.installFromSource}
 Object.assign(window.api.ext,{preparePluginSource:async(input:unknown)=>{wire.push(input);return {ok:true,prepared}},installFromSource:async(input:unknown)=>{wire.push(input);return {ok:true,packageId:"local:frontend-design",displayName:"frontend-design",source:{kind:"local-folder"},installed:[],notRunning:[]}}})
 try{
  await openMenu(q("[data-more='add']"));click(q("[data-menu-item='folder']"))
  await waitFor(()=>expect(wire).toHaveLength(2))
  expect(wire).toMatchObject([{kind:"folder"},{source:{kind:"candidate",candidateId:prepared.kind==="package"?prepared.candidateId:""},effect:{kind:"all-projects"},via:"hub"}])
  expect(q('[role="dialog"]')).toBeNull()
  expect(q('[data-local-package-preview]')).toBeNull()
  expect(calls.importSkillFolder).toBe(0)
 }finally{Object.assign(window.api.ext,previous)}
})

test("BC2b Git market shows real per-entry source rows and installs only the clicked main ID",async()=>{
 reset();mount()
 const {createPluginSources}=await import("../src/main/plugin-sources")
 const {fixtureFetch}=await import("../test-fixtures/plugin-helper/source-fetch")
 const sources=createPluginSources({catalog:async()=>[],fetch:fixtureFetch})
 const prepared=await sources.prepareCapture(await sources.captureGit("https://github.com/anthropics/claude-plugins-official","refs/heads/main"))
 if(prepared.kind!=="marketplace")throw Error("real fixture is not a marketplace")
 const selected=prepared.entries.find(entry=>entry.displayName==="context7")!
 const wire:unknown[]=[]
 const previous={preparePluginSource:window.api.ext.preparePluginSource,installFromSource:window.api.ext.installFromSource}
 Object.assign(window.api.ext,{preparePluginSource:async(input:unknown)=>{wire.push(input);return {ok:true,prepared}},installFromSource:async(input:unknown)=>{wire.push(input);return {ok:true,packageId:"claude:context7",displayName:"context7",source:{kind:"marketplace",ecosystem:"claude"},installed:[],notRunning:[]}}})
 try{
  await openMenu(q("[data-more='add']"));click(q("[data-menu-item='git']"))
  const input=q<HTMLInputElement>('[role="dialog"] input')!;input.value="https://github.com/anthropics/claude-plugins-official";input.dispatchEvent(new Event("input",{bubbles:true}))
  click(qa('[role="dialog"] .a-dialog-footer button')[1]!)
  await waitFor(()=>expect(qa("[data-source-candidate]")).toHaveLength(prepared.entries.length))
  expect(wire).toEqual([{kind:"git",url:input.value}])
  expect(qa('[role="dialog"] button').some(button=>button.textContent?.includes("全部安装"))).toBe(false)
  expect(q(`[data-source-candidate="${selected.id}"]`)?.textContent).toContain("Claude 插件市场")
  click(q(`[data-source-candidate="${selected.id}"] button`))
  await waitFor(()=>expect(wire).toHaveLength(2))
  expect(wire[1]).toMatchObject({source:{kind:"candidate",candidateId:selected.id},effect:{kind:"all-projects"},via:"hub"})
 }finally{Object.assign(window.api.ext,previous)}
})

test("R14 B6 Git import failure uses localised copy rather than main detail", async () => {
 reset();mount()
 const previous=window.api.ext.preparePluginSource
 Object.assign(window.api.ext,{preparePluginSource:async()=>({ok:false,detail:"RAW_MAIN_GIT_FAILURE"})})
 try{
  await openMenu(q("[data-more='add']"));click(q("[data-menu-item='git']"))
  const input=q<HTMLInputElement>('[role="dialog"] input')!;input.value="https://gitlab.com/anthropics/claude-plugins-official";input.dispatchEvent(new Event("input",{bubbles:true}))
  click(qa('[role="dialog"] .a-dialog-footer button')[1]!)
  await waitFor(()=>expect(document.body.textContent).toContain("未能读取 Git 插件来源"))
  expect(document.body.textContent).not.toContain("RAW_MAIN_GIT_FAILURE")
 }finally{Object.assign(window.api.ext,{preparePluginSource:previous})}
})

test("R14 B12 a non-search catalog plus installs directly without the unreviewed default-off wall", async () => {
 reset();mount("connectors")
 await waitFor(()=>expect(q('[data-entry="mcp:fetch"] button')).toBeInstanceOf(HTMLButtonElement))
 click(q('[data-entry="mcp:fetch"] button'))
 await waitFor(()=>{
  expect(document.body.textContent).not.toContain("未经审核，装好后默认关闭")
  expect(q('[role="dialog"]')).toBeNull()
  expect(calls.installPackage).toEqual(["mcp:fetch"])
 })
 expect(calls.installCatalog).toEqual([])
})


test("review B7 one search finds own agents and local/created packages across tabs", async () => {
  reset()
  await realInstalledPackage(0)
  const original = installedPackages[0]!
  installedPackages = [
    { ...original, packageId: "local:github", origin: "imported", source: { kind: "local-folder" } },
    { ...original, packageId: "mine:github", origin: "created", source: { kind: "created" } },
  ]
  const previous = window.api.ext.sourcesSearch
  Object.assign(window.api.ext, { sourcesSearch: async (query: string) => ({ searchId: "local-search", query, sources: [], candidates: [] }) })
  try {
    mount("skills")
    const input = q<HTMLInputElement>('input[type="search"]')!
    const search = (query: string) => { input.value = query; input.dispatchEvent(new Event("input", { bubbles: true })) }
    search("GitHub")
    await waitFor(() => expect(qa('[data-installed-package]')).toHaveLength(2))
    expect(q('[data-installed-package="local:github"]')?.textContent).toContain("本地文件夹")
    expect(q('[data-installed-package="mine:github"]')?.textContent).toContain("我的插件")
    expect(document.body.textContent).not.toContain(zh["codepuppy.ext.sourceNoMatches"])
    search("docs-writer")
    await waitFor(() => expect(document.body.textContent).toContain("docs-writer"))
    expect(qa('[data-installed-package]')).toHaveLength(0)
    expect(document.body.textContent).not.toContain(zh["codepuppy.ext.sourceNoMatches"])
    search("no-local-result")
    await Bun.sleep(300) // The production source query is debounced by 250 ms.
    await waitFor(() => expect(document.body.textContent).toContain(zh["codepuppy.ext.sourceNoMatches"]))
    expect(document.body.textContent).not.toContain("docs-writer")
    expect(calls.installPackage).toEqual([])
  } finally { Object.assign(window.api.ext, { sourcesSearch: previous }) }
})

// ── D6 片 6b(活稿 #hub-native):本机文件条目行 ───────────────────────────────────────────────────────────────────────
const { createNativeSources } = await import("../src/main/native-sources")
const { ToastViewport } = await import("../src/renderer/codepuppy-ui/Toast")
const nativeHome = "/home/native-user"
async function nativeFixture(input: { consent?: "granted" | "awaiting-consent" | "consent-denied"; descriptions?: Record<string, unknown>[] } = {}) {
  const fs = await import("node:fs")
  const os = await import("node:os")
  const path = await import("node:path")
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-native-"))
  const reloads: string[] = []
  nativeMain = createNativeSources({
    root: () => root,
    home: nativeHome,
    descriptions: async () => ({ skills: input.descriptions ?? [], agents: [], commands: [] }),
    consent: () => input.consent ?? "granted",
    pending: () => false,
    defaultDirectory: () => "/work/any",
    requestReload: (reason) => void reloads.push(reason),
    log: () => {},
  })
  return { root, reloads, ledger: () => JSON.parse(fs.readFileSync(path.join(root, "installs.json"), "utf8")).nativeSources as Array<Record<string, unknown>> }
}
function mountToasts() {
  const root = document.createElement("div")
  root.className = "a-ui"
  document.body.append(root)
  disposals.push(render(() => createComponent(ToastViewport, {}), root))
}

test("native file rows show directory, menu switch, removal group and rejoin", async () => {
  reset()
  const skill = `${nativeHome}/.claude/skills/review-pr/SKILL.md`
  const command = `${nativeHome}/.config/opencode/commands/release-notes.md`
  const native = await nativeFixture({ descriptions: [{ id: "review-pr", path: skill, description: "审查拉取请求，按严重程度列出问题和修改建议" }] })
  await nativeMain!.sync("/work/any", [{ file: skill, kind: "skill", entry: "review-pr", active: true }, { file: command, kind: "command", entry: "release-notes", active: true }])
  mountToasts()
  mount("skills")
  const row = () => q('[data-group="installed"] [data-native-entry="review-pr"]')
  await waitFor(() => expect(row()).toBeInstanceOf(HTMLElement))
  expect(q("[data-native-name]", row()!)?.textContent).toBe("review-pr")
  expect(q("[data-native-directory]", row()!)?.textContent).toBe("~/.claude/skills")
  expect(q("[data-native-directory] i", row()!)).toBeNull()
  expect(row()!.textContent).toContain("审查拉取请求")
  const commandRow = q('[data-group="installed"] [data-native-entry="release-notes"]')!
  expect(q("[data-native-name]", commandRow)?.textContent).toBe("/release-notes")
  expect(q("[data-native-directory]", commandRow)?.textContent).toBe("~/.config/opencode")
  // 「…」菜单与包同一组:开启开关 / 管理 / 移除
  click(q("[data-more]", row()!))
  await waitFor(() => expect(q('[role="switch"]')).toBeInstanceOf(HTMLElement))
  expect(q('[role="switch"]')?.getAttribute("aria-checked")).toBe("true")
  click(q('[role="switch"]'))
  await waitFor(() => expect(row()?.textContent).toContain("已关闭"))
  expect(native.ledger().find((item) => item.entry === "review-pr")).toMatchObject({ desiredState: "disabled", removed: false })
  // 移除:行离开「已安装」,进收起的「已移除 1」,提示说明文件还在
  click(q("[data-more]", row()!))
  await waitFor(() => expect(qa("button").some((button) => button.textContent?.trim() === "移除")).toBe(true))
  click(qa("button").find((button) => button.textContent?.trim() === "移除")!)
  await waitFor(() => expect(row()).toBeNull())
  await waitFor(() => expect(document.body.textContent).toContain("已移除『review-pr』"))
  expect(document.body.textContent).toContain("文件仍在原处，可在「已移除」里重新加入。")
  const removedGroup = () => q('[data-group-id="native-removed"]')
  expect(removedGroup()?.textContent).toContain("已移除")
  expect(removedGroup()?.textContent).toContain("1")
  expect(q('[data-native-rejoin]')).toBeNull()
  click(q(".codepuppy-ext-grp-toggle", removedGroup()!))
  await waitFor(() => expect(q('[data-native-rejoin]')).toBeInstanceOf(HTMLElement))
  expect(q('[data-native-rejoin]')?.getAttribute("aria-label")).toBe("重新加入 review-pr")
  expect(q('[data-group="native-removed"] [data-more]')).toBeNull()
  click(q('[data-native-rejoin]'))
  await waitFor(() => expect(row()).toBeInstanceOf(HTMLElement))
  await waitFor(() => expect(document.body.textContent).toContain("已重新加入『review-pr』"))
  expect(row()?.textContent).not.toContain("已关闭")
  expect(removedGroup()).toBeNull()
  expect(native.ledger().find((item) => item.entry === "review-pr")).toMatchObject({ desiredState: "enabled", removed: false })
  expect(native.reloads).toHaveLength(3)
})

test("native project rows show consent words and the manage page writes the full path", async () => {
  for (const consent of ["awaiting-consent", "consent-denied"] as const) {
    reset()
    const project = "/tmp/hub-native-project"
    const plugin = `${project}/.opencode/plugins/notify-on-finish.js`
    const mcp = `${nativeHome}/.config/opencode/opencode.json`
    await nativeFixture({ consent })
    await nativeMain!.sync(project, [
      { file: plugin, kind: "plugin", entry: "notify-on-finish.js", target: plugin, active: true },
      { file: `${project}/.codepuppy/opencode.json`, kind: "mcp", entry: "staging-db", active: true },
      { file: mcp, kind: "mcp", entry: "postgres-local", active: true },
    ])
    pathname = hrefFor.directory(project)
    mount("connectors")
    const projectRow = () => q('[data-group="project"] [data-native-entry="notify-on-finish.js"]')
    await waitFor(() => expect(projectRow()).toBeInstanceOf(HTMLElement))
    expect(q("[data-native-name]", projectRow()!)?.textContent).toBe("notify-on-finish")
    expect(q("[data-native-directory]", projectRow()!)?.textContent).toBe(".opencode")
    expect(projectRow()!.textContent).toContain(consent === "consent-denied" ? "项目同意已拒绝" : "等待项目同意")
    expect(projectRow()!.textContent).toContain("插件")
    const db = q('[data-group="project"] [data-native-entry="staging-db"]')!
    expect(q("[data-native-directory]", db)?.textContent).toBe(".codepuppy")
    expect(db.textContent).toContain("连接器")
    const global = q('[data-group="installed"] [data-native-entry="postgres-local"]')!
    expect(q("[data-native-directory]", global)?.textContent).toBe("~/.config/opencode")
    expect(global.textContent).not.toContain("等待项目同意")
    // 未被允许项目里的开关照常可拨,状态仍是项目同意那一词
    click(q("[data-more]", projectRow()!))
    await waitFor(() => expect(q('[role="switch"]')).toBeInstanceOf(HTMLElement))
    click(q('[role="switch"]'))
    await waitFor(() => expect(projectRow()?.textContent).toContain(consent === "consent-denied" ? "项目同意已拒绝" : "等待项目同意"))
    // 管理页:来源 = 本机文件 + 完整路径;生效范围按目录
    click(projectRow())
    await waitFor(() => expect(q("[data-native-detail]")).toBeInstanceOf(HTMLElement))
    expect(q("[data-native-source-path]")?.textContent).toBe(`本机文件${plugin}`)
    expect(q("[data-native-detail]")?.textContent).toContain("仅当前项目")
    expect(q("[data-native-detail]")?.textContent).toContain("1 个插件")
    expect(q("[data-native-detail]")?.textContent).not.toContain("版本")
    expect(q("[data-native-detail] [data-more]")).toBeInstanceOf(HTMLElement)
    click(q(".codepuppy-ext-crumb-link"))
    await waitFor(() => expect(q("[data-native-detail]")).toBeNull())
    click(q('[data-group="installed"] [data-native-entry="postgres-local"]'))
    await waitFor(() => expect(q("[data-native-detail]")?.textContent).toContain("我的所有项目"))
  }
})
