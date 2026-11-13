// `#1668`(L6):Code Puppy 的引擎适配器 —— 冻结界面(0.1.26 的 v1 数据路径)到 OpenCode 2 引擎的**唯一咽喉**。
//
// 冻结的 v1 SDK 与 1.17.13 客户端照常把调用序列化成 HTTP 请求,只是它们的 `fetch` 换成这里的 `engineFetch`:
// 发往引擎源地址的请求按「方法 + 路径模板」查路由表(routes.ts),由 handler 调 2.x 的 `/api/*` 并把结果译回
// v1 形状;表外的请求一律 501 + console.error(对未知默认拒,不猜一个最像的 2.x 端点)。别的源原样交给
// `globalThis.fetch`。
//
// 适配器不做任何决定(审批、档位、目录闸都在引擎与 ext),不持有口令(I8:`Authorization` 由 main 的
// `onBeforeSendHeaders` 对引擎源补上)。审批这一侧只保留回执状态(permission-replies.ts:交出过的请求快照指纹、
// 已出的收据,窗口寿命、不落盘),那是 0.1.26 回执合同要的幂等与 409,不重放引擎数据。
import { OpenCode, type OpenCodeClient } from "@opencode/client/promise"
import { createPermissionReplies, type PermissionReplies } from "./opencode2/permission-replies"
import { ROUTES, type Route, type RouteContext } from "./opencode2/routes"

export const UNSUPPORTED_ERROR_NAME = "CodePuppyEngineAdapterUnsupported"

export type EngineFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type Compiled = { route: Route; method: string; segments: string[] }

const compiled: Compiled[] = ROUTES.map((route) => ({
  route,
  method: route.method,
  segments: route.path.split("/").filter(Boolean),
}))

/** 按「方法 + 路径模板」匹配;模板段 `:name` 取一段,`*name` 取余下全部(fs.read 那种带斜杠的路径)。 */
export function matchRoute(method: string, pathname: string) {
  const parts = pathname.split("/").filter(Boolean)
  for (const entry of compiled) {
    if (entry.method !== method) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let index = 0; index < entry.segments.length; index++) {
      const segment = entry.segments[index]!
      if (segment.startsWith("*")) {
        params[segment.slice(1)] = parts.slice(index).map(decodeURIComponent).join("/")
        index = entry.segments.length
        break
      }
      const part = parts[index]
      if (part === undefined) {
        ok = false
        break
      }
      if (segment.startsWith(":")) params[segment.slice(1)] = decodeURIComponent(part)
      else if (segment !== part) {
        ok = false
        break
      }
    }
    if (!ok) continue
    if (!entry.segments.some((segment) => segment.startsWith("*")) && parts.length !== entry.segments.length) continue
    return { route: entry.route, params }
  }
  return undefined
}

function directoryOf(url: URL, request: Request) {
  const query = url.searchParams.get("directory") ?? url.searchParams.get("location[directory]")
  if (query) return query
  const header = request.headers.get("x-opencode-directory")
  if (!header) return undefined
  try {
    return decodeURIComponent(header)
  } catch {
    return header
  }
}

export function unsupported(method: string, path: string) {
  console.error(`[engine-adapter] unsupported engine request: ${method} ${path}`)
  return Response.json({ name: UNSUPPORTED_ERROR_NAME, data: { method, path } }, { status: 501 })
}

/** 2.x 调用失败 ⇒ v1 的错误体。2.x 声明过的错误(带 `_tag`)保留名字与消息;状态码按 404 / 其余 500 分。 */
export function errorResponse(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError"
  const message = error instanceof Error ? error.message : String(error)
  const notFound = /NotFound/.test(name)
  return Response.json({ name: notFound ? "NotFoundError" : name, data: { message } }, { status: notFound ? 404 : 500 })
}

export function createEngineFetch(options: {
  /** 这个源是不是 Code Puppy 连着的引擎(本机 sidecar / WSL)。 */
  isEngineOrigin: (origin: string) => boolean
  /** 真正出网的 fetch;测试注入,生产是 webview 的 fetch。 */
  fetch?: typeof globalThis.fetch
}): EngineFetch {
  const upstreamFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  // 每个请求一个 2.x 客户端:它发出的每个调用都带上这次请求的取消信号(调用自己另带的信号照旧生效)。冻结界面靠它给引擎
  // 调用设上限 —— 侧栏自探的 `AbortSignal.timeout(2_000)`(use-projects.ts)、组件卸载时中止的读取。
  const clientFor = (origin: string, signal: AbortSignal): OpenCodeClient =>
    OpenCode.make({
      baseUrl: origin,
      fetch: ((input, init) =>
        upstreamFetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal })) as typeof fetch,
    })
  const replies = new Map<string, PermissionReplies>()
  const repliesFor = (origin: string) => {
    const existing = replies.get(origin)
    if (existing) return existing
    const created = createPermissionReplies()
    replies.set(origin, created)
    return created
  }

  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (!options.isEngineOrigin(url.origin)) return upstreamFetch(input, init)
    // 与 fetch 同一约定:已取消的请求直接以取消原因拒绝,不碰引擎。
    request.signal.throwIfAborted()
    const matched = matchRoute(request.method, url.pathname)
    if (!matched) return unsupported(request.method, url.pathname)
    const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.clone().text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      body = text
    }
    const context: RouteContext = {
      params: matched.params,
      query: url.searchParams,
      body,
      directory: directoryOf(url, request),
      request,
      signal: request.signal,
      api: clientFor(url.origin, request.signal),
      origin: url.origin,
      permissions: repliesFor(url.origin),
      upstream: (path, next) => upstreamFetch(new URL(path, url.origin), next),
      passthrough: () => upstreamFetch(request),
    }
    try {
      return await matched.route.handle(context)
    } catch (error) {
      // 取消:与 fetch 一样以取消原因拒绝(2.x 客户端把它包成 Transport 错误,调用方认的是 AbortError / TimeoutError)。
      request.signal.throwIfAborted()
      return errorResponse(error)
    }
  }
}

// ── renderer 全局的那一个 engineFetch ─────────────────────────────────────────────────────────────
// 冻结 app 经 `Platform.fetch` 建全部引擎客户端(server-sdk.tsx),renderer 自己的三个客户端(侧栏、定制中心、云运行)
// 传同一个函数。引擎源地址在连接建立时登记(本机 sidecar、就绪的 WSL);别的源(高亮主题等)不经路由表。
const engineOrigins = new Set<string>()

export function registerEngineOrigin(url: string) {
  engineOrigins.add(new URL(url).origin)
}

export const engineFetch: EngineFetch = createEngineFetch({ isEngineOrigin: (origin) => engineOrigins.has(origin) })
