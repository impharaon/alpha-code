import { recordWorkspaceOpen } from "../codepuppy-ui/workspace-writable"
// The alpha Codex-style left sidebar. Rendered (via Portal) from inside AppInterface's child
// tree, so it has the router (useNavigate/useLocation) and opencode's command context, while
// its data comes from the SDK (see use-projects.ts). It replaces opencode's own chrome: the
// V2 titlebar tab-strip is hidden and the main content is shifted right by CSS in sidebar.css,
// keyed off body[data-codepuppy-sidebar]. Single flat column: brand → nav → projects(→sessions),
// the Codex information architecture.

import { createEffect, createMemo, createRoot, createSignal, For, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useBeforeLeave, useLocation, useNavigate, type NavigateOptions } from "@solidjs/router"
import { ServerConnection, useCommand, useServer, useTabs } from "../codepuppy-ui/providers"
import { createDefaultWorkspaceDir, workspaceDisplayName } from "../codepuppy-ui/default-workspace"
import { beginLaunchDraftHandoff, endLaunchDraftHandoff } from "../codepuppy-ui/launch-draft-handoff"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { t } from "../i18n"
import { pushToast } from "../codepuppy-ui/Toast"
import { sessionDisplayTitle } from "../codepuppy-ui/session-title"
import { SHELL_KEYBINDS } from "./shell-keybinds"
import brandMark from "../brand/brand-mark.png"
import { ShellIcon } from "../codepuppy-ui/shell-icons"
import { ShellRail, ShellTopbar } from "./shell-chrome"
import { CODEPUPPY_PATHS } from "../../shared/codepuppy-config"
import { buildMarker, formatBuildIdentity, type BuildIdentity } from "../../shared/build-identity"
import { useCodePuppyEndpoints } from "../use-codepuppy-endpoints"
import { subscribeAuthState } from "../auth-recovery"
import { accountSummary, clearAccountSummary, markAccountSummaryStale, readAccountSummary, refreshAccountSummary } from "../account-summary"
import { markStartupTimeline } from "../startup-timeline"
import { homeHref, projectLabel } from "./route"
import { hrefFor, parseRoute } from "../../shared/route-manifest"
import {
  clearHiddenProjects,
  hiddenProjects,
  hideProject,
  isProjectExpanded,
  isProjectHidden,
  isSessionUnread,
  markSessionViewed,
  setProjectExpanded,
  setSidebarAutoCollapsed,
  sidebarCollapsed,
  toggleProjectExpanded,
  toggleSidebar,
} from "./sidebar-state"
import { type CodePuppyProject, type CodePuppySession, type CodePuppyProjectsApi } from "./use-projects"
import { updaterSurfaceFor } from "./updater-state-surface"
import type { UpdaterState } from "@opencode-ai/app/updater"
import { projectSidebarGroups } from "./project-display"
import type { AuthState } from "../../preload/types"
import { extHubOpen, setExtHubOpen, toggleExtHub } from "../extensions/ext-hub-state"
import { rememberRoute, restoredRoute } from "../reload-place-store"
import { automationOpen, setAutomationOpen, toggleAutomation } from "../automations/automation-state"
import { setSettingsOpen, settingsOpen } from "../codepuppy-ui/settings-state"
import { sessionNotFoundShown } from "@opencode-ai/app/surface/session-not-found-state"
import { dismissMenu, dismissMenuOnEscape, focusFirstMenuItem } from "./menu-a11y"
import { ProblemsEntry } from "./problems-entry"
import { Card } from "../codepuppy-ui/Card"
import { KeyValueList } from "../codepuppy-ui/KeyValueList"
import { unresolvedProblems } from "../codepuppy-ui/problems"

// opencode folds standalone (non-git) directories into a single sentinel "global" project whose
// worktree is "/" and whose name is empty — give it a readable label instead of a blank row.
function projectDisplayName(project: CodePuppyProject): string {
  if (project.name) return workspaceDisplayName(project.worktree, project.name)
  if (project.worktree === "/") return t("codepuppy.sidebar.globalProject")
  return project.worktree
}

// Robust clipboard write. The async Clipboard API needs transient user activation (and can be
// blocked); fall back to a hidden-textarea execCommand, which works in the Electron renderer even
// when the activation heuristic is unhappy. Returns whether the copy landed.
async function copyText(text: string): Promise<boolean> {
  // Prefer the Electron main-process clipboard — it needs no transient user activation, so it
  // succeeds reliably (including under automated clicks). Renderer APIs are the fallback.
  try {
    const ok = await (
      window as unknown as { api?: { writeClipboard?: (t: string) => Promise<boolean> } }
    ).api?.writeClipboard?.(text)
    if (ok) return true
  } catch {
    /* fall through to the renderer clipboard paths */
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.style.position = "fixed"
      ta.style.top = "-1000px"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand("copy")
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

// REQ-126 AC2(#655):当前**已登记**的全页覆盖层就这两个(产物工作台已随 #654 下线)。
// 刻意不建 overlay union 状态机(方案基线 S2:rev1 的设计已被审计判过度工程并撤销)——
// 新增覆盖层时把它加进这里,漏加由 overlay-close 闸门的参数化矩阵判红,不假装架构能挡。
/** 内嵌 sidecar 的稳定 server key,由上游自己的 `ServerConnection.key` 派生 —— 不硬编码
 *  "sidecar" 这个字面量,上游改 key 算法时这里跟着变(改没了则 typecheck 红)。 */
const EMBEDDED_SIDECAR_KEY = ServerConnection.key({ type: "sidecar", variant: "base", http: { url: "" } })

/** Conversation rows a project draws before the quiet 「显示更多」 row (frame `#home`: four). */
const SESSIONS_SHOWN = 4

function closeAllOverlays(): void {
  setExtHubOpen(false)
  setAutomationOpen(false)
  // Settings is a top-level page too (BR-01): the sidebar and rail stay reachable beside it, so any
  // navigation leaves it.
  setSettingsOpen(false)
}

/** 等一个响应式条件成真(一次性 effect,不轮询、不猜时长),返回 `[promise, cancel]`。
 *
 *  两处都需要它,而且都**不能**用现成的 promise 顶替:
 *  · `tabs.ready` 虽然挂了 `.promise`,但同步水合时它是 `undefined`(utils/persist.ts)——
 *    `await undefined` 会在 ready 仍为 false 时放行;
 *  · `createResource` 的 promise 根本不外露,而「还没解析出来」与「解析完了但没有」必须分开
 *    (default-workspace.ts 抬头写明的要害:未解析时拿别的目录顶上去,会话就开在用户从没选过的
 *    项目里)。
 *
 *  `cancel` 存在的理由:条件永不成真、或组件先卸下时,这个 root 会一直挂着;更糟的是它日后一旦
 *  成真,一条早已作废的 startDraft 还会继续往下走并导航一个已经不存在的壳。调用方在卸载时
 *  cancel,`cancel` 同时拆掉 root 并让 promise 落定,由调用方据条件真假决定是否继续。 */
function until(condition: () => boolean): { promise: Promise<void>; cancel: () => void } {
  if (condition()) return { promise: Promise.resolve(), cancel: () => {} }
  let cancel = () => {}
  const promise = new Promise<void>((resolve) => {
    createRoot((dispose) => {
      cancel = () => {
        dispose()
        resolve()
      }
      createEffect(() => {
        if (!condition()) return
        resolve()
        dispose()
      })
    })
  })
  return { promise, cancel }
}

export function CodePuppySidebar(props: {
  projects: CodePuppyProjectsApi
  /** #925:`props.projects` 这份 store 连着的那个 server 的 key(`renderer/index.tsx` 的
   *  `projectsServerKey`,由 store 自己的 baseUrl 反查)。侧栏列的会话、`createSession` 建的
   *  会话**全部**长在这个 server 上 —— 它们的 href 因此必须钉在这个 key 上。这里刻意**不读**
   *  `useServer().key`(当前 active server):WSL/remote 下两者不是同一个,按 active 拼 href
   *  就是 #894 修掉的那个缺陷(跳去没有该会话的机器;那边若恰好有同 id 会话,污染的是它)。 */
  serverKey: () => string | undefined
}) {
  // #1099(REQ-109):启动窗口的第二个交接点 —— 上游 `AppInterface` 自己的 setup 跑完、渲染
  // 到 alpha 侧栏的这一拍。刻意打在**组件体里**而不是 `onMount`:solid 的 onMount 是 user
  // effect,整棵子树的 onMount 会在渲染结束后一起排队触发,时间戳全挤在同一刻 —— 那样分不出
  // 「上游壳挂了多久」与「路由树挂了多久」。组件体是渲染期,拿到的才是这一段的真实边界。
  markStartupTimeline("renderer.sidebar.setup")
  const { store, reload, createSession, renameSession, deleteSession, copySession } = props.projects
  const routerNavigate = useNavigate()
  const location = useLocation()
  const command = useCommand()
  // REQ-126 CODE-C(#656):建 draft 的两个上游 authority,经 codepuppy-ui/providers 转口(ADR-016)。
  const tabs = useTabs()
  const server = useServer()
  // 默认对话目录 `~/Alpha` 的唯一解析点(ADR-025 / CODE-D 抽出);这里只**消费**,不另写一份。
  const defaultWorkspaceDir = createDefaultWorkspaceDir()

  // 侧栏卸下时把所有还在等的条件一起取消(见 until 抬头):否则条件晚到会让一条早已作废的
  // startDraft 继续往下走。`wait` 返回「等到了且还活着」——false 一律直接返回,不再往下。
  let sidebarAlive = true
  const pendingWaits = new Set<() => void>()
  onCleanup(() => {
    sidebarAlive = false
    for (const cancel of pendingWaits) cancel()
    pendingWaits.clear()
  })
  const wait = async (condition: () => boolean): Promise<boolean> => {
    const { promise, cancel } = until(condition)
    pendingWaits.add(cancel)
    try {
      await promise
    } finally {
      pendingWaits.delete(cancel)
    }
    return sidebarAlive && condition()
  }

  // REQ-126 AC2 主轨(#655):覆盖层的关闭挂在侧栏导航的**咽喉点**,而不是逐个按钮的 onClick。
  // 旧代码把互斥只写在两个 nav 按钮的内联 onClick 里 —— 逐点枚举对**新入口默认放行**,于是
  // 会话行 / 新对话 / 首页 / 项目行都绕过了它。侧栏一切「要去某处」都经这一个 navigate,所以
  // 在这里关一次即可,且**与目标是否等于当前路由无关**:点当前正在看的那个会话 URL 不变,
  // 下面那条 route effect 根本不触发 —— owner 报的正是这个动作。
  const navigate = (to: string | number, options?: Partial<NavigateOptions>): void => {
    closeAllOverlays()
    if (typeof to === "number") routerNavigate(to)
    else routerNavigate(to, options)
  }

  // Top-level pages (Customization Center, automation, settings) replace the working surface's content
  // and share the persistent top bar. Settings wins when several are open (it is opened last).
  // While a top-level page is open nothing in the sidebar is "the conversation being viewed".
  const viewingSessionId = () => (pageOpen() ? undefined : route().sessionId)
  const pageOpen = () => settingsOpen() || automationOpen() || extHubOpen()
  const pageTitle = (): string | undefined => {
    if (settingsOpen()) return t("codepuppy.sidebar.settings")
    if (automationOpen()) return t("codepuppy.sidebar.automation")
    if (extHubOpen()) return t("codepuppy.sidebar.plugins")
    // A missing conversation has no workspace to name itself: the chrome writes the title (frame #not-found).
    if (sessionNotFoundShown()) return t("codepuppy.session.notFoundTitle")
    // A session names itself: the workspace renders its breadcrumb into the top bar.
    return parseRoute(location.pathname).kind === "session" ? undefined : t("codepuppy.newSession.title")
  }
  const openPage = (page: "hub" | "automation") => {
    setSettingsOpen(false)
    if (page === "hub") {
      setAutomationOpen(false)
      toggleExtHub()
    } else {
      setExtHubOpen(false)
      toggleAutomation()
    }
  }
  const openSettings = () => {
    closeAllOverlays()
    setSettingsOpen(true)
  }

  // Platform auth state, pushed from main (codepuppy-auth.ts). The footer button reflects it: signed
  // out → start the browser OAuth flow; signed in → show the account and sign out. web is the
  // session authority, so this is just a thin view of main's state (see platform-integration.md §C).
  const [authState, setAuthState] = createSignal<AuthState>({ status: "logged-out", mode: "byok" })
  onCleanup(subscribeAuthState(setAuthState))
  const accountLabel = () => authState().account?.email ?? t("codepuppy.auth.account")

  // B11 复扫行16:登录链失败(main 只 warn 日志 → 用户「点了没反应」)→ error toast,按 code 给原因。
  onCleanup(
    window.api.auth.onError((e) => {
      const detail = {
        provider_error: t("codepuppy.auth.errProvider"),
        invalid_callback: t("codepuppy.auth.errCallback"),
        state_mismatch: t("codepuppy.auth.errState"),
        exchange_failed: t("codepuppy.auth.errExchange"),
        contract_incompatible: t("codepuppy.auth.errContract"),
      }[e.code]
      pushToast({ kind: "error", title: t("codepuppy.auth.failed"), detail })
    }),
  )

  // 自动化 badge(REQ-021 A1.4):上次运行失败/超时的任务数。跟 automation-event 推送刷新。
  const [automationFailedCount, setAutomationFailedCount] = createSignal(0)
  const refreshAutomationBadge = () => {
    void window.api.automations
      .list()
      .then((r) =>
        setAutomationFailedCount(
          r.tasks.filter((x) => x.lastRun?.status === "failed" || x.lastRun?.status === "timeout").length,
        ),
      )
      .catch(() => {})
  }
  refreshAutomationBadge()
  onCleanup(window.api.automations.onEvent(() => refreshAutomationBadge()))

  // Account popover (single footer entry → upward popover). Theme toggle is native; the rest open
  // opencode's real settings / updater / browser-OAuth. Balance + quotas have no backend yet
  // (alpha-platform) — shown as "待接入" placeholders, see ADR-016 / cloud topology.
  const theme = useTheme()
  const [menuOpen, setMenuOpen] = createSignal(false)
  // `#1687`:侧栏收起时入口跟着收起,「显示侧边栏」按钮上留一个小点,悬停文字带数量。
  const collapsedProblems = () => (sidebarCollapsed() ? unresolvedProblems().length : 0)
  const sidebarToggleLabel = () =>
    !sidebarCollapsed()
      ? t("codepuppy.sidebar.hide")
      : collapsedProblems()
        ? t("codepuppy.sidebar.showWithProblems", { count: collapsedProblems() })
        : t("codepuppy.sidebar.show")
  const plan = () => authState().account?.plan ?? ""
  const isPro = () => /pro|plus|team|max|paid/i.test(plan())
  const acctInitial = () => (authState().account?.email ?? "A").trim().charAt(0).toUpperCase() || "A"
  const SCHEMES = [
    { k: "light", l: "codepuppy.sidebar.themeLight" },
    { k: "dark", l: "codepuppy.sidebar.themeDark" },
    { k: "system", l: "codepuppy.sidebar.themeSystem" },
  ] as const
  // 钱包购买页(/wallet)按页签深链:充值 → 钱包充值页签;升级会员/管理订阅 → 会员月卡页签。
  const endpoints = useCodePuppyEndpoints()
  const rechargeUrl = () => `${endpoints().web}${CODEPUPPY_PATHS.wallet}?tab=recharge`
  const subscribeUrl = () => `${endpoints().web}${CODEPUPPY_PATHS.wallet}?tab=subscription`
  // #1739:付款可能不到 30 秒就回来 —— 从这里打开订阅 / 充值页之后,下一次回到窗口一定重取。
  const openWalletPage = (url: string) => {
    markAccountSummaryStale()
    window.api.openLink(url)
  }

  // Account summary (balance / membership / token usage) from alpha-platform B. The one shared copy lives in
  // ../account-summary (#1739): this sidebar fetches on every login-state delivery, and the same value is refetched
  // when the window regains focus (>30 s since the last fetch, watched by that module), when this panel opens and after
  // a turn ends (use-projects), so a subscription paid on the web shows up without logging in again.
  // Contract: alpha-platform docs/contracts/account-billing.md. usageSeries powers the 14-day
  // sparkline. 401 → main's auth is stale; the footer already reflects logged-out on the next push.
  const summary = accountSummary
  const [summaryState, setSummaryState] = createSignal<"idle" | "loading" | "error">("idle")
  // #1686:换了一个登录(登录代变,含不先退出直接换号)就先清空,不让上一个账号的数留在卡片上。
  // 这里的 summaryRequest 只管 loading / error 状态(只认本效果最新一次请求);数据本身由 account-summary 把关:
  // 较早发出、较晚回来的回复(上一个账号的,或同一登录里更旧的)不写进共享现值。
  let summaryRequest = 0
  let summaryEpoch: number | undefined
  createEffect(() => {
    const state = authState()
    const mine = ++summaryRequest
    if (state.status !== "logged-in") {
      summaryEpoch = undefined
      clearAccountSummary()
      setSummaryState("idle")
      return
    }
    if (state.identityEpoch !== summaryEpoch) clearAccountSummary()
    summaryEpoch = state.identityEpoch
    setSummaryState("loading")
    readAccountSummary()
      .then((r) => {
        if (mine !== summaryRequest) return
        setSummaryState(r && "error" in r ? "error" : "idle")
      })
      .catch(() => {
        if (mine === summaryRequest) setSummaryState("error")
      })
  })
  // 打开账户面板就取一次当前值(关闭不取)。
  createEffect(() => {
    if (menuOpen()) refreshAccountSummary()
  })
  const activePlan = () => {
    const s = summary()
    return s && s.plan.status === "active" ? s.plan : null
  }
  const fmtTokens = (n: number) =>
    n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`
  const fmtYuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`
  const pendingState = () => (summaryState() === "error" ? ("unavailable" as const) : ("pending" as const))
  // Membership display prefers the fetched summary (authoritative); falls back to the JWT's coarse
  // plan claim before the summary lands, so the header chip / footer never contradict the card.
  const acctIsPro = () => !!activePlan() || isPro()
  const acctPlanName = () => activePlan()?.name ?? plan()
  // REQ-146(#1194) chip 三态。「按量付费」不是审美偏好:发送门的真实判据是
  // codepuppy-composer.tsx 的 summaryUsable = plan active || balanceFen > 0 —— 有余额的人
  // 在系统眼里本来就不是「免费」,chip 标「免费版」是界面与行为不符。summary 未落地时
  // 维持既有回落(JWT claim → 免费版),不臆测余额。
  const acctTier = (): "pro" | "payg" | "free" => {
    if (acctIsPro()) return "pro"
    const s = summary()
    return s && s.balanceFen > 0 ? "payg" : "free"
  }
  const acctTierLabel = () => {
    const tier = acctTier()
    if (tier === "pro") return acctPlanName().toUpperCase()
    return tier === "payg" ? t("codepuppy.sidebar.payAsYouGo") : t("codepuppy.sidebar.freePlan")
  }

  // Tiny inline sparkline for the 14-day usage series (no chart lib). Empty series → caller shows
  // a placeholder instead of rendering this.
  const Sparkline = (p: { data: number[] }) => {
    const w = 116
    const h = 24
    const max = Math.max(1, ...p.data)
    const n = p.data.length
    const pts = p.data
      .map((v, i) => `${(i / Math.max(1, n - 1)) * w},${(h - 2 - (v / max) * (h - 4) + 2).toFixed(1)}`)
      .join(" ")
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <polyline
          points={pts}
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      </svg>
    )
  }

  // ac#1187:账户浮层底部显示当前版本号。取值经 preload 的 app-version IPC(唯一真源 =
  // app.getVersion() = package.json 的 version);取不到就整行不渲染,不落任何版本字面量兜底。
  // 经 Promise 链取而不是裸调:桥上缺这个方法时(窄桩的测试壳、或真桥退化)失败单元必须是
  // 「版本行不渲染」,不是同步 TypeError 拖死整个侧栏 —— 首版裸调把 7 个挂生产侧栏的既有
  // 闸门一起打红(它们的 preload 桩是显式对象,没有 appVersion)。
  const [appVersion, setAppVersion] = createSignal("")
  void Promise.resolve()
    .then(() => window.api.appVersion())
    .then((v) => setAppVersion(typeof v === "string" ? v : ""))
    .catch(() => {})

  // ac#237:点版本行复制「我用的是哪个包」。身份由 main 的 build-identity IPC 给(运行中这个包的
  // 构建事实),格式化与标记规则在 shared/build-identity。同样经 Promise 链取:桥上缺方法时失败单元是
  // 「无标记、点击不动作」,不是拖死侧栏。
  const [buildIdentity, setBuildIdentity] = createSignal<BuildIdentity | undefined>()
  void Promise.resolve()
    .then(() => window.api.buildIdentity())
    .then((id) => setBuildIdentity(id && typeof id === "object" ? id : undefined))
    .catch(() => {})
  const [versionCopied, setVersionCopied] = createSignal(false)
  let versionCopiedTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(versionCopiedTimer))
  const copyBuildIdentity = async () => {
    const id = buildIdentity()
    if (!id || !(await copyText(formatBuildIdentity(id)))) return
    setVersionCopied(true)
    clearTimeout(versionCopiedTimer)
    versionCopiedTimer = setTimeout(() => setVersionCopied(false), 2000)
  }

  // [ac#1207] REQ-147:更新状态的消费端。通道早就通着(main updater-controller →
  // ipc "updater-state" → preload subscribe),此前 renderer 零消费 —— 点「检查更新」
  // 界面毫无反应,而后端把 160MB 下载、校验、落盘全做完了。这里订同一条既有通道
  // (preload 的回调集支持多订阅者并回放当前值),不另造数据通路。
  // 呈现由 updater-state-surface.ts 的映射驱动(AC1:对 status 联合类型穷尽)。
  // Promise 链取而不裸调,理由同上面 appVersion:窄桩测试壳没有这个方法时,失败单元
  // 必须是「更新条不渲染」,不是同步 TypeError 拖死整个侧栏。
  const [updaterState, setUpdaterState] = createSignal<UpdaterState>({ status: "disabled" })
  // 用户是否在本侧栏主动检查过:up-to-date/error 是检查反馈,只对主动检查显示 ——
  // 否则启动自检每次都会挂一条永久的「已是最新」噪声(映射的 unsolicited 字段)。
  const [updaterSolicited, setUpdaterSolicited] = createSignal(false)
  let updaterUnsub: (() => void) | undefined
  void Promise.resolve()
    .then(() => window.api.updater.subscribe(setUpdaterState))
    .then((unsub) => {
      updaterUnsub = typeof unsub === "function" ? unsub : undefined
    })
    .catch(() => {})
  onCleanup(() => updaterUnsub?.())
  const updaterSurface = () => updaterSurfaceFor(updaterState(), updaterSolicited())

  const MenuCommon = () => (
    <>
      <button
        type="button"
        class="codepuppy-acct-item"
        data-codepuppy-acct-item="settings"
        onClick={() => {
          setMenuOpen(false)
          // REQ-126 AC7(#658):这里以前发 `settings.open`。那个命令**按路由分裂** —— 上游只在
          // 已被 alpha 顶替的三叶、legacy layout 与 canonical session 路由的
          // `TargetSessionSettingsCommand` 里注册,于是同一个菜单项在会话页能开、首页/新对话页
          // 静默 no-op(上游 `run()` 对未注册 id 直接返回)。alpha 早就自己拥有设置面,直接开它:
          // 与路由无关,也不再经过一个可能没人接的命令总线。
          openSettings()
        }}
      >
        <ShellIcon name="gear" class="codepuppy-acct-ic" />{t("codepuppy.sidebar.settings")}
      </button>
      <div class="codepuppy-acct-item codepuppy-acct-appearance">
        <ShellIcon name="contrast" class="codepuppy-acct-ic" />{t("codepuppy.sidebar.appearance")}
        <span class="codepuppy-acct-spacer" />
        <span class="codepuppy-acct-seg">
          <For each={SCHEMES}>
            {(s) => (
              <button data-on={theme.colorScheme() === s.k ? "" : undefined} onClick={() => theme.setColorScheme(s.k)}>
                {t(s.l)}
              </button>
            )}
          </For>
        </span>
      </div>
      <button
        type="button"
        class="codepuppy-acct-item"
        onClick={() => {
          setMenuOpen(false)
          window.api.openLink("https://codepuppy.cn/feedback")
        }}
      >
        <ShellIcon name="help" class="codepuppy-acct-ic" />{t("codepuppy.sidebar.helpFeedback")}
      </button>
      <button
        type="button"
        class="codepuppy-acct-item"
        data-codepuppy-acct-item="check-updates"
        onClick={() => {
          setMenuOpen(false)
          // [ac#1207] 主动检查:放行 up-to-date/error 这类检查反馈的呈现(见 updaterSolicited)。
          // 结果不再被丢弃 —— 状态经订阅推回,footer 更新条全程可见。
          setUpdaterSolicited(true)
          void window.api.updater.check()
        }}
      >
        <ShellIcon name="update" class="codepuppy-acct-ic" />{t("codepuppy.sidebar.checkUpdates")}
      </button>
    </>
  )

  // Which project's "⋯" menu is open (by worktree), if any, and where to anchor it. The menu is
  // rendered once at the Portal root with fixed positioning (computed from the trigger button)
  // rather than inside the project row, so the scroll container can't clip it.
  const [menuFor, setMenuFor] = createSignal<string | null>(null)
  // Per-session "⋯" actions (rename inline / share / delete) — the user asked these move off the
  // session header into the sidebar row. Position is computed from the trigger, Portal-rendered.
  const [sessionMenu, setSessionMenu] = createSignal<{
    id: string
    directory: string
    title: string
    top: number
    right: number
  } | null>(null)
  const [editingSession, setEditingSession] = createSignal<string | null>(null)
  let projectMenuTrigger: HTMLElement | undefined
  let sessionMenuTrigger: HTMLElement | undefined
  // Sidebar-native search: filters the project/session list in place (distinct from the "搜索"
  // nav item, which opens opencode's global command palette).
  const [searchQuery, setSearchQuery] = createSignal("")
  // The filter box (former always-visible search row) opens from the section's search icon.
  const [filterOpen, setFilterOpen] = createSignal(false)
  const toggleFilter = (next = !filterOpen()) => {
    setFilterOpen(next)
    if (!next) setSearchQuery("")
  }
  const openSessionMenu = (e: MouseEvent, session: { id: string; directory: string; title: string }) => {
    e.preventDefault()
    e.stopPropagation()
    sessionMenuTrigger = e.currentTarget as HTMLElement
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setSessionMenu({
      id: session.id,
      directory: session.directory,
      title: session.title,
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    })
  }
  const [menuPos, setMenuPos] = createSignal<{ top: number; right: number } | null>(null)

  const openProjectMenu = (e: MouseEvent & { currentTarget: HTMLElement }, worktree: string) => {
    e.stopPropagation()
    if (menuFor() === worktree) {
      dismissMenu(() => setMenuFor(null), projectMenuTrigger)
      return
    }
    projectMenuTrigger = e.currentTarget
    const r = e.currentTarget.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 3, right: Math.max(8, window.innerWidth - r.right) })
    setMenuFor(worktree)
  }

  // The data layer keeps opencode's internal "/" project only as a live-update sentinel. Project
  // its sessions back to their real non-Git directories; the root bucket itself is never visible.
  const displayProjects = createMemo<CodePuppyProject[]>(() => projectSidebarGroups(store.projects))

  // Projects visible in the sidebar = all known projects minus the ones the user archived/removed.
  const visibleProjects = createMemo(() => displayProjects().filter((p) => !isProjectHidden(p.worktree)))
  // Projects whose full conversation list is expanded by 「显示更多」 (expand-only, as the frame draws it).
  const [moreShown, setMoreShown] = createSignal<ReadonlySet<string>>(new Set())
  /** A search or the open conversation never hides behind 「显示更多」. */
  const allSessionsShown = (project: { worktree: string; sessions: { id: string }[] }) =>
    moreShown().has(project.worktree) ||
    searchQuery().trim() !== "" ||
    project.sessions.findIndex((x) => x.id === route().sessionId) >= SESSIONS_SHOWN
  const shownSessions = <S extends { id: string }>(project: { worktree: string; sessions: S[] }) =>
    allSessionsShown(project) ? project.sessions : project.sessions.slice(0, SESSIONS_SHOWN)
  // Filter visible projects + their sessions by the search query. A project shows if its name
  // matches (then all its sessions show) or if any of its sessions' titles match (then only those).
  const searchedProjects = createMemo(() => {
    const q = searchQuery().trim().toLowerCase()
    const base = visibleProjects()
    if (!q) return base
    const out: typeof base = []
    for (const p of base) {
      if (projectLabel(p.worktree).toLowerCase().includes(q)) {
        out.push(p)
        continue
      }
      const sessions = (p.sessions ?? []).filter((s) => sessionDisplayTitle(s.title).toLowerCase().includes(q))
      if (sessions.length) out.push({ ...p, sessions })
    }
    return out
  })
  // Known projects that are currently hidden — drives the "Archived (N)" restore affordance, so
  // archiving is always reversible (no project can be lost).
  const archivedCount = createMemo(() => {
    hiddenProjects() // track the hidden set
    return displayProjects().filter((p) => isProjectHidden(p.worktree)).length
  })

  // Decode the active project directory + session id from the current route
  // (route-manifest parseRoute,REQ-089). Drives the active-row highlight and "new chat" target.
  const route = createMemo<{ dir?: string; sessionId?: string }>(() => {
    const r = parseRoute(location.pathname)
    if (r.kind === "directory") return { dir: r.directory }
    if (r.kind === "session" && r.directory) return { dir: r.directory, sessionId: r.id }
    // #925:canonical `/server/:serverKey/session/:id` 路径里**没有**目录段(这正是它的意义:
    // 身份是 server+id,不再靠目录反推)。会话属于哪个项目改由 store 反查 —— 否则落在 canonical
    // 路由上时高亮/已读水位/自动展开全部失灵(#659/#894 起搜索与首页已经这么导航了)。
    if (r.kind === "session" && r.id) {
      // #933 身份闸:canonical 路由自带 server 身份,而这份 store 只认识 props.serverKey() 那台
      // (侧栏列的会话全长在它上面)。路由的 server 不是这台时,按 id 反查命中的必然是**另一台
      // 机器上恰好同 id 的无关会话** —— 高亮错行、自动展开错项目、markSessionViewed 抹掉它的
      // 未读点。身份不合直接不反查(key 未解析时同样 fail-closed,store 没连上本来也没有行可指)。
      if (r.serverKey !== props.serverKey() || r.serverKey === undefined) return {}
      const sid = r.id
      for (const project of store.projects) {
        const match = project.sessions.find((session) => session.id === sid)
        if (match) return { dir: match.directory, sessionId: sid }
      }
      return { sessionId: sid }
    }
    return {}
  })

  const pluginSession = () => {
    const source = parseRoute(location.pathname)
    return source.kind === "session" && source.serverKey === EMBEDDED_SIDECAR_KEY ? source.id : undefined
  }
  createEffect(() => { void window.api.pluginSessionViewed(pluginSession()).catch(error => console.warn("runtime-failed: package session view", error)) })
  onCleanup(() => { void window.api.pluginSessionViewed(undefined).catch(error => console.warn("runtime-failed: package session view", error)) })
  let retryingPluginLeave = false
  useBeforeLeave(event => {
    if (retryingPluginLeave) { retryingPluginLeave = false; return }
    if (event.defaultPrevented) return
    const sessionId = pluginSession()
    if (!sessionId) return
    const destination = typeof event.to === "string" ? parseRoute(event.to) : undefined
    if (destination?.kind === "session" && destination.id === sessionId && destination.serverKey === EMBEDDED_SIDECAR_KEY) return
    const from = location.pathname
    event.preventDefault()
    void window.api.pluginSessionLeave({ sessionId, action: "leave", reason: typeof event.to === "number" || destination?.kind === "session" ? "resume" : "clear" }).catch(error => console.warn("runtime-failed: package session leave", error)).finally(() => {
      if (location.pathname !== from) return
      retryingPluginLeave = true
      event.retry()
    })
  })

  // REQ-126 AC2 兜底轨(#655):非点击的导航 —— 深链、程序化导航、自动化面板内「回跳会话」——
  // 不经上面那个 navigate 咽喉点,靠这条 effect 收口。两点订正:
  //   · 从「只关定制中心」扩到关**全部**已登记覆盖层(自动化以前根本没人关);
  //   · 监听键从 pathname 扩到 pathname + search —— 新对话是 `/new-session?draftId=…`,
  //     只看 pathname 会漏掉 draft 之间的切换。
  // 用 raw location(而不是收敛过的 route() memo,后者把 home 与 new-session 折成同一个值)。
  // 首帧那次运行不算导航(guard `!== undefined`),否则刚打开的覆盖层会被自己关掉。
  let lastNavKey: string | undefined
  createEffect(() => {
    const key = `${location.pathname}${location.search}`
    if (lastNavKey !== undefined && key !== lastNavKey) closeAllOverlays()
    lastNavKey = key
    // I-11 / BR-07:sidecar 换代会整页重载;记下位置,重载后从这里起步(reload-place.ts)。
    rememberRoute(key)
  })

  // Keep the open session marked "viewed" at its latest activity, so it never shows its own unread
  // dot and the watermark advances as messages stream in. Re-runs when the active id changes OR when
  // that session's `updated` bumps (Solid tracks the deep store read).
  createEffect(() => {
    const sid = route().sessionId
    if (!sid) return
    for (const p of store.projects) {
      const s = p.sessions.find((x) => x.id === sid)
      if (s) {
        markSessionViewed(sid, s.updated)
        break
      }
    }
  })

  // Reflect sidebar visibility onto <body> so sidebar.css can shift opencode's content.
  createEffect(() => {
    document.body.dataset.codepuppySidebar = sidebarCollapsed() ? "collapsed" : "open"
  })
  onCleanup(() => {
    delete document.body.dataset.codepuppySidebar
  })

  // Responsive auto-collapse of OUR OWN left sidebar. Reversible by construction — folding on the
  // downward crossing of the threshold and restoring on the upward crossing — so a narrow→wide
  // resize never strands it hidden. The override is transient (it leaves the user's persisted
  // preference alone, see setSidebarAutoCollapsed), so a manual collapse underneath is preserved.
  //
  // REQ-126 AC7(#658):这里以前还自动折叠上游的右侧 review 面板 —— 读
  // `[aria-controls="review-panel"][aria-expanded]` 这对 ARIA、经 `review.toggle` 开关。两端都已
  // 随上游 session 叶退役:alpha 会话工作区的右栏是自己的(`aria-controls="codepuppy-session-rail-host"`),
  // 命令没有任何注册处 → 那段代码永远读不到 true、永远 no-op。连同下面的浮动终端/审查按钮一起退休。
  const SIDEBAR_COLLAPSE_W = 768 // below this, collapse the left sidebar (opencode's own
  // desktop panels disappear under 768 too, so the two breakpoints stay coherent)

  let prevWidth = window.innerWidth
  let resizeScheduled = false
  const onResize = () => {
    if (resizeScheduled) return
    resizeScheduled = true
    requestAnimationFrame(() => {
      resizeScheduled = false
      const w = window.innerWidth

      // Left sidebar: fold on narrow, restore on wide. The override is transient, so a manual
      // collapse underneath is preserved and a manual open returns when we clear it.
      if (prevWidth >= SIDEBAR_COLLAPSE_W && w < SIDEBAR_COLLAPSE_W && !sidebarCollapsed()) {
        setSidebarAutoCollapsed(true)
      } else if (prevWidth < SIDEBAR_COLLAPSE_W && w >= SIDEBAR_COLLAPSE_W) {
        setSidebarAutoCollapsed(false)
      }

      prevWidth = w
    })
  }
  window.addEventListener("resize", onResize)
  onCleanup(() => window.removeEventListener("resize", onResize))

  // The project that owns the current route's directory (the directory may be a sandbox, so match
  // against the full `directories` list, not just the worktree). Drives active-row highlight and
  // auto-expand — both keyed by worktree.
  const activeProject = createMemo(() => {
    const dir = route().dir
    if (!dir) return undefined
    return displayProjects().find((p) => p.directories.includes(dir))
  })

  // Auto-expand the active project (once each) so its highlighted conversation is visible. We track
  // store.projects so this still fires if navigation precedes the project list loading, but the
  // `autoExpanded` guard ensures we only force-expand a given project a single time — otherwise a
  // later session event (which mutates store.projects) would re-expand a project the user just
  // collapsed.
  const autoExpanded = new Set<string>()
  createEffect(() => {
    const worktree = activeProject()?.worktree
    if (!worktree || autoExpanded.has(worktree)) return
    autoExpanded.add(worktree)
    setProjectExpanded(worktree, true)
  })

  // The most-recently-active CONCRETE project directory (a real worktree, never the bare global "/"
  // bucket). Since the ADR-025 2026-07-28 revision this is only the LAST-RESORT fallback for a new
  // chat (default conversation directory first); it still backs the home composer's own defaulting.
  // Reads displayProjects so the per-directory split of the global bucket (e.g. a loose "workspace"
  // folder) is eligible too.
  const mostRecentConcreteDir = (): string | undefined => {
    let best: string | undefined
    let bestTime = -1
    for (const p of displayProjects()) {
      if (p.worktree === "/") continue
      const top = p.sessions[0]?.updated ?? 0
      if (top > bestTime) {
        bestTime = top
        best = p.worktree
      }
    }
    return best
  }

  // REQ-126 不变量 4(#656):`{server, directory}` 必须**同源**,取不到就 fail-closed。
  //
  // 默认对话目录 `~/Alpha` 是主进程在**宿主机**上供给的(main/codepuppy-user-workspace.ts),侧栏那份
  // 项目列表也来自**本地 sidecar** 的 SDK client(renderer/index.tsx 的 sidebarServer)。当前 server
  // 却可能是 WSL / remote(wsl/connections.ts)——把宿主机路径配到远端 server 上,会开出一个那台
  // 机器上根本不存在的目录。所以别的 server 只认**该 server 自己**已知的项目;一个都没有就要求
  // 用户显式选择,而不是猜。
  //
  // 判据刻意**不用** `server.isLocal()`:上游把「loopback 的 http 连接」也算 local
  // (context/server.tsx 的 ServerConnection.local),而一条 127.0.0.1 的 http 连接完全可能是 SSH
  // 隧道或远端反代 —— 那台机器上没有宿主机的 `~/Alpha`。只认内嵌 sidecar 的稳定身份
  // (`ServerConnection.key`:base sidecar 恒为 "sidecar",WSL 是 `wsl:*`、SSH 是 `ssh:*`),
  // 它不随随机端口漂移,也不会把隧道误判成本机。
  type DraftTarget = { directory: string; isDefaultWorkspace: boolean }
  const resolveDraftTarget = async (): Promise<DraftTarget | undefined> => {
    if (server.key !== EMBEDDED_SIDECAR_KEY) {
      const known = server.projects.list()[0]?.worktree
      return known ? { directory: known, isDefaultWorkspace: false } : undefined
    }
    // ADR-025 修订(2026-07-28):未显式选择目录时一律落默认对话目录,不再「上次使用优先」——
    // owner 报的正是新对话开在 alpha-code 而不是 ~/Alpha。项目只做兜底。
    if (!(await wait(() => !defaultWorkspaceDir.loading))) return undefined
    const preferred = defaultWorkspaceDir()
    if (preferred) return { directory: preferred, isDefaultWorkspace: true }
    const fallback = mostRecentConcreteDir()
    return fallback ? { directory: fallback, isDefaultWorkspace: false } : undefined
  }

  // REQ-126 AC1/AC5(#656):alpha 新对话的**唯一**入口 —— 直接建 draft,不再借上游 legacy
  // admission 路由。
  //
  // 旧写法是 `navigate(newSessionHref(dir))` → `/<b64dir>/session`。那条路由在两种 layout 下都挂在
  // 上游 `LegacyServerLayout` 之下(packages/codepuppy-app/src/app.tsx),于是先整套挂起上游自己的左栏
  // (pages/layout.tsx 的 SidebarContent)与会话叶,叶再在 createEffect 里调 `tabs.newDraft` 跳到
  // `/new-session?draftId=…` —— 一次「新对话」挂两套壳再被替换,这就是 owner 报的闪烁与「最左侧
  // 闪出不该出现的内容」。这里直接调 newDraft(它自带跳转),admission 那一跳整个消失。
  //
  // `/:dir/session` 路由本身**保留**给深链兼容(pages/layout/deep-links.ts 仍导航到它),本票只保证
  // alpha 自己的入口不再进它。
  let draftInFlight = false
  // #1099(REQ-109):启动 draft 是 `root.mount → composer.mount` 那段空白的**后半程** ——
  // 它有四个各自可能拖长的 await(tabs 水合 / 默认目录解析 / 默认目录供给 IPC / newDraft),
  // 而此前整条链一个事件都没有。逐步记时,让「慢在哪一步」可答。只记,不改判断。
  const startDraft = async (trigger: "launch" | "manual" = "manual"): Promise<void> => {
    // 关闭覆盖层属于导航**意图**,不属于导航结果(REQ-126 AC2 / #655 审计 Major):这里之后全是
    // await,等结果就等于让覆盖层继续压在目标页面上。
    closeAllOverlays()
    // AC4 最小 in-flight 去重:建 draft 全程异步(等 tabs 水合 → 等默认目录落定 → ensure 供给 →
    // newDraft 自己的 startTransition),双击的第二下正落在这个窗口里。它只挡"上一次还没落地"的
    // 重入,不是"一个会话只准有一个 draft"的锁。
    if (draftInFlight) return
    draftInFlight = true
    // 打点在去重闸**之后**:被去重掉的那一下没有后续,记了就是一条永远配不上 `.end` 的孤儿。
    const startedAt = performance.now()
    let stepAt = startedAt
    const step = (name: string, outcome: string) => {
      const at = performance.now()
      markStartupTimeline("renderer.launch_draft.step", { step: name, outcome, durationMs: at - stepAt })
      stepAt = at
    }
    let outcome = "unknown"
    markStartupTimeline("renderer.launch_draft.start", { trigger })
    try {
      // 上游 tabs 是 persisted store:水合完成前写进去的 tab 会被随后的读盘结果覆盖,
      // draft 连同它的目录一起消失。
      if (!(await wait(() => tabs.ready()))) {
        step("tabs_ready", "cancelled")
        outcome = "cancelled:tabs"
        return
      }
      step("tabs_ready", "ok")
      const target = await resolveDraftTarget()
      if (!sidebarAlive) {
        step("resolve_target", "cancelled")
        outcome = "cancelled:unmounted"
        return
      }
      step("resolve_target", target ? (target.isDefaultWorkspace ? "default-workspace" : "project") : "none")
      if (!target) {
        pushToast({ kind: "error", title: t("codepuppy.sidebar.newChatNoWorkspace") })
        outcome = "no-workspace"
        return
      }
      // 不变量 5:目标是默认对话目录时,必须在**建 draft 之前**真的供给成功。这条 IPC 失败返回
      // `{ok:false}` 而不 throw,不看返回值 = 把会话开在一个不存在的目录上,而建 draft 又不碰引擎
      // (没有"引擎会如实报错"这层兜底),所以只能在这里拦。
      if (target.isDefaultWorkspace) {
        const provisioned = await props.projects.ensureDefaultWorkspace(target.directory)
        step("ensure_workspace", provisioned ? "ok" : "rejected")
        if (!provisioned) {
          pushToast({ kind: "error", title: t("codepuppy.sidebar.newChatWorkspaceFailed") })
          outcome = "workspace-failed"
          return
        }
      }
      // #925:draft 的 server 段 = **projects store 连着的那个 server**,不再是 active server。
      // 新对话页(CodePuppyNewSession)发第一条走 `props.projects.startChat` —— 会话**恒**建在
      // store 连着的 server 上,与 active 是谁无关(codepuppy-composer.tsx home 模式,#891 勘破)。
      // 而上游 `promoteDraft`(packages/codepuppy-app/src/app.tsx createDraftRoute)按 `draft.server` 建
      // session tab 并导航到 `/server/{draft.server}/session/{id}`:draft 带着 active server
      // 时,tab 与导航都落在一台**没有这个会话**的机器上 —— 这正是 #894 那个缺陷在 draft
      // 晋升这条线上的样子。key 缺席(sidecar 未就绪)⇒ 不建 draft、不猜:那时 store 无
      // client,startChat 也发不出去,建出来的只会是一个必然坏掉的对话页。
      const projectsKey = props.serverKey()
      if (!projectsKey) {
        pushToast({ kind: "error", title: t("codepuppy.sidebar.newChatFailed") })
        outcome = "no-server-key"
        return
      }
      await tabs.newDraft({ server: ServerConnection.Key.make(projectsKey), directory: target.directory })
      step("new_draft", "ok")
      outcome = "navigated"
    } finally {
      draftInFlight = false
      markStartupTimeline("renderer.launch_draft.end", {
        trigger,
        outcome,
        durationMs: performance.now() - startedAt,
      })
    }
  }

  // On app launch, land on a fresh draft (首页 composer 形态:ALPHA CODE wordmark + prompt box) —
  // not whatever opencode restores (it reopens the last session), and not the recent-sessions search
  // grid that bare "/" renders. Fires once, after the project list loads. Goes through the same
  // startDraft as the sidebar button (REQ-126 §4 序 3, one entry point), so cold start no longer mounts the
  // legacy shell either. No `replace` needed any more: the router already starts at "/", so Back
  // lands on home rather than bouncing through the admission route.
  // #1056:交接位在**侧栏 setup 这一拍**就 armed —— 早于路由树挂 CodePuppyHome(上游
  // `AppInterface` 的 ServerShell 先渲染 alpha children、后渲染路由 children)。放进下面那条
  // 效应里就晚了:`store.ready` 在冷启动实测要 6–10s 才为真(#1053 的 13 个样本),而首页
  // composer 早在 ~1.1s 就已经挂上并起了一条注定被取消的模型链。released 挂在启动这一次
  // startDraft 的结算上(成功即已导航走;如实失败则首页当场拿回 composer),
  // 侧栏卸载也算结算 —— 见 launch-draft-handoff.ts 的纪律段。
  // I-11 / BR-07:本窗口整页重载(sidecar 换代)后路由已回到重载前的位置 —— 启动落地只属于冷启动,
  // 这里不再开新 draft,也不关覆盖层(startDraft 会关);用户停在原处。
  const resumed = restoredRoute() !== undefined
  if (!resumed) beginLaunchDraftHandoff()
  onCleanup(endLaunchDraftHandoff)
  let didLaunchNav = resumed
  createEffect(() => {
    if (didLaunchNav || !store.ready) return
    didLaunchNav = true
    void startDraft("launch").finally(endLaunchDraftHandoff)
  })

  // Mount our chrome INSIDE #root (not <body>). opencode's draggable-region CSS is scoped to
  // `#root ... [data-tauri-drag-region]`, and its titlebar buttons are clickable only because they
  // sit inside that system (base.css auto-marks [data-tauri-drag-region] <button> as no-drag).
  // A <body>-level portal is excluded, so the OS treats our titlebar buttons as drag region and
  // eats their clicks. A host div appended to #root keeps position:fixed working (no contain there)
  // while putting us back inside opencode's region system.
  const portalHost = document.createElement("div")
  portalHost.setAttribute("data-codepuppy-chrome", "")
  document.getElementById("root")?.appendChild(portalHost)
  onCleanup(() => portalHost.remove())

  // Start a new chat in a project. We eagerly create a real session (not opencode's draft, which
  // is a tab — the alpha redesign hides the tab strip, so a draft would be invisible in the
  // sidebar) so the new conversation appears in the project immediately, then navigate into it.
  // If creation fails we fall back to opencode's draft route.
  const startChat = async (worktree: string) => {
    const submittedServerKey = props.serverKey()
    // REQ-126 AC2(#655 审计 Major):这条路径的导航发生在 `await createSession(...)` **之后**,
    // 而真实创建是多个 await(use-projects.ts:294-307)。只靠下面 navigate 里的咽喉点,慢请求
    // 或未决请求期间覆盖层会一直压在目标页面上 —— owner 报的原始症状在这条路径上照样复现。
    // 关闭属于**导航意图**,不属于导航结果,所以提到第一个 await 之前。
    closeAllOverlays()
    setProjectExpanded(worktree, true)
    // #925:server 身份在**发起创建那一刻**定格 —— `createSession` 在 store 连着的 server 上建
    // 会话,await 期间 store 可能改连别处(sidecar 重启换端口),完成后再读就是别人的 key。
    // key 缺席 ⇒ store 无 client,创建注定失败:如实报失败,不建、不猜。
    if (!submittedServerKey) {
      pushToast({ kind: "error", title: t("codepuppy.sidebar.newChatFailed") })
      return
    }
    await recordWorkspaceOpen(submittedServerKey, worktree)
    const id = await createSession(worktree)
    // REQ-126 不变量 1(#656):失败**不再**回退到 `newSessionHref(worktree)` —— 那个 href 就是
    // legacy admission 路由(sidebar/route.ts 的 directorySession),回退等于给 alpha 自己留了
    // 第二条进 admission 的入口。失败就如实说失败,不假装"已经给你开了个草稿"。
    // #925:导航消费创建那一刻的 server 快照,拼 canonical 的 `/server/:serverKey/session/:id`,
    // 不再走 legacy `/{目录}/session/{id}` 让壳按 active server 反推。
    if (id) navigate(hrefFor.session(submittedServerKey, id))
    else pushToast({ kind: "error", title: t("codepuppy.sidebar.newChatFailed") })
  }

  // "新对话" — 单一入口(见 startDraft)。此前它挑的目录是「当前项目 → 最近项目」,这既是
  // owner 报的"开在 alpha-code 而不是 ~/Alpha"(ADR-025 2026-07-28 修订推翻了该优先级),也是
  // 走 legacy admission 路由的那个入口本身。
  const newChat = () => void startDraft()

  // REQ-126 AC7(#658)「打开项目」。以前发上游 `project.open`,它只在 legacy layout
  // (`pages/layout.tsx`)注册 —— alpha 路由下只有 admission 那一跳短暂挂载过 → 空项目态那个按钮
  // 基本上永远点不动。而且就算接上,上游那条命令只把目录加进**上游 layout 自己的**项目列表,与
  // 侧栏读的引擎 project.list 是两套(REQ-068 已经为首页 chip 记过同一课)。所以改走 alpha 自己的
  // 路径:选目录 → 直接在该目录开一段对话(项目由引擎在首条消息时正式注册)。取消 = 静默。
  const openProject = async () => {
    let picked: string | string[] | null = null
    try {
      picked = await window.api.openDirectoryPicker({ title: t("codepuppy.sidebar.openProject") })
    } catch {
      pushToast({ kind: "error", title: t("codepuppy.home.openProjectFailed") })
      return
    }
    const directory = Array.isArray(picked) ? picked[0] : picked
    if (typeof directory !== "string" || !directory) return
    await startChat(directory)
  }

  // REQ-126 AC7(#658)壳级命令注册。桌面菜单(`main/menu.ts` → `sendMenuCommand` → 渲染进程
  // `cmd.trigger(id)`)发的这几个 id,上游的注册处全在已被 alpha 顶替的叶或 legacy layout 里 ——
  // 于是 Cmd+, / Cmd+O / Shift+Cmd+S / Cmd+B 在 alpha 的路由上按下去什么都不发生。
  // 侧栏本来就是这几件事的所有者(设置、新对话、打开项目、折叠),所以由它承接:挂载点与路由
  // 无关,注册也就与路由无关。键位沿用上游原值,免得抢注册反而把快捷键抹掉。
  // `hidden` = 不进命令面板列表(alpha 的「搜索」是会话搜索,不列命令)。
  //
  // **刻意不含 `common.goBack` / `common.goForward`**:上游 Titlebar 在首页/新对话页也注册同名
  // id,而重复 id 保留第一项 + Titlebar 先挂载 → 那两条路由永远是它赢,且它走的是只有 `["/"]`
  // 的私有 history(静默 no-op)。同一菜单项在不同路由两种行为,不是"语义相同"。这两条已在
  // `shared/desktop-menu-policy.ts` 显式退休;左上角那对按钮直连 `navigate(±1)`,始终有效。
  // 其余**退休**的菜单项同理,都从那份发布面直接删掉。
  command.register("codepuppy.shell", () => [
    { id: "settings.open", title: t("codepuppy.sidebar.settings"), keybind: SHELL_KEYBINDS["settings.open"], hidden: true, onSelect: () => openSettings() },
    { id: "session.new", title: t("codepuppy.sidebar.newChat"), keybind: SHELL_KEYBINDS["session.new"], hidden: true, onSelect: () => newChat() },
    { id: "project.open", title: t("codepuppy.sidebar.openProject"), keybind: SHELL_KEYBINDS["project.open"], hidden: true, onSelect: () => void openProject() },
    { id: "sidebar.toggle", title: t("codepuppy.sidebar.hide"), keybind: SHELL_KEYBINDS["sidebar.toggle"], hidden: true, onSelect: () => toggleSidebar() },
  ])

  const archiveProject = (worktree: string) => {
    dismissMenu(() => setMenuFor(null), projectMenuTrigger)
    hideProject(worktree)
    // B4(S17 T5):归档即从数据层剔除(use-projects 按 hidden 过滤)——reload 使其立即生效,
    // 此后该项目零请求(session.list 不再发起,引擎不再为其建 Instance)。
    void props.projects.reload()
  }

  // #925:会话 href 钉在**持有这个会话的那个 server**(= props.serverKey,store 反查出来的
  // 身份)上,canonical 形态,壳不再反推。key 缺席 ⇒ 返回 undefined / 不导航:侧栏的会话行
  // 本来就来自那份 store,store 没连上时一行都不会渲染出来 —— 真到了这里只说明身份不成立,
  // 随便挑一个 server 跳过去就是在制造 #894 那个事故(fail-closed,不猜)。
  const sessionLink = (id: string): string | undefined => {
    const key = props.serverKey()
    return key ? hrefFor.session(key, id) : undefined
  }

  const openSession = async (e: MouseEvent, session: CodePuppySession) => {
    e.preventDefault()
    const server = props.serverKey()
    const sessionID = session.id
    if (!server) return
    await recordWorkspaceOpen(server, session.directory)
    navigate(hrefFor.session(server, sessionID))
  }

  return (
    <Portal mount={portalHost}>
      {/* The open project "⋯" menu (archive / remove) + a transparent full-screen catcher that
          dismisses it on an outside click. Rendered once at the Portal root, fixed-positioned from
          the trigger button, so the project scroll container never clips it. */}
      <Show when={menuFor()}>
        {(worktree) => (
          <>
            <div class="codepuppy-menu-backdrop" onClick={() => dismissMenu(() => setMenuFor(null), projectMenuTrigger)} />
            <div
              ref={focusFirstMenuItem}
              class="codepuppy-project-menu"
              role="menu"
              style={{ top: `${menuPos()?.top ?? 0}px`, right: `${menuPos()?.right ?? 8}px` }}
              onKeyDown={(event) => dismissMenuOnEscape(event, () => setMenuFor(null), projectMenuTrigger)}
            >
              <button
                type="button"
                class="codepuppy-project-menu-item"
                role="menuitem"
                onClick={() => archiveProject(worktree())}
              >
                <svg class="codepuppy-project-menu-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="2.25" y="3" width="11.5" height="2.4" rx="0.6" stroke="currentColor" stroke-width="1.2" />
                  <path
                    d="M3.3 5.6h9.4V12a1 1 0 0 1-1 1H4.3a1 1 0 0 1-1-1V5.6Z"
                    stroke="currentColor"
                    stroke-width="1.2"
                  />
                  <path d="M6.4 8.4h3.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                </svg>
                <span>{t("codepuppy.sidebar.archive")}</span>
              </button>
              {/* opencode has no project-delete API (ADR-008): archive = client-side hide, restorable
                  via the "已归档(N)" row. The former duplicate "remove" button called the SAME
                  archiveProject() — dropped to avoid two identical actions. */}
            </div>
          </>
        )}
      </Show>

      <Show when={sessionMenu()}>
        {(m) => (
          <>
            <div class="codepuppy-menu-backdrop" onClick={() => dismissMenu(() => setSessionMenu(null), sessionMenuTrigger)} />
            <div
              ref={focusFirstMenuItem}
              class="codepuppy-project-menu"
              role="menu"
              style={{ top: `${m().top}px`, right: `${m().right}px` }}
              onKeyDown={(event) => dismissMenuOnEscape(event, () => setSessionMenu(null), sessionMenuTrigger)}
            >
              <button
                type="button"
                class="codepuppy-project-menu-item"
                role="menuitem"
                onClick={() => {
                  setEditingSession(m().id)
                  setSessionMenu(null)
                }}
              >
                <svg class="codepuppy-project-menu-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M11.5 2.5a1.4 1.4 0 0 1 2 2L6 12l-3 .8.8-3 7.7-7.3Z"
                    stroke="currentColor"
                    stroke-width="1.2"
                    stroke-linejoin="round"
                  />
                </svg>
                <span>{t("codepuppy.sidebar.rename")}</span>
              </button>
              {/* `#1668` R6:owner 裁定拿掉「分享对话」(2.x 引擎没有会话分享;不把会话发到任何外部地址)。 */}
              <button
                type="button"
                class="codepuppy-project-menu-item"
                role="menuitem"
                onClick={() => {
                  const id = m().id
                  dismissMenu(() => setSessionMenu(null), sessionMenuTrigger)
                  void (async () => {
                    const text = await copySession(id)
                    if (!text) {
                      pushToast({ kind: "error", title: t("codepuppy.sidebar.copyEmpty") })
                      return
                    }
                    const ok = await copyText(text)
                    pushToast(ok ? { kind: "success", title: t("codepuppy.sidebar.copyDone") } : { kind: "error", title: t("codepuppy.sidebar.copyFailed") })
                  })()
                }}
              >
                <svg class="codepuppy-project-menu-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="5" y="5" width="8" height="9" rx="1.3" stroke="currentColor" stroke-width="1.2" />
                  <path
                    d="M11 5V3.8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1V11a1 1 0 0 0 1 1h1"
                    stroke="currentColor"
                    stroke-width="1.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span>{t("codepuppy.sidebar.copyConversation")}</span>
              </button>
              <button
                type="button"
                class="codepuppy-project-menu-item codepuppy-project-menu-item-danger"
                role="menuitem"
                onClick={() => {
                  const id = m().id
                  dismissMenu(() => setSessionMenu(null), sessionMenuTrigger)
                  void (async () => {
                    if (props.serverKey() === EMBEDDED_SIDECAR_KEY)
                      await window.api.pluginSessionLeave({ sessionId: id, action: "leave", reason: "clear" })
                    const ok = await deleteSession(id)
                    if (!ok) pushToast({ kind: "error", title: t("codepuppy.sidebar.deleteFailed") })
                  })()
                }}
              >
                <svg class="codepuppy-project-menu-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M3 4.5h10M6.5 4.5V3.4a.9.9 0 0 1 .9-.9h1.2a.9.9 0 0 1 .9.9V4.5M11.7 4.5 11.2 12a1 1 0 0 1-1 .95H5.8a1 1 0 0 1-1-.95L4.3 4.5"
                    stroke="currentColor"
                    stroke-width="1.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span>{t("codepuppy.sidebar.delete")}</span>
              </button>
            </div>
          </>
        )}
      </Show>

      {/* The persistent window chrome (BR-01/BR-02): top bar + narrow rail, always mounted, same gray.
          The account popover is a child of the rail so it opens from the avatar (frame #account-menu). */}
      <ShellTopbar
        sidebarLabel={sidebarToggleLabel()}
        problemsDot={collapsedProblems() > 0}
        onToggleSidebar={() => toggleSidebar()}
        onBack={() => navigate(-1)}
        onForward={() => navigate(1)}
        pageTitle={pageTitle()}
        overlayOpen={pageOpen()}
      />
      <ShellRail
        onNewChat={() => newChat()}
        onSearch={() => command.show()}
        onHub={() => openPage("hub")}
        onAutomation={() => openPage("automation")}
        hubActive={extHubOpen()}
        automationActive={automationOpen()}
        automationBadge={automationFailedCount()}
        accountInitial={acctInitial()}
        signedIn={authState().status === "logged-in"}
        accountOpen={menuOpen()}
        onAccount={() => setMenuOpen((o) => !o)}
      >
    <Show when={menuOpen()}>
      <div class="codepuppy-acct-backdrop" onClick={() => setMenuOpen(false)} />
      <div class="codepuppy-acct-pop" role="menu">
        <Show
          when={authState().status === "logged-in"}
          fallback={
            <>
              <div class="codepuppy-acct-head">
                <span class="codepuppy-acct-av guest">{acctInitial()}</span>
                <div class="codepuppy-acct-id">
                  <div class="codepuppy-acct-name">{t("codepuppy.sidebar.signedOut")}</div>
                  <div class="codepuppy-acct-email">{t("codepuppy.sidebar.loginCloud")}</div>
                </div>
              </div>
              <button
                class="codepuppy-acct-login"
                onClick={() => {
                  setMenuOpen(false)
                  void window.api.auth.start()
                }}
              >
                {t("codepuppy.auth.signIn")}
              </button>
              <MenuCommon />
            </>
          }
        >
          <div class="codepuppy-acct-head">
            <span class="codepuppy-acct-av">{acctInitial()}</span>
            <div class="codepuppy-acct-id">
              <div class="codepuppy-acct-name">{t("codepuppy.sidebar.yourAccount")}</div>
              <div class="codepuppy-acct-email">{accountLabel()}</div>
            </div>
            <span class="codepuppy-acct-plan" data-pro={acctIsPro() ? "" : undefined}>
              {acctTierLabel()}
            </span>
          </div>
          <div class="codepuppy-acct-card-slot">
            {/* #1686:余额卡改用组件库「卡片 + 名称 — 值列表」;弹层外边距在 slot 上(组件不带外边距)。
                B11:读取失败时订阅行不装「未订阅」(状态未知),与其余行一致显示 pending/错误占位。
                REQ-146(#1194):window5h/window7d 只有订阅计划才有;未订阅时这两行显示 summary.usage 的真实用量,
                标签随之换成「今日/7 日用量」。已订阅仍显示订阅额度窗口。 */}
            <Card>
              <KeyValueList
                rows={[
                  summary() || summaryState() !== "error"
                    ? { label: t("codepuppy.sidebar.subscription"), value: activePlan()?.name ?? (isPro() ? plan() : t("codepuppy.sidebar.notSubscribed")) }
                    : { label: t("codepuppy.sidebar.subscription"), state: pendingState() },
                  summary()
                    ? { label: t("codepuppy.sidebar.balance"), value: fmtYuan(summary()!.balanceFen) }
                    : { label: t("codepuppy.sidebar.balance"), state: pendingState() },
                  {
                    label: activePlan() ? t("codepuppy.sidebar.fiveHour") : t("codepuppy.sidebar.todayUsage"),
                    ...(!summary()
                      ? { state: pendingState() }
                      : {
                          value: activePlan()
                            ? `${activePlan()!.window5h.usedCredits.toLocaleString()} / ${activePlan()!.window5h.limitCredits.toLocaleString()}`
                            : fmtTokens(summary()!.usage.todayTokens),
                        }),
                  },
                  {
                    label: activePlan() ? t("codepuppy.sidebar.sevenDay") : t("codepuppy.sidebar.weekUsage"),
                    ...(!summary()
                      ? { state: pendingState() }
                      : {
                          value: activePlan()
                            ? `${activePlan()!.window7d.usedCredits.toLocaleString()} / ${activePlan()!.window7d.limitCredits.toLocaleString()}`
                            : fmtTokens(summary()!.usage.weekTokens),
                        }),
                  },
                  summary() && summary()!.usageSeries.length > 0
                    ? { label: t("codepuppy.sidebar.fourteenDay"), value: <Sparkline data={summary()!.usageSeries.map((p) => p.tokens)} /> }
                    : summary()
                      ? { label: t("codepuppy.sidebar.fourteenDay"), value: t("codepuppy.sidebar.noData"), state: "unavailable" as const }
                      : { label: t("codepuppy.sidebar.fourteenDay"), state: pendingState() },
                ]}
              />
            </Card>
          </div>
          <div class="codepuppy-acct-cta">
            <Show when={!acctIsPro()}>
              <button class="codepuppy-acct-btn primary" onClick={() => openWalletPage(subscribeUrl())}>
                {t("codepuppy.sidebar.upgrade")}
              </button>
            </Show>
            <button class="codepuppy-acct-btn" onClick={() => openWalletPage(rechargeUrl())}>
              {t("codepuppy.sidebar.recharge")}
            </button>
            <Show when={acctIsPro()}>
              <button class="codepuppy-acct-btn" onClick={() => openWalletPage(subscribeUrl())}>
                {t("codepuppy.sidebar.manageSubscription")}
              </button>
            </Show>
          </div>
          <MenuCommon />
          <div class="codepuppy-acct-sep" />
          <button
            class="codepuppy-acct-item codepuppy-acct-danger"
            onClick={() => {
              setMenuOpen(false)
              void window.api.auth.logout()
            }}
          >
            <ShellIcon name="logout" class="codepuppy-acct-ic" />{t("codepuppy.sidebar.signOut")}
          </button>
        </Show>
        <Show when={appVersion()}>
          <button type="button" class="codepuppy-acct-version" onClick={() => void copyBuildIdentity()}>
            <Show
              when={!versionCopied()}
              fallback={t("codepuppy.common.copied")}
            >
              {t("codepuppy.sidebar.version")} {appVersion()}
              <Show when={buildIdentity() && buildMarker(buildIdentity()!)}>
                {(marker) => (
                  <span class="codepuppy-acct-version-tag" data-marker={marker()}>
                    {t(marker() === "dev" ? "codepuppy.sidebar.buildMarker.dev" : "codepuppy.sidebar.buildMarker.local")}
                  </span>
                )}
              </Show>
            </Show>
          </button>
        </Show>
      </div>
    </Show>
      </ShellRail>

      <Show when={!sidebarCollapsed()}>
        <aside class="codepuppy-sidebar" aria-label={t("codepuppy.sidebar.projects")}>
          <header class="codepuppy-sidebar-brand">
            <button
              type="button"
              class="codepuppy-sidebar-brand-mark"
              title={t("codepuppy.sidebar.home")}
              onClick={() => navigate(homeHref())}
            >
              <img class="codepuppy-sidebar-mark" src={brandMark} alt="" />
              <span class="codepuppy-sidebar-wordmark">{t("codepuppy.brand.wordmark")}</span>
            </button>
          </header>

          <div class="codepuppy-sidebar-section">
            <span>{t("codepuppy.sidebar.projects")}</span>
            <span class="codepuppy-sidebar-acts">
              <Show when={visibleProjects().length > 0}>
                <button
                  type="button"
                  class="codepuppy-sidebar-icon-btn"
                  data-on={filterOpen() ? "" : undefined}
                  title={t("codepuppy.sidebar.filterProjects")}
                  aria-label={t("codepuppy.sidebar.filterProjects")}
                  aria-pressed={filterOpen()}
                  onClick={() => toggleFilter()}
                >
                  <ShellIcon name="search" size={14} />
                </button>
              </Show>
              <button
                type="button"
                class="codepuppy-sidebar-icon-btn"
                title={t("codepuppy.sidebar.openProject")}
                aria-label={t("codepuppy.sidebar.openProject")}
                onClick={() => void openProject()}
              >
                <ShellIcon name="plus" size={14} />
              </button>
            </span>
          </div>

          {/* The in-place filter (the former always-visible search box) opens from the section's search icon. */}
          <Show when={visibleProjects().length > 0 && (filterOpen() || searchQuery() !== "")}>
            <div class="codepuppy-sidebar-search">
              <ShellIcon name="search" size={14} class="codepuppy-sidebar-search-icon" />
              <input
                ref={(el) => queueMicrotask(() => el.focus())}
                class="codepuppy-sidebar-search-input"
                type="text"
                placeholder={t("codepuppy.sidebar.searchProjects")}
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") toggleFilter(false)
                }}
              />
              <Show when={searchQuery() !== ""}>
                <button
                  type="button"
                  class="codepuppy-sidebar-search-clear"
                  aria-label={t("codepuppy.sidebar.clearSearch")}
                  onClick={() => setSearchQuery("")}
                >
                  ×
                </button>
              </Show>
            </div>
          </Show>

          <div class="codepuppy-sidebar-scroll">
            <For each={searchedProjects()}>
              {(project) => {
                const expanded = () => isProjectExpanded(project.worktree) || searchQuery().trim() !== ""
                const menuOpen = () => menuFor() === project.worktree
                return (
                  <div class="codepuppy-project" data-expanded={expanded() ? "" : undefined}>
                    <div
                      class="codepuppy-project-row"
                      data-active={!pageOpen() && activeProject()?.worktree === project.worktree ? "" : undefined}
                      data-menu={menuOpen() ? "" : undefined}
                      onClick={() => toggleProjectExpanded(project.worktree)}
                    >
                      <ShellIcon name={expanded() ? "folder-open" : "folder"} class="codepuppy-project-icon" />
                      <span class="codepuppy-project-name" title={project.worktree}>
                        {projectDisplayName(project)}
                      </span>
                      <button
                        type="button"
                        class="codepuppy-project-action"
                        title={t("codepuppy.sidebar.more")}
                        aria-label={t("codepuppy.sidebar.more")}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen()}
                        onClick={(e) => openProjectMenu(e, project.worktree)}
                      >
                        <ShellIcon name="more" size={14} />
                      </button>
                      <button
                        type="button"
                        class="codepuppy-project-action codepuppy-project-add"
                        title={t("codepuppy.sidebar.newChatInProject")}
                        aria-label={t("codepuppy.sidebar.newChat")}
                        onClick={(e) => {
                          e.stopPropagation()
                          void startChat(project.worktree)
                        }}
                      >
                        <ShellIcon name="pen" size={14} />
                      </button>
                    </div>

                    <Show when={expanded()}>
                      <div class="codepuppy-project-sessions">
                        <For
                          each={shownSessions(project)}
                          fallback={
                            <div class="codepuppy-sidebar-empty">
                              {project.loaded ? t("codepuppy.sidebar.noConversations") : t("codepuppy.sidebar.loading")}
                            </div>
                          }
                        >
                          {(session) => (
                            <div
                              class="codepuppy-session-row"
                              data-active={viewingSessionId() === session.id ? "" : undefined}
                            >
                              <Show
                                when={editingSession() === session.id}
                                fallback={
                                  <>
                                    <a
                                      class="codepuppy-session"
                                      href={sessionLink(session.id)}
                                      data-active={viewingSessionId() === session.id ? "" : undefined}
                                      onClick={(e) => openSession(e, session)}
                                    >
                                      <span class="codepuppy-session-title">{sessionDisplayTitle(session.title)}</span>
                                    </a>
                                    <span class="codepuppy-session-slot">
                                      <Show
                                        when={
                                          isSessionUnread(session.id, session.updated) &&
                                          route().sessionId !== session.id
                                        }
                                      >
                                        <span class="codepuppy-session-unread" aria-hidden="true" />
                                      </Show>
                                      <button
                                        type="button"
                                        class="codepuppy-session-menu-btn"
                                        aria-label={t("codepuppy.sidebar.sessionActions")}
                                        aria-haspopup="menu"
                                        aria-expanded={sessionMenu()?.id === session.id}
                                        onClick={(e) => openSessionMenu(e, session)}
                                      >
                                        <ShellIcon name="more" size={14} />
                                      </button>
                                    </span>
                                  </>
                                }
                              >
                                <input
                                  class="codepuppy-session-rename"
                                  value={session.title}
                                  autofocus
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      const v = e.currentTarget.value
                                      setEditingSession(null)
                                      void renameSession(session.id, v).then(
                                        (ok) =>
                                          ok || pushToast({ kind: "error", title: t("codepuppy.sidebar.renameFailed") }),
                                      )
                                    } else if (e.key === "Escape") {
                                      setEditingSession(null)
                                    }
                                  }}
                                  onBlur={(e) => {
                                    const v = e.currentTarget.value
                                    setEditingSession(null)
                                    void renameSession(session.id, v).then(
                                      (ok) =>
                                        ok || pushToast({ kind: "error", title: t("codepuppy.sidebar.renameFailed") }),
                                    )
                                  }}
                                />
                              </Show>
                            </div>
                          )}
                        </For>
                        <Show when={project.sessions.length > SESSIONS_SHOWN && !allSessionsShown(project)}>
                          <button
                            type="button"
                            class="codepuppy-sessions-more"
                            onClick={() => setMoreShown((prev) => new Set(prev).add(project.worktree))}
                          >
                            {t("codepuppy.sidebar.showMore")}
                          </button>
                        </Show>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>

            <Show when={searchQuery().trim() !== "" && searchedProjects().length === 0}>
              <div class="codepuppy-sidebar-empty">{t("codepuppy.sidebar.noMatches")}</div>
            </Show>
            <Show when={store.ready && !store.error && visibleProjects().length === 0 && archivedCount() === 0}>
              <div class="codepuppy-sidebar-empty codepuppy-sidebar-empty-projects">
                <ShellIcon name="folder" size={20} class="codepuppy-sidebar-empty-icon" />
                <h4>{t("codepuppy.sidebar.emptyTitle")}</h4>
                <p>{t("codepuppy.sidebar.emptyBody")}</p>
                <button
                  type="button"
                  class="codepuppy-sidebar-open-project"
                  data-codepuppy-sidebar-open-project
                  onClick={() => void openProject()}
                >
                  <ShellIcon name="plus" />
                  {t("codepuppy.sidebar.openProjectRow")}
                </button>
                <div class="codepuppy-sidebar-empty-note">{t("codepuppy.sidebar.emptyNote")}</div>
              </div>
            </Show>
            {/* B11: project.list failure previously left the sidebar silently blank (store.error was
                never rendered anywhere). Surface it with a retry instead of a dead empty pane. */}
            <Show when={store.error}>
              <div class="codepuppy-sidebar-empty codepuppy-sidebar-empty-projects">
                <p>{t("codepuppy.sidebar.projectsFailed")}</p>
                <button type="button" class="codepuppy-sidebar-open-project" onClick={() => void reload()}>
                  {t("codepuppy.common.retry")}
                </button>
              </div>
            </Show>

            {/* Archived projects are only hidden (opencode has no server-side project deletion), so
                always offer a one-click restore — archiving must never strand a project. */}
            <Show when={archivedCount() > 0}>
              <button type="button" class="codepuppy-sidebar-archived" onClick={() => clearHiddenProjects()}>
                <span>{t("codepuppy.sidebar.archivedShow", { count: archivedCount() })}</span>
                <span class="codepuppy-sidebar-archived-action">{t("codepuppy.sidebar.unarchiveAll")}</span>
              </button>
            </Show>
          </div>

          {/* Footer: the update note and the unresolved-problems entry. The account lives on the rail. */}
          <footer class="codepuppy-sidebar-footer" data-menu-open={menuOpen() ? "" : undefined}>
            {/* [ac#1207] REQ-147 更新条:呈现完全由 updater-state-surface.ts 的映射驱动。
                挂在 footer 而不是浮层里 —— AC2 要求「已就绪,重启安装」在
                重启后不依赖任何菜单/对话框恰好开着就能看见。 */}
            <Show when={updaterSurface()} keyed>
              {(surface) => (
                <div class="codepuppy-updater-note" data-status={updaterState().status} role="status">
                  <span class="codepuppy-updater-text">{t(surface.textKey, surface.params)}</span>
                  <Show when={surface.action === "install"}>
                    <button
                      type="button"
                      class="codepuppy-updater-install"
                      onClick={() => {
                        // 点安装也算主动:恢复态的重验若落 error/up-to-date,反馈必须可见。
                        setUpdaterSolicited(true)
                        void window.api.updater.install()
                      }}
                    >
                      {t("codepuppy.updater.installNow")}
                    </button>
                  </Show>
                  <Show when={surface.dismissible}>
                    <button
                      type="button"
                      class="codepuppy-updater-dismiss"
                      aria-label={t("codepuppy.updater.dismiss")}
                      onClick={() => setUpdaterSolicited(false)}
                    >
                      ×
                    </button>
                  </Show>
                </div>
              )}
            </Show>
            {/* `#1687`:未恢复问题入口(设计稿 `#problems`)。 */}
            <ProblemsEntry />
          </footer>
        </aside>
      </Show>
    </Portal>
  )
}
