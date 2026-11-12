import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
// #650:工具 id 一律从**引擎自己的**拼名规则推导。手喂字面量正是让这道闸空了整整一个需求的原因,
// 所以这里装的是真的拼名函数与真的权限求值,不是替身。`#1667`:引擎换成 OpenCode 2 —— 拼名是 `@opencode/core/tool/mcp`
// 的 `name(server, tool)`(MCP 工具的注册名与权限动作名同一个),求值是 `@opencode/core/permission` 的 `evaluate`
// (有序规则表,取最后一条命中);注入写的是 2.x 的 `permissions` / `agents.<name>.permissions` 规则数组。
import { McpTool } from "@opencode/core/tool/mcp"
import { Permission } from "@opencode/core/permission"
import { CLOUD_MCP_TOOLS } from "./fixtures/cloud-mcp-tools"
import {
  applyWebSearchDenies,
  CLOUD_MCP_SERVER_NAME,
  CLOUD_WEB_SEARCH_REMOTE_TOOL,
  CLOUD_WEB_SEARCH_TOOL_ID,
  LOCAL_WEB_SEARCH_TOOL_ID,
  LOCAL_WEBSEARCH_DENY_ENV,
} from "./cloud-web-search"

/** 云 worker **自己** advertise 的远端工具名(#643 P1.3 实测 `remoteToolNames`)。 */
const siblingRemoteTools = [
  "cloud_dispatch",
  "cloud_status",
  "cloud_await",
  "cloud_artifacts",
  "cloud_schedule_create",
  "cloud_schedule_list",
  "cloud_schedule_delete",
] as const
/** 远端名 → 引擎 id,走引擎自己的 `McpTool.name`(#650:不得手写第二份)。 */
const engineToolId = (remoteName: string) => McpTool.name(CLOUD_MCP_SERVER_NAME, remoteName)
const siblingCloudTools = siblingRemoteTools.map(engineToolId)
const registeredCloudTools = [CLOUD_WEB_SEARCH_TOOL_ID, ...siblingCloudTools]

type Rule = { action: string; resource: string; effect: "allow" | "deny" | "ask" }
const rule = (action: string, effect: Rule["effect"], resource = "*"): Rule => ({ action, resource, effect })
/** alpha 注入的三个 agent 都显式 `websearch` allow(codepuppy-config-injection.ts)。 */
const codepuppyAgents = (): Record<string, { permissions?: Rule[] }> => ({
  "codepuppy-automation": { permissions: [rule("websearch", "allow"), rule("shell", "deny")] },
  "codepuppy-readonly": { permissions: [rule("websearch", "allow"), rule("edit", "deny")] },
  "codepuppy-automation-standard": { permissions: [rule("websearch", "allow"), rule("edit", "allow")] },
})
/** 引擎的求值:取最后一条命中(`packages/core/src/permission.ts` 的 `evaluate`)。 */
const effectOf = (tool: string, ...rulesets: Rule[][]) => Permission.evaluate(tool, "*", ...rulesets).effect

describe("web search sovereignty denies", () => {
  test("kill switch removes both web search tools while the cloud server and sibling tools remain live", () => {
    const diagnostics: string[] = []
    const config = {
      mcp: { servers: { codepuppy: { type: "remote", url: "https://cloud.example/mcp" } } },
      permissions: [rule(CLOUD_WEB_SEARCH_TOOL_ID, "allow"), rule("shell", "allow")],
      agents: codepuppyAgents(),
    }

    applyWebSearchDenies(config, { killSwitch: true, platformPays: false }, (message) => diagnostics.push(message))

    expect(config.mcp.servers.codepuppy).toEqual({ type: "remote", url: "https://cloud.example/mcp" })
    expect(registeredCloudTools.filter((tool) => effectOf(tool, config.permissions) === "deny")).toEqual([CLOUD_WEB_SEARCH_TOOL_ID])
    expect(config.permissions).toEqual([rule("shell", "allow"), rule(CLOUD_WEB_SEARCH_TOOL_ID, "deny"), rule(LOCAL_WEB_SEARCH_TOOL_ID, "deny")])
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.join("\n")).toContain("remote MCP config has no per-tool deny")
  })

  // `#1411`(REQ-1414 CODE-1,owner 2026-09-23 裁决):账户信号只决定云腿在不在,不决定本地腿在不在。
  // 这条臂是那条边被重新接上时**当场翻红**的反回归断言。
  test("platform pays denies nothing — 代付不动本地腿,两条腿都留在模型工具表里", () => {
    const config = { permissions: [rule("shell", "allow")], agents: codepuppyAgents() }
    const diagnostics: string[] = []

    applyWebSearchDenies(config, { killSwitch: false, platformPays: true }, (message) => diagnostics.push(message))

    expect(config.permissions).toEqual([rule("shell", "allow")])
    expect(config.agents).toEqual(codepuppyAgents())
    expect(diagnostics).toEqual([])
  })

  // agent 级规则排在全局规则**之后**(evaluate 取 findLast),不压平这三个 agent 的话,全局 deny 对它们无效。
  test("no injected agent may re-allow a denied web search tool", () => {
    for (const state of [
      { killSwitch: true, platformPays: false },
      { killSwitch: true, platformPays: true },
    ]) {
      const config = { permissions: [] as Rule[], agents: codepuppyAgents() }
      applyWebSearchDenies(config, state, () => {})
      for (const agent of Object.values(config.agents)) {
        expect(effectOf(LOCAL_WEB_SEARCH_TOOL_ID, config.permissions, agent.permissions!)).toBe("deny")
        expect(effectOf(CLOUD_WEB_SEARCH_TOOL_ID, config.permissions, agent.permissions!)).toBe("deny")
      }
    }
  })

  test("agent rules unrelated to web search stay untouched", () => {
    const config = { permissions: [] as Rule[], agents: codepuppyAgents() }
    applyWebSearchDenies(config, { killSwitch: true, platformPays: true }, () => {})
    expect(effectOf("edit", config.agents["codepuppy-automation-standard"]!.permissions!)).toBe("allow")
    expect(effectOf("edit", config.agents["codepuppy-readonly"]!.permissions!)).toBe("deny")
  })

  // #223 R2 Blocker 1:一个只写 `*` allow 的 agent 必须也被压平;同一张表里的顺序也算数,deny 必须钉到**末位**。
  test("an agent wildcard cannot re-allow a denied web search tool", () => {
    const config = {
      permissions: [rule(LOCAL_WEB_SEARCH_TOOL_ID, "allow"), rule("*", "allow")],
      agents: {
        "wildcard-only": { permissions: [rule("*", "allow")] },
        "wildcard-after-deny": { permissions: [rule(LOCAL_WEB_SEARCH_TOOL_ID, "allow"), rule("*", "allow")] },
        "no-permission-block": {},
      } as Record<string, { permissions?: Rule[] }>,
    }

    applyWebSearchDenies(config, { killSwitch: true, platformPays: false }, () => {})

    expect(effectOf(LOCAL_WEB_SEARCH_TOOL_ID, config.permissions)).toBe("deny")
    for (const agent of Object.values(config.agents)) {
      expect(agent.permissions?.at(-1)).toEqual(rule(LOCAL_WEB_SEARCH_TOOL_ID, "deny"))
      expect(effectOf(LOCAL_WEB_SEARCH_TOOL_ID, config.permissions, agent.permissions!)).toBe("deny")
    }
  })

  // 注入面够不着的三条绕过(别的 config 源后加载的 agent / 持久 session permission / approved)
  // 由工具自身的最终闸兜底,判决靠这个 env 变量过河。两个包各写一份字面量 —— 这里钉住不许漂移。
  test("the sovereignty env channel name matches the engine-side reader", () => {
    expect(LOCAL_WEBSEARCH_DENY_ENV).toBe("CODEPUPPY_LOCAL_WEBSEARCH_DENY")
    // #223 R4:声明点下沉到 `mcp-websearch.ts`(本引擎唯一的出网出口),叶子只转出。
    const transport = readFileSync(join(import.meta.dir, "../../../opencode/src/tool/mcp-websearch.ts"), "utf8")
    expect(transport).toContain(`export const LOCAL_WEBSEARCH_DENY_ENV = "${LOCAL_WEBSEARCH_DENY_ENV}"`)
    expect(transport).toContain("if (localWebSearchDenied())")
    const leaf = readFileSync(join(import.meta.dir, "../../../opencode/src/tool/websearch.ts"), "utf8")
    expect(leaf).toContain("export const LOCAL_WEBSEARCH_DENY_ENV = McpWebSearch.LOCAL_WEBSEARCH_DENY_ENV")
    expect(leaf).toContain("if (localWebSearchDenied())")
  })

  test("logged-out/BYOK leaves cloud tool registration and existing permissions unchanged", () => {
    const config = {
      mcp: { servers: { codepuppy: { type: "remote", url: "https://cloud.example/mcp" } } },
      permissions: [rule("shell", "allow")],
      agents: codepuppyAgents(),
    }

    const diagnostics: string[] = []
    applyWebSearchDenies(config, { killSwitch: false, platformPays: false }, (message) => diagnostics.push(message))

    expect(config).toEqual({
      mcp: { servers: { codepuppy: { type: "remote", url: "https://cloud.example/mcp" } } },
      permissions: [rule("shell", "allow")],
      agents: codepuppyAgents(),
    })
    expect(diagnostics).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #650 —— 这道 permission deny 曾是**空闸门**,而上面每一条用例都全绿。
//
// 原因不是逻辑写错,是**数据模型错**:注入面把「远端 server 自己 advertise 的工具名」当成了
// 「引擎里的工具 id」。引擎按 `McpCatalog.toolName(server, remote)` 拼名,而云 worker 的远端名
// 本身就叫 `cloud_web_search`,拼上 server 名 `cloud` 之后真实 id 是 `codepuppy_web_search`
// (#643 P2.1 实测 `calledTool`)。写进 config 的 `cloud_web_search` 经 `Wildcard.match` 编成
// `^cloud_web_search$`,对真实 id 恒不匹配 —— kill-switch 下云工具从来没有从模型工具表里消失过。
//
// 上面那些用例抓不到它,是因为它们**手喂** id:两边喂同一个错值,断言自然成立。所以本组的
// 纪律是两条:
//   ① id 只从**引擎自己的** `McpCatalog.toolName` 推导(改 server 名或远端名 ⇒ 期望值跟着变);
//   ② 判据是**引擎自己的** `Permission.fromConfig` + `Permission.disabled` 的返回值,
//      不是「config 里那个键等于某字符串」—— 后者正是当初全绿的那种断言。
// ─────────────────────────────────────────────────────────────────────────────
describe("#650 云 web search 闸按引擎真实 id 命中", () => {
  test("生产常量 = 引擎的拼名规则算出来的 id,而不是远端工具名", () => {
    expect(CLOUD_WEB_SEARCH_TOOL_ID).toBe(McpTool.name(CLOUD_MCP_SERVER_NAME, CLOUD_WEB_SEARCH_REMOTE_TOOL))
    // 远端名自带 `cloud_` 前缀,两者长得几乎一样 —— 正是这一点让缺陷活了一个需求。
    expect(CLOUD_WEB_SEARCH_TOOL_ID).not.toBe(CLOUD_WEB_SEARCH_REMOTE_TOOL)
  })

  // 远端工具名的**真源**是已部署的 worker,不是这个仓里的任何一处字面量。#643 的真机探针把
  // 「worker advertise 的名字」与「引擎据此算出的 id」都写进了取证产物 —— 拿它当锚,平台改名
  // 而这里没跟上时,下一次取证跑完就红。锚缺失也判红:没有真源 = 这两个常量无人担保。
  test("最近一次真机取证(#643,改名前)与引擎拼名规则一致;今天的远端名由钉扎清单担保", () => {
    const evidence = JSON.parse(
      readFileSync(
        join(import.meta.dir, "../../../../docs/verification/2026-07-27-e7-packaged-live/results/latest-logged-in.json"),
        "utf8",
      ),
    ) as { schema?: string; phase?: string; remoteWebSearchToolName?: string; derivedEngineToolId?: string }
    expect([evidence.schema, evidence.phase]).toEqual(["alpha-code/e7-packaged-live/v1", "logged-in"])
    // alpha-code#1568:那次取证早于改名(远端名 `cloud_web_search`、服务器键 `cloud`)。引擎拼名规则没变 ——
    // 取证里的两个名字仍由同一个 McpCatalog.toolName 互推;今天的远端名由 vendored 平台清单担保
    // (`cloud-remote-names-pin.test.ts`),打包版重新取证归 T23。
    expect(evidence.remoteWebSearchToolName).toBe("cloud_web_search")
    expect(evidence.derivedEngineToolId).toBe(McpTool.name("cloud", evidence.remoteWebSearchToolName!))
    expect(CLOUD_MCP_TOOLS).toContain(CLOUD_WEB_SEARCH_REMOTE_TOOL)
    expect(CLOUD_WEB_SEARCH_TOOL_ID).toBe(McpTool.name("codepuppy", "web_search"))
  })

  /**
   * 引擎**真正注册**的云工具 id。刻意**不**取 `CLOUD_WEB_SEARCH_TOOL_ID` —— 那是被测方写的值,
   * 拿它当期望值就等于让判据跟着缺陷一起动(变异实测:那样写时把生产常量改回远端名,下面两条
   * 行为断言仍然全绿)。这里一律走引擎自己的 `McpCatalog.toolName`,再加两个非云对照。
   */
  const registeredTools = () => [
    ...[CLOUD_WEB_SEARCH_REMOTE_TOOL, ...siblingRemoteTools].map(engineToolId),
    LOCAL_WEB_SEARCH_TOOL_ID,
    "shell",
  ]
  /** 期望被隐藏的那个 id,同样从远端名推导。 */
  const cloudWebSearchEngineId = () => engineToolId(CLOUD_WEB_SEARCH_REMOTE_TOOL)
  const hidden = (...rulesets: Rule[][]) => new Set(registeredTools().filter((tool) => effectOf(tool, ...rulesets) === "deny"))

  test("kill-switch:引擎的求值真的拒掉云 web search,兄弟云工具一个不少", () => {
    const config = { permissions: [rule("shell", "allow")], agents: codepuppyAgents() }
    applyWebSearchDenies(config, { killSwitch: true, platformPays: false }, () => {})
    expect([...hidden(config.permissions)].sort()).toEqual([cloudWebSearchEngineId(), LOCAL_WEB_SEARCH_TOOL_ID].sort())
  })

  test("kill-switch:alpha 注入的 agent 也压得住(agent 规则排在全局之后,取 findLast)", () => {
    const config = { permissions: [] as Rule[], agents: codepuppyAgents() }
    applyWebSearchDenies(config, { killSwitch: true, platformPays: false }, () => {})
    for (const [name, agent] of Object.entries(config.agents)) {
      const hiddenHere = hidden(config.permissions, agent.permissions!)
      expect([name, hiddenHere.has(cloudWebSearchEngineId())]).toEqual([name, true])
      expect([name, hiddenHere.has(McpTool.name(CLOUD_MCP_SERVER_NAME, "cloud_dispatch"))]).toEqual([name, false])
    }
  })

  test("代付但无 kill-switch:两条腿都不被拒,引擎一个都不许藏", () => {
    const config = { permissions: [] as Rule[], agents: codepuppyAgents() }
    applyWebSearchDenies(config, { killSwitch: false, platformPays: true }, () => {})
    expect([...hidden(config.permissions)]).toEqual([])
    const webSearchIds = [cloudWebSearchEngineId(), LOCAL_WEB_SEARCH_TOOL_ID]
    for (const [name, agent] of Object.entries(config.agents)) {
      const hiddenHere = hidden(config.permissions, agent.permissions!)
      expect([name, webSearchIds.filter((id) => hiddenHere.has(id))]).toEqual([name, []])
    }
  })

  // 模型看得见的那句话里点名的工具必须真的存在,否则拒绝文案本身就是错误指路。
  //
  // `#1411`:这条断言以前要求那句话**必须**点名 `codepuppy_web_search`(「本地腿被代付关掉 ⇒ 去用
  // 云腿」)。代付不再关本地腿之后,`CODEPUPPY_LOCAL_WEBSEARCH_DENY` 只由 kill-switch 置位 —— 而上面两条
  // kill-switch 断言已经证明那一态**云工具同样不在模型工具表里**。于是那句指路在唯一可达它的状态下
  // 必然是错的。基线 S5:指不出在场的替代就明说没有。
  test("两份拒绝文案在唯一可达它的状态(kill-switch)下不指向任何替代工具", async () => {
    // 读的是**值**而不是文件正文 —— 正文匹配会被注释里的同形字样骗过去。
    const [legacy, v2] = await Promise.all([
      import("../../../opencode/src/tool/mcp-websearch"),
      import("../../../core/src/tool/websearch"),
    ])
    // 两个包之间没有可共用的 alpha 依赖边,两份副本只能靠这条锁保持逐字一致。
    expect(v2.LOCAL_WEBSEARCH_DENIED_MESSAGE).toBe(legacy.LOCAL_WEBSEARCH_DENIED_MESSAGE)
    const message = legacy.LOCAL_WEBSEARCH_DENIED_MESSAGE
    // 期望值从生产常量推导(引擎 id 与远端名都不许出现),不写第二份字面量。
    expect(message).not.toContain(CLOUD_WEB_SEARCH_TOOL_ID)
    expect(message).not.toContain(CLOUD_WEB_SEARCH_REMOTE_TOOL)
    // 仍必须让模型停手并自己说明 —— 否则它会把「能力被关掉」当成瞬时故障反复调用。
    expect(message).toContain("do not retry")
    expect(message).toContain("Answer without web search and say so")
    // 并且说清是谁关的:kill-switch 是唯一能到这里的原因。
    expect(message.toLowerCase()).toContain("kill switch")
  })

  // `#1461` 实测(docs/verification/2026-09-27-1461-third-party-websearch-mcp-four-states/):同一个第三方
  // 插件、同一格 kill-switch env,工具名 `web_search` 被拒、`search` 照常搜到 DuckDuckGo 结果 —— 第三方那道判决
  // 的入口是工具名,认不出的结构上关不掉。于是这句本地腿文案里的「it turns off every web search tool — …alike」
  // 在它唯一可达的状态下是假话。这里钉住:事实收窄到「alpha 自己的两条腿 + 按名字认出的」;「别找替代」保留为
  // 指令,不再是穷尽的承诺。与 ext `cloud-websearch-kill.test.ts` 的同名用例同口径(`b82403112`)。
  // 已知的坏:把任一副本改回带 `every web search tool` 的那句 ⇒ 第一条断言红(两份不同则上一条的逐字锁先红)。
  test("`#1461`:本地腿拒绝文案不再宣称关掉了每一个 web search 工具,只承认按名字认出的;仍叫模型别去找替代", async () => {
    const [legacy, v2] = await Promise.all([
      import("../../../opencode/src/tool/mcp-websearch"),
      import("../../../core/src/tool/websearch"),
    ])
    for (const message of [legacy.LOCAL_WEBSEARCH_DENIED_MESSAGE, v2.LOCAL_WEBSEARCH_DENIED_MESSAGE]) {
      const lower = message.toLowerCase()
      // 全称声称出局:开关关不掉名字认不出的第三方搜网工具(`duck_search` 反向臂)。
      expect(lower).not.toContain("every web search tool")
      // 范围要说出来:被关的是按名字认出的那些。
      expect(lower).toMatch(/recogni[sz]e[sd]? .*by name/)
      // 「别去找替代」保留,但作为指令而不是「找也没用」的承诺。
      expect(lower).toContain("do not look for another web search tool")
      // 刻意不给模型指绕过用户开关的路:文案里不许出现「认不出的 / 别的照常可用」一类的话。
      expect(lower).not.toMatch(/still (work|available|usable)|remain(s)? available|not affected/)
    }
  })
})
