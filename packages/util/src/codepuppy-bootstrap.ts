// north-star:codepuppy-owned — Code Puppy 自有文件,住在上游包目录里(ADR-043)。
//
// 启动文档 `CodePuppyBootstrap`(DESIGN-upgrade-bootstrap-config §4.1):Code Puppy 主进程交给 sidecar、ext 与引擎里 Code Puppy 代码的
// 决定,每代 sidecar 一份、只在内存里。main 构建,sidecar 解析并发布,其余只读。每个 bundle(sidecar、ext、引擎)各自编进一份本模块,
// 第一次读时用自己的解析器校验已发布的对象 —— 两份不同提交构建出的 bundle 混在一起,形状或版本不同就在第一次读时失败。
// 本文件只 import `node:path`:它会进 ext bundle 与 sidecar 的 import 闭包,不带写盘点。
//
// 字段按迁移键组落地(design §9):G1 —— 路径与通道;G2 —— 平台、云、网络。
import path from "node:path"

export const CODEPUPPY_BOOTSTRAP_VERSION = 1

/** 一代 sidecar 一份;结构化克隆可传(只有字符串、数字、布尔、数组、普通对象);可选键缺席时省略,不写 undefined。 */
export type CodePuppyBootstrap = {
  v: 1
  paths: {
    /** 绝对路径(原 StartCommand.userDataPath) */
    userData: string
    /** 当前环境 mutable root 的 canonical 绝对路径(原 CODEPUPPY_GLOBAL_DIR) */
    globalRoot: string
    /** 当前环境 codepuppy.jsonc;缺席 = 逃生阀 CODEPUPPY_JSONC_TRUTH_DISABLE / CODEPUPPY_LEGACY_INSTALL_ROOT 置位 */
    userConfig?: string
    initialDirectory: string
    /** 绝对路径,或 ":memory:" */
    database: string
    /** 交给 start() 的 config.directory */
    engineConfigDirectory: string
    /** ext 插件目录;缺席 ⇒ 不装 ext ⇒ sidecar 拒报 ready */
    extPlugin?: string
    /** 与 extPlugin 同在同缺 */
    extBundledManifest?: string
    officeMcpManifest: string
  }
  /** 缺席 ⇒ 跳过 disabled-override 注入 */
  registryChannel?: "stable" | "preview" | "dev"
  platform: {
    /** 平台模型凭据文件的引用,不是凭据 */
    credentialRef: `{file:${string}}`
    modelProxyBaseURL?: CredentialFreeUrl
    /** 缺席 = 没导出(用目录默认);"" = 导出了空串(不设默认模型) */
    defaultModelOverride?: string
  }
  /** main 解析出合格的云 MCP 地址时在场 */
  cloudMcp?: {
    /** 配置里那一条 MCP 的名字 */
    name: string
    /** 带凭据通道的完整定义;认证只在 header 的引用里 */
    definition: {
      type: "remote"
      url: CredentialFreeUrl
      headers: { Authorization: `Bearer {file:${string}}` }
      oauth: false
    }
  }
  webSearch: { killSwitch: boolean }
  /** /^acct:[0-9a-f]{64}$/;缺席 ⇒ 分区 "anonymous" */
  policy: { account?: string }
  /** /^http:\/\/127\.0\.0\.1:\d{1,5}$/;只在 darwin 在场 */
  network: { egressProxy?: string }
}

/**
 * 无凭据 URL:WHATWG `URL` 能解析;协议 https,或 http 且主机是 127.0.0.1 / localhost / [::1];username、password 为空;
 * search 与 hash 为空(整段查询串与片段都不允许,不按参数名猜哪个是凭据)。路径段不检查。
 */
export type CredentialFreeUrl = string & { readonly __credentialFree: unique symbol }

export function isCredentialFreeUrl(value: string): value is CredentialFreeUrl {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  const local = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)
  if (url.protocol !== "https:" && !local) return false
  return url.username === "" && url.password === "" && url.search === "" && url.hash === "" && !/[?#]/.test(value)
}

/** 今天的 CODEPUPPY_CLOUD_MCP_ARM:kill-switch 下云 MCP 只由 ext 装。 */
export function cloudMcpArmed(document: CodePuppyBootstrap): boolean {
  return document.webSearch.killSwitch && document.cloudMcp !== undefined
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])
const FILE_REF = /^\{file:[^}]+\}$/
const BEARER_FILE_REF = /^Bearer \{file:[^}]+\}$/
const ACCOUNT = /^acct:[0-9a-f]{64}$/
const EGRESS_PROXY = /^http:\/\/127\.0\.0\.1:\d{1,5}$/

export type CodePuppyBootstrapErrorReason = "invalid" | "version" | "unpublished" | "republished"

export class CodePuppyBootstrapError extends Error {
  override readonly name = "CodePuppyBootstrapError"
  /** `path` = 出错字段的点路径;消息里不带值。 */
  constructor(
    readonly reason: CodePuppyBootstrapErrorReason,
    readonly path?: string,
  ) {
    super(path === undefined ? `Code Puppy bootstrap document: ${reason}` : `Code Puppy bootstrap document: ${reason} at ${path}`)
  }
}

const KEY = Symbol.for("codepuppy.bootstrap")
const slot = globalThis as unknown as Record<symbol, unknown>

/** 严格解析:多键、缺必填键、类型或格式不符 ⇒ "invalid"(带 path);v !== CODEPUPPY_BOOTSTRAP_VERSION ⇒ "version"。返回深冻结的副本。 */
export function parseCodePuppyBootstrap(value: unknown): CodePuppyBootstrap {
  const root = record(value, "")
  if (root.v !== CODEPUPPY_BOOTSTRAP_VERSION) throw new CodePuppyBootstrapError("version", "v")
  only(root, ["v", "paths", "registryChannel", "platform", "cloudMcp", "webSearch", "policy", "network"], "")
  const paths = record(root.paths, "paths")
  only(paths, ["userData", "globalRoot", "userConfig", "initialDirectory", "database", "engineConfigDirectory", "extPlugin", "extBundledManifest", "officeMcpManifest"], "paths")
  const extPlugin = optional(paths, "extPlugin", "paths", absolute)
  const extBundledManifest = optional(paths, "extBundledManifest", "paths", absolute)
  if ((extPlugin === undefined) !== (extBundledManifest === undefined)) throw new CodePuppyBootstrapError("invalid", "paths.extBundledManifest")
  const userConfig = optional(paths, "userConfig", "paths", absolute)
  const registryChannel = optional(root, "registryChannel", "", channel)
  const platform = record(root.platform, "platform")
  only(platform, ["credentialRef", "modelProxyBaseURL", "defaultModelOverride"], "platform")
  const modelProxyBaseURL = optional(platform, "modelProxyBaseURL", "platform", credentialFreeUrl)
  const defaultModelOverride = optional(platform, "defaultModelOverride", "platform", text)
  const cloudMcp = optional(root, "cloudMcp", "", cloudMcpOf)
  const webSearch = record(root.webSearch, "webSearch")
  only(webSearch, ["killSwitch"], "webSearch")
  const policy = record(root.policy, "policy")
  only(policy, ["account"], "policy")
  const account = optional(policy, "account", "policy", matching(ACCOUNT))
  const network = record(root.network, "network")
  only(network, ["egressProxy"], "network")
  const egressProxy = optional(network, "egressProxy", "network", matching(EGRESS_PROXY))
  return deepFreeze({
    v: CODEPUPPY_BOOTSTRAP_VERSION,
    paths: {
      userData: absolute(paths.userData, "paths.userData"),
      globalRoot: absolute(paths.globalRoot, "paths.globalRoot"),
      ...(userConfig === undefined ? {} : { userConfig }),
      initialDirectory: absolute(paths.initialDirectory, "paths.initialDirectory"),
      database: paths.database === ":memory:" ? ":memory:" : absolute(paths.database, "paths.database"),
      engineConfigDirectory: absolute(paths.engineConfigDirectory, "paths.engineConfigDirectory"),
      ...(extPlugin === undefined ? {} : { extPlugin }),
      ...(extBundledManifest === undefined ? {} : { extBundledManifest }),
      officeMcpManifest: absolute(paths.officeMcpManifest, "paths.officeMcpManifest"),
    },
    ...(registryChannel === undefined ? {} : { registryChannel }),
    platform: {
      credentialRef: matching(FILE_REF)(platform.credentialRef, "platform.credentialRef") as `{file:${string}}`,
      ...(modelProxyBaseURL === undefined ? {} : { modelProxyBaseURL }),
      ...(defaultModelOverride === undefined ? {} : { defaultModelOverride }),
    },
    ...(cloudMcp === undefined ? {} : { cloudMcp }),
    webSearch: { killSwitch: bool(webSearch.killSwitch, "webSearch.killSwitch") },
    policy: account === undefined ? {} : { account },
    network: egressProxy === undefined ? {} : { egressProxy },
  })
}

/** sidecar 每个进程调用一次;第二次 ⇒ "republished"。把已校验的文档挂在 globalThis[Symbol.for("codepuppy.bootstrap")](与进程内 fetch 交接同一形状)。 */
export function publishCodePuppyBootstrap(document: CodePuppyBootstrap): void {
  if (slot[KEY] !== undefined) throw new CodePuppyBootstrapError("republished")
  slot[KEY] = deepFreeze(document)
}

let memo: { source: unknown; document: CodePuppyBootstrap } | undefined

/**
 * sidecar 与 ext 用。第一次读到某个已发布对象时,用**本 bundle 编进去的** parseCodePuppyBootstrap 解析并记住结果:
 * 未发布 ⇒ "unpublished";版本或形状与本 bundle 不符 ⇒ "version" / "invalid"。
 */
export function codepuppyBootstrap(): CodePuppyBootstrap {
  const document = tryCodePuppyBootstrap()
  if (!document) throw new CodePuppyBootstrapError("unpublished")
  return document
}

/** 引擎侧 Code Puppy 代码用:未发布 ⇒ undefined;已发布则同 codepuppyBootstrap()(本 bundle 解析,不符即抛)。 */
export function tryCodePuppyBootstrap(): CodePuppyBootstrap | undefined {
  const source = slot[KEY]
  if (source === undefined) return undefined
  if (memo?.source !== source) memo = { source, document: parseCodePuppyBootstrap(source) }
  return memo.document
}

/** 仅测试:撤掉已发布的文档(先例 `__resetCodePuppyEnvironmentForTests`)。 */
export function __resetCodePuppyBootstrapForTests(): void {
  delete slot[KEY]
  memo = undefined
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CodePuppyBootstrapError("invalid", at)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new CodePuppyBootstrapError("invalid", at)
  return value as Record<string, unknown>
}

function only(value: Record<string, unknown>, keys: readonly string[], at: string) {
  const extra = Object.keys(value).find((key) => !keys.includes(key))
  if (extra !== undefined) throw new CodePuppyBootstrapError("invalid", join(at, extra))
}

function optional<T>(value: Record<string, unknown>, key: string, at: string, check: (field: unknown, at: string) => T): T | undefined {
  if (!(key in value)) return undefined
  return check(value[key], join(at, key))
}

function absolute(value: unknown, at: string): string {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new CodePuppyBootstrapError("invalid", at)
  return value
}

function cloudMcpOf(value: unknown, at: string): NonNullable<CodePuppyBootstrap["cloudMcp"]> {
  const cloud = record(value, at)
  only(cloud, ["name", "definition"], at)
  const definition = record(cloud.definition, join(at, "definition"))
  only(definition, ["type", "url", "headers", "oauth"], join(at, "definition"))
  if (definition.type !== "remote") throw new CodePuppyBootstrapError("invalid", join(at, "definition.type"))
  if (definition.oauth !== false) throw new CodePuppyBootstrapError("invalid", join(at, "definition.oauth"))
  const headers = record(definition.headers, join(at, "definition.headers"))
  only(headers, ["Authorization"], join(at, "definition.headers"))
  const name = text(cloud.name, join(at, "name"))
  if (name === "") throw new CodePuppyBootstrapError("invalid", join(at, "name"))
  return {
    name,
    definition: {
      type: "remote",
      url: credentialFreeUrl(definition.url, join(at, "definition.url")),
      headers: { Authorization: matching(BEARER_FILE_REF)(headers.Authorization, join(at, "definition.headers.Authorization")) as `Bearer {file:${string}}` },
      oauth: false,
    },
  }
}

function credentialFreeUrl(value: unknown, at: string): CredentialFreeUrl {
  if (typeof value !== "string" || !isCredentialFreeUrl(value)) throw new CodePuppyBootstrapError("invalid", at)
  return value
}

function matching(pattern: RegExp) {
  return (value: unknown, at: string): string => {
    if (typeof value !== "string" || !pattern.test(value)) throw new CodePuppyBootstrapError("invalid", at)
    return value
  }
}

function text(value: unknown, at: string): string {
  if (typeof value !== "string") throw new CodePuppyBootstrapError("invalid", at)
  return value
}

function bool(value: unknown, at: string): boolean {
  if (typeof value !== "boolean") throw new CodePuppyBootstrapError("invalid", at)
  return value
}

function channel(value: unknown, at: string): "stable" | "preview" | "dev" {
  if (value === "stable" || value === "preview" || value === "dev") return value
  throw new CodePuppyBootstrapError("invalid", at)
}

function join(at: string, key: string) {
  return at === "" ? key : `${at}.${key}`
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}
