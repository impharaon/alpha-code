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
    unattended: createUnattendedState(),
    search: async () => ({ ok: true, result: { searchId: "search_main", query: "", sources: [], candidates: [] } }),
    install: async () => ({ ok: true, accepted: true }),
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

const tools = (bridge: HubBridge, context: Parameters<typeof createHubTools>[1]) =>
  Object.fromEntries(createHubTools(bridge, context).map((tool) => [tool.name, tool]))
const contentOf = (r: unknown) => (r as { content: string }).content
const view = (rows: HubViewRow[]): HubView => ({ directory: "/work/a", rows, warnings: [] })

test("A3 tool contract is IDs only with source search, no secrets or routes", () => {
  const list = createHubTools(bridgeWith({ views: [view([])] }).bridge, contextWith(async () => {}).context)
  expect(list.map((tool) => tool.name).sort()).toEqual([
    "codepuppy_hub_install",
    "codepuppy_hub_search",
    "codepuppy_hub_status",
  ])
  for (const tool of list) expect(tool.options).toEqual({ codemode: false })
  const fields = (name: string) =>
    Object.keys((list.find((tool) => tool.name === name)!.input as { properties: object }).properties)
  expect(fields("codepuppy_hub_search")).toEqual(["query"])
  expect(fields("codepuppy_hub_install")).toEqual(["id", "scope"])
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
