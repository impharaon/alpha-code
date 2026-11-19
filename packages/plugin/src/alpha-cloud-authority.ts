// north-star:codepuppy-owned — Code Puppy 自有文件,住在上游包目录里(ADR-043 因子②;文件名为何未改见 scripts/old-name-exceptions.tsv)。
/**
 * Code Puppy Cloud MCP authority is proven only by the definition that the desktop
 * injection handshake placed in this process. Keep this verifier pure so the
 * extension sovereignty gate and the engine display snapshot use one fact.
 */

import { routePlatformUrl, tryCodePuppyBootstrap, type CodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"

/**
 * `#1698`(DESIGN-upgrade-bootstrap-config §4.3,G2):治理云 MCP 的名字与定义来自 Code Puppy 的启动文档(`cloudMcp`),不再来自
 * 进程内环境。各函数保留一个参数作测试接缝,缺省取本进程已发布的文档;没有文档的宿主(仓内 CLI、core 单测)= 没有治理云 MCP。
 */
export type GovernedCloudMcp = NonNullable<CodePuppyBootstrap["cloudMcp"]>
const published = () => tryCodePuppyBootstrap()?.cloudMcp

export type McpOwnership = {
  governed: string[]
  foreign: string[]
}

export const UNVERIFIED_MCP_OWNERSHIP: McpOwnership = { governed: [], foreign: [] }

type McpHost = { mcp?: Record<string, unknown> }

export function governedCloudEndpoint(cloudMcp: GovernedCloudMcp | undefined): { name: string; url: string } | undefined {
  return cloudMcp ? { name: cloudMcp.name, url: cloudMcp.definition.url } : undefined
}

export function isGovernedMcpEntry(name: string, entry: unknown, cloudMcp: GovernedCloudMcp | undefined = published()): boolean {
  const endpoint = governedCloudEndpoint(cloudMcp)
  if (!endpoint || name !== endpoint.name) return false
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false
  const { type, url } = entry as { type?: unknown; url?: unknown }
  return type === "remote" && url === endpoint.url
}

/**
 * alpha 注入面产出的 `{file:<abs path>}` 引用(ui-mac `secretFileRef`)在 alpha 代码里的**唯一**文法;第 1 组是路径。
 * 引擎自己的配置加载器(上游 `config/variable.ts`)另有一份,那是上游的。不带 `g`:`test` / `exec` 无 lastIndex 状态。
 */
export const FILE_REF = /\{file:([^}]+)\}/

/**
 * 把值里每个 `{file:}` 引用换成文件内容(trim)—— 引擎 `ConfigVariable.substitute` 在配置文本阶段做同一件事,
 * 而 ext 的 config 钩子拿到的是已解析对象、钩子阶段新装进去的定义不会再被替换,所以 ext 自己解析(读不到就抛,
 * 由调用方 fail-closed)。递归处理数组与对象。
 */
export function resolveFileRefs(value: unknown, readFile: (path: string) => string): unknown {
  if (typeof value === "string")
    return value.replace(new RegExp(FILE_REF, "g"), (_, path: string) => readFile(path).trim())
  if (Array.isArray(value)) return value.map((item) => resolveFileRefs(item, readFile))
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveFileRefs(item, readFile)]))
  return value
}

/**
 * REQ-236 §2.1-5(`#1562`):治理云 MCP 条目每次请求的凭据,从启动文档 `cloudMcp.definition` 里
 * `headers.Authorization` 的 `{file:}` 引用**现读**(权限方案冻结接口),不读已装载条目里的字面量 ——
 * 那个字面量是引擎配置加载器(生产分支)或 ext `installCloudMcp`(kill-switch 分支)在装载时替换进去的,
 * 续期之后它就是旧令牌。返回给 MCP SDK transport 的 `fetch` 选项:StreamableHTTP 与 SSE 的 POST、GET/SSE
 * 与重连、404 会话恢复全都经过它。读不到(DEF 缺席 / 无引用 / 文件缺席或为空)⇒ 本地答一个 401,请求不出网,
 * SDK 照它自己的路径报认证错误(无 authProvider 时为 `StreamableHTTPError(401)` / `SseError(401)`,
 * 引擎归为 `failed` + code `auth`,不重连)。IO 由调用方注入,本模块不碰文件系统。
 */
export function governedCredentialFetch(
  cloudMcp: GovernedCloudMcp | undefined,
  readFile: (path: string) => Promise<string>,
  fetchImpl: (url: string | URL, init?: RequestInit) => Promise<Response>,
): (url: string | URL, init?: RequestInit) => Promise<Response> {
  const template = cloudMcp?.definition.headers.Authorization
  return async (url, init) => {
    const authorization = template ? await resolveAuthorization(template, readFile) : undefined
    if (!authorization)
      return new Response("Code Puppy cloud connector credential could not be read; the request was not sent.", {
        status: 401,
        statusText: "Unauthorized",
      })
    const headers = new Headers(init?.headers)
    headers.set("authorization", authorization)
    const destination = routePlatformUrl(String(url), cloudMcp?.definition.url, cloudMcp?.directUrl, tryCodePuppyBootstrap()?.platform.routeRef)
    return fetchImpl(destination, { ...init, headers })
  }
}

async function resolveAuthorization(template: string, readFile: (path: string) => Promise<string>) {
  const match = FILE_REF.exec(template)
  if (!match) return undefined
  const value = await readFile(match[1]!).then(
    (content) => content.trim(),
    () => "",
  )
  if (!value) return undefined
  return template.replace(match[0], () => value)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error("MCP evidence contains a non-JSON value")
  return encoded
}

/**
 * #1576:the engine resolves `{file:}` references while it parses config text (production branch) and
 * `installCloudMcp` resolves them itself (kill-switch branch), so the loaded entry carries the token
 * literal where the definition carries the reference. For a header whose definition value is a file
 * reference, only require that the entry has the same header as a string; the value is a credential,
 * not provenance. Every other field (and every header key set) still has to match exactly.
 */
function withDefinitionFileRefs(entry: unknown, definition: unknown): unknown {
  const defHeaders = (definition as { headers?: unknown } | null)?.headers
  const entryHeaders = (entry as { headers?: unknown } | null)?.headers
  if (!defHeaders || typeof defHeaders !== "object" || !entryHeaders || typeof entryHeaders !== "object") return entry
  const headers: Record<string, unknown> = { ...(entryHeaders as Record<string, unknown>) }
  for (const [key, value] of Object.entries(defHeaders as Record<string, unknown>))
    if (typeof value === "string" && FILE_REF.test(value) && typeof headers[key] === "string") headers[key] = value
  return { ...(entry as Record<string, unknown>), headers }
}

/**
 * #1662:OpenCode 2's config loader sets every configured server's `timeout` to the merged global defaults
 * (`core/src/config/plugin/mcp.ts`), which is `{}` when no document sets any. An empty `timeout` changes nothing about
 * the connection, so it is dropped when the definition has none; any non-empty timeout still has to match.
 */
function withoutEngineDefaults(entry: unknown, definition: unknown): unknown {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry
  if ((definition as { timeout?: unknown } | null)?.timeout !== undefined) return entry
  const { timeout, ...rest } = entry as Record<string, unknown>
  const empty = !!timeout && typeof timeout === "object" && !Array.isArray(timeout) && Object.keys(timeout).length === 0
  return empty ? rest : entry
}

/**
 * Display authority is stricter than the legacy web-search sovereignty owner
 * check: the complete invocation config must equal the verified definition,
 * not merely share its endpoint. The evidence is the definition itself (file
 * references, never token values), so token rotation keeps the digest stable.
 */
export function governedMcpEvidence(name: string, entry: unknown, cloudMcp: GovernedCloudMcp | undefined = published()): string | undefined {
  if (!cloudMcp || !isGovernedMcpEntry(name, entry, cloudMcp)) return undefined
  try {
    const definition = cloudMcp.definition
    if (canonicalJson(withoutEngineDefaults(withDefinitionFileRefs(entry, definition), definition)) !== canonicalJson(definition)) return undefined
    return canonicalJson({ kind: "codepuppy-cloud-mcp", name, definition })
  } catch {
    return undefined
  }
}

export function computeMcpOwnership(cfg: unknown, cloudMcp: GovernedCloudMcp | undefined = published()): McpOwnership {
  const host = cfg as McpHost | null | undefined
  if (!host || typeof host !== "object") return UNVERIFIED_MCP_OWNERSHIP
  const servers = host.mcp && typeof host.mcp === "object" ? host.mcp : {}
  const governed: string[] = []
  const foreign: string[] = []
  for (const [name, entry] of Object.entries(servers)) {
    if (isGovernedMcpEntry(name, entry, cloudMcp)) governed.push(name)
    else foreign.push(name)
  }
  return { governed, foreign }
}
