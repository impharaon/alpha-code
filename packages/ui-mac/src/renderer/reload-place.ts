// I-11 / BR-07(方案 C):sidecar 换代引起的整页重载后,路由从重载前的位置起步。位置的读写在 reload-place-store.ts。
import { createComponent, mergeProps } from "solid-js"
import { MemoryRouter, createMemoryHistory, type MemoryRouterProps } from "@solidjs/router"
import { restoredRoute } from "./reload-place-store"

export { placeAfterReload, rememberHub, rememberRoute, restoredRoute, type ReloadPlace } from "./reload-place-store"

/** MemoryRouter 的 history:重载后从存下的路由起步,否则与 createMemoryHistory() 相同(从「/」起步)。 */
export function restoredHistory() {
  const history = createMemoryHistory()
  const route = restoredRoute()
  if (route) history.set({ value: route, replace: true })
  return history
}

/** renderer/index.tsx 交给 AppInterface 的路由:MemoryRouter,起点按 restoredHistory()。 */
export function RestoredMemoryRouter(props: MemoryRouterProps) {
  return createComponent(MemoryRouter, mergeProps(props, { history: restoredHistory() }))
}
