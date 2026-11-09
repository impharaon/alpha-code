// `#1667`(#1662 L5,接口文档 I1 / I8):引擎口令只在 main 与 sidecar 里;要它的地方由这两个进程补上 Basic 头。
//
//   · I1:sidecar 把 `start()` 的 dispatch app 包一层,给每个进程内请求补口令,再经 in-process-engine.ts 交给 ext ——
//     ext 不再自己拼口令,口令也就不必放进引擎进程的环境变量(那会被引擎派生的每个 shell / MCP 子进程继承)。
//   · I8:main 在 `onBeforeSendHeaders` 里给 renderer 发往引擎源的请求补同一个头(windows.ts),renderer 只拿 `{ url }`。
// 用户名恒为 `opencode`(`packages/server/src/process.ts` 的 `dispatch`)。
import type { EngineFetch } from "./in-process-engine"

export function engineAuthorization(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
}

/** 包一层:每个请求都带上口令(覆盖调用方带来的任何 `authorization`,ext 不持有、也不该猜口令)。 */
export function withEngineAuthorization(dispatch: (request: Request) => Promise<Response>, password: string): EngineFetch {
  const authorization = engineAuthorization(password)
  return (request) => {
    const headers = new Headers(request.headers)
    headers.set("authorization", authorization)
    return dispatch(new Request(request, { headers }))
  }
}
