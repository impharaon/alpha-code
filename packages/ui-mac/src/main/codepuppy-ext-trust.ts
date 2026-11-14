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

