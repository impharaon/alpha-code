// #1662 项目配置线:ext 把项目 `.codepuppy/codepuppy.jsonc`(v1 形状)翻进 2.x 编辑器的那几处翻译,必须与引擎读同一份 v1 文档时得到的
// 定义一致。判官是**装着的上游**:`ConfigNormalize.normalize`(引擎读用户配置文件那条路,`packages/core/src/config.ts` parseInfo)。
// ext 里的翻译是上游 `core/src/v1/config/migrate.ts` 三个小函数的抄本(那个模块顶层 import 引擎服务,不能打进 ext 的 bundle);
// 上游一改,这里逐字段对比就红。
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ConfigNormalize } from "../../core/src/config/normalize.ts"
import { ConfigMigrateV1 } from "../../core/src/v1/config/migrate.ts"
import { Permission } from "../../core/src/permission.ts"
import { applyAgents, projectServerConfig, RETIRED_PROVIDER_IDS } from "./engine-transforms"

/** `applyAgents` 写进编辑器的结果(编辑器按 2.x `AgentEditor` 的 get / update 形状;新 agent 从空对象起)。 */
function agentsAfter(entries: Record<string, unknown>) {
  const agents = new Map<string, Record<string, any>>()
  applyAgents(
    {
      get: (id: string) => agents.get(id),
      update: (id: string, fn: (agent: Record<string, any>) => void) => {
        const agent = agents.get(id) ?? { permissions: [] }
        fn(agent)
        agents.set(id, agent)
      },
    } as never,
    entries,
  )
  return agents
}

/** 引擎读这份 v1 文档后得到的配置(诊断为空才算读通)。 */
function normalized(document: Record<string, unknown>) {
  const result = ConfigNormalize.normalize(document)
  expect(result.diagnostics).toEqual([])
  if (result.type !== "normalized") throw new Error("the engine rejected the document")
  return result.encoded as Record<string, any>
}

describe("项目 MCP 条目 = 引擎读同一条 v1 条目的结果", () => {
  const entries: Record<string, Record<string, unknown>> = {
    local: { type: "local", command: ["npx", "-y", "srv"], cwd: "/w", environment: { A: "1" }, enabled: false, codemode: false, timeout: 9000 },
    remote: {
      type: "remote",
      url: "https://mcp.example/sse",
      headers: { "X-Key": "k" },
      oauth: { clientId: "id", clientSecret: "secret", scope: "read", callbackPort: 19877, redirectUri: "http://127.0.0.1:19877/cb" },
      enabled: true,
      timeout: 4000,
    },
    remoteNoOAuth: { type: "remote", url: "https://mcp.example/plain", oauth: false },
  }
  for (const [name, entry] of Object.entries(entries))
    test(`${name}:cwd / timeout / codemode / enabled / OAuth 与上游归一化逐字段相同`, () => {
      expect(projectServerConfig(entry)).toEqual(normalized({ mcp: { s: entry } }).mcp.servers.s)
    })
})

describe("项目 agent 的模型:退役 provider id 按引擎的规则改名", () => {
  const entries = {
    azure: { prompt: "a", model: "azure-cognitive-services/gpt-x" },
    vertex: { prompt: "v", model: "google-vertex-anthropic/claude-y" },
    plain: { prompt: "p", model: "openai/gpt-z" },
  }
  test("每个 agent 的 provider 与上游归一化的 model.providerID 相同,模型名不变", () => {
    const engine = normalized({ agent: entries }).agents
    const ours = agentsAfter(entries)
    for (const name of Object.keys(entries)) {
      expect([name, ours.get(name)?.model?.providerID]).toEqual([name, engine[name].model.providerID])
      expect([name, ours.get(name)?.model?.id]).toEqual([name, engine[name].model.model])
    }
    expect(ours.get("azure")?.model?.providerID).toBe("azure")
  })

  test("漂移锁:抄本的改名表 = 上游 providerID 函数里会改名的全部 id(从上游源码取字面量,再用上游函数判)", () => {
    const source = readFileSync(join(import.meta.dir, "../../core/src/v1/config/migrate.ts"), "utf8")
    const body = source.match(/export function providerID\(input: string\) \{([\s\S]*?)\n\}/)?.[1]
    expect(body, "upstream providerID moved — re-read core/src/v1/config/migrate.ts").toBeDefined()
    const literals = [...body!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!)
    expect(literals.length).toBeGreaterThan(0)
    const upstream = Object.fromEntries(literals.filter((id) => ConfigMigrateV1.providerID(id) !== id).map((id) => [id, ConfigMigrateV1.providerID(id)]))
    expect(RETIRED_PROVIDER_IDS).toEqual(upstream)
  })
})

describe("项目 agent 的权限规则 = 引擎读同一条 v1 agent 的规则", () => {
  // 出厂技能 agent-creator 指导模型登记的「只读助手」(packages/ui-mac/resources/factory-skills/agent-creator/SKILL.md 第 40 行)
  const reader = {
    description: "reads",
    mode: "subagent",
    prompt: "read only",
    permission: { edit: "deny", bash: "deny", read: { "*": "allow", "*.env*": "deny" } },
  }
  test("agent-creator 的样本:规则逐条相同(bash ⇒ shell、read 的两条模式规则、书写顺序)", () => {
    expect(agentsAfter({ reader }).get("reader")?.permissions).toEqual(normalized({ agent: { reader } }).agents.reader.permissions)
  })
  test("一个动作值 ⇒ 对所有动作的一条规则;task / write / patch 照上游改名", () => {
    const entries = { a: { permission: "ask" }, b: { permission: { task: "deny", write: "ask", patch: "deny", apply_patch: "allow" } } }
    const engine = normalized({ agent: entries }).agents
    const ours = agentsAfter(entries)
    expect(ours.get("a")?.permissions).toEqual(engine.a.permissions)
    expect(ours.get("b")?.permissions).toEqual(engine.b.permissions)
  })
})

describe("项目 agent 的 tools(#1693)= 引擎读同一条 v1 agent 的规则", () => {
  test("AC-04 · 键名改写与先后顺序与上游归一化逐条相同(write / patch 先并成 edit、apply_patch 另占一键;bash ⇒ shell、task ⇒ subagent;通配键原样;permission 同键盖掉 tools、位置不动)", () => {
    const entries = {
      toolsOnly: { tools: { read: true, write: false, bash: false, task: false, patch: true, apply_patch: false, "mymcp_*": false, edit: true } },
      mixed: { tools: { bash: false, edit: false, webfetch: false }, permission: { edit: "ask", bash: { "git *": "allow" }, write: "allow", read: "deny" } },
    }
    const engine = normalized({ agent: entries }).agents
    const ours = agentsAfter(entries)
    expect(ours.get("toolsOnly")?.permissions).toEqual(engine.toolsOnly.permissions)
    expect(ours.get("mixed")?.permissions).toEqual(engine.mixed.permissions)
  })
  test("AC-02 · tools: {bash: false} 与允许 bash 的 permission 同写 ⇒ 以 permission 为准,命令可执行(上游的权限求值);只写 tools ⇒ 被拒", () => {
    const entries = { both: { tools: { bash: false }, permission: { bash: "allow" } }, toolsOnly: { tools: { bash: false } } }
    const ours = agentsAfter(entries)
    expect(ours.get("both")?.permissions).toEqual(normalized({ agent: entries }).agents.both.permissions)
    expect(Permission.evaluate("shell", "ls -la", ours.get("both")?.permissions ?? []).effect).toBe("allow")
    expect(Permission.evaluate("shell", "ls -la", ours.get("toolsOnly")?.permissions ?? []).effect).toBe("deny")
  })
})
