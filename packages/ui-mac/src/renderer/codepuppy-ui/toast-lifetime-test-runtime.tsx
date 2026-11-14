// `#1687` 弹出提示去留的测试运行时:真 ToastViewport + 真 ToastRouteFollower(挂在 MemoryRouter 里)
// + 真「未恢复问题」入口 ProblemsEntry(侧栏 footer 里的那一个组件;挂在真实侧栏里的证据在 overlay-close.cases.ts)。
import { MemoryRouter, Route, createMemoryHistory } from "@solidjs/router"
import { For } from "solid-js"
import { ToastViewport } from "./Toast"
import { ToastRouteFollower } from "./toast-route-follower"
import { ProblemsEntry } from "../sidebar/problems-entry"

export { putProblem, unresolvedProblems } from "./problems"
export {
  ToastViewport,
  STARTUP_QUIET_MS,
  beginStartupQuiet,
  TOAST_BACKGROUND_MS,
  TOAST_DEFAULT_MS,
  dismissToast,
  pushToast,
  reportProblem,
  resolveProblem,
} from "./Toast"

const history = createMemoryHistory()
history.set({ value: "/a" })

export function navigateTo(path: string) {
  history.set({ value: path })
}

/** 与 index.tsx 同形:视口与路由跟随件同挂,跟随件在路由上下文内。 */
export function RoutedToastHarness() {
  return (
    <MemoryRouter history={history} root={(props) => (
      <>
        <ToastViewport />
        <ToastRouteFollower />
        <footer class="codepuppy-sidebar-footer">
          <ProblemsEntry />
        </footer>
        {props.children}
      </>
    )}>
      <Route path="*" component={() => null} />
    </MemoryRouter>
  )
}
export { render } from "solid-js/web"

// `#1669`:真 TurnErrorCard + 时间线入口,判「用户自己发出的那一轮失败」不受 #1687 去留规则影响(行由测试进程经生产投影算好传进来)。
import { TurnErrorCard } from "./session-timeline/cards/tool-cards"
import { TimelineIntentsContext, type TimelineIntents } from "./session-timeline/cards/timeline-intents"
import type { TimelineRow } from "./session-timeline/timeline-model"
export function TurnErrorCards(props: { rows: () => TimelineRow[]; intents: TimelineIntents }) {
  return (
    <TimelineIntentsContext.Provider value={props.intents}>
      <For each={props.rows().filter((row): row is Extract<TimelineRow, { kind: "turnError" }> => row.kind === "turnError")}>
        {(row) => <TurnErrorCard row={row} />}
      </For>
    </TimelineIntentsContext.Provider>
  )
}
export { setLocale } from "../i18n"
export { CatalogProblemWatcher } from "./catalog-problem-watcher"
export { BackgroundProblemWatcher } from "./background-problem-watcher"
import { extHubOpen, hubSection } from "../extensions/ext-hub-state"
export const hubState = () => ({ open: extHubOpen(), section: hubSection() })
export { setHubSection, takeHubLocateTarget } from "../extensions/ext-hub-state"
