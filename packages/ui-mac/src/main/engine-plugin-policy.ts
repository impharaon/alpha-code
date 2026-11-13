// `#1708`(INT-safety I-10;ADR-040 后果 4):项目范围的引擎插件在 Code Puppy 里一律不加载。
//
// 引擎把项目目录(以及它往上直到 `/` 的每一级目录)的 `.opencode/{plugin,plugins}/*.{ts,js}` 与 `opencode.json(c)` 的 `plugins`
// 当作加载操作,装载前唯一的拦截是配置里的 `plugin.use` 策略(`packages/core/src/plugin/module.ts` 的 load)。所以这里给显式文件层
// 写一组 `plugin.use`:先拒绝全部,再逐条放行 Code Puppy 自己的扩展与用户全局范围里**现在实际存在**的来源。
//
// 放行串怎么写(引擎拿什么串去比):
//   · 本地插件 = 绝对路径,原样比较:目录里发现的是 `<目录>/plugin(s)/<名字>`;配置里 `./x`、`../x` 按所在文件的目录解析,
//     `file://` 转成路径,绝对路径原样。
//   · 别的写法(包名、git 地址…)比较的是**去掉最后一个 `@` 之后部分**的串(`@` 在第 0 位除外):`pkg@1.0.0` 比的是 `pkg`。
//     于是任何放行一个包名的语句,项目都能用 `pkg@file:<项目里的目录>` / `pkg@npm:<别的包>` 借道 —— 包名形式的条目一律不放行,
//     只记一行(`refused`)。
//   · 引擎的通配(`packages/core/src/util/wildcard.ts`):`*` 跨 `/`、`?` 匹配任意一个字符,没有转义写法 ⇒ 含 `*` / `?` 的路径
//     写进去就成了一个项目路径可能落进去的模式,同样不放行。
// 结果:放行名单里只有不含通配字符的绝对路径;项目只能指向同一个文件,造不出一个会被放行的别的东西。
//
// 用户全局范围 = 引擎的全局配置目录(engine-paths.ts 的 engineGlobalConfigDirectory)、HOME 一级的 `~/.opencode/` 与
// `~/opencode.json(c)`(引擎把它们当作 HOME 下每个项目的上级目录扫进来;它们在用户自己的家目录里,照旧加载),以及用户的
// `codepuppy.jsonc`(合成进显式文件,相对条目按显式文件所在目录解析)。项目与 HOME 之间、以及 HOME 之上的上级目录不在其中。
// 列不出来的来源(MDM 描述文件、系统配置目录、wellknown / 集成文档带来的插件)不放行。
//
// 什么时候重算:sidecar 启动注入时一次;之后每次显式文件被重写(codepuppy.jsonc 改了、技能翻代 / 新装 / 停用,
// engine-explicit-config.ts 的 watchExplicitSources)再算。运行中往全局目录新加的插件,在下一次重算(最迟下次启动)后加载。
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import type { ExplicitPolicy } from "./engine-explicit-config"

// 与上游 `ConfigDiscovery.names`、`PluginSourceDirectory.names` 同值(main 不 import 上游 core:会把引擎整张图带进主进程打包)。
const CONFIG_FILES = ["opencode.json", "opencode.jsonc"]
const PLUGIN_DIRECTORIES = ["plugin", "plugins"]

export type EnginePluginPolicyInput = {
  /** Code Puppy 自己的扩展目录(main 解析好的绝对路径);缺席 = 不放行任何扩展。 */
  extPluginPath?: string
  /** 引擎的全局配置目录(`start()` 的 `config.directory`)。 */
  globalDirectory: string
  home: string
  /** 用户的 `codepuppy.jsonc` 原文,与其中相对条目被解析时的目录(合成后的显式文件所在目录)。 */
  userConfig?: { text: string; directory: string }
}

export function enginePluginPolicies(input: EnginePluginPolicyInput): { policies: ExplicitPolicy[]; refused: string[] } {
  const roots = [...new Set([input.globalDirectory, path.join(input.home, ".opencode")])]
  const documents = [
    ...roots.flatMap((root) => CONFIG_FILES.map((name) => ({ file: path.join(root, name), directory: root }))),
    ...CONFIG_FILES.map((name) => ({ file: path.join(input.home, name), directory: input.home })),
  ]
  const targets = [
    ...(input.extPluginPath ? [input.extPluginPath] : []),
    ...roots.flatMap(discoveredTargets),
    ...documents.flatMap((document) => configuredTargets(readText(document.file), document.directory)),
    ...(input.userConfig ? configuredTargets(input.userConfig.text, input.userConfig.directory) : []),
  ]
  const exact = (target: string) => path.isAbsolute(target) && !/[*?]/.test(target)
  return {
    policies: [
      { action: "plugin.use", resource: "*", effect: "deny" },
      ...[...new Set(targets.filter(exact))].sort().map((resource) => ({ action: "plugin.use", resource, effect: "allow" })),
    ],
    refused: [...new Set(targets.filter((target) => !exact(target)))].sort(),
  }
}

/** 引擎在一个配置目录的 `plugin/`、`plugins/` 里会发现的条目(上游 `PluginSourceDirectory.discover` 的规则)。 */
function discoveredTargets(root: string): string[] {
  return PLUGIN_DIRECTORIES.flatMap((name) => {
    const directory = path.join(root, name)
    const entries = (() => {
      try {
        return fs.readdirSync(directory, { withFileTypes: true })
      } catch {
        return []
      }
    })()
    return entries.flatMap((entry) => {
      const target = path.join(directory, entry.name)
      const source = entry.name.endsWith(".ts") || entry.name.endsWith(".js")
      if (entry.isFile()) return source ? [target] : []
      if (entry.isDirectory()) return [target]
      if (!entry.isSymbolicLink()) return []
      const resolved = statSafe(target)
      return resolved && (resolved.isDirectory() || (source && resolved.isFile())) ? [target] : []
    })
  })
}

/**
 * 一份配置文档的插件条目在引擎里成为的目标串(上游 normalize 把 v1 的 `plugin` 摊进 `plugins`,`config/plugin/source.ts` 解析路径)。
 * 移除指令(`-x`)不是加载操作,跳过。文档解析不了 ⇒ 引擎也不加载它 ⇒ 没有条目。
 */
function configuredTargets(text: string | undefined, directory: string): string[] {
  if (text === undefined) return []
  const errors: ParseError[] = []
  const document: unknown = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length || !document || typeof document !== "object" || Array.isArray(document)) return []
  const record = document as Record<string, unknown>
  const list = (value: unknown) => (Array.isArray(value) ? value : [])
  const specs = [
    ...list(record.plugin).map((entry) => (Array.isArray(entry) ? entry[0] : entry)),
    ...list(record.plugins).map((entry) => (entry && typeof entry === "object" ? (entry as { package?: unknown }).package : entry)),
  ].filter((spec): spec is string => typeof spec === "string" && spec.length > 0 && !spec.startsWith("-"))
  return specs.flatMap((spec) => {
    if (spec.startsWith("./") || spec.startsWith("../")) return [path.resolve(directory, spec)]
    if (!spec.startsWith("file://")) return [spec]
    try {
      return [fileURLToPath(spec)]
    } catch {
      return []
    }
  })
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return undefined
  }
}

function statSafe(file: string): fs.Stats | undefined {
  try {
    return fs.statSync(file)
  } catch {
    return undefined
  }
}
