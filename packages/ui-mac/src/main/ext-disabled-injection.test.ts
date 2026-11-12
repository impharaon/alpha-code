// REQ-104 #395(r11 pivot 主权注入):disabled 的 mcp/agent 覆盖写进注入配置 —— 注入层压在全局与项目之上,
// disabled 扩展永不被引擎加载。真盘临时根,零 mock。
// `#1667`:OpenCode 2 形状。MCP 按名字整条替换(只写 `enabled:false` 叶子会被丢弃),所以写完整的中和条目;
// agent 写 `{ disabled: true }`;2.x 没有 v1 的 `mode` 键,那一面随之不再写。
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { injectDisabledOverrides } from "./ext-disabled-injection"
import { NEUTRALIZED_MCP_SERVER } from "./mcp-default-deny"
import { upsertRecordV2, type UpsertInput } from "./ext-receipt-v2"

let root: string
let saved: string | undefined
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ext-inject-"))
  saved = process.env.CODEPUPPY_GLOBAL_DIR
  process.env.CODEPUPPY_GLOBAL_DIR = root
})
afterEach(() => {
  if (saved === undefined) delete process.env.CODEPUPPY_GLOBAL_DIR
  else process.env.CODEPUPPY_GLOBAL_DIR = saved
  fs.rmSync(root, { recursive: true, force: true })
})
const record = (over: Partial<UpsertInput> & { name: string; kind: UpsertInput["kind"] }): void => {
  const w = upsertRecordV2(root, {
    id: `${over.kind}:${over.name}`,
    environment: "prod",
    scope: { kind: "global" },
    desiredState: "enabled",
    origin: "catalog",
    installedAt: "2026-07-18T00:00:00.000Z",
    ...over,
  })
  if (!w.ok) throw new Error(w.reason)
}

describe("injectDisabledOverrides（主权注入）", () => {
  test("disabled mcp → 注入完整的中和条目(disabled:true);disabled agent → {disabled:true}", () => {
    record({ name: "m", kind: "mcp", configKey: "mcp.m", desiredState: "disabled" })
    record({ name: "a", kind: "agent", configKey: "agent.a", desiredState: "disabled" })
    const config: { mcp?: { servers?: Record<string, unknown> }; agents?: Record<string, unknown> } = {}
    injectDisabledOverrides(config, { userDataPath: root, channel: "stable" })
    expect(config.mcp!.servers!.m).toEqual({ ...NEUTRALIZED_MCP_SERVER })
    expect(config.agents!.a).toEqual({ disabled: true })
  })

  test("已有同名条目 → MCP 整条换成中和条目(2.x 按名字整条替换,不存在「只盖一个字段」);agent 保留其余字段只加 disabled", () => {
    record({ name: "m", kind: "mcp", configKey: "mcp.m", desiredState: "disabled" })
    record({ name: "a", kind: "agent", configKey: "agent.a", desiredState: "disabled" })
    const config = {
      mcp: { servers: { m: { type: "local", command: ["x"] } } as Record<string, unknown> },
      agents: { a: { description: "kept" } } as Record<string, unknown>,
    }
    injectDisabledOverrides(config, { userDataPath: root, channel: "stable" })
    expect(config.mcp.servers.m).toEqual({ ...NEUTRALIZED_MCP_SERVER })
    expect(config.agents.a).toEqual({ description: "kept", disabled: true })
  })

  test("enabled 记录不注入;skill/plugin 不注入(无 mcp/agent 覆盖面)", () => {
    record({ name: "on", kind: "mcp", configKey: "mcp.on", desiredState: "enabled" })
    record({ name: "sk", kind: "skill", desiredState: "disabled" })
    record({ name: "pl", kind: "plugin", configKey: "plugin:@x/p@1", desiredState: "disabled" })
    const config: { mcp?: { servers?: Record<string, unknown> }; agents?: Record<string, unknown> } = {}
    injectDisabledOverrides(config, { userDataPath: root, channel: "stable" })
    expect(config.mcp).toBeUndefined()
    expect(config.agents).toBeUndefined()
  })

  test("project-scope disabled 记录不注入(全局面只管 global)", () => {
    record({
      name: "pm",
      kind: "mcp",
      configKey: "mcp.pm",
      desiredState: "disabled",
      scope: { kind: "project", projectPath: "/tmp/x", projectPathHash: "a".repeat(64) },
    })
    const config: { mcp?: { servers?: Record<string, unknown> } } = {}
    injectDisabledOverrides(config, { userDataPath: root, channel: "stable" })
    expect(config.mcp).toBeUndefined()
  })

  test("账本不可读 → 跳过不抛(best-effort;codepuppy.jsonc 投影仍在)", () => {
    fs.writeFileSync(path.join(root, "installs.json"), "corrupt")
    const config: { mcp?: { servers?: Record<string, unknown> } } = { mcp: { servers: { keep: { type: "local" } } } }
    expect(() => injectDisabledOverrides(config, { userDataPath: root, channel: "stable" })).not.toThrow()
    expect(config.mcp!.servers!.keep).toEqual({ type: "local" }) // 未破坏既有
  })
})

// ── Codex r12 B1 的 mode 面:2.x 没有 v1 的 `mode` 键(也就没有「mode 折叠回 agent 压掉 disable」那条路),注入面不再写它 ──
describe("injectDisabledOverrides r12 B1(2.x 无 mode 面)", () => {
  test("disabled agent → agents[name].disabled=true,配置里不出现 v1 的 mode 键", () => {
    upsertRecordV2(root, {
      id: "agent:w", name: "w", kind: "agent", environment: "prod", scope: { kind: "global" },
      desiredState: "disabled", origin: "catalog", configKey: "agent.w", installedAt: "2026-07-18T00:00:00.000Z",
    })
    const config: Record<string, unknown> & { agents?: Record<string, unknown> } = {}
    injectDisabledOverrides(config, { userDataPath: root, channel: "stable" })
    expect((config.agents!.w as Record<string, unknown>).disabled).toBe(true)
    expect(config.mode).toBeUndefined()
  })
})

// ── #397(必改①):session-grant 记录的持久投影强制 ──────────────────────────────────────────────
describe("#397 session-grant 强制(注入面)", () => {
  test("session-grant 记录 ledger enabled → 强制注入 disabled;未命中的 enabled 不注入", () => {
    record({ name: "labs", kind: "mcp", configKey: "mcp.labs", desiredState: "enabled" })
    record({ name: "free", kind: "mcp", configKey: "mcp.free", desiredState: "enabled" })
    record({ name: "la", kind: "agent", configKey: "agent.la", desiredState: "enabled" })
    const config: { mcp?: { servers?: Record<string, unknown> }; agents?: Record<string, unknown> } = {}
    injectDisabledOverrides(config, {
      userDataPath: root,
      channel: "stable",
      sessionGrantIds: () => ({ ok: true as const, ids: new Set(["mcp:labs", "agent:la"]) }),
    })
    expect(config.mcp!.servers!.labs).toEqual({ ...NEUTRALIZED_MCP_SERVER }) // 持久 enable 非法 → 注入面按 disabled
    expect(config.mcp!.servers!.free).toBeUndefined() // 非 session-grant 的 enabled 不受影响
    expect(config.agents!.la).toEqual({ disabled: true })
  })
})
