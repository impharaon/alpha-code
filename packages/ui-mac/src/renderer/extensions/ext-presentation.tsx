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
  "skill:alpha-upstream-sync": "同",
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
  if (entry.id === "skill:alpha-upstream-sync") return t("codepuppy.ext.upstreamSyncDescription")
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
export const LockIc = () => (
  <svg class="codepuppy-ic codepuppy-ic-xs" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.7" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.7" />
  </svg>
)

export type MoreMenuItem = { key: string; label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }

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
export function MoreMenu(p: { id: string; items: MoreMenuItem[]; trigger?: string; primary?: boolean; disabled?: boolean }) {
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
        data-more={p.id}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label={p.trigger ? undefined : t("codepuppy.ext.more")}
        title={p.trigger ? undefined : t("codepuppy.ext.more")}
        disabled={p.disabled}
        onClick={(ev) => {
          ev.stopPropagation()
          setOpen(!open())
        }}
      >
        {p.trigger ?? "…"}
      </button>
      <Show when={open()}>
        <div class="codepuppy-ext-menu" role="menu" data-menu={p.id}>
          <For each={p.items}>
            {(item) => (
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
