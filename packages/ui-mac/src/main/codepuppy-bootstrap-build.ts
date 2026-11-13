// `#1698`(DESIGN-upgrade-bootstrap-config §4.4):main 每次 fork 构建一次启动文档,原样放进 start 消息的 `bootstrap`。
// 输入全部来自现有权威(冻结环境快照、engine-paths.ts、ext 目录解析、资源根、applyAuthEnv 写进 main 环境的两个地址、
// 当刻登录态的分区哈希、出网代理端口),由 spawnLocalServer 取好交进来;每个键沿用今天读方的判法,空串的含义按键保留。
// 输出先过生产解析器:形状不对在 main 这一侧就抛(拒 fork),不等 sidecar 发现。对用户导出的值从不抛:不合格的地址省略并记一行。
import path from "node:path"
import { isCredentialFreeUrl, parseCodePuppyBootstrap, type CodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { materializeCloudMcpConfig } from "./cloud-sidecar-config"
import { CLOUD_MCP_SERVER_NAME } from "./cloud-web-search"
import { secretFileRef } from "./codepuppy-secret-files"

export type CodePuppyBootstrapInput = {
  userDataPath: string
  /** 当前环境 mutable root(main 的冻结快照) */
  globalRoot: string
  /** 当前环境 codepuppy.jsonc(engine-config-truth.ts 的 codepuppyJsoncPath) */
  userConfig: string
  initialDirectory: string
  databasePath: string
  engineConfigDirectory: string
  extPluginPath?: string
  officeMcpManifest: string
  registryChannel?: CodePuppyBootstrap["registryChannel"]
  /** 「本安装随机标识 + 账户标记」的哈希(`acct:<sha256>`);未登录或安装标识取不到时缺席 */
  policyAccount?: string
  /** 出网策略代理的端口(只在 darwin 起) */
  egressProxyPort?: number
  /** main 自己的环境:运维开关与 applyAuthEnv 写的地址只在这里读 */
  env: Record<string, string | undefined>
  /** 不合格的地址被省略时记一行(只写变量名,不写值) */
  log: (line: string) => void
}

export function buildCodePuppyBootstrap(input: CodePuppyBootstrapInput): CodePuppyBootstrap {
  const env = input.env
  // REQ-059 / ADR-019 逃生阀:任一置位 ⇒ 不给引擎 codepuppy.jsonc(今天 sidecar 注入的同一判法,`=== "1"`)
  const escapeHatch = env.CODEPUPPY_JSONC_TRUTH_DISABLE === "1" || env.CODEPUPPY_LEGACY_INSTALL_ROOT === "1"
  // 空串同未设(今天 codepuppy-models.ts / 注入都按真值判这两个地址)
  const modelProxyBaseURL = credentialFree("CODEPUPPY_BASE_URL", env.CODEPUPPY_BASE_URL, input.log)
  const cloudMcpUrl = credentialFree("CODEPUPPY_CLOUD_MCP_URL", env.CODEPUPPY_CLOUD_MCP_URL, input.log)
  return parseCodePuppyBootstrap({
    v: 1,
    paths: {
      userData: input.userDataPath,
      globalRoot: input.globalRoot,
      ...(escapeHatch ? {} : { userConfig: input.userConfig }),
      initialDirectory: input.initialDirectory,
      database: input.databasePath,
      engineConfigDirectory: input.engineConfigDirectory,
      // #1578 AC5:ext 构建写在插件旁边的随包清单(模块 sha256 + 自有工具名)
      ...(input.extPluginPath ? { extPlugin: input.extPluginPath, extBundledManifest: path.join(input.extPluginPath, "bundled-tools.json") } : {}),
      officeMcpManifest: input.officeMcpManifest,
    },
    ...(input.registryChannel ? { registryChannel: input.registryChannel } : {}),
    platform: {
      // REQ-236 `#1562`:平台模型请求的凭据只从这份文件现读(ext 的请求钩子);文档里只有引用
      credentialRef: secretFileRef(input.userDataPath, "CODEPUPPY_API_KEY"),
      ...(modelProxyBaseURL ? { modelProxyBaseURL } : {}),
      // `??` 语义:导出为空串也算导出(今天 codepuppy-models.ts 随后不设默认模型)
      ...(env.CODEPUPPY_DEFAULT_MODEL !== undefined ? { defaultModelOverride: env.CODEPUPPY_DEFAULT_MODEL } : {}),
    },
    // R8:云 MCP 定义在 main 用同一个工厂算;定义恒带 {file:} 引用(是否代付仍由 sidecar 注入按密钥文件在场性判)
    ...(cloudMcpUrl
      ? { cloudMcp: { name: CLOUD_MCP_SERVER_NAME, definition: materializeCloudMcpConfig(cloudMcpUrl, secretFileRef(input.userDataPath, "CODEPUPPY_MCP_TOKEN")) } }
      : {}),
    // ADR-009 B2 的能力总闸(任意非空串即开;两条腿的拒绝判决都等于它)
    webSearch: { killSwitch: Boolean(env.CODEPUPPY_WEBSEARCH_DISABLE) },
    policy: input.policyAccount ? { account: input.policyAccount } : {},
    network: input.egressProxyPort === undefined ? {} : { egressProxy: `http://127.0.0.1:${input.egressProxyPort}` },
  })
}

function credentialFree(name: string, value: string | undefined, log: (line: string) => void): string | undefined {
  if (!value) return undefined
  if (isCredentialFreeUrl(value)) return value
  log(`bootstrap: ${name} rejected (userinfo, query, fragment or non-https)`)
  return undefined
}
