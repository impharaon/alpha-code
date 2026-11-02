// REQ-234 `#1529` I6:parentPort `codepuppy.*` 消息族封闭 —— 只认三种 ext → main 的形状,其余(含未知 alpha.* type、
// main → ext 方向、形状不对)一律 undefined,由收方丢弃。
import { describe, expect, test } from "bun:test"
import {
  buildHubRequestQuery,
  buildHubRequestReply,
  buildHubViewReply,
  buildHubViewRequest,
  buildReloadReport,
  buildReloadRequest,
  isCodePuppySidecarMessage,
  isHubRequestId,
  parseCodePuppySidecarInbound,
  parseHubRequestReply,
  parseHubViewReply,
  parseReloadRequest,
  type HubView,
} from "./codepuppy-sidecar-messages"

describe("codepuppy-sidecar-messages — 入站只认三种(I6)", () => {
  test("三种 ext → main 的消息按合同解析;多余字段不进结果", () => {
    expect(
      parseCodePuppySidecarInbound({
        type: "codepuppy.hub.view.request",
        id: 3,
        directory: "/work/a",
        sessionID: "ses_1",
        agent: "build",
        query: "pdf",
        extra: "dropped",
      }),
    ).toEqual({ type: "codepuppy.hub.view.request", id: 3, directory: "/work/a", sessionID: "ses_1", agent: "build", query: "pdf" })
    expect(parseCodePuppySidecarInbound({ type: "codepuppy.hub.request.request", id: 4, requestId: "req_abcdefgh" })).toEqual({
      type: "codepuppy.hub.request.request",
      id: 4,
      requestId: "req_abcdefgh",
    })
    expect(
      parseCodePuppySidecarInbound({
        type: "codepuppy.reload.report",
        generation: 7,
        scope: { directory: "/work/a" },
        outcome: "waiting",
        directories: ["/work/a"],
        error: "2 session(s) busy",
      }),
    ).toEqual({
      type: "codepuppy.reload.report",
      generation: 7,
      scope: { directory: "/work/a" },
      outcome: "waiting",
      directories: ["/work/a"],
      error: "2 session(s) busy",
    })
  })

  test("未知 alpha.* type、main → ext 方向、形状不对:一律 undefined", () => {
    const rejected: unknown[] = [
      { type: "codepuppy.hub.install", id: 1, catalogId: "mcp:x" },
      { type: "codepuppy.reload.request", generation: 1, scope: "global", items: [], reason: "x" },
      { type: "codepuppy.hub.view.reply", id: 1, view: { directory: "/", rows: [], warnings: [] } },
      { type: "codepuppy.hub.view.request", id: -1, directory: "/work" },
      { type: "codepuppy.hub.view.request", id: 1.5, directory: "/work" },
      { type: "codepuppy.hub.view.request", id: 1, directory: "" },
      { type: "codepuppy.hub.view.request", id: 1, directory: "/work", sessionID: 7 },
      { type: "codepuppy.hub.request.request", id: 1, requestId: "short" },
      { type: "codepuppy.hub.request.request", id: 1, requestId: "has space in it" },
      { type: "codepuppy.reload.report", generation: 1, scope: "everything", outcome: "reloaded", directories: [] },
      { type: "codepuppy.reload.report", generation: 1, scope: { directory: "/a", extra: 1 }, outcome: "reloaded", directories: [] },
      { type: "codepuppy.reload.report", generation: 1, scope: "global", outcome: "maybe", directories: [] },
      { type: "codepuppy.reload.report", generation: 1, scope: "global", outcome: "reloaded", directories: [3] },
      null,
      "codepuppy.hub.view.request",
      [],
    ]
    for (const message of rejected) expect(parseCodePuppySidecarInbound(message)).toBeUndefined()
  })

  test("族判定只看 alpha. 前缀:write-probe / ready 等既有消息不属于本族", () => {
    expect(isCodePuppySidecarMessage({ type: "codepuppy.anything" })).toBe(true)
    expect(isCodePuppySidecarMessage({ type: "write-probe-result", id: 1, outcome: "writable" })).toBe(false)
    expect(isCodePuppySidecarMessage({ type: "ready" })).toBe(false)
    expect(isCodePuppySidecarMessage(undefined)).toBe(false)
  })

  test("requestId 形状冻结:8–64 位 [A-Za-z0-9_-]", () => {
    expect(isHubRequestId("abcd1234")).toBe(true)
    expect(isHubRequestId("A_b-".repeat(16))).toBe(true)
    expect(isHubRequestId("abc1234")).toBe(false)
    expect(isHubRequestId("x".repeat(65))).toBe(false)
    expect(isHubRequestId("abcd/1234")).toBe(false)
    expect(isHubRequestId(12345678)).toBe(false)
  })

  test("main 构造的重载请求过得了 ext 侧的严格解析;force 只有 true 一种取值", () => {
    const built = buildReloadRequest({
      generation: 2,
      scope: { directory: "/work/a" },
      items: [{ id: "skill:writer", scope: "global" }],
      reason: "installed skill writer",
      force: true,
    })
    expect(parseReloadRequest(built)).toEqual(built)
    expect(parseReloadRequest(buildReloadRequest({ generation: 3, scope: "global", items: [], reason: "x" }))).toEqual({
      type: "codepuppy.reload.request",
      generation: 3,
      scope: "global",
      items: [],
      reason: "x",
    })
    expect(parseReloadRequest({ ...built, force: false })).toBeUndefined()
    expect(parseReloadRequest({ ...built, items: [{ id: "x", scope: "everywhere" }] })).toBeUndefined()
  })
})

// `#1531`:ext 那一侧 —— ext 建的三种过得了 main 的入站解析;main 建的两种应答过得了 ext 的解析,形状不对一律作废。
describe("codepuppy-sidecar-messages — ext 侧 build/parse(#1531)", () => {
  const view: HubView = {
    directory: "/work/a",
    rows: [
      {
        id: "skill:writer",
        scope: "global",
        name: "writer",
        kind: "skill",
        displayName: "Writer",
        description: "writes",
        installed: true,
        enabled: true,
        state: "reload-pending",
        stateReason: { code: "reload-waiting", detail: "1 session(s) busy" },
        authorization: "none",
        agentNote: "本会话权限未核验",
      },
      { id: "mcp:x", scope: null, name: "x", kind: "mcp", displayName: "X", description: "", installed: false, enabled: false, state: "not-installed", authorization: "secret:TOKEN" },
    ],
    warnings: ["w"],
  }

  test("ext 建的三种 ext → main 消息逐字过 main 的入站解析", () => {
    const request = buildHubViewRequest({ id: 9, directory: "/work/a", sessionID: "ses_1", agent: "build", query: "" })
    expect(parseCodePuppySidecarInbound(request)).toEqual(request)
    const query = buildHubRequestQuery(10, "req_abcdefgh")
    expect(parseCodePuppySidecarInbound(query)).toEqual(query)
    const report = buildReloadReport({ generation: 4, scope: { directory: "/work/a" }, outcome: "failed", directories: ["/work/a"], error: "reload failed" })
    expect(parseCodePuppySidecarInbound(report)).toEqual(report)
  })

  test("main 建的两种应答逐字过 ext 的解析(含 error 臂与 record:null)", () => {
    for (const reply of [buildHubViewReply(1, { view }), buildHubViewReply(2, { error: "boom" })]) expect(parseHubViewReply(reply)).toEqual(reply)
    const record = { requestId: "req_abcdefgh", catalogId: "mcp:x", stage: "committed" as const, scope: "project" as const }
    for (const reply of [
      buildHubRequestReply(3, { record }),
      buildHubRequestReply(4, { record: null }),
      buildHubRequestReply(5, { error: "boom" }),
      buildHubRequestReply(6, { record: { requestId: "req_abcdefgh", catalogId: "mcp:x", stage: "failed", reason: "no" } }),
    ])
      expect(parseHubRequestReply(reply)).toEqual(reply)
  })

  test("应答里任何一处形状不对 ⇒ 整条作废(不交给 agent 半个视图)", () => {
    const bad = (patch: Record<string, unknown>) => ({ ...view.rows[0], ...patch })
    const rejectedViews: unknown[] = [
      { type: "codepuppy.hub.view.reply", id: 1, view: { ...view, rows: [bad({ state: "maybe" })] } },
      { type: "codepuppy.hub.view.reply", id: 1, view: { ...view, rows: [bad({ scope: "everywhere" })] } },
      { type: "codepuppy.hub.view.reply", id: 1, view: { ...view, rows: [bad({ stateReason: { code: "nope" } })] } },
      { type: "codepuppy.hub.view.reply", id: 1, view: { ...view, rows: [bad({ installed: "yes" })] } },
      { type: "codepuppy.hub.view.reply", id: 1, view: { ...view, warnings: [3] } },
      { type: "codepuppy.hub.view.reply", id: -1, view },
      { type: "codepuppy.hub.request.reply", id: 1, view },
    ]
    for (const message of rejectedViews) expect(parseHubViewReply(message)).toBeUndefined()
    const rejectedRecords: unknown[] = [
      { type: "codepuppy.hub.request.reply", id: 1, record: { requestId: "short", catalogId: "x", stage: "committed" } },
      { type: "codepuppy.hub.request.reply", id: 1, record: { requestId: "req_abcdefgh", catalogId: "x", stage: "installed" } },
      { type: "codepuppy.hub.request.reply", id: 1, record: { requestId: "req_abcdefgh", catalogId: "x", stage: "committed", scope: "elsewhere" } },
      { type: "codepuppy.hub.request.reply", id: 1 },
      { type: "codepuppy.hub.view.reply", id: 1, record: null },
    ]
    for (const message of rejectedRecords) expect(parseHubRequestReply(message)).toBeUndefined()
  })

  test("#1533:可选 priceNote 逐字保留;缺席不造字段;非字符串拒绝整条应答", () => {
    for (const priceNote of ["预留 US$1.00,按实际用量结算", "", undefined]) {
      const priced = { ...view, rows: [{ ...view.rows[0]!, ...(priceNote === undefined ? {} : { priceNote }) }] }
      expect(parseHubViewReply(buildHubViewReply(1, { view: priced }))).toEqual(buildHubViewReply(1, { view: priced }))
    }
    for (const priceNote of [null, 1, {}, []])
      expect(parseHubViewReply({ type: "codepuppy.hub.view.reply", id: 1, view: { ...view, rows: [{ ...view.rows[0], priceNote }] } })).toBeUndefined()
  })
})
