// `#1687` 弹出提示去留的测试运行时:真 ToastViewport + 真 ToastRouteFollower(挂在 MemoryRouter 里)。
import { MemoryRouter, Route, createMemoryHistory } from "@solidjs/router"
import { ToastViewport } from "./Toast"
import { ToastRouteFollower } from "./toast-route-follower"

export {
  ToastViewport,
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
        {props.children}
      </>
    )}>
      <Route path="*" component={() => null} />
    </MemoryRouter>
  )
}
export { render } from "solid-js/web"
