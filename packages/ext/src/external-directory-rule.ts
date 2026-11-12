// REQ-236 §2.2 R2(`#1662` parity,编排器第四轮裁决):「全部批准」(引擎的 build)与「请求审批」(codepuppy-ask)读写工作区外的
// 目录先问,与 0.1.x 相同 —— 用户自己在 opencode 配置里写的 `external_directory` 规则仍能放宽它,只读档的拒绝放不开。
//
// v1 的引擎默认 agent 规则是 `external_directory: { "*": "ask", <白名单>: "allow" }`,排在用户配置之前(`origin/alpha` 的
// `packages/opencode/src/agent/agent.ts`:`merge(defaults, user)`)。OpenCode 2 的 agent 底座是 `"*": "allow"`(`Agent.Info.default`),
// 配置里的规则按「所有文档的顶层规则 → 各文档的 agent 规则」追加(`packages/core/src/config/plugin/agent.ts`),Code Puppy 能写的配置
// 层都排在用户的全局配置之后 —— 写在配置里就会压过用户。所以这条规则由 ext 的 agent 变换插在**底座之后、所有配置规则之前**:
// 之后的用户规则(任何一层、v1 或 2.x 写法)按「最后命中」胜出;只读档自己的 `external_directory: deny` 在它的 agent 规则里,仍在最后。
//
// 白名单与 v1 对应:引擎自己的工具输出目录(core `ToolOutput.DIRECTORY`,在引擎数据目录下)、引擎临时目录(解析过符号链接)、
// 出厂与已启用技能目录(变换每次重跑时现算,技能翻代后不必重新注入)。
import { realpathSync } from "node:fs"
import path from "node:path"
import { Agent } from "../../schema/src/agent"
import { Path } from "../../util/src/global"
import { injectFactorySkillPaths } from "./factory-paths"
import { skillGenerationLiveDirs } from "./gen-skill-paths"

/** 只这两档追加;只读档与自动化档自己就是 deny,别的 agent 维持引擎原样。 */
export const EXTERNAL_DIRECTORY_AGENTS = ["build", "codepuppy-ask"] as const

type Rule = { action: string; resource: string; effect: "allow" | "deny" | "ask" }

const real = (dir: string) => {
  try {
    return realpathSync(dir)
  } catch {
    return dir
  }
}

/** 这一刻的规则:先问,白名单放行。 */
export function externalDirectoryRules(env: Record<string, string | undefined>): Rule[] {
  const root = env.CODEPUPPY_GLOBAL_DIR
  const allowed = [
    path.join(Path.data, "tool-output"),
    path.join(real(Path.tmp)),
    ...injectFactorySkillPaths({}, env.CODEPUPPY_FACTORY_SKILL_DIRS),
    ...(root ? skillGenerationLiveDirs(real(root)) : []),
  ].filter((dir) => path.isAbsolute(dir))
  return [
    { action: "external_directory", resource: "*", effect: "ask" },
    ...[...new Set(allowed)].map((dir) => ({ action: "external_directory", resource: path.join(dir, "*"), effect: "allow" as const })),
  ]
}

const same = (left: Rule, right: Rule) => left.action === right.action && left.resource === right.resource && left.effect === right.effect

/**
 * 把规则插在这个 agent 的引擎底座(`Agent.Info.default(id).permissions`)之后。底座不是现有规则表的前缀(上游改了底座的形状)⇒
 * 追加在末尾并返回 false:仍然先问,只是用户规则放不宽它(宁可多问,不静默放行)。
 */
export function placeAfterBase(id: string, permissions: Rule[], rules: Rule[]): boolean {
  const base = Agent.Info.default(id as Agent.ID).permissions as readonly Rule[]
  const prefixed = base.every((rule, index) => permissions[index] !== undefined && same(rule, permissions[index]!))
  permissions.splice(prefixed ? base.length : permissions.length, 0, ...rules)
  return prefixed
}
