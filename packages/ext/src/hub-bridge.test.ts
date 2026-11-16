// REQ-234 `#1531`:ext 侧 parentPort 请求簿记(hub-bridge.ts)。假 port 只替换 Electron 的 parentPort 那两样(postMessage / on),
// 应答由 main 侧**生产**构造器(buildHubViewReply / buildHubRequestReply / buildReloadRequest)造 —— 合同只有一份。
import { describe, expect, test } from "bun:test"
import {
  buildHubRequestReply,
  buildHubViewReply,
  buildReloadRequest,
  parseCodePuppySidecarInbound,
  type HubView,
} from "../../ui-mac/src/main/codepuppy-sidecar-messages"
import { createHubBridge, type HubPort } from "./hub-bridge"
import { buildUnattendedLive, buildUnattendedAck } from "../../ui-mac/src/main/codepuppy-sidecar-messages"

test("进程级监听安装完整快照后回执,旧快照和坏输入不能改名单", async () => {
  const wire = fakePort()
  const bridge = createHubBridge(wire.port, { log: () => {} })
  const live = buildUnattendedLive({ seq: 1, nonce: "n1", sessions: [{ sessionID: "ses_a", agent: "codepuppy-automation-standard", promptID: "msg_a" }] })
  wire.deliver(live)
  expect(wire.sent).toEqual([buildUnattendedAck(1, "n1")])
  expect(await bridge.unattended.unattendedProfile("ses_a", "codepuppy-automation-standard", async () => "")).toBe("standard")
  wire.deliver({ ...live, seq: 0, sessions: [] })
  wire.deliver({ ...live, seq: 2, sessions: [null] })
  expect(wire.sent).toHaveLength(1)
  expect(await bridge.unattended.unattendedProfile("ses_a", "codepuppy-automation-standard", async () => "")).toBe("standard")
  wire.deliver(buildUnattendedLive({ seq: 2, nonce: "n2", sessions: [] }))
  expect(await bridge.unattended.unattendedProfile("ses_a", "codepuppy-automation-standard", async () => "")).toBeUndefined()
})

function fakePort() {
  const sent: unknown[] = []
  const listeners: Array<(event: { data: unknown }) => void> = []
  const port: HubPort = {
    postMessage: (message) => void sent.push(message),
    on: (_event, listener) => void listeners.push(listener),
  }
  return { port, sent, deliver: (data: unknown) => listeners.forEach((listener) => listener({ data })) }
}

const view: HubView = { directory: "/work/a", rows: [], warnings: [] }

describe("hub-bridge", () => {
  test("视图请求按 id 结算:发出去的过得了 main 的入站解析,应答由 main 的构造器造", async () => {
    const { port, sent, deliver } = fakePort()
    const bridge = createHubBridge(port, { log: () => {} })
    const pending = bridge.view({ directory: "/work/a", sessionID: "ses_1", agent: "build", query: "pdf" })
    const request = parseCodePuppySidecarInbound(sent[0])
    expect(request).toEqual({ type: "codepuppy.hub.view.request", id: 1, directory: "/work/a", sessionID: "ses_1", agent: "build", query: "pdf" })
    deliver(buildHubViewReply(1, { view }))
    expect(await pending).toEqual({ ok: true, view })
  })

  test("阶段查询:record:null 是合法应答;error 臂 ⇒ 失败;两个在途请求互不串号", async () => {
    const { port, sent, deliver } = fakePort()
    const bridge = createHubBridge(port, { log: () => {} })
    const first = bridge.request("req_aaaaaaaa")
    const second = bridge.request("req_bbbbbbbb")
    expect(sent).toEqual([
      { type: "codepuppy.hub.request.request", id: 1, requestId: "req_aaaaaaaa" },
      { type: "codepuppy.hub.request.request", id: 2, requestId: "req_bbbbbbbb" },
    ])
    deliver(buildHubRequestReply(2, { error: "boom" }))
    deliver(buildHubRequestReply(1, { record: null }))
    expect(await first).toEqual({ ok: true, record: null })
    expect(await second).toMatchObject({ ok: false, reason: "error" })
  })

  test("形状不对的应答作废、按失败结算并记一行;未知 id / 非 alpha.* 消息不理", async () => {
    const { port, deliver } = fakePort()
    const lines: string[] = []
    const bridge = createHubBridge(port, { log: (line) => void lines.push(line) })
    const pending = bridge.view({ directory: "/work/a" })
    deliver({ type: "write-probe-result", id: 1, outcome: "writable" })
    deliver(buildHubViewReply(99, { view }))
    deliver({ type: "codepuppy.hub.view.reply", id: 1, view: { directory: "/work/a", rows: [{ id: "x" }], warnings: [] } })
    expect(await pending).toMatchObject({ ok: false, reason: "error" })
    expect(lines.some((line) => line.includes("malformed reply"))).toBe(true)
    expect(lines.some((line) => line.includes("for no pending request"))).toBe(true)
  })

  test("main 不答 ⇒ 超时答「无法判断」;没有 parentPort ⇒ available=false,请求直接答不可用、不挂起", async () => {
    const { port } = fakePort()
    const bridge = createHubBridge(port, { timeoutMs: 10, log: () => {} })
    expect(await bridge.request("req_aaaaaaaa")).toMatchObject({ ok: false, reason: "timeout" })
    const none = createHubBridge(undefined)
    expect(none.available).toBe(false)
    expect(await none.view({ directory: "/w" })).toMatchObject({ ok: false, reason: "unavailable" })
    expect(() => none.report({ generation: 1, scope: "global", outcome: "reloaded", directories: [] })).not.toThrow()
  })

  test("main → ext 的重载请求:挂上处理者之前到的按序缓存、挂上时补交;形状不对的丢弃;报告过得了 main 的解析", () => {
    const { port, sent, deliver } = fakePort()
    const bridge = createHubBridge(port, { log: () => {} })
    deliver(buildReloadRequest({ generation: 1, scope: "global", items: [], reason: "early" }))
    deliver({ type: "codepuppy.reload.request", generation: 2, scope: "everywhere", items: [], reason: "bad" })
    const got: number[] = []
    bridge.onReloadRequest((message) => void got.push(message.generation))
    deliver(buildReloadRequest({ generation: 3, scope: { directory: "/w" }, items: [], reason: "late", force: true }))
    expect(got).toEqual([1, 3])
    bridge.report({ generation: 3, scope: { directory: "/w" }, outcome: "waiting", directories: ["/w"], error: "1 session(s) busy" })
    expect(parseCodePuppySidecarInbound(sent.at(-1))).toEqual({
      type: "codepuppy.reload.report",
      generation: 3,
      scope: { directory: "/w" },
      outcome: "waiting",
      directories: ["/w"],
      error: "1 session(s) busy",
    })
  })
})

test("A3 bridge pairs source search and direct install replies; malformed candidates never reach tools", async () => {
  const { buildSourcesSearchReply, buildHubInstallReply } = await import("../../ui-mac/src/main/codepuppy-sidecar-messages")
  const wire = fakePort()
  const bridge = createHubBridge(wire.port, { log: () => {} })
  const search = bridge.search({ directory: "/work/a", query: "playwright" })
  expect(parseCodePuppySidecarInbound(wire.sent[0])).toMatchObject({ type: "codepuppy.sources.search.request", query: "playwright" })
  const result = { searchId: "search_main", query: "playwright", sources: [{ source: "catalog" as const, status: "ok" as const, matched: 0, skipped: 0 }], candidates: [] }
  wire.deliver(buildSourcesSearchReply(1, { result }))
  expect(await search).toEqual({ ok: true, result })
  const install = bridge.install({ requestId: "request_a3", directory: "/work/a", sessionID: "ses_1", agent: "build", ref: { kind: "id", id: "cand_main" }, scope: "all-projects" })
  expect(parseCodePuppySidecarInbound(wire.sent[1])).toMatchObject({ type: "codepuppy.hub.install.request", ref: { kind: "id", id: "cand_main" } })
  wire.deliver(buildHubInstallReply(2, { accepted: true }))
  expect(await install).toEqual({ ok: true, accepted: true })
  const bad = bridge.search({ directory: "/work/a", query: "browser" })
  wire.deliver(buildSourcesSearchReply(3, { result: { ...result, candidates: [{ id: "cand_bad", source: "claude-marketplace", name: "bad", displayName: "bad", description: "bad", kind: "plugin", upstream: { token: "must-not-cross" } } as never] } }))
  expect(await bad).toMatchObject({ ok: false, reason: "error" })
})


test("R12 B5 source search has its own reply budget while ordinary reads keep 20 seconds",async()=>{
 const {jest}=await import("bun:test")
 const {buildSourcesSearchReply}=await import("../../ui-mac/src/main/codepuppy-sidecar-messages")
 const wire=fakePort()
 const bridge=createHubBridge(wire.port)
 jest.useFakeTimers()
 let readDone=false,searchDone=false
 const read=bridge.view({directory:"/work/a"}).then(result=>{readDone=true;return result})
 const search=bridge.search({directory:"/work/a",query:"playwright"}).then(result=>{searchDone=true;return result})
 try{
  jest.advanceTimersByTime(20_001)
  await Promise.resolve()
  expect(readDone).toBe(true)
  expect(searchDone).toBe(false)
  wire.deliver(buildSourcesSearchReply(2,{result:{searchId:"search_real",query:"playwright",sources:[],candidates:[]}}))
  expect(await search).toMatchObject({ok:true,result:{query:"playwright"}})
  expect(await read).toMatchObject({ok:false,reason:"timeout"})
 }finally{jest.useRealTimers()}
})
