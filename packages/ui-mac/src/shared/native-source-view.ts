// D6 片 6b(DESIGN-local-plugin-install §4.6;界面依据 design/current/customization-center/design.html#hub-native):
// 定制中心本机文件条目的安全视图。身份与状态沿 §4.6 的 NativeFileState;其余是 main 算好的呈现事实。main 与 renderer 共用。
import type { NativeFileRef, NativeFileState } from "../../../schema/src/codepuppy-project-config"
import { PROJECT_HIDDEN_DIR } from "./project-hidden-dir"

export type NativeSourceScopeV1 = "global" | "project"
export type NativeSourceRowV1 = NativeFileState & {
  /** 全局目录 ⇒「已安装」与「我的所有项目」;项目及其上级目录 ⇒「本项目」与「仅当前项目」。 */
  scope: NativeSourceScopeV1
  /** 名称后的目录小字:家目录写「~」,项目里写相对项目的目录。完整文件路径就是 `file`。 */
  directoryLabel: string
  /** 引擎列表里这个条目的说明;本进程没见过它开着时缺席(界面写类型名)。 */
  description?: string
  /** 只在项目条目上:项目还没被允许 / 拒绝过(与项目连接器行同一份 #1709 记录)。 */
  consent?: "awaiting-consent" | "consent-denied"
  /** 动作后的重载还没完成 ⇒「正在生效」。 */
  applying: boolean
}
export type NativeSourceActionV1 = NativeFileRef & { action: "enable" | "disable" | "remove" | "rejoin" }
export type NativeSourceActionResultV1 = { ok: true } | { ok: false; reason: string }
/** 读不出账本时只过一个稳定原因码(路径只进 main 日志),不折叠成「没有条目」。 */
export type NativeSourceRowsResultV1 = { ok: true; rows: NativeSourceRowV1[] } | { ok: false; reason: "unreadable" }

const SOURCE_DIRECTORIES = new Set(["skill", "skills", "agent", "agents", "mode", "modes", "command", "commands", "plugin", "plugins"])

/** 文件所在的来源目录(`~/.config/opencode`、`~/.claude/skills`、`.opencode`…);配置文件里的条目取配置文件所在目录。 */
export function nativeSourceRoot(file: string): string {
  const parts = file.split("/")
  // 来源目录是配置根(点目录或 opencode)之后的第一个 skill(s)/agent(s)/… 段;技能自己叫 commands 也不会被误认。
  const base = parts.slice(0, -1).findLastIndex((part) => part.startsWith(".") || part === "opencode")
  const after = parts.slice(0, -1).findIndex((part, index) => index > base && SOURCE_DIRECTORIES.has(part))
  const at = base >= 0 && after >= 0 ? after : parts.slice(0, -1).findLastIndex((part) => SOURCE_DIRECTORIES.has(part))
  if (at < 0) return parts.slice(0, -1).join("/") || "/"
  const root = parts.slice(0, at).join("/") || "/"
  const parent = parts[at - 1]
  return parent === ".claude" || parent === ".agents" ? `${root}/skills` : root
}

export function nativeDirectoryLabel(file: string, input: { home: string; project?: string }): string {
  const root = nativeSourceRoot(file)
  const inside = (base: string) => root === base || root.startsWith(base.endsWith("/") ? base : base + "/")
  if (input.project && inside(input.project)) return root === input.project ? (file.split("/").at(-1) ?? root) : root.slice(input.project.length + 1)
  if (inside(input.home)) return root === input.home ? "~" : `~/${root.slice(input.home.length + 1)}`
  return root
}

/**
 * 项目条目:在打开的目录里,或在它某个上级目录(主目录本身除外)的 .opencode / .codepuppy / .claude / .agents 里,
 * 或就是那个上级目录的 opencode.json / opencode.jsonc(引擎向上遍历读到的文档,core config/discovery.ts)。
 */
export function nativeSourceScope(file: string, input: { home: string; project?: string }): NativeSourceScopeV1 {
  if (!input.project) return "global"
  if (file.startsWith(input.project + "/")) return "project"
  const parts = input.project.split("/")
  for (let length = parts.length - 1; length > 0; length--) {
    const ancestor = parts.slice(0, length).join("/") || "/"
    if (ancestor === input.home) break
    const prefix = ancestor === "/" ? "" : ancestor
    if ([".opencode", PROJECT_HIDDEN_DIR, ".claude", ".agents"].some((name) => file.startsWith(`${prefix}/${name}/`))) return "project"
    if (file === `${prefix}/opencode.json` || file === `${prefix}/opencode.jsonc`) return "project"
  }
  return "global"
}
