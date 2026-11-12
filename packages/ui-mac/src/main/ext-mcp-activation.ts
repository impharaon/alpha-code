import { lstatSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { parse, type ParseError } from "jsonc-parser"
import { isExtensionName } from "../shared/extension-name"
import { assertProjectCodePuppyRootIdentity, resolveProjectCodePuppyRoot } from "./codepuppy-workdir"
import { listConfiguredMcpServerNamesStrict } from "./ext-config"
// 刻意不从 `packages/opencode/src/util/timeout` import:那是 UPSTREAM_PATHS 下持续滚动重钉的
// vendored 上游,深 import 它的内部模块路径 = 下次 pin bump 上游改名就打断主进程构建。
// 语义与上游那份一致(超时 reject,由本文件末尾的 catch 归一为 unverifiable),ui-mac 侧
// 另有两份同形态的本地实现(use-extensions.ts:225、wsl/runtime.ts:395)。
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms)
    }),
  ])
}
import type { EngineConnection } from "./engine-authorization"
import { engineClient } from "./engine-client"

export type ProjectMcpActivationVerdict = "active" | "shadowed" | "pending" | "unverifiable"

/**
 * Prove that a live MCP status belongs to D's durable project leaf before consulting the
 * otherwise name-only status map. The projection is deliberately closed: no config, path, or
 * status bytes cross this main-owned boundary.
 */
export async function probeProjectMcpActivation(
  name: string,
  directory: string,
  awaitServer: () => Promise<EngineConnection>,
  options: {
    fetch?: typeof fetch
    timeoutMs?: { awaitServer: number; globalConfig: number; effectiveConfig: number; status: number }
    configuredGlobalNames?: typeof listConfiguredMcpServerNamesStrict
  } = {},
): Promise<ProjectMcpActivationVerdict> {
  if (!isExtensionName(name)) return "unverifiable"
  const project = resolveProjectCodePuppyRoot(directory)
  if (project.status !== "project") return "unverifiable"

  const durable = readDurableProjectMcpLeaf(project.root, name)
  if (!durable.ok || durable.value === undefined) return "unverifiable"

  const configured = (options.configuredGlobalNames ?? listConfiguredMcpServerNamesStrict)()
  if (!configured.ok) return "unverifiable"
  if (configured.names.includes(name)) return "shadowed"

  const injected = injectedGlobalMcpLeaf(name)
  if (!injected.ok) return "unverifiable"
  if (injected.value !== undefined) return "shadowed"

  const timeoutMs = options.timeoutMs ?? {
    awaitServer: 5_000,
    globalConfig: 5_000,
    effectiveConfig: 5_000,
    status: 10_000,
  }
  try {
    const server = await withTimeout(
      awaitServer(),
      timeoutMs.awaitServer,
      "timed out waiting for the engine before project MCP activation probe",
    )
    const client = engineClient(server, options.fetch ?? fetch)
    const location = { directory: project.projectDir }

    // `#1667`(OpenCode 2):`GET /api/config` 给的是这个 Location 的配置**文档**(全局目录、显式文件、项目、注入那一层……),
    // 不再是 v1 那份合并后的配置;2.x 里高层文档按名字整条替换低层的 MCP server。项目 codepuppy.jsonc 的条目不是配置文档,
    // 它经 ext 进引擎(清点表 C10,归 L3)。所以:任何一份配置文档定义了这个名字 ⇒ 引擎里那台同名 server 不是 D 的(含注入面
    // 对用户全局同名条目写的中和条目),判 shadowed;没有 ⇒ 只剩 ext 装的那一份,才去看按名字的实时状态。
    const entries = await withTimeout(
      client.config.get({ location }),
      Math.max(timeoutMs.globalConfig, timeoutMs.effectiveConfig),
      "timed out reading the location's config documents for project MCP activation probe",
    )
    if (!Array.isArray(entries)) return "unverifiable"
    for (const entry of entries as unknown[]) {
      if (!isRecord(entry) || entry.type !== "document") continue
      const servers = isRecord(entry.info) && isRecord(entry.info.mcp) ? entry.info.mcp.servers : undefined
      if (isRecord(servers) && servers[name] !== undefined) return "shadowed"
    }

    // Only a provenance-proven D leaf may consult the name-keyed live status, and the request
    // itself remains directory-scoped. All non-connected/ambiguous outcomes collapse closed.
    const listed = await withTimeout(client.mcp.list({ location }), timeoutMs.status, "timed out reading directory-scoped MCP status")
    const status = Array.isArray(listed?.data) ? listed.data.find((server) => server.name === name)?.status : undefined
    if (status?.status === "connected") return "active"
    // `#1563`:引擎还在后台启动这台服务 —— 准备中,不是「核验不了」。
    if (status?.status === "pending") return "pending"
    return "unverifiable"
  } catch {
    return "unverifiable"
  }
}

function readDurableProjectMcpLeaf(
  projectRoot: string,
  name: string,
): { ok: true; value: Record<string, unknown> | undefined } | { ok: false } {
  try {
    assertProjectCodePuppyRootIdentity(projectRoot)
    const target = join(projectRoot, "codepuppy.jsonc")
    const stat = lstatSync(target)
    if (stat.isSymbolicLink() || !stat.isFile()) return { ok: false }
    const errors: ParseError[] = []
    const config: unknown = parse(readFileSync(target, "utf8"), errors, { allowTrailingComma: true })
    if (errors.length > 0) return { ok: false }
    return mcpLeafFromConfig(config, name)
  } catch {
    return { ok: false }
  }
}

function injectedGlobalMcpLeaf(
  name: string,
): { ok: true; value: Record<string, unknown> | undefined } | { ok: false } {
  const content = process.env.OPENCODE_CONFIG_CONTENT
  if (content === undefined) return { ok: true, value: undefined }
  const errors: ParseError[] = []
  const config: unknown = parse(content, errors, { allowTrailingComma: true })
  if (errors.length > 0) return { ok: false }
  return mcpLeafFromConfig(config, name)
}

function mcpLeafFromConfig(
  config: unknown,
  name: string,
): { ok: true; value: Record<string, unknown> | undefined } | { ok: false } {
  if (!isRecord(config)) return { ok: false }
  if (config.mcp === undefined) return { ok: true, value: undefined }
  if (!isRecord(config.mcp)) return { ok: false }
  const leaf = config.mcp[name]
  if (leaf === undefined) return { ok: true, value: undefined }
  return isRecord(leaf) ? { ok: true, value: leaf } : { ok: false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

/**
 * `#1529`(基线 §2.5 / §2.6):只剩**核验**那一半 —— 读某目录引擎实例里这个 MCP 的连接状态。
 * 重载不再在这里做:安装体改为经 reload-coordinator 请 ext 调度器重载(等会话空闲)。
 * 只返回状态,不返回任何配置或密钥字节。读不出(超时 / HTTP 错误 / 形状不对)= `unverifiable`。
 */
export type McpVerification = {
  reference: string
  /**
   * `needs_auth` / `needs_client_registration` 原样透传(`#1531`):重载修不好它们,呈现面据此不出「现在重载」。
   * `pending`(`#1563`,与上游 v2 同名):引擎在后台启动这台服务,是「准备中」而不是失败,同样不出「现在重载」。
   */
  status: "connected" | "pending" | "disabled" | "failed" | "needs_auth" | "needs_client_registration" | "unverifiable"
  /** `pending` 时引擎带出的上一次失败原因(只在后台重连时有,`#1563`)。 */
  lastFailure?: string
}

export async function verifyInstalledMcp(
  name: string,
  directory: string,
  awaitServer: () => Promise<EngineConnection>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = { awaitServer: 5_000, status: 10_000 },
): Promise<McpVerification> {
  try {
    const server = await withTimeout(
      awaitServer(),
      timeoutMs.awaitServer,
      "timed out waiting for the engine before MCP verification",
    )
    // `#1667`:OpenCode 2 的 `GET /api/mcp`(`{ location, data: Mcp.Server[] }`,状态是上游 `Mcp.Status` 的五种)。
    const listed = await withTimeout(
      engineClient(server, fetchImpl).mcp.list({ location: { directory } }),
      timeoutMs.status,
      "timed out reading directory-scoped MCP status",
    )
    if (!Array.isArray(listed?.data)) return { reference: name, status: "unverifiable" }
    const entry = listed.data.find((server) => server.name === name)?.status
    if (entry?.status === "connected") return { reference: name, status: "connected" }
    if (entry?.status === "pending") return { reference: name, status: "pending" }
    if (entry?.status === "disabled") return { reference: name, status: "disabled" }
    if (entry?.status === "needs_auth") return { reference: name, status: "needs_auth" }
    return { reference: name, status: "failed" }
  } catch {
    return { reference: name, status: "unverifiable" }
  }
}
