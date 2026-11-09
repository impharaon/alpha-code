// `#1667`(#1662 L5,清点表 S6 / S9):main 侧打引擎 HTTP 用上游自己的 OpenCode 2 客户端(`@opencode/client`),不再用 v1 的
// `@opencode-ai/sdk/v2/client`(那个名字在 worktree 里会向上解析到主检出里的 v1 包,假绿)。口令只在 main(I8),这里补 Basic 头。
import { OpenCode } from "@opencode/client"
import { engineAuthorization, type EngineConnection } from "./engine-authorization"

export function engineClient(connection: EngineConnection, fetchImpl: typeof fetch = fetch) {
  return OpenCode.make({
    baseUrl: connection.url,
    fetch: fetchImpl,
    headers: connection.password ? { Authorization: engineAuthorization(connection.password) } : undefined,
  })
}

export type EngineClient = ReturnType<typeof engineClient>
