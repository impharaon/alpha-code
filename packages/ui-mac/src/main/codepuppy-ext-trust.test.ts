import { describe, expect, test } from "bun:test"
import { AGENT_CONTROL_FIELDS, EXTENSIONS_CONSENT_VERSION, extensionsGranted, hasExtensionsDecision, listProjectExecutables } from "./codepuppy-ext-trust"

// `#1709`:决定语义作用在信任记录(project-trust-truth.ts)里这个项目的条目上;项目 prefs 不再是输入。
describe("项目扩展信任的决策语义(REQ-060 信任门)", () => {
  const entry = (granted: boolean, version = EXTENSIONS_CONSENT_VERSION) => ({ ino: "7", version, granted, decidedAt: "2026-11-13T00:00:00Z" })

  test("没有条目 = 未决策", () => {
    expect(hasExtensionsDecision(undefined)).toBe(false)
    expect(extensionsGranted(undefined)).toBe(false)
  })

  test("granted 与 denied 都是决策(不再弹);granted 语义分离", () => {
    expect(hasExtensionsDecision(entry(true))).toBe(true)
    expect(hasExtensionsDecision(entry(false))).toBe(true)
    expect(extensionsGranted(entry(true))).toBe(true)
    expect(extensionsGranted(entry(false))).toBe(false)
  })

  test("旧版本决策失效(版本化重弹),同意也不算", () => {
    expect(hasExtensionsDecision(entry(true, EXTENSIONS_CONSENT_VERSION - 1))).toBe(false)
    expect(extensionsGranted(entry(true, EXTENSIONS_CONSENT_VERSION - 1))).toBe(false)
  })
})

describe("listProjectExecutables — 可执行物清单派生", () => {
  test("jsonc mcp 键名 + plugins 只认 .js(ADR-006)", () => {
    const jsonc = `{
      // 项目连接器
      "mcp": { "projdb": { "type": "local", "command": ["npx", "x"] }, "projfetch": {} },
      "agent": { "a": {} },
    }`
    const r = listProjectExecutables(jsonc, ["p.js", "raw.ts", "note.md"])
    expect(r.mcp.sort()).toEqual(["projdb", "projfetch"])
    expect(r.plugins).toEqual(["p.js"])
  })

  test("#1662:与 ext 同一个读法(shared/project-jsonc.ts)—— 名字里的 `,}` 原样列出,不被尾逗号处理改掉", () => {
    expect(listProjectExecutables(`{ "mcp": { "srv,}": { "type": "local", "command": ["x"] }, }, }`, []).mcp).toEqual(["srv,}"])
  })

  test("jsonc 坏/缺 → mcp 空(诚实降级,与 ext 侧一致)", () => {
    expect(listProjectExecutables("{ bad", ["p.js"]).mcp).toEqual([])
    expect(listProjectExecutables(null, []).mcp).toEqual([])
  })

  test("文本类域(agent 的说明字段/command/skills)不进可执行清单", () => {
    const r = listProjectExecutables(`{ "agent": { "a": {}, "b": { "prompt": "p", "description": "d" } }, "command": { "c": {} }, "skills": { "paths": ["x"] } }`, [])
    expect(r).toEqual({ mcp: [], plugins: [], agents: [] })
  })

  test("`#1709` 审计:写了控制字段的 agent 进清单,字段按固定顺序列出(与 ext 剥掉的是同一份 AGENT_CONTROL_FIELDS);值是什么都算", () => {
    const r = listProjectExecutables(
      `{ "agent": { "rev": { "prompt": "p", "model": "x/y", "permission": { "edit": "allow" } }, "quiet": { "disable": false }, "text": { "prompt": "p" }, "odd": "not an object" } }`,
      [],
    )
    expect(r.agents).toEqual([
      { name: "rev", fields: ["permission", "model"] },
      { name: "quiet", fields: ["disable"] },
    ])
    expect(AGENT_CONTROL_FIELDS).toEqual(["permission", "tools", "model", "disable", "mode"])
  })
})
