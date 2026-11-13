// `#1697`(I-04,设计 §4.6):冻结界面认的错误体 —— 约定的错误信封。引擎错误怎么认归翻译器(`Translator.toContractError`),
// 这里只定形状与两个由约定侧自己出的 501。

export const UNSUPPORTED_ERROR_NAME = "CodePuppyEngineAdapterUnsupported"

export type ContractError =
  | { status: 400; body: { name: "BadRequest" | "UnknownError"; data: { message: string } } }
  | { status: 404; body: { name: "NotFoundError"; data: { message: string } } }
  | { status: 404; body: { _tag: "PermissionNotFoundError"; requestID: string; message: string } }
  | { status: 409; body: { _tag: "ConflictError"; resource: string; message: string } }
  | { status: 500; body: { name: string; data: { message: string } } } // name 保留引擎声明的错误名
  | { status: 501; body: { name: typeof UNSUPPORTED_ERROR_NAME; data: { method: string; path: string } } }

export const errorResponse = (error: ContractError) => Response.json(error.body, { status: error.status })

/** 审批回复的命令不成形(决定不是 once / always / reject,或缺 decisionID)。 */
export const invalidDecision = (): ContractError => ({ status: 400, body: { name: "BadRequest", data: { message: "invalid permission decision" } } })

/** 回执账本没出收据时的信封,与 0.1.26 同形:过期 404、陈旧 409(审批卡的 permissionDecisionSubmitError 据 409 判为冲突)。 */
export function decisionError(outcome: "expired" | "conflict", requestID: string): ContractError {
  return outcome === "expired"
    ? { status: 404, body: { _tag: "PermissionNotFoundError", requestID, message: `Permission request not found: ${requestID}` } }
    : { status: 409, body: { _tag: "ConflictError", resource: requestID, message: `Permission request conflicts with the immutable request: ${requestID}` } }
}

const notServed = (method: string, path: string): ContractError => ({
  status: 501,
  body: { name: UNSUPPORTED_ERROR_NAME, data: { method, path } },
})

/** 声明不支持、或三张表都不命中:501,并记方法与路径(对未知默认拒,不猜一个最像的引擎端点)。 */
export function unsupported(method: string, path: string) {
  console.error(`[engine-adapter] unsupported engine request: ${method} ${path}`)
  return errorResponse(notServed(method, path))
}

/** 探活回退(UC-19):同一个 501 信封,不记日志 —— 它每 10 秒就会被发一次,失败本身就是约定。 */
export const probeFallback = (method: string, path: string) => errorResponse(notServed(method, path))
