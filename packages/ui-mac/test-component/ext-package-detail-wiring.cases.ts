// 独立进程运行：真实 Solid DOM 构建 + 生产 ExtensionHub/ExtensionDetail。
// 随包 catalog 当前没有 packages[]；下列五态均由 pin 的 producer corpus 显式构造，
// 只证明生产 renderer 路径可达，不声称线上已经有 package 流量。

import { afterAll, afterEach, describe, expect, mock, test } from "bun:test"
import { transformAsync } from "@babel/core"
import presetTypescript from "@babel/preset-typescript"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import presetSolid from "babel-preset-solid"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import bundledCatalog from "../src/renderer/extensions/codepuppy-catalog.json"
import d5OldCatalog from "../src/renderer/extensions/testvectors/d5-old-catalog.json"
import type { CatalogPackageViewV1 } from "../src/shared/catalog-package-view"
import type {
  CodePuppyPackageEnvelopeV1,
  PackageProfilePayloadV1,
} from "../src/shared/host-extension-package-contract/decoder"
import { evaluatePackageForHost, runCatalogInstallWithPackagePreflight, resolveVerifiedPackageV1 } from "../src/main/package-installability"
import { createPackageAdmissionCoordinator, installDesktopPackageV1, savePackageSecretsV1, readPackageAuthorizationV1 } from "../src/main/package-admission"
import { setPackageStateV1 } from "../src/main/ext-install-planner"
import { createPluginSources, type SourceSearchResultV1 } from "../src/main/plugin-sources"
import { fixtureFetch } from "../test-fixtures/plugin-helper/source-fetch"
import { writeCapabilityGrantSync } from "../src/main/ext-capability-grants"
import { readPackageGraphs, readPackageLedgerStateV1 } from "../src/main/ext-receipt-v2"
import { uninstallPackageV1 } from "../src/main/ext-package-uninstall"
import {
  evaluateRemoteCatalogPackages,
  PACKAGE_DETAIL_IPC_CHANNEL,
  registerPackageCatalogReadIpcHandlers,
  type RemoteCatalogResult,
} from "../src/main/remote-catalog"
import { dict as zh } from "../src/renderer/i18n/zh"
import {
  canonicalArtifactJsonBytesV1,
  HOST_EXTENSION_PACKAGE_CORPUS,
} from "../src/shared/host-extension-package-contract/generate-artifact"
import {
  EXPECTED_SKIP_REASON,
  LEAF_COMMAND_ID,
  LEAF_MCP_ID,
  LEAF_SKILL_ID,
  LEAF_UNSUPPORTED_ID,
  MIXED_BUNDLE_PACKAGE_ID,
  mixedBundleFixture,
  ROOT_AGENT_ID,
} from "./package-mixed-bundle.fixture"

const consoleOutput: unknown[] = []
const originalConsole = { log: console.log, warn: console.warn, error: console.error }
for (const method of ["log", "warn", "error"] as const) console[method] = (...args: unknown[]) => { consoleOutput.push(args) }
afterAll(() => Object.assign(console, originalConsole))

GlobalRegistrator.register()
const solid = await import("solid-js/dist/solid.js")
mock.module("solid-js", () => solid)
const solidWeb = await import("solid-js/web/dist/web.js")
mock.module("solid-js/web", () => solidWeb)

Bun.plugin({
  name: "ext-package-detail-solid-components",
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

/** `#784` G20:详情页的「移除此扩展包」**必须经过数据层**(`ext.uninstallPackage`),
 *  因为引擎重载接在那一层。它若绕回 `extIpc.uninstallPackage` 直连,包照样被删掉、
 *  下面所有既有断言照样绿 —— 只有这个计数器会停在 0。 */
const dataLayerPackageUninstalls: string[] = []
const extensions = {
  store: {
    mcp: {},
    receipts: [],
    projectReceipts: [],
    agents: [],
    sessionGrants: [],
    sessionLink: {},
    // `#1529`:三档状态行(生产 store 恒有这一键;替身缺它,详情页读不到就当没有)。
    hubRows: [],
    ready: true,
    error: false,
  },
  factorySkills: () => [],
  isInstalled: () => false,
  refresh: async () => {},
  refreshEngine: async () => true,
  requestEngineReload: async () => true,
  listInstalledPackages: async () => extIpcRef!.installedPackages(),
  installPackage: async (packageId: string) => extIpcRef!.installPackage(packageId),
  setPackageState: async (intent: { packageId: string; state: "enabled" | "disabled" }) => extIpcRef!.setPackageState(intent),
  savePackageSecrets: async (intent: { packageId: string; secrets: Record<string, string> }) => extIpcRef!.savePackageSecrets(intent),
  uninstallPackage: async (packageId: string) => {
    dataLayerPackageUninstalls.push(packageId)
    // **照生产那条链走**:`use-extensions.uninstallPackage` 调的是 `extIpc`(`#765` 的呈现咽喉),
    // 不是 `window.api.ext`。这里若图省事直连桥,「整包卸载的 warning 到得了用户面」那条闸
    // 会因为**替身**绕过咽喉而变红 —— 那是夹具在替被测代码改文法,不是缺陷。
    return extIpcRef!.uninstallPackage(packageId)
  },
  /** `#810`:安装意图收口到数据层之后,本文件的三条 package 路径也从这里出站。
   *  同样**照生产那条链走**(`extIpc` 而不是 `window.api.ext`),理由与上面那条逐字相同;
   *  `scope` 由数据层钉死 global —— 生产实现就是这么做的,替身不许自己另发明一个。
   *  「装完必须让引擎重扫」的判据不在本文件(这里的 `refreshEngine` 是常量桩),
   *  它在 `src/renderer/engine-cases.test.ts`。 */
  installCatalogIntent: async (intent: { catalogId: string }) =>
    extIpcRef!.installCatalog({ ...intent, scope: { scope: "global" } }),
}
/** `extIpc` 会牵出 `Toast` → solid,只能在 registrator 之后动态 import;上面的替身按调用时求值。 */
let extIpcRef: typeof import("../src/renderer/extensions/ext-ipc").extIpc | undefined

const realUseExtensionsModule = await import("../src/renderer/extensions/use-extensions")
mock.module("../src/renderer/extensions/use-extensions", () => ({
  ...realUseExtensionsModule,
  useExtensions: () => extensions,
  isAuthzRequired: () => false,
  isLocalPluginRoute: () => false,
}))
mock.module("../src/renderer/auth-recovery", () => ({
  subscribeAuthState: (listener: (state: { status: "logged-out"; mode: "byok" }) => void) => {
    listener({ status: "logged-out", mode: "byok" })
    return () => {}
  },
}))
mock.module("@solidjs/router", () => ({
  useLocation: () => ({ pathname: "/" }),
}))
mock.module("../src/renderer/codepuppy-ui/Banner", () => ({
  Banner: () => null,
}))

const { createComponent } = solid
const { render } = solidWeb
const { ExtensionHub } = await import("../src/renderer/extensions/extension-hub")
// 必须**动态** import:静态 import 会在 registrator 之前牵出 solid-js,整个文件拿到 server 构建
// (指纹 = 报错与改动无关且全文件一起挂)。这条纪律写在 CLAUDE.md 的《本机验证陷阱》里。
const { ToastViewport, pushToast } = await import("../src/renderer/codepuppy-ui/Toast")
extIpcRef = (await import("../src/renderer/extensions/ext-ipc")).extIpc as unknown as typeof extIpcRef
const { setHubSection } = await import("../src/renderer/extensions/ext-hub-state")

const artifact = resolve(import.meta.dir, "../../codepuppy-contracts-consumer/vendor/alpha-web-extension-package")
const disposals: Array<() => void> = []
const secretCanary = "REQ128_RENDERER_SECRET_CANARY_64f91d"

const canonicalBytes = (value: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)

/**
 * 宿主自持的 v2 信封,沿用 producer 语料的身份与呈现。vendored producer 产物本身没有 `root`,
 * 在 v2 合同下应当被拒 —— 那道过渡闸在 package-installability{,.wiring}.test.ts,不在这里重述。
 */
const producerCorpus = async () => ({
  envelope: {
    schema: "codepuppy.host-extension-package.v1",
    prelude: { packageId: "package:generic-remote-mcp", version: "1.0.0" },
    presentation: {
      displayName: "Generic Remote MCP",
      description: "Generic Phase 1 compiler corpus input.",
    },
    root: "mcp:generic-remote",
    components: [
      {
        id: "mcp:generic-remote",
        required: true,
        dependencies: [],
        profileId: "mcp-remote",
        profileVersion: 1,
        capabilities: ["codepuppy.secret-prerequisite.v1"],
        payloadRef: {
          sha256: "0".repeat(64),
          bytes: 1,
          mediaType: "application/vnd.codepuppy.host-extension-package.mcp-remote.v1+json",
          url: "https://alphacodeone.com/catalog/assets/mcp.generic-remote/1.0.0/alpha-package/payload.json",
        },
      },
    ],
    capabilities: ["codepuppy.secret-prerequisite.v1"],
  } as unknown as CodePuppyPackageEnvelopeV1,
  payload: {
    schema: "codepuppy.host-extension-package.payload.mcp-remote.v1",
    behavior: {
      url: "https://mcp.example.com/",
      headersTemplate: { Authorization: "Bearer {A_KEY}", "X-Remote-Token": "{B_TOKEN}" },
      requiredSecrets: ["A_KEY", "B_TOKEN"],
      auth: "none",
    },
  } as unknown as PackageProfilePayloadV1,
})

const bindPayload = (envelope: CodePuppyPackageEnvelopeV1, payload: PackageProfilePayloadV1) => {
  const bytes = canonicalBytes(payload)
  envelope.components[0].payloadRef.bytes = bytes.byteLength
  envelope.components[0].payloadRef.sha256 = createHash("sha256").update(bytes).digest("hex")
  return bytes
}

/** REQ-235:宿主发布的 decoder 语料 `cloud-v1`(信封 + 载荷字节就是 artifact 里那一份)。 */
const CLOUD_PACKAGE_ID = "package:cloud-v1"
const cloudCorpusCase = async () => {
  const corpus = (await Bun.file(
    resolve(import.meta.dir, "../src/shared/host-extension-package-contract", HOST_EXTENSION_PACKAGE_CORPUS),
  ).json()) as {
    cases: Array<{ name: string; envelope: CodePuppyPackageEnvelopeV1; components: Array<{ payload: unknown }> }>
  }
  const item = corpus.cases.find((entry) => entry.name === "cloud-v1")!
  return { envelope: item.envelope, bytes: canonicalArtifactJsonBytesV1(item.components[0]!.payload) }
}

const packageFixture = async (options?: { withCloud?: boolean }) => {
  const ready = await producerCorpus()
  ready.envelope.prelude.packageId = "package:renderer-ready"
  if (ready.payload.schema !== "codepuppy.host-extension-package.payload.mcp-remote.v1")
    throw new Error("producer corpus profile drifted")
  ready.payload.behavior.requiredSecrets = []
  // 与 requiredSecrets 一起清:宿主规则双向,留着 {NAME} 占位而不声明它 = 自相矛盾的夹具。
  ready.payload.behavior.headersTemplate = {}
  ready.envelope.capabilities = []
  ready.envelope.components[0].capabilities = []

  const prerequisite = await producerCorpus()
  prerequisite.envelope.prelude.packageId = "package:renderer-prerequisite"
  if (prerequisite.payload.schema !== "codepuppy.host-extension-package.payload.mcp-remote.v1")
    throw new Error("producer corpus profile drifted")
  prerequisite.payload.behavior.requiredSecrets = ["A_KEY"]
  prerequisite.payload.behavior.headersTemplate = {
    Authorization: "Bearer {A_KEY}; target=REQ128_RENDERER_PAYLOAD_CANARY",
  }

  const update = await producerCorpus()
  update.envelope.prelude.packageId = "package:renderer-update"
  ;(update.envelope.components[0] as { profileId: string }).profileId = "future-profile"
  // 与 corpus 不同的 presentation:五个夹具都克隆自同一份 producer corpus,只改了 packageId,
  // 于是 displayName 全是 "Generic Remote MCP" —— 那样断言杀不掉「回落成 packageId」「写死常量」
  // 「取错包」任何一种。update-required 是本票新产生的那一支,给它一份独有的值。
  update.envelope.presentation = {
    displayName: "Renderer Update Package",
    description: "Only this fixture carries this description.",
  }

  const blocked = await producerCorpus()
  blocked.envelope.prelude.packageId = "package:renderer-blocked"
  blocked.envelope.components[0].required = false

  const payloadBlocked = await producerCorpus()
  payloadBlocked.envelope.prelude.packageId = "package:renderer-payload-blocked"

  // `#697` 第 5 跳:canonical mixed Bundle 走**同一条**生产 renderer 路径。它带一个已策展但
  // 宿主不支持的 optional leaf,所以详情页必须逐组件出行,并对那一条给出具名原因。
  const bundle = mixedBundleFixture()

  const readyBytes = bindPayload(ready.envelope, ready.payload)
  const prerequisiteBytes = bindPayload(prerequisite.envelope, prerequisite.payload)
  const payloads = new Map<string, Uint8Array>([
    [ready.envelope.prelude.packageId, readyBytes],
    [prerequisite.envelope.prelude.packageId, prerequisiteBytes],
    [payloadBlocked.envelope.prelude.packageId, new TextEncoder().encode("{}\n")],
  ])
  const payloadsByDigest = new Map<string, Uint8Array>([
    [ready.envelope.components[0].payloadRef.sha256, readyBytes],
    [prerequisite.envelope.components[0].payloadRef.sha256, prerequisiteBytes],
  ])
  for (const [digest, bytes] of bundle.payloadByDigest) payloadsByDigest.set(digest, bytes)
  const cloud = options?.withCloud ? await cloudCorpusCase() : undefined
  if (cloud) payloads.set(CLOUD_PACKAGE_ID, cloud.bytes)
  const envelopes = [
    ready.envelope,
    prerequisite.envelope,
    update.envelope,
    blocked.envelope,
    payloadBlocked.envelope,
    // 违规/异常项放**最后**:只看第一个元素的实现要能被抓住。
    bundle.envelope,
    ...(cloud ? [cloud.envelope] : []),
  ]
  const raw: RemoteCatalogResult = {
    source: "remote",
    catalog: {
      version: "2026-07-31",
      // Legacy key-form coverage mutates real Git with D5 DBHub's requiredEnvVars.
      entries: bundledCatalog.entries.map((entry) =>
        entry.id !== "mcp:git" ? entry : {
          ...entry,
          installSpec: {
            ...entry.installSpec,
            requiredEnvVars: d5OldCatalog.entries.find((entry) => entry.id === "mcp:dbhub")!.installSpec!.requiredEnvVars,
          },
        },
      ),
      packages: envelopes,
    },
    version: "2026-07-31",
    fetchedAt: "2026-07-31T00:00:00.000Z",
    via: "channel-stable",
    channel: "stable",
  }
  // 显式状态,**不要**用调用计数表达「已解决」。R2 审计实测:原来的
  // `prerequisiteEvaluations === 1` 只有一次调用的裕度 —— 将来谁在详情打开前多加或少加
  // 一次 refresh,「已解决」就会静默翻面,而失败信息("Expected ready / Received
  // required-action")完全指不到真因。这正是三个月后没人解释得清的 flaky 的来源。
  let prerequisiteResolved = false
  let readyInstalled = false
  const complete = (catalogId: string) => {
    if (catalogId === prerequisite.envelope.prelude.packageId) prerequisiteResolved = true
    if (catalogId === ready.envelope.prelude.packageId) readyInstalled = true
  }
  const evaluator = async (envelope: unknown) => {
    const packageId = (envelope as CodePuppyPackageEnvelopeV1).prelude.packageId
    if (packageId === MIXED_BUNDLE_PACKAGE_ID)
      return evaluatePackageForHost(envelope, {
        fetchPayload: async (ref) => bundle.payloadByDigest.get(ref.sha256) ?? new Uint8Array(),
      })
    if (packageId !== prerequisite.envelope.prelude.packageId) {
      const view = await evaluatePackageForHost(envelope, {
        fetchPayload: async () => payloads.get(packageId) ?? new Uint8Array(),
      })
      if (!readyInstalled || packageId !== ready.envelope.prelude.packageId) return view
      return {
        ...view,
        action: { kind: "none" as const, enabled: false, reasonCode: "package-compatible" as const },
        presentation: { ...view.presentation, version: `${view.presentation.version}-installed` },
      }
    }

    if (!prerequisiteResolved)
      return evaluatePackageForHost(envelope, {
        fetchPayload: async () => payloads.get(packageId) ?? new Uint8Array(),
      })

    const resolvedEnvelope = structuredClone(prerequisite.envelope)
    const resolvedPayload = structuredClone(prerequisite.payload)
    resolvedEnvelope.capabilities = []
    resolvedEnvelope.components[0].capabilities = []
    resolvedPayload.behavior.requiredSecrets = []
    resolvedPayload.behavior.headersTemplate = {}
    const resolvedBytes = bindPayload(resolvedEnvelope, resolvedPayload)
    return evaluatePackageForHost(resolvedEnvelope, {
      fetchPayload: async () => resolvedBytes,
    })
  }
  return {
    raw,
    evaluator,
    complete,
    fetchPayload: async (ref: { sha256: string }) => payloadsByDigest.get(ref.sha256) ?? new Uint8Array(),
    fetchAsset: async (ref: { sha256: string }) => bundle.assetByDigest.get(ref.sha256) ?? new Uint8Array(),
  }
}

type Handler = (event: unknown, ...args: unknown[]) => unknown

let injectInstallWarning: string | null = null
let injectUninstallWarning: string | null = null

async function mountHarness(options?: {
  /** `#698` R3:给真实 admission 成功响应挂一条具名 warning,验证它到达用户面。 */
  injectInstallWarning?: string
  /** `#765`:同样的把戏挂在**另一条** IPC 上(整包卸载)。这条路径在生产代码里
   *  **没有任何一行 warning 呈现** —— 它绿,只可能是因为咽喉在 IPC 包装层干了活。 */
  injectUninstallWarning?: string
  preauthorized?: boolean
  failConfirmationOnce?: boolean
  failPreviewOnce?: boolean
  rejectPreviewOnce?: boolean
  /** REQ-235:追加一个 root 档案为 cloud@1 的签名包(其余夹具与断言不变)。 */
  withCloud?: boolean
}) {
  dataLayerPackageUninstalls.length = 0
  const fixture = await packageFixture({ withCloud: options?.withCloud })
  const tmp = mkdtempSync(join(tmpdir(), "package-renderer-wiring-"))
  const globalRoot = join(tmp, "codepuppy-state", "env", "dev")
  const userData = join(tmp, "user-data")
  mkdirSync(globalRoot, { recursive: true })
  const previousRoot = process.env.CODEPUPPY_GLOBAL_DIR
  process.env.CODEPUPPY_GLOBAL_DIR = globalRoot
  if (options?.preauthorized)
    writeCapabilityGrantSync(globalRoot, {
      v: 1,
      key: "mcp--generic-remote",
      capabilities: ["codepuppy.secret-prerequisite.v1"],
      txId: "preauthorized",
      grantedAt: "2026-07-31T00:00:00.000Z",
    })
  const admissionDeps = {
    loadVerifiedCatalog: async () => ({
      source: "remote",
      catalog: fixture.raw.source === "none" ? {} : fixture.raw.catalog,
      snapshotDigest: "a".repeat(64),
    }),
    root: () => globalRoot,
    userDataPath: userData,
    // `#828`:skill 载荷经验证共享 CAS 落 generation。测试里 CAS 与 userData 同根即可。
    casBaseRoot: () => userData,
    environment: () => "dev",
    installability: { fetchPayload: fixture.fetchPayload },
    fetchAsset: fixture.fetchAsset,
    secretVersionId: () => "v-0badcafe",
    now: () => new Date("2026-07-31T12:00:00.000Z"),
    advisoryGate: () => ({ allowed: true as const }),
    resolvePackage: async (id: string, version: string) => ({ ...resolveVerifiedPackageV1(fixture.raw.source === "none" ? {} : fixture.raw.catalog, id, version), channel: "cache" as const }),
  }
  const admitPackage = createPackageAdmissionCoordinator(admissionDeps)
  const handlers = new Map<string, Handler>()
  const refresh = () =>
    evaluateRemoteCatalogPackages(fixture.raw, {
      packageEvaluator: fixture.evaluator,
    })
  registerPackageCatalogReadIpcHandlers(
    (channel, handler) => handlers.set(channel, handler),
    refresh,
  )

  const searchResults: SourceSearchResultV1[] = []
  const sourceProgress = new Set<(id: string, result: SourceSearchResultV1) => void>()
  const sources = createPluginSources({
    catalog: async () => {
      const result = await refresh()
      return result.source === "none" ? [] : (result.packageViews ?? [])
        .filter(view => view.verdict === "compatible")
        .map(view => ({ id: view.catalogId, source: "catalog" as const, name: view.presentation.displayName, displayName: view.presentation.displayName, description: view.presentation.description, kind: "plugin" as const, upstream: { version: view.presentation.version } }))
    },
    fetch: fixtureFetch,
  })

  injectInstallWarning = options?.injectInstallWarning ?? null
  injectUninstallWarning = options?.injectUninstallWarning ?? null
  const browseResults: unknown[] = []
  const detailResults: unknown[] = []
  const installIntents: unknown[] = []
  const installResults: unknown[] = []
  let failConfirmation = options?.failConfirmationOnce ?? false
  let failPreview = options?.failPreviewOnce ?? false
  let rejectPreview = options?.rejectPreviewOnce ?? false
  let updateChecks = 0
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      updater: {
        check: async () => {
          updateChecks++
        },
      },
      auth: {
        start: async () => {},
      },
      ext: {
        sourcesSearch: async (query: string, requestId: string) => {
          const result = await sources.searchSources(query, partial => {
            for (const listener of sourceProgress) listener(requestId, partial)
          })
          searchResults.push(result)
          return result
        },
        onSourcesSearchProgress: (listener: (id: string, result: SourceSearchResultV1) => void) => {
          sourceProgress.add(listener)
          return () => sourceProgress.delete(listener)
        },
        remoteCatalog: async () => {
          const result = await handlers.get("ext-remote-catalog")!(undefined)
          browseResults.push(result)
          return result
        },
        packageDetail: async (catalogId: string) => {
          const result = await handlers.get(PACKAGE_DETAIL_IPC_CHANNEL)!(undefined, catalogId)
          detailResults.push(result)
          return result
        },
        installedPackages: async () => {
          const state = readPackageLedgerStateV1(globalRoot)
          if (!state.ok) return { ok: false, reason: state.reason }
          return { ok: true, packages: state.packageGraphs.map((graph) => {
            const nodes = [graph.root, ...graph.children]
            const record = (kind: string, name: string) => state.records.find((entry) => entry.kind === kind && entry.name === name)!
            return { packageId: graph.packageId, installedGraphDigest: graph.installedGraphDigest, displayName: graph.displayName ?? null, rootComponentName: graph.root.name, origin: record(graph.root.kind, graph.root.name).origin, version: record(graph.root.kind, graph.root.name).version ?? null, desiredState: record(graph.root.kind, graph.root.name).desiredState, components: nodes.map((node) => ({ componentId: node.componentId, kind: node.kind, name: node.name, required: node.required, desiredState: record(node.kind, node.name).desiredState })) }
          }) }
        },
        packageAuthorization: (packageId: string) => readPackageAuthorizationV1(packageId, admissionDeps),
        savePackageSecrets: (intent: unknown) => savePackageSecretsV1(intent, admissionDeps),
        setPackageState: (intent: unknown) => setPackageStateV1(intent, { ...admissionDeps, globalRoot: admissionDeps.root }),
        installPackage: async (packageId: string) => {
          installIntents.push({ catalogId: packageId })
          if (rejectPreview) { rejectPreview = false; throw new Error("package renderer transport failed") }
          if (failPreview) { failPreview = false; const result = { ok: false, reason: "package renderer install unavailable" }; installResults.push(result); return result }
          const result = await installDesktopPackageV1(packageId, admissionDeps)
          // This renderer boundary models the settled automatic activation; real return ordering is tested through IPC.
          if (result.ok) await setPackageStateV1({ packageId, state: "enabled" }, { ...admissionDeps, globalRoot: admissionDeps.root })
          const withWarning = injectInstallWarning && result.ok ? { ...result, warning: injectInstallWarning } : result
          installResults.push(withWarning)
          if (result.ok) fixture.complete(packageId)
          return withWarning
        },
        installCatalog: async (intent: unknown) => {
          installIntents.push(intent)
          if (
            rejectPreview &&
            typeof intent === "object" &&
            intent !== null &&
            !("authorization" in intent)
          ) {
            rejectPreview = false
            throw new Error("package renderer transport failed")
          }
          if (
            failPreview &&
            typeof intent === "object" &&
            intent !== null &&
            !("authorization" in intent)
          ) {
            failPreview = false
            const result = { ok: false as const, reason: "package renderer preview unavailable" }
            installResults.push(result)
            return result
          }
          const result = await runCatalogInstallWithPackagePreflight(intent, {
            loadVerifiedCatalog: async () => ({
              source: "remote",
              catalog: fixture.raw.source === "none" ? {} : fixture.raw.catalog,
            }),
            installLegacy: async () => {
              throw new Error("package renderer intent fell through to legacy planner")
            },
            installPackage: async (packageIntent) => {
              if (
                failConfirmation &&
                typeof packageIntent === "object" &&
                packageIntent !== null &&
                "authorization" in packageIntent
              ) {
                failConfirmation = false
                const broken = structuredClone(packageIntent) as {
                  authorization: { binding: unknown }
                }
                return admitPackage({
                  ...broken,
                  authorization: { binding: broken.authorization.binding, confirmed: {} },
                })
              }
              return admitPackage(packageIntent)
            },
            evaluator: fixture.evaluator,
          })
          // `#698` R3:把一条具名 warning 挂在**真实** admission 成功响应上,验证它一路到达用户面。
          // 后端此刻已经诚实(离场组件停用了、残留没删掉会带 warning),但 hub 曾把它整个丢掉 ——
          // 「诚实只诚实到 IPC 边界」对用户不成立。
          const withWarning =
            injectInstallWarning && typeof result === "object" && result !== null && "ok" in result && result.ok === true
              ? { ...result, warning: injectInstallWarning }
              : result
          installResults.push(withWarning)
          if (
            typeof result === "object" &&
            result !== null &&
            "ok" in result &&
            result.ok === true &&
            typeof intent === "object" &&
            intent !== null &&
            "catalogId" in intent &&
            typeof intent.catalogId === "string"
          )
            fixture.complete(intent.catalogId)
          return withWarning
        },
        // `#698`:详情页的「移除此扩展包」由这两条读/写决定是否出现、按下去做什么。两条都接
        // **生产实现**(不是常量桩):否则「装完之后按钮会出现」就成了一句没人验证的话。
        packageInstalled: async (catalogId: string) => {
          const state = readPackageLedgerStateV1(globalRoot)
          if (!state.ok) return { ok: false as const, reason: state.reason }
          const graph = state.packageGraphs.find((candidate) => candidate.packageId === catalogId)
          if (!graph) return { installed: false as const }
          return {
            installed: true as const,
            packageId: graph.packageId,
            installedGraphDigest: graph.installedGraphDigest,
            components: [graph.root, ...graph.children].map((node) => ({
              componentId: node.componentId,
              kind: node.kind as string,
              name: node.name,
              required: node.required,
            })),
          }
        },
        uninstallPackage: async (packageId: string) => {
          const result = await uninstallPackageV1(packageId, {
            globalRoot: () => globalRoot,
            installers: {
              removeFsInstall: () => ({ ok: true as const, files: [] }),
              removeMcpConfig: () => ({ ok: true as const }),
              removeCommandConfig: () => ({ ok: true as const }),
              removeMcpSecretsStrict: () => ({ ok: true as const }),
              releaseCodePuppyConnectionBindings: () => ({ ok: true as const }),
              removeInstallGrants: () => ({ ok: true as const, removed: [] }),
              removePluginPath: () => ({ ok: true as const }),
            },
          })
          // `#765`:真实成功响应 + 一条具名 warning(生产里就是「连接绑定没释放干净」那种)。
          return injectUninstallWarning && result.ok
            ? { ...result, warning: injectUninstallWarning }
            : result
        },
        // D6 片 6b:本机文件条目(preload 的生产形状);本文件不验它,给空列表。
        nativeSources: async (_projectDir?: string) => ({ ok: true as const, rows: [] }),
        setNativeSourceState: async () => ({ ok: true as const }),
        inventoryView: async () => undefined,
        advisoryActive: async () => ({ ids: [], fresh: true }),
        migrateScan: async () => ({
          enabled: false,
          inventory: { skills: [], mcp: [], plugins: [] },
        }),
        onSessionGrantsEnded: () => () => {},
        // preload 的 ext.onHubViewChanged(preload/types.ts);已安装包行订阅它重读授权状态,这里没有主进程推送。
        onHubViewChanged: () => () => {},
      },
    },
  })

  // `#1594`:扩展包与 Code Puppy 云两组都在连接器页(原「推荐」「云能力」页已收进来)。
  setHubSection("connectors")
  const root = document.createElement("div")
  root.id = "root"
  root.className = "a-ui"
  document.body.append(root)
  // 真实的 toast 视口 —— `flash()` 走 pushToast,不挂视口就什么都渲染不出来。
  // 断言必须落在**用户真能看到的 DOM** 上,而不是「hub 调过 flash」这种内部事实。
  disposals.push(render(() => createComponent(ToastViewport, {}), document.body.appendChild(document.createElement("div"))))
  const dispose = render(
    () =>
      createComponent(ExtensionHub, {
        server: () => undefined,
        open: () => true,
        onClose: () => {},
      }),
    root,
  )
  disposals.push(dispose)
  disposals.push(() => {
    if (previousRoot === undefined) delete process.env.CODEPUPPY_GLOBAL_DIR
    else process.env.CODEPUPPY_GLOBAL_DIR = previousRoot
    rmSync(tmp, { recursive: true, force: true })
  })
  await waitFor(() => {
    expect(browseResults.length).toBeGreaterThan(0)
    expectInstallablePackageCards(options?.withCloud ? [CLOUD_PACKAGE_ID] : [])
  })
  return {
    browseResults,
    searchResults,
    detailResults,
    installIntents,
    installResults,
    globalRoot,
    userData,
    updateChecks: () => updateChecks,
  }
}

const flush = () => new Promise((resolvePromise) => setTimeout(resolvePromise, 0))

async function waitFor(assertion: () => void) {
  let failure: unknown
  for (let attempt = 0; attempt < 80; attempt++) {
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

/** 用户真读得到的 toast 里,提到这条 canary 的有几条。判「恰好一条」用它,不判「有没有」。 */
function toastsContaining(canary: string): number {
  return Array.from(document.querySelectorAll(".a-toast"), (node) => node.textContent ?? "").filter((text) =>
    text.includes(canary),
  ).length
}

/** 同上,但只数**常驻**的那些(`data-persistent` 与「装没装拆除定时器」同源,见 Toast.tsx)。 */
function persistentToastsContaining(canary: string): number {
  return Array.from(document.querySelectorAll(".a-toast[data-persistent='true']"), (node) => node.textContent ?? "").filter(
    (text) => text.includes(canary),
  ).length
}

const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

const unavailablePackageIds = [
  "package:renderer-update",
  "package:renderer-blocked",
  "package:renderer-payload-blocked",
]

// https://github.com/jinjunnn/alpha-web/issues/255 裁决第 1 条取代「分类里可看不可装」旧契约。
function expectInstallablePackageCards(extra: string[] = []) {
  const ids = Array.from(
    document.querySelectorAll("[data-package-card]"),
    (card) => card.getAttribute("data-package-card"),
  )
  expect(ids).toHaveLength(3 + extra.length)
  expect(ids).toEqual(["package:renderer-ready", "package:renderer-prerequisite", MIXED_BUNDLE_PACKAGE_ID, ...extra])
  for (const id of unavailablePackageIds) {
    expect(document.querySelector(`[data-package-card='${id}']`)).toBeNull()
    expect(document.querySelector(`[data-package-detail='${id}']`)).toBeNull()
  }
}

function packageCard(catalogId: string) {
  const card = document.querySelector<HTMLElement>(`[data-package-card="${catalogId}"]`)
  expect(card).toBeInstanceOf(HTMLElement)
  return card!
}

function click(element: Element | null) {
  expect(element).toBeInstanceOf(HTMLElement)
  ;(element as HTMLElement).click()
}

function packageAuthorizationDialog() {
  const body = document.querySelector<HTMLElement>("[data-package-authorization]")
  expect(body).toBeInstanceOf(HTMLElement)
  const dialog = body!.closest<HTMLElement>("[role='dialog']")
  expect(dialog).toBeInstanceOf(HTMLElement)
  return dialog!
}

function expectDialogContract(
  dialog: HTMLElement,
  expected: { capabilities: string[]; prerequisite?: string },
) {
  expect(
    Array.from(dialog.querySelectorAll(".codepuppy-ext-authz-id"), (item) => item.textContent),
  ).toEqual(expected.capabilities)
  expect(
    Array.from(dialog.querySelectorAll("[data-kind='new']"), (item) => item.textContent),
  ).toEqual(expected.capabilities.map(() => zh["codepuppy.ext.authz.chipNew"]))
  const input = dialog.querySelector<HTMLInputElement>(".codepuppy-ext-key-input")
  const button = dialog.querySelector<HTMLButtonElement>(".a-dialog-footer .a-btn:last-child")
  expect(button).toBeInstanceOf(HTMLButtonElement)
  if (!expected.prerequisite) {
    expect(input).toBeNull()
    expect(button!.disabled).toBe(false)
    return
  }
  expect(dialog.querySelector(".codepuppy-ext-key-name")?.textContent).toBe(expected.prerequisite)
  expect(input).toBeInstanceOf(HTMLInputElement)
  expect(input!.type).toBe("password")
  expect(input!.placeholder).toBe(zh["codepuppy.ext.packageKeyPlaceholder"])
  expect(dialog.querySelector(".codepuppy-ext-confirm-keys .codepuppy-ext-confirm-line")?.textContent).toBe(
    zh["codepuppy.ext.packageConfirmEnv"],
  )
  expect(dialog.querySelector(".codepuppy-ext-confirm-keys [role='status']")?.textContent).toBe(
    zh["codepuppy.ext.packageKeysRequired"],
  )
  expect(button!.disabled).toBe(true)
  input!.value = "   "
  input!.dispatchEvent(new Event("input", { bubbles: true }))
  expect(dialog.querySelector(".codepuppy-ext-confirm-keys [role='status']")?.textContent).toBe(
    zh["codepuppy.ext.packageKeysRequired"],
  )
  expect(button!.disabled).toBe(true)
  input!.value = " dialog-contract-secret "
  input!.dispatchEvent(new Event("input", { bubbles: true }))
  expect(dialog.querySelector(".codepuppy-ext-confirm-keys [role='status']")).toBeNull()
  expect(button!.disabled).toBe(false)
}

const waitForPackageAuthorization = (catalogId: string) =>
  waitFor(() =>
    expect(document.querySelector(`[data-package-authorization='${catalogId}']`)).toBeInstanceOf(
      HTMLElement,
    ),
  )

/** 用户把 canary 打进去的那**一个**输入框。canary 扫描只准对这个元素致盲,见 expectNoCanaryAnywhere。 */
let filledSecretInput: HTMLInputElement | null = null

function fillPackageSecret(value: string) {
  const input = packageAuthorizationDialog().querySelector<HTMLInputElement>(".codepuppy-ext-key-input")
  expect(input).toBeInstanceOf(HTMLInputElement)
  input!.value = value
  input!.dispatchEvent(new Event("input", { bubbles: true }))
  filledSecretInput = input!
}

function confirmPackageAuthorization() {
  const dialog = packageAuthorizationDialog()
  const button = dialog.querySelector<HTMLButtonElement>(".a-dialog-footer .a-btn:last-child")
  expect(button).toBeInstanceOf(HTMLButtonElement)
  expect(button!.disabled).toBe(false)
  click(button)
  expect(dialog.getAttribute("aria-busy")).toBe("true")
  expect(button!.disabled).toBe(true)
  expect(dialog.querySelector(".a-dialog-close")).toBeNull()
}

function cancelPackageAuthorization() {
  click(packageAuthorizationDialog().querySelector(".a-dialog-footer .a-btn:first-child"))
}

const consoleMethods = ["log", "warn", "error", "info", "debug"] as const

function captureConsole() {
  const output: unknown[] = []
  const originals = consoleMethods.map((method) => console[method])
  consoleMethods.forEach((method) => {
    console[method] = (...values: unknown[]) => {
      output.push(...values)
    }
  })
  return {
    output,
    restore: () =>
      consoleMethods.forEach((method, index) => {
        console[method] = originals[index]!
      }),
  }
}

/**
 * 展开成可扫描的字符串。带深度预算继续下潜 —— 只看一层的话,
 * `console.debug("intent", { catalogId, grants: { secrets } })` 这种最像真实回归的形状会整个溜掉。
 * `Error` 取 message:`console.error(new Error(secret))` 同理不能漏。
 */
function ownScalarValues(value: unknown, depth = 4): string[] {
  if (value === null || value === undefined) return []
  if (typeof value !== "object") return typeof value === "function" ? [] : [String(value)]
  if (depth <= 0) return []
  if (value instanceof Error) return [value.message, ...ownScalarValues({ ...value }, depth - 1)]
  if (value instanceof Map)
    return Array.from(value.entries()).flatMap(([k, v]) => [
      ...ownScalarValues(k, depth - 1),
      ...ownScalarValues(v, depth - 1),
    ])
  if (value instanceof Set) return Array.from(value).flatMap((v) => ownScalarValues(v, depth - 1))
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return []
  return Reflect.ownKeys(value).flatMap((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !("value" in descriptor)) return [String(key)]
    return [String(key), ...ownScalarValues(descriptor.value, depth - 1)]
  })
}

function expectNoCanaryAnywhere(canary: string, consoleOutput: unknown[]) {
  // 遮蔽是必要的:用户刚打进去的 canary 就在那个框里,不遮蔽会自己撞自己。
  // 但只准遮蔽**用户真正写入的那一个元素**,不能按 `.codepuppy-ext-key-input[type=password]`
  // 选择器一刀切 —— 那恰好是唯一合法装密钥的 class,生产若把明文渲进第二个同 class 的框,
  // 扫描器会先把它一并清空,泄漏就此隐形(「破坏它 = 破坏观测它」)。
  // 按身份遮蔽之后,任何**别的**元素带着 canary 都会被下面的属性/value 扫描抓到。
  const masked = filledSecretInput?.isConnected ? filledSecretInput : null
  const maskedValue = masked?.value
  if (masked) masked.value = ""
  try {
    document.querySelectorAll("*").forEach((element) => {
      Array.from(element.attributes).forEach((attribute) =>
        expect(attribute.value).not.toContain(canary),
      )
      const value = Reflect.get(element, "value")
      if (typeof value === "string") expect(value).not.toContain(canary)
    })
    expect(document.body.innerHTML).not.toContain(canary)
    consoleOutput.forEach((value) =>
      expect(ownScalarValues(value).join("\n")).not.toContain(canary),
    )
    Reflect.ownKeys(globalThis).forEach((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
      expect(
        descriptor && "value" in descriptor
          ? [String(key), ...ownScalarValues(descriptor.value)].join("\n")
          : String(key),
      ).not.toContain(canary)
    })
  } finally {
    if (masked && maskedValue !== undefined) masked.value = maskedValue
  }
}

function expectSafeView(value: unknown) {
  const view = value as CatalogPackageViewV1
  expect(Object.keys(view).sort()).toEqual([
    "action",
    "catalogId",
    "components",
    "prerequisites",
    "presentation",
    "verdict",
  ])
  for (const component of view.components)
    expect(Object.keys(component).sort()).toEqual([
      "componentId",
      "included",
      "required",
      "role",
      "skipReasonCode",
    ])
  expect(Object.keys(view.action).sort()).toEqual(["enabled", "kind", "reasonCode"])
  expect(Object.keys(view.prerequisites).sort()).toEqual(["items", "status"])
  for (const item of view.prerequisites.items)
    expect(Object.keys(item).sort()).toEqual(["label", "prerequisiteId", "required"])
  expect(Object.keys(view.presentation).sort()).toEqual([
    "description",
    "displayName",
    "version",
  ])
}

afterEach(() => {
  // `#771`:咽喉推的 warning toast 现在是**常驻**的 —— 它不会自己走,而 toast store 是模块
  // 单例,`replaceChildren()` 只擦 DOM 不清 store。不在这里排空,下一条用例挂上新视口时会把
  // 上一条留下的 toast 一起渲染出来。走用户真实的关闭路径(点 ×),不去碰 store 内部。
  for (const close of document.body.querySelectorAll<HTMLElement>(".a-toast-x")) close.click()
  disposals.splice(0).forEach((dispose) => dispose())
  document.body.replaceChildren()
})
afterAll(() => GlobalRegistrator.unregister())

async function installDirect(harness: Awaited<ReturnType<typeof mountHarness>>, id = "package:renderer-ready") {
  click(packageCard(id).querySelector("button"))
  await waitFor(() => expect(harness.installResults.at(-1)).toMatchObject({ ok: true }))
  await waitFor(() => expect(document.querySelector(`[data-installed-package="${id}"]`)).toBeInstanceOf(HTMLElement))
}
async function openManagement(id: string) {
  click(document.querySelector(`[data-installed-package="${id}"] [data-more]`))
  click(document.querySelector('[data-menu-item="manage"]'))
  await waitFor(() => expect(document.querySelector('[data-package-detail]')?.textContent).toContain(zh["codepuppy.ext.packagePermissions"]))
}
async function removeManaged() {
  click(document.querySelector('[data-package-detail] [data-more]'))
  click(document.querySelector('[data-menu-item="remove-package"]'))
}
async function openToken() {
  // 账户段只在读到账户项之后才画 —— 先等它出现再点。
  await waitFor(() => expect(document.querySelector('[data-package-secret]')).toBeInstanceOf(HTMLElement))
  click(document.querySelector('[data-package-secret]'))
  await waitFor(() => expect(document.querySelector('input[type="password"]')).toBeInstanceOf(HTMLInputElement))
}
function fillManagementToken(value: string) {
  filledSecretInput = document.querySelector<HTMLInputElement>('input[type="password"]')!
  filledSecretInput.value = value
  filledSecretInput.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("package detail production renderer path", () => {
  test("registered catalog read handlers feed the real card and detail with safe-view values only", async () => {
    const harness = await mountHarness()
    const browse = harness.browseResults.at(-1) as {
      catalog: { packages: CatalogPackageViewV1[] }
    }
    expect(Object.keys(browse).sort()).toEqual([
      "catalog",
      "channel",
      "fetchedAt",
      "source",
      "version",
      "via",
    ])
    expect(Object.keys(browse.catalog).sort()).toEqual(["entries", "packages", "version"])
    browse.catalog.packages.forEach(expectSafeView)

    for (const expected of [
      {
        catalogId: "package:renderer-ready",
        verdict: "compatible",
        prerequisite: "ready",
        action: "+",
      },
      {
        catalogId: "package:renderer-prerequisite",
        verdict: "compatible",
        prerequisite: "required-action",
        action: "+",
      },
      {
        catalogId: "package:renderer-update",
        verdict: "update-required",
        prerequisite: "ready",
        action: zh["codepuppy.ext.packageActionUpdateCodePuppy"],
      },
      {
        catalogId: "package:renderer-blocked",
        verdict: "blocked",
        prerequisite: "ready",
        action: zh["codepuppy.ext.packageActionNone"],
      },
      {
        catalogId: "package:renderer-payload-blocked",
        verdict: "blocked",
        prerequisite: "ready",
        action: zh["codepuppy.ext.packageActionNone"],
      },
      {
        catalogId: MIXED_BUNDLE_PACKAGE_ID,
        verdict: "compatible",
        prerequisite: "required-action",
        action: "+",
      },
    ]) {
      const view = browse.catalog.packages.find((view) => view.catalogId === expected.catalogId)
      expect(view).toMatchObject({
        catalogId: expected.catalogId,
        verdict: expected.verdict,
        prerequisites: { status: expected.prerequisite },
      })
      if (expected.verdict !== "compatible") {
        expect(view!.action.kind).toBe(expected.verdict === "update-required" ? "update-codepuppy" : "none")
        expect(document.querySelector(`[data-package-card='${expected.catalogId}']`)).toBeNull()
        continue
      }
      // `#1594` AC3:行上只有名称、一行描述、一个动作 —— 兼容判定与前置状态不再是行上的标签,只留作行的属性。
      const card = packageCard(expected.catalogId)
      expect({
        catalogId: card.getAttribute("data-package-card"),
        prerequisite: card.getAttribute("data-prerequisite"),
        action: card.querySelector("button[data-iact]") ? "+" : card.querySelector("button")?.textContent?.trim(),
      }).toEqual({ catalogId: expected.catalogId, prerequisite: expected.prerequisite, action: expected.action })
      expect(card.querySelectorAll("button")).toHaveLength(1)
      expect(card.querySelector("[data-verdict], .codepuppy-ext-package-state, .codepuppy-ext-chip, .codepuppy-ext-meta")).toBeNull()
      // `#1594` AC6:前置条件未就绪 ⇒ 描述换成缺什么(逐项取 main 安全视图的 label),动作是「设置」;
      // 「需要先处理」「处理前置条件」不再出现在行上。
      expect(card.querySelector(".codepuppy-ext-kit-desc")?.textContent).toBe(view!.presentation.description)
      expect(card.textContent).not.toContain("需要先处理")
      expect(card.textContent).not.toContain("处理前置条件")
    }

    const search = document.querySelector<HTMLInputElement>(".codepuppy-ext-search input")
    expect(search).toBeInstanceOf(HTMLInputElement)
    search!.value = "Renderer Update Package"
    search!.dispatchEvent(new Event("input", { bubbles: true }))
    await waitFor(() =>
      expect(
        Array.from(document.querySelectorAll("[data-package-card]")).map(
          (card) => card.getAttribute("data-package-card"),
        ),
      ).toEqual([]),
    )
    await waitFor(() => expect(harness.searchResults.at(-1)).toMatchObject({ query: "Renderer Update Package", candidates: [] }))
    expect(harness.searchResults.at(-1)!.sources).toHaveLength(5)
    expect(document.querySelector('[data-source-candidate="package:renderer-update"]')).toBeNull()
    expect(document.querySelector("[data-package-detail='package:renderer-update']")).toBeNull()
    search!.value = "Generic Remote MCP"
    search!.dispatchEvent(new Event("input", { bubbles: true }))
    // Existing unified-search debounce is 250ms; observe its actual source rows.
    await sleep(300)
    await waitFor(() => expect(Array.from(document.querySelectorAll("[data-source-candidate]"), row => row.getAttribute("data-source-candidate")))
      .toEqual(["package:renderer-ready", "package:renderer-prerequisite"]))
    search!.value = ""
    search!.dispatchEvent(new Event("input", { bubbles: true }))
    await waitFor(expectInstallablePackageCards)

    click(packageCard("package:renderer-ready"))
    await waitFor(() =>
      expect(
        document.querySelector("[data-package-detail='package:renderer-ready']"),
      ).toBeInstanceOf(HTMLElement),
    )
    await waitFor(() => expect(harness.detailResults.length).toBeGreaterThan(0))
    expectSafeView(harness.detailResults.at(-1))

    const safeWire = JSON.stringify({
      packages: browse.catalog.packages,
      detail: harness.detailResults.at(-1),
    })
    for (const forbidden of [
      "payloadRef",
      "headersTemplate",
      "requiredSecrets",
      "REQ128_RENDERER_SECRET_CANARY",
      "REQ128_RENDERER_PAYLOAD_CANARY",
      "https://",
    ])
      expect(safeWire).not.toContain(forbidden)

    const detail = document.querySelector("[data-package-detail]")!
    expect(detail.querySelector("h2")?.textContent).toBe("Generic Remote MCP")
    expect(detail.querySelector(".codepuppy-ext-dabout")?.textContent).toBe(
      "Generic Phase 1 compiler corpus input.",
    )
    expect(detail.querySelector(".codepuppy-ext-dhead-t .codepuppy-ext-chip")?.textContent).toBe(
      zh["codepuppy.ext.packageSourceRemote"],
    )
    expect(detail.querySelector(".codepuppy-ext-dhead-meta span")?.textContent?.trim()).toBe(
      `${zh["codepuppy.ext.detailVersion"]} 1.0.0`,
    )
    expect(
      Array.from(detail.querySelectorAll(".codepuppy-ext-dsec-t")).map(
        (heading) => heading.textContent,
      ),
    ).toEqual([
      zh["codepuppy.ext.detailAbout"],
      zh["codepuppy.ext.packageInstallability"],
      zh["codepuppy.ext.packageComponentsTitle"],
      zh["codepuppy.ext.packageReasonTitle"],
      zh["codepuppy.ext.packageActions"],
    ])
    expect(
      Array.from(detail.querySelectorAll(".codepuppy-ext-dsec")).map(
        (section) => section.textContent,
      ),
    ).toEqual([
      expect.stringContaining("Generic Phase 1 compiler corpus input."),
      expect.stringContaining(
        zh["codepuppy.ext.packageVerdictCompatible"],
      ),
      expect.stringContaining(
        zh["codepuppy.ext.packagePrerequisiteReady"],
      ),
      expect.stringContaining(
        zh["codepuppy.ext.packageReasonCompatible"],
      ),
      expect.stringContaining(
        zh["codepuppy.ext.packageActionInstall"],
      ),
    ])

  })

  /**
   * `#697` 第 5 跳 + 第二个 preview 面。`#749` 让安全视图带上了逐组件的 `components[]`
   * (含 `skipReasonCode`),但在此之前 renderer **一处都没渲染**:`rg skipReasonCode
   * packages/ui-mac/src/renderer` 零命中,三个 skip token 在 en/zh 里没有任何文案。于是
   * 「让用户在每一步被告知同一件事」在任何一步都没兑现。
   *
   * 这条用例走的是生产 ExtensionHub → ExtensionDetail → 授权确认屏,断言的是**用户看得到的
   * 那句话**:不会安装的组件出现在详情页与确认屏,并带着同一个具名原因。
   */
  test("detail lists every component and skipped reason while plus no longer opens an installation wall", async () => {
    const harness = await mountHarness()
    click(packageCard(MIXED_BUNDLE_PACKAGE_ID))
    await waitFor(() => expect(document.querySelector('[data-package-detail]')).toBeInstanceOf(HTMLElement))
    const rows = Array.from(document.querySelectorAll('[data-package-component]'))
    expect(rows.map((row) => row.getAttribute('data-package-component'))).toEqual([ROOT_AGENT_ID, LEAF_SKILL_ID, LEAF_MCP_ID, LEAF_COMMAND_ID, LEAF_UNSUPPORTED_ID])
    // ② 「会装 / 不会装」是**用户能读到的中文**,不是一个 data 属性(属性可以在没有任何文案的
    //    情况下写对 —— 那正是 `#749` 之后的现状)。
    const stateText = (row: HTMLElement) =>
      row.querySelector(".codepuppy-ext-package-component-state")?.textContent
    expect(rows.map(stateText)).toEqual([
      zh["codepuppy.ext.packageComponentIncluded"],
      zh["codepuppy.ext.packageComponentIncluded"],
      zh["codepuppy.ext.packageComponentIncluded"],
      zh["codepuppy.ext.packageComponentIncluded"],
      zh["codepuppy.ext.packageComponentSkipped"],
    ])
    expect(rows.map((row) => row.querySelector(".codepuppy-ext-package-component-req")?.textContent)).toEqual([
      zh["codepuppy.ext.packageRequired"],
      zh["codepuppy.ext.packageRequired"],
      zh["codepuppy.ext.packageOptional"],
      zh["codepuppy.ext.packageOptional"],
      zh["codepuppy.ext.packageOptional"],
    ])

    // ③ 被跳过的那一行有**具名原因**,且原因文案非空、来自 decoder 的 token。
    const why = rows[4]!.querySelector<HTMLElement>(".codepuppy-ext-package-component-why")
    expect(why).toBeInstanceOf(HTMLElement)
    expect(why!.getAttribute("data-skip-reason")).toBe(EXPECTED_SKIP_REASON)
    expect(why!.textContent).toBe(zh["codepuppy.ext.packageSkipCapabilityUnsupported"])
    expect(why!.textContent!.trim()).not.toBe("")
    // 会安装的四行不得出现任何原因段(「所有行都显示原因」是另一种假绿)。
    expect(rows.slice(0, 4).map((row) => row.querySelector(".codepuppy-ext-package-component-why"))).toEqual([
      null,
      null,
      null,
      null,
    ])
    click(document.querySelector('.codepuppy-ext-crumb-link'))
    click(packageCard("package:renderer-ready").querySelector('button'))
    await waitFor(() => expect(harness.installResults.at(-1)).toMatchObject({ ok: true }))
    expect(document.querySelector('[data-package-authorization]')).toBeNull()
    expect(document.body.textContent).not.toContain(zh["codepuppy.ext.confirmInstall"])
  })

  test("a named warning on direct package install reaches the user surface", async () => {
    const harness = await mountHarness({ injectInstallWarning: "PACKAGE_INSTALL_WARNING_r2" })
    await installDirect(harness)
    expect(harness.installResults.at(-1)).toMatchObject({ ok: true, warning: "PACKAGE_INSTALL_WARNING_r2" })
    await waitFor(() => expect(toastsContaining(zh["codepuppy.ext.error.warningUnknown"])).toBe(1))
    expect(persistentToastsContaining(zh["codepuppy.ext.error.warningUnknown"])).toBe(1)
    await flush()
    expect(toastsContaining(zh["codepuppy.ext.error.warningUnknown"])).toBe(1)
  })

  test("a named warning on package removal reaches the user once from the management menu", async () => {
    const harness = await mountHarness({ injectUninstallWarning: "PACKAGE_REMOVE_WARNING_r2" })
    await installDirect(harness)
    await openManagement("package:renderer-ready")
    await removeManaged()
    await waitFor(() => expect(readPackageGraphs(harness.globalRoot)).toEqual({ ok: true, packageGraphs: [] }))
    expect(dataLayerPackageUninstalls).toEqual(["package:renderer-ready"])
    await waitFor(() => expect(toastsContaining(zh["codepuppy.ext.error.warningUnknown"])).toBe(1))
    await flush()
    expect(toastsContaining(zh["codepuppy.ext.error.warningUnknown"])).toBe(1)
  })

  test("the uninstall warning stays put instead of expiring with the toast timer", async () => {
    const harness = await mountHarness({ injectUninstallWarning: "PERSISTENT_UNINSTALL_WARNING_2c8b4e" })
    await installDirect(harness)
    await openManagement("package:renderer-ready")
    await removeManaged()
    await waitFor(() => expect(readPackageGraphs(harness.globalRoot)).toEqual({ ok: true, packageGraphs: [] }))
    await waitFor(() => expect(persistentToastsContaining(zh["codepuppy.ext.error.warningUnknown"])).toBe(1))
    const control = "TRANSIENT_CONTROL_TOAST_9d10f7"
    pushToast({ kind: "info", title: control })
    expect(toastsContaining(control)).toBe(1)
    expect(persistentToastsContaining(control)).toBe(0)
    await sleep(4600)
    await flush()
    expect(toastsContaining(control)).toBe(0)
    expect(toastsContaining(zh["codepuppy.ext.error.warningUnknown"])).toBe(1)
  }, 20000)

  test("direct install exposes one package row and its menu removes the installed graph once", async () => {
    const harness = await mountHarness()
    await installDirect(harness)
    expect(readPackageLedgerStateV1(harness.globalRoot)).toMatchObject({ ok: true, packageGraphs: [{ packageId: "package:renderer-ready" }] })
    expect(document.querySelectorAll('[data-installed-package="package:renderer-ready"]')).toHaveLength(1)
    expect(document.querySelector('[data-package-card="package:renderer-ready"]')).toBeNull()
    await openManagement("package:renderer-ready")
    await removeManaged()
    await waitFor(() => expect(document.querySelector('[data-installed-package="package:renderer-ready"]')).toBeNull())
    expect(dataLayerPackageUninstalls).toEqual(["package:renderer-ready"])
  })

  test("detail plus commits once without preview authorization and returns the same package management page", async () => {
    const harness = await mountHarness()
    click(packageCard("package:renderer-ready"))
    await waitFor(() => expect(document.querySelector('[data-package-detail] .codepuppy-ext-dsub button')).toBeInstanceOf(HTMLElement))
    click(document.querySelector('[data-package-detail] .codepuppy-ext-dsub button'))
    await waitFor(() => expect(harness.installResults.at(-1)).toMatchObject({ ok: true }))
    await waitFor(() => expect(document.querySelector('[data-package-detail="package:renderer-ready"]')?.textContent).toContain(zh["codepuppy.ext.packagePermissions"]))
    // 名称下有说明行(冻结稿 #hub-manage),来源与列表行相同。
    expect(document.querySelector('[data-package-detail] .codepuppy-ext-dabout')?.textContent?.trim()).not.toBe("")
    // 没有账户 / 凭据的包不画账户段,也不显示「暂时无法读取账户状态」。
    expect(document.querySelector('[data-package-detail]')?.textContent).not.toContain(zh["codepuppy.ext.packageAccounts"])
    expect(document.querySelector('[data-package-detail]')?.textContent).not.toContain(zh["codepuppy.ext.packageAccountUnavailable"])
    expect(harness.installIntents).toEqual([{ catalogId: "package:renderer-ready" }])
    expect(document.querySelector('[data-package-authorization]')).toBeNull()
    const state = readPackageLedgerStateV1(harness.globalRoot)
    expect(state.ok && state.records.every((record) => record.desiredState === "enabled")).toBe(true)
  })

  test("installed secret entry writes the declared prerequisite to dedicated storage while off and on", async () => {
    for (const state of ["disabled", "enabled"] as const) {
      const harness = await mountHarness()
      await installDirect(harness, "package:renderer-prerequisite")
      await extensions.setPackageState({ packageId: "package:renderer-prerequisite", state })
      await openManagement("package:renderer-prerequisite")
      await waitFor(() => expect(document.querySelector('[data-package-detail]')?.textContent).toContain(zh["codepuppy.ext.packageAccounts"]))
      await openToken()
      fillManagementToken(secretCanary)
      expectNoCanaryAnywhere(secretCanary, consoleOutput)
      click(document.querySelector('[role="dialog"] .a-dialog-footer button'))
      await waitFor(() => expect(document.querySelector('input[type="password"]')).toBeNull())
      const versions = join(harness.userData, "codepuppy-mcp-secrets", "generic-remote")
      const version = readdirSync(versions)[0]!
      const file = join(versions, version, "A_KEY")
      expect(readFileSync(file, "utf8")).toBe(secretCanary)
      expect(statSync(file).mode & 0o777).toBe(0o600)
      expect(readFileSync(join(harness.globalRoot, "codepuppy.jsonc"), "utf8")).not.toContain(secretCanary)
      expectNoCanaryAnywhere(secretCanary, consoleOutput)
      const ledger = readPackageLedgerStateV1(harness.globalRoot)
      expect(ledger.ok && ledger.records[0]?.desiredState).toBe(state)
      expect(harness.installIntents).toHaveLength(1)
      for (const dispose of disposals.splice(0)) dispose()
      document.body.replaceChildren()
    }
  })

  test("existing capability grants do not add an installation confirmation", async () => {
    const harness = await mountHarness({ preauthorized: true })
    await installDirect(harness, "package:renderer-prerequisite")
    expect(harness.installIntents).toEqual([{ catalogId: "package:renderer-prerequisite" }])
    expect(JSON.stringify(harness.installIntents)).not.toContain("authorization")
    expect(document.querySelector('[data-package-authorization]')).toBeNull()
  })

  test("closing token entry clears transient input and leaves installed content ready to continue", async () => {
    const harness = await mountHarness()
    await installDirect(harness, "package:renderer-prerequisite")
    await openManagement("package:renderer-prerequisite")
    await openToken()
    const input = document.querySelector<HTMLInputElement>('input[type="password"]')!
    expect(input.value).toBe("")
    expect(input.required).toBe(false)
    expect(input.placeholder).toBe(zh["codepuppy.ext.packageTokenPlaceholder"])
    expect(document.querySelector<HTMLButtonElement>('[role="dialog"] .a-dialog-footer button')?.disabled).toBe(false)
    fillManagementToken(secretCanary)
    click(document.querySelector('[role="dialog"] .a-dialog-close'))
    await waitFor(() => expect(document.querySelector('input[type="password"]')).toBeNull())
    expect(readPackageLedgerStateV1(harness.globalRoot)).toMatchObject({ ok: true, packageGraphs: [{ packageId: "package:renderer-prerequisite" }] })
    expect(existsSync(join(harness.userData, "codepuppy-mcp-secrets", "generic-remote"))).toBe(false)
    await openToken()
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("")
    expectNoCanaryAnywhere(secretCanary, consoleOutput)
    expect(harness.installIntents).toHaveLength(1)
  })

  test("failed credential write leaves installed package and saved token unchanged without reinstalling", async () => {
    const harness = await mountHarness()
    await installDirect(harness, "package:renderer-prerequisite")
    await openManagement("package:renderer-prerequisite")
    await openToken()
    fillManagementToken(secretCanary)
    click(document.querySelector('[role="dialog"] .a-dialog-footer button'))
    await waitFor(() => expect(document.querySelector('input[type="password"]')).toBeNull())
    await openToken()
    fillManagementToken("invalid-replacement-canary-r2")
    click(document.querySelector('[role="dialog"] .a-dialog-footer button'))
    await waitFor(() => expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeInstanceOf(HTMLElement))
    expect(readFileSync(join(harness.userData, "codepuppy-mcp-secrets", "generic-remote", "v-0badcafe", "A_KEY"), "utf8")).toBe(secretCanary)
    expect(document.body.textContent).not.toContain("invalid-replacement-canary-r2")
    expect(harness.installIntents).toHaveLength(1)
  })

  test("direct install transport and declared failure render inline, leave no content and permit retry", async () => {
    for (const options of [{ rejectPreviewOnce: true }, { failPreviewOnce: true }]) {
      const harness = await mountHarness(options)
      click(packageCard("package:renderer-ready").querySelector('button'))
      await waitFor(() => expect(packageCard("package:renderer-ready").querySelector('[role="alert"]')).toBeInstanceOf(HTMLElement))
      expect(readPackageGraphs(harness.globalRoot)).toEqual({ ok: true, packageGraphs: [] })
      expect(document.querySelector('[data-package-authorization]')).toBeNull()
      await installDirect(harness)
      expect(harness.installIntents).toHaveLength(2)
      for (const dispose of disposals.splice(0)) dispose()
      document.body.replaceChildren()
    }
  })

  test("unavailable packages have no recommendation, category, search or detail entry and trigger no install/update IPC", async () => {
    const harness = await mountHarness()
    const browse = harness.browseResults.at(-1) as { catalog: { packages: CatalogPackageViewV1[] } }
    expect(browse.catalog.packages.find((view) => view.catalogId === "package:renderer-update")).toMatchObject({
      verdict: "update-required",
      presentation: { displayName: "Renderer Update Package", description: "Only this fixture carries this description." },
    })
    expect(
      browse.catalog.packages.find((view) => view.catalogId === "package:renderer-blocked")!.action.reasonCode,
    ).toBe("package-invalid")
    expect(
      browse.catalog.packages.find((view) => view.catalogId === "package:renderer-payload-blocked")!.action.reasonCode,
    ).toBe("package-payload-integrity")
    for (const section of ["connectors", "skills", "agents"] as const) {
      setHubSection(section)
      await flush()
      if (section === "connectors") expectInstallablePackageCards()
      const search = document.querySelector<HTMLInputElement>(".codepuppy-ext-search input")!
      for (const id of unavailablePackageIds) {
        expect(document.querySelector(`[data-package-card='${id}']`)).toBeNull()
        search.value = id
        search.dispatchEvent(new Event("input", { bubbles: true }))
        await waitFor(() => expect(document.querySelectorAll("[data-package-card]")).toHaveLength(0))
        expect(document.querySelector(`[data-package-detail='${id}']`)).toBeNull()
      }
      search.value = ""
      search.dispatchEvent(new Event("input", { bubbles: true }))
      await flush()
    }
    expect(harness.detailResults).toEqual([])
    expect(harness.installIntents).toEqual([])
    expect(harness.updateChecks()).toBe(0)
  })

  // REQ-235 AC1 客户端半场:一个 cloud@1 签名包在「云能力」分区与 legacy 云条目并列出现,点开后
  // 详情页按 main 投影的描述画表单。走的是真 hub 卡片 → 真 detail IPC → 生产 evaluator。
  test("a cloud capability package is listed in the cloud section beside legacy entries and its detail renders the described form", async () => {
    const harness = await mountHarness({ withCloud: true })
    const legacyCloud = bundledCatalog.entries.filter((entry) => entry.type === "cloud")
    expect(legacyCloud.length).toBeGreaterThan(0)
    setHubSection("connectors")
    await waitFor(() => expect(document.querySelector(`[data-package-card="${CLOUD_PACKAGE_ID}"]`)).toBeInstanceOf(HTMLElement))
    // `#1594`:原「云能力」页 = 连接器页的「Code Puppy 云」组。组里只有 cloud 包,不是把所有可装包都倒进来。
    expect(
      Array.from(document.querySelectorAll("[data-group='cloud'] [data-package-card]"), (card) => card.getAttribute("data-package-card")),
    ).toEqual([CLOUD_PACKAGE_ID])
    for (const entry of legacyCloud)
      expect(document.querySelector(`[data-group='cloud'] .codepuppy-ext-card b[title='${entry.name}']`), entry.id).toBeInstanceOf(HTMLElement)

    click(packageCard(CLOUD_PACKAGE_ID))
    await waitFor(() => expect(document.querySelector(`[data-package-detail="${CLOUD_PACKAGE_ID}"] [data-cloud-form]`)).toBeInstanceOf(HTMLElement))
    const form = document.querySelector<HTMLElement>("[data-cloud-form]")!
    expect(form.getAttribute("data-cloud-form")).toBe("example-generate")
    expect(Array.from(form.querySelectorAll("[data-cloud-field]"), (node) => node.getAttribute("data-cloud-field"))).toEqual([
      "prompt",
      "title",
      "style",
    ])
    expect(form.querySelector('[data-cloud-field="format"]')).toBeNull()
    // 夹具未登录 ⇒ cloudReady 为假 ⇒ 表单可看不可发,与 legacy 云条目同一条门控。
    expect(form.querySelector<HTMLButtonElement>("[data-cloud-form-submit]")!.disabled).toBe(true)
    expect(form.textContent).toContain(zh["codepuppy.ext.cloudNeedPlatformNote"])
    // F4:真注册的 detail IPC 返回的就是解码后的描述,逐字(raw 载荷不过 IPC,过的是这一份投影)。
    await waitFor(() => expect(harness.detailResults.length).toBeGreaterThan(0))
    const detail = harness.detailResults.at(-1) as CatalogPackageViewV1
    expect(detail).toMatchObject({ catalogId: CLOUD_PACKAGE_ID, verdict: "compatible" })
    const signed = JSON.parse(new TextDecoder().decode((await cloudCorpusCase()).bytes)) as { behavior: unknown }
    expect(detail.cloud).toEqual(signed.behavior as never)
    expect(harness.installIntents).toEqual([])
  })

  test("legacy MCP plus submits immediately without confirmation or required credentials", async () => {
    const harness = await mountHarness()
    setHubSection("connectors")
    await waitFor(() => expect(document.querySelector(".codepuppy-ext-card b[title='git']")).toBeInstanceOf(HTMLElement))
    const card = document.querySelector(".codepuppy-ext-card b[title='git']")!.closest(".codepuppy-ext-card")!
    click(card.querySelector(".codepuppy-ext-add"))
    await waitFor(() => expect(harness.installIntents).toEqual([{ catalogId: "mcp:git" }]))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector(".codepuppy-ext-confirm-keys")).toBeNull()
    expect(document.querySelector('[data-package-authorization]')).toBeNull()
    expect(JSON.stringify(harness.installIntents)).not.toContain("secrets")
  })
})
