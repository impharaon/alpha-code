// engine-transforms — `#1665`(清点表 C10 / L3r):v1 时代 ext 在整份 `config` 钩子里改 cfg;OpenCode 2 没有整份配置的钩子,
// 只有按域的 transform(`agent` / `mcp` / `command` / `skill` …,`packages/plugin/src/promise/*.ts`)。
//
// 做法:ext 仍然先在一份 **v1 形状**的小对象上算「Code Puppy 要往引擎里加什么」—— 项目 `.codepuppy/codepuppy.jsonc`
// 合并(信任门在 `mergeProjectConfig` 里)、出厂禁项(`applyFactoryDeny`)、提示词接管(`applyPromptTakeover`)都是既有的纯
// 函数、各有单测,形状不动;本模块只负责把那份对象**翻译**进 2.x 的编辑器。项目文件里写的就是这个 v1 形状(用户数据,
// `codepuppy_register` 也这样写),所以翻译是一次性的、按字段的,不解释上游的任何文法。
//
// 优先级靠 2.x 的插件激活顺序(`packages/core/src/plugin/internal.ts`:internal.pre → 按配置装载的插件 → internal.post):
//   · 上游内置的 agent(general / explore …)在 pre 里注册 ⇒ ext 的 agent.transform 在它们之后跑,alpha 出厂的接管盖过上游内置;
//     出厂命令 /init /review 不经 ext(编排器裁决 2026-11-09):L5 用 `applyPromptTakeover` 把它们写进主进程的内联配置文档,
//     由上游 `opencode.config.command` 实现模板文法与 `review` 的子任务语义;ext 的 command.transform 只注册项目命令与出厂禁项占位;
//   · 用户配置的 agents / commands 由 post 里的 `opencode.config.agent` / `opencode.config.command` 注册 ⇒ 在 ext 之后,
//     按字段合并 / 同名覆盖 —— 「用户治理 > alpha 出厂 > 上游内置」这条次序由结构保证;
//   · 用户配置的 MCP 由 pre 里的 `opencode.config.mcp` 写入 ⇒ ext 的 mcp.transform 看得到,项目 MCP 只补缺(全局优先)。
//
// 做不到的(写在这里,不假装):
//   · `skills.paths`(项目 / 出厂 / 技能生成目录):2.x 的 `SkillEditor` 只收已解析的 `Skill.Info`,扫描与解析在上游 core
//     内部(`config/plugin/skill-scan.ts`、`skill-file.ts`),插件接口上没有「加一个技能目录」的挂点 —— 交编排器(见收工报告)。
//   · 项目命令模板只认 `$ARGUMENTS`;上游配置命令的 `$1…$N` 位置参数与 `` !`cmd` `` shell 插值属于上游
//     `opencode.config.command` 的文法,插件接口不给,ext 不另写一份(含 shell 的模板原文发出,并记一行日志)。项目命令的
//     `agent` / `model` 也不生效:插件提交消息的接口(`POST /api/session/:id/prompt` 的载荷)没有这两个字段;`subtask` 插件接口给不了,
//     `codepuppy_register` 已不收它(编排器裁决 2026-11-09,承受者 0)。

import type { Plugin } from "@opencode/plugin"
import type { AgentEditor } from "@opencode/plugin/promise/agent"
import type { CommandDefinition } from "@opencode/plugin/promise/command"
import type { MCPEditor } from "@opencode/plugin/promise/mcp"
import type { Mcp } from "@opencode/plugin"

const isObj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)

/** v1 形状的 MCP 条目 → 2.x `Mcp.ServerConfig`。只搬两边同名同义的字段;`enabled: false` ⇒ `disabled: true`。认不出 type ⇒ undefined。 */
export function toServerConfig(entry: unknown): Mcp.ServerConfig | undefined {
  if (!isObj(entry)) return undefined
  const disabled = entry.enabled === false ? { disabled: true } : {}
  const stringRecord = (value: unknown) =>
    isObj(value) && Object.values(value).every((item) => typeof item === "string") ? (value as Record<string, string>) : undefined
  if (entry.type === "local" && Array.isArray(entry.command) && entry.command.every((item) => typeof item === "string")) {
    const environment = stringRecord(entry.environment)
    return { type: "local", command: entry.command as string[], ...(environment ? { environment } : {}), ...disabled } as Mcp.ServerConfig
  }
  if (entry.type === "remote" && typeof entry.url === "string") {
    const headers = stringRecord(entry.headers)
    const oauth = entry.oauth === false ? { oauth: false as const } : isObj(entry.oauth) ? { oauth: entry.oauth } : {}
    return { type: "remote", url: entry.url, ...(headers ? { headers } : {}), ...oauth, ...disabled } as Mcp.ServerConfig
  }
  return undefined
}

/**
 * 项目文档里的 v1 MCP 条目 → 2.x `Mcp.ServerConfig`,照上游读用户文件时的同一套翻译(`packages/core/src/v1/config/migrate.ts`
 * `migrateMcp`,抄本 —— 那个模块顶层 import 引擎服务,不能打进 ext 的自包含 bundle;与装着的上游逐字段对比的判据在
 * engine-transforms.test.ts):在 `toServerConfig` 之上补 `cwd`、`codemode`、`enabled: true` ⇒ `disabled: false`;v1 的单个
 * `timeout` 毫秒数管三个阶段;OAuth 的驼峰字段换成 2.x 运行时读的下划线字段(`core/src/mcp/oauth.ts`)。
 * 云 MCP 不走这里:它的定义由 main 按 2.x 形状写好,装进去后要与定义逐字相等才铸 `codepuppy-cloud`(`toServerConfig`)。
 */
export function projectServerConfig(entry: unknown): Mcp.ServerConfig | undefined {
  const base = toServerConfig(entry)
  if (!base || !isObj(entry)) return base
  return {
    ...base,
    ...(base.type === "local" && typeof entry.cwd === "string" ? { cwd: entry.cwd } : {}),
    ...(base.type === "remote" ? oauthOf(entry.oauth) : {}),
    ...(entry.enabled === true ? { disabled: false } : {}),
    ...(typeof entry.codemode === "boolean" ? { codemode: entry.codemode } : {}),
    ...(typeof entry.timeout === "number" ? { timeout: { startup: entry.timeout, catalog: entry.timeout, execution: entry.timeout } } : {}),
  } as Mcp.ServerConfig
}

/** v1 OAuth(驼峰)→ 2.x(下划线);`false` 原样;只搬给了的字段。 */
function oauthOf(oauth: unknown) {
  if (oauth === false) return { oauth: false as const }
  if (!isObj(oauth)) return {}
  const fields: Array<[string, string]> = [
    ["clientId", "client_id"],
    ["clientSecret", "client_secret"],
    ["scope", "scope"],
    ["callbackPort", "callback_port"],
    ["redirectUri", "redirect_uri"],
  ]
  return { oauth: Object.fromEntries(fields.filter(([from]) => oauth[from] !== undefined).map(([from, to]) => [to, oauth[from]])) }
}

/** 项目 MCP 只补缺:引擎里已有同名条目(用户全局配置)就不动它。返回补进去的名字。 */
export function applyProjectMcp(editor: MCPEditor, servers: unknown, error: (line: string) => void): string[] {
  if (!isObj(servers)) return []
  const added: string[] = []
  for (const [name, entry] of Object.entries(servers)) {
    if (editor.get(name)) continue
    const config = projectServerConfig(entry)
    if (!config) {
      error(`[@codepuppy/ext] project MCP server "${name}" skipped: neither a local (command[]) nor a remote (url) definition`)
      continue
    }
    editor.set(name, config)
    added.push(name)
  }
  return added
}

/**
 * OpenCode 2 退役的 provider id → 现在的 id。上游读用户配置时对 agent / 命令 / 顶层 model 做同样的改名(`packages/core/src/v1/config/migrate.ts`
 * `providerID`,抄本 —— 那个模块顶层 import 引擎服务,不能打进 ext 的自包含 bundle;与上游函数的漂移锁在 engine-transforms.test.ts)。
 */
export const RETIRED_PROVIDER_IDS: Readonly<Record<string, string>> = {
  "azure-cognitive-services": "azure",
  "google-vertex-anthropic": "google-vertex",
}

/** `"<providerID>/<modelID>"` → 2.x `Model.Ref`(退役的 provider id 按引擎的规则改名);不是这个形状 ⇒ undefined。 */
function modelRef(value: unknown) {
  if (typeof value !== "string") return undefined
  const slash = value.indexOf("/")
  if (slash <= 0 || slash === value.length - 1) return undefined
  const providerID = value.slice(0, slash)
  return { providerID: RETIRED_PROVIDER_IDS[providerID] ?? providerID, id: value.slice(slash + 1) }
}

/**
 * v1 permission 的键 → 2.x 的权限动作(上游读用户配置时同样改名:`packages/core/src/v1/config/migrate.ts` `normalizeAction`,抄本 ——
 * 那个模块顶层 import 引擎服务,不能打进 ext 的自包含 bundle;与上游归一化逐条对比的判据在 engine-transforms.test.ts)。
 */
function permissionAction(key: string) {
  if (key === "write" || key === "patch" || key === "apply_patch") return "edit"
  if (key === "task") return "subagent"
  if (key === "bash") return "shell"
  return key
}

const PERMISSION_EFFECTS = new Set(["ask", "allow", "deny"])
const isEffect = (value: unknown) => typeof value === "string" && PERMISSION_EFFECTS.has(value)
/** 上游只收单个动作值的键(`core/src/v1/config/permission.ts` `actionOnly`)。 */
const ACTION_ONLY_KEYS = new Set(["question", "websearch", "doom_loop"])

/**
 * 条目里给了的 `tools` / `permission` 是不是上游 v1 agent schema 不收的形状(`core/src/v1/config/agent.ts` 与 `permission.ts`,抄本;
 * 与上游逐个形状对比的判据在 engine-transforms.test.ts)。`tools` 要每个值都是布尔的对象;`permission` 要一个动作值,或一个对象 ——
 * 每个值是动作值,或是每个值都是动作值的对象(`ACTION_ONLY_KEYS` 只收动作值)。
 */
function malformedRules(entry: Record<string, unknown>) {
  if (entry.tools !== undefined && !(isObj(entry.tools) && Object.values(entry.tools).every((enabled) => typeof enabled === "boolean"))) return true
  if (entry.permission === undefined || isEffect(entry.permission)) return false
  return !(
    isObj(entry.permission) &&
    Object.entries(entry.permission).every(([key, rule]) => isEffect(rule) || (!ACTION_ONLY_KEYS.has(key) && isObj(rule) && Object.values(rule).every(isEffect)))
  )
}

/**
 * v1 的 agent `tools`(已弃用的「工具 → true / false」)与 `permission`(一个动作值,或「键 → 动作值 / 模式 → 动作值」的对象)→ 2.x 规则。
 * 先照上游读 v1 agent 时的合并(`core/src/v1/config/agent.ts` `normalize`,抄本 —— 它没有导出,只能经那里的 effect Schema 解码得到,
 * 而 ext 的生产代码不 import effect 与 core;与上游归一化逐条对比的判据在 engine-transforms.test.ts)合成一张「键 → 规则」表:`tools` 先写,true ⇒ allow、false ⇒ deny,`write` / `patch` 并成 `edit`;
 * `permission` 后写,同键时盖掉 `tools` 那条,位置仍在 `tools` 写下的地方(Map 同键 set 不挪位置,与上游同一个做法)。
 * 再按表的顺序翻成规则(规则后写者胜;上游同样按 `Object.entries` 保序,`core/src/v1/config/permission.ts`)。
 * 写坏的 `tools` / `permission` 到不了这里(`malformedRules`,`applyAgents` 整条不装)。
 */
function permissionRules(tools: unknown, permission: unknown) {
  const toolEntries = isObj(tools)
    ? Object.entries(tools).map(([tool, enabled]) => [tool === "write" || tool === "patch" ? "edit" : tool, enabled ? "allow" : "deny"] as const)
    : []
  const source = typeof permission === "string" ? { "*": permission } : permission
  const table = new Map<string, unknown>([...toolEntries, ...(isObj(source) ? Object.entries(source) : [])])
  return [...table].flatMap(([key, rule]) => {
    const action = permissionAction(key)
    const pairs = typeof rule === "string" ? [["*", rule] as const] : isObj(rule) ? Object.entries(rule) : []
    return pairs.map(([resource, effect]) => ({ action, resource, effect }))
  })
}

/**
 * v1 形状的 agent 条目 → `AgentEditor.update`。`prompt` 是 2.x 的 `system`。只写条目里**给了**的字段。
 * `permission` 照 0.1.26 生效,`tools` 照上游换成同一串规则(#1693):翻成规则推在该 agent 已有规则之后;两者只在项目已同意时还在 ——
 * 没同意时 `mergeProjectConfig` 已剥掉 `permission/tools/model/disable/mode`(REQ-236 P1)。
 * `tools` 或 `permission` 写成上游不收的形状(`malformedRules`)的条目整条不装:上游按 schema 校验整条 v1 agent(`core/src/v1/config/agent.ts`),
 * 不过就丢掉这一条、别的 agent 照常(`core/src/config/normalize.ts` `decodeMap`)—— 只装其余字段会让它比引擎读同一份文档时更宽(#1693 Codex R1/1)。
 * 新建的 agent(上游与配置里都没有)按 v1 config agent 的默认取 `mode: "all"`。
 */
export function applyAgents(editor: AgentEditor, agents: unknown): string[] {
  if (!isObj(agents)) return []
  const applied: string[] = []
  for (const [id, entry] of Object.entries(agents)) {
    if (!isObj(entry) || malformedRules(entry)) continue
    const existed = editor.get(id) !== undefined
    editor.update(id, (agent) => {
      if (!existed) agent.mode = "all"
      if (typeof entry.prompt === "string") agent.system = entry.prompt
      if (typeof entry.description === "string") agent.description = entry.description
      if (entry.mode === "subagent" || entry.mode === "primary" || entry.mode === "all") agent.mode = entry.mode
      const model = modelRef(entry.model)
      if (model) agent.model = model as typeof agent.model
      const rules = permissionRules(entry.tools, entry.permission)
      if (rules.length > 0) agent.permissions.push(...(rules as typeof agent.permissions))
    })
    applied.push(id)
  }
  return applied
}

const SHELL_INTERPOLATION = /!`[^`]+`/

/** 命令模板:`$ARGUMENTS` 换成用户在命令后敲的字;模板里没有 `$ARGUMENTS` 而用户敲了字 ⇒ 接在模板后面(与上游同一条规则)。 */
export function renderCommandTemplate(template: string, input: string): string {
  if (template.includes("$ARGUMENTS")) return template.replaceAll("$ARGUMENTS", input).trim()
  return input.trim() ? `${template}\n\n${input}`.trim() : template.trim()
}

/** v1 形状的 command 条目 → 2.x 的 `CommandDefinition`:执行 = 把渲染好的模板当一条用户消息发进本会话。 */
export function commandDefinitions(
  commands: unknown,
  session: Pick<Plugin.Context["session"], "prompt">,
  log: (line: string) => void,
): CommandDefinition[] {
  if (!isObj(commands)) return []
  const out: CommandDefinition[] = []
  for (const [name, entry] of Object.entries(commands)) {
    if (!isObj(entry) || typeof entry.template !== "string") continue
    const template = entry.template
    if (SHELL_INTERPOLATION.test(template))
      log(`[@codepuppy/ext] command "${name}": shell interpolation (!\`…\`) is not evaluated by Code Puppy commands — the template is sent as written`)
    out.push({
      name,
      ...(typeof entry.description === "string" ? { description: entry.description } : {}),
      execute: async (invocation) => {
        await session.prompt({
          ...invocation.prompt,
          sessionID: invocation.sessionID,
          text: renderCommandTemplate(template, invocation.prompt.text),
          delivery: invocation.delivery,
        })
      },
    })
  }
  return out
}
