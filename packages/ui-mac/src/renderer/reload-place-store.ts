// I-11 / BR-07(方案 C):连接器改动让 sidecar 换代时,main 整页重载渲染进程(main/index.ts 的 respawn)。重载后用户仍在原处:
// 同一路由、定制中心照旧开着并停在原来的页签。位置存在本窗口的 sessionStorage,只在当前页面确实由重载而来时才用
// (PerformanceNavigationTiming.type === "reload",webContents.reload() 就是这一种);新开的窗口与冷启动照旧:定制中心关着,
// 侧栏落到新对话。本模块只读写存储(定制中心状态与侧栏共用,不引路由);路由起点见 reload-place.ts。
const KEY = "codepuppy.place.v1"

export type ReloadPlace = { route?: string; hub?: { section: string } }

function read(): ReloadPlace {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as unknown
    if (!value || typeof value !== "object") return {}
    const place = value as { route?: unknown; hub?: unknown }
    const section = place.hub && typeof place.hub === "object" ? (place.hub as { section?: unknown }).section : undefined
    return {
      ...(typeof place.route === "string" && place.route.startsWith("/") ? { route: place.route } : {}),
      ...(typeof section === "string" ? { hub: { section } } : {}),
    }
  } catch {
    return {}
  }
}

function write(place: ReloadPlace): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(place))
  } catch {
    // 存不下只是重载后回不到原处,不影响当前页面。
  }
}

/** 当前页面由重载本窗口而来。 */
function reloaded(): boolean {
  const navigation = performance.getEntriesByType?.("navigation")[0] as { type?: string } | undefined
  return navigation?.type === "reload"
}

/** 本窗口重载之前所在的位置;不是重载来的页面(或什么都没存下)⇒ 空。 */
export function placeAfterReload(): ReloadPlace {
  return reloaded() ? read() : {}
}

/** 路由每变一次记一次(侧栏的路由 effect)。 */
export function rememberRoute(route: string): void {
  write({ ...read(), route })
}

/** 定制中心开着 ⇒ 记下页签;关上 ⇒ 清掉。 */
export function rememberHub(hub: { section: string } | undefined): void {
  const { hub: _previous, ...rest } = read()
  write(hub ? { ...rest, hub } : rest)
}

/** 重载后路由起点:存下的路由(裸「/」不算,那是冷启动落地之前的过渡位置,照旧交给启动落地)。 */
export function restoredRoute(): string | undefined {
  const route = placeAfterReload().route
  return route && route !== "/" ? route : undefined
}
