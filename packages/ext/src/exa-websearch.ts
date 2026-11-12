// `#1449` / `#1445`(ADR-035 E7「搜网失败要诚实」)在 OpenCode 2 上(`#1662` parity 第 1、2 项,编排器 2026-11-12 裁决选项 2):
// Code Puppy 自己的 exa 供应商,经 ext 的 `websearch.transform` 以同一个 id 装进去,顶替上游的(`packages/core/src/plugin/websearch/exa.ts`)。
// 只改「Exa 的响应怎么交给模型」:哪个供应商在跑、kill-switch / 代付 / 无 key 的判决都不在这里(cloud-websearch-kill.ts 与 plugin.ts 的
// 默认选择原样负责)。
//
// 为什么要顶替:上游 exa.ts 的输出 schema 没有 `isError`、只取第一段文本按 `URL:` 块解析 ⇒ Exa 的 in-band 错误(`isError: true`)、
// 200 + 非 `isError` 的额度提示(`#1445` D 臂)、真零命中,到模型面都是同一句「No search results found…」(`#1662` parity 实测)。
// 0.1.26 的做法(`origin/alpha:packages/opencode/src/tool/mcp-websearch.ts`):失败以具名的话到模型面,没有契约信号的提示原文到模型面。
//   · `isError: true` / JSON-RPC `error` ⇒ 失败「Web search failed: the provider reported an error. Cause: …」;
//   · 非 2xx ⇒ 失败,按状态归类(429 ⇒「unexpected HTTP status (HTTP 429)」+ 上游原文),措辞同 0.1.26;
//   · 200、解析不出结果、但有文本(D 臂的额度提示;vendor 自己的零命中散文)⇒ 那段文本**原样**作为这次调用的失败消息交给模型:
//     2.x 的结果结构(url / title / content)没有放原文的位置,当成一条「结果」就是把提示伪装成搜索结果(`#1449` AC1 禁的事);
//     失败消息逐字是供应商的话,模型读到的仍是 Exa 自己说的;
//   · 200、没有任何文本(`content: []`)⇒ 零条结果,工具照旧给「No search results found…」。
// 失败消息怎么到模型面:供应商抛 `CodePuppyWebSearchFailure`;2.x 的 websearch 工具把它包成通用的「Unable to search the web for …」
// (`packages/core/src/tool/plugin/websearch.ts` 的 mapError,只认 effect 的 HttpClientError),ext 的 `execute.after` 在失败分支里
// 认出它、把消息换回这里的话(plugin.ts)。判决里没有任何文案匹配(0.1.26 `#1445` AC3 的纪律)。
//
// 传输照上游:POST JSON-RPC `tools/call web_search_exa`(numResults 8),接受 JSON 或 SSE,响应体读到 256 KiB 为止,25 秒超时;
// 用户在引擎里配了 Exa key(integration 连接)时照上游拼进 `exaApiKey`。

/** 上游 `WebSearchExa.endpoint`(packages/core/src/plugin/websearch/exa.ts);两边相等由测试钉住。 */
export const EXA_ENDPOINT = "https://mcp.exa.ai/mcp"
const MAX_RESPONSE_BYTES = 256 * 1024
const TIMEOUT_MS = 25_000
const MAX_DETAIL = 1_000

type Kind = "unauthorized" | "forbidden" | "bad_request" | "payment_required" | "upstream" | "unexpected_status" | "timeout" | "transport" | "provider_error" | "invalid_response" | "notice"

const LABEL: Record<Exclude<Kind, "notice">, string> = {
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  bad_request: "bad request",
  payment_required: "payment required (out of budget)",
  upstream: "upstream failure",
  unexpected_status: "unexpected HTTP status",
  timeout: "request timed out",
  transport: "transport failure",
  provider_error: "the provider reported an error",
  invalid_response: "invalid response",
}

/** 这次搜索的结局(不是结果)。`message` 就是模型要看到的那句话。 */
export class CodePuppyWebSearchFailure extends Error {
  readonly _tag = "CodePuppyWebSearchFailure"
  constructor(
    readonly kind: Kind,
    readonly detail: string,
    readonly status?: number,
  ) {
    super(
      kind === "notice"
        ? detail
        : `Web search failed: ${LABEL[kind]}${status === undefined ? "" : ` (HTTP ${status})`}. Cause: ${detailOf(detail)}`,
    )
  }
}

export const isCodePuppyWebSearchFailure = (value: unknown): value is CodePuppyWebSearchFailure =>
  !!value && typeof value === "object" && (value as { _tag?: unknown })._tag === "CodePuppyWebSearchFailure"

function detailOf(text: string) {
  const detail = text.trim().replaceAll(/\s+/g, " ")
  return detail ? detail.slice(0, MAX_DETAIL) : "the provider returned an empty body"
}

function kindOf(status: number): Kind {
  if (status === 401) return "unauthorized"
  if (status === 403) return "forbidden"
  if (status === 400) return "bad_request"
  if (status === 402) return "payment_required"
  if (status === 502) return "upstream"
  return "unexpected_status"
}

export type ExaResult = { url: string; title?: string; content?: string; time: { published?: number } }

/** 上游 exa.ts 的块解析(`\n\n---\n\n` 分块,`URL:` / `Title:` / `Published:` / `Highlights:|Text:`),原样搬过来。 */
export function parseExaResults(text: string): ExaResult[] {
  return text.split(/\n\n---\n\n/).flatMap((block) => {
    const url = block.match(/^URL:\s*(.+)$/m)?.[1]?.trim()
    if (!url) return []
    const title = block.match(/^Title:\s*(.+)$/m)?.[1]?.trim()
    const publishedText = block.match(/^Published:\s*(.+)$/m)?.[1]?.trim()
    const published = publishedText && publishedText !== "N/A" ? Date.parse(publishedText) : undefined
    const content = block.match(/^(?:Highlights|Text):\s*\n?([\s\S]*)$/m)?.[1]?.trim()
    return [
      {
        url,
        ...(title && title !== "N/A" ? { title } : {}),
        ...(content ? { content } : {}),
        time: { ...(published !== undefined && Number.isFinite(published) ? { published } : {}) },
      },
    ]
  })
}

type Envelope = { result?: { content?: Array<{ type?: string; text?: unknown }>; isError?: unknown }; error?: { message?: unknown } }

/** 直接 JSON 或 SSE 帧(`data: {...}`),取第一份 JSON-RPC 应答(同上游 `WebSearchMcp.parseResponse`)。 */
function envelopeOf(body: string): Envelope | undefined {
  const parse = (payload: string) => {
    const trimmed = payload.trim()
    if (!trimmed.startsWith("{")) return undefined
    try {
      const value = JSON.parse(trimmed) as Envelope
      return value && typeof value === "object" && ("result" in value || "error" in value) ? value : undefined
    } catch {
      return undefined
    }
  }
  const direct = parse(body)
  if (direct) return direct
  for (const line of body.split("\n")) if (line.startsWith("data: ")) {
    const frame = parse(line.slice(6))
    if (frame) return frame
  }
  return undefined
}

async function boundedText(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new CodePuppyWebSearchFailure("invalid_response", `web_search_exa response exceeded ${MAX_RESPONSE_BYTES} bytes`)
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** 一次 Exa 搜索:结果,或者一个具名的结局。 */
export async function searchExa(input: { query: string; key?: string; signal?: AbortSignal; fetch?: typeof globalThis.fetch }): Promise<ExaResult[]> {
  const url = new URL(EXA_ENDPOINT)
  if (input.key) url.searchParams.set("exaApiKey", input.key)
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS)
  let response: Response
  try {
    response = await (input.fetch ?? globalThis.fetch)(url, {
      method: "POST",
      signal,
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "web_search_exa", arguments: { query: input.query, numResults: 8 } } }),
    })
  } catch (cause) {
    if (input.signal?.aborted) throw cause
    const timedOut = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")
    throw new CodePuppyWebSearchFailure(timedOut ? "timeout" : "transport", timedOut ? "web_search_exa request timed out" : cause instanceof Error ? cause.message : String(cause))
  }
  const body = await boundedText(response)
  if (!response.ok) {
    const envelope = envelopeOf(body)
    const message = typeof envelope?.error?.message === "string" ? envelope.error.message : body
    throw new CodePuppyWebSearchFailure(kindOf(response.status), message, response.status)
  }
  const envelope = envelopeOf(body)
  if (!envelope) throw new CodePuppyWebSearchFailure("invalid_response", body)
  if (envelope.error) throw new CodePuppyWebSearchFailure("provider_error", typeof envelope.error.message === "string" ? envelope.error.message : JSON.stringify(envelope.error))
  const text = (envelope.result?.content ?? [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n\n")
  if (envelope.result?.isError === true) throw new CodePuppyWebSearchFailure("provider_error", text)
  const results = parseExaResults(text)
  if (results.length > 0) return results
  // 有文本却解析不出结果(额度提示、vendor 自己的零命中散文):原文就是模型该读到的话
  if (text.trim()) throw new CodePuppyWebSearchFailure("notice", text.trim())
  return []
}
