// `#1697`(I-04,设计 §4.8、R5):当前代引擎(OpenCode 2)的翻译器 —— 管道唯一选用的那一个。换代时在同一变更里新增下一代目录、
// 切换管道的选用、删除这个目录。
import { OpenCode } from "@opencode/client/promise"
import type { ContractError } from "../contract/errors"
import type { Translator } from "../contract/translator"
import { approvals } from "./approvals"
import { ROUTES, type Opencode2Engine } from "./routes"

/** 2.x 调用失败 ⇒ 约定错误信封。2.x 声明过的错误(带 `_tag`)保留名字与消息;状态码按 404 / 其余 500 分。 */
export function toContractError(error: unknown): ContractError {
  const name = error instanceof Error ? error.name : "UnknownError"
  const message = error instanceof Error ? error.message : String(error)
  return /NotFound/.test(name)
    ? { status: 404, body: { name: "NotFoundError", data: { message } } }
    : { status: 500, body: { name, data: { message } } }
}

/** 管道每个 createEngineFetch 建一个实例(R5 的静态选用)。 */
export function createOpencode2Translator(): Translator<Opencode2Engine> {
  return {
    // 每个请求一个 2.x 客户端:它发出的每个调用都带上这次请求的取消信号(调用自己另带的信号照旧生效)。冻结界面靠它给引擎
    // 调用设上限 —— 侧栏自探的 `AbortSignal.timeout(2_000)`(use-projects.ts)、组件卸载时中止的读取。
    connect: ({ origin, signal, fetch }) => ({
      api: OpenCode.make({
        baseUrl: origin,
        fetch: ((input, init) =>
          fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal })) as typeof globalThis.fetch,
      }),
      origin,
      upstream: (path, next) => fetch(new URL(path, origin), next),
      fetch,
    }),
    routes: ROUTES,
    toContractError,
    approvals,
  }
}
