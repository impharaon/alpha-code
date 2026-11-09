// engine-transforms — `#1665`(清点表 C10 / L3r):v1 时代 ext 在整份 `config` 钩子里改 cfg;OpenCode 2 没有整份配置的钩子,
// 只有按域的 transform(`agent` / `mcp` / `command` / `skill` …,`packages/plugin/src/promise/*.ts`)。
//
// 做法:ext 仍然先在一份 **v1 形状**的小对象上算「Code Puppy 要往引擎里加什么」—— 项目 `.codepuppy/codepuppy.jsonc`
// 合并(信任门在 `mergeProjectConfig` 里)、出厂禁项(`applyFactoryDeny`)、提示词接管(`applyPromptTakeover`)都是既有的纯
// 函数、各有单测,形状不动;本模块只负责把那份对象**翻译**进 2.x 的编辑器。项目文件里写的就是这个 v1 形状(用户数据,
// `codepuppy_register` 也这样写),所以翻译是一次性的、按字段的,不解释上游的任何文法。
//
// 优先级靠 2.x 的插件激活顺序(`packages/core/src/plugin/internal.ts`:internal.pre → 按配置装载的插件 → internal.post):
//   · 上游内置的 agent(general / explore …)与命令(init / review)在 pre 里注册 ⇒ ext 的 transform 在它们之后跑,
//     alpha 出厂的接管盖过上游内置;
//   · 用户配置的 agents / commands 由 post 里的 `opencode.config.agent` / `opencode.config.command` 注册 ⇒ 在 ext 之后,
//     按字段合并 / 同名覆盖 —— 「用户治理 > alpha 出厂 > 上游内置」这条次序由结构保证;
//   · 用户配置的 MCP 由 pre 里的 `opencode.config.mcp` 写入 ⇒ ext 的 mcp.transform 看得到,项目 MCP 只补缺(全局优先)。
//
// 做不到的(写在这里,不假装):
//   · `skills.paths`(项目 / 出厂 / 技能生成目录):2.x 的 `SkillEditor` 只收已解析的 `Skill.Info`,扫描与解析在上游 core
//     内部(`config/plugin/skill-scan.ts`、`skill-file.ts`),插件接口上没有「加一个技能目录」的挂点 —— 交编排器(见收工报告)。
//   · 项目命令模板只认 `$ARGUMENTS`(alpha 自己的 init / review 模板也只用它);上游配置命令的 `$1…$N` 位置参数与
//     `` !`cmd` `` shell 插值属于上游 `opencode.config.command` 的文法,插件接口不给,ext 不另写一份(含 shell 的模板原文发出,
//     并记一行日志)。

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

/** 项目 MCP 只补缺:引擎里已有同名条目(用户全局配置)就不动它。返回补进去的名字。 */
export function applyProjectMcp(editor: MCPEditor, servers: unknown, error: (line: string) => void): string[] {
  if (!isObj(servers)) return []
  const added: string[] = []
  for (const [name, entry] of Object.entries(servers)) {
    if (editor.get(name)) continue
    const config = toServerConfig(entry)
    if (!config) {
      error(`[@codepuppy/ext] project MCP server "${name}" skipped: neither a local (command[]) nor a remote (url) definition`)
      continue
    }
    editor.set(name, config)
    added.push(name)
  }
  return added
}

/** `"<providerID>/<modelID>"` → 2.x `Model.Ref`;不是这个形状 ⇒ undefined。 */
function modelRef(value: unknown) {
  if (typeof value !== "string") return undefined
  const slash = value.indexOf("/")
  if (slash <= 0 || slash === value.length - 1) return undefined
  return { providerID: value.slice(0, slash), id: value.slice(slash + 1) }
}

/**
 * v1 形状的 agent 条目 → `AgentEditor.update`。`prompt` 是 2.x 的 `system`。只写条目里**给了**的字段;
 * `permission` / `tools` 一律不写(方案基线 §3.5:借配 agent 之名改审批面是禁止的;项目 agent 的控制字段由信任门剥离)。
 * 新建的 agent(上游与配置里都没有)按 v1 config agent 的默认取 `mode: "all"`。
 */
export function applyAgents(editor: AgentEditor, agents: unknown): string[] {
  if (!isObj(agents)) return []
  const applied: string[] = []
  for (const [id, entry] of Object.entries(agents)) {
    if (!isObj(entry)) continue
    const existed = editor.get(id) !== undefined
    editor.update(id, (agent) => {
      if (!existed) agent.mode = "all"
      if (typeof entry.prompt === "string") agent.system = entry.prompt
      if (typeof entry.description === "string") agent.description = entry.description
      if (entry.mode === "subagent" || entry.mode === "primary" || entry.mode === "all") agent.mode = entry.mode
      const model = modelRef(entry.model)
      if (model) agent.model = model as typeof agent.model
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
