// Extension detail page (REQ-019 T2) — the hub's second-level page, rendered in place of the list
// when a card is clicked. Back button + Escape pop back to the list (the hub owns the Esc chain:
// detail → list → close). Generic skeleton contract:
// header (icon/name/source/license/version/「待核实」) → 简介 → type-specific slot → 数据边界 →
// 运行时依赖 → 所需密钥 → 操作区. T3 fills the type-specific blocks (tools[]/SKILL.md/hooks…);
// T4 upgrades 数据边界/依赖 to live which-checks.

import { createMemo, createResource, createSignal, For, Show, type Accessor, type JSX } from "solid-js"
import { t } from "../i18n"
import type { CatalogEntry, CloudPipelineSpec, InstalledState, McpInstallSpec, PluginInstallSpec, SkillInstallSpec } from "./catalog-types"
import type { InstallReceipt, ExtInventory } from "../../preload/types"
import { hubRowFor, hubStateView, type ExtensionsApi, type HubAgent } from "./use-extensions"
import { CloudDispatchBox } from "./cloud-dispatch-box"
import { CloudFormBox } from "./cloud-form-box"
import { extensionError, catalogDescription, iconFor, iconForRow, PackageLogo, sourceLabel, typeLabel, Svg, LockIc } from "./ext-presentation"
import { ExtGrantedCapRow } from "./ext-authz"
import { inventoryRowFor, inventoryInstallRow, ownershipRows, trustRows, runtimeSurfaceLabelKey, supportTierLabelKey, type PresentRow } from "./ext-inventory-present"
import { derivePackFacts, formatPackBytes } from "./ext-pack-facts"
import { isCodePuppyOfficeCatalogId, officeAdvisoryFor, retiredCommunityOfficeFor, type OfficeAdvisory } from "../../shared/office-advisories"
import { receiptArtifactFacts } from "../../shared/receipt-artifact-facts"
// #397 PR-B:策展呈现(签名摘要真源;curated 整段切换,uncurated 走旧真源,两真源不混排)。
import { CAPABILITY_LABEL_KEYS, SHELF_CHIP_KEYS, curatedOf, foldDomains, isArchived, isExpired, isSessionGrant } from "./ext-curation-view"
import type { SessionToggleView } from "./ext-session-toggle"
import type { CurationStatus } from "../../shared/catalog-curation"
import type { CatalogPackageViewV1 } from "../../shared/catalog-package-view"
import { packageComponentPresentation, packagePresentation, packageRetainedReasonKey } from "./ext-package-presentation"
import { packageListingListV1, packageListingTextV1 } from "../../shared/host-extension-package-contract/decoder"
import { extIpc } from "./ext-ipc"

/** What the detail page shows: a legacy catalog entry, a host-projected package, an engine agent
 *  (no catalog identity), or the injected platform cloud connector. */
export type DetailTarget =
  | { kind: "entry"; entry: CatalogEntry }
  | {
      kind: "package"
      view: CatalogPackageViewV1
      source: "builtin" | "cache" | "remote"
    }
  | { kind: "agent"; agent: HubAgent }
  | { kind: "cloud-connector" }

// mcp.cloud 的 4 个工具(B 侧 MCP facade;alpha-platform docs/contracts/cloud-jobs-v1.md)。
// 引擎无 tools 查询路由 → 与 MCP 条目一样用精选元数据展示(REQ-019 T3 同约束)。
// #1595 AC3:行首是自然语言名 —— 取对话里工具卡同一份命名(`codepuppy.timeline.cloud.*`,
// tool-card-model.ts 的标题表),技术名只进「开发者详情」。
const CLOUD_TOOLS = [
  { name: "dispatch", titleKey: "codepuppy.timeline.cloud.dispatch", key: "codepuppy.ext.cloudToolDispatch" },
  { name: "status", titleKey: "codepuppy.timeline.cloud.status", key: "codepuppy.ext.cloudToolStatus" },
  { name: "await", titleKey: "codepuppy.timeline.cloud.await", key: "codepuppy.ext.cloudToolAwait" },
  { name: "artifacts", titleKey: "codepuppy.timeline.cloud.artifacts", key: "codepuppy.ext.cloudToolArtifacts" },
] as const

function mcpSpec(e: CatalogEntry): McpInstallSpec | undefined {
  return e.installSpec?.kind === "mcp" ? e.installSpec : undefined
}
function skillSpec(e: CatalogEntry): SkillInstallSpec | undefined {
  return e.installSpec?.kind === "skill" ? e.installSpec : undefined
}
function pluginSpec(e: CatalogEntry): PluginInstallSpec | undefined {
  return e.installSpec?.kind === "plugin" ? e.installSpec : undefined
}
function cloudSpec(e: CatalogEntry): CloudPipelineSpec | undefined {
  return e.installSpec?.kind === "cloud" ? e.installSpec : undefined
}
function verifyText(e: CatalogEntry): string | undefined {
  return e._verify ?? e.installSpec?._verify
}
/** REQ-105(#197):归档连接器 advisory(Word/PPT 上游 2026-03-03 归档)——详情页显式警示。 */
function advisoryOf(e: CatalogEntry): OfficeAdvisory | undefined {
  return officeAdvisoryFor({ id: e.id, name: e.name })
}
/** REQ-135:the stale signed snapshot may still expose this card; presentation must say retired. */
function isRetiredCommunityOffice(e: CatalogEntry): boolean {
  return retiredCommunityOfficeFor({ id: e.id, name: e.name }) !== undefined
}
function hostOf(url: string | undefined): string {
  if (!url) return ""
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const Section = (p: { title: string; children: JSX.Element }) => (
  <section class="codepuppy-ext-dsec">
    <h3 class="codepuppy-ext-dsec-t">{p.title}</h3>
    {p.children}
  </section>
)

/** #1595 AC2:目录里的秒数换算成「约 N 分钟」(至少 1 分钟)。 */
export function cloudMaxRunMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60))
}

const FactRow = (p: { label: string; children: JSX.Element }) => (
  <div class="codepuppy-ext-dfact">
    <span class="codepuppy-ext-dfact-l">{p.label}</span>
    <span class="codepuppy-ext-dfact-v">{p.children}</span>
  </div>
)

export function ExtensionDetail(props: {
  target: DetailTarget
  ext: ExtensionsApi
  catalogVersion: string
  byId: (id: string) => CatalogEntry | undefined
  busy: Accessor<string | null>
  /** Breadcrumb root = the section (tab) this detail was opened from; clicking it goes back. */
  crumb: string
  /** B11:安装失败的行内错误(hub 持有,与卡片同源)。 */
  errorFor?: (id: string) => string | undefined
  onBack: () => void
  /** Stage the entry in the hub's install-confirm dialog (same flow as the card 添加). */
  onInstall: (e: CatalogEntry) => void
  /** Execute only the host-supplied package action; install/resolve intents contain catalogId+scope. */
  onPackageAction: (view: CatalogPackageViewV1) => Promise<CatalogPackageViewV1 | undefined>
  onUninstall: (receipt: InstallReceipt) => void
  /** Navigate the detail page to another entry (bundle item click). */
  onOpenEntry: (e: CatalogEntry) => void
  /** REQ-020 T2:云门控(登录且 platform 模式)。cloud 条目「启用」与 dispatch 入口据此禁用。
   *  `#624` 起额外含「平台凭证未在恢复中」——恢复中一律 fail-close(判断依据见 extension-hub.tsx)。 */
  cloudReady?: Accessor<boolean>
  cloudLive?: Accessor<InstalledState | undefined>
  /** `#624`:已登录 platform 但凭证恢复中。**只驱动文案**,不参与放行(放行看 cloudReady)。
   *  分出这一支是因为此时说「需登录平台模式」是假话 —— 用户已经登录了。 */
  cloudRecovering?: Accessor<boolean>
  /** 未登录时云页的登录 CTA(window.api.auth.start,hub 持有)。 */
  onLogin?: () => void
  /** REQ-103(#195):governance 只读真源(逐扩展五维所有权 + 三态);详情页所有权/来源签名段据此渲染。 */
  governance?: Accessor<ExtInventory | undefined>
  /** #397:策展采信结果(hub 解码一次;fail-closed —— invalid 与未策展同保守面)。 */
  curationStatus: (id: string) => CurationStatus
  /** #397:复审期限比较的时钟(hub 每次打开取一次;合同:消费端时钟仅用于此比较)。 */
  nowIso: Accessor<string>
  /** #395(Codex r9 B3 / r10 minor):启停唯一处理器(hub 持有,与行内开关共用)—— 详情页 MCP 开关据此
   *  走 desired-state/advisory 通道。**必填**(r10:可选 + fallback 直连会让新增 caller 漏传时绕过闸门)。 */
  onToggleState: (args: {
    receipt: InstallReceipt
    type: string
    name: string
    currentlyOn: boolean
    liveUnreceipted: boolean
    mcpConnected: boolean
  }) => Promise<void>
  /** #408 PR-C:会话开关(labs mcp)—— 与已装行共用 hub 的状态机与唯一处理器。**必填**同 r10 纪律
   *  (可选 + 漏传 = 详情页静默丢开关)。sessionAvailable=false(home/new-session 无 instance
   *  上下文)时开关禁用 + 如实提示。 */
  sessionViewFor: (catalogId: string) => SessionToggleView
  sessionAvailable: () => boolean
  sessionBusyFor: (catalogId: string) => boolean
  onSessionToggle: (args: { catalogId: string; name: string; on: boolean }) => Promise<void>
}) {
  if (props.target.kind === "package") {
    const initial = props.target.view
    const source = props.target.source
    const [packageDetail, { mutate: setPackageDetail }] = createResource(
      () => initial.catalogId,
      (catalogId) => extIpc.packageDetail(catalogId),
    )
    const view = () => packageDetail() ?? initial
    const presentation = () => packagePresentation(view())
    const sourceKey =
      source === "remote"
        ? "codepuppy.ext.packageSourceRemote"
        : source === "cache"
          ? "codepuppy.ext.packageSourceCache"
          : "codepuppy.ext.packageSourceBuiltin"
    // `#698`:这个包在本机装没装 —— main 从**它自己的账本图**回答;renderer 不推断、不缓存。
    const [installed, { refetch: refetchInstalled }] = createResource(
      () => initial.catalogId,
      (catalogId) => extIpc.packageInstalled(catalogId),
    )
    const [removing, setRemoving] = createSignal(false)
    const [packageError, setPackageError] = createSignal<string | undefined>()
    const [retained, setRetained] = createSignal<
      Array<{ kind: string; name: string; reasonCode: string | null }>
    >([])
    const [reloadPending, setReloadPending] = createSignal(false)
    const removePackage = async () => {
      setRemoving(true)
      setPackageError(undefined)
      setReloadPending(false)
      try {
        // `#784` G20:走 `ext.uninstallPackage` 而不是 `extIpc.uninstallPackage` ——
        // 那一层在成功之后会请引擎重载。此前这里直连 IPC 并且**只 refetch 不 refresh**,
        // 后果是「移除成功」之后那些技能仍然被引擎实例注入着,一直到用户下次重启 App。
        const result = await props.ext.uninstallPackage(view().catalogId)
        if (!result.ok) {
          // 失败就说失败。`ok` 之外的任何东西都不许被读成「已移除」——「空操作 + ok」正是
          // `#706` review 抓到的那种谎报(Hub 只看 ok)。
          setPackageError(extensionError(result.reason, "codepuppy.ext.error.removePackage"))
          return
        }
        setRetained(result.retained.map((entry) => ({ kind: entry.kind, name: entry.name, reasonCode: entry.reasonCode })))
        // 账本已经改完(移除是 durable 的),但引擎这次没能重载 ⇒ 如实说「待重载」,
        // 不许让用户以为它已经不在了。
        setReloadPending(result.reloadPending === true)
        // 成功但带具名 warning(连接绑定没释放掉、残留没清干净等)的呈现归 `extIpc`(`#765`):
        // 上面那次调用返回时就已经推了 toast,这里不再往行内错误位塞一份。
        await refetchInstalled()
      } finally {
        setRemoving(false)
      }
    }
    // `#1287`:两个取值器把「schema 派生的联合类型」在一个地方收敛掉,渲染处不出现任何 `as`。
    const listingText = (field: Parameters<typeof packageListingTextV1>[1]) =>
      packageListingTextV1(view().listing, field)
    const listingList = (field: Parameters<typeof packageListingListV1>[1]) =>
      packageListingListV1(view().listing, field)
    /** 政策链接:字段名 → 文案 key 的对应住在这一处,渲染处只跟着数组走。 */
    const listingLinks = () =>
      (
        [
          ["websiteUrl", "codepuppy.ext.packageWebsite"],
          ["privacyPolicyUrl", "codepuppy.ext.packagePrivacyPolicy"],
          ["termsOfServiceUrl", "codepuppy.ext.packageTerms"],
        ] as const
      ).flatMap(([field, labelKey]) => {
        const href = listingText(field)
        return href ? [{ field, labelKey, href }] : []
      })
    const runAction = async () => {
      const latest = await props.onPackageAction(view())
      if (latest) setPackageDetail(latest)
      // `#698`:装完之后「移除此扩展包」必须当场出现。不重新问一次 main,用户就得退出再进来
      // 才看得到它 —— 而「装完就删不掉」正是本票要消灭的那条死路。
      await refetchInstalled()
    }

    return (
      <div class="codepuppy-ext-detail" data-package-detail={view().catalogId}>
        <nav class="codepuppy-ext-crumbs" aria-label={t("codepuppy.ext.back")}>
          <button class="codepuppy-ext-crumb-link" onClick={() => props.onBack()}>
            <Svg class="codepuppy-ic codepuppy-ic-sm" d="M14 6l-6 6 6 6" />
            {props.crumb}
          </button>
          <span class="codepuppy-ext-crumb-sep">/</span>
          <span class="codepuppy-ext-crumb-cur">{view().presentation.displayName}</span>
        </nav>

        <header class="codepuppy-ext-dhead">
          {/* `#1287`:发布者签名的 logo 与品牌色。两者都缺时回落到原来的首字母 + 主题色 ——
              **回落是常态**,已发布的条目一个 listing 都没有。 */}
          <span
            class="codepuppy-ext-dhead-ic"
            style={{ background: listingText("brandColor") ?? "var(--a-accent-solid)" }}
          >
            <PackageLogo listing={view().listing} fallback={view().presentation.displayName} />
          </span>
          <div class="codepuppy-ext-dhead-body">
            <div class="codepuppy-ext-dhead-t">
              <h2>{view().presentation.displayName}</h2>
              <span class="codepuppy-ext-chip" data-source="codepuppy">{t(sourceKey)}</span>
              <span class="codepuppy-ext-type-pill">{t("codepuppy.ext.packageType")}</span>
            </div>
            <div class="codepuppy-ext-dhead-meta">
              <code class="codepuppy-ext-dhead-id">{view().catalogId}</code>
              <span>
                {t("codepuppy.ext.detailVersion")} {view().presentation.version}
              </span>
              <Show when={listingText("developerName")}>
                {(developer) => (
                  <span data-package-developer="">
                    {t("codepuppy.ext.packageDeveloper")} {developer()}
                  </span>
                )}
              </Show>
              <Show when={listingText("category")}>
                {(category) => (
                  <span data-package-category="">
                    {t("codepuppy.ext.packageCategory")} {category()}
                  </span>
                )}
              </Show>
            </div>
          </div>
        </header>

        <Section title={t("codepuppy.ext.detailAbout")}>
          <p class="codepuppy-ext-dabout">{view().presentation.description}</p>
          <Show when={listingText("longDescription")}>
            {(long) => (
              <p class="codepuppy-ext-dabout" data-package-long-description="">
                {long()}
              </p>
            )}
          </Show>
        </Section>

        {/* `#1287`:截图 / 用法示例 / 政策链接。每一段都只在发布者真的填了的时候出现 ——
            空段位比没有更糟(用户读到一个「暂无」也要花一次注意力)。 */}
        <Show when={listingList("screenshots").length > 0}>
          <Section title={t("codepuppy.ext.packageScreenshots")}>
            <div class="codepuppy-ext-package-shots">
              <For each={listingList("screenshots")}>
                {(shot) => (
                  <img
                    class="codepuppy-ext-package-shot"
                    data-package-screenshot=""
                    src={shot}
                    alt=""
                    loading="lazy"
                  />
                )}
              </For>
            </div>
          </Section>
        </Show>

        <Show when={listingList("defaultPrompt").length > 0}>
          <Section title={t("codepuppy.ext.packagePrompts")}>
            <div class="codepuppy-ext-dtools">
              <For each={listingList("defaultPrompt")}>
                {(prompt) => (
                  <div class="codepuppy-ext-dtool" data-package-prompt="">
                    <code>{prompt}</code>
                  </div>
                )}
              </For>
            </div>
          </Section>
        </Show>

        <Show when={listingLinks().length > 0}>
          <Section title={t("codepuppy.ext.packageLinks")}>
            <For each={listingLinks()}>
              {(link) => (
                <FactRow label={t(link.labelKey)}>
                  {/* `external-link` 是本应用唯一的外链出口:renderer/index.tsx 的全局
                      click 拦截把它交给 main 的 shell.openExternal(scheme 白名单),
                      而不是让这个窗口自己导航走。 */}
                  <a class="external-link" data-package-link={link.field} href={link.href}>
                    {link.href}
                  </a>
                </FactRow>
              )}
            </For>
          </Section>
        </Show>

        <Section title={t("codepuppy.ext.packageInstallability")}>
          <FactRow label={t("codepuppy.ext.packageInstallability")}>
            <span class="codepuppy-ext-package-state" data-verdict={view().verdict}>
              {t(presentation().verdictKey)}
            </span>
          </FactRow>
        </Section>

        {/* REQ-235:root 档案为 cloud@1 ⇒ 按 main 解码过的描述画表单。与 legacy 云条目同一条门控:
            派发不要求已安装,只看 cloudReady(恢复中同样禁用,只是理由不同)。 */}
        <Show when={view().cloud}>
          {(cloud) => (
            <Section title={t("codepuppy.ext.cloudPipelines")}>
              <CloudFormBox
                cloud={cloud()}
                ready={props.cloudReady?.() ?? false}
                recovering={props.cloudRecovering?.() ?? false}
              />
            </Section>
          )}
        </Show>

        <Section title={t("codepuppy.ext.packageComponentsTitle")}>
          {/* `#697` 第 5 跳:逐组件一行(root + 各 leaf),被跳过的组件带**具名原因**。
              以前这里写死一行「包名 · 版本」—— 安全视图早就带着 components[] 与 skipReasonCode,
              而用户在任何一步都看不到「这个包里有一件东西不会被装」。 */}
          <For each={view().components}>
            {(component) => {
              const shown = packageComponentPresentation(component)
              return (
                <div
                  class="codepuppy-ext-package-component"
                  data-package-component={component.componentId}
                  data-included={component.included ? "true" : "false"}
                >
                  <FactRow label={t(shown.roleKey as never)}>
                    <code class="codepuppy-ext-package-component-id">{component.componentId}</code>
                    <span class="codepuppy-ext-package-component-req" data-required={component.required ? "true" : "false"}>
                      {t(shown.requirementKey as never)}
                    </span>
                    <span class="codepuppy-ext-package-component-state" data-included={component.included ? "true" : "false"}>
                      {t(shown.stateKey as never)}
                    </span>
                  </FactRow>
                  <Show when={shown.skipReasonKey}>
                    {(reasonKey) => (
                      <p class="codepuppy-ext-package-component-why" data-skip-reason={component.skipReasonCode}>
                        {t(reasonKey() as never)}
                      </p>
                    )}
                  </Show>
                </div>
              )
            }}
          </For>
          <FactRow label={t("codepuppy.ext.packagePrerequisiteStatus")}>
            <span class="codepuppy-ext-package-state" data-prerequisite={view().prerequisites.status}>
              {t(presentation().prerequisiteKey)}
            </span>
          </FactRow>
          <Show when={view().prerequisites.items.length > 0}>
            <div class="codepuppy-ext-dtools">
              <For each={view().prerequisites.items}>
                {(item) => (
                  <div class="codepuppy-ext-dtool">
                    <code>{item.label}</code>
                    <Show when={item.required}>
                      <span>{t("codepuppy.ext.packageRequired")}</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Section>

        <Section title={t("codepuppy.ext.packageReasonTitle")}>
          <p class="codepuppy-ext-dboundary">{t(presentation().reasonKey)}</p>
        </Section>

        <Section title={t("codepuppy.ext.packageActions")}>
          <div class="codepuppy-ext-dsub">
            <button
              class="codepuppy-ext-add"
              data-variant={view().action.kind === "install" ? "primary" : undefined}
              data-size="lg"
              disabled={!view().action.enabled || props.busy() === view().catalogId}
              onClick={() => void runAction()}
            >
              {t(presentation().actionKey)}
            </button>
            {/* `#698`:装过之后,这里是把整个扩展包拿掉的**唯一**入口。`#706` 起,属于扩展包的
                单个部件被单独移除会被响亮拒绝(「它还属于这个包」)—— 在这颗按钮之前,那句拒绝
                指向的地方并不存在,用户装完一个扩展包就再也删不掉它。 */}
            <Show when={(() => { const state = installed(); return !!state && "installed" in state && state.installed })()}>
              <button
                class="codepuppy-ext-add"
                data-variant="danger"
                data-size="lg"
                data-package-uninstall={view().catalogId}
                disabled={removing()}
                onClick={() => void removePackage()}
              >
                {t("codepuppy.ext.packageActionUninstall")}
              </button>
            </Show>
            {/* 「留下来的部件」必须说得出理由 —— 用户点了「移除」却发现某个技能还在,而系统
                说不出为什么,那和一个 bug 没有区别。 */}
            <Show when={retained().length > 0}>
              <ul class="codepuppy-ext-package-retained">
                <For each={retained()}>
                  {(entry) => (
                    <li data-package-retained={`${entry.kind}:${entry.name}`} data-retained-reason={entry.reasonCode ?? ""}>
                      <code>{`${entry.kind}:${entry.name}`}</code>
                      <span>{entry.reasonCode ? (t(packageRetainedReasonKey(entry.reasonCode) as never) as string) : ""}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            {/* `#784` G20:账本已改完但引擎没重载成功 —— 说「待重载」,不说「已移除」。 */}
            <Show when={reloadPending()}>
              <p class="codepuppy-ext-card-err" data-reload-pending="" role="status">
                {t("codepuppy.ext.packageRemovedPendingReload")}
              </p>
            </Show>
            <Show when={packageError()}>
              {(error) => <p class="codepuppy-ext-card-err" role="alert">{error()}</p>}
            </Show>
            <Show when={props.errorFor?.(view().catalogId)}>
              {(error) => <p class="codepuppy-ext-card-err" role="alert">{error()}</p>}
            </Show>
          </div>
        </Section>
      </div>
    )
  }

  const entry = () => (props.target.kind === "entry" ? props.target.entry : undefined)
  const agent = () => (props.target.kind === "agent" ? props.target.agent : undefined)
  const isCloudConnector = () => props.target.kind === "cloud-connector"
  const cloudReady = () => props.cloudReady?.() ?? false
  const cloudRecovering = () => props.cloudRecovering?.() ?? false
  // 注入的 mcp.cloud 的 SDK 实时态(platform 模式下 sidecar 注入后才存在)。
  const cloudLive = () => props.cloudLive?.()

  // Receipt truth for the shown entry — receipts ⨝ SDK (mirror of the manage list, ADR-014 v3).
  // Live-but-unreceipted MCP gets a synthetic receipt so uninstall still works.
  const receipt = createMemo((): InstallReceipt | undefined => {
    const e = entry()
    if (e) {
      const byIdMatch = props.ext.store.receipts.find((r) => r.id === e.id)
      if (byIdMatch) return byIdMatch
      if (e.type === "mcp" && e.name in props.ext.store.mcp)
        return { id: e.id, name: e.name, type: "mcp", scope: "global", installedAt: "", origin: "created" }
      return undefined
    }
    const a = agent()
    if (a) return props.ext.store.receipts.find((r) => r.type === "agent" && r.name === a.name)
    return undefined
  })
  const installed = createMemo(() => {
    const e = entry()
    if (e) return props.ext.isInstalled(e)
    return !!receipt()
  })
  // REQ-105(#319):安装后头部同时说两件事 —— 卡片版本(receipt 记的那个,不是 catalog 当前的)
  // 与**执行物**内容地址。digest 只来自 receipt;renderer 不推导、不回退 catalog、不自算。
  const artifactFacts = createMemo(() => receiptArtifactFacts(receipt()))
  const mcpLive = () => {
    const e = entry()
    return e?.type === "mcp" ? props.ext.store.mcp[e.name] : undefined
  }
  // REQ-234 `#1529`:与已安装列表同一份三档状态(详情页只呈现 global 安装,与上面 receipt 的口径一致)。
  const hubState = createMemo(() => {
    const r = receipt()
    return hubStateView(r && r.installedAt !== "" ? hubRowFor(props.ext.store.hubRows, r.id, r.scope) : undefined, mcpLive())
  })
  const [reloadBusy, setReloadBusy] = createSignal(false)
  const [reloadRefused, setReloadRefused] = createSignal(false)

  // REQ-019 T3:技能详情渲染 SKILL.md 全文。只有 builtin 资产可读(主进程只读 IPC,键校验 +
  // 256KB 帽);未打包的诚实显示原因,不占位。
  const [skillDoc] = createResource(
    () => {
      const e = entry()
      if (!e) return undefined
      const spec = e.installSpec
      // skill 的 SKILL.md 与 agent 的 md 资产共用只读预览通道(REQ-023)。
      if (spec?.kind === "skill") return spec.builtinAssetKey || undefined
      if (spec?.kind === "agent") return spec.builtinAssetKey || undefined
      return undefined
    },
    (key) => extIpc.readBuiltinSkill(key),
  )

  // ── #397:策展采信(整段真源切换的判定;fail-closed —— invalid 走未策展保守面 + 一行上报)──
  const cst = createMemo<CurationStatus>(() => {
    const e = entry()
    return e ? props.curationStatus(e.id) : { kind: "uncurated" }
  })
  const curated = () => curatedOf(cst())
  const archivedNow = () => isArchived(cst())
  const retiredNow = () => {
    const e = entry()
    return e ? isRetiredCommunityOffice(e) : false
  }
  const expiredNow = () => isExpired(cst(), props.nowIso())
  const sessionGrantNow = () => isSessionGrant(cst())
  // 组件清单 / 来源快照:进详情页即拉(v6 稿 Q5=A;main 全量采信前置,失败逐行 loud + 重试;
  // 拉取失败不影响本页其余判定 —— 摘要已内联随 payload 签名)。
  const [sbomBlob, { refetch: refetchSbom }] = createResource(
    () => {
      const e = entry()
      return e && curated() ? e.id : undefined
    },
    (id) => extIpc.curationBlob(id, "sbom"),
  )
  const [provBlob, { refetch: refetchProv }] = createResource(
    () => {
      const e = entry()
      return e && curated() ? e.id : undefined
    },
    (id) => extIpc.curationBlob(id, "provenance"),
  )
  const sbomComponents = createMemo((): { name: string; version: string }[] => {
    const r = sbomBlob()
    if (!r?.ok) return []
    const comps = (r.data as { components?: unknown[] }).components ?? []
    return comps
      .filter((c): c is { name: string; version: string } => !!c && typeof c === "object")
      .map((c) => ({ name: String(c.name ?? ""), version: String(c.version ?? "") }))
  })
  const [sbomOpen, setSbomOpen] = createSignal(false)
  const provFacts = createMemo((): { locator: string; resolved: string } | null => {
    const r = provBlob()
    if (!r?.ok) return null
    const p = r.data as { source?: { locator?: unknown; resolved?: unknown } }
    return { locator: String(p.source?.locator ?? ""), resolved: String(p.source?.resolved ?? "") }
  })

  // #397:所有权段并入评审事实(甄选值 = 审核于日期;支持改读 review.supportTier,替换按来源猜的
  // 旧口径;上游状态仅异常态出行;复审期限追加行)。uncurated 原样。
  const detailOwnershipRows = (ownership: Parameters<typeof ownershipRows>[0]): PresentRow[] => {
    const base = ownershipRows(ownership)
    const c = curated()
    if (!c) return base
    const supportKey =
      c.review.supportTier === "full"
        ? ("codepuppy.ext.supportFull" as const)
        : c.review.supportTier === "best-effort"
          ? ("codepuppy.ext.supportBestEffort" as const)
          : c.review.supportTier === "community"
            ? ("codepuppy.ext.supportCommunity" as const)
            : ("codepuppy.ext.supportNone" as const)
    const out: PresentRow[] = []
    for (const r of base) {
      if (r.labelKey === "codepuppy.ext.ownCurated") {
        out.push({ labelKey: "codepuppy.ext.ownCurated", value: t("codepuppy.ext.ownCuratedReviewed", { date: c.review.reviewedAt.slice(0, 10) }) })
        if (c.review.upstreamStatus === "archived") out.push({ labelKey: "codepuppy.ext.ownUpstream", valueKeys: ["codepuppy.ext.upstreamArchived"] })
        else if (c.review.upstreamStatus === "unmaintained")
          out.push({ labelKey: "codepuppy.ext.ownUpstream", valueKeys: ["codepuppy.ext.upstreamUnmaintained"] })
      } else if (r.labelKey === "codepuppy.ext.ownSupport") {
        out.push({ labelKey: "codepuppy.ext.ownSupport", valueKeys: [supportKey] })
      } else {
        out.push(r)
      }
    }
    out.push({ labelKey: "codepuppy.ext.ownReviewBefore", value: t("codepuppy.ext.reviewValidUntil", { date: c.review.reviewBefore.slice(0, 10) }) })
    return out
  }

  // REQ-019 T4:进详情页即实时 which 检测运行时依赖(复用 ext.checkRuntime),不再等点「添加」
  // 才发现缺依赖;缺失的给安装指引。source 串上 entry id,切换条目即重测。
  // #397:curated 条目的依赖供集改读甄选摘要(需要什么 = 签名真源;有没有 = 本地 which 实测)。
  // #1564 AC3:四个第一方 Office 条目的运行环境随应用自带 —— 读 main 的随包运行时事实,不读卡片 / 甄选
  // 摘要里的 runtimeDep(uv)。
  const officeEntry = createMemo(() => isCodePuppyOfficeCatalogId(entry()?.id))
  const [officeRuntime] = createResource(() => (officeEntry() ? entry()!.id : undefined), () => extIpc.officeRuntime())
  const officeRuntimeState = () => (officeRuntime.loading || !officeRuntime() ? "checking" : officeRuntime()!.ok ? "ok" : "missing")
  const runtimeDepList = createMemo((): string[] => {
    const e = entry()
    if (!e || officeEntry()) return []
    const c = curated()
    if (c) return c.summaries.runtimeDependencies
    return mcpSpec(e)?.runtimeDep ?? []
  })
  const [depCheck] = createResource(
    () => {
      const e = entry()
      const deps = runtimeDepList()
      return e && deps.length ? { id: e.id, deps } : undefined
    },
    async (src) => {
      const results: { dep: string; ok: boolean }[] = []
      for (const dep of src.deps) {
        const r = await extIpc.checkRuntime(dep)
        results.push({ dep, ok: r.ok })
      }
      return results
    },
  )
  // 缺失依赖的安装指引(mac,homebrew 优先;uv 官方脚本备选)。
  const DEP_GUIDE: Record<string, string> = {
    uv: "brew install uv",
    node: "brew install node",
    git: "xcode-select --install",
    python: "brew install python",
    bun: "brew install oven-sh/bun/bun",
  }

  const header = createMemo(() => {
    const e = entry()
    if (e) {
      const ic = iconFor(e)
      return {
        ic,
        title: e.displayName,
        name: e.name,
        source: e.source,
        type: e.type as string,
        license: e.license,
        desc: catalogDescription(e),
      }
    }
    if (isCloudConnector()) {
      return {
        ic: iconForRow(undefined, "cloud", "云"),
        title: t("codepuppy.ext.cloudConnectorTitle"),
        name: "codepuppy",
        source: "codepuppy" as const,
        type: "mcp",
        license: undefined,
        desc: t("codepuppy.ext.cloudConnectorDesc"),
      }
    }
    const a = agent()!
    return {
      ic: iconForRow(undefined, "agent", a.name),
      title: a.name,
      name: a.name,
      source: undefined,
      type: "agent",
      license: undefined,
      desc: a.description ?? t("codepuppy.ext.agentNoDesc"),
    }
  })

  // REQ-103(#195):本条目的 governance 行(同 id 优先已安装行,否则浏览行)——所有权/来源签名段的真源。
  // 仅 catalog 条目有 governance 身份;agent(引擎原生)/云连接器无 id → 两段不渲染(不造)。
  const govRow = createMemo(() => inventoryRowFor(props.governance?.(), entry()?.id ?? ""))

  // #396(REQ-104):套件整包事实(体积/密钥/运行面/支持等级 + 能力并集)—— 纯读派生自已解析
  // 子项(ext-pack-facts,能力与 #348 确认框同一真源)。非 bundle 恒 undefined,段不渲染。
  // Codex r1 Major:子项解析缺失(catalog 引用悬空)不静默过滤 —— 密钥/运行面/能力同样未知,
  // 部分聚合会误导(planner 侧同一场景会拒装);missing>0 时整段替换为「数据不完整」诚实提示。
  const packFacts = createMemo(() => {
    const e = entry()
    if (!e || e.type !== "bundle") return undefined
    const items = (e.bundleItems ?? []).slice().sort((a, b) => a.installOrder - b.installOrder)
    const children = items.map((it) => props.byId(it.catalogEntryId)).filter((x): x is CatalogEntry => !!x)
    return { missing: items.length - children.length, facts: derivePackFacts(children) }
  })
  // 能力来源标注:≤2 个子项列名(连接符走 i18n,Codex r1 Minor),更多收敛为计数。
  const packFromLabel = (names: string[]) =>
    names.length > 2 ? t("codepuppy.ext.packCapFromMany", { n: names.length }) : names.join(t("codepuppy.ext.packCapFromSep"))

  // PresentRow[] → FactRow 列表(值为 i18n key 数组则逐个 t() 后「 · 」拼接,或字面值直出)。
  const FactRows = (p: { rows: PresentRow[] }) => (
    <For each={p.rows}>
      {(r) => (
        <FactRow label={t(r.labelKey)}>
          {r.valueKeys ? r.valueKeys.map((k) => t(k)).join(" · ") : r.value}
        </FactRow>
      )}
    </For>
  )

  return (
    <div class="codepuppy-ext-detail">
      {/* 面包屑(横向层级,用户拍板取代返回键/左栏):类目 / 条目名;首级可点 = 返回列表 */}
      <nav class="codepuppy-ext-crumbs" aria-label={t("codepuppy.ext.back")}>
        <button class="codepuppy-ext-crumb-link" onClick={() => props.onBack()}>
          <Svg class="codepuppy-ic codepuppy-ic-sm" d="M14 6l-6 6 6 6" />
          {props.crumb}
        </button>
        <span class="codepuppy-ext-crumb-sep">/</span>
        <span class="codepuppy-ext-crumb-cur">{header().title}</span>
      </nav>

      {/* ── generic header:icon · 名称 · 来源 · 类型 · 许可证 · 版本 · 待核实 ── */}
      <header class="codepuppy-ext-dhead">
        <span class="codepuppy-ext-dhead-ic" style={{ background: header().ic.color }}>
          {header().ic.glyph}
        </span>
        <div class="codepuppy-ext-dhead-body">
          <div class="codepuppy-ext-dhead-t">
            <h2>{header().title}</h2>
            {/* #397:分级 chip(四色货架,与列表同词) + 归档/过期事实 chip */}
            <Show when={curated()}>
              {(c) => (
                <span class="codepuppy-ext-chip" data-shelf={c().tier}>
                  {t(SHELF_CHIP_KEYS[c().tier] as never)}
                </span>
              )}
            </Show>
            <Show when={header().source}>
              <span class="codepuppy-ext-chip" data-source={header().source}>
                {sourceLabel(header().source!)}
              </span>
            </Show>
            <span class="codepuppy-ext-type-pill">{typeLabel(header().type as CatalogEntry["type"])}</span>
            <Show when={archivedNow()}>
              <span class="codepuppy-ext-verify-chip" data-archived="">{t("codepuppy.ext.shelfArchivedChip")}</span>
            </Show>
            <Show when={expiredNow()}>
              <span class="codepuppy-ext-verify-chip" data-archived="">{t("codepuppy.ext.reviewExpiredChip")}</span>
            </Show>
            <Show when={entry() && verifyText(entry()!)}>
              <span class="codepuppy-ext-verify-chip">{t("codepuppy.ext.verifyPending")}</span>
            </Show>
            <Show when={!archivedNow() && entry() && advisoryOf(entry()!)}>
              <span class="codepuppy-ext-verify-chip" data-archived="">{t("codepuppy.ext.advArchivedUnsupported")}</span>
            </Show>
            <Show when={retiredNow()}>
              <span class="codepuppy-ext-verify-chip" data-archived="">{t("codepuppy.ext.retiredCommunityChip")}</span>
            </Show>
          </div>
          <div class="codepuppy-ext-dhead-meta">
            <code class="codepuppy-ext-dhead-id">{header().name}</code>
            <Show when={header().license}>
              <span>
                {t("codepuppy.ext.detailLicense")} {header().license}
              </span>
            </Show>
            <Show when={entry()}>
              <span>
                {t("codepuppy.ext.detailVersion")} {receipt()?.version ?? props.catalogVersion}
              </span>
            </Show>
            {/* REQ-105(#319):已安装项必须能说出它执行的是哪一份字节。没记就说「未记录」——
                空着或拿 catalog 的数字顶上,就是把未验证的东西说成已审计(AC5)。 */}
            <Show when={installed()}>
              <span data-artifact-digest={artifactFacts().digest ?? ""}>
                {t("codepuppy.ext.detailArtifactDigest")}{" "}
                <code class="codepuppy-ext-dhead-id" title={artifactFacts().digest ?? undefined}>
                  {artifactFacts().digestShort ?? t("codepuppy.ext.detailArtifactDigestUnrecorded")}
                </code>
              </span>
            </Show>
            <Show when={installed()}>
              <span class="codepuppy-ext-dhead-installed">✓ {t("codepuppy.ext.installed")}</span>
            </Show>
            <Show when={mcpLive()?.pending && mcpLive()?.error}>
              {(error) => <span class="codepuppy-ext-card-err">{error()}</span>}
            </Show>
            <Show when={hubState()}>
              {(hs) => (
                <span data-hub-state={hs().state} title={hs().detail}>
                  {t(hs().textKey)}
                  <Show when={hs().reasonKey}>{(key) => <> · {t(key())}</>}</Show>
                </span>
              )}
            </Show>
          </div>
        </div>
        {/* 主操作在头部右侧(2026-07-04 定稿,参照 ChatGPT 插件详情页模式);
            plugin 的安装从这里过风险确认框(Q2),skill 直装(Q1),其余确认框。 */}
        <div class="codepuppy-ext-dhead-act">
          <Show when={entry()}>
            {(e) => (
              <>
                <Show when={!installed()}>
                  {/* #397/REQ-135:archived and retired connectors are both unavailable, but their
                      reasons and existing-install semantics remain distinct. */}
                  <Show
                    when={!archivedNow() && !retiredNow()}
                    fallback={
                      <button
                        class="codepuppy-ext-add"
                        data-size="lg"
                        disabled
                        title={t(retiredNow() ? "codepuppy.ext.retiredCommunityNoInstallHint" : "codepuppy.ext.archivedNoInstallHint")}
                      >
                        {t(retiredNow() ? "codepuppy.ext.retiredCommunityNoInstall" : "codepuppy.ext.archivedNoInstall")}
                      </button>
                    }
                  >
                    <button
                      class="codepuppy-ext-add"
                      data-variant="primary"
                      data-size="lg"
                      disabled={props.busy() === e().id || (e().type === "cloud" && !cloudReady())}
                      onClick={() => props.onInstall(e())}
                    >
                      {props.busy() === e().id
                        ? t("codepuppy.ext.adding")
                        : e().type === "plugin"
                          ? t("codepuppy.ext.installPluginBtn")
                          : e().type === "cloud"
                            ? t("codepuppy.ext.enableCloud")
                            : t("codepuppy.ext.add")}
                    </button>
                  </Show>
                </Show>
                {/* r1-2(Major):session-grant 条目详情页不渲染**持久**开关(main 闸拒持久启用)——
                    #408 PR-C 起改渲染真实**会话开关**(琥珀;与已装行同一状态机与处理器,见下方)。 */}
                <Show when={e().type === "mcp" && installed() && sessionGrantNow()}>
                  <button
                    class="codepuppy-ext-sw"
                    data-session=""
                    data-on={props.sessionViewFor(e().id).on ? "" : undefined}
                    disabled={props.sessionBusyFor(e().id) || !props.sessionAvailable()}
                    title={!props.sessionAvailable() ? t("codepuppy.ext.sessionNeedsProject") : undefined}
                    aria-label={props.sessionViewFor(e().id).on ? t("codepuppy.ext.sessionOnRow") : t("codepuppy.ext.sessionOffRow")}
                    onClick={() =>
                      void props.onSessionToggle({ catalogId: e().id, name: e().name, on: !props.sessionViewFor(e().id).on })
                    }
                  />
                </Show>
                <Show when={e().type === "mcp" && installed() && !sessionGrantNow()}>
                  {(() => {
                    // #395(Codex r9 B3):启用真源 = governance activation(账本 desiredState 投影);无
                    // governance 行(live-unreceipted 合成收据)按 live 连接态。开关走 hub 的
                    // onToggleState 统一通道(过 advisory + 账本 + config),不再直连绕过闸门。
                    const rc = receipt()
                    const govActivation = () =>
                      rc ? inventoryInstallRow(props.governance?.(), rc.id, rc.scope)?.activation : undefined
                    const liveUnreceipted = () => !rc || rc.installedAt === ""
                    const on = () => (liveUnreceipted() ? !!mcpLive()?.connected : govActivation() !== "disabled")
                    return (
                      <button
                        class="codepuppy-ext-sw"
                        data-on={on() ? "" : undefined}
                        aria-label={on() ? t("codepuppy.ext.enabled") : t("codepuppy.ext.disabled")}
                        disabled={!rc}
                        onClick={() =>
                          rc &&
                          void props.onToggleState({
                            receipt: rc,
                            type: e().type,
                            name: e().name,
                            currentlyOn: on(),
                            liveUnreceipted: liveUnreceipted(),
                            mcpConnected: !!mcpLive()?.connected,
                          })
                        }
                      />
                    )
                  })()}
                </Show>
              </>
            )}
          </Show>
          <Show when={hubState()?.reloadNow}>
            <button
              class="codepuppy-ext-add"
              data-hub-reload-now=""
              title={t("codepuppy.ext.hubReloadNowHint")}
              disabled={reloadBusy()}
              onClick={async () => {
                setReloadBusy(true)
                try {
                  // global 安装 ⇒ 重载全部(详情页只呈现 global 收据)
                  if (!(await props.ext.refreshEngine())) setReloadRefused(true)
                } finally {
                  setReloadBusy(false)
                }
              }}
            >
              {t("codepuppy.ext.hubReloadNow")}
            </button>
          </Show>
          <Show when={installed() && receipt()}>
            <button class="codepuppy-ext-add" data-variant="danger" onClick={() => props.onUninstall(receipt()!)}>
              {t("codepuppy.ext.remove")}
            </button>
          </Show>
        </div>
      </header>
      <Show when={reloadRefused()}>
        <p class="codepuppy-ext-card-err" role="alert">{t("codepuppy.ext.hubReloadNowRefused")}</p>
      </Show>

      {/* B11:安装失败行内(与卡片错误同源),不裸 toast */}
      <Show when={entry() && props.errorFor?.(entry()!.id)}>
        <p class="codepuppy-ext-card-err">{props.errorFor!(entry()!.id)}</p>
      </Show>

      {/* #397:归档 / 复审过期的如实警示(v6 稿;已装不强拆,时钟仅用于过期比较) */}
      <Show when={archivedNow()}>
        <div class="codepuppy-ext-verify-note" data-archived="" role="alert">
          <p>{t("codepuppy.ext.archivedDetailWarn")}</p>
        </div>
      </Show>
      <Show when={!archivedNow() && expiredNow()}>
        <div class="codepuppy-ext-verify-note" data-archived="" role="alert">
          <p>{t("codepuppy.ext.expiredDetailWarn", { date: curated()!.review.reviewBefore.slice(0, 10) })}</p>
        </div>
      </Show>

      {/* ── 简介 ── */}
      <Section title={t("codepuppy.ext.detailAbout")}>
        {/* #1595 AC2:云端任务的描述就是首屏「做什么」那一行,这里不再重复。 */}
        <Show when={!(entry() && cloudSpec(entry()!))}>
          <p class="codepuppy-ext-dabout">{header().desc}</p>
        </Show>
        {/* REQ-105(#197):归档警示 —— 已装用户的诚实处置指引(禁用/卸载/替代);永不静默删除。 */}
        <Show when={entry() && advisoryOf(entry()!)}>
          {(adv) => (
            <div class="codepuppy-ext-verify-note" data-archived="" role="alert">
              <b>{t("codepuppy.ext.advArchivedTitle")}</b>
              <p>{t("codepuppy.ext.advArchivedDetail", { date: adv().archivedAt })}</p>
            </div>
          )}
        </Show>
        <Show when={retiredNow()}>
          <div class="codepuppy-ext-verify-note" data-archived="" role="alert">
            <b>{t("codepuppy.ext.retiredCommunityTitle")}</b>
            <p>{t("codepuppy.ext.retiredCommunityBody")}</p>
          </div>
        </Show>
        <Show when={entry() && verifyText(entry()!)}>
          <div class="codepuppy-ext-verify-note">
            <b>{t("codepuppy.ext.verifyNoteTitle")}</b>
            <p>{verifyText(entry()!)}</p>
          </div>
        </Show>
      </Section>

      {/* ── #396(REQ-104)套件整包事实:装前看整体代价。位置 = 简介之后、子项列表之前(已批
          设计稿 v5 Q2);体积「≥ 已知 + N 项未知」诚实口径(Q3);能力并集行复用 #392 被动行,
          subtitle 标注来源子项。 ── */}
      <Show when={packFacts()}>
        {(pack) => (
          <Section title={t("codepuppy.ext.packFactsTitle")}>
            <Show
              when={pack().missing === 0}
              fallback={
                <p class="codepuppy-ext-dnote" data-err="">
                  {t("codepuppy.ext.packFactsIncomplete", { n: pack().missing })}
                </p>
              }
            >
              {(() => {
                const pf = () => pack().facts
                return (
                  <>
                    <FactRow label={t("codepuppy.ext.packSize")}>
                      <Show when={pf().unknownSizeCount > 0} fallback={formatPackBytes(pf().knownBytes)}>
                        ≥ {formatPackBytes(pf().knownBytes)}{" "}
                        <span class="codepuppy-ext-type-pill">
                          {pf().unknownSizeCount === 1 ? t("codepuppy.ext.packSizeUnknownOne") : t("codepuppy.ext.packSizeUnknown", { n: pf().unknownSizeCount })}
                        </span>
                      </Show>
                    </FactRow>
                    <FactRow label={t("codepuppy.ext.packSecrets")}>
                      <Show when={pf().secrets.length > 0} fallback={t("codepuppy.ext.packNoSecrets")}>
                        <span class="codepuppy-ext-dcode">{pf().secrets.join(" · ")}</span>
                        <Show when={pf().secretFreeCount > 0}>
                          {" · "}
                          {pf().secretFreeCount === 1 ? t("codepuppy.ext.packSecretsRestOne") : t("codepuppy.ext.packSecretsRest", { n: pf().secretFreeCount })}
                        </Show>
                      </Show>
                    </FactRow>
                    <FactRow label={t("codepuppy.ext.packSurfaces")}>
                      {pf().surfaces.map((s) => t(runtimeSurfaceLabelKey(s))).join(" · ")}
                    </FactRow>
                    <FactRow label={t("codepuppy.ext.packSupport")}>
                      {t("codepuppy.ext.packSupportLowest", { tier: t(supportTierLabelKey(pf().lowestTier)) })}
                    </FactRow>
                    <p class="codepuppy-ext-dsec-t" style={{ margin: "12px 0 8px" }}>
                      {t("codepuppy.ext.packCapsTitle")}
                    </p>
                    <div class="codepuppy-ext-authz-box">
                      <For each={pf().caps}>
                        {(row) => <ExtGrantedCapRow cap={row.cap} subtitle={t("codepuppy.ext.packCapFrom", { names: packFromLabel(row.from) })} />}
                      </For>
                    </div>
                    <p class="codepuppy-ext-dnote">{t("codepuppy.ext.packFactsNote")}</p>
                  </>
                )
              })()}
            </Show>
          </Section>
        )}
      </Show>

      {/* ── 类型专属槽(T2 骨架:已有事实;T3 填 tools[]/SKILL.md/hooks/权限档) ── */}
      <Section title={typeLabel(header().type as CatalogEntry["type"])}>
        <Show when={entry()}>
          {(e) => (
            <>
              {/* MCP:transport/命令/范围 + 精选工具列表(T3,catalog tools[];引擎无查询路由) */}
              <Show when={mcpSpec(e())}>
                {(spec) => (
                  <>
                    <FactRow label={t("codepuppy.ext.detailTransport")}>
                      {spec().mcpType === "remote" ? t("codepuppy.ext.transportRemote") : t("codepuppy.ext.transportLocal")}
                    </FactRow>
                    <Show when={spec().command?.length}>
                      <FactRow label={t("codepuppy.ext.detailCommand")}>
                        <code class="codepuppy-ext-dcode">{spec().command!.join(" ")}</code>
                      </FactRow>
                    </Show>
                    <Show when={spec().url}>
                      <FactRow label={t("codepuppy.ext.detailEndpoint")}>
                        <code class="codepuppy-ext-dcode">{spec().url}</code>
                      </FactRow>
                    </Show>
                    <FactRow label={t("codepuppy.ext.detailScope")}>{t("codepuppy.ext.scopeGlobal")}</FactRow>
                    <Show when={(e().tools ?? []).length > 0}>
                      <div class="codepuppy-ext-dsub">
                        <div class="codepuppy-ext-dsub-t">{t("codepuppy.ext.detailTools")}</div>
                        <div class="codepuppy-ext-dtools">
                          <For each={e().tools}>
                            {(tool) => (
                              <div class="codepuppy-ext-dtool">
                                <code>{tool.name}</code>
                                <span>{tool.description}</span>
                              </div>
                            )}
                          </For>
                        </div>
                        <p class="codepuppy-ext-dnote">{t("codepuppy.ext.toolsHint")}</p>
                      </div>
                    </Show>
                  </>
                )}
              </Show>
              {/* Skill:安装位置 + SKILL.md 全文(T3,builtin 资产只读预览) */}
              <Show when={skillSpec(e())}>
                {(spec) => (
                  <>
                    <FactRow label={t("codepuppy.ext.detailInstallDir")}>{t("codepuppy.ext.scopeGlobal")}</FactRow>
                    <FactRow label={t("codepuppy.ext.detailTrigger")}>{catalogDescription(e())}</FactRow>
                    <Show when={spec().builtinAssetKey} fallback={<p class="codepuppy-ext-dnote">{t("codepuppy.ext.skillDocMissing")}</p>}>
                      <div class="codepuppy-ext-dsub">
                        <div class="codepuppy-ext-dsub-t">{t("codepuppy.ext.detailSkillDoc")}</div>
                        <Show when={!skillDoc.loading} fallback={<p class="codepuppy-ext-dnote">{t("codepuppy.ext.loading")}</p>}>
                          <Show
                            when={skillDoc()?.ok && skillDoc()}
                            fallback={
                              <p class="codepuppy-ext-dnote" data-err="">
                                {t((skillDoc() as { reason?: string } | undefined)?.reason === "技能内容未随此版本打包" ? "codepuppy.ext.skillDocMissing" : "codepuppy.ext.skillDocReadFailed")}
                              </p>
                            }
                          >
                            {(doc) => <pre class="codepuppy-ext-ddoc">{(doc() as { content: string }).content}</pre>}
                          </Show>
                        </Show>
                      </div>
                    </Show>
                  </>
                )}
              </Show>
              {/* Plugin:npm 包 + hooks 清单 + D4 澄清 + 风险与生效方式(T3) */}
              <Show when={pluginSpec(e())}>
                {(spec) => (
                  <>
                    <FactRow label={t("codepuppy.ext.detailPackage")}>
                      <code class="codepuppy-ext-dcode">
                        {spec().package}
                        {spec().version ? `@${spec().version}` : ""}
                      </code>
                    </FactRow>
                    <Show when={(e().hooks ?? []).length > 0}>
                      <div class="codepuppy-ext-dsub">
                        <div class="codepuppy-ext-dsub-t">{t("codepuppy.ext.detailHooks")}</div>
                        <div class="codepuppy-ext-dtools">
                          <For each={e().hooks}>
                            {(h) => (
                              <div class="codepuppy-ext-dtool">
                                <code>{h.name}</code>
                                <span>{h.description}</span>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>
                    <div class="codepuppy-ext-dsub">
                      <div class="codepuppy-ext-dsub-t">{t("codepuppy.ext.detailRisk")}</div>
                      <p class="codepuppy-ext-dboundary">{t("codepuppy.ext.pluginRisk")}</p>
                      <p class="codepuppy-ext-dnote">{t("codepuppy.ext.pluginEffect")}</p>
                    </div>
                    {/* D4 拍板:「插件 ≠ 套件」澄清 */}
                    <div class="codepuppy-ext-verify-note" data-info="">
                      <b>{t("codepuppy.ext.pluginVsBundleTitle")}</b>
                      <p>{t("codepuppy.ext.pluginVsBundle")}</p>
                    </div>
                  </>
                )}
              </Show>
              {/* Agent 条目(REQ-023):安装位置 + md 资产预览(含权限档 frontmatter,详情页先行档) */}
              <Show when={e().installSpec?.kind === "agent"}>
                <FactRow label={t("codepuppy.ext.detailInstallDir")}>{t("codepuppy.ext.scopeGlobal")}</FactRow>
                <div class="codepuppy-ext-dsub">
                  <div class="codepuppy-ext-dsub-t">{t("codepuppy.ext.detailAgentDoc")}</div>
                  <Show when={!skillDoc.loading} fallback={<p class="codepuppy-ext-dnote">{t("codepuppy.ext.loading")}</p>}>
                    <Show
                      when={skillDoc()?.ok && skillDoc()}
                      fallback={
                        <p class="codepuppy-ext-dnote" data-err="">
                          {t(!skillDoc() || (skillDoc() as { reason?: string }).reason === "技能内容未随此版本打包" ? "codepuppy.ext.agentDocMissing" : "codepuppy.ext.agentDocReadFailed")}
                        </p>
                      }
                    >
                      {(doc) => <pre class="codepuppy-ext-ddoc">{(doc() as { content: string }).content}</pre>}
                    </Show>
                  </Show>
                </div>
              </Show>
              {/* 云 pipeline:#1595 AC2 首屏只说最长运行 / 发送内容 / 结果 / 费用;任务类型、运行环境、
                  轮次与 token 额度、输入字段收进「开发者详情」。 */}
              <Show when={cloudSpec(e())}>
                {(spec) => {
                  const fmtBudget = (b: { max_iter: number; max_tokens: number; max_wall_clock_sec: number }) =>
                    `${b.max_iter} iter · ${b.max_tokens.toLocaleString()} tokens · ${b.max_wall_clock_sec}s`
                  return (
                    <>
                      <div data-codepuppy-cloud-task-facts>
                        <FactRow label={t("codepuppy.ext.cloudWhat")}>{catalogDescription(e())}</FactRow>
                        <FactRow label={t("codepuppy.ext.cloudMaxRun")}>
                          {t("codepuppy.ext.cloudMaxRunValue", { min: cloudMaxRunMinutes(spec().budgetDefaults.max_wall_clock_sec) })}
                        </FactRow>
                        <FactRow label={t("codepuppy.ext.cloudSends")}>
                          <ul class="codepuppy-ext-dlist">
                            <For each={spec().upstreamData}>{(line) => <li>{line}</li>}</For>
                          </ul>
                        </FactRow>
                        <FactRow label={t("codepuppy.ext.cloudResult")}>{t("codepuppy.ext.cloudResultValue")}</FactRow>
                        <FactRow label={t("codepuppy.ext.cloudCost")}>{t("codepuppy.ext.cloudCostValue")}</FactRow>
                      </div>
                      <details class="codepuppy-ext-dprompt" data-codepuppy-cloud-task-dev>
                        <summary>{t("codepuppy.timeline.devDetails")}</summary>
                        <FactRow label={t("codepuppy.ext.cloudPipelineKind")}>
                          <code class="codepuppy-ext-dcode">{spec().pipelineKind}</code>
                        </FactRow>
                        <FactRow label={t("codepuppy.ext.cloudTier")}>{spec().tier}</FactRow>
                        <FactRow label={t("codepuppy.ext.cloudBudget")}>{fmtBudget(spec().budgetDefaults)}</FactRow>
                        <FactRow label={t("codepuppy.ext.cloudBudgetLimits")}>{fmtBudget(spec().budgetLimits)}</FactRow>
                        <div class="codepuppy-ext-dsub">
                          <div class="codepuppy-ext-dsub-t">{t("codepuppy.ext.cloudInputContract")}</div>
                          <div class="codepuppy-ext-dtools">
                            <For each={spec().inputContract}>
                              {(f) => (
                                <div class="codepuppy-ext-dtool">
                                  <code>
                                    {f.field}
                                    {f.required ? " *" : ""}
                                  </code>
                                  <span>{f.description}</span>
                                </div>
                              )}
                            </For>
                          </div>
                        </div>
                      </details>
                      <p class="codepuppy-ext-dnote">{t("codepuppy.ext.cloudEnableNote")}</p>
                      {/* `#624`:恢复中也禁用,但理由不同 —— 不能说「需登录」。 */}
                      <Show when={!cloudReady()}>
                        <p class="codepuppy-ext-dnote" data-err="">
                          {cloudRecovering()
                            ? t("codepuppy.ext.cloudRecoveringNote")
                            : t("codepuppy.ext.cloudNeedPlatformNote")}
                        </p>
                      </Show>
                      <CloudDispatchBox entryId={e().id} spec={spec()} ready={cloudReady()} recovering={cloudRecovering()} />
                    </>
                  )
                }}
              </Show>
              {/* 套件:组合清单(序号 + 逐项状态 + 未装项行内安装 = 逐项重试,T3) */}
              <Show when={e().type === "bundle"}>
                <div class="codepuppy-ext-dbundle">
                  <For each={(e().bundleItems ?? []).slice().sort((a, b) => a.installOrder - b.installOrder)}>
                    {(it, idx) => {
                      const sub = props.byId(it.catalogEntryId)
                      if (!sub) return null
                      const ic = iconFor(sub)
                      const subInstalled = () => props.ext.isInstalled(sub)
                      const subRetired = () => isRetiredCommunityOffice(sub)
                      return (
                        <div
                          class="codepuppy-ext-dbundle-row"
                          role="button"
                          tabindex="0"
                          onClick={() => props.onOpenEntry(sub)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault()
                              props.onOpenEntry(sub)
                            }
                          }}
                        >
                          <span class="codepuppy-ext-dbundle-n">{idx() + 1}</span>
                          <span class="codepuppy-ext-install-ic" style={{ background: ic.color }}>
                            {ic.glyph}
                          </span>
                          <span class="codepuppy-ext-install-nm">{sub.displayName}</span>
                          <Show when={it.optional}>
                            <span class="codepuppy-ext-install-opt">{t("codepuppy.ext.optional")}</span>
                          </Show>
                          <span class="codepuppy-ext-install-k">{typeLabel(sub.type)}</span>
                          <Show
                            when={subInstalled()}
                            fallback={
                              <button
                                class="codepuppy-ext-add"
                                disabled={props.busy() === sub.id || subRetired()}
                                title={subRetired() ? t("codepuppy.ext.retiredCommunityNoInstallHint") : undefined}
                                onClick={(ev) => {
                                  ev.stopPropagation()
                                  props.onInstall(sub)
                                }}
                              >
                                {subRetired()
                                  ? t("codepuppy.ext.retiredCommunityNoInstall")
                                  : props.busy() === sub.id
                                    ? t("codepuppy.ext.adding")
                                    : t("codepuppy.ext.add")}
                              </button>
                            }
                          >
                            <span class="codepuppy-ext-dhead-installed">✓</span>
                          </Show>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </>
          )}
        </Show>
        {/* Agent:mode/来源/model/variant + 系统提示预览(折叠)+ 权限档摘要(T3) */}
        <Show when={agent()}>
          {(a) => (
            <>
              <FactRow label={t("codepuppy.ext.detailMode")}>{a().mode}</FactRow>
              <FactRow label={t("codepuppy.ext.detailSource")}>
                {a().native ? t("codepuppy.ext.agentBuiltinNote") : t("codepuppy.ext.agentSelf")}
              </FactRow>
              <Show when={a().model}>
                <FactRow label={t("codepuppy.ext.detailModel")}>
                  <code class="codepuppy-ext-dcode">
                    {a().model!.providerID}/{a().model!.modelID}
                  </code>
                </FactRow>
              </Show>
              <Show when={a().variant}>
                <FactRow label={t("codepuppy.ext.detailVariant")}>{a().variant}</FactRow>
              </Show>
              <div class="codepuppy-ext-dsub">
                <div class="codepuppy-ext-dsub-t">{t("codepuppy.ext.detailPermission")}</div>
                {/* v2 SDK PermissionRuleset = Array<PermissionRule>(运行时已证);Array.isArray
                    防御 v1/未来形状漂移 —— 形状不符时诚实落到「随引擎默认」而非崩。 */}
                <Show
                  when={Array.isArray(a().permission) && (a().permission ?? []).length > 0}
                  fallback={<p class="codepuppy-ext-dnote">{t("codepuppy.ext.permissionDefault")}</p>}
                >
                  <div class="codepuppy-ext-dtools">
                    <For each={(a().permission ?? []).slice(0, 10)}>
                      {(rule) => (
                        <div class="codepuppy-ext-dtool">
                          <code>
                            {rule.permission}
                            {rule.pattern && rule.pattern !== "*" ? ` (${rule.pattern})` : ""}
                          </code>
                          <span data-action={rule.action}>{rule.action}</span>
                        </div>
                      )}
                    </For>
                  </div>
                  <Show when={(a().permission ?? []).length > 10}>
                    <p class="codepuppy-ext-dnote">+{(a().permission ?? []).length - 10}</p>
                  </Show>
                </Show>
              </div>
              <Show when={a().prompt}>
                <details class="codepuppy-ext-dprompt">
                  <summary>{t("codepuppy.ext.detailPrompt")}</summary>
                  <pre class="codepuppy-ext-ddoc">{a().prompt}</pre>
                </details>
              </Show>
            </>
          )}
        </Show>
        {/* 云连接器(REQ-020 T3):实时连接状态 + 4 工具 + 注入说明(非安装项,mcp.cloud 由
            sidecar 在 platform 登录态注入 —— 未点亮时不装「即将可用」,说清为什么灰) */}
        <Show when={isCloudConnector()}>
          <FactRow label={t("codepuppy.ext.cloudConnStatus")}>
            <Show
              when={cloudReady()}
              fallback={
                <span class="codepuppy-ext-cloudst" data-st={cloudRecovering() ? "idle" : "off"}>
                  {cloudRecovering() ? t("codepuppy.ext.cloudConnRecovering") : t("codepuppy.ext.cloudConnNeedLogin")}
                </span>
              }
            >
              <span class="codepuppy-ext-cloudst" data-st={cloudLive()?.connected ? "on" : "idle"}>
                {cloudLive()?.needsAuth ? t("codepuppy.ext.mcpNeedsAuth") : cloudLive()?.connected ? t("codepuppy.ext.cloudConnConnected") : t("codepuppy.ext.cloudConnDisconnected")}
              </span>
            </Show>
          </FactRow>
          <FactRow label={t("codepuppy.ext.detailTransport")}>{t("codepuppy.ext.transportRemote")}</FactRow>
          <Show when={!cloudReady() && props.onLogin}>
            <div class="codepuppy-ext-dsub">
              <button class="codepuppy-ext-add" data-variant="primary" onClick={() => props.onLogin!()}>
                {t("codepuppy.auth.signIn")}
              </button>
            </div>
          </Show>
          <div class="codepuppy-ext-dsub" data-codepuppy-cloud-tools>
            <div class="codepuppy-ext-dsub-t">{t("codepuppy.ext.detailTools")}</div>
            <div class="codepuppy-ext-dtools">
              <For each={CLOUD_TOOLS}>
                {(tool) => (
                  <div class="codepuppy-ext-dtool">
                    <b>{t(tool.titleKey)}</b>
                    <span>{t(tool.key)}</span>
                  </div>
                )}
              </For>
            </div>
            <p class="codepuppy-ext-dnote">{t("codepuppy.ext.toolsHint")}</p>
          </div>
          <div class="codepuppy-ext-verify-note" data-info="">
            <b>{t("codepuppy.ext.cloudInjectTitle")}</b>
            <p>{t("codepuppy.ext.cloudInjectNote")}</p>
          </div>
          <details class="codepuppy-ext-dprompt" data-codepuppy-cloud-tools-dev>
            <summary>{t("codepuppy.timeline.devDetails")}</summary>
            <div class="codepuppy-ext-dtools">
              <For each={CLOUD_TOOLS}>
                {(tool) => (
                  <div class="codepuppy-ext-dtool">
                    <code>{`codepuppy:${tool.name}`}</code>
                    <span>{t(tool.titleKey)}</span>
                  </div>
                )}
              </For>
            </div>
          </details>
        </Show>
      </Section>

      {/* ── 数据边界(T2 基线:remote=目的 host,local=仅本机;REQ-020:云条目/连接器引 ADR-021)
          #397:curated 整段真源切换 —— 能力面(用户语言 pills,未知 token 原样)+ 域名清单
          (≤6 全列,>6 折叠);签名摘要是展示真源,不重算替换。uncurated 走旧真源不混排。 ── */}
      <Section title={t("codepuppy.ext.detailBoundary")}>
        <Show
          when={curated()}
          fallback={
            <p class="codepuppy-ext-dboundary">
              <Show
                when={entry()}
                fallback={isCloudConnector() ? t("codepuppy.ext.boundaryCloud") : t("codepuppy.ext.boundaryLocalOnly")}
              >
                {(e) => {
                  const spec = mcpSpec(e())
                  if (spec?.mcpType === "remote") return t("codepuppy.ext.boundaryRemote", { host: hostOf(spec.url) })
                  // 本地命令型 MCP 不等于「不出网」——进程在本机跑,但可能按其功能访问外部服务
                  // (如 GitHub 连接器访问 github.com)。逐条目的地列举归 T4;这里只做诚实概述。
                  if (spec) return t("codepuppy.ext.boundaryLocalCmd")
                  if (e().type === "plugin") return t("codepuppy.ext.boundaryPluginProc")
                  if (e().type === "bundle") return t("codepuppy.ext.boundaryBundle")
                  if (e().type === "cloud") return t("codepuppy.ext.boundaryCloud")
                  return t("codepuppy.ext.boundaryLocalOnly")
                }}
              </Show>
            </p>
          }
        >
          {(c) => {
            const domains = () => foldDomains(c().summaries.networkDomains)
            const [domainsOpen, setDomainsOpen] = createSignal(false)
            return (
              <>
                <Show
                  when={c().summaries.capabilities.length > 0 || c().summaries.networkDomains.length > 0}
                  fallback={<p class="codepuppy-ext-dnote">{t("codepuppy.ext.boundaryNone")}</p>}
                >
                  <Show when={c().summaries.capabilities.length > 0}>
                    <div class="codepuppy-ext-dpills">
                      <For each={c().summaries.capabilities}>
                        {(cap) => {
                          const key = CAPABILITY_LABEL_KEYS[cap]
                          return <span class="codepuppy-ext-meta">{key ? t(key as never) : <code>{cap}</code>}</span>
                        }}
                      </For>
                    </div>
                  </Show>
                  <Show when={c().summaries.networkDomains.length > 0}>
                    <p class="codepuppy-ext-dnote">{t("codepuppy.ext.boundaryDomainsIntro", { count: String(c().summaries.networkDomains.length) })}</p>
                    <div class="codepuppy-ext-domlist">
                      {(domainsOpen() ? c().summaries.networkDomains : domains().shown).join(" · ")}
                      <Show when={domains().folded && !domainsOpen()}>
                        {" "}
                        <button class="codepuppy-ext-ghostbtn" onClick={() => setDomainsOpen(true)}>
                          {t("codepuppy.ext.domainsShowAll", { count: String(domains().total) })}
                        </button>
                      </Show>
                    </div>
                  </Show>
                  <p class="codepuppy-ext-dnote">{t("codepuppy.ext.boundaryDomainsNote")}</p>
                </Show>
              </>
            )
          }}
        </Show>
      </Section>

      {/* ── 运行时依赖(T4:进页即实时 which 检测;缺失给安装指引,不等点「添加」才发现) ── */}
      <Show when={entry()}>
        <Section title={t("codepuppy.ext.detailRuntime")}>
          {/* #397:curated 供集 = 甄选摘要(需要什么);✓/✗ 仍是本地 which 实测(有没有)。 */}
          <Show
            when={runtimeDepList().length > 0}
            fallback={
              <Show when={officeEntry()} fallback={<p class="codepuppy-ext-dnote">{t("codepuppy.ext.noRuntimeDeps")}</p>}>
                <div class="codepuppy-ext-dpills">
                  <span class="codepuppy-ext-meta" data-dep={officeRuntimeState()}>
                    {t("codepuppy.ext.officeRuntime")}
                    {officeRuntimeState() === "checking" ? ` · ${t("codepuppy.ext.depChecking")}` : officeRuntimeState() === "ok" ? " ✓" : ` ✗ ${t("codepuppy.ext.depMissing")}`}
                  </span>
                </div>
                <Show when={officeRuntimeState() === "missing"}>
                  <div class="codepuppy-ext-verify-note">
                    <p>{t("codepuppy.ext.officeRuntimeMissing")}</p>
                  </div>
                </Show>
              </Show>
            }
          >
            <div class="codepuppy-ext-dpills">
              <For each={runtimeDepList()}>
                {(dep) => {
                  const state = () => {
                    if (depCheck.loading || !depCheck()) return "checking"
                    const hit = depCheck()!.find((r) => r.dep === dep)
                    return hit ? (hit.ok ? "ok" : "missing") : "checking"
                  }
                  return (
                    <span class="codepuppy-ext-meta" data-dep={state()}>
                      {dep}
                      {state() === "checking" ? ` · ${t("codepuppy.ext.depChecking")}` : state() === "ok" ? " ✓" : ` ✗ ${t("codepuppy.ext.depMissing")}`}
                    </span>
                  )
                }}
              </For>
            </div>
            <Show when={!depCheck.loading && (depCheck() ?? []).some((r) => !r.ok)}>
              <div class="codepuppy-ext-verify-note">
                <b>{t("codepuppy.ext.depMissingTitle")}</b>
                <For each={(depCheck() ?? []).filter((r) => !r.ok)}>
                  {(r) => (
                    <p>
                      {t("codepuppy.ext.depGuide", { dep: r.dep })} <code class="codepuppy-ext-dcode">{DEP_GUIDE[r.dep] ?? `brew install ${r.dep}`}</code>
                    </p>
                  )}
                </For>
              </div>
            </Show>
          </Show>
          <Show when={entry()?.id === "mcp:playwright"}>
            <div class="codepuppy-ext-verify-note" data-info="">
              <p>{t("codepuppy.ext.playwrightRuntimeNote")}</p>
            </div>
          </Show>
        </Section>

        {/* ── 所需密钥(#397:curated 改读甄选摘要 —— 名称 + 来源标注;永不显示值)── */}
        <Section title={t("codepuppy.ext.detailSecrets")}>
          <Show
            when={curated()}
            fallback={
              <Show
                when={(mcpSpec(entry()!)?.requiredEnvVars ?? []).length > 0}
                fallback={<p class="codepuppy-ext-dnote">{t("codepuppy.ext.noSecrets")}</p>}
              >
                <div class="codepuppy-ext-dpills">
                  <For each={mcpSpec(entry()!)!.requiredEnvVars}>
                    {(v) => (
                      <span class="codepuppy-ext-meta">
                        <LockIc />
                        {v}
                      </span>
                    )}
                  </For>
                </div>
                <p class="codepuppy-ext-dnote">{t("codepuppy.ext.keyHint")}</p>
              </Show>
            }
          >
            {(c) => {
              // r1-3(Minor):按来源分组如实标注 —— 合同允许同条目混合 environment/connection,
              // 整组归为环境变量会把 connection 密钥的来源说错;逐组各配各的说明。
              const envSecrets = () => c().summaries.requiredSecrets.filter((s) => s.source === "environment")
              const connSecrets = () => c().summaries.requiredSecrets.filter((s) => s.source === "connection")
              return (
                <Show
                  when={c().summaries.requiredSecrets.length > 0}
                  fallback={<p class="codepuppy-ext-dnote">{t("codepuppy.ext.noSecrets")}</p>}
                >
                  <Show when={envSecrets().length > 0}>
                    <div class="codepuppy-ext-dpills">
                      <For each={envSecrets()}>
                        {(s) => (
                          <span class="codepuppy-ext-meta">
                            <LockIc />
                            {s.name}
                          </span>
                        )}
                      </For>
                    </div>
                    <p class="codepuppy-ext-dnote">{t("codepuppy.ext.secretsFromEnvNote")}</p>
                  </Show>
                  <Show when={connSecrets().length > 0}>
                    <div class="codepuppy-ext-dpills">
                      <For each={connSecrets()}>
                        {(s) => (
                          <span class="codepuppy-ext-meta">
                            <LockIc />
                            {s.name}
                          </span>
                        )}
                      </For>
                    </div>
                    <p class="codepuppy-ext-dnote">{t("codepuppy.ext.secretsFromConnNote")}</p>
                  </Show>
                </Show>
              )
            }}
          </Show>
        </Section>

        {/* ── #397:fail-closed 的一行如实上报(仅 invalid 态渲染;无 curation = 正常未分级,零说明)── */}
        <Show when={cst().kind === "invalid"}>
          <Section title={t("codepuppy.ext.gradeFailTitle")}>
            <p class="codepuppy-ext-dnote">{t("codepuppy.ext.gradeFailBody")}</p>
          </Section>
        </Show>

        {/* ── #397→#408:实验室条目的「启用方式」(session-grant 语义讲人话;会话开关已落地,
            文案改为现实 —— 已装态还给当前会话状态一行,与开关状态机同真源)── */}
        <Show when={sessionGrantNow()}>
          <Section title={t("codepuppy.ext.labsHowTitle")}>
            <p class="codepuppy-ext-dnote">{t("codepuppy.ext.labsHowBody")}</p>
            <Show when={entry() && entry()!.type === "mcp" && installed()}>
              <p class="codepuppy-ext-dnote">{t(props.sessionViewFor(entry()!.id).textKey)}</p>
            </Show>
          </Section>
        </Show>
      </Show>

      {/* ── REQ-103(#195)所有权段(AC1:作者与甄选分开陈述,永不塌缩成「Code Puppy 出品」)──
          能力授权总账和信任链不该是独立页面 —— 就在「你正在看的这个扩展」里。段顺序 = 已批设计稿
          (2026-07-17):所有权 → 已授权能力 → 来源与签名。 */}
      <Show when={govRow()}>
        {(row) => (
          <>
            <Section title={t("codepuppy.ext.ownTitle")}>
              <FactRows rows={detailOwnershipRows(row().ownership)} />
              <p class="codepuppy-ext-dnote">{t(row().ownership.curated === "codepuppy" ? "codepuppy.ext.ownNote" : "codepuppy.ext.ownNoteSelfAdded")}</p>
            </Section>
            {/* ── #392 已授权能力段:#348 授权账(ext-store/<key>/grants.json)的被动查询面。对安装行渲染
                (grant 只随 committed 安装存在);无记录 = 如实空态,绝不回填按类型派生的"本应请求"
                集(未经确认的猜测不进总账);capabilities=[](未策展导入)如实说明未请求任何能力。
                Codex r1 m1 + r2 修正:live-but-unreceipted MCP(governance 里是 scope=null 浏览行,
                但本页按合成收据视为已安装)同样出段 —— 显示「没有授权记录」空态,而不是整段消失。
                门精确到 mcp:bundle 的 installed() 是"必选子项全装"的派生真(自身无账本行),授权
                记录属于各子项,bundle 详情不得冒出误导性的"无授权记录"。 ── */}
            <Show when={row().scope !== null || (entry()?.type === "mcp" && installed())}>
              <Section title={t("codepuppy.ext.grantedTitle")}>
                <Show
                  when={row().granted}
                  fallback={
                    <div class="codepuppy-ext-authz-box">
                      <p class="codepuppy-ext-authz-empty">{t("codepuppy.ext.grantedEmpty")}</p>
                    </div>
                  }
                >
                  {(g) => (
                    <>
                      <div class="codepuppy-ext-authz-box">
                        <Show
                          when={g().capabilities.length > 0}
                          fallback={<p class="codepuppy-ext-authz-empty">{t("codepuppy.ext.grantedNone")}</p>}
                        >
                          <For each={g().capabilities}>{(cap) => <ExtGrantedCapRow cap={cap} />}</For>
                        </Show>
                      </div>
                      <p class="codepuppy-ext-dnote">
                        {t("codepuppy.ext.grantedMeta", { date: g().grantedAt.slice(0, 10) })}
                      </p>
                    </>
                  )}
                </Show>
              </Section>
            </Show>
            {/* ── 来源与签名段:信任链就近呈现(签名通道 + 分发 + 目录版本;发布钥不在读面 → 省略)── */}
            <Section title={t("codepuppy.ext.trustTitle")}>
              <FactRows
                rows={trustRows(
                  row().ownership,
                  props.governance?.()?.catalogChannel ?? null,
                  props.governance?.()?.catalogVersion ?? null,
                )}
              />
              <p class="codepuppy-ext-dnote">{t("codepuppy.ext.trustNote")}</p>
            </Section>
          </>
        )}
      </Show>

      {/* ── #397 改动三:「组件与来源」段(置段尾:数据按需拉取、不参与任何判定,合同 §7.3)——
          逐 blob 独立校验态 + 失败 loud + 重试;绝不整段消失或静默留白。 ── */}
      <Show when={curated()}>
        <Section title={t("codepuppy.ext.sbomTitle")}>
          <div class="codepuppy-ext-sbomrow">
            <span class="codepuppy-ext-sbomst" data-tone={sbomBlob.loading ? undefined : sbomBlob()?.ok ? "ok" : "err"}>
              {sbomBlob.loading ? "…" : sbomBlob()?.ok ? "✓" : "!"}
            </span>
            <div class="codepuppy-ext-sbombd">
              <Show when={!sbomBlob.loading} fallback={<b>{t("codepuppy.ext.blobLoading")}</b>}>
                <Show
                  when={sbomBlob()?.ok}
                  fallback={
                    <>
                      <b>{t("codepuppy.ext.sbomLoadFail")}</b>
                      <small>{t("codepuppy.ext.blobFailNote")}</small>
                    </>
                  }
                >
                  <b>
                    {t("codepuppy.ext.sbomRowComponents")} · {t("codepuppy.ext.sbomComponentsCount", { count: String(sbomComponents().length) })} ·{" "}
                    {t("codepuppy.ext.sbomVerified")}
                  </b>
                  <Show when={sbomComponents().length > 0}>
                    <small>
                      {(sbomOpen() ? sbomComponents() : sbomComponents().slice(0, 3)).map((c) => `${c.name}@${c.version}`).join(" · ")}
                    </small>
                  </Show>
                </Show>
              </Show>
            </div>
            <Show
              when={!sbomBlob.loading && sbomBlob()?.ok && sbomComponents().length > 3}
              fallback={
                <Show when={!sbomBlob.loading && sbomBlob() && !sbomBlob()!.ok}>
                  <button class="codepuppy-ext-ghostbtn" onClick={() => void refetchSbom()}>
                    {t("codepuppy.ext.blobRetry")}
                  </button>
                </Show>
              }
            >
              <button class="codepuppy-ext-ghostbtn" onClick={() => setSbomOpen(!sbomOpen())}>
                {sbomOpen() ? t("codepuppy.ext.sbomCollapse") : t("codepuppy.ext.sbomExpand")}
              </button>
            </Show>
          </div>
          <div class="codepuppy-ext-sbomrow">
            <span class="codepuppy-ext-sbomst" data-tone={provBlob.loading ? undefined : provBlob()?.ok ? "ok" : "err"}>
              {provBlob.loading ? "…" : provBlob()?.ok ? "✓" : "!"}
            </span>
            <div class="codepuppy-ext-sbombd">
              <Show when={!provBlob.loading} fallback={<b>{t("codepuppy.ext.blobLoading")}</b>}>
                <Show
                  when={provFacts()}
                  fallback={
                    <>
                      <b>{t("codepuppy.ext.provLoadFail")}</b>
                      <small>{t("codepuppy.ext.blobFailNote")}</small>
                    </>
                  }
                >
                  {(p) => (
                    <>
                      <b>
                        {t("codepuppy.ext.provRowTitle")} · {t("codepuppy.ext.sbomVerified")}
                      </b>
                      <small class="codepuppy-ext-sbommono">
                        {p().locator} · {p().resolved.length > 24 ? `${p().resolved.slice(0, 24)}…` : p().resolved}
                      </small>
                    </>
                  )}
                </Show>
              </Show>
            </div>
            <Show when={!provBlob.loading && provBlob() && !provBlob()!.ok}>
              <button class="codepuppy-ext-ghostbtn" onClick={() => void refetchProv()}>
                {t("codepuppy.ext.blobRetry")}
              </button>
            </Show>
          </div>
          <p class="codepuppy-ext-dnote">{t("codepuppy.ext.sbomNote")}</p>
        </Section>
      </Show>

    </div>
  )
}
