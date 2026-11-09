// #535 / REQ-109 T6,启动可用性基线 §② G1、§③:
// 用户全局 opencode 配置是外部输入面。sidecar fork 时只枚举引擎真实的全局配置目录,
// 把不在 alpha 治理集的 mcp 以中和条目(`disabled:true`,见 NEUTRALIZED_MCP_SERVER)写进注入配置;
// 治理内 server 不复制、不改写。项目配置面、上游 MCP 实现均不动。
// `#1381`:codepuppy.jsonc 自己的 `type:"remote"` 条目同样压成中和条目(除非它正是本轮从真源注入的名字)——
// 见函数体内的说明。
//
// `#1667`:枚举的目录 = sidecar 经 `start()` 的 `config.directory` 交给引擎的那一个(engine-paths.ts 的
// engineGlobalConfigDirectory,同一个函数)。读取/解析逐文件 best-effort,任何坏文件只
// loud 跳过自身,不得把 sidecar 上方已经完成的 provider/identity/permission 注入一起炸掉。

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse, type ParseError } from "jsonc-parser"
import { engineGlobalConfigDirectory } from "./engine-paths"

const GLOBAL_CONFIG_FILES = ["config.json", "opencode.json", "opencode.jsonc"]

/**
 * `#1667`:OpenCode 2 里高层配置按名字**整条替换**低层的 MCP server(`packages/core/src/config/plugin/mcp.ts`:后加载的文档
 * `servers.set(name, server)` 覆盖前一个),v1 那种「只写一片 `enabled:false` 叶子、深合并进原定义」的写法在 2.x 被丢弃并出诊断
 * (`config/normalize.ts` 的 "omitted enabled-only legacy MCP entry")。所以要关掉一个 server,注入面写一条**完整而连不上**的
 * 中和条目:`disabled: true`,端点指向 127.0.0.1:1(与 kill-switch 下的 WITHHELD_CLOUD_MCP 同一手法)。
 */
export const NEUTRALIZED_MCP_SERVER = {
  type: "remote" as const,
  url: "http://127.0.0.1:1/codepuppy-mcp-disabled",
  disabled: true as const,
  oauth: false as const,
}

type Config = { mcp?: { servers?: Record<string, unknown> } }

export function injectMcpDefaultDeny(
  config: Config,
  options: {
    codepuppyConfigPath: string
    /** 仅测试/隔离注入;生产缺省 = engineGlobalConfigDirectory(引擎真正读的全局配置目录)。 */
    userConfigDir?: string
    /** 本轮 injectCodePuppyConfig 新放入 config.mcp 的名称;不得把继承 env 当成治理来源。 */
    injectedMcpNames?: Iterable<string>
    /** 仅测试注入;生产固定同步读盘,与 sidecar fork 注入时序一致。 */
    readFile?: (file: string) => string
    logError?: (message: string) => void
  },
): void {
  const logError = options.logError ?? ((message: string) => console.error(message))
  try {
    const readFile = options.readFile ?? ((file: string) => readFileSync(file, "utf8"))
    const alpha = readConfig(options.codepuppyConfigPath, "alpha", readFile, logError)
    const codepuppyMcp = asRecord(alpha?.mcp)
    const userConfigDir = options.userConfigDir ?? engineGlobalConfigDirectory(process.env, homedir())
    const globalMcp = GLOBAL_CONFIG_FILES.map((name) =>
      readConfig(join(userConfigDir, name), "user-global", readFile, logError),
    )
      .flatMap((source) => Object.entries(asRecord(source?.mcp)))
      .reduce<Record<string, unknown>>((result, [name, leaf]) => {
        result[name] = { ...asRecord(result[name]), ...asRecord(leaf) }
        return result
      }, Object.create(null) as Record<string, unknown>)
    // #223 R6 Major:治理集只认「codepuppy.jsonc 里真有的」与「本轮注入面真放进去的」。以前这里写死
    // 一个 `"cloud"` 字面量,于是**不代付时**用户全局配置里一个叫 cloud 的第三方 server 被永久
    // 当成治理来源、连 enabled:false 都不写 —— 名字不是治理凭据。代付两条分支下注入面都会把
    // cloud 放进 injectedMcpNames(kill-switch 下放的是中和条目),治理语义因此不变。
    // `#1381`(`#1383` 基线 I1 / I3):codepuppy.jsonc 里的 `type:"remote"` 条目**也不是治理凭据** —— 那个文件在围栏的可写集里(W2),
    // 被围栏的引擎树自己写得了;远程 MCP 的记录自本票起住在 main 才写得了的真源(mcp-server-truth.ts),由注入面放进
    // injectedMcpNames。治理集因此 = codepuppy.jsonc 里的**非远程**条目 ∪ 本轮注入的名字;codepuppy.jsonc 里不在注入名单的远程条目
    // 本身也压成 `enabled:false` —— 引擎原生仍会合并 OPENCODE_CONFIG,不压它就会去连(只是被围栏 403),而它不该被当成
    // 已治理的连接器启用。本地条目一字不动:它们不需要出网授权,仍是 codepuppy.jsonc 的正当居民。
    const injected = new Set(options.injectedMcpNames ?? [])
    const codepuppyRemote = Object.entries(codepuppyMcp)
      .filter(([, leaf]) => asRecord(leaf).type === "remote")
      .map(([name]) => name)
    const governed = new Set([...Object.keys(codepuppyMcp).filter((name) => !codepuppyRemote.includes(name)), ...injected])
    const denied = Object.keys(globalMcp)
      .filter((name) => !governed.has(name))
      .sort()

    denied.forEach((name) => neutralize(config, name))
    if (denied.length)
      logError(`[req109-535] default-denied user-global MCP names=${JSON.stringify(denied)}`)

    const deniedRemote = codepuppyRemote.filter((name) => !injected.has(name)).sort()
    deniedRemote.forEach((name) => neutralize(config, name))
    if (deniedRemote.length)
      logError(
        `[alpha-code#1381] default-denied remote MCP entries in ${options.codepuppyConfigPath} (not in the main-only truth file, so neither injected nor authorized) names=${JSON.stringify(deniedRemote)}`,
      )
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    logError(`[req109-535] MCP sovereignty injection skipped (${code ?? "unexpected error"})`)
  }
}

function readConfig(
  file: string,
  role: "alpha" | "user-global",
  readFile: (file: string) => string,
  logError: (message: string) => void,
): Record<string, unknown> | undefined {
  let text: string
  try {
    text = readFile(file)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") {
      if (role === "alpha") logError(`[req109-535] alpha MCP governance config missing; skipping file ${file}`)
      return
    }
    logError(`[req109-535] unreadable ${role} MCP config skipped: ${file} (${code ?? "read error"})`)
    return
  }

  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length) {
    logError(`[req109-535] unparseable ${role} MCP config skipped: ${file} (${errors.length} error(s))`)
    return
  }
  return asRecord(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function neutralize(config: Config, name: string): void {
  config.mcp = { ...config.mcp, servers: { ...config.mcp?.servers, [name]: { ...NEUTRALIZED_MCP_SERVER } } }
}
