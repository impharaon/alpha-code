import { buildWriteScopeReply } from "../../ui-mac/src/main/codepuppy-sidecar-messages"
import { buildPackageManagerControlReply } from "../../ui-mac/src/main/codepuppy-sidecar-messages"
import { delegatePackageManagerShell } from "./hub-bridge"
import type { PreparedShellDelegate, PreparedShellExecution } from "@opencode/plugin/codepuppy-package-manager"
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

test("prepared Shell delegation uses the same host request ledger and binds cleanup to its lease", async () => {
  const wire = fakePort(), bridge = createHubBridge(wire.port, { log: () => {} })
  let handler: (input: PreparedShellExecution) => Promise<PreparedShellDelegate | undefined>
  await delegatePackageManagerShell({ delegatePreparedShell: async (callback) => { handler = callback } }, bridge)
  const input = { shellID: "sh_1", sessionID: "ses_1", messageID: "msg_1", callID: "call_1", command: "brew --prefix", cwd: "/project", shell: "/bin/sh" }
  const pending = handler!(input)
  expect(parseCodePuppySidecarInbound(wire.sent[0])).toMatchObject({ request: { op: "authorize", input } })
  const lease = { executionID: "execution", nodes: [{ nodeID: "node" }], helperService: "service", executionSource: "source", shellPrivateInput: { fd: 3, data: new Uint8Array([10]) } }
  wire.deliver(buildPackageManagerControlReply(1, { ok: true, lease }))
  const delegate = (await pending)!
  expect(delegate.privateInput).toEqual(lease.shellPrivateInput)
  expect(delegate.executionSource).toBe(lease.executionSource)
  const bind = delegate.bindProcess({ pid: 42 })
  wire.deliver(buildPackageManagerControlReply(2, { ok: true }))
  await bind
  const cancel = delegate.cancel("timeout")
  wire.deliver(buildPackageManagerControlReply(3, { ok: true }))
  await cancel
  const finish = delegate.finish()
  wire.deliver(buildPackageManagerControlReply(4, { ok: true }))
  await finish
  expect(wire.sent.slice(1).map((message) => (message as { request: unknown }).request)).toEqual([{ op: "bind", executionID: "execution", pid: 42 }, { op: "cancel", executionID: "execution", reason: "timeout" }, { op: "finish", executionID: "execution" }])
})

test("a failed authorization keeps the original spawn; failed cancel/finish never fail the Shell's own timeout or cleanup", async () => {
  const wire = fakePort(), bridge = createHubBridge(wire.port, { log: () => {} })
  let handler: (input: PreparedShellExecution) => Promise<PreparedShellDelegate | undefined>
  await delegatePackageManagerShell({ delegatePreparedShell: async (callback) => { handler = callback } }, bridge)
  const input = { shellID: "sh_1", sessionID: "ses_1", messageID: "msg_1", callID: "call_1", command: "brew --prefix", cwd: "/project", shell: "/bin/sh" }
  const refused = handler!(input)
  wire.deliver(buildPackageManagerControlReply(1, { ok: false, error: "unavailable" }))
  expect(await refused).toBeUndefined()
  const pending = handler!(input)
  wire.deliver(buildPackageManagerControlReply(2, { ok: true, lease: { executionID: "execution", nodes: [{ nodeID: "node" }], helperService: "service", executionSource: "source", shellPrivateInput: { fd: 3, data: new Uint8Array([10]) } } }))
  const delegate = (await pending)!
  const cancel = delegate.cancel("timeout")
  wire.deliver(buildPackageManagerControlReply(3, { ok: false, error: "unavailable" }))
  await expect(cancel).resolves.toBeUndefined()
  const finish = delegate.finish()
  wire.deliver(buildPackageManagerControlReply(4, { ok: false, error: "unavailable" }))
  await expect(finish).resolves.toBeUndefined()
})

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


test("I-10 the bridge remembers the name and real source main gave each searched candidate, for the install approval card", async () => {
  const { buildSourcesSearchReply } = await import("../../ui-mac/src/main/codepuppy-sidecar-messages")
  const wire = fakePort()
  const bridge = createHubBridge(wire.port, { log: () => {} })
  expect(bridge.installSubject("cand_ctx7")).toBeUndefined()
  const candidate = (id: string, source: "catalog" | "claude-marketplace", displayName: string) => ({ id, source, name: displayName.toLowerCase(), displayName, description: "", kind: "plugin" as const, upstream: {} })
  const result = { searchId: "search_a", query: "docs", sources: [], candidates: [candidate("cand_ctx7", "claude-marketplace", "Context7"), candidate("package:github", "catalog", "GitHub")] }
  const search = bridge.search({ directory: "/work/a", query: "docs" })
  wire.deliver(buildSourcesSearchReply(1, { result }))
  await search
  expect(bridge.installSubject("cand_ctx7")).toEqual({ name: "Context7", source: "claude-marketplace" })
  expect(bridge.installSubject("package:github")).toEqual({ name: "GitHub", source: "catalog" })
  // 拒收的应答不留下任何候选
  const bad = bridge.search({ directory: "/work/a", query: "browser" })
  wire.deliver(buildSourcesSearchReply(2, { result: { ...result, candidates: [{ ...candidate("cand_bad", "claude-marketplace", "Bad"), upstream: { token: "x" } } as never] } }))
  await bad
  expect(bridge.installSubject("cand_bad")).toBeUndefined()
  // 一次很长的会话:记住的条数有上界,最早的先忘;刚搜到的总在
  const many = Array.from({ length: 2100 }, (_, index) => candidate(`cand_${index}`, "claude-marketplace", `P${index}`))
  const big = bridge.search({ directory: "/work/a", query: "many" })
  wire.deliver(buildSourcesSearchReply(3, { result: { ...result, candidates: many } }))
  await big
  expect(bridge.installSubject("cand_ctx7")).toBeUndefined()
  expect(bridge.installSubject("cand_2099")).toEqual({ name: "P2099", source: "claude-marketplace" })
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

test("R13 B3 package account read crosses the bridge with a safe projection and rejects malformed replies", async () => {
  const wire = fakePort()
  const bridge = createHubBridge(wire.port, { log: () => {} })
  const pending = bridge.packageAuthorization("claude:github")
  expect(parseCodePuppySidecarInbound(wire.sent[0])).toEqual({ type: "codepuppy.package.authorization.request", id: 1, packageId: "claude:github" })
  wire.deliver({ type: "codepuppy.package.authorization.reply", id: 1, result: { ok: true, packageId: "claude:github", items: [{ kind: "secret", componentId: "mcp", prerequisiteId: "TOKEN", serviceName: "github", label: "Token", saved: false }] } })
  expect(await pending).toMatchObject({ ok: true, items: [{ saved: false }] })
  const bad = bridge.packageAuthorization("claude:github")
  wire.deliver({ type: "codepuppy.package.authorization.reply", id: 2, result: { ok: true, packageId: "claude:github", items: [{ kind: "secret", componentId: "mcp", prerequisiteId: "TOKEN", serviceName: "github", label: "Token", saved: false, value: "rejected" }] } })
  expect(await bad).toMatchObject({ ok: false })
})

test("R14 chat search receives failed hung-source status within thirty seconds, before its bridge budget", async () => {
 const {jest}=await import("bun:test")
 const {createPluginSources}=await import("../../ui-mac/src/main/plugin-sources")
 const {fixtureFetch}=await import("../../ui-mac/test-fixtures/plugin-helper/source-fetch")
 const {buildSourcesSearchReply}=await import("../../ui-mac/src/main/codepuppy-sidecar-messages")
 const {createHubTools}=await import("./hub-tools")
 let release!: (response:Response)=>void
 const stalled=new Promise<Response>(resolve=>{release=resolve})
 const fetching:Promise<Response>[]=[]
 const sources=createPluginSources({catalog:async()=>[],fetch:url=>{
  if(url.includes("raw.githubusercontent.com/openai"))return stalled
  const response=fixtureFetch(url);fetching.push(response);return response
 }})
 const wire=fakePort()
 const bridge=createHubBridge(wire.port)
 const tool=createHubTools(bridge,{location:{directory:"/work/a"}} as never,async()=>{}).find(tool=>tool.name==="codepuppy_hub_search")!
 jest.useFakeTimers()
 let output:Awaited<ReturnType<typeof tool.execute>>|undefined
 const pending=tool.execute({query:"context7"},{} as never).then(value=>{output=value})
 const request=parseCodePuppySidecarInbound(wire.sent[0])!
 if(request.type!=="codepuppy.sources.search.request")throw Error("wrong chat transport")
 const responding=sources.searchSources(request.query).then(result=>wire.deliver(buildSourcesSearchReply(request.id,{result})))
 try{
  // alpha-work#159 §4.7:清单先问香港转发入口(夹具回 404)再取原地址 —— 第二批请求在第一批落定后才发出,等到没有新请求为止。
  for(let seen=-1;seen!==fetching.length;){seen=fetching.length;await Promise.all(fetching);for(let n=0;n<60;n++)await Promise.resolve()}
  jest.advanceTimersByTime(30_000)
  for(let n=0;n<80;n++)await Promise.resolve()
  expect(output).toBeDefined()
  const result=JSON.parse(output!.content)
  expect(result.sources.find((source:{source:string})=>source.source==="codex-marketplace")).toMatchObject({status:"failed",reason:"network"})
  expect(result.candidates.some((candidate:{name:string})=>candidate.name==="context7")).toBe(true)
 }finally{release(await fixtureFetch("https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json"));await responding;await pending;jest.useRealTimers()}
})

// SPEC-engine-config-fence BR-03 / DESIGN-engine-config-fence §4.5:工具策略的写者走这同一个桥(同一个监听、同一个 id 空间、同一个超时);请求过得了
// main 侧的解析,应答由 main 侧的构造器造。没有 parentPort ⇒ 没有这个写者(registerPolicy 退回直接写,CLI / 单测)。
describe("hub-bridge — tool policy writer (I-13)", () => {
  const partition = { account: "acct:1", workspace: "/work/a" }
  const records = [{ selector: { level: "tool", canonical: "builtin::shell" }, state: "disabled" }] as never

  test("only with a port; save / reset go out as main parses them and settle on main's reply: ok, ok with backup, error, malformed, no answer", async () => {
    const messages = await import("../../ui-mac/src/main/codepuppy-sidecar-messages")
    expect(createHubBridge(undefined).toolPolicy).toBeUndefined()
    const { port, sent, deliver } = fakePort()
    const lines: string[] = []
    const bridge = createHubBridge(port, { timeoutMs: 50, log: (line) => void lines.push(line) })
    const writer = bridge.toolPolicy!
    const saved = writer.save(partition, records)
    expect(messages.parseToolPolicyWriteRequest(sent[0])).toEqual({ type: "codepuppy.tool-policy.write.request", id: 1, op: "save", partition, records })
    deliver(messages.buildToolPolicyWriteReply(1, { ok: true }))
    expect(await saved).toBeUndefined()
    const reset = writer.reset(partition)
    expect(messages.parseToolPolicyWriteRequest(sent[1])).toEqual({ type: "codepuppy.tool-policy.write.request", id: 2, op: "reset", partition })
    deliver(messages.buildToolPolicyWriteReply(2, { ok: true, backup: "/d/x.json.quarantined-1" }))
    expect(await reset).toEqual({ backup: "/d/x.json.quarantined-1" })
    const refused = writer.save(partition, records).catch((error: Error) => error)
    deliver(messages.buildToolPolicyWriteReply(3, { error: "EACCES: permission denied, open '/d/x.json.tmp'" }))
    expect(String(await refused)).toContain("EACCES: permission denied")
    const malformed = writer.save(partition, records).catch((error: Error) => error)
    deliver({ type: "codepuppy.tool-policy.write.reply", id: 4, ok: "yes" })
    expect(await malformed).toBeInstanceOf(Error)
    const silent = await writer.reset(partition).catch((error: Error) => error)
    expect(String(silent)).toContain("did not answer in time")
    expect(lines.filter((line) => line.includes("tool policy write"))).toHaveLength(3)
  })

  test("one id space with the hub requests: a view request and a tool policy write in flight, answered in reverse order, each settles with its own reply", async () => {
    const messages = await import("../../ui-mac/src/main/codepuppy-sidecar-messages")
    const { port, sent, deliver } = fakePort()
    const bridge = createHubBridge(port, { log: () => {} })
    const viewing = bridge.view({ directory: "/work/a" })
    const saving = bridge.toolPolicy!.save(partition, records)
    expect(sent.map((message) => (message as { id: number }).id)).toEqual([1, 2])
    deliver(messages.buildToolPolicyWriteReply(2, { ok: true }))
    deliver(buildHubViewReply(1, { view }))
    expect(await saving).toBeUndefined()
    expect(await viewing).toEqual({ ok: true, view })
  })
})


test("external write scope uses the existing parent port and has no registration operation", async () => {
  const wire = fakePort()
  const bridge = createHubBridge(wire.port, { log: () => {} })
  const input = { access: "write" as const, targets: [{ absolute: "/outside/file", directory: "/outside" }] }
  const promise = bridge.readWriteScope(input)
  expect(parseCodePuppySidecarInbound(wire.sent[0])).toEqual({ type: "codepuppy.write-scope.request", id: 1, ...input })
  wire.deliver(buildWriteScopeReply(1, { revision: 1, targets: [{ absolute: "/outside/file", outcome: "writable" }] }))
  expect(await promise).toEqual({ revision: 1, targets: [{ absolute: "/outside/file", outcome: "writable" }] })
  // C-1: a fixed global/user-config target crosses the same R6 reply.
  const fixed = bridge.readWriteScope(input)
  wire.deliver(buildWriteScopeReply(2, { revision: 1, targets: [{ absolute: "/outside/file", outcome: "fixed" }] }))
  expect(await fixed).toEqual({ revision: 1, targets: [{ absolute: "/outside/file", outcome: "fixed" }] })
  expect(await createHubBridge(undefined, { log: () => {} }).readWriteScope(input)).toEqual({ error: "unavailable" })
})
import { bindDocumentRuntimeVerification } from "./document-runtime-bridge"
import type { Location } from "../../schema/src/location"
import type { DocumentRuntimeVerifyTask } from "../../util/src/codepuppy-document"

describe("document runtime bridge", () => {
  test("early tasks remain for their owning Location, deduplicate execution and terminate cancellation", async () => {
    const wire = fakePort()
    const bridge = createHubBridge(wire.port, { timeoutMs: 1, log: () => {} })
    const location = { directory: "/work/owner" as Location.Ref["directory"] }
    const task: DocumentRuntimeVerifyTask = { kind: "libreoffice", taskId: "task-1", registrationId: "registration-1", sidecarGeneration: 7, location, pinId: "libreoffice/darwin-arm64/test", pinSha256: "a".repeat(64), runtimeRoot: "/state/candidate", jobRoot: "/state/jobs/task-1" }
    wire.deliver({ type: "codepuppy.document.runtime.verify", task })
    let spawned = 0
    const other = bindDocumentRuntimeVerification(bridge, { directory: "/work/other" as Location.Ref["directory"] }, 7, "other-registration", async () => { throw Error("wrong Location") })
    const cleanup = bindDocumentRuntimeVerification(bridge, location, 7, "registration-1", async (task, signal) => {
      spawned++
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
      return { ...task, status: "completed", version: "test", pdfPath: "/state/jobs/task-1/probe.pdf", pdfSha256: "b".repeat(64), pageCount: 1 }
    })
    wire.deliver({ type: "codepuppy.document.runtime.verify", task })
    expect(spawned).toBe(1)
    wire.deliver({ type: "codepuppy.document.runtime.verify.cancel", ref: task })
    await cleanup(); await other()
    expect(wire.sent).toHaveLength(2) // replay has the same terminal result, never another spawn
    expect(wire.sent.every((message) => (message as { receipt: { status: string } }).receipt.status === "cancelled")).toBe(true)
  })
})

test("document verification ignores an old registration in the same Location and generation", async () => {
  const wire = fakePort(); const bridge = createHubBridge(wire.port, { log: () => {} })
  const location = { directory: "/work/owner" as Location.Ref["directory"] }
  let ran = 0
  const cleanup = bindDocumentRuntimeVerification(bridge, location, 7, "new-registration", async (task) => { ran++; return { ...task, status: "cancelled", reason: "requested" } })
  wire.deliver({ type: "codepuppy.document.runtime.verify", task: { kind: "libreoffice", taskId: "old-task", registrationId: "old-registration", sidecarGeneration: 7, location, pinId: "libreoffice/darwin-arm64/test", pinSha256: "a".repeat(64), runtimeRoot: "/state/candidate", jobRoot: "/state/jobs/old" } })
  await cleanup(); expect(ran).toBe(0); expect(wire.sent).toHaveLength(0)
})
