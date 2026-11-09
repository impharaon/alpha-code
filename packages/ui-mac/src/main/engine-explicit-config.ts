// `#1667`(#1662 L5;编排器裁决 1667 评论 6738814516 第 2 条、C7 重裁 6741122824):引擎配置的**显式文件层**。
//
// OpenCode 2 的配置文档加载顺序(`packages/core/src/config.ts` 的 load 返回序):managedPolicies → integrated → wellknown →
// global → explicit(`start()` 的 `config.file`)→ direct → project → content(内联)→ managedSettings。设置项后加载的胜出,
// policy 先加载的胜出(`packages/core/src/managed-policy.ts`:文档倒序拼起来,`findLast` 命中)。于是:
//   · 出厂 `/init`、`/review` 与 `skills` 放这一层 ⇒ 项目里写的同名命令胜过出厂的,出厂的胜过上游内置的(v1 的「用户治理 >
//     出厂 > 上游内置」);
//   · provider 白名单的 `policies`(deny `*` + 逐个 allow,与内联文档里那份出自同一次 engineModelConfig 计算)放这一层 ⇒
//     比项目的 `opencode.json` / `.opencode/` 先加载,项目里写的 allow 盖不过它(L3 实测场景 D)。内联文档里那份保留为第二层。
//
// 这一个显式槽原本装的是当前环境的 `codepuppy.jsonc`(用户经 Code Puppy 装的 agent / command / mcp 的真源,REQ-059 G1)。
// 2.x 只有一个显式槽,所以这里每次启动把两样合成一份文件,放在 Code Puppy 自己的 userData 下(`codepuppy-engine-config/`):
// 用户文件原样在下,上面三样按「用户已有的同名命令不覆盖、skills 取并集、我们的 policies 排在用户的之后」合进去。
// `codepuppy.jsonc` 运行中被改(main 装东西、用户手改)时,sidecar 的监听重写这份合成文件,引擎对显式文件的监听再重载配置
// (`packages/core/src/config/watch.ts`)—— 装完不用重启这一点不变。用户文件解析不了:启动时只写我们这三样并记一行;运行中改坏
// 则保留上一份好的合成结果并记一行(不让一次手误把用户装的东西整份撤掉)。
// 已知边界:用户文件里**相对路径**的 `{file:./x}` 引用会按合成文件所在目录解析(Code Puppy 自己写的引用都是绝对路径)。
import * as fs from "node:fs"
import * as path from "node:path"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import { USER_DATA_LAYOUT } from "./user-data-layout"

export const EXPLICIT_CONFIG_FILE = "codepuppy-explicit.json"

export type ExplicitPolicy = { action: string; resource: string; effect: string }
export type ExplicitCommand = { template: string; description?: string; subagent?: boolean }
/** main 写进显式层的三样(都出自注入那一次计算)。 */
export type ExplicitLayer = { policies: ExplicitPolicy[]; commands: Record<string, ExplicitCommand>; skills: string[] }

export function explicitConfigPath(userDataPath: string): string {
  return path.join(userDataPath, USER_DATA_LAYOUT.engineConfig, EXPLICIT_CONFIG_FILE)
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)

/** 用户文件(可缺席)+ 我们这一层 ⇒ 显式文件的内容。用户文件解析不了 ⇒ 只放我们这一层,并给出原因。 */
export function composeExplicitDocument(userText: string | undefined, layer: ExplicitLayer): { document: Record<string, unknown>; userError?: string } {
  let user: Record<string, unknown> = {}
  let userError: string | undefined
  if (userText !== undefined) {
    const errors: ParseError[] = []
    const parsed: unknown = parseJsonc(userText, errors, { allowTrailingComma: true })
    if (errors.length || !isRecord(parsed)) userError = errors.length ? `JSONC parse error at offset ${errors[0]!.offset}` : "not a JSON object"
    else user = parsed
  }
  const document: Record<string, unknown> = { $schema: "https://opencode.ai/config.json", ...user }
  const userSkills = Array.isArray(user.skills) ? user.skills.filter((item): item is string => typeof item === "string") : []
  const skills = [...new Set([...userSkills, ...layer.skills])]
  if (skills.length) document.skills = skills
  // 用户文件里已有的同名命令(v1 的 `command` 或 2.x 的 `commands`)不覆盖:同一份文档里 2.x 的键压过 v1 的键,出厂的不能借此挤掉用户的。
  const taken = new Set([...Object.keys(isRecord(user.command) ? user.command : {}), ...Object.keys(isRecord(user.commands) ? user.commands : {})])
  const factory = Object.fromEntries(Object.entries(layer.commands).filter(([name]) => !taken.has(name)))
  if (Object.keys(factory).length || isRecord(user.commands)) document.commands = { ...factory, ...(isRecord(user.commands) ? user.commands : {}) }
  // 同一份文档里后面的 policy 胜出(`findLast`):我们的排在用户文件里的之后。
  if (layer.policies.length) document.policies = [...(Array.isArray(user.policies) ? user.policies : []), ...layer.policies]
  return { document, ...(userError ? { userError } : {}) }
}

function writeAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, text, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

function readUser(userConfig: string | undefined): string | undefined {
  if (!userConfig) return undefined
  try {
    return fs.readFileSync(userConfig, "utf8")
  } catch {
    return undefined
  }
}

/** 启动时:合成并原子写出显式文件。返回用户文件的解析问题(有的话)。 */
export function writeExplicitConfig(file: string, userConfig: string | undefined, layer: ExplicitLayer): { userError?: string } {
  const { document, userError } = composeExplicitDocument(readUser(userConfig), layer)
  writeAtomic(file, `${JSON.stringify(document, null, 2)}\n`)
  return userError ? { userError } : {}
}

/**
 * 运行中:`codepuppy.jsonc` 一变就重写显式文件(去抖 100ms)。改坏了 ⇒ 不重写(保留上一份好的)并记一行。返回停止函数。
 * 监听的是所在目录(main 的原子写是 rename,盯文件本身会在第一次换名后失联)。
 */
export function watchExplicitSources(input: { file: string; userConfig: string; layer: ExplicitLayer; log: (line: string) => void }): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = readUser(input.userConfig)
  const refresh = () => {
    const text = readUser(input.userConfig)
    if (text === last) return
    const { document, userError } = composeExplicitDocument(text, input.layer)
    if (userError && text !== undefined) {
      input.log(`[alpha-code#1667] ${input.userConfig} is not valid (${userError}); keeping the previous engine config`)
      return
    }
    try {
      writeAtomic(input.file, `${JSON.stringify(document, null, 2)}\n`)
      last = text
    } catch (error) {
      input.log(`[alpha-code#1667] could not rewrite ${input.file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  let watcher: fs.FSWatcher | undefined
  try {
    watcher = fs.watch(path.dirname(input.userConfig), (_event, name) => {
      if (name !== null && name !== path.basename(input.userConfig)) return
      clearTimeout(timer)
      timer = setTimeout(refresh, 100)
    })
  } catch (error) {
    input.log(`[alpha-code#1667] cannot watch ${input.userConfig}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return () => {
    clearTimeout(timer)
    watcher?.close()
  }
}
