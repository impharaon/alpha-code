import { Schema } from "effect"

/** 自动化载体和档位的唯一权威。 */
export const AUTOMATION_PROFILES = {
  "codepuppy-automation": "readonly",
  "codepuppy-automation-standard": "standard",
} as const satisfies Record<string, "readonly" | "standard">
export type AutomationAgentID = keyof typeof AUTOMATION_PROFILES
export type UnattendedProfile = (typeof AUTOMATION_PROFILES)[AutomationAgentID] | "none"

export const UNATTENDED_DENIAL_KEY = "codepuppyUnattendedDenial"
export const UnattendedDenial = Schema.Struct({
  version: Schema.Literal(1),
  reason: Schema.Literals(["needs-confirmation", "readonly", "refused"]),
  tool: Schema.String,
  message: Schema.String,
})
export type UnattendedDenial = typeof UnattendedDenial.Type

/** 规格 v2「体验约定」的文案只在此定义。 */
export function unattendedDenialCopy(reason: UnattendedDenial["reason"], tool: string): string {
  if (reason === "readonly") return `这个任务是只读档,不能使用「${tool}」。`
  if (reason === "refused") return `自动化任务不能使用「${tool}」做这一步。`
  return `「${tool}」需要你先确认(它的来源发生了变化或已被停用),自动化任务运行时没有人可以确认。到 设置 → 工具 处理后,下次运行即可使用。`
}
export const elicitationCopy = (connector: string) => `「${connector}」要补充信息,运行时没人能填。`
