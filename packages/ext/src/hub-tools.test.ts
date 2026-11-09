// REQ-234 `#1531`:agent 的三个定制中心工具(hub-tools.ts),`#1665` 起是 OpenCode 2 的工具形状(接口 I10)。
//   I2 参数只有字符串标识(键集合精确相等,没有任何密钥形状的字段);
//   I3 / I10 确认框一定会出现:`hubInstallEvaluate` 让 `codepuppy_hub_install` 恒 ask、自动化 agent 恒 deny(真宿主里的注册与反向臂
//      在 plugin-host.test.ts);规则被绕过(assert 直接放行)⇒ 查不到记录 ⇒「not installed: no confirmation box ran」;
//   I10 运输形状:`context.permission.assert` 的入参逐字段冻结(`save: []` = I7);拒绝时 assert reject ⇒ 原样抛出;
//   I9 放行之后,结局以 main 记录的 requestId 阶段为准。
import { describe, expect, test } from "bun:test"
import type { HubRequestRecord, HubView, HubViewRow } from "../../ui-mac/src/main/codepuppy-sidecar-messages"
import { isHubRequestId } from "../../ui-mac/src/main/codepuppy-sidecar-messages"
import type { HubBridge } from "./hub-bridge"
import { createHubTools, HUB_INSTALL_OUTCOME, HUB_NEXT_MESSAGE_HINT, HUB_PRICE_NOTE_MISSING, hubInstallEvaluate } from "./hub-tools"

const row = (patch: Partial<HubViewRow>): HubViewRow => ({
  id: "mcp:github",
  scope: null,
  name: "github",
  kind: "mcp",
  displayName: "GitHub",
  description: "repos",
  installed: false,
  enabled: false,
  state: "not-installed",
  authorization: "secret:GITHUB_TOKEN",
  ...patch,
})

function bridgeWith(script: { views: HubView[]; record?: HubRequestRecord | null }) {
  const calls = { view: [] as unknown[], request: [] as string[] }
  const bridge: HubBridge = {
    available: true,
    view: async (input) => {
      calls.view.push(input)
      const next = script.views.length > 1 ? script.views.shift()! : script.views[0]!
      return { ok: true, view: next }
    },
    request: async (requestId) => {
      calls.request.push(requestId)
      return { ok: true, record: script.record === undefined ? null : script.record && { ...script.record, requestId } }
    },
    report: () => {},
    onReloadRequest: () => {},
  }
  return { bridge, calls }
}

/** 2.x 插件 Context 里 hub 工具用到的两样(`location`、`permission.assert`)+ 一次工具调用的上下文。 */
function contextWith(assert: (input: unknown) => Promise<void>) {
  const asserts: unknown[] = []
  const context = {
    location: { directory: "/work/a", project: { id: "global", directory: "/work/a", canonical: "/work/a" } },
    permission: {
      assert: async (input: unknown) => {
        asserts.push(input)
        await assert(input)
      },
    },
  } as unknown as Parameters<typeof createHubTools>[1]
  const ctx = { sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal: new AbortController().signal, progress: async () => {} } as never
  return { context, ctx, asserts }
}

const tools = (bridge: HubBridge, context: Parameters<typeof createHubTools>[1]) =>
  Object.fromEntries(createHubTools(bridge, context).map((tool) => [tool.name, tool]))
const contentOf = (r: unknown) => (r as { content: string }).content
const view = (rows: HubViewRow[]): HubView => ({ directory: "/work/a", rows, warnings: [] })

describe("I2:参数只有字符串标识", () => {
  test("三个工具的参数键集合精确相等,且没有任何密钥形状的字段名;都是一等工具(不进 Code Mode)", () => {
    const list = createHubTools(bridgeWith({ views: [view([])] }).bridge, contextWith(async () => {}).context)
    expect(list.map((tool) => tool.name).sort()).toEqual(["codepuppy_hub_install", "codepuppy_hub_search", "codepuppy_hub_status"])
    const keys = (name: string) => Object.keys((list.find((tool) => tool.name === name)!.input as { properties: object }).properties)
    expect(keys("codepuppy_hub_search")).toEqual(["query"])
    expect(keys("codepuppy_hub_install")).toEqual(["catalogId"])
    expect(keys("codepuppy_hub_status")).toEqual(["catalogId"])
    for (const tool of list) {
      expect(tool.options).toEqual({ codemode: false })
      for (const key of keys(tool.name)) expect(key).not.toMatch(/secret|token|key|password|dsn|env|grant/i)
    }
  })
})

describe("I3 / I10:确认框一定会出现", () => {
  test("hubInstallEvaluate:codepuppy_hub_install 恒 ask(压过 allow),codepuppy-automation* 恒 deny,别的动作不碰", () => {
    const evaluation = (agent: string | undefined, action = "codepuppy_hub_install") => ({
      sessionID: "ses_1",
      agent,
      action,
      resources: ["mcp:github"],
      effect: "allow" as "allow" | "ask" | "deny",
    })
    for (const agent of ["build", "plan", undefined]) {
      const event = evaluation(agent)
      hubInstallEvaluate(event as never)
      expect(event.effect).toBe("ask")
    }
    for (const agent of ["codepuppy-automation", "codepuppy-automation-standard"]) {
      const event = evaluation(agent)
      hubInstallEvaluate(event as never)
      expect(event.effect).toBe("deny")
    }
    const other = evaluation("build", "read")
    hubInstallEvaluate(other as never)
    expect(other.effect).toBe("allow")
  })

  test("规则被绕过(assert 直接放行)⇒ 查不到记录 ⇒ not installed: no confirmation box ran;assert 入参逐字段是冻结的形状", async () => {
    const { bridge, calls } = bridgeWith({ views: [view([row({})])], record: null })
    const { context, ctx, asserts } = contextWith(async () => {})
    const out = contentOf(await tools(bridge, context).codepuppy_hub_install!.execute({ catalogId: "mcp:github" }, ctx))
    expect(out.split("\n")[0]).toBe(HUB_INSTALL_OUTCOME.noBox)
    expect(asserts).toEqual([
      {
        sessionID: "ses_1",
        agent: "build",
        action: "codepuppy_hub_install",
        resources: ["mcp:github"],
        save: [],
        metadata: { codepuppyHub: { catalogId: "mcp:github", requestId: calls.request[0] } },
      },
    ])
    expect(isHubRequestId(calls.request[0])).toBe(true)
  })

  test("用户拒绝(assert reject)⇒ 原样抛出,不当工具输出返回,也不去 main 查阶段", async () => {
    const { bridge, calls } = bridgeWith({ views: [view([row({})])], record: null })
    const declined = new Error("The user rejected permission to use this specific tool call.")
    const { context, ctx } = contextWith(async () => {
      throw declined
    })
    await expect(tools(bridge, context).codepuppy_hub_install!.execute({ catalogId: "mcp:github" }, ctx)).rejects.toBe(declined)
    expect(calls.request).toHaveLength(0)
  })

  test("目录里没有的 id ⇒ unknown entry,根本不发审批请求", async () => {
    const { bridge, calls } = bridgeWith({ views: [view([row({})])] })
    const { context, ctx, asserts } = contextWith(async () => {})
    const out = contentOf(await tools(bridge, context).codepuppy_hub_install!.execute({ catalogId: "mcp:nope" }, ctx))
    expect(out.split("\n")[0]).toBe(HUB_INSTALL_OUTCOME.unknownEntry)
    expect(asserts).toHaveLength(0)
    expect(calls.request).toHaveLength(0)
  })
})

describe("I9:结局以 main 的阶段记录为准", () => {
  const cases: Array<{ name: string; record: HubRequestRecord; after: HubViewRow[]; want: string }> = [
    { name: "submitted ⇒ 已提交,结果待定 —— 不是拒绝", record: { requestId: "x", catalogId: "mcp:github", stage: "submitted" }, after: [], want: HUB_INSTALL_OUTCOME.submitted },
    {
      name: "committed ⇒ 按该行(id, scope)此刻的档:available",
      record: { requestId: "x", catalogId: "mcp:github", stage: "committed", scope: "global" },
      after: [row({ scope: "global", installed: true, enabled: true, state: "available" })],
      want: HUB_INSTALL_OUTCOME.available,
    },
    {
      name: "committed ⇒ reload pending(带原因)",
      record: { requestId: "x", catalogId: "mcp:github", stage: "committed", scope: "global" },
      after: [row({ scope: "global", installed: true, enabled: true, state: "reload-pending", stateReason: { code: "reload-waiting", detail: "1 session(s) busy" } })],
      want: `${HUB_INSTALL_OUTCOME.reloadPending} (waiting: 1 session(s) busy)`,
    },
    {
      name: "committed ⇒ 装完即停用",
      record: { requestId: "x", catalogId: "mcp:github", stage: "committed", scope: "global" },
      after: [row({ scope: "global", installed: true, enabled: false, state: "installed", stateReason: { code: "disabled" } })],
      want: HUB_INSTALL_OUTCOME.disabledByPolicy,
    },
    {
      name: "committed 到项目作用域 ⇒ 读的是 project 那一行,不是同名 global",
      record: { requestId: "x", catalogId: "mcp:github", stage: "committed", scope: "project" },
      after: [
        row({ scope: "global", installed: true, enabled: true, state: "available" }),
        row({ scope: "project", installed: true, enabled: true, state: "reload-pending", stateReason: { code: "not-loaded", detail: "MCP failed" } }),
      ],
      want: `${HUB_INSTALL_OUTCOME.reloadPending} (not loaded in this directory: MCP failed)`,
    },
    { name: "declined ⇒ declined", record: { requestId: "x", catalogId: "mcp:github", stage: "declined" }, after: [], want: HUB_INSTALL_OUTCOME.declined },
    {
      name: "failed ⇒ declined 带原因",
      record: { requestId: "x", catalogId: "mcp:github", stage: "failed", reason: "runtime missing: uv" },
      after: [],
      want: `${HUB_INSTALL_OUTCOME.declined}: install failed — runtime missing: uv`,
    },
  ]
  for (const c of cases)
    test(c.name, async () => {
      const { bridge } = bridgeWith({ views: [view([row({})]), view(c.after)], record: c.record })
      const { context, ctx } = contextWith(async () => {})
      const out = contentOf(await tools(bridge, context).codepuppy_hub_install!.execute({ catalogId: "mcp:github" }, ctx))
      expect(out).toBe(`${c.want}\n${HUB_NEXT_MESSAGE_HINT}`)
    })
})

describe("codepuppy_hub_search / codepuppy_hub_status", () => {
  // stateReason snapshots from the real main service in ui-mac/src/main/hub-view.test.ts (#1658 AC3).
  test.each([
    ["cloud-connection", "cloud MCP needs_auth", "cloud connection"],
    ["cloud-tools", "dispatch is not in this directory's tool list", "cloud tool list"],
    ["cloud-policy", "dispatch is ask by tool policy", "cloud tool policy"],
  ] as const)("#1658 audit: %s retains stage and detail in search, status and install settlement", async (code, detail, stage) => {
    const item = row({ id: "cloud:docs", kind: "cloud", scope: "global", installed: true, enabled: true, state: "installed", stateReason: { code, detail } })
    const { bridge } = bridgeWith({ views: [view([item])], record: { requestId: "x", catalogId: item.id, stage: "committed", scope: "global" } })
    const { context, ctx } = contextWith(async () => {})
    const byName = tools(bridge, context)
    const expected = `${stage}: ${detail}`
    for (const output of [
      await byName.codepuppy_hub_search!.execute({ query: "" }, ctx),
      await byName.codepuppy_hub_status!.execute({ catalogId: item.id }, ctx),
    ]) expect(JSON.parse(contentOf(output).split("\n")[0]!).reason).toBe(expected)
    expect(contentOf(await byName.codepuppy_hub_install!.execute({ catalogId: item.id }, ctx)).split("\n")[0])
      .toBe(`installed; not available in this directory yet (${expected})`)
  })

  test("#1533:价格说明逐字输出;缺说明才给末尾缺项句(混合列表与 warnings 同样成立)", async () => {
    const priced = row({ id: "cloud:html", kind: "cloud", priceNote: "预留 US$1.00,按实际用量结算;失败时已产生的费用仍会结算" })
    const missing = row({ id: "cloud:docs", kind: "cloud" })
    for (const rows of [[priced], [missing], [priced, missing]]) {
      const input = { ...view(rows), warnings: ["unreadable ledger"] }
      const { context, ctx } = contextWith(async () => {})
      const byName = tools(bridgeWith({ views: [input] }).bridge, context)
      const out = contentOf(await byName.codepuppy_hub_search!.execute({ query: "" }, ctx))
      for (const [index, item] of rows.entries()) {
        const parsed = JSON.parse(out.split("\n")[index]!)
        if (item.priceNote !== undefined) expect(parsed.priceNote).toBe(item.priceNote)
        else expect(parsed).not.toHaveProperty("priceNote")
      }
      expect(out.includes(HUB_PRICE_NOTE_MISSING)).toBe(rows.includes(missing))
      if (rows.includes(missing)) expect(out.split("\n").at(-1)).toBe("本目录尚未提供价格说明;费用以服务端为准")
      expect(contentOf(await byName.codepuppy_hub_status!.execute({ catalogId: rows[0]!.id }, ctx)).includes(HUB_PRICE_NOTE_MISSING)).toBe(rows[0] === missing)
    }
  })

  test("search:按会话目录问、带 sessionID / agent;每行只含视图字段;云条目在场时末尾固定缺项句;main 的 warnings 不原样外发", async () => {
    const rows = [
      row({ scope: "global", installed: true, enabled: true, state: "reload-pending", stateReason: { code: "reload-failed", detail: "reload failed 3 times — restart the app to apply" } }),
      row({ id: "cloud:ocr", name: "ocr", kind: "cloud", displayName: "OCR", authorization: "platform-login" }),
    ]
    const { bridge, calls } = bridgeWith({ views: [{ directory: "/work/a", rows, warnings: ["ledger /Users/x/installs.json unreadable"] }] })
    const { context, ctx } = contextWith(async () => {})
    const out = contentOf(await tools(bridge, context).codepuppy_hub_search!.execute({ query: "o" }, ctx))
    expect(calls.view[0]).toEqual({ directory: "/work/a", sessionID: "ses_1", agent: "build", query: "o" })
    const lines = out.split("\n")
    expect(JSON.parse(lines[0]!)).toEqual({
      id: "mcp:github",
      scope: "global",
      name: "GitHub",
      type: "mcp",
      description: "repos",
      installed: true,
      enabled: true,
      state: "reload-pending",
      reason: "last reload failed: reload failed 3 times — restart the app to apply",
      authorization: "secret:GITHUB_TOKEN",
    })
    expect(lines).toContain(HUB_PRICE_NOTE_MISSING)
    expect(out).not.toContain("installs.json")
  })

  test("status:只回该 id 的行(同名 global / project 各一行);不认识 ⇒ unknown entry;无 parentPort 宿主 ⇒ 如实说不可用", async () => {
    const rows = [row({ scope: "global", installed: true, enabled: true, state: "available" }), row({ scope: "project", installed: true, enabled: true, state: "available" }), row({ id: "skill:x", kind: "skill" })]
    const { bridge } = bridgeWith({ views: [view(rows)] })
    const { context, ctx } = contextWith(async () => {})
    const out = contentOf(await tools(bridge, context).codepuppy_hub_status!.execute({ catalogId: "mcp:github" }, ctx))
    expect(out.split("\n").map((line) => JSON.parse(line).scope)).toEqual(["global", "project"])
    expect(contentOf(await tools(bridge, context).codepuppy_hub_status!.execute({ catalogId: "nope" }, ctx)).split("\n")[0]).toBe(HUB_INSTALL_OUTCOME.unknownEntry)
    const none: HubBridge = { ...bridge, available: false }
    for (const t of createHubTools(none, context))
      expect(contentOf(await t.execute({ query: "", catalogId: "mcp:github" } as never, ctx))).toBe("The Customization Center is not available in this engine host.")
  })
})
