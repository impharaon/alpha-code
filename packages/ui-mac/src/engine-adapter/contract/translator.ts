// `#1697`(I-04,设计 §4.8):每代引擎一个翻译器,管道只认这个接口。换代时在同一变更里新增下一代目录、切换管道的选用、
// 删除旧目录(R5);管道不做运行时选择。
import type { ContractError } from "./errors"
import type { ApprovalEngine, ReceiptLedger } from "./receipts"
import type { BodyOf, ResponseOf, TranslatedKey } from "./routes"

export type RouteContext<K extends TranslatedKey> = {
  readonly params: Readonly<Record<string, string>>
  readonly query: URLSearchParams
  /** 非 GET/HEAD 的请求体按 JSON 解析,解析失败保留原文(设计 §4.4)。 */
  readonly body: BodyOf<K> | undefined
  /** UC-02:查询串 `directory`、`location[directory]` 或头 `x-opencode-directory`(URI 解码),按此优先序。 */
  readonly directory?: string
  readonly request: Request
  /** UC-03:为这个约定请求发出的每个引擎调用都带它。 */
  readonly signal: AbortSignal
  /** 这个引擎源的回执账本(管道持有,窗口寿命)。 */
  readonly receipts: ReceiptLedger
  /** JSON 路由经这里出:body 的类型就是该路由的约定响应类型。 */
  readonly reply: (body: ResponseOf<K>, init?: { status?: 200 | 204; headers?: Record<string, string> }) => Response
}

export type RouteHandler<K extends TranslatedKey, Engine> = (context: RouteContext<K>, engine: Engine) => Promise<Response>

export interface Translator<Engine> {
  /** 一个约定请求一个引擎客户端;为这次请求发出的每个引擎调用都带 signal。 */
  connect(input: { origin: string; signal: AbortSignal; fetch: typeof globalThis.fetch }): Engine
  /** 恰好覆盖 TranslatedKey:少一条、多一条都是类型错误(设计 §4.10 b)。 */
  readonly routes: { readonly [K in TranslatedKey]: RouteHandler<K, Engine> }
  /** 引擎调用失败 → 约定错误信封(取消不经这里)。 */
  toContractError(error: unknown): ContractError
  /** 回执账本用的审批端口。 */
  approvals(engine: Engine): ApprovalEngine
}
