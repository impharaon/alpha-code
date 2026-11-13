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
import { agentSampling, applyAgents, projectServerConfig, RETIRED_PROVIDER_IDS } from "./engine-transforms"

/**
 * `applyAgents` 写进编辑器的结果(编辑器按 2.x `AgentEditor` 的 get / update / remove 形状;新 agent 从 `Agent.Info.default` 的
 * 那几样起:没有规则、空的 `request`)。`initial` 是编辑器里先有的 agent(上游内置)。
 */
function agentsAfter(entries: Record<string, unknown>, initial: Record<string, Record<string, any>> = {}) {
  const agents = new Map<string, Record<string, any>>(Object.entries(structuredClone(initial)))
  const logs: string[] = []
  applyAgents(
    {
      get: (id: string) => agents.get(id),
      update: (id: string, fn: (agent: Record<string, any>) => void) => {
        const agent = agents.get(id) ?? { permissions: [], request: { settings: {}, headers: {}, body: {} } }
        fn(agent)
        agents.set(id, agent)
      },
      remove: (id: string) => void agents.delete(id),
    } as never,
    entries,
    (line) => void logs.push(line),
  )
  return Object.assign(agents, { logs })
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

    // 写坏的 tools(值不全是布尔,Codex R1/1 的样本)与写坏的 permission(上游 v1 permission schema 不收的各种形状):上游整条丢掉那个 v1 agent
    // (每条一个 invalid 诊断,同一文档里别的 agent 照常);ext 同样整条不装。上游收的边界形状(空对象、空模式表、只收动作值的三个键、单个动作值)照常装。
    const malformed = {
      explore: { tools: { edit: true, read: "false" } },
      badValue: { permission: { edit: "allow", bash: "bogus" } },
      notAnAction: { permission: "bogus" },
      array: { permission: ["allow"] },
      nul: { permission: null },
      arrayValue: { permission: { bash: ["allow"] } },
      nullValue: { permission: { bash: null } },
      badPattern: { permission: { bash: { "git *": "bogus" } } },
      actionOnlyPatterns: { permission: { question: { "*": "allow" } } },
    }
    const accepted = {
      ok: { tools: { edit: false } },
      single: { permission: "allow" },
      empty: { permission: {} },
      emptyPatterns: { permission: { bash: {} } },
      actionOnly: { permission: { question: "allow", websearch: "deny", doom_loop: "ask" } },
    }
    const result = ConfigNormalize.normalize({ agent: { ...malformed, ...accepted } })
    expect(result.diagnostics).toEqual(Object.keys(malformed).map((name) => ({ kind: "invalid", path: ["agent", name], message: expect.any(String) })))
    if (result.type !== "normalized") throw new Error("the engine rejected the whole document")
    const engineAgents = result.encoded.agents as Record<string, any>
    const oursWithMalformed = agentsAfter({ ...malformed, ...accepted })
    expect([...oursWithMalformed.keys()]).toEqual(Object.keys(engineAgents))
    for (const name of Object.keys(accepted)) expect([name, oursWithMalformed.get(name)?.permissions]).toEqual([name, engineAgents[name].permissions ?? []])
  })
  test("AC-02 · tools: {bash: false} 与允许 bash 的 permission 同写 ⇒ 以 permission 为准,命令可执行(上游的权限求值);只写 tools ⇒ 被拒", () => {
    const entries = { both: { tools: { bash: false }, permission: { bash: "allow" } }, toolsOnly: { tools: { bash: false } } }
    const ours = agentsAfter(entries)
    expect(ours.get("both")?.permissions).toEqual(normalized({ agent: entries }).agents.both.permissions)
    expect(Permission.evaluate("shell", "ls -la", ours.get("both")?.permissions ?? []).effect).toBe("allow")
    expect(Permission.evaluate("shell", "ls -la", ours.get("toolsOnly")?.permissions ?? []).effect).toBe("deny")
  })
})

/** 引擎读这份 v1 文档的结果,只要求没有 invalid 诊断(`unsupported` 一类是上游照常装、只丢那一个字段的提示)。 */
function normalizedAllowingUnsupported(document: Record<string, unknown>) {
  const result = ConfigNormalize.normalize(document)
  expect(result.diagnostics.filter((diagnostic) => diagnostic.kind === "invalid")).toEqual([])
  if (result.type !== "normalized") throw new Error("the engine rejected the document")
  return result.encoded as Record<string, any>
}

/**
 * 引擎把一个 2.x 配置 agent 写进编辑器的那几样(`core/src/config/plugin/agent.ts`:model → `{id, providerID, variant?}`、`request.body` 合进去、
 * hidden / color / steps 原样);`disabled` ⇒ 移除,这里记作 undefined。只取本票涉及的字段。
 */
function engineWrites(item: Record<string, any> | undefined) {
  if (!item || item.disabled === true) return undefined
  return {
    model: item.model === undefined ? undefined : { id: item.model.model, providerID: item.model.providerID, ...(item.model.variant === undefined ? {} : { variant: item.model.variant }) },
    body: item.request?.body ?? {},
    hidden: item.hidden,
    color: item.color,
    steps: item.steps,
  }
}
const oursWrites = (agent: Record<string, any> | undefined) =>
  agent && { model: agent.model, body: agent.request.body, hidden: agent.hidden, color: agent.color, steps: agent.steps }

describe("项目 agent 的其余字段(#1700)= 引擎读同一条 v1 agent 写进编辑器的结果", () => {
  const entries = {
    disabled: { prompt: "off", disable: true },
    notDisabled: { prompt: "on", disable: false },
    steps: { prompt: "s", steps: 3 },
    legacySteps: { maxSteps: 5 },
    bothSteps: { steps: 2, maxSteps: 7 },
    hiddenHex: { mode: "subagent", hidden: true, color: "#FF5733" },
    themeColor: { color: "accent" },
    variant: { model: "openai/gpt-5", variant: "high" },
    variantWithHash: { model: "openai/gpt-5", variant: "a#b" },
    emptyVariant: { model: "openai/gpt-5", variant: "" },
    variantWithoutModel: { variant: "high" },
    modelWithHash: { model: "openai/gpt#5", variant: "high" },
    sampling: { temperature: 0.2, top_p: 0.9 },
  }
  test("AC-04 / AC-07 / AC-08 · disable ⇒ 移除;steps(旧名 maxSteps,steps 优先)、hidden、color(主题色名 ⇒ #aaaaaa)、variant(只随合法 model)、temperature / top_p 的 request.body 与上游逐字段相同", () => {
    const engine = normalizedAllowingUnsupported({ agent: entries }).agents
    const ours = agentsAfter(entries)
    for (const name of Object.keys(entries)) expect([name, oursWrites(ours.get(name))]).toEqual([name, engineWrites(engine[name])])
    // 判据能红:几条关键值是字面量,不只是「两边一样」
    expect(ours.has("disabled")).toBe(false)
    expect(ours.get("steps")?.steps).toBe(3)
    expect(ours.get("legacySteps")?.steps).toBe(5)
    expect(ours.get("themeColor")?.color).toBe("#aaaaaa")
    expect(ours.get("variant")?.model).toEqual({ providerID: "openai", id: "gpt-5", variant: "high" })
    expect(ours.get("sampling")?.request.body).toEqual({ temperature: 0.2, top_p: 0.9 })
    expect(ours.logs).toEqual([])
  })

  test("AC-04 · disable: true 移除上游内置的同名 agent,返回值点名它", () => {
    const agents = new Map<string, unknown>([["explore", { permissions: [] }]])
    const result = applyAgents(
      { get: (id: string) => agents.get(id), update: () => {}, remove: (id: string) => void agents.delete(id) } as never,
      { explore: { disable: true } },
      () => {},
    )
    expect(agents.has("explore")).toBe(false)
    expect(result).toEqual({ applied: [], disabled: ["explore"] })
  })

  test("AC-10 · 任何一个字段写成上游 v1 agent schema 不收的形状 ⇒ 上游整条丢掉(每条一个 invalid 诊断);ext 同样整条不装并记一行,同一文档里别的 agent 照常", () => {
    const malformed = {
      badMode: { mode: "sidekick", permission: { edit: "allow" } },
      badModel: { model: 42, permission: { edit: "allow" } },
      badVariant: { model: "openai/gpt-5", variant: 1 },
      badTemperature: { temperature: "0.2" },
      badTopP: { top_p: null },
      badPrompt: { prompt: ["x"] },
      badDisable: { disable: "yes" },
      badDescription: { description: 1 },
      badHidden: { hidden: "true" },
      badOptions: { options: "x" },
      badColorName: { color: "red" },
      badColorShort: { color: "#fff" },
      badSteps: { steps: 0 },
      fractionalSteps: { steps: 2.5 },
      badMaxSteps: { maxSteps: -1 },
    }
    const accepted = { ok: { prompt: "p", mode: "subagent", permission: { edit: "deny" } }, emptyOptions: { options: {} } }
    const result = ConfigNormalize.normalize({ agent: { ...malformed, ...accepted } })
    expect(result.diagnostics).toEqual(Object.keys(malformed).map((name) => ({ kind: "invalid", path: ["agent", name], message: expect.any(String) })))
    if (result.type !== "normalized") throw new Error("the engine rejected the whole document")
    const ours = agentsAfter({ ...malformed, ...accepted })
    expect([...ours.keys()]).toEqual(Object.keys(result.encoded.agents as Record<string, unknown>))
    expect([...ours.keys()]).toEqual(Object.keys(accepted))
    expect(ours.get("ok")?.permissions).toEqual([{ action: "edit", resource: "*", effect: "deny" }])
    expect(ours.logs.filter((line) => line.includes(" not applied: "))).toHaveLength(Object.keys(malformed).length)
    expect(ours.logs[0]).toBe('[@codepuppy/ext] project agent "badMode" not applied: mode not in a shape OpenCode accepts')
    expect(ours.logs[1]).toBe('[@codepuppy/ext] project agent "badModel" not applied: model not in a shape OpenCode accepts')
  })

  test("AC-10 · 写坏的 mode 带着放宽的 permission:上游内置 explore 的规则原样,一条也不多", () => {
    const explore = { mode: "subagent", permissions: [{ action: "edit", resource: "*", effect: "deny" }], request: { settings: {}, headers: {}, body: {} } }
    const ours = agentsAfter({ explore: { mode: "sidekick", permission: { edit: "allow" } } }, { explore })
    expect(ours.get("explore")).toEqual(explore)
    expect(Permission.evaluate("edit", "a.txt", ours.get("explore")!.permissions).effect).toBe("deny")
  })

  test("AC-09 · 上游不认识的字段、options 与 name 不用:助手照常装,日志一行点名这些字段", () => {
    const ours = agentsAfter({ helper: { prompt: "p", temprature: 0.3, options: { reasoningEffort: "high" }, name: "Helper" } })
    expect(ours.get("helper")?.system).toBe("p")
    expect(ours.get("helper")?.request.body).toEqual({})
    expect(ours.logs).toEqual(['[@codepuppy/ext] project agent "helper": temprature, options, name not applied (not a supported agent field)'])
  })
})

describe("助手的采样参数(#1700 BR-04)", () => {
  test("AC-05 · 模型支持温度 ⇒ 温度与 top_p 都带", () => {
    expect(agentSampling({ temperature: 0.2, top_p: 0.9 }, true)).toEqual({ temperature: 0.2, topP: 0.9 })
  })
  test("AC-06 · 模型不支持温度(false 或目录里没写)⇒ 不带温度,top_p 照带(1.x 同一判断)", () => {
    expect(agentSampling({ temperature: 0.2, top_p: 0.9 }, false)).toEqual({ topP: 0.9 })
    expect(agentSampling({ temperature: 0.2, top_p: 0.9 }, undefined)).toEqual({ topP: 0.9 })
  })
  test("没写或不是数 ⇒ 什么都不带", () => {
    expect(agentSampling({}, true)).toEqual({})
    expect(agentSampling({ temperature: "0.2", top_p: null }, true)).toEqual({})
    expect(agentSampling(undefined, true)).toEqual({})
  })
})
