// Shared presentational helpers for the Extension Hub (定制中心) — icon/glyph resolution, source/
// type labels, and tiny inline SVG icons. Extracted from extension-hub.tsx (REQ-019 T2) so the
// detail page (extension-detail.tsx) can reuse them without a hub ↔ detail import cycle.
// Pure presentation: no store access, no IPC.

import { createEffect, createRoot, createSignal, For, onCleanup, Show } from "solid-js"
import type { CatalogEntry, CatalogSource } from "./catalog-types"
import type { InstallReceiptType } from "../../preload/types"
import type { PackageListingV1 } from "../../shared/host-extension-package-contract/decoder"
import { packageListingTextV1 } from "../../shared/host-extension-package-contract/decoder"
import { t } from "../i18n"
import { isNetFailureLayer, PLUGIN_MCP_SERVICE_UNAVAILABLE } from "@opencode/schema/codepuppy-net-failure"
import { netFailureCopy } from "../codepuppy-ui/net-failure-copy"

// Presentational only — the catalog carries no icon glyph/color. Keyed by id, falling back to the
// category tint + the displayName initial. (Kept here, not in the catalog, so the data file stays
// pure metadata.)
export const CAT_COLOR: Record<string, string> = {
  dev: "#4f46e5",
  office: "#16a34a",
  research: "#2563eb",
  "china-office": "#00b4d8",
  design: "#7c3aed",
  cloud: "#5c7cbf",
}
const ICON_COLOR: Record<string, string> = {
  "mcp:playwright": "#7c3aed",
  "mcp:github": "#24292f",
  "mcp:yuque": "#1f7a4d",
}
const ICON_GLYPH: Record<string, string> = {
  "mcp:markitdown": "文",
  "mcp:filesystem": "FS",
  "mcp:fetch": "网",
  "mcp:playwright": "▶",
  "mcp:git": "Git",
  "mcp:github": "GH",
  "mcp:codepuppy-word": "W",
  "mcp:codepuppy-excel": "X",
  "mcp:codepuppy-powerpoint": "P",
  "mcp:codepuppy-pdf": "PDF",
  "mcp:feishu": "飞",
  "mcp:yuque": "语",
  "skill:skill-creator": "技",
  "skill:codepuppy-upstream-sync": "同",
  "skill:safe-refactor": "重",
  "bundle:office": "办",
  "bundle:research": "研",
  "bundle:dev": "开",
  "bundle:china-office": "中",
  "cloud:code-review": "审",
  "cloud:research": "研",
  "cloud:docs": "档",
}
export function iconFor(e: CatalogEntry): { color: string; glyph: string } {
  return {
    color: ICON_COLOR[e.id] ?? CAT_COLOR[e.category] ?? "var(--a-accent-solid)",
    glyph: ICON_GLYPH[e.id] ?? e.displayName.slice(0, 1),
  }
}

// Icon for a non-catalog row (agents, receipt-only installs): type-tinted glyph from the name.
export const TYPE_TINT: Record<string, string> = {
  mcp: "var(--a-accent)",
  skill: "#7c9c5a",
  agent: "#c08457",
  plugin: "#8a6ec0",
  bundle: "#5a8a9c",
  cloud: "#5c7cbf",
}
export function iconForRow(entry: CatalogEntry | undefined, type: string, name: string): { color: string; glyph: string } {
  if (entry) return iconFor(entry)
  return { color: TYPE_TINT[type] ?? "var(--a-bg-inset)", glyph: (name[0] ?? "?").toUpperCase() }
}

export function sourceLabel(source: CatalogSource): string {
  if (source === "official") return t("codepuppy.ext.sourceOfficial")
  if (source === "community") return t("codepuppy.ext.sourceCommunity")
  return t("codepuppy.ext.sourceCodePuppy")
}

export function catalogDescription(entry: CatalogEntry): string {
  if (entry.id === "skill:codepuppy-upstream-sync") return t("codepuppy.ext.upstreamSyncDescription")
  return entry.description
}

// Human label for an item's type, reusing the section labels (连接器/技能/Agent/插件/套件/云).
export function typeLabel(type: InstallReceiptType | CatalogEntry["type"]): string {
  if (type === "mcp") return t("codepuppy.ext.tabConnectors")
  if (type === "skill") return t("codepuppy.ext.tabSkills")
  if (type === "agent") return t("codepuppy.ext.typeAgent")
  if (type === "command") return t("codepuppy.ext.typeCommand")
  if (type === "plugin") return t("codepuppy.ext.tabPlugins")
  if (type === "cloud") return t("codepuppy.ext.typeCloud")
  return t("codepuppy.ext.tabBundles")
}

// ── tiny inline icons (1.6 stroke, currentColor) ──────────────────────────────────────────────
export const Svg = (p: { d: string; box?: string; class?: string }) => (
  <svg class={p.class ?? "codepuppy-ic"} viewBox={p.box ?? "0 0 24 24"} fill="none" aria-hidden="true">
    <path d={p.d} stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
)
export const SearchIc = () => (
  <svg class="codepuppy-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.6" />
    <path d="M21 21l-4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
  </svg>
)
/** 定制中心的线条图标(冻结稿 `#i-*`):24 视口,线宽随尺寸由 `extension-hub.css` 的 `.a-ic.ic-*` 给。 */
const HUB_IC = {
  plus: () => <path d="M12 5v14M5 12h14" />,
  more: () => (
    <>
      <circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  down: () => <path d="m6 9.5 6 6 6-6" />,
  right: () => <path d="m9.5 18 6-6-6-6" />,
  left: () => <path d="m14.5 18-6-6 6-6" />,
  search: () => (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  loader: () => <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />,
  // 以下是冻结稿 `#hub-connectors` / `#hub-skills` 里行图标用的线条图标(原样取自 frame.html 的 symbol)。
  folder: () => <path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />,
  window: () => (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9h17" />
      <path d="M6.5 6.8h.01M9 6.8h.01" />
    </>
  ),
  "file-search": () => (
    <>
      <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5Z" />
      <path d="M14 3.5v5h5" />
      <circle cx="11.5" cy="14" r="2.5" />
      <path d="m13.4 15.9 1.8 1.8" />
    </>
  ),
  bug: () => (
    <>
      <rect x="7.5" y="7.5" width="9" height="12.5" rx="4.5" />
      <path d="M12 7.5V5M9.5 5.5 8 4M14.5 5.5 16 4M7.5 12.5H4M20 12.5h-3.5M7.5 16.5l-3 1.5M16.5 16.5l3 1.5" />
    </>
  ),
  branch: () => (
    <>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <circle cx="17" cy="8" r="2.2" />
      <path d="M7 8.2v7.6M17 10.2c0 3.6-3.5 4.4-8.3 5.6" />
    </>
  ),
  db: () => (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.6" />
      <path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" />
    </>
  ),
  pkg: () => (
    <>
      <path d="M4.5 7.5 12 3.5l7.5 4v9L12 20.5l-7.5-4Z" />
      <path d="M8.3 5.5 15.7 9.6V13" />
    </>
  ),
  "file-text": () => (
    <>
      <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5Z" />
      <path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h4.5" />
    </>
  ),
  table: () => (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15" />
    </>
  ),
  slides: () => (
    <>
      <path d="M3.5 4.5h17" />
      <rect x="5" y="4.5" width="14" height="10.5" rx="1" />
      <path d="M12 15v4.5M8.5 19.5h7" />
    </>
  ),
  file: () => (
    <>
      <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5Z" />
      <path d="M14 3.5v5h5" />
    </>
  ),
  plug: () => <path d="M9 3.5V8M15 3.5V8M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0ZM12 17v3.5" />,
}

/** 冻结稿里画了线条图标的行(键 = 目录 id / 扩展包 id / 出厂技能名);没画的行用单字图标。 */
const LINE_ICON_OF: Record<string, keyof typeof HUB_IC> = {
  "mcp:filesystem": "folder",
  "mcp:playwright": "window",
  "mcp:markitdown": "file-search",
  "mcp:chrome-devtools": "bug",
  "mcp:git": "branch",
  "mcp:dbhub-readonly": "db",
  "package:dbhub-readonly": "db",
  "skill:codepuppy-first": "pkg",
  "package:codepuppy-first": "pkg",
  "mcp:codepuppy-word": "file-text",
  "mcp:codepuppy-excel": "table",
  "mcp:codepuppy-powerpoint": "slides",
  "mcp:codepuppy-pdf": "file",
  "skill:conventional-commits": "branch",
  "plugin-helper": "plug",
  "skill:plugin-helper": "plug",
}
export function lineIconFor(id: string | undefined): keyof typeof HUB_IC | undefined {
  return id ? LINE_ICON_OF[id] : undefined
}
/** 行图标的内容:有稿里的线条图标就画 18px 线条,否则是单字。 */
export const KitIc = (p: { id?: string; glyph: string }) => (
  <Show when={lineIconFor(p.id)} fallback={p.glyph}>
    {(name) => <HubIc name={name()} size={18} />}
  </Show>
)
export const HubIc = (p: { name: keyof typeof HUB_IC; size?: 12 | 14 | 18 }) => (
  <svg class={`a-ic${p.size ? ` ic-${p.size}` : ""}`} viewBox="0 0 24 24" aria-hidden="true">
    {HUB_IC[p.name]()}
  </svg>
)
/** 名称旁的安静状态字(冻结稿 `.st`):圆点 + 一个词;只有「未能启用」是红的,进行中换成转圈。 */
export function RowStatus(p: { tone: "warn" | "err" | "off" | "progress"; text: string; attrs?: Record<string, string | undefined> }) {
  return (
    <span class="codepuppy-ext-st" data-tone={p.tone} data-row-status="" {...p.attrs}>
      <Show when={p.tone === "progress"} fallback={<i aria-hidden="true" />}>
        <HubIc name="loader" size={12} />
      </Show>
      {p.text}
    </span>
  )
}
export const LockIc = () => (
  <svg class="codepuppy-ic codepuppy-ic-xs" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.7" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.7" />
  </svg>
)

/** `separatorAfter`:这一项之后画一条细线(冻结稿 `#hub-row-menu`:登录 | 开启、管理 | 移除);危险项前总有一条。 */
export type MoreMenuItem = { key: string; label: string; onSelect: () => void; disabled?: boolean; danger?: boolean; checked?: boolean; separatorAfter?: boolean }

// 同一时刻只开一个菜单:点开另一个「…」时上一个自动收起。
const [openMenu, setOpenMenu] = createSignal<object | null>(null)
createRoot(() =>
  createEffect(() => {
    if (!openMenu()) return
    const close = () => setOpenMenu(null)
    document.addEventListener("click", close)
    onCleanup(() => document.removeEventListener("click", close))
  }),
)

/**
 * `#1594`(批准稿 `#hub-add` / `#hub-skills`):定制中心行上的「…」与页头的「添加 ▾」—— 一颗按钮,
 * 点开一列动作。点菜单外任意处收起。按钮与菜单项都拦住冒泡:行本身点下去是进详情页,不能顺带触发。
 */
export function MoreMenu(p: {
  id: string
  items: MoreMenuItem[]
  label?: string
  trigger?: string
  primary?: boolean
  disabled?: boolean
}) {
  const self = {}
  const open = () => openMenu() === self
  const setOpen = (value: boolean) => setOpenMenu(value ? self : null)
  onCleanup(() => {
    if (open()) setOpenMenu(null)
  })
  return (
    <div class="codepuppy-ext-more">
      <button
        class="codepuppy-ext-add"
        data-variant={p.primary ? "primary" : undefined}
        data-iact={p.trigger ? undefined : ""}
        data-more={p.id}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label={p.label ?? (p.trigger ? undefined : t("codepuppy.ext.more"))}
        title={p.trigger ? undefined : t("codepuppy.ext.more")}
        disabled={p.disabled}
        onClick={(ev) => {
          ev.stopPropagation()
          setOpen(!open())
        }}
      >
        <Show when={p.trigger} fallback={<HubIc name="more" />}>
          {p.trigger}
          <HubIc name="down" size={12} />
        </Show>
      </button>
      <Show when={open()}>
        <div class="codepuppy-ext-menu" role="menu" data-menu={p.id}>
          <For each={p.items}>
            {(item, index) => (
              <>
              <Show when={index() > 0 && (item.danger || p.items[index() - 1]?.separatorAfter)}>
                <div class="codepuppy-ext-menu-sep" role="separator" />
              </Show>
              <Show
                when={item.checked !== undefined}
                fallback={
                  <button
                    class="codepuppy-ext-menu-item"
                    role="menuitem"
                    data-menu-item={item.key}
                    data-variant={item.danger ? "danger" : undefined}
                    disabled={item.disabled}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      setOpen(false)
                      item.onSelect()
                    }}
                  >
                    {item.label}
                  </button>
                }
              >
                <label
                  class="codepuppy-ext-menu-item"
                  role="menuitemcheckbox"
                  aria-checked={item.checked}
                  data-menu-item={item.key}
                  data-switch=""
                  onClick={(event) => event.stopPropagation()}
                >
                  {item.label}
                  <button
                    class="codepuppy-ext-sw"
                    role="switch"
                    aria-label={item.label}
                    aria-checked={item.checked}
                    data-on={item.checked ? "" : undefined}
                    disabled={item.disabled}
                    onClick={(event) => {
                      event.stopPropagation()
                      setOpen(false)
                      item.onSelect()
                    }}
                  />
                </label>
              </Show>
              </>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

/**
 * `#1287`:签名扩展包的方形图标 —— 卡片与详情页共用这一份。
 *
 * 发布者没给 `logo` 时回落到首字母,**那是常态**:今天已发布的条目一个 `listing` 都没有。
 * `logoDark` 的切换交给 CSS(`extension-hub.css` 里那一组选择器逐字取自 `tokens.css` 的
 * 深色判据),而不是在 JS 里再实现一遍「现在算不算深色」—— 那会是同一条规则的第二个真源,
 * 且不会跟着用户中途换主题而更新。
 */
export function PackageLogo(p: { listing: PackageListingV1 | undefined; fallback: string }) {
  const logo = () => packageListingTextV1(p.listing, "logo")
  const logoDark = () => packageListingTextV1(p.listing, "logoDark")
  return (
    <Show when={logo()} fallback={(p.fallback[0] ?? "?").toUpperCase()}>
      {(light) => (
        <>
          <img
            class="codepuppy-ext-logo"
            data-package-logo="light"
            data-has-dark={logoDark() ? "" : undefined}
            src={light()}
            alt=""
            loading="lazy"
          />
          <Show when={logoDark()}>
            {(dark) => (
              <img
                class="codepuppy-ext-logo"
                data-package-logo="dark"
                src={dark()}
                alt=""
                loading="lazy"
              />
            )}
          </Show>
        </>
      )}
    </Show>
  )
}

// #1508: presentation only. IPC reasons and result discriminants stay unchanged.
const EXTENSION_REASON_KEYS: Record<string, Parameters<typeof t>[0]> = {
  "reload-pending": "codepuppy.ext.error.pendingReload",
  "project-scope-mcp-only": "codepuppy.ext.error.projectScopeType",
  "project-scope-missing-current-project": "codepuppy.ext.error.projectMissing",
  "project-scope-current-project-changed": "codepuppy.ext.error.projectChanged",
  "project-scope-secret-bearing-mcp": "codepuppy.ext.error.projectSecrets",
  "project-scope-workspace-policy-mcp": "codepuppy.ext.error.projectWorkspacePolicy",
  "project uninstall requires an open project (context lost — reopen the project session)": "codepuppy.ext.error.projectRemoveContext",
  "no server": "codepuppy.ext.error.noServer",
  "not an MCP entry": "codepuppy.ext.error.notConnector",
  "installed-disabled": "codepuppy.ext.error.installedDisabled",
  "connect-failed": "codepuppy.ext.error.connectFailed",
  // #1564 AC3:四个第一方 Office 条目的随包运行时缺失(具名原因 + 「重新安装 Code Puppy」)。
  "office-runtime-missing": "codepuppy.ext.officeRuntimeMissing",
  "slow": "codepuppy.ext.error.connecting",
  "mcp.add failed": "codepuppy.ext.error.connectSettings",
  "名称只能含字母数字 . _ -(1-64 位)": "codepuppy.ext.error.invalidName",
  "URL 必填": "codepuppy.ext.error.urlRequired",
  "命令必填": "codepuppy.ext.error.commandRequired",
  "auth-failed": "codepuppy.ext.error.authFailed",
  "project-scoped records have no enable switch": "codepuppy.ext.error.projectToggle",
  "not a skill entry": "codepuppy.ext.error.notSkill",
  "not a plugin entry": "codepuppy.ext.error.notPlugin",
  "not an agent entry": "codepuppy.ext.error.notAgent",
  "not a cloud entry": "codepuppy.ext.error.notCloud",
  "unsupported type for update": "codepuppy.ext.error.updateUnsupported",
  "仅支持 https Git 地址": "codepuppy.ext.error.importGitHttps",
  "仓库内未找到 SKILL.md(根目录或唯一子目录)": "codepuppy.ext.error.importSkillMissing",
  "import: 是 symlink — 拒(须常规文件)": "codepuppy.ext.error.importFileAccess",
  "failed to read config": "codepuppy.ext.error.configRead",
  "failed to write config": "codepuppy.ext.error.configWrite",
  "请选择 .md agent 文件": "codepuppy.ext.error.importMd",
  "文件过大(>256KB)": "codepuppy.ext.error.importSize",
  "非法 frontmatter:缺少 --- 头": "codepuppy.ext.error.importHeader",
  "非法 agent 文件:缺少 frontmatter --- 头": "codepuppy.ext.error.importHeader",
  "非法 frontmatter:未闭合": "codepuppy.ext.error.importHeaderEnd",
  "非法 agent 文件:frontmatter 未闭合": "codepuppy.ext.error.importHeaderEnd",
  "非法 frontmatter:description 缺失": "codepuppy.ext.error.importDescription",
  "description 缺失": "codepuppy.ext.error.importDescription",
  "预览已失效,请重新选择文件": "codepuppy.ext.error.agentPreviewExpired",
}
const LOCAL_PACKAGE_ERROR_KEYS: Record<string, Parameters<typeof t>[0]> = {
  "unknown-preview": "codepuppy.ext.error.previewExpired",
  "install-in-flight": "codepuppy.ext.error.previewBusy",
  "preview-source-changed": "codepuppy.ext.error.previewChanged",
  "preview-budget-bytes": "codepuppy.ext.error.previewBytes",
  "preview-budget-files": "codepuppy.ext.error.previewFiles",
  "preview-payload-unreadable": "codepuppy.ext.error.previewRead",
  "payload-mismatch": "codepuppy.ext.error.previewMismatch",
  "unsupported-scope": "codepuppy.ext.error.packageScope",
  "preview-not-installable": "codepuppy.ext.error.packageEmpty",
  "package-already-installed": "codepuppy.ext.error.packageAlreadyInstalled",
  "bijection-mismatch": "codepuppy.ext.error.packageDuplicate",
  "preview-stale": "codepuppy.ext.error.packageStateChanged",
  "cas-promotion-failed": "codepuppy.ext.error.packagePrepare",
  "invalid-input": "codepuppy.ext.error.packageInvalidPreview",
  "manifest-unreadable": "codepuppy.ext.error.packageInvalidPreview",
  "no-installable-component": "codepuppy.ext.error.packageEmpty",
}

export function extensionError(reason: string | undefined, fallback: Parameters<typeof t>[0], code?: string): string {
  const name = reason?.match(/^技能名「(.+)」不能作为扩展包的组件标识/)
  if (name) return t("codepuppy.ext.error.packageSkillName", { name: name[1] })
  if (code && Object.hasOwn(LOCAL_PACKAGE_ERROR_KEYS, code)) return t(LOCAL_PACKAGE_ERROR_KEYS[code])
  if (!reason) return t(fallback)
  if (Object.hasOwn(EXTENSION_REASON_KEYS, reason)) return t(EXTENSION_REASON_KEYS[reason])
  if (reason.startsWith("catalog kind mismatch:")) return t("codepuppy.ext.error.kindMismatch")
  if (reason.startsWith("config busy:")) return t("codepuppy.ext.error.configBusy")
  if (reason.startsWith("config unparseable")) return t("codepuppy.ext.error.configInvalid")
  if (/^command (not allowed:|arg not allowed:|args must be strings)/.test(reason)) return t("codepuppy.ext.error.commandUnsupported")
  if (reason.startsWith("env var not allowed:")) return t("codepuppy.ext.error.envUnsupported")
  if (reason.startsWith("field not allowed:")) return t("codepuppy.ext.error.configFieldUnsupported")
  if (reason.startsWith('server name "codepuppy" is reserved')) return t("codepuppy.ext.error.cloudNameReserved")
  if (/^(非法 frontmatter:)?name 缺失或不合法/.test(reason)) return t("codepuppy.ext.error.importName")
  if (reason.includes("不能隐藏") || reason.includes("隐藏会使其入口消失")) return t("codepuppy.ext.error.builtinHidden")
  if (reason.includes("build 是引擎兜底 agent")) return t("codepuppy.ext.error.builtinConfirmBuild")
  if (reason.includes("受保护:")) return t("codepuppy.ext.error.builtinProtected")
  if (reason.includes("install directory could not be removed")) return t("codepuppy.ext.error.removeFiles")
  if (reason.includes("cannot prove which file to remove") || reason.includes("ledger plugin path")) return t("codepuppy.ext.error.removeIdentity")
  return t(fallback)
}

export function extensionWarning(warning: string): string {
  // Warnings may contain several notes. Keep every recognized consequence visible.
  const messages: string[] = []
  const count = warning.match(/(\d+) invalid receipt\(s\) ignored/)
  if (count) messages.push(t("codepuppy.ext.warning.invalidRecords", { count: count[1] }))
  if (warning.includes("installs.json unreadable")) messages.push(t("codepuppy.ext.warning.recordsUnreadable"))
  if (warning.includes("corrupt ledger quarantined:")) messages.push(t("codepuppy.ext.warning.recordsQuarantined"))
  if (warning.includes("connection binding not released")) messages.push(t("codepuppy.ext.warning.connectionBinding"))
  if (warning.includes("removed your standalone claim and kept the files")) messages.push(t("codepuppy.ext.warning.sharedFiles"))
  if (warning.includes("skills allow-list final publish failed")) messages.push(t("codepuppy.ext.warning.reload"))
  return messages.length ? messages.join("\n") : t("codepuppy.ext.error.warningUnknown")
}

// `#1724`(BR-04):连接器启动失败的短原因。码由引擎登记(@opencode/schema/codepuppy-net-failure),网络层沿用
// net-failure-copy 的同一套句子;认不出的码说「上次未能生效」。引擎原文只留在开发者详情 / 悬停。
const MCP_START_FAILURE: Record<string, Parameters<typeof t>[0]> = {
  workspace_missing: "codepuppy.ext.mcpFailure.workspaceMissing",
  dependency_missing: "codepuppy.ext.mcpFailure.dependencyMissing",
  spawn_failed: "codepuppy.ext.mcpFailure.spawnFailed",
  handshake_timeout: "codepuppy.ext.mcpFailure.handshakeTimeout",
  auth: "codepuppy.ext.mcpFailure.auth",
  protocol: "codepuppy.ext.mcpFailure.protocol",
  transport: "codepuppy.ext.mcpFailure.transport",
}
export function mcpFailureReason(code: string | undefined, detail?: string): string {
  if (code === "tcp" && detail?.includes(PLUGIN_MCP_SERVICE_UNAVAILABLE)) return t("codepuppy.ext.mcpFailure.localServiceUnavailable")
  if (code && isNetFailureLayer(code)) return netFailureCopy(code)
  return t(code && MCP_START_FAILURE[code] ? MCP_START_FAILURE[code] : "codepuppy.ext.hubReasonFailed")
}
