// REQ-060 信任门(项目自带可执行扩展的 per-project consent)—— 纯核。
//
// 语义:项目 `.codepuppy/codepuppy.jsonc` 的 mcp、agent 的控制字段与 `.codepuppy/plugins/*.js` 是**可执行物**(打开陌生仓库即
// 在本机跑其代码、改写审批规则),@codepuppy/ext 的信任门只在用户于确认框里允许过时加载它们(project-config.ts
// readProjectExtensionsConsent)。决定记在 main 写、引擎写不到的 `<casBaseRoot>/project-trust/<env>.json`(`#1709`,
// project-trust-truth.ts),按规范项目目录 + inode 登记;项目目录里的任何文件都不算。本模块负责决定的语义(main 与 ext 共用
// 这一份)与可执行物清单派生;弹窗在 ext-ipc(B16/ADR-021 同款分层:纯核可单测,对话框在 IPC 层)。
//
// 决策(granted/denied)都落盘 —— 拒绝 = 该项目仅文本类(skill/agent 说明字段/command)生效,且不再重复弹。
// 版本化:告知内容实质变更时 bump EXTENSIONS_CONSENT_VERSION → 旧决策失效、重新弹。

import { WITHHELD_KINDS, type WithheldItem } from "@opencode/schema/codepuppy-project-config"
import { PROJECT_HIDDEN_DIR } from "../shared/project-hidden-dir"
import { parseProjectJsonc } from "../shared/project-jsonc"
import type { ProjectTrustEntry } from "./project-trust-truth"

export const EXTENSIONS_CONSENT_VERSION = 1

/** 已有当前版本的决策(granted 与 denied 都算)⟺ 不再弹。entry = 记录里这个项目(规范目录 + inode 对上)的条目。 */
export function hasExtensionsDecision(entry: ProjectTrustEntry | undefined): boolean {
  return entry?.version === EXTENSIONS_CONSENT_VERSION && typeof entry.granted === "boolean"
}

export function extensionsGranted(entry: ProjectTrustEntry | undefined): boolean {
  return entry?.version === EXTENSIONS_CONSENT_VERSION && entry.granted === true
}

/** agent 条目里受信任门管的字段:会改写权限 / 模型 / 执行预算(REQ-236 P1、#1693、#1700 BR-02a;
 *  `tools` 与 `permission` 同样翻成权限规则,`steps` / `maxSteps` 决定一个回答最多调几次模型)。
 *  ext 在未同意时剥掉它们(project-config.ts stripAgentControl),确认框把写了它们的 agent 列出来 —— 同一份清单。 */
export const AGENT_CONTROL_FIELDS = ["permission", "tools", "model", "disable", "mode", "steps", "maxSteps"] as const

export type ProjectExecutables = { mcp: string[]; plugins: string[]; agents: Array<{ name: string; fields: string[] }> }

/**
 * 从项目 codepuppy.jsonc 文本 + plugins 目录文件列表派生受信任门管的清单(供弹窗如实列明「同意会放开什么」):
 * mcp 名字、plugins 里的 .js(ADR-006)、写了控制字段的 agent 及其字段(`#1709` 审计:只写了控制字段的项目也要能被问到)。
 * jsonc 坏/缺 → mcp 与 agents 空(与 ext 侧 mergeProjectConfig 的诚实降级一致)。
 */
export function listProjectExecutables(jsoncText: string | null | undefined, pluginFiles: string[]): ProjectExecutables {
  let mcp: string[] = []
  const agents: ProjectExecutables["agents"] = []
  if (jsoncText) {
    // 项目文件坏 → 引擎侧也不会注入,无可执行物(同一个读法:shared/project-jsonc.ts)
    const read = parseProjectJsonc(jsoncText)
    const parsed = read.ok ? read.value : undefined
    if (isObj(parsed)) {
      if (isObj(parsed.mcp)) mcp = Object.keys(parsed.mcp)
      if (isObj(parsed.agent))
        for (const [name, entry] of Object.entries(parsed.agent)) {
          const fields = isObj(entry) ? AGENT_CONTROL_FIELDS.filter((field) => Object.hasOwn(entry, field)) : []
          if (fields.length) agents.push({ name, fields })
        }
    }
  }
  return { mcp, plugins: pluginFiles.filter((f) => f.endsWith(".js")), agents }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)


/** #1713 契约 E:引擎的暂缓条目与项目原生扩展合成九类清单,每类一行。 */
export function projectExecutableRows(exec: ProjectExecutables, withheld: readonly WithheldItem[]): string[] {
  const items: WithheldItem[] = [
    ...withheld,
    ...exec.mcp.map((name) => ({ kind: "mcp" as const, name, file: "" })),
    ...exec.plugins.map((name) => ({ kind: "plugin" as const, name: `${PROJECT_HIDDEN_DIR}/plugins/${name}`, file: "" })),
    ...exec.agents.map((agent) => ({ kind: "agent-control" as const, name: agent.name, fields: agent.fields, file: "" })),
  ]
  const labels = ["连接器(MCP)", "插件", "Agent 的权限与模型设置", "命令的运行设置", "文件开头的脚本", "写文件后自动运行的格式化程序", "终端与 shell 使用的程序", "模型的接入设置", "其他 OpenCode 设置"]
  return WITHHELD_KINDS.flatMap((kind, index) => {
    const entries = new Map<string, string[]>()
    for (const item of items.filter((item) => item.kind === kind)) entries.set(item.name, [...new Set([...(entries.get(item.name) ?? []), ...(item.fields ?? [])])])
    // 批准的完整示例中 references 在 experimental 前;其他键保持引擎视图给出的顺序。
    if (kind === "setting" && entries.has("experimental")) {
      const fields = entries.get("experimental")!
      entries.delete("experimental")
      entries.set("experimental", fields)
    }
    const names = [...entries].map(([name, fields]) => {
      if (kind === "command-run") {
        const mapped = new Set<string>(fields.map((field) => field === "shell" ? "运行程序" : field === "agent" ? "指定 Agent" : field === "subagent" || field === "subtask" ? "子任务" : "模型"))
        return `/${name}(${["运行程序", "指定 Agent", "模型", "子任务"].filter((label) => mapped.has(label)).join("、")})`
      }
      if (kind === "agent-control") {
        const mapped = fields.map((field) => ["permission", "permissions", "tools"].includes(field) ? "权限" : field === "mode" ? "模式" : ["steps", "maxSteps"].includes(field) ? "步数" : ["disable", "disabled"].includes(field) ? "停用" : "模型")
        return `${name}(${[...new Set(mapped)].join("、")})`
      }
      return name
    })
    return names.length ? [`· ${labels[index]}:${names.join("、")}`] : []
  })
}
