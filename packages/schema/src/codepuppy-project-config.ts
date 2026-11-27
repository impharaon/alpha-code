// Code Puppy 自有文件(basename `codepuppy-*`,ADR-043)。#1713:项目 OpenCode 配置按项目信任放行 —— 视图的形状。
//
// 闸门(packages/core/src/config/codepuppy-project-gate.ts)、sidecar 与主进程共用这一份;纯模块,零依赖
// (先例 codepuppy-tool-policy.ts)。形状照 DESIGN-project-engine-config-takeover 契约 D 逐字。

export const WITHHELD_KINDS = [
  "mcp", // mcp 条目
  "plugin", // plugins 新增 / options / 移除,.opencode/{plugin,plugins}/ 里的目标
  "agent-control", // agent 控制字段(含隐含生成的 mode: primary)
  "command-run", // 带 !`…` 的命令,或写了 agent / model / subagent / subtask 的命令
  "frontmatter-code", // 声明了非 YAML / JSON 语言的 md 文件头
  "formatter",
  "shell",
  "provider",
  "setting", // 其余暂缓的键:lsp、references、share、websearch……与允许名单之外的键
] as const
export type WithheldKind = (typeof WITHHELD_KINDS)[number]
export type WithheldItem = {
  kind: WithheldKind
  /** MCP / 格式化程序 / provider 名、命令名(不带 /)、agent 名、插件目标、shell 路径、文件路径、键名。从不放配置值。 */
  name: string
  /** 出处文件,相对于打开的文件夹;上级目录里的写成 ../… */
  file: string
  /** 只用于 agent-control 与 command-run:被暂缓的字段名;插值记作 "shell"。 */
  fields?: string[]
}
/** 一个作用点在本代配置下的状态。没有出现 = 这个作用点在本 Location 不适用(它的插件没有激活)。 */
export type GatePointState = "done" | "failed" | "pending"
export type ProjectConfigView = {
  /** realpath 后的项目文件夹(信任记录的键)。 */
  directory: string
  trusted: boolean
  /** 本代配置下已激活的作用点及其状态;配置装载一定在内。 */
  points: Partial<Record<"config" | "skill" | "agent" | "command", GatePointState>>
  /** 插件激活已经结束,且 points 里每一项都是 "done" ⇒ true。 */
  complete: boolean
  /** 未允许时被暂缓的条目,按 kind、file、name 排序去重;trusted 时为 []。 */
  withheld: WithheldItem[]
}

// ── DESIGN-local-plugin-install §4.6(D6)/ R-m:原生文件来源的绑定状态 ─────────────────────────────────────────────────
// 线上形状照 §4.6 的 sync 合同逐字;闸门(契约 C 的可选钩子)、sidecar、ext 的 hub bridge 与主进程共用这一份。
export type NativeFileKind = "skill" | "agent" | "command" | "mcp" | "plugin"
export type NativeFileRef = { file: string; kind: NativeFileKind; entry: string; target?: string }
export type NativeFileSource = NativeFileRef & { active: boolean }
export type NativeFileState = NativeFileRef & { desiredState: "enabled" | "disabled"; removed: boolean }
/** 契约 C 增量(R-m):一次装载把本代发现的来源交给 main,拿回绑定状态;取不到 ⇒ undefined(闸门沿用上一代)。 */
export type NativeSourceSync = (input: { directory: string; sources: NativeFileSource[] }) => Promise<readonly NativeFileState[] | undefined>
export const NATIVE_FILE_KINDS: readonly NativeFileKind[] = ["skill", "agent", "command", "mcp", "plugin"]
/** 一条绑定的身份:文件 + 种类 + 文件内入口 + 插件 target。 */
export function nativeFileKey(ref: NativeFileRef): string {
  return JSON.stringify([ref.file, ref.kind, ref.entry, ref.target ?? null])
}
/** 关闭或已移除 ⇒ 不加载。 */
export function nativeFileBlocked(state: NativeFileState | undefined): boolean {
  return state !== undefined && (state.removed || state.desiredState === "disabled")
}
