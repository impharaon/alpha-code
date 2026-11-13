// `#1668`(L6):Code Puppy 的引擎适配器 —— 冻结界面(0.1.26 的 v1 数据路径)到 OpenCode 2 引擎的**唯一咽喉**。
//
// 冻结的 v1 SDK 与 1.17.13 客户端照常把调用序列化成 HTTP 请求,只是它们的 `fetch` 换成这里的 `engineFetch`。
// `#1697`(I-04,设计 docs/specs/upgrade-ui-contract/design.md §4.2):这里是代际无关的管道 —— 发往引擎源地址的请求只按
// Code Puppy 自有的约定路由目录(contract/routes.ts)匹配:三条固定答复由约定侧直答;探活回退回 501 信封、不记日志;
// 声明不支持与目录外的请求一律 501 + console.error(对未知默认拒,不猜一个最像的 2.x 端点);其余交当前代翻译器
// (opencode2/)。别的源原样交给 `globalThis.fetch`。
//
// 适配器不做任何决定(审批、档位、目录闸都在引擎与 ext),不持有口令(I8:`Authorization` 由 main 的
// `onBeforeSendHeaders` 对引擎源补上)。
import { errorResponse, probeFallback, unsupported } from "./contract/errors"
import { FIXED, isFixed, matchProbeFallback, matchServed, type TranslatedKey } from "./contract/routes"
import type { RouteContext } from "./contract/translator"
import { createOpencode2Translator } from "./opencode2"

export { UNSUPPORTED_ERROR_NAME } from "./contract/errors"

export type EngineFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

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

export function createEngineFetch(options: {
  /** 这个源是不是 Code Puppy 连着的引擎(本机 sidecar / WSL)。 */
  isEngineOrigin: (origin: string) => boolean
  /** 真正出网的 fetch;测试注入,生产是 webview 的 fetch。 */
  fetch?: typeof globalThis.fetch
}): EngineFetch {
  const upstreamFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  // 静态选用当前那一代翻译器(R5)。
  const translator = createOpencode2Translator()

  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (!options.isEngineOrigin(url.origin)) return upstreamFetch(input, init)
    // 与 fetch 同一约定:已取消的请求直接以取消原因拒绝,不碰引擎。
    request.signal.throwIfAborted()
    const matched = matchServed(request.method, url.pathname)
    if (!matched) {
      if (matchProbeFallback(request.method, url.pathname)) return probeFallback(request.method, url.pathname)
      return unsupported(request.method, url.pathname)
    }
    if (isFixed(matched.key)) return Response.json(FIXED[matched.key]())
    const key = matched.key
    const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.clone().text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      body = text
    }
    const context: RouteContext<TranslatedKey> = {
      params: matched.params,
      query: url.searchParams,
      body,
      directory: directoryOf(url, request),
      request,
      signal: request.signal,
    }
    try {
      const engine = translator.connect({ origin: url.origin, signal: request.signal, fetch: upstreamFetch })
      return await translator.routes[key](context, engine)
    } catch (error) {
      // 取消:与 fetch 一样以取消原因拒绝(2.x 客户端把它包成 Transport 错误,调用方认的是 AbortError / TimeoutError)。
      request.signal.throwIfAborted()
      return errorResponse(translator.toContractError(error))
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
