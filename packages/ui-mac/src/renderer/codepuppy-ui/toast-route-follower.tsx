// 离开当前页面时关闭用户操作类的常驻提示(SPEC-error-message-lifetime BR-05,`#1687`)。
// 无界面子组件,挂在路由内(index.tsx,与 ExtTrustWatcher 同层)。单独成件:ToastViewport 本身
// 不依赖路由,`composer-a11y` 等不带 Router 的测试仍可直接挂它。
import { createEffect, on } from "solid-js"
import { useLocation } from "@solidjs/router"
import { dismissPageToasts } from "./Toast"

export function ToastRouteFollower() {
  const location = useLocation()
  createEffect(on(() => location.pathname, () => dismissPageToasts(), { defer: true }))
  return null
}
