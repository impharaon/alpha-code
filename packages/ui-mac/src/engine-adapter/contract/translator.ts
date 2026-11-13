// `#1697`(I-04,设计 §4.8):每代引擎一个翻译器,管道只认这个接口。换代时在同一变更里新增下一代目录、切换管道的选用、
// 删除旧目录(R5);管道不做运行时选择。
// 回执账本(`receipts`、`approvals`)随 M3 进来,`reply` 与按路由定型的 `body` 随 M2b 进来(计划 docs/specs/upgrade-ui-contract/plan.md)。
import type { ContractError } from "./errors"
import type { TranslatedKey } from "./routes"

// K 在 M2b 起决定 `body` 与 `reply` 的类型。
export type RouteContext<K extends TranslatedKey> = {
  readonly params: Readonly<Record<string, string>>
  readonly query: URLSearchParams
  /** 非 GET/HEAD 的请求体按 JSON 解析,解析失败保留原文(设计 §4.4)。 */
  readonly body: unknown
  /** UC-02:查询串 `directory`、`location[directory]` 或头 `x-opencode-directory`(URI 解码),按此优先序。 */
  readonly directory?: string
  readonly request: Request
  /** UC-03:为这个约定请求发出的每个引擎调用都带它。 */
  readonly signal: AbortSignal
}

export type RouteHandler<K extends TranslatedKey, Engine> = (context: RouteContext<K>, engine: Engine) => Promise<Response>

export interface Translator<Engine> {
  /** 一个约定请求一个引擎客户端;为这次请求发出的每个引擎调用都带 signal。 */
  connect(input: { origin: string; signal: AbortSignal; fetch: typeof globalThis.fetch }): Engine
  /** 恰好覆盖 TranslatedKey:少一条、多一条都是类型错误(设计 §4.10 b)。 */
  readonly routes: { readonly [K in TranslatedKey]: RouteHandler<K, Engine> }
  /** 引擎调用失败 → 约定错误信封(取消不经这里)。 */
  toContractError(error: unknown): ContractError
}
