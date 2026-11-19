// `#1698`(DESIGN-upgrade-bootstrap-config §4.3、§10 R14):在测试进程里发布一份启动文档 —— sidecar 在 import 引擎、装 ext 之前做的
// 那一步。在起 ext / 引擎之前调用;同一进程里可以反复调用(先撤掉上一份)。夹具经生产解析器:形状错了在夹具这里就红。
import os from "node:os"
import path from "node:path"
import { buildCodePuppyBootstrap } from "../src/main/codepuppy-bootstrap-build"
import { materializeCloudMcpConfig } from "../src/main/cloud-sidecar-config"
import { codepuppyGlobalRoot } from "../src/main/codepuppy-installs"
import { engineGlobalConfigDirectory } from "../src/main/engine-paths"
import { publishProviderAllowList } from "../../ext/src/provider-allow"
import {
  __resetCodePuppyBootstrapForTests,
  parseCodePuppyBootstrap,
  publishCodePuppyBootstrap,
  type CodePuppyBootstrap,
} from "@opencode/util/codepuppy-bootstrap"

type Paths = CodePuppyBootstrap["paths"]

export type TestBootstrapInput = Partial<Paths> &
  Pick<Paths, "globalRoot"> & {
    registryChannel?: CodePuppyBootstrap["registryChannel"]
    platform?: { credentialRef?: string; modelProxyBaseURL?: string; defaultModelOverride?: string }
    cloudMcp?: CodePuppyBootstrap["cloudMcp"] | { name: string; definition: { type: "remote"; url: string; headers: { Authorization: string }; oauth: false; codemode: false } }
    killSwitch?: boolean
    policyAccount?: string
    egressProxy?: string
    engine?: Partial<CodePuppyBootstrap["engine"]>
    factoryDirs?: string[]
    askTimeoutMs?: number
    switches?: Partial<CodePuppyBootstrap["switches"]>
  }

/** 八个开关全关(没有任何运维导出时 main 写的那一份)。 */
export const NO_SWITCHES: CodePuppyBootstrap["switches"] = {
  modelsDisabled: false,
  identityDisabled: false,
  behaviorDisabled: false,
  promptRebrandDisabled: false,
  automationDisabled: false,
  readonlyDisabled: false,
  ecosystemInherit: false,
  extVerbose: false,
}

/**
 * 只有 `globalRoot` 必填;其余缺省取全局根下面的路径(codepuppy.jsonc 在全局根下;Office 清单缺省指向一个不存在的文件 = 不给第一方
 * MCP 声明),平台凭据引用
 * 缺省指 userData 下的 CODEPUPPY_API_KEY 密钥文件(与 main 的 secretFileRef 同形),kill-switch 关,无云 MCP、无账户分区、无出网代理;
 * 引擎开关取桌面缺省(不拉 models.dev、文件监听开),没有出厂技能目录,审批期限缺省,八个开关全关。
 */
export function testBootstrap(input: TestBootstrapInput): CodePuppyBootstrap {
  const { registryChannel, platform, cloudMcp, killSwitch, policyAccount, egressProxy, engine, factoryDirs, askTimeoutMs, switches, ...paths } = input
  const userData = paths.userData ?? path.join(input.globalRoot, "test-userdata")
  return parseCodePuppyBootstrap({
    v: 1,
    paths: {
      userData,
      userConfig: path.join(input.globalRoot, "codepuppy.jsonc"),
      initialDirectory: input.globalRoot,
      database: ":memory:",
      engineConfigDirectory: path.join(input.globalRoot, "test-engine-config"),
      officeMcpManifest: path.join(input.globalRoot, "test-office-mcp", "tools.json"),
      ...paths,
    },
    ...(registryChannel ? { registryChannel } : {}),
    engine: { modelsFetch: false, filewatcher: true, ...engine },
    platform: { credentialRef: `{file:${path.join(userData, "codepuppy-secrets", "CODEPUPPY_API_KEY")}}`, ...platform },
    ...(cloudMcp ? { cloudMcp } : {}),
    webSearch: { killSwitch: killSwitch ?? false },
    skills: { factoryDirs: factoryDirs ?? [] },
    policy: policyAccount ? { account: policyAccount } : {},
    permission: askTimeoutMs === undefined ? {} : { askTimeoutMs },
    network: egressProxy ? { egressProxy } : {},
    switches: { ...NO_SWITCHES, ...switches },
  })
}

/** 同 testBootstrap,并在本进程发布(先撤掉上一份)。 */
export function publishTestBootstrap(input: TestBootstrapInput): CodePuppyBootstrap {
  const document = testBootstrap(input)
  __resetCodePuppyBootstrapForTests()
  publishCodePuppyBootstrap(document)
  return document
}

/** 撤掉 sidecar 在本进程发布的两样:启动文档,与注入发布的供应商白名单(§10 R30)(afterEach / afterAll 用)。 */
export function unpublishTestBootstrap(): void {
  __resetCodePuppyBootstrapForTests()
  publishProviderAllowList(undefined)
}

/** main 用 materializeCloudMcpConfig 写进文档的那份治理云 MCP(带 `{file:}` 引用的真定义)。 */
export function testCloudMcp(url: string, tokenFile: string, name = "codepuppy") {
  return { name, definition: materializeCloudMcpConfig(url, `{file:${tokenFile}}`) }
}

/**
 * 按 main 的构建器(生产的 buildCodePuppyBootstrap)从「main 的环境」造一份文档并在本进程发布 —— 单进程测试里 process.env 同时
 * 扮演 main 的环境:用例照今天导出 CODEPUPPY_BASE_URL / CODEPUPPY_CLOUD_MCP_URL / CODEPUPPY_DEFAULT_MODEL / CODEPUPPY_WEBSEARCH_DISABLE
 * 与各个运维开关(CODEPUPPY_MODELS_DISABLE 等),再调这个,注入读到的就是 main 会交过去的那一份(各键的判法只在构建器里一处)。全局根缺省取 main 的
 * 解析(codepuppyGlobalRoot:快照 → 环境),引擎全局配置目录缺省按 main 的 engineGlobalConfigDirectory(测试隔离预载把 XDG 指向临时目录),
 * 其余路径落在全局根下。直接调注入的测试先调它,再把返回文档的 `paths.userConfig ?? null` 作为注入的第 4 个参数(sidecar 同一传法)。
 */
export function publishMainBootstrap(input: {
  userData: string
  globalRoot?: string
  engineConfigDirectory?: string
  extPluginPath?: string
  /** boot 时出厂技能对账的结果(缺省:没有) */
  factorySkillDirs?: string[]
  env?: Record<string, string | undefined>
}): CodePuppyBootstrap {
  const env = input.env ?? process.env
  // 先撤掉上一份:全局根的解析会读已发布的文档
  __resetCodePuppyBootstrapForTests()
  const globalRoot = input.globalRoot ?? codepuppyGlobalRoot()
  const document = buildCodePuppyBootstrap({
    userDataPath: input.userData,
    globalRoot,
    userConfig: path.join(globalRoot, "codepuppy.jsonc"),
    initialDirectory: globalRoot,
    databasePath: path.join(globalRoot, "test-engine.db"),
    engineConfigDirectory: input.engineConfigDirectory ?? engineGlobalConfigDirectory(env, os.homedir()),
    extPluginPath: input.extPluginPath,
    officeMcpManifest: path.join(globalRoot, "test-office-mcp", "tools.json"),
    factorySkillDirs: input.factorySkillDirs ?? [],
    env,
    log: () => {},
  })
  publishCodePuppyBootstrap(document)
  return document
}
