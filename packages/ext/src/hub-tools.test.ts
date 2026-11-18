import { expect, test } from "bun:test"
import type { HubRequestRecord, HubView, HubViewRow } from "../../ui-mac/src/main/codepuppy-sidecar-messages"
import type { HubBridge } from "./hub-bridge"
import { createHubTools, HUB_UNAVAILABLE } from "./hub-tools"
import { createUnattendedState } from "./policy/unattended"
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
    packageAuthorization: async (packageId) => ({ ok: true, packageId, items: [] }),
    unattended: createUnattendedState(),
    search: async () => ({ ok: true, result: { searchId: "search_main", query: "", sources: [], candidates: [] } }),
    install: async () => ({ ok: true, accepted: true }),
    installSubject: () => undefined,
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
  const ctx = {
    sessionID: "ses_1",
    agent: "build",
    messageID: "msg_1",
    id: "call_1",
    signal: new AbortController().signal,
    progress: async () => {},
  } as never
  return { context, ctx, asserts }
}

const tools = (bridge: HubBridge, context: Parameters<typeof createHubTools>[1], askInstall: (callID: string) => Promise<void> = async () => {}) =>
  Object.fromEntries((createHubTools as (...args: unknown[]) => ReturnType<typeof createHubTools>)(bridge, context, askInstall).map((tool) => [tool.name, tool]))
const contentOf = (r: unknown) => (r as { content: string }).content
const view = (rows: HubViewRow[]): HubView => ({ directory: "/work/a", rows, warnings: [] })

test("A3 tool contract is IDs only with source search, no secrets or routes", () => {
  const list = createHubTools(bridgeWith({ views: [view([])] }).bridge, contextWith(async () => {}).context)
  expect(list.map((tool) => tool.name).sort()).toEqual([
    "codepuppy_hub_create",
    "codepuppy_hub_install",
    "codepuppy_hub_search",
    "codepuppy_hub_status",
  ])
  for (const tool of list) expect(tool.options).toEqual({ codemode: false })
  const fields = (name: string) =>
    Object.keys((list.find((tool) => tool.name === name)!.input as { properties: object }).properties)
  expect(fields("codepuppy_hub_search")).toEqual(["query"])
  expect(fields("codepuppy_hub_install")).toEqual(["id", "scope"])
  expect(fields("codepuppy_hub_create")).toEqual(["searchId", "name", "description", "files", "scope"])
  expect(fields("codepuppy_hub_status")).toEqual(["id"])
  for (const tool of list)
    for (const key of fields(tool.name)) expect(key).not.toMatch(/secret|token|password|url|path|route|grant/i)
})
test("A3 source failures remain explicit instead of becoming no results", async () => {
  const context = contextWith(async () => {
    throw Error("no assert")
  })
  const bridge = bridgeWith({ views: [view([])] }).bridge
  bridge.search = async () => ({
    ok: true,
    result: {
      searchId: "search_main",
      query: "browser",
      sources: [
        { source: "catalog", status: "ok", matched: 0, skipped: 0 },
        { source: "claude-marketplace", status: "failed", reason: "http", detail: "Source returned HTTP 503" },
      ],
      candidates: [],
    },
  })
  const output = await tools(bridge, context.context).codepuppy_hub_search!.execute({ query: "browser" }, context.ctx)
  expect(contentOf(output)).toContain("failed")
  expect(contentOf(output)).toContain("503")
  expect(output).toMatchObject({ metadata: { searchId: "search_main" } })
})
test("A3 abort or bridge timeout leaves main's installation pending", async () => {
  const context = contextWith(async () => {
    throw Error("no assert")
  })
  const bridge = bridgeWith({ views: [view([])] }).bridge
  bridge.install = async () => ({ ok: false, reason: "timeout", detail: "not answered" })
  const output = await tools(bridge, context.context).codepuppy_hub_install!.execute({ id: "cand_main" }, context.ctx)
  expect(contentOf(output)).toBe("submitted; result pending")
  expect(output).toMatchObject({ metadata: { stage: "submitted" } })
  expect(context.asserts).toEqual([])
})
test("A3 failed transactions return main's code; automation is still denied", async () => {
  const context = contextWith(async () => {
    throw Error("no assert")
  })
  const bridge = bridgeWith({
    views: [view([])],
    record: {
      requestId: "request_a3",
      stage: "failed",
      outcome: { ok: false, code: "source-changed", detail: "search again" },
    },
  }).bridge
  const output = await tools(bridge, context.context).codepuppy_hub_install!.execute({ id: "cand_main" }, context.ctx)
  expect(contentOf(output)).toBe("not installed: source-changed")
  await expect(
    tools(bridge, context.context).codepuppy_hub_install!.execute({ id: "cand_main" }, {
      ...context.ctx,
      agent: "codepuppy-automation-standard",
    } as never),
  ).rejects.toThrow("Permission denied")
})
test("A3 status keeps cloud price, skill agent restrictions and unknown state honest", async () => {
  const context = contextWith(async () => {})
  const bridge = bridgeWith({
    views: [
      view([
        row({
          id: "cloud:test",
          kind: "cloud",
          state: "installed",
          installed: true,
          enabled: false,
          agentNote: "per-session deny",
        }),
      ]),
    ],
  }).bridge
  const output = await tools(bridge, context.context).codepuppy_hub_status!.execute({ id: "cloud:test" }, context.ctx)
  expect(contentOf(output)).toContain("本目录尚未提供价格说明")
  expect(contentOf(output)).toContain("per-session deny")
  expect(
    contentOf(await tools(bridge, context.context).codepuppy_hub_status!.execute({ id: "absent" }, context.ctx)),
  ).toBe("unknown entry")
})
test("A3 CLI host has no imaginary install route", async () => {
  const context = contextWith(async () => {})
  const bridge = { ...bridgeWith({ views: [view([])] }).bridge, available: false }
  expect(
    contentOf(await tools(bridge, context.context).codepuppy_hub_install!.execute({ id: "cand_main" }, context.ctx)),
  ).toBe(HUB_UNAVAILABLE)
})
test("A3 tools search sources and install a main ID without permission transport, returning package metadata", async () => {
  const context = contextWith(async () => {
    throw Error("installation must not use permission.assert transport")
  })
  const calls: unknown[] = []
  const result = {
    ok: true as const,
    packageId: "claude:playwright",
    displayName: "playwright",
    source: {
      kind: "marketplace" as const,
      ecosystem: "claude" as const,
      repository: "https://github.com/anthropics/claude-plugins-official",
      commit: "fixed",
      path: "external_plugins/playwright",
      entryName: "playwright",
    },
    installed: [{ kind: "mcp" as const, hostName: "playwright", sourceName: "playwright" }],
    notRunning: [],
  }
  const bridge = bridgeWith({
    views: [view([row({ id: "claude:playwright", state: "available", installed: true, enabled: true })])],
  }).bridge
  bridge.search = async (input) => {
    calls.push(input)
    return {
      ok: true,
      result: {
        searchId: "search_main",
        query: input.query,
        sources: [{ source: "catalog", status: "ok", matched: 0, skipped: 0 }],
        candidates: [
          {
            id: "cand_main",
            source: "claude-marketplace",
            name: "playwright",
            displayName: "playwright",
            description: "browser",
            kind: "plugin",
            upstream: {},
          },
        ],
      },
    }
  }
  bridge.install = async (input) => {
    calls.push(input)
    return { ok: true, accepted: true }
  }
  bridge.request = async (requestId) => ({
    ok: true,
    record: { requestId, stage: "committed", packageId: result.packageId, outcome: result },
  })
  const list = tools(bridge, context.context)
  const searched = await list.codepuppy_hub_search!.execute({ query: "playwright" }, context.ctx)
  expect(contentOf(searched)).toContain("cand_main")
  const installed = await list.codepuppy_hub_install!.execute({ id: "cand_main" }, context.ctx)
  expect(context.asserts).toEqual([])
  expect(calls[1]).toMatchObject({
    ref: { kind: "id", id: "cand_main" },
    scope: "all-projects",
    sessionID: "ses_1",
    directory: "/work/a",
  })
  expect(installed).toMatchObject({ metadata: { packageId: "claude:playwright", stage: "committed" } })
  expect(contentOf(installed)).toContain("installed; available")
})


test("D3 create relays the frozen draft and scope through the install bridge without asking for consent", async () => {
  const outcome = { ok: true as const, packageId: "mine:notes", displayName: "notes", source: { kind: "created" as const }, installed: [], notRunning: [] }
  const h = bridgeWith({ views: [view([row({ id: outcome.packageId, name: "notes", installed: true, enabled: true, state: "available" })])], record: { requestId: "request_main", stage: "committed", packageId: outcome.packageId, outcome } })
  const calls: unknown[] = []
  h.bridge.install = async (input) => { calls.push(input); return { ok: true, accepted: true } }
  const context = contextWith(async () => { throw Error("create must use ordinary policy, not an installation-consent transport") })
  const input = { searchId: "search_main", name: "notes", description: "My notes", files: [{ path: "skills/notes/SKILL.md", text: "own instructions" }], scope: "this-project" as const }
  const tool = tools(h.bridge, context.context).codepuppy_hub_create
  expect(tool).toBeDefined()
  const output = await tool!.execute(input, context.ctx)
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({ directory: "/work/a", scope: "this-project", ref: { kind: "created", draft: { searchId: input.searchId, name: input.name, description: input.description, files: input.files } } })
  expect(context.asserts).toEqual([])
  expect(contentOf(output)).toBe("installed; available")
  expect(output.metadata).toMatchObject({ packageId: outcome.packageId, stage: "committed" })
})

// I-10 / 编排器裁决(2026-11-18):安装先把要装的名称与来源写进本次调用(时间线卡在等待审批与拒绝之后都读它),再经执行闸问一次;
// 拒绝照引擎合同原样抛出(不在工具里改成结果),什么也不交给 main。名称先于询问写入 ⇒ 去掉这一步,等待卡与拒绝卡就只剩编号。
test("I-10 the install records the package name before its one approval ask; a declined ask propagates and nothing reaches main", async () => {
  const h = bridgeWith({ views: [view([])] })
  const installs: unknown[] = []
  h.bridge.install = async (input) => { installs.push(input); return { ok: true, accepted: true } }
  h.bridge.installSubject = (id) => (id === "cand_ctx7" ? { name: "Context7", source: "claude-marketplace" } : undefined)
  const context = contextWith(async () => {})
  const events: unknown[] = []
  const ctx = { ...(context.ctx as object), id: "call_ctx7", progress: async (update: unknown) => void events.push(["progress", update]) } as never
  const declined = Object.assign(Error("The user declined this tool call"), { _tag: "Permission.DeclinedError" })
  const list = tools(h.bridge, context.context, async (callID) => { events.push(["ask", callID]); throw declined })
  await expect(list.codepuppy_hub_install!.execute({ id: "cand_ctx7" }, ctx)).rejects.toBe(declined)
  expect(events).toEqual([
    ["progress", { metadata: { install: { name: "Context7", source: "claude-marketplace" }, stage: "awaiting-approval" } }],
    ["ask", "call_ctx7"],
  ])
  expect(installs).toEqual([])
  expect(context.asserts).toEqual([])
  // 允许:照常交给 main,名称留在之后的阶段元数据里
  events.length = 0
  const allowed = tools(h.bridge, context.context, async (callID) => void events.push(["ask", callID]))
  const output = await allowed.codepuppy_hub_install!.execute({ id: "cand_ctx7" }, ctx)
  expect(events[1]).toEqual(["ask", "call_ctx7"])
  expect(installs).toHaveLength(1)
  expect(output.metadata).toMatchObject({ install: { name: "Context7", source: "claude-marketplace" } })
  // 自制插件:名称就是草稿名,来源「我的插件」
  events.length = 0
  await tools(h.bridge, context.context, async () => { throw declined }).codepuppy_hub_create!.execute({ searchId: "search_main", name: "own-report", description: "Own report", files: [] }, ctx).catch(() => undefined)
  expect(events[0]).toEqual(["progress", { metadata: { install: { name: "own-report", source: "created" }, stage: "awaiting-approval" } }])
})

test("D3 automation cannot send a create request", async () => {
  const h = bridgeWith({ views: [view([])] })
  let writes = 0
  h.bridge.install = async () => { writes++; return { ok: true, accepted: true } }
  const context = contextWith(async () => {})
  const tool = tools(h.bridge, context.context).codepuppy_hub_create
  expect(tool).toBeDefined()
  await expect(tool!.execute({ searchId: "search_main", name: "n", description: "d", files: [] }, { ...(context.ctx as object), agent: "codepuppy-automation-standard" } as never)).rejects.toThrow("Permission denied: codepuppy_hub_create")
  expect(writes).toBe(0)
})

const settledOutcome = () => ({ ok: true as const, packageId: "claude:playwright", displayName: "Playwright", source: { kind: "catalog" as const }, installed: [{ kind: "mcp" as const, hostName: "playwright", sourceName: "playwright" }], notRunning: [] })
const oauthPending = { kind: "mcp-oauth" as const, componentId: "mcp", prerequisiteId: "login", serviceName: "Docs", label: "Docs", authenticated: false, status: "needs_auth" }
const tokenPending = { kind: "secret" as const, componentId: "mcp", prerequisiteId: "token", serviceName: "GitHub", label: "Token", saved: false }
test.each([
  { name: "pending", rows: [row({ id: "claude:playwright", state: "reload-pending", stateReason: { code: "reload-waiting", detail: "session busy" } })], expected: "installed; loading pending: session busy" },
  { name: "not loaded", rows: [row({ id: "claude:playwright", state: "installed", stateReason: { code: "not-loaded", detail: "spawn_failed" } })], expected: "installed; loading pending: spawn_failed" },
  { name: "empty view", rows: [], expected: "installed; loading pending: engine state is not available" },
  { name: "partial", rows: [], notRunning: [{ kind: "hook" as const, sourceName: "SessionStart", reason: "kind-not-supported-yet" as const }], expected: "installed; partly running: SessionStart: kind-not-supported-yet" },
  { name: "duplicate", rows: [], alreadyInstalled: true, expected: "already installed" },
  { name: "login", rows: [], items: [oauthPending], expected: "installed; needs login: Docs" },
  { name: "token", rows: [], items: [tokenPending], expected: "installed; needs token: GitHub" },
  { name: "saved token is not pending", rows: [row({ id: "claude:playwright", state: "available" })], items: [{ ...tokenPending, saved: true }], expected: "installed; available" },
])("R13 B3 C1 model outcome: $name", async c => {
  const outcome = { ...settledOutcome(), ...(c.notRunning ? { notRunning: c.notRunning } : {}), ...(c.alreadyInstalled ? { alreadyInstalled: true } : {}) }
  const h = bridgeWith({ views: [view(c.rows)], record: { requestId: "r13_outcome", stage: "committed", packageId: outcome.packageId, outcome } })
  const reads: string[] = []
  Object.assign(h.bridge, { packageAuthorization: async (packageId: string) => { reads.push(packageId); return { ok: true, packageId, items: c.items ?? [] } } })
  const context = contextWith(async () => {})
  const output = await tools(h.bridge, context.context).codepuppy_hub_install!.execute({ id: "cand_main" }, context.ctx)
  expect(contentOf(output)).toBe(c.expected)
  if (c.items) expect(reads).toEqual([outcome.packageId])
})

test.each([
  ["cloud-connection", "cloud MCP needs_auth", "cloud connection"],
  ["cloud-tools", "dispatch missing", "cloud tool list"],
  ["cloud-policy", "dispatch is ask by tool policy", "cloud tool policy"],
] as const)("R13 C1 status retains %s stage and detail", async (code, detail, stage) => {
  const context = contextWith(async () => {})
  const bridge = bridgeWith({ views: [view([row({ stateReason: { code, detail } })])] }).bridge
  const output = await tools(bridge, context.context).codepuppy_hub_status!.execute({ id: "mcp:github" }, context.ctx)
  expect(JSON.parse(contentOf(output)).reason).toBe(stage + ": " + detail)
})

test("R13 C1 status price notes are verbatim and main warnings stay private", async () => {
  const context = contextWith(async () => {})
  for (const priceNote of [undefined, "预留 US$1.00,按实际用量结算;失败时已产生的费用仍会结算"]) {
    const bridge = bridgeWith({ views: [{ ...view([row({ kind: "cloud", ...(priceNote ? { priceNote } : {}) })]), warnings: ["PRIVATE_PATH_LEDGER_WARNING"] }] }).bridge
    const output = contentOf(await tools(bridge, context.context).codepuppy_hub_status!.execute({ id: "mcp:github" }, context.ctx))
    const parsed = JSON.parse(output.split("\n")[0]!)
    expect(parsed.priceNote).toBe(priceNote)
    expect(output.includes("本目录尚未提供价格说明;费用以服务端为准")).toBe(!priceNote)
    expect(output).not.toContain("PRIVATE_PATH_LEDGER_WARNING")
    expect(output).toContain("this list may be incomplete")
  }
})

test("R14 B11 chat search bounds each source while retaining full main results and status counts", async () => {
 const {createPluginSources}=await import("../../ui-mac/src/main/plugin-sources")
 const {fixtureFetch}=await import("../../ui-mac/test-fixtures/plugin-helper/source-fetch")
 const answer=await createPluginSources({catalog:async()=>[],fetch:fixtureFetch}).searchSources("")
 expect(answer.candidates.filter(candidate=>candidate.source==="claude-marketplace").length).toBeGreaterThan(25)
 const h=bridgeWith({views:[view([])]})
 h.bridge.search=async()=>({ok:true,result:answer})
 const context=contextWith(async()=>{})
 const output=await tools(h.bridge,context.context).codepuppy_hub_search!.execute({query:""},context.ctx)
 const shown=JSON.parse(contentOf(output)) as typeof answer
 expect(shown.sources).toEqual(answer.sources)
 for(const status of answer.sources)
  expect(shown.candidates.filter(candidate=>candidate.source===status.source)).toEqual(answer.candidates.filter(candidate=>candidate.source===status.source).slice(0,25))
 expect(answer.candidates.filter(candidate=>candidate.source==="claude-marketplace").length).toBeGreaterThan(25)
 expect(output.metadata).toEqual({searchId:answer.searchId})
})
