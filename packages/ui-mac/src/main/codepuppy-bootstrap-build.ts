// `#1698`(DESIGN-upgrade-bootstrap-config §4.4):main 每次 fork 构建一次启动文档,原样放进 start 消息的 `bootstrap`。
// 输入全部来自现有权威(冻结环境快照、engine-paths.ts、ext 目录解析、资源根、boot 时出厂技能对账的结果、applyAuthEnv 写进 main
// 环境的两个地址、当刻登录态的分区哈希、出网代理端口),由 spawnLocalServer 取好交进来。运维开关的名字对用户不变,只是读的地方收到这里
// 一处;每个开关都按 util 的 exportedFlag 判(owner 2026-11-13:不保留旧版本各键各自的写法,空串就是没设)。
// 输出先过生产解析器:形状不对在 main 这一侧就抛(拒 fork),不等 sidecar 发现。对用户导出的值从不抛(编排器 2026-11-13 裁决):不合格的
// 导出值当没设 —— 那个字段回到缺省 —— 并记一行 `bootstrap: <变量名> ignored (<原因>)`,不写值。什么算合格由文档定,不按旧代码的读法。
import os from "node:os"
import path from "node:path"
import { exportedFlag, isCredentialFreeUrl, parseCodePuppyBootstrap, type CodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { materializeCloudMcpConfig } from "./cloud-sidecar-config"
import { CLOUD_MCP_SERVER_NAME } from "./cloud-web-search"
import { secretFileRef } from "./codepuppy-secret-files"
import { engineDesktopToggles } from "./engine-server-options"

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
  /** boot 时出厂技能对账(reconcileFactorySkills)交出的目录;没对账 / 对账失败 ⇒ 空 */
  factorySkillDirs: readonly string[]
  /** main 自己的环境:运维开关与 applyAuthEnv 写的地址只在这里读 */
  env: Record<string, string | undefined>
  /** 不合格的导出值被忽略时记一行(只写变量名,不写值) */
  log: (line: string) => void
}

/** 喂给文档路径字段的用户导出变量:引擎全局配置目录、会话库的数据根、初始目录。 */
const EXPORTED_PATH_VARIABLES = ["OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "CODEPUPPY_USER_WORKSPACE_DIR"] as const

/**
 * 文档的路径字段只收绝对路径。用户导出的这些变量若是相对路径(含 `.`)就当没设、回到缺省并记一行 —— GUI 应用里相对路径没有确定的基准,
 * 不猜。HOME 同理:相对的 HOME 当没设,取系统账户的主目录(Node 在 HOME 未设时的同一来源)。spawnLocalServer 用返回的 env / home 推导
 * 会话库、数据根、引擎全局配置目录与初始目录,再交给构建器。
 */
export function usableExportedPaths(input: { env: Record<string, string | undefined>; home: string; log: (line: string) => void }) {
  const env = { ...input.env }
  for (const name of EXPORTED_PATH_VARIABLES) {
    const value = env[name]
    if (!value || path.isAbsolute(value)) continue
    delete env[name]
    input.log(ignored(name, "not an absolute path"))
  }
  if (path.isAbsolute(input.home)) return { env, home: input.home }
  input.log(ignored("HOME", "not an absolute path"))
  return { env, home: os.userInfo().homedir }
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
    // 两个引擎开关(没设:不拉 models.dev、文件监听开)
    engine: engineDesktopToggles(env),
    platform: {
      // REQ-236 `#1562`:平台模型请求的凭据只从这份文件现读(ext 的请求钩子);文档里只有引用
      credentialRef: secretFileRef(input.userDataPath, "CODEPUPPY_API_KEY"),
      ...(modelProxyBaseURL ? { modelProxyBaseURL } : {}),
      // 空串就是没导出
      ...(env.CODEPUPPY_DEFAULT_MODEL ? { defaultModelOverride: env.CODEPUPPY_DEFAULT_MODEL } : {}),
    },
    // R8:云 MCP 定义在 main 用同一个工厂算;定义恒带 {file:} 引用(是否代付仍由 sidecar 注入按密钥文件在场性判)
    ...(cloudMcpUrl
      ? { cloudMcp: { name: CLOUD_MCP_SERVER_NAME, definition: materializeCloudMcpConfig(cloudMcpUrl, secretFileRef(input.userDataPath, "CODEPUPPY_MCP_TOKEN")) } }
      : {}),
    // ADR-009 B2 的能力总闸(两条腿的拒绝判决都等于它)
    webSearch: { killSwitch: on(env.CODEPUPPY_WEBSEARCH_DISABLE) },
    skills: { factoryDirs: [...input.factorySkillDirs] },
    policy: input.policyAccount ? { account: input.policyAccount } : {},
    // ADR-038:正整数毫秒覆盖期限;空串同未设;不合法 ⇒ 忽略并记一行 ⇒ 缺省 300 s,从不是「没有期限」
    permission: askTimeout(env.CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS, input.log),
    network: input.egressProxyPort === undefined ? {} : { egressProxy: `http://127.0.0.1:${input.egressProxyPort}` },
    switches: {
      modelsDisabled: on(env.CODEPUPPY_MODELS_DISABLE),
      identityDisabled: on(env.CODEPUPPY_IDENTITY_DISABLE),
      behaviorDisabled: on(env.CODEPUPPY_BEHAVIOR_DISABLE),
      promptRebrandDisabled: on(env.CODEPUPPY_PROMPT_REBRAND_DISABLE),
      automationDisabled: on(env.CODEPUPPY_AUTOMATION_DISABLE),
      readonlyDisabled: on(env.CODEPUPPY_READONLY_DISABLE),
      ecosystemInherit: on(env.CODEPUPPY_ECOSYSTEM_INHERIT),
      extVerbose: on(env.CODEPUPPY_EXT_VERBOSE),
    },
  })
}

function askTimeout(raw: string | undefined, log: (line: string) => void): { askTimeoutMs?: number } {
  if (raw === undefined || raw === "") return {}
  const parsed = Number(raw)
  if (Number.isSafeInteger(parsed) && parsed > 0) return { askTimeoutMs: parsed }
  log(ignored("CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS", "not a positive integer of milliseconds"))
  return {}
}

/** 开关没设即关 */
const on = (value: string | undefined) => exportedFlag(value) === true

function ignored(name: string, reason: string): string {
  return `bootstrap: ${name} ignored (${reason})`
}

function credentialFree(name: string, value: string | undefined, log: (line: string) => void): string | undefined {
  if (!value) return undefined
  if (isCredentialFreeUrl(value)) return value
  log(ignored(name, "userinfo, query, fragment or non-https"))
  return undefined
}
