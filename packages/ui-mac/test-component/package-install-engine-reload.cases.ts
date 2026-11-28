// Hub DOM → real useExtensions.installPackage → one main install entry.
// Both package and legacy-bundle plus actions are immediate; the renderer does not confirm or dispose.
// Main applies MCP components at runtime and schedules only skill-bearing content for Location reload.
// Exact data-layer/IPC ID counts catch bypasses and duplicate writes. The existing scheduler,
// pending-state, connector permission and attachment checks below keep their original behavior.
// Only process/HTTP boundaries are substituted; admission, ledger, transactions and planners are real.
// Real MCP availability/read-back is additionally guarded by engine-cases.test.ts
// and engine-cases.test.ts; this host exercises actual renderer actions.
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
import { hubPackageFixture } from "./hub-package.fixture"

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
let locationReloads = 0
// `#1662`(#1667):启动投影是 OpenCode 2 形状 —— 停用的 MCP 在 `mcp.servers.<名字>` 写整条中和条目(`disabled: true`),不是 v1 的 `mcp.<名字>.enabled: false`。
let startup: { mcp?: { servers?: Record<string, { disabled?: boolean }> } } | undefined
const services = () => startup ? { "codepuppy-pdf": { status: startup.mcp?.servers?.["codepuppy-pdf"]?.disabled === true ? "disabled" : "connected" } } : {}
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
const hubSample = hubPackageFixture()
const catalogEntries = [
  ...(bundledCatalog as unknown as { entries: unknown[] }).entries,
  testBundle(BUNDLE_OK, BUNDLE_OK_NAME, "mcp:markitdown"),
  testBundle(BUNDLE_PENDING, BUNDLE_PENDING_NAME, "mcp:fetch"),
]
const catalogDocument = {
  version: "2026-08-03",
  entries: catalogEntries,
  packages: [fixture.envelope, ...hubSample.packages],
}

// URL → 字节。payload 由信封的 `payloadRef` 给出;资产由 payload 自己给出 —— agent 是
// `behavior.asset`、skill 是 `behavior.files`、command 是 `behavior.template`,都要**逐条**登记进这张表。
const bytesByUrl = new Map<string, Uint8Array>()
for (const component of hubSample.packages.flatMap((entry) => entry.components)) {
  const bytes = await hubSample.fetchBytes(component.payloadRef)
  bytesByUrl.set(component.payloadRef.url, bytes)
  for (const ref of JSON.parse(new TextDecoder().decode(bytes)).behavior.files ?? [])
    bytesByUrl.set(ref.url, await hubSample.fetchBytes(ref))
}
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
// Hub 绕过数据层或重复出站时，desktopCalls 与 desktopIpcCalls 的精确对照变红。
type CentralCall = { catalogId: string; attemptId: string | undefined; authorized: boolean }
const centralCalls: CentralCall[] = []
const desktopCalls: string[] = []
const desktopIpcCalls: string[] = []
const desktopResults = new Map<string, unknown>()
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
      installPackage: (packageId: string) => { desktopCalls.push(packageId); return api.installPackage(packageId) },
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
const { generationMcpServerNames, readMcpServerRecordsForGeneration } = await import("../src/main/mcp-server-records")
const { readPackageAllowSet } = await import("../../ext/src/gen-skill-paths")
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
      setConfiguredEgressDestinations(deriveMcpEgressDestinations(readMcpServerRecordsForGeneration()))
      return true
    },
  },
  async () => undefined,
)
const globalRoot = codepuppyGlobalRoot()
/** `#1529`:main 发往 ext 调度器的重载请求 —— 「装完有没有让引擎重扫」的判据。 */
const reloadRequests: Array<{ type?: string; generation?: number; scope?: unknown }> = []
codepuppySidecar.attach((message) => void reloadRequests.push(message as { type?: string; generation?: number; scope?: unknown }))

// ── ⑦ renderer ↔ main 的桥:走生产 handler,不重写任何判定 ───────────────────────────────
const SENDER: IpcSender = { id: 1, on: () => {}, once: () => {} }
/** 渲染端最近一次读到的安装清单:点行之前先等它带上该收据,否则点到的是还没收据的实时行(走引擎直连,不经账本)。 */
let lastInstalls: { global?: Array<{ id: string }> } | undefined
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
  uninstallPackage: (packageId: string) => call("ext-uninstall-package", packageId),
  installPackage: async (packageId: string) => {
    desktopIpcCalls.push(packageId)
    const result = await call("ext-install-package", packageId)
    desktopResults.set(packageId, result)
    return result
  },
  setPackageState: (intent: unknown) => call("ext-set-package-state", intent),
  packageAuthorization: (packageId: string) => call("ext-package-authorization", packageId),
  savePackageSecrets: (intent: unknown) => call("ext-save-package-secrets", intent),
  setInstallState: async (intent: unknown) => {
    if (refuseState) return { ok: false, reason: "fixture write failure" }
    const result = await call("ext-set-install-state", intent)
    if ((result as { ok: boolean }).ok) operations.push("ledger")
    return result
  },
  persistMcp: (name: unknown, server: unknown, secrets: unknown) => call("ext-persist-mcp", name, server, secrets),
  listInstalls: async (projectDir?: unknown) => (lastInstalls = await call("ext-list-installs", projectDir) as typeof lastInstalls),
  inventoryView: (projectDir?: unknown) => call("ext-inventory-view", projectDir),
  // `#1825`:定制中心列本机原生文件(extension-hub.tsx 的 nativeSources),同样走生产 handler。
  nativeSources: (projectDir?: unknown) => call("ext-native-sources", projectDir),
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

/** Direct Hub plus: one main-owned install, no confirmation or renderer authorization. */
async function installBundleThroughUi(name: string): Promise<void> {
  expect(q("[data-package-authorization]")).toBeNull()
  setHubSection("connectors")
  await waitFor(() => expect(entryCard(name)).toBeInstanceOf(HTMLElement))
  click(entryCard(name).querySelector(".codepuppy-ext-add"))
  const catalogId = name === BUNDLE_OK_NAME ? BUNDLE_OK : BUNDLE_PENDING
  await waitFor(() => expect(desktopResults.get(catalogId)).toMatchObject({ ok: true }))
  const state = readPackageLedgerStateV1(globalRoot)
  expect(state.ok && state.packageGraphs.some(graph => graph.packageId === catalogId)).toBe(true)
  expect(q("[role='dialog']")).toBeNull()
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 判据
// ═══════════════════════════════════════════════════════════════════════════════════════

test("① MCP 包直接保存并自动开启,经数据层一次出站且不请求重载", async () => {
  setHubSection("connectors")
  await waitFor(() => expect(q(`[data-package-card="package:github"]`)).toBeInstanceOf(HTMLElement))
  const reloadsBefore = reloadRequests.length
  click(q(`[data-package-card="package:github"] .codepuppy-ext-add`))
  await waitFor(() => expect(ledgerPackageIds()).toContain("package:github"))
  expect(q("[data-package-authorization]")).toBeNull()
  expect(desktopCalls).toEqual(["package:github"])
  expect(desktopIpcCalls).toEqual(desktopCalls)
  expect(reloadRequests.slice(reloadsBefore)).toEqual([])
  expect(disposeCalls).toBe(0)
})

test("② MCP 包管理页保存密钥,不重装且不请求重载", async () => {
  await waitFor(() => expect(q(`[data-installed-package="package:github"] [data-more]`)).toBeInstanceOf(HTMLElement))
  click(q(`[data-installed-package="package:github"] [data-more]`))
  click(q('[data-menu-item="manage"]'))
  await waitFor(() => expect(q('[data-package-secret]')).toBeInstanceOf(HTMLElement))
  click(q('[data-package-secret]'))
  await waitFor(() => expect(q('input[type="password"]')).toBeInstanceOf(HTMLInputElement))
  const input = q<HTMLInputElement>('input[type="password"]')!
  input.value = "req810-secret"
  input.dispatchEvent(new Event("input", { bubbles: true }))
  const reloadsBefore = reloadRequests.length
  click(q('[role="dialog"] .a-dialog-footer button'))
  await waitFor(() => expect(q('input[type="password"]')).toBeNull())
  expect(desktopCalls).toEqual(["package:github"])
  expect(reloadRequests.slice(reloadsBefore)).toEqual([])
  expect(disposeCalls).toBe(0)
  click(q('.codepuppy-ext-crumb-link'))
})

// I-11 v9-9:② 的 package:github 是本代中途装的(本代启动时没读到它的远程记录)⇒ 只收敛、不重载。换一代之后,它的远程定义
// 进了本代内联层;再换凭据(引用带版本)⇒ 换代。开关从不换代。
test("I-11 v9-9 replacing the credential of a remote connector this generation started with requests a new generation", async () => {
  // A fresh generation's pre-fork read (server.ts) now includes package:github's remote record.
  readMcpServerRecordsForGeneration()
  const names = (await call("ext-installed-packages") as { packages: Array<{ packageId: string; components: Array<{ kind: string; name: string }> }> })
    .packages.find((pack) => pack.packageId === "package:github")!.components.filter((component) => component.kind === "mcp").map((component) => component.name)
  expect(names.length).toBeGreaterThan(0)
  expect(names.every((name) => generationMcpServerNames().has(name))).toBe(true)
  await waitFor(() => expect(q(`[data-installed-package="package:github"] [data-more]`)).toBeInstanceOf(HTMLElement))
  click(q(`[data-installed-package="package:github"] [data-more]`))
  click(q('[data-menu-item="manage"]'))
  await waitFor(() => expect(q('[data-package-secret]')).toBeInstanceOf(HTMLElement))
  click(q('[data-package-secret]'))
  await waitFor(() => expect(q('input[type="password"]')).toBeInstanceOf(HTMLInputElement))
  const input = q<HTMLInputElement>('input[type="password"]')!
  input.value = "req810-secret-replaced"
  input.dispatchEvent(new Event("input", { bubbles: true }))
  const reloadsBefore = reloadRequests.length
  const refreshesBefore = connectorRefreshes
  click(q('[role="dialog"] .a-dialog-footer button'))
  await waitFor(() => expect(q('input[type="password"]')).toBeNull())
  await waitFor(() => expect(reloadRequests.length).toBe(reloadsBefore + 1))
  const request = reloadRequests.at(-1)!
  codepuppySidecar.receive({ type: "codepuppy.reload.report", generation: request.generation!, scope: "global", outcome: "reloaded", directories: [] }, () => {})
  await waitFor(() => expect(connectorRefreshes).toBe(refreshesBefore + 1))
  click(q('.codepuppy-ext-crumb-link'))
})

test("③ MCP 套件与包共用单一安装收口,一次出站且不重载", async () => {
  const reloadsBefore = reloadRequests.length
  const centralBefore = centralCalls.length
  clearToasts()
  await installBundleThroughUi(BUNDLE_OK_NAME)

  await waitFor(() => expect(toasts().join("\n")).toContain(zh["codepuppy.ext.added"]))
  expect(centralCalls.slice(centralBefore)).toEqual([])
  expect(desktopCalls.at(-1)).toBe(BUNDLE_OK)
  expect(desktopIpcCalls).toEqual(desktopCalls)
  expect(reloadRequests.slice(reloadsBefore)).toEqual([])
  expect(disposeCalls).toBe(0)
  expect(toasts().join("\n")).not.toContain(zh["codepuppy.ext.addedPendingReload"])
})

test("④ `#1529` AC3:ext 报告重载失败 ⇒ 已安装列表如实「待重载 · 上次重载没有成功」,不谎报可以使用", async () => {
  const reloadsBefore = reloadRequests.length
  clearToasts()
  await installBundleThroughUi(BUNDLE_PENDING_NAME)
  expect(reloadRequests.length).toBe(reloadsBefore)
  // A skill-bearing package retains its non-force reload and truthful failure surface.
  click(q('[data-package-card="package:supabase"] .codepuppy-ext-add'))
  await waitFor(() => expect(ledgerPackageIds()).toContain("package:supabase"))
  await waitFor(() => expect(reloadRequests.length).toBe(reloadsBefore + 1))
  expect(reloadRequests.at(-1)).not.toHaveProperty("force", true)
  // 引擎(ext 调度器)对**所有在途**的重载报失败 —— 它们都覆盖当前目录。
  for (const request of reloadRequests)
    codepuppySidecar.receive(
      { type: "codepuppy.reload.report", generation: request.generation, scope: "global", outcome: "failed", directories: [], error: "dispose refused (fixture)" },
      () => {},
    )
  // `#1594`:已装行分在三页各自的「已安装」组(技能、命令进技能页,助手进助手页,其余进连接器页)。
  // 夹具自检:列表上真的有没核验通过的已装行(引擎替身答不出技能 / agent / 命令清单),否则下面那几条恒成立。
  setHubSection("connectors")
  await waitFor(() => expect(q('[data-installed-package="package:supabase"]')?.textContent).toContain("未能启用"))
  let pendingRows = 0
  let failedPackages = 0
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
    failedPackages += qa("[data-installed-package]").filter((row) => row.textContent?.includes("未能启用")).length
    expect(qa("[data-installed-package] [data-hub-reload-now]")).toEqual([])
  }
  expect(pendingRows + failedPackages).toBeGreaterThan(0)
  expect(disposeCalls).toBe(0)
})

test("⑤ 出站计数相等:到达 IPC 的每一次安装都经过了收口方法", async () => {
  expect(centralCalls).toEqual([])
  expect(ipcInstallIntents).toEqual([])
  expect(desktopCalls).toEqual(["package:github", BUNDLE_OK, BUNDLE_PENDING, "package:supabase"])
  expect(desktopIpcCalls).toEqual(desktopCalls)
  // 夹具自检:被装的那个 package 里真的有一个 MCP 组件(套件成员之外还有 fs 类组件),
  // 也就是说「装完要重扫」这件事对本夹具是真需求,不是摆设。
  expect(fixture.envelope.components.map((component) => component.id)).toContain(LEAF_MCP_ID)
  expect((await hubApi.uninstallPackage("package:github")).ok).toBe(true)
  // `#1724`:github 的远程连接器在启动配置里,整包移除要换一代引擎(connectorChange)。在这里让它走完,
  // 不把一个在途的换代留给后面的用例。
  const before = connectorRefreshes
  busy = false
  codepuppySidecar.attach((request) => scheduler.request(request))
  await waitFor(() => expect(connectorRefreshes).toBe(before + 1))
  await scheduler.settled()
  busy = true
  codepuppySidecar.attach((message) => void reloadRequests.push(message as { type?: string; generation?: number; scope?: unknown }))
  await flush()
})

// #1646 uses the same real Hub → IPC → ledger. Only process launch is substituted;
// startup projections use production producers, never a hand-written ledger.
let busy = true
// `#1662`(#1665):2.x 的调度器问进程内引擎的 `GET /api/session/active`(进程级忙闲),重载打 `POST /api/location/reload`;
// 登记只认目录。v1 那种按实例的 `session.status` / `instance.dispose` 客户端已不存在。
const scheduler = createReloadScheduler({
  engine: () => async (request: Request) => {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/api/session/active") return Response.json({ data: busy ? { ses_1: { type: "running" } } : {} })
    if (request.method === "POST" && url.pathname === "/api/location/reload") { locationReloads++; return new Response(null, { status: 204 }) }
    return new Response("not found", { status: 404 })
  },
  log: () => {}, error: () => {},
  report: (report) => codepuppySidecar.receive({ type: "codepuppy.reload.report", ...report }, () => {}),
})
const pdfRow = () => q('[data-installed-row="mcp:codepuppy-pdf"]')!
// Same staged attachment metadata as attachment-reader-hooks.test.ts / attachment-cards.cases.ts.
const meta = { v: 1 as const, name: "a.pdf", mime: "application/pdf", size: 2048, path: "attachments/00000000-0000-4000-8000-000000000000/a.pdf", reader: "pdf" as const }


// I-11 方案 A(design v9 §5「MCP 组件开关」):第一方 Office 的开关 = 持久写 + main 收敛;不重载、不换代、渲染进程不碰运行时。
// 引擎侧的效果(重建与新 Location 仍随开关、已有会话调不到)由 managed-mcp-toggle.engine 的真引擎用例判。
test("I-11 Office PDF switch from the Hub: durable write and allow-set flip both ways, with no reload, no connector restart and no renderer runtime call", async () => {
  for (const request of reloadRequests) codepuppySidecar.receive({ type: "codepuppy.reload.report", generation: request.generation, scope: "global", outcome: "reloaded", directories: [] }, () => {})
  await flush()
  connectorRefreshes = 0
  liveMcpCalls = 0
  expect(restoreMcpLeaf("codepuppy-pdf", { type: "local", command: codepuppyOfficeInstallCommand("pdf"), enabled: true }).ok).toBe(true)
  expect(upsertRecordV2(globalRoot, {
    id: "mcp:codepuppy-pdf", name: "codepuppy-pdf", kind: "mcp", origin: "catalog", environment: "dev",
    version: bundledCatalog.entries.find((entry) => entry.id === "mcp:codepuppy-pdf")!.version,
    scope: { kind: "global" }, installedAt: "2026-11-05T10:40:00.000Z", desiredState: "enabled", configKey: "mcp.codepuppy-pdf",
  }).ok).toBe(true)
  startup = {}
  scheduler.register(join(tmp, "project"), {})
  codepuppySidecar.attach((request) => scheduler.request(request))
  busy = true
  setHubSection("connectors")
  document.dispatchEvent(new Event("visibilitychange"))
  await waitFor(() => expect(pdfRow()).toBeInstanceOf(HTMLElement))
  await waitFor(() => expect(lastInstalls?.global?.some((entry) => entry.id === "mcp:codepuppy-pdf")).toBe(true))
  await flush()
  const reloadsBefore = locationReloads
  const allowed = () => readPackageAllowSet(globalRoot)?.mcp.find((entry) => entry.name === "codepuppy-pdf")?.enabled
  expect(allowed()).toBe(true)
  click(pdfRow().querySelector('[data-more]'))
  click(pdfRow().querySelector('[data-menu-item="disable"]'))
  await waitFor(() => expect(findRecordV2(globalRoot, "mcp", "codepuppy-pdf")?.desiredState).toBe("disabled"))
  expect(allowed()).toBe(false)
  await scheduler.settled()
  await waitFor(() => expect(pdfRow().querySelector('[data-enable-row]')).toBeInstanceOf(HTMLElement))
  click(pdfRow().querySelector('[data-enable-row]'))
  await waitFor(() => expect(findRecordV2(globalRoot, "mcp", "codepuppy-pdf")?.desiredState).toBe("enabled"))
  expect(allowed()).toBe(true)
  busy = false
  scheduler.poke()
  await scheduler.settled()
  expect(connectorRefreshes).toBe(0)
  expect(locationReloads).toBe(reloadsBefore)
  expect(liveMcpCalls).toBe(0)
  expect(pdfRow().querySelector('[data-hub-reload-now]')).toBeNull()
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


// I-11:关掉连接器时只有 main 的 convergeManagedMcp 拒它自己的待答审批(真引擎证明 3);定制中心不再发任何审批回复,也不换代。
test("I-11 disabling dbhub-readonly while approvals wait: the Hub sends no approval reply and nothing restarts; main owns the rejection", async () => {
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
  await waitFor(() => expect(findRecordV2(globalRoot, "mcp", name)?.desiredState).toBe("disabled"))
  await scheduler.settled()
  expect(permissionReplies).toEqual([])
  expect(Object.values(permissions).flat().map((request) => request.id)).toEqual(["per_db_1", "per_db_2", "per_other"])
  expect(operations).toEqual(["ledger"])
  busy = false
  scheduler.poke()
  await scheduler.settled()
  expect(connectorRefreshes).toBe(before)
  expect(liveMcpCalls).toBe(0)
  permissions = {}
})

test("busy package switch forces the existing scheduler without a second reload action", async () => {
  const installed = await call("ext-install-package", "package:supabase")
  expect(installed).toMatchObject({ ok: true })
  const before = connectorRefreshes
  const reloadsBefore = locationReloads
  busy = true
  scheduler.register(join(tmp, "project"), {})
  codepuppySidecar.attach((request) => scheduler.request(request))
  for (const state of ["disabled", "enabled"] as const) {
    expect(await call("ext-set-package-state", { packageId: "package:supabase", state })).toMatchObject({ ok: true })
    await scheduler.settled()
    await waitFor(() => expect(locationReloads).toBe(reloadsBefore + (state === "disabled" ? 1 : 2)))
    expect(connectorRefreshes).toBe(before)
    expect(busy).toBe(true)
    const ledger = readPackageLedgerStateV1(globalRoot)
    expect(ledger.ok).toBe(true)
    if (ledger.ok)
      expect(ledger.records.filter((record) => ["supabase", "supabase-postgres-best-practices"].includes(record.name)).map((record) => record.desiredState)).toEqual([state, state, state])
  }
})

 test("package reload requests address graph component identities", async () => {
  const requests: Array<{ items?: Array<{ id: string }> }> = []
  const detach = codepuppySidecar.attach((message) => { requests.push(message as { items?: Array<{ id: string }> }) })
  try {
    expect(await call("ext-install-package", "package:supabase")).toMatchObject({ ok: true })
    // Activation and its reload are published one event turn after the install returns (plan r3 AC-14, design §4.2).
    await waitFor(() => expect(requests.at(-1)?.items?.map((item) => item.id)).toEqual(expect.arrayContaining(["package:supabase", "skill:supabase", "mcp:supabase", "skill:supabase-postgres-best-practices"])))
  } finally { detach() }
})

// I-11 证明 6(对照):含 cloud 组件的包开关仍换代(云组件的启停决定每代冻结的注入与身份事实,design v9 §5)。
test("I-11 proof 6 (control): a package with a cloud component still requests a new generation when toggled", async () => {
  busy = false
  scheduler.register(join(tmp, "project"), {})
  codepuppySidecar.attach((request) => scheduler.request(request))
  // The catalog cannot install a cloud package in this harness; the production ledger writer records the same graph.
  const { applyPackageMutation } = await import("../src/main/ext-receipt-v2")
  const { bundleOwner, computeInstalledGraphDigest } = await import("../src/main/ext-package-ledger-v3")
  const node = { componentId: "cloud:image", kind: "cloud" as const, name: "image", required: true, manifestDigest: "sha256:" + "c".repeat(64) }
  const graph = { packageId: "package:cloud-image", envelopeDigest: node.manifestDigest, installedGraphDigest: "", root: node, children: [] }
  graph.installedGraphDigest = computeInstalledGraphDigest(graph)
  expect(applyPackageMutation(globalRoot, {
    operation: "install", transactionId: "i11-cloud-control", graphBeforeDigest: null, graphAfter: graph,
    claimMutations: [{ op: "acquire", kind: "cloud", name: "image", owner: bundleOwner(graph.packageId, node.manifestDigest) }],
    childRecordMutations: [{ op: "upsert", input: { id: node.componentId, kind: "cloud", name: "image", environment: "dev", scope: { kind: "global" }, desiredState: "enabled", origin: "catalog", version: "1.0.0", installedAt: "2026-11-18T00:00:00.000Z", manifestDigest: node.manifestDigest } }],
  })).toMatchObject({ ok: true })
  const before = connectorRefreshes
  expect(await call("ext-set-package-state", { packageId: "package:cloud-image", state: "disabled" })).toMatchObject({ ok: true })
  await scheduler.settled()
  await waitFor(() => expect(connectorRefreshes).toBe(before + 1))
})
