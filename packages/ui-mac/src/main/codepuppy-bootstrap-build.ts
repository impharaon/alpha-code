// `#1698`(DESIGN-upgrade-bootstrap-config §4.4):main 每次 fork 构建一次启动文档,原样放进 start 消息的 `bootstrap`。
// 输入全部来自现有权威(冻结环境快照、engine-paths.ts、ext 目录解析、资源根),由 spawnLocalServer 取好交进来;
// 每个键沿用今天读方的判法。输出先过生产解析器:形状不对在 main 这一侧就抛(拒 fork),不等 sidecar 发现。
import path from "node:path"
import { parseCodePuppyBootstrap, type CodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"

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
  /** main 自己的环境:运维开关只在这里读 */
  env: Record<string, string | undefined>
}

export function buildCodePuppyBootstrap(input: CodePuppyBootstrapInput): CodePuppyBootstrap {
  // REQ-059 / ADR-019 逃生阀:任一置位 ⇒ 不给引擎 codepuppy.jsonc(今天 sidecar 注入的同一判法,`=== "1"`)
  const escapeHatch = input.env.CODEPUPPY_JSONC_TRUTH_DISABLE === "1" || input.env.CODEPUPPY_LEGACY_INSTALL_ROOT === "1"
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
  })
}
