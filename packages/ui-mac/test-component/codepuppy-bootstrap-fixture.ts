// `#1698`(DESIGN-upgrade-bootstrap-config §4.3、§10 R14):在测试进程里发布一份启动文档 —— sidecar 在 import 引擎、装 ext 之前做的
// 那一步。在起 ext / 引擎之前调用;同一进程里可以反复调用(先撤掉上一份)。夹具经生产解析器:形状错了在夹具这里就红。
import path from "node:path"
import { buildCodePuppyBootstrap } from "../src/main/codepuppy-bootstrap-build"
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
    cloudMcp?: CodePuppyBootstrap["cloudMcp"] | { name: string; definition: { type: "remote"; url: string; headers: { Authorization: string }; oauth: false } }
    killSwitch?: boolean
    policyAccount?: string
    egressProxy?: string
  }

/**
 * 只有 `globalRoot` 必填;其余缺省取全局根下面的路径(Office 清单缺省指向一个不存在的文件 = 不给第一方 MCP 声明),平台凭据引用
 * 缺省指 userData 下的 CODEPUPPY_API_KEY 密钥文件(与 main 的 secretFileRef 同形),kill-switch 关,无云 MCP、无账户分区、无出网代理。
 */
export function testBootstrap(input: TestBootstrapInput): CodePuppyBootstrap {
  const { registryChannel, platform, cloudMcp, killSwitch, policyAccount, egressProxy, ...paths } = input
  const userData = paths.userData ?? path.join(input.globalRoot, "test-userdata")
  return parseCodePuppyBootstrap({
    v: 1,
    paths: {
      userData,
      initialDirectory: input.globalRoot,
      database: ":memory:",
      engineConfigDirectory: path.join(input.globalRoot, "test-engine-config"),
      officeMcpManifest: path.join(input.globalRoot, "test-office-mcp", "tools.json"),
      ...paths,
    },
    ...(registryChannel ? { registryChannel } : {}),
    platform: { credentialRef: `{file:${path.join(userData, "codepuppy-secrets", "CODEPUPPY_API_KEY")}}`, ...platform },
    ...(cloudMcp ? { cloudMcp } : {}),
    webSearch: { killSwitch: killSwitch ?? false },
    policy: policyAccount ? { account: policyAccount } : {},
    network: egressProxy ? { egressProxy } : {},
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
  return { name, definition: { type: "remote" as const, url, headers: { Authorization: `Bearer {file:${tokenFile}}` }, oauth: false as const } }
}

/**
 * 按 main 的构建器(生产的 buildCodePuppyBootstrap)从「main 的环境」造一份文档并在本进程发布 —— 单进程测试里 process.env 同时
 * 扮演 main 的环境:用例照今天导出 CODEPUPPY_BASE_URL / CODEPUPPY_CLOUD_MCP_URL / CODEPUPPY_DEFAULT_MODEL / CODEPUPPY_WEBSEARCH_DISABLE,
 * 再调这个,注入读到的就是 main 会交过去的那一份(G2 各键的判法只在构建器里一处)。全局根缺省取 CODEPUPPY_GLOBAL_DIR,引擎全局
 * 配置目录缺省取 XDG_CONFIG_HOME/opencode(测试都把它指向临时目录),其余路径落在全局根下。
 */
export function publishMainBootstrap(input: {
  userData: string
  globalRoot?: string
  engineConfigDirectory?: string
  extPluginPath?: string
  env?: Record<string, string | undefined>
}): CodePuppyBootstrap {
  const env = input.env ?? process.env
  const globalRoot = input.globalRoot ?? env.CODEPUPPY_GLOBAL_DIR
  if (!globalRoot) throw new Error("publishMainBootstrap: no global root (pass globalRoot or set CODEPUPPY_GLOBAL_DIR)")
  const document = buildCodePuppyBootstrap({
    userDataPath: input.userData,
    globalRoot,
    userConfig: path.join(globalRoot, "codepuppy.jsonc"),
    initialDirectory: globalRoot,
    databasePath: path.join(globalRoot, "test-engine.db"),
    engineConfigDirectory: input.engineConfigDirectory ?? (env.XDG_CONFIG_HOME ? path.join(env.XDG_CONFIG_HOME, "opencode") : path.join(globalRoot, "test-engine-config")),
    extPluginPath: input.extPluginPath,
    officeMcpManifest: path.join(globalRoot, "test-office-mcp", "tools.json"),
    env,
    log: () => {},
  })
  __resetCodePuppyBootstrapForTests()
  publishCodePuppyBootstrap(document)
  return document
}
