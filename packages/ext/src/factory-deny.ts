// factory-deny — REQ-067(用户拍板 2026-07-08,与 REQ-065 修订同一口径):上游默认禁项**零明文**。
//
// customize-opencode 这类「上游自带、alpha 出厂即禁」的技能,禁用是产品内置行为,不该以
// `permission.skill.<n>: "deny"` 明文出现在用户配置(`<current-environment-root>/codepuppy.jsonc`)里 —— 用户配置只放
// 用户自己的东西。名单是常量(#1522 customize-opencode 永久禁用),`#1698`(design §10 R7)起就住在这里、main import 它,
// 不再经任何通道(此前经 `CODEPUPPY_FACTORY_DENY_SKILLS` 过河,通道缺席或写坏时名单变空 —— 失效即放开,已删)。本模块
// 内存注入:
//   - `permission.skill.<n> = "deny"`(弃用技能覆盖用户配置,其余 set-if-absent);
//   - 同名占位 command(弃用技能强制指路 /customize-codepuppy,其余 set-if-absent)。
// 斜杠菜单的隐藏由 renderer 读 gov-read 的 factoryDenied 完成(REQ-066 过滤同源)。
//
// REQ-157 `#1284`:占位 command 的 description / template 是 alpha 的字、会进模型上下文(template 在用户
// 敲到该 command 时成为用户回合),所以文字本体与上限住在 context-injection.ts;这里只取用。渲染结果
// 超限由 renderTemplate 抛出(不裁剪),plugin.ts 的 config hook 外层 catch 会 loud 记录并 fail-closed。

import { contextText, renderTemplate } from "./context-injection"

/** 上游自带、Code Puppy 出厂即禁的技能(#1522:customize-opencode 永久禁用)。main(codepuppy-builtin-policy.ts)import 同一份。 */
export const FACTORY_DENIED_SKILLS = ["customize-opencode"] as const

export function applyFactoryDeny(cfg: Record<string, unknown>, names: readonly string[] = FACTORY_DENIED_SKILLS): string[] {
  if (names.length === 0) return []

  const permission =
    cfg.permission && typeof cfg.permission === "object" && !Array.isArray(cfg.permission)
      ? (cfg.permission as Record<string, unknown>)
      : ((cfg.permission = {}) as Record<string, unknown>)
  const skill =
    permission.skill && typeof permission.skill === "object" && !Array.isArray(permission.skill)
      ? (permission.skill as Record<string, unknown>)
      : ((permission.skill = {}) as Record<string, unknown>)
  const command =
    cfg.command && typeof cfg.command === "object" && !Array.isArray(cfg.command)
      ? (cfg.command as Record<string, unknown>)
      : ((cfg.command = {}) as Record<string, unknown>)

  const applied: string[] = []
  for (const n of names) {
    if (typeof n !== "string" || !n) continue
    // #1522:删后追加,确保旧同名 allow 或后置通配 allow 都不能覆盖永久 deny。
    if (n === "customize-opencode") delete skill[n]
    if (!(n in skill)) {
      skill[n] = "deny"
      applied.push(n)
    }
    if (n === "customize-opencode" || !(n in command)) {
      command[n] = {
        description: contextText("command.factory-denied.description"),
        template: renderTemplate("command.factory-denied.template", { name: n }),
      }
    }
  }
  return applied
}

/** 出厂禁用的技能名(常量,不依赖任何环境)。`#1665`:2.x 下禁用由 skill.transform 拿掉 + permission.hook.evaluate 一律 deny 执行
 *  (不再写 `permission.skill`,2.x 没有整份配置的钩子)。 */
export function factoryDeniedSkills(): string[] {
  return [...FACTORY_DENIED_SKILLS]
}
