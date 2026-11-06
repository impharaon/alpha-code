// REQ-128 Phase 4 `#810` —— **签名 package / 套件安装路径收口 + 引擎重扫**的闸。
//
// 缺陷:三个 Hub 安装入口(`runPackageAction` / `installBundle` / `confirmPackageAuthz`)全部
// 直连 `extIpc.installCatalog`,**一个都不调 `refreshEngine()`**;而组件的注入面只在引擎实例
// 构造时装载 ⇒ placebo 安装:账本翻了、盘上有了、界面说「已安装」,用户下一条消息里什么都没有。
//
// ⚠️ 本文件的判据形状是被 R1 审计 F13 钉死的:**必须驱动三个生产 Hub 动作本身**。
// 只测一个新 helper 的话,一个「新写了收口方法、而 Hub 仍旧直连 `extIpc`」的实现
// **生产行为一点没变而测试全绿**(假闸形态⑧:没测生产接线)。所以这里:
//   · 三个动作全部经**真实 DOM 点击**触发(卡片按钮 / 确认屏按钮),不直接调函数;
//   · `useExtensions` 的收口方法上挂一个**真包装**(真函数值先存 const 再 `mock.module`),
//     任何一个入口改回直连 `extIpc`,它就不在计数里 ⇒ 红;
//   · 另加一条**出站计数相等**:到达 IPC 的 `installCatalog` 次数必须等于经过收口方法的次数,
//     于是「既走收口方法、又另外直连一次」也红。
//
// REQ-234 `#1529` 起「引擎有没有被叫去重扫」的判据换了位置:重扫的执行者是 ext 调度器(等会话空闲),
// main 安装体提交成功后经 parentPort 发 `codepuppy.reload.request`。本文件像 server.ts 在 sidecar ready 时那样
// 接上发送口(`codepuppySidecar.attach`),**数到的那一条就是判据**;renderer 自己一次 dispose 都不许做。
//
// 被替身的只有进程边界:
//   · 引擎 HTTP 客户端(`@opencode-ai/sdk/v2/client`)—— 没有对端;它的 dispose spy 用来证明 renderer **不再** dispose。
//   · `globalThis.fetch` —— 签名 package 的 payload/资产取用。admission 自己那条取用/复验
//     仍是生产实现(不传 `deps.fetchAsset`)。
// main 侧其余一律真实现:真 `registerExtIpcHandlers`、真 admission、真事务、真 legacy planner。
//
// ⚠️ 本仓踩过的三条本机纪律,本文件逐条遵守:
//   · `mock.module` 会**就地改写**已捕获的模块命名空间对象 ⇒ 函数值必须先存进独立 const;
//   · 一切会牵出 `solid-js` 的模块必须**动态** import,且排在 `GlobalRegistrator.register()` 之后;
//   · `solid-js/store` **也**必须钉到 dom 构建 —— 少这一行不报错,而是静默失去反应性。

import { afterAll, expect, mock, test } from "bun:test"
import { transformAsync } from "@babel/core"
import presetTypescript from "@babel/preset-typescript"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import presetSolid from "babel-preset-solid"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import bundledCatalog from "../src/renderer/extensions/codepuppy-catalog.json"
import { LEAF_MCP_ID, MIXED_BUNDLE_PACKAGE_ID, mixedBundleFixture } from "./package-mixed-bundle.fixture"
import { pinShippedPlatform } from "./pin-shipped-platform"

// 本文件要验的是**发布平台上**的安装行为,而它会走到生产平台闸
// (套件/条目 `compatibility.platforms` = darwin/win32,ADR-026):linux runner 上套件安装被
// 就地拒掉(DOM 原话「platform linux not supported by this bundle」),授权屏永不出现。
// 与两个兄弟 cases 文件同款 opt-in;它自陈本轮平台是模拟,不静默降级。
pinShippedPlatform()

// ── ① 引擎客户端替身(`#1529`:renderer 不再 dispose;重扫判据是 main 发出的重载请求,见 ④)──────
//     函数值先存 const,再 mock.module。
/** REQ-234 `#1529`:renderer 不再 dispose —— 恒为 0 是判据的一半(另一半是 main 发出的重载请求)。 */
let disposeCalls = 0
let connectorRefreshes = 0
let liveMcpCalls = 0
let startup: { mcp?: Record<string, { enabled?: boolean }> } | undefined
const services = () => startup ? { "codepuppy-pdf": { status: startup.mcp?.["codepuppy-pdf"]?.enabled === false ? "disabled" : "connected" } } : {}
// N07(b) engine tool display: prt_1aeaf3f3c001sbAwc6IGaVcOvr (result-0126-e.md).
// Request envelope follows the v1 sample in permission-dual-channel.test.ts; metadata is
// produced by permission/codepuppy-tool-policy-gate.ts:confirm, also used by the approval card.
const approvalRequest = (id: string, connector: string, sessionID: string) => ({
  id, sessionID, permission: `mcp:${connector}:execute_sql`, patterns: [`call:${id}`], always: [],
  metadata: {
    identity: { source: "mcp", origin: connector, name: "execute_sql" },
    authority: { kind: "not-asserted" }, location: { kind: "local" },
  },
  tool: { messageID: "msg_1aeaf3b3d0018M9RLjLp5ZvYc5", callID: id },
})
const projectA = "/tmp/approval-project-a"
const projectB = "/tmp/approval-project-b"
const directories = () => [projectA, projectB]
let permissions: Record<string, ReturnType<typeof approvalRequest>[]> = {}
const unavailable = new Set<string>()
const operations: string[] = []
let refuseState = false
const permissionReplies: Array<{ requestID: string; reply: string; message: string; directory?: string }> = []
const engineClient = {
  global: {
    dispose: async () => {
      disposeCalls++
      return { data: {} }
    },
    event: async () => ({ stream: (async function* () {})() }),
  },
  mcp: {
    status: async () => ({ data: services() }),
    add: async () => { liveMcpCalls++; return { data: {} } },
    connect: async () => { liveMcpCalls++; return { data: {} } },
    disconnect: async () => { liveMcpCalls++; return { data: {} } },
  },
  app: { agents: async () => ({ data: [] }) },
}
const createOpencodeClientStub = (options?: { directory?: string }) => ({
  ...engineClient,
  permission: {
    list: async (input: { directory?: string }) => {
      const directory = input.directory ?? options?.directory ?? "default"
      if (unavailable.has(directory)) throw new Error("ECONNREFUSED")
      return { data: permissions[directory] ?? [] }
    },
    reply: async (input: { requestID: string; reply: string; message: string; directory?: string }) => {
      operations.push("reply")
      permissionReplies.push(input)
      const directory = input.directory ?? options?.directory ?? "default"
      const session = permissions[directory]!.find((request) => request.id === input.requestID)!.sessionID
      permissions[directory] = permissions[directory]!.filter((request) => request.sessionID !== session)
      return { data: true }
    },
  },
})
mock.module("@opencode-ai/sdk/v2/client", () => ({ createOpencodeClient: createOpencodeClientStub }))

// ── ② main 侧进程边界替身 ────────────────────────────────────────────────────────────────
type IpcSender = { id: number; on?: (n: string, l: () => void) => void; once?: (n: string, l: () => void) => void }
type IpcHandler = (event: { sender: IpcSender }, ...args: unknown[]) => unknown
const handlers = new Map<string, IpcHandler>()

const tmp = mkdtempSync(join(tmpdir(), "req128-810-reload-"))
const userData = join(tmp, "user-data")
const snapshotDigest = "3".repeat(64)

mock.module("electron", () => ({
  BrowserWindow: class {
    static fromWebContents() {
      return undefined
    }
  },
  dialog: {
    showMessageBox: async () => ({ response: 1, checkboxChecked: false }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  ipcMain: { handle: (channel: string, handler: IpcHandler) => handlers.set(channel, handler) },
}))
mock.module("../src/main/ipc", () => ({
  pickedFiles: {
    read: async () => {
      throw new Error("unexpected picked-file read")
    },
  },
}))
mock.module("../src/main/logging", () => ({
  getLogger: () => ({ error: () => {}, log: () => {}, warn: () => {} }),
}))
mock.module("../src/main/ext-advisory-gate", () => ({
  listAdvisoryBlockedFacts: () => ({ ids: [], fresh: true }),
  makeAdvisoryGate: () => () => ({ allowed: true }),
}))
mock.module("../src/main/ext-mcp-activation", () => ({
  verifyInstalledMcp: async (name: string) => ({ reference: name, status: "connected" }),
  probeProjectMcpActivation: async () => "unverifiable" as const,
}))

// ── ③ catalog:随包条目 + 两条本票自有的套件 + 一个签名 package ──────────────────────────
//
// 随包 catalog 四条套件的必需成员全都带 `{workspace}` 占位(planner 无 workspace grant 即拒),
// 所以这里另立两条**只含一个真实成员**的套件:一条给成功路径,一条给「引擎重扫失败」路径。
// 成员是随包 catalog 里真实的 `mcp:markitdown` / `mcp:fetch`(uvx,无占位、无必填环境变量;
// `mcp:excel` 是 REQ-135 退役负例,不得用作成功夹具)。
const BUNDLE_OK = "bundle:req810-reload"
const BUNDLE_PENDING = "bundle:req810-reload-pending"
const BUNDLE_OK_NAME = "req810-reload-suite"
const BUNDLE_PENDING_NAME = "req810-reload-pending-suite"
const testBundle = (id: string, name: string, member: string) => ({
  id,
  type: "bundle",
  name,
  displayName: name,
  description: "REQ-128 #810 fixture bundle.",
  source: "codepuppy",
  category: "dev",
  license: "MIT",
  redistributable: true,
  version: "1.0.0",
  bundleItems: [{ catalogEntryId: member, optional: false, installOrder: 1 }],
})

const fixture = mixedBundleFixture()
const catalogEntries = [
  ...(bundledCatalog as unknown as { entries: unknown[] }).entries,
  testBundle(BUNDLE_OK, BUNDLE_OK_NAME, "mcp:markitdown"),
  testBundle(BUNDLE_PENDING, BUNDLE_PENDING_NAME, "mcp:fetch"),
]
const catalogDocument = {
  version: "2026-08-03",
  entries: catalogEntries,
  packages: [fixture.envelope],
}

// URL → 字节。payload 由信封的 `payloadRef` 给出;资产由 payload 自己给出 —— agent 是
// `behavior.asset`、skill 是 `behavior.files`、command 是 `behavior.template`,都要**逐条**登记进这张表。
const bytesByUrl = new Map<string, Uint8Array>()
for (const component of fixture.envelope.components) {
  const payload = fixture.payloadByDigest.get(component.payloadRef.sha256)
  if (!payload) throw new Error(`fixture: payload bytes missing for ${component.id}`)
  bytesByUrl.set(component.payloadRef.url, payload)
  const decoded = JSON.parse(new TextDecoder().decode(payload)) as {
    behavior?: {
      asset?: { url: string; sha256: string }
      files?: Array<{ url: string; sha256: string }>
      template?: { url: string; sha256: string }
    }
  }
  for (const ref of [
    ...(decoded.behavior?.asset ? [decoded.behavior.asset] : []),
    ...(decoded.behavior?.files ?? []),
    ...(decoded.behavior?.template ? [decoded.behavior.template] : []),
  ]) {
    const assetBytes = fixture.assetByDigest.get(ref.sha256)
    if (!assetBytes) throw new Error(`fixture: asset bytes missing for ${component.id} (${ref.url})`)
    bytesByUrl.set(ref.url, assetBytes)
  }
}

// 只替换网络那一段:目录读通道的注册与安全视图投影仍走真实现。
const realRemoteCatalog = await import("../src/main/remote-catalog")
const realRegisterPackageCatalogReadIpcHandlers = realRemoteCatalog.registerPackageCatalogReadIpcHandlers
const realEvaluateRemoteCatalogPackages = realRemoteCatalog.evaluateRemoteCatalogPackages
mock.module("../src/main/remote-catalog", () => ({
  ...realRemoteCatalog,
  downloadRemoteAsset: async () => ({ ok: false, reason: "unexpected remote asset download" }),
  readCachedCatalog: () => null,
  registerPackageCatalogReadIpcHandlers: realRegisterPackageCatalogReadIpcHandlers,
  refreshRemoteCatalog: async () =>
    realEvaluateRemoteCatalogPackages({
      source: "remote",
      catalog: catalogDocument,
      version: "2026-08-03",
      fetchedAt: "2026-08-03T00:00:00.000Z",
      via: "channel-dev",
      channel: "dev",
      snapshotDigest,
    } as never),
}))

// ── ④ renderer:DOM + Solid dom 构建 ────────────────────────────────────────────────────
GlobalRegistrator.register()
// ⚠️ **必须排在 `GlobalRegistrator.register()` 之后**:它自己会把 `globalThis.fetch` 换成
// happy-dom 的实现,于是装在它前面的替身被静默顶掉,payload 取用变成真出网 ——
// 报错是 `Cross-Origin Request Blocked` 与 404,与被测的东西毫无关系。
const originalFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input)
  const bytes = bytesByUrl.get(url)
  if (!bytes) throw new Error(`unexpected network fetch: ${url}`)
  return new Response(bytes, { status: 200 })
}) as typeof fetch
const solid = await import("solid-js/dist/solid.js")
mock.module("solid-js", () => solid)
const solidWeb = await import("solid-js/web/dist/web.js")
mock.module("solid-js/web", () => solidWeb)
// `solid-js/store` 少这一行**不报错**,而是静默失去反应性(store 变了、memo 永不重跑)。
const solidStore = await import("solid-js/store/dist/store.js")
mock.module("solid-js/store", () => solidStore)
mock.module("../src/renderer/auth-recovery", () => ({
  subscribeAuthState: (listener: (state: { status: "logged-out"; mode: "byok" }) => void) => {
    listener({ status: "logged-out", mode: "byok" })
    return () => {}
  },
}))
mock.module("@solidjs/router", () => ({ useLocation: () => ({ pathname: "/" }) }))
mock.module("../src/renderer/codepuppy-ui/Banner", () => ({ Banner: () => null }))

Bun.plugin({
  name: "req810-reload-solid",
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

// ── ⑤ 收口方法的真包装 = F13 的判据 ─────────────────────────────────────────────────────
//
// **这不是替身**:`useExtensions` 的真函数值先存进独立 const,包装只在调用前后记一笔。
// 一个「新写了 helper 而 Hub 仍旧直连 `extIpc`」的实现,在这里的计数是 0 ⇒ 红。
type CentralCall = { catalogId: string; attemptId: string | undefined; authorized: boolean }
const centralCalls: CentralCall[] = []
const realUseExtensionsModule = await import("../src/renderer/extensions/use-extensions")
const realUseExtensions = realUseExtensionsModule.useExtensions
let hubApi: ReturnType<typeof realUseExtensions>
mock.module("../src/renderer/extensions/use-extensions", () => ({
  ...realUseExtensionsModule,
  useExtensions: ((...args: Parameters<typeof realUseExtensions>) => {
    const api = realUseExtensions(...args)
    hubApi = api
    const realInstallCatalogIntent = api.installCatalogIntent
    // 收口方法缺席 ⇒ 大声炸掉。静默 undefined 会把「根本没有收口」伪装成一次无害的 no-op。
    if (typeof realInstallCatalogIntent !== "function")
      throw new Error("useExtensions() has no installCatalogIntent — the #810 chokepoint is missing")
    return {
      ...api,
      installCatalogIntent: (intent: Parameters<typeof realInstallCatalogIntent>[0]) => {
        centralCalls.push({
          catalogId: intent.catalogId,
          attemptId: intent.attemptId,
          authorized: intent.authorization !== undefined,
        })
        return realInstallCatalogIntent(intent)
      },
    }
  }) as typeof realUseExtensions,
}))

// ── ⑥ 真 main:环境 + IPC 表 ─────────────────────────────────────────────────────────────
const { initCodePuppyEnvironment } = await import("../src/main/codepuppy-environment")
const { registerExtIpcHandlers } = await import("../src/main/ext-ipc")
const { findRecordV2, readPackageLedgerStateV1, upsertRecordV2 } = await import("../src/main/ext-receipt-v2")
const { injectDisabledOverrides } = await import("../src/main/ext-disabled-injection")
const { restoreMcpLeaf } = await import("../src/main/ext-config")
const { codepuppyOfficeInstallCommand } = await import("../src/shared/office-advisories")
const { deriveMcpEgressDestinations, setConfiguredEgressDestinations, isEgressAuthorizedForSidecar } = await import("../src/main/network-egress-derived")
const { readMcpServerRecords } = await import("../src/main/mcp-server-records")
const { createReloadScheduler } = await import("../../ext/src/reload-scheduler")
const { codepuppyGlobalRoot } = await import("../src/main/codepuppy-installs")

delete process.env.CODEPUPPY_GLOBAL_DIR
initCodePuppyEnvironment({
  isPackaged: false,
  channel: "dev",
  appDataDir: tmp,
  baseRoot: join(tmp, "codepuppy-state"),
  homeDir: join(tmp, "home"),
})
const { codepuppySidecar } = registerExtIpcHandlers(
  userData,
  "dev",
  async () => ({ url: "http://127.0.0.1:39131", username: "opencode", password: "route-password" }),
  join(tmp, "home"),
  {
    stop: async () => { throw new Error("first-party/custom changes must wait for the scheduler") },
    refresh: async () => {
      connectorRefreshes++
      // Process boundary: boot producers reread this fixture's real ledger and records.
      startup = {}
      injectDisabledOverrides(startup, { userDataPath: userData, channel: "dev" })
      setConfiguredEgressDestinations(deriveMcpEgressDestinations(readMcpServerRecords()))
      return true
    },
  },
)
const globalRoot = codepuppyGlobalRoot()
/** `#1529`:main 发往 ext 调度器的重载请求 —— 「装完有没有让引擎重扫」的判据。 */
const reloadRequests: Array<{ type?: string; generation?: number; scope?: unknown }> = []
codepuppySidecar.attach((message) => void reloadRequests.push(message as { type?: string; generation?: number; scope?: unknown }))

// ── ⑦ renderer ↔ main 的桥:走生产 handler,不重写任何判定 ───────────────────────────────
const SENDER: IpcSender = { id: 1, on: () => {}, once: () => {} }
const call = async (channel: string, ...args: unknown[]): Promise<unknown> => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`handler not registered: ${channel}`)
  return handler({ sender: SENDER }, ...args)
}

/** 到达 IPC 边界的安装意图。与 `centralCalls` 判**相等**:多出来的那一次就是绕过收口的那一次。 */
const ipcInstallIntents: Array<{ catalogId?: unknown }> = []

const extBridge: Record<string, unknown> = {
  installCatalog: async (intent: unknown) => {
    ipcInstallIntents.push(intent as { catalogId?: unknown })
    return call("ext-install-catalog", intent)
  },
  remoteCatalog: () => call("ext-remote-catalog"),
  packageDetail: (catalogId: unknown) => call("ext-package-detail", catalogId),
  packageInstalled: (catalogId: unknown) => call("ext-package-installed", catalogId),
  installedPackages: () => call("ext-installed-packages"),
  setInstallState: async (intent: unknown) => {
    if (refuseState) return { ok: false, reason: "fixture write failure" }
    const result = await call("ext-set-install-state", intent)
    if ((result as { ok: boolean }).ok) operations.push("ledger")
    return result
  },
  persistMcp: (name: unknown, server: unknown, secrets: unknown) => call("ext-persist-mcp", name, server, secrets),
  listInstalls: (projectDir?: unknown) => call("ext-list-installs", projectDir),
  inventoryView: (projectDir?: unknown) => call("ext-inventory-view", projectDir),
  factorySkillIds: () => call("ext-factory-skill-ids"),
  sessionGrants: () => call("ext-session-grants"),
  advisoryActive: () => call("ext-advisory-active"),
  migrateScan: () => call("ext-migrate-scan"),
  checkRuntime: (tool: unknown) => call("ext-check-runtime", tool),
  curationBlob: async () => undefined,
  browseSeed: async () => ({ entries: [] }),
  builtinRead: async () => ({ ok: false as const, reason: "builtin panel not under test here" }),
  onSessionGrantsEnded: () => () => {},
  // `#1529`:三档状态与重载请求同样走生产 handler;视图变更推送接 main 的真 onViewChanged。
  hubView: (directory?: unknown) => call("ext-hub-view", directory),
  reloadRequest: (input: unknown) => call("ext-reload-request", input),
  onHubViewChanged: (cb: () => void) => codepuppySidecar.onViewChanged(cb),
}

Object.defineProperty(window, "api", {
  configurable: true,
  value: {
    updater: { check: async () => {} },
    auth: { start: async () => {}, setMode: async () => {} },
    openDirectoryPicker: async () => undefined,
    ext: new Proxy(extBridge, {
      get(target, property: string) {
        if (property in target) return target[property]
        // 缺一个方法就大声说出来 —— 静默 undefined 会把「renderer 根本没接上」伪装成 no-op。
        throw new Error(`ext IPC method not stubbed in this case file: ${String(property)}`)
      },
    }),
  },
})

const { createComponent } = solid
const { render } = solidWeb
const { ExtensionHub } = await import("../src/renderer/extensions/extension-hub")
const { ToastViewport } = await import("../src/renderer/codepuppy-ui/Toast")
const { setHubSection } = await import("../src/renderer/extensions/ext-hub-state")
const { dict: zh } = await import("../src/renderer/i18n/zh")

const root = document.createElement("div")
root.id = "root"
root.className = "a-ui"
document.body.append(root)
const toastHost = document.body.appendChild(document.createElement("div"))
const disposeToasts = render(() => createComponent(ToastViewport, {}), toastHost)
const disposeHub = render(
  () => createComponent(ExtensionHub, { server: () => ({ baseUrl: "http://127.0.0.1:39131" }), open: () => true, onClose: () => {}, directories }),
  root,
)

afterAll(() => {
  disposeHub()
  disposeToasts()
  globalThis.fetch = originalFetch
  rmSync(tmp, { recursive: true, force: true })
})

// ── ⑧ DOM 驱动小工具 ────────────────────────────────────────────────────────────────────
const flush = () => new Promise((r) => setTimeout(r, 0))
/** ⚠️ 必须 `await assertion()`:传一个 async 断言进来而不 await,它的拒绝会变成 unhandled
 *  rejection,而 `waitFor` **立刻返回成功** —— 一条永远绿的假闸。 */
async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  let failure: unknown
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      await assertion()
      return
    } catch (error) {
      failure = error
      await flush()
    }
  }
  throw failure
}
function click(element: Element | null | undefined): void {
  expect(element).toBeInstanceOf(HTMLElement)
  ;(element as HTMLElement).click()
}
const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector)
const qa = (selector: string): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(selector))
const toasts = (): string[] => qa(".a-toast").map((node) => node.textContent ?? "")
const clearToasts = (): void => qa(".a-toast").forEach((node) => node.remove())

/** 当前打开的对话框里那颗「确认安装」主按钮(package 授权屏与套件确认框共用同一句文案)。 */
function confirmInstallButton(): HTMLElement | undefined {
  return qa("[role='dialog'] button").find((node) => (node.textContent ?? "").trim() === zh["codepuppy.ext.confirmInstall"])
}

/** 能力授权框(第二阶段)的主按钮。文案与上面那颗**不同**,不能共用一个查找。 */
function authzConfirmButton(): HTMLElement | undefined {
  return qa("[role='dialog'] button").find((node) => (node.textContent ?? "").trim() === zh["codepuppy.ext.authz.confirmInstall"])
}

/** 条目卡:卡上没有 id 属性,按 `<b title={e.name}>` 定位(name 是 catalog 身份的一半)。 */
function entryCard(name: string): HTMLElement {
  const label = qa(".codepuppy-ext-card b").find((node) => node.getAttribute("title") === name)
  expect(label, `entry card for ${name} is not on screen`).toBeInstanceOf(HTMLElement)
  const card = label!.closest<HTMLElement>(".codepuppy-ext-card")
  expect(card).toBeInstanceOf(HTMLElement)
  return card!
}

function ledgerPackageIds(): string[] {
  const state = readPackageLedgerStateV1(globalRoot)
  return state.ok ? state.packageGraphs.map((graph) => graph.packageId).sort() : ["<unreadable>"]
}

/**
 * 走生产路径装一条套件:套件页 → 卡片「添加」→ 确认框「确认安装」→ **能力授权框「授权并安装」**。
 *
 * 第二步不是多余的:legacy planner 对套件成员的 capability 一律要求显式确认
 *(`silent inheritance refused`),所以套件的**首驱恒落 authorize 臂**,真正落盘的是重驱那一趟。
 * 于是一条套件 = 两次经过收口方法,而只有后一次会重扫 —— 这正是「authorize 不是安装」的行为半场。
 */
async function installBundleThroughUi(name: string): Promise<void> {
  // package 授权屏与套件确认框共用同一个 Dialog 宿主,且前者优先渲染 —— 它没关干净时,
  // 下面点到的会是**另一条路径**的按钮。这条前置断言把那种串味变成一句明白话。
  expect(q("[data-package-authorization]"), "a package authorization dialog is still open").toBeNull()
  setHubSection("connectors") // `#1594`:套件是连接器页的一组
  await waitFor(() => expect(entryCard(name)).toBeInstanceOf(HTMLElement))
  click(entryCard(name).querySelector(".codepuppy-ext-add"))
  await waitFor(() => expect(confirmInstallButton()).toBeInstanceOf(HTMLElement))
  click(confirmInstallButton())
  await waitFor(() => expect(authzConfirmButton()).toBeInstanceOf(HTMLElement))
  click(authzConfirmButton())
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 判据
// ═══════════════════════════════════════════════════════════════════════════════════════

test("① 入口一 `runPackageAction`:卡片「安装」经收口方法出站,而 authorize 臂**不**重扫", async () => {
  setHubSection("connectors") // `#1594`:扩展包是连接器页的一组
  await waitFor(() => expect(q(`[data-package-card="${MIXED_BUNDLE_PACKAGE_ID}"]`)).toBeInstanceOf(HTMLElement))
  const reloadsBefore = reloadRequests.length
  click(q(`[data-package-card="${MIXED_BUNDLE_PACKAGE_ID}"] .codepuppy-ext-add`))
  // 首驱恒落 authorize 臂 ⇒ 授权屏出现。
  await waitFor(() => expect(q("[data-package-authorization]")).toBeInstanceOf(HTMLElement))

  expect(centralCalls).toEqual([{ catalogId: MIXED_BUNDLE_PACKAGE_ID, attemptId: expect.any(String), authorized: false }])
  // 盘上还什么都没发生 ⇒ 一次重扫请求都不许有。谎报「已生效」与不重扫是同一个缺陷的两面。
  expect(reloadRequests.length).toBe(reloadsBefore)
  expect(disposeCalls).toBe(0)
})

test("② 入口二 `confirmPackageAuthz`:确认屏落盘 ⇒ 同一个收口方法 + 引擎当场重扫一次", async () => {
  const input = q<HTMLInputElement>("[data-package-authorization] .codepuppy-ext-key-input")
  expect(input, "package authorization screen has no required-secret field").toBeInstanceOf(HTMLInputElement)
  // 夹具的 MCP 叶带一个必填密钥 ⇒ 确认按钮在填完之前是禁用的。这条只为让下面的点击走
  // **用户真实做得到**的那条路;密钥面本身的判据在 `ext-package-detail-wiring` 里,不在这里重述。
  expect((q("[data-package-authorization] .codepuppy-ext-key-name")?.textContent ?? "").length).toBeGreaterThan(0)
  input!.value = "req810-secret"
  input!.dispatchEvent(new Event("input", { bubbles: true }))

  const reloadsBefore = reloadRequests.length
  clearToasts()
  await waitFor(() => expect(confirmInstallButton()?.hasAttribute("disabled")).toBe(false))
  click(confirmInstallButton())

  // 真落盘:账本里出现这个包(不是「我调过 install」这种内部事实)。
  await waitFor(() => expect(ledgerPackageIds()).toContain(MIXED_BUNDLE_PACKAGE_ID))
  expect(centralCalls.at(-1)).toEqual({
    catalogId: MIXED_BUNDLE_PACKAGE_ID,
    attemptId: expect.any(String),
    authorized: true,
  })
  // 首驱与确认屏是**同一次 attempt**:确认屏若自己另铸一个 id,admission 会当场拒。
  expect(centralCalls.at(-1)!.attemptId).toBe(centralCalls[0]!.attemptId)
  // 落盘 ⇒ main 恰好请求一次重扫(global,交给 ext 调度器);renderer 自己不 dispose。
  expect(reloadRequests.slice(reloadsBefore)).toEqual([expect.objectContaining({ type: "codepuppy.reload.request", scope: "global" })])
  expect(disposeCalls).toBe(0)
  // 请求已受理 ⇒ 不许出现「要重启」。
  expect(toasts().join("\n")).not.toContain(zh["codepuppy.ext.addedPendingReload"])
})

test("③ 入口三 `installBundle`:套件装完同样经收口方法 + 引擎重扫一次", async () => {
  const reloadsBefore = reloadRequests.length
  const centralBefore = centralCalls.length
  clearToasts()
  await installBundleThroughUi(BUNDLE_OK_NAME)

  await waitFor(() => expect(toasts().join("\n")).toContain(zh["codepuppy.ext.added"]))
  // 首驱(authorize)+ 重驱(落盘)各一次,两次都经过同一个收口方法。
  expect(centralCalls.slice(centralBefore)).toEqual([
    { catalogId: BUNDLE_OK, attemptId: undefined, authorized: false },
    { catalogId: BUNDLE_OK, attemptId: undefined, authorized: true },
  ])
  // **只有落盘那一次**请求重扫:authorize 臂上盘面还没动,重扫它就是谎报。
  expect(reloadRequests.slice(reloadsBefore)).toEqual([expect.objectContaining({ type: "codepuppy.reload.request", scope: "global" })])
  expect(disposeCalls).toBe(0)
  expect(toasts().join("\n")).not.toContain(zh["codepuppy.ext.addedPendingReload"])
})

test("④ `#1529` AC3:ext 报告重载失败 ⇒ 已安装列表如实「待重载 · 上次重载没有成功」,不谎报可以使用", async () => {
  const reloadsBefore = reloadRequests.length
  clearToasts()
  await installBundleThroughUi(BUNDLE_PENDING_NAME)
  await waitFor(() => expect(reloadRequests.length).toBe(reloadsBefore + 1))
  // 引擎(ext 调度器)对**所有在途**的重载报失败 —— 它们都覆盖当前目录。
  for (const request of reloadRequests)
    codepuppySidecar.receive(
      { type: "codepuppy.reload.report", generation: request.generation, scope: "global", outcome: "failed", directories: [], error: "dispose refused (fixture)" },
      () => {},
    )
  // `#1594`:已装行分在三页各自的「已安装」组(技能、命令进技能页,助手进助手页,其余进连接器页)。
  // 夹具自检:列表上真的有没核验通过的已装行(引擎替身答不出技能 / agent / 命令清单),否则下面那几条恒成立。
  setHubSection("skills")
  await waitFor(() => expect(qa("[data-hub-state='reload-pending']").length).toBeGreaterThan(0))
  let pendingRows = 0
  for (const page of ["connectors", "skills", "agents"] as const) {
    setHubSection(page)
    await flush()
    await waitFor(() => {
      for (const node of qa("[data-hub-state='reload-pending']")) {
        expect(node.textContent ?? "").toContain(zh["codepuppy.ext.hubStatePending"])
        expect(node.textContent ?? "").toContain(zh["codepuppy.ext.hubReasonFailed"])
      }
    })
    // 没核验过的东西不许说「可以使用」;待重载的行各有一颗「立即生效」。
    for (const node of qa("[data-hub-state='reload-pending']")) expect(node.textContent ?? "").not.toContain(zh["codepuppy.ext.hubStateAvailable"])
    expect(qa("[data-hub-reload-now]").length).toBe(qa("[data-hub-state='reload-pending']").length)
    pendingRows += qa("[data-hub-state='reload-pending']").length
  }
  expect(pendingRows).toBeGreaterThan(0)
  expect(disposeCalls).toBe(0)
})

test("⑤ 出站计数相等:到达 IPC 的每一次安装都经过了收口方法", () => {
  // 三个入口共六次出站(package 首驱 + 确认屏,两条套件各首驱 + 重驱)。任何一次直连 `extIpc` 都会让
  // 右边多出来一次而左边不动 —— 「既走收口方法又另外直连一次」的实现在这里红。
  expect(ipcInstallIntents.length).toBe(centralCalls.length)
  expect(centralCalls.map((entry) => entry.catalogId)).toEqual([
    MIXED_BUNDLE_PACKAGE_ID,
    MIXED_BUNDLE_PACKAGE_ID,
    BUNDLE_OK,
    BUNDLE_OK,
    BUNDLE_PENDING,
    BUNDLE_PENDING,
  ])
  expect(ipcInstallIntents.map((intent) => intent.catalogId)).toEqual(centralCalls.map((entry) => entry.catalogId))
  // 夹具自检:被装的那个 package 里真的有一个 MCP 组件(套件成员之外还有 fs 类组件),
  // 也就是说「装完要重扫」这件事对本夹具是真需求,不是摆设。
  expect(fixture.envelope.components.map((component) => component.id)).toContain(LEAF_MCP_ID)
})

// #1646 uses the same real Hub → IPC → ledger. Only process launch is substituted;
// startup projections use production producers, never a hand-written ledger.
let busy = true
const scheduler = createReloadScheduler({
  log: () => {}, error: () => {},
  report: (report) => codepuppySidecar.receive({ type: "codepuppy.reload.report", ...report }, () => {}),
})
const pdfRow = () => q('[data-installed-row="mcp:codepuppy-pdf"]')!
// Same staged attachment metadata as attachment-reader-hooks.test.ts / attachment-cards.cases.ts.
const meta = { v: 1 as const, name: "a.pdf", mime: "application/pdf", size: 2048, path: "attachments/00000000-0000-4000-8000-000000000000/a.pdf", reader: "pdf" as const }

test("#1646 AC1 disable PDF waits for idle, then the fresh runtime blocks reading and the attachment shows why", async () => {
  for (const request of reloadRequests) codepuppySidecar.receive({ type: "codepuppy.reload.report", generation: request.generation, scope: "global", outcome: "reloaded", directories: [] }, () => {})
  expect(restoreMcpLeaf("codepuppy-pdf", { type: "local", command: codepuppyOfficeInstallCommand("pdf"), enabled: true }).ok).toBe(true)
  expect(upsertRecordV2(globalRoot, {
    id: "mcp:codepuppy-pdf", name: "codepuppy-pdf", kind: "mcp", origin: "catalog", environment: "dev",
    version: bundledCatalog.entries.find((entry) => entry.id === "mcp:codepuppy-pdf")!.version,
    scope: { kind: "global" }, installedAt: "2026-11-05T10:40:00.000Z", desiredState: "enabled", configKey: "mcp.codepuppy-pdf",
  }).ok).toBe(true)
  startup = {}
  scheduler.register(join(tmp, "project"), {
    session: { status: async () => ({ data: busy ? { ses_1: { type: "busy" } } : {} }) },
    instance: { dispose: async () => ({ data: true }) },
  })
  codepuppySidecar.attach((request) => scheduler.request(request))
  setHubSection("connectors")
  document.dispatchEvent(new Event("visibilitychange"))
  await waitFor(() => expect(pdfRow()).toBeInstanceOf(HTMLElement))
  click(pdfRow().querySelector('[data-more]'))
  click(pdfRow().querySelector('[data-menu-item="disable"]'))
  await waitFor(() => expect(pdfRow().querySelector('[data-hub-reload-now]')).toBeInstanceOf(HTMLElement))
  await scheduler.settled()
  expect(connectorRefreshes).toBe(0)
  expect(liveMcpCalls).toBe(0)
  expect(services()["codepuppy-pdf"]?.status).toBe("connected")
  busy = false
  scheduler.poke()
  await scheduler.settled()
  await waitFor(() => expect(connectorRefreshes).toBe(1))
  expect(startup.mcp?.["codepuppy-pdf"]?.enabled).toBe(false)
  const { attachmentInstruction } = await import("../../ext/src/attachment-reader-hooks")
  expect(attachmentInstruction(meta, tmp, services())).not.toContain("codepuppy-pdf_read_pdf")
  const { attachmentReadOf } = await import("../src/renderer/codepuppy-ui/session-timeline/timeline-attachments")
  const { TimelineAttachments } = await import("../src/renderer/codepuppy-ui/attachment-cards")
  const host = document.body.appendChild(document.createElement("div"))
  const dispose = render(() => createComponent(TimelineAttachments, { attachments: [{ partID: "pdf", name: meta.name, media: "file", label: "PDF", read: attachmentReadOf(meta, { directory: tmp, services: services(), tools: [], turnActive: true }) }] }), host)
  expect(host.textContent).toContain(zh["codepuppy.attach.readFailedNotRunning"])
  dispose(); host.remove()
})

test("#1646 AC2 enable from a disabled boot plus reload-now removes the startup override permanently", async () => {
  busy = true
  await waitFor(() => expect(pdfRow().querySelector('[data-enable-row]')).toBeInstanceOf(HTMLElement))
  click(pdfRow().querySelector('[data-enable-row]'))
  await waitFor(() => expect(pdfRow().querySelector('[data-hub-reload-now]')).toBeInstanceOf(HTMLElement))
  expect(connectorRefreshes).toBe(1)
  expect(startup?.mcp?.["codepuppy-pdf"]?.enabled).toBe(false)
  click(pdfRow().querySelector('[data-hub-reload-now]'))
  await waitFor(() => expect(connectorRefreshes).toBe(2))
  expect(startup?.mcp?.["codepuppy-pdf"]).toBeUndefined()
  expect(liveMcpCalls).toBe(0)
  const { attachmentInstruction } = await import("../../ext/src/attachment-reader-hooks")
  expect(attachmentInstruction(meta, tmp, services())).toContain("codepuppy-pdf_read_pdf")
  await call("ext-reload-request", { scope: "global", items: [], reason: "user: reload now", force: true })
  await scheduler.settled()
  expect(startup?.mcp?.["codepuppy-pdf"]).toBeUndefined()
  expect(attachmentInstruction(meta, tmp, services())).toContain("codepuppy-pdf_read_pdf")
})

test("#1646 AC4 custom connector waits for idle or reload-now and the new generation authorizes its destination", async () => {
  setHubSection("connectors")
  for (const force of [false, true]) {
    busy = true
    const name = force ? "custom-forced" : "custom-idle"
    const host = `${name}.example.com`
    const before = connectorRefreshes
    expect(isEgressAuthorizedForSidecar(host, 443)).toBe(false)
    click(q('[data-more="add"]'))
    click(q('[data-menu-item="custom-connector"]'))
    await waitFor(() => expect(q('input[placeholder="my-connector"]')).toBeInstanceOf(HTMLInputElement))
    const input = q<HTMLInputElement>('input[placeholder="my-connector"]')!
    input.value = name; input.dispatchEvent(new Event("input", { bubbles: true }))
    click(qa('[role="dialog"] button').find((b) => b.textContent === zh["codepuppy.ext.customMcpTypeRemote"]))
    const url = q<HTMLInputElement>('input[placeholder="https://mcp.example.com/sse"]')!
    url.value = `https://${host}/mcp`; url.dispatchEvent(new Event("input", { bubbles: true }))
    click(qa('[role="dialog"] button').find((b) => b.textContent === zh["codepuppy.ext.customMcpAdd"]))
    const row = () => q(`[data-installed-row="mcp:${name}"]`)
    await waitFor(() => expect(row()?.querySelector('[data-hub-reload-now]')).toBeInstanceOf(HTMLElement))
    await scheduler.settled()
    expect(connectorRefreshes).toBe(before)
    expect(liveMcpCalls).toBe(0)
    expect(isEgressAuthorizedForSidecar(host, 443)).toBe(false)
    if (force) click(row()?.querySelector('[data-hub-reload-now]'))
    else { busy = false; scheduler.poke() }
    await waitFor(() => expect(connectorRefreshes).toBe(before + 1))
    expect(isEgressAuthorizedForSidecar(host, 443)).toBe(true)
  }
})


test("#1652 AC1/AC2 Hub disable rejects only this connector's pending approvals and waits for idle", async () => {
  const name = "dbhub-readonly"
  busy = true
  const before = connectorRefreshes
  expect(restoreMcpLeaf(name, { type: "local", command: ["fixture-db-server"], enabled: true }).ok).toBe(true)
  expect(upsertRecordV2(globalRoot, {
    id: `mcp:${name}`, name, kind: "mcp", origin: "catalog", environment: "dev", version: "1.0.0",
    scope: { kind: "global" }, installedAt: "2026-11-05T10:40:00.000Z", desiredState: "enabled", configKey: `mcp.${name}`,
  }).ok).toBe(true)
  permissions = {
    [projectA]: [approvalRequest("per_db_1", name, "ses_db_1")],
    [projectB]: [approvalRequest("per_db_2", name, "ses_db_2"), approvalRequest("per_other", "another-connector", "ses_other")],
  }
  operations.length = 0
  permissionReplies.length = 0
  setHubSection("connectors")
  await call("ext-reload-request", { scope: "global", items: [], reason: "fixture install completed" })
  const row = () => q(`[data-installed-row="mcp:${name}"]`)
  await waitFor(() => expect(row()).toBeInstanceOf(HTMLElement))
  click(row()?.querySelector('[data-more]'))
  click(row()?.querySelector('[data-menu-item="disable"]'))
  await waitFor(() => expect(row()?.querySelector('[data-hub-reload-now]')).toBeInstanceOf(HTMLElement))
  await waitFor(() => expect(permissionReplies).toHaveLength(2))
  expect(permissionReplies).toEqual([
    { requestID: "per_db_1", reply: "reject", message: "连接器已停用", directory: projectA },
    { requestID: "per_db_2", reply: "reject", message: "连接器已停用", directory: projectB },
  ])
  expect(Object.values(permissions).flat().map((request) => request.id)).toEqual(["per_other"])
  expect(operations).toEqual(["ledger", "reply", "reply"])
  await scheduler.settled()
  expect(connectorRefreshes).toBe(before)
  expect(liveMcpCalls).toBe(0)
  busy = false
  scheduler.poke()
  await scheduler.settled()
  await waitFor(() => expect(connectorRefreshes).toBe(before + 1))
  permissions = {}
})


test("#1652 audit: project A disable rejects project B approvals with the active locale after ledger commit", async () => {
  const { setLocale } = await import("../src/renderer/i18n")
  const [api, dispose] = solid.createRoot((dispose) => [realUseExtensions(
    () => ({ baseUrl: "http://127.0.0.1:39131" }), () => true, () => projectA, directories,
  ), dispose] as const)
  await waitFor(() => expect(api.store.receipts.some((r) => r.name === "dbhub-readonly")).toBe(true))
  const receipt = api.store.receipts.find((r) => r.name === "dbhub-readonly")!
  permissions = { [projectA]: [approvalRequest("per_same", receipt.name, "ses_same")], [projectB]: [approvalRequest("per_same", receipt.name, "ses_same")] }
  permissionReplies.length = 0
  operations.length = 0
  setLocale("en")
  try {
    expect((await api.setInstallState(receipt, "disabled")).ok).toBe(true)
    expect(permissionReplies).toEqual([projectA, projectB].map((directory) => ({ directory, requestID: "per_same", reply: "reject", message: "Connector disabled" })))
    expect(operations).toEqual(["ledger", "reply", "reply"])
    expect(Object.values(permissions).flat()).toEqual([])
  } finally { setLocale("zh"); dispose() }
})

for (const offline of [[projectA], [projectA, projectB]]) test(`#1652 audit: disable commits when permission lookup is offline in ${offline.length} directories`, async () => {
  const receipt = hubApi.store.receipts.find((r) => r.name === "dbhub-readonly")!
  permissions = { [projectB]: [approvalRequest("per_online", receipt.name, "ses_online")] }
  offline.forEach((directory) => unavailable.add(directory))
  permissionReplies.length = 0
  operations.length = 0
  try {
    expect((await hubApi.setInstallState(receipt, "disabled")).ok).toBe(true)
    expect(operations[0]).toBe("ledger")
    expect(permissionReplies).toHaveLength(offline.includes(projectB) ? 0 : 1)
    expect(findRecordV2(globalRoot, "mcp", receipt.name)?.desiredState).toBe("disabled")
  } finally { unavailable.clear(); permissions = {} }
})

test("#1652 audit: a refused ledger write sends no permission rejection", async () => {
  const receipt = hubApi.store.receipts.find((r) => r.name === "dbhub-readonly")!
  permissions = { [projectA]: [approvalRequest("per_kept", receipt.name, "ses_kept")] }
  permissionReplies.length = 0
  refuseState = true
  try {
    expect((await hubApi.setInstallState(receipt, "disabled")).ok).toBe(false)
    expect(permissionReplies).toEqual([])
    expect(permissions[projectA]).toHaveLength(1)
  } finally { refuseState = false; permissions = {} }
})
