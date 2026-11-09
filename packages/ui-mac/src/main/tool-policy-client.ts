// REQ-131 / #1130 —— main 侧对引擎 tool policy 面的客户端(Settings「工具」节的唯一数据通道)。
//
// 为什么走 main 而不是 renderer 直连引擎:与 settings-ipc / automation-llm 同一形态 —— sidecar 的
// 地址与 Basic 凭据住在 main 的 serverReady Deferred 里,renderer 只拿到闭集结果码,不拿引擎原文。
//
// `#1667`(#1662 接口文档 I5):v1 时代打的是 alpha 加在接管文件里的四条 `/api/permission/tool-policy/*` 路由;2.x 里
// 工具策略住在 ext(L4 的 `registerPolicy`),经插件 RPC 暴露:`POST /api/rpc/codepuppy.tool-policy/<method>`
// (`packages/protocol/src/groups/rpc.ts`),请求体 `{ input }`、成功体 `{ output }`。RPC 的错误(400 `RpcError { type }`、
// 500 `RpcInternalError`)按冻结的映射表翻回**现有**失败码,renderer 看到的 `ToolPolicyApi` 与失败码都不变。
// 返回的清单在 main 侧再 decode 一次 wire 契约(`parseToolPolicyInventory`)—— 与 ext 侧 decode 同一份 schema。
import { parseToolPolicyInventory } from "@opencode/schema/codepuppy-tool-inventory"
import { TOOL_POLICY_RPC } from "@opencode/schema/codepuppy-tool-policy"
import type {
  ToolPolicyApi,
  ToolPolicyInventoryResult,
  ToolPolicyResetResult,
  ToolPolicyWriteResult,
} from "../shared/tool-policy-wire"

export type ToolPolicyServerInfo = {
  url: string
  username: string | null
  password: string | null
}

export type ToolPolicyClientDeps = {
  awaitServer: () => Promise<ToolPolicyServerInfo>
  fetch?: typeof fetch
  /** 单次请求上限;inventory 要枚举 live registry + MCP,给足但不无限。 */
  timeoutMs?: number
}

type Method = (typeof TOOL_POLICY_RPC.methods)[keyof typeof TOOL_POLICY_RPC.methods]

export const toolPolicyRpcRoute = (method: Method) => `/api/rpc/${TOOL_POLICY_RPC.id}/${method}`

const DEFAULT_TIMEOUT_MS = 15_000

function authorization(server: ToolPolicyServerInfo): Record<string, string> {
  if (!server.username && !server.password) return {}
  const token = Buffer.from(`${server.username ?? ""}:${server.password ?? ""}`).toString("base64")
  return { Authorization: `Basic ${token}` }
}

/** 引擎回的非 200 归成哪一类(接口文档 I5 的表)。 */
type RpcFailure = "starting" | "unwired" | "quarantined" | "invalid" | "write-failed" | "other"

async function rpcFailure(response: Response): Promise<RpcFailure> {
  if (response.status === 503) return "starting"
  if (response.status === 500) return "write-failed"
  if (response.status !== 400) return "other"
  let type: unknown
  try {
    type = ((await response.json()) as { type?: unknown })?.type
  } catch {
    return "other"
  }
  if (type === "rpc.unavailable") return "unwired"
  if (type === TOOL_POLICY_RPC.errors.quarantined) return "quarantined"
  if (type === TOOL_POLICY_RPC.errors.invalidRecord || type === "rpc.invalid_input") return "invalid"
  if (type === TOOL_POLICY_RPC.errors.writeFailed) return "write-failed"
  return "other"
}

function readFailure(failure: RpcFailure): ToolPolicyInventoryResult {
  if (failure === "starting") return { ok: false, code: "engine-unavailable" }
  if (failure === "unwired") return { ok: false, code: "not-wired" }
  return { ok: false, code: "request-failed" }
}

function writeFailure(failure: RpcFailure): ToolPolicyWriteResult {
  if (failure === "starting") return { ok: false, code: "engine-unavailable" }
  if (failure === "unwired") return { ok: false, code: "not-wired" }
  if (failure === "quarantined") return { ok: false, code: "quarantined" }
  if (failure === "invalid") return { ok: false, code: "invalid-record" }
  if (failure === "write-failed") return { ok: false, code: "write-failed" }
  return { ok: false, code: "request-failed" }
}

function resetFailure(failure: RpcFailure): ToolPolicyResetResult {
  if (failure === "starting") return { ok: false, code: "engine-unavailable" }
  if (failure === "unwired") return { ok: false, code: "not-wired" }
  if (failure === "invalid") return { ok: false, code: "request-failed" }
  return { ok: false, code: "write-failed" }
}

export function createToolPolicyClient(deps: ToolPolicyClientDeps): ToolPolicyApi {
  const doFetch = deps.fetch ?? fetch
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

  type Sent = { ok: true; response: Response } | { ok: false; code: "engine-unavailable" | "request-failed" }

  async function call(method: Method, directory: string, input?: unknown): Promise<Sent> {
    let server: ToolPolicyServerInfo
    try {
      server = await deps.awaitServer()
    } catch {
      return { ok: false, code: "engine-unavailable" }
    }
    if (!server?.url) return { ok: false, code: "engine-unavailable" }
    try {
      const response = await doFetch(new URL(toolPolicyRpcRoute(method), server.url), {
        method: "POST",
        headers: {
          ...authorization(server),
          // 引擎侧 location 中间件对这个头做 decodeURIComponent(packages/server/src/location.ts);
          // 非 ASCII 路径不 encode 就会在 Headers 构造时被拒。RPC 路由挂着同一个中间件(api.ts)。
          "x-opencode-directory": encodeURIComponent(directory),
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(input === undefined ? {} : { input }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      return { ok: true, response }
    } catch {
      return { ok: false, code: "request-failed" }
    }
  }

  function requireDirectory(directory: unknown): directory is string {
    return typeof directory === "string" && directory.trim().length > 0
  }

  return {
    async inventory(input) {
      if (!requireDirectory(input?.directory)) return { ok: false, code: "request-failed" }
      const sent = await call(TOOL_POLICY_RPC.methods.inventory, input.directory)
      if (!sent.ok) return sent
      if (sent.response.status !== 200) return readFailure(await rpcFailure(sent.response))
      try {
        const body = (await sent.response.json()) as { output?: unknown }
        return { ok: true, inventory: parseToolPolicyInventory(body?.output) }
      } catch {
        return { ok: false, code: "invalid-shape" }
      }
    },
    async setRecord(input) {
      if (!requireDirectory(input?.directory)) return { ok: false, code: "request-failed" }
      const sent = await call(TOOL_POLICY_RPC.methods.setRecord, input.directory, input.record)
      if (!sent.ok) return sent
      return sent.response.status === 200 ? { ok: true } : writeFailure(await rpcFailure(sent.response))
    },
    async removeRecord(input) {
      if (!requireDirectory(input?.directory)) return { ok: false, code: "request-failed" }
      const sent = await call(TOOL_POLICY_RPC.methods.removeRecord, input.directory, { selector: input.selector })
      if (!sent.ok) return sent
      return sent.response.status === 200 ? { ok: true } : writeFailure(await rpcFailure(sent.response))
    },
    async reset(input): Promise<ToolPolicyResetResult> {
      if (!requireDirectory(input?.directory)) return { ok: false, code: "request-failed" }
      const sent = await call(TOOL_POLICY_RPC.methods.reset, input.directory)
      if (!sent.ok) return sent
      if (sent.response.status !== 200) return resetFailure(await rpcFailure(sent.response))
      try {
        const body = (await sent.response.json()) as { output?: { backup?: unknown } }
        const backup = body?.output?.backup
        return typeof backup === "string" ? { ok: true, backup } : { ok: true }
      } catch {
        return { ok: false, code: "invalid-shape" }
      }
    },
  }
}
