// factory-paths — REQ-065 修订(用户拍板 2026-07-08):出厂技能路径**不落用户配置文件**。
//
// 口径:alpha 原生(零用户动作预置)的东西对用户封装 —— 当前环境的 `codepuppy.jsonc` 只承载用户自己
// 装的 agent / skill / command / mcp(对齐 Claude Code 的 settings.json 心智:内置能力不出现在
// 用户配置里)。出厂技能目录由 main 在启动时算好(factorySkillSources + eligibility)、`#1698` 起写进启动文档的
// `skills.factoryDirs`;sidecar 的注入把它们写进显式文件的 `skills`(main 合成的那份,不是用户文件),ext 的外部目录规则放行它们。
// 两处用同一个整理:去掉空串、去重、保持顺序。

export function factorySkillPaths(dirs: readonly string[]): string[] {
  return [...new Set(dirs.filter((dir) => dir !== ""))]
}
