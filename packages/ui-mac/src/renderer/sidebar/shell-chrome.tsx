// The persistent window chrome around the working surface (BR-01/BR-02): the top bar (left cluster,
// page title slot, right-panel toggle) and the narrow rail. Stateless — codepuppy-sidebar.tsx owns
// the behaviour and passes callbacks, so the chrome and the sidebar share one navigation choke point.
// Visuals: docs/design/2026-11-18-ui-refresh/frame.html `#home`, geometry tokens --a-rail-w / --a-topbar-h.

import { Show, type JSX } from "solid-js"
import { t } from "../i18n"
import { Tooltip } from "../codepuppy-ui/Tooltip"
import { ShellIcon, type ShellIconName } from "../codepuppy-ui/shell-icons"
import { setTopbarTitleHost } from "../codepuppy-ui/shell-chrome-state"
import { rightPanelOpen, toggleRightPanel } from "../codepuppy-ui/session-workspace/right-panel-state"

function TopbarButton(props: {
  icon: ShellIconName
  label: string
  onClick: () => void
  pressed?: boolean
  dot?: boolean
  attrs?: Record<string, string>
}) {
  return (
    <Tooltip label={props.label} placement="bottom">
      <button
        type="button"
        class="codepuppy-topbar-btn"
        data-on={props.pressed ? "" : undefined}
        data-problems={props.dot ? "" : undefined}
        aria-label={props.label}
        aria-pressed={props.pressed === undefined ? undefined : props.pressed}
        onClick={props.onClick}
        {...props.attrs}
      >
        <ShellIcon name={props.icon} />
      </button>
    </Tooltip>
  )
}

export function ShellTopbar(props: {
  sidebarLabel: string
  /** Unresolved problems are hidden with the collapsed sidebar; a dot on the toggle says so. */
  problemsDot: boolean
  onToggleSidebar: () => void
  onBack: () => void
  onForward: () => void
  /** Title of a top-level page (new chat, Customization Center, automation, settings). */
  pageTitle?: string
  /** A full page is open over the workspace: the workspace's own title and right panel step aside. */
  overlayOpen: boolean
}) {
  return (
    <header class="codepuppy-topbar" data-codepuppy-topbar data-overlay={props.overlayOpen ? "" : undefined}>
      <div class="codepuppy-topbar-left">
        <TopbarButton
          icon="panel-left"
          label={props.sidebarLabel}
          dot={props.problemsDot}
          onClick={props.onToggleSidebar}
          attrs={{ "data-codepuppy-topbar-action": "sidebar" }}
        />
        <TopbarButton icon="left" label={t("codepuppy.sidebar.back")} onClick={props.onBack} />
        <TopbarButton icon="right" label={t("codepuppy.sidebar.forward")} onClick={props.onForward} />
      </div>
      <div class="codepuppy-topbar-title">
        <Show when={props.pageTitle}>{(title) => <span class="codepuppy-topbar-page">{title()}</span>}</Show>
        {/* The session workspace renders its breadcrumb and status pills here (shell-chrome-state.ts). */}
        <div class="codepuppy-topbar-session" ref={setTopbarTitleHost} />
      </div>
      <div class="codepuppy-topbar-trail">
        {/* Home and conversations share one right panel (right-panel-state.ts); the full pages
            (Customization Center, automation, settings) have none, so the toggle steps aside. */}
        <Show when={!props.overlayOpen}>
          <TopbarButton
            icon="panel-right"
            label={rightPanelOpen() ? t("codepuppy.session.closeRail") : t("codepuppy.session.openRail")}
            pressed={rightPanelOpen()}
            onClick={toggleRightPanel}
            attrs={{ "data-codepuppy-topbar-action": "right-panel", "aria-controls": "codepuppy-session-rail-host" }}
          />
        </Show>
      </div>
    </header>
  )
}

function RailButton(props: {
  icon: ShellIconName
  label: string
  action: string
  onClick: () => void
  active?: boolean
  badge?: number
}) {
  return (
    <Tooltip label={props.label} placement="bottom">
      <button
        type="button"
        class="codepuppy-rail-btn codepuppy-sidebar-nav-item"
        data-codepuppy-sidebar-nav={props.action}
        data-on={props.active ? "" : undefined}
        aria-label={props.label}
        aria-pressed={props.active === undefined ? undefined : props.active}
        onClick={props.onClick}
      >
        <ShellIcon name={props.icon} size={18} />
        <Show when={(props.badge ?? 0) > 0}>
          <span class="codepuppy-auto-badge codepuppy-rail-badge">{props.badge}</span>
        </Show>
      </button>
    </Tooltip>
  )
}

export function ShellRail(props: {
  onNewChat: () => void
  onSearch: () => void
  onHub: () => void
  onAutomation: () => void
  hubActive: boolean
  automationActive: boolean
  automationBadge: number
  accountInitial: string
  signedIn: boolean
  accountOpen: boolean
  onAccount: () => void
  /** The account popover mounts inside the rail so it is anchored to the avatar. */
  children?: JSX.Element
}) {
  return (
    <nav class="codepuppy-rail codepuppy-sidebar-nav" aria-label={t("codepuppy.sidebar.projects")} data-codepuppy-rail-host>
      <RailButton icon="pen" label={t("codepuppy.sidebar.newChat")} action="new-chat" onClick={props.onNewChat} />
      <RailButton icon="search" label={t("codepuppy.sidebar.searchChats")} action="search" onClick={props.onSearch} />
      <RailButton
        icon="grid"
        label={t("codepuppy.sidebar.plugins")}
        action="hub"
        onClick={props.onHub}
        active={props.hubActive}
      />
      <RailButton
        icon="calendar"
        label={t("codepuppy.sidebar.automation")}
        action="automation"
        onClick={props.onAutomation}
        active={props.automationActive}
        badge={props.automationBadge}
      />
      <span class="codepuppy-rail-grow" />
      <button
        type="button"
        class="codepuppy-rail-avatar codepuppy-sidebar-account"
        data-auth={props.signedIn ? "in" : "out"}
        data-open={props.accountOpen ? "" : undefined}
        aria-label={t("codepuppy.auth.account")}
        aria-haspopup="menu"
        aria-expanded={props.accountOpen}
        onClick={props.onAccount}
      >
        {props.accountInitial}
      </button>
      {props.children}
    </nav>
  )
}
