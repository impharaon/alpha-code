// REQ-060 T2 `codepuppy_register` 纯逻辑:把一条项目级扩展条目登记进 `<proj>/.codepuppy/codepuppy.jsonc`。
// 模型不手改 config —— 校验(SAFE_NAME + 逐 type 字段白名单)与序列化都在这里,写坏面收敛;
// 消费方 = plugin.ts 的 codepuppy_register tool(读现文本 → applyRegister → 原子写 → 登记 reload)。
//
// type 语义:
//   mcp / agent / command → `codepuppy.jsonc` 对应命名域条目(同名 = 更新,创建流会迭代);
//   skill → 无 entry:确保 skills.paths 含 "./.codepuppy/skills"(相对路径,config hook 按项目根解析,
//            项目可移动)—— skill 本体是 `<proj>/.codepuppy/skills/<name>/SKILL.md` 文件,模型直接写盘;
//   plugin 不在此注册:`.codepuppy/plugins/*.js` 由 host fan-out 自动发现(必须自包含 ESM .js,ADR-006)。

import { parseProjectJsonc } from "../../ui-mac/src/shared/project-jsonc"
import { PROJECT_HIDDEN_DIR } from "../../ui-mac/src/shared/project-hidden-dir"

export const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

/** 逐 type 字段白名单(与 ui-mac ext-config 的 SAFE_MCP_FIELDS 语义对齐;agent/command 对齐上游 v1 config 常用字段)。
 *  `#1665`:command 不再收 `subtask` —— 2.x 下项目命令由 ext 经插件 CommandEditor 注册,子任务语义插件接口给不了(编排器裁决 2026-11-09)。 */
const ENTRY_FIELDS: Record<"mcp" | "agent" | "command", Set<string>> = {
  mcp: new Set(["type", "command", "args", "url", "environment", "headers", "enabled", "disabled", "cwd"]),
  agent: new Set(["description", "prompt", "mode", "model", "temperature", "top_p", "permission", "hidden", "disable", "tools", "color"]),
  command: new Set(["template", "description", "agent", "model"]),
}

export type RegisterType = "mcp" | "agent" | "command" | "skill"

export type RegisterResult =
  | { ok: true; next: string; summary: string }
  | { ok: false; reason: string }

export function applyRegister(
  jsoncText: string | null | undefined,
  type: RegisterType,
  name: string,
  entry: Record<string, unknown> | undefined,
): RegisterResult {
  let cfg: Record<string, unknown> = {}
  if (jsoncText && jsoncText.trim()) {
    const read = parseProjectJsonc(jsoncText)
    // 现文件坏 → 拒绝写(覆盖坏文件可能吞用户内容;loud 让人修)
    if (!read.ok) return { ok: false, reason: `existing ${PROJECT_HIDDEN_DIR}/codepuppy.jsonc is invalid JSONC — fix it manually first` }
    const parsed = read.value
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "existing codepuppy.jsonc is not an object" }
    cfg = parsed as Record<string, unknown>
  }

  if (type === "skill") {
    const skills = isObj(cfg.skills) ? { ...(cfg.skills as Record<string, unknown>) } : {}
    const paths = Array.isArray(skills.paths) ? [...(skills.paths as unknown[])] : []
    if (!paths.includes(`./${PROJECT_HIDDEN_DIR}/skills`)) paths.push(`./${PROJECT_HIDDEN_DIR}/skills`)
    skills.paths = paths
    cfg.skills = skills
    return { ok: true, next: serialize(cfg), summary: `skills path registered (./${PROJECT_HIDDEN_DIR}/skills); put the skill at ${PROJECT_HIDDEN_DIR}/skills/<name>/SKILL.md` }
  }

  if (!SAFE_NAME.test(name)) return { ok: false, reason: `invalid name: ${JSON.stringify(name)} (allowed: ${SAFE_NAME})` }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { ok: false, reason: `entry must be a JSON object for type=${type}` }
  const allowed = ENTRY_FIELDS[type]
  for (const key of Object.keys(entry)) {
    if (!allowed.has(key)) return { ok: false, reason: `field not allowed for ${type}: ${key} (allowed: ${[...allowed].join(", ")})` }
  }

  const domain = isObj(cfg[type]) ? { ...(cfg[type] as Record<string, unknown>) } : {}
  const existed = name in domain
  domain[name] = entry
  cfg[type] = domain
  return { ok: true, next: serialize(cfg), summary: `${type} "${name}" ${existed ? "updated" : "registered"} in ${PROJECT_HIDDEN_DIR}/codepuppy.jsonc` }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** 序列化(注:JSONC 注释不保留 —— 项目 codepuppy.jsonc 是 alpha 生成物,诚实边界记档)。 */
function serialize(cfg: Record<string, unknown>): string {
  return JSON.stringify(cfg, null, 2) + "\n"
}
