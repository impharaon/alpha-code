import { afterAll, expect, mock, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// DBHub 来自 src/renderer/extensions/testvectors/d5-old-catalog.json(2026-08-31.2 的真实历史目录样本)。
import catalogProvenance from "../test-fixtures/plugin-helper/catalog/provenance.json"
import currentCatalog from "../src/renderer/extensions/codepuppy-catalog.json"
import bundledCatalog from "../src/renderer/extensions/testvectors/d5-old-catalog.json"
// `#777`:本文件跑的是生产 `ext-install-catalog` 全链,里面有 ADR-026 的平台闸
// (`platforms: ["darwin","win32"]`)。在 ubuntu runner 上不声明这一条,两条用例量到的是
// 「runner 不是发布平台」而不是「返回值不回显 canary」。必须在任何生产模块 import 之前调。
import { pinShippedPlatform } from "./pin-shipped-platform"
import { PROJECT_HIDDEN_DIR } from "../src/shared/project-hidden-dir"

pinShippedPlatform()

let pickedDirectory: string | undefined
let catalogOverride: unknown

type IpcHandler = (event: { sender: { id: number } }, ...args: unknown[]) => unknown

const handlers = new Map<string, IpcHandler>()
const root = mkdtempSync(join(tmpdir(), "ext-install-result-"))
const canary = "REQ128_IPC_CANARY_02c9f86a"
const chatEntry = currentCatalog.entries.find((entry) => entry.id === "mcp:playwright")!
// 两条条目覆盖 `ext-ipc.ts` 的**两条**返回分支。R2 审计实测:只测 source="codepuppy" 那条
// 是不够的 —— shipped catalog 的 8 条 MCP 全是 official/community,`source:"codepuppy"` 一条都没有,
// 所以每一次真实首装走的都是 installedDisabled 那条提前返回。往那条分支塞明文,
// 只测另一条时整包 3269 全绿。
const entry = structuredClone(bundledCatalog.entries.find((item) => item.id === "mcp:dbhub")!)
entry.source = "codepuppy"
delete entry.curation

// 未改 source:保持 catalog 里的真实形状(official)⇒ 落 installedDisabled 提前返回那条。
const disabledEntry = structuredClone(bundledCatalog.entries.find((item) => item.id === "mcp:dbhub")!)
disabledEntry.id = "mcp:dbhub-default-off"
disabledEntry.name = "dbhub-default-off"

// Main-owned request stage uses the real catalog install branch.
const agentEntry = structuredClone(bundledCatalog.entries.find((item) => item.id === "mcp:dbhub")!)
agentEntry.id = "mcp:dbhub-agent"
agentEntry.name = "dbhub-agent"

// 项目作用域重载与 agent 直装的金丝雀端到端,各一条目。
const projectEntry = structuredClone(bundledCatalog.entries.find((item) => item.id === "mcp:dbhub")!)
projectEntry.id = "mcp:dbhub-project"
projectEntry.name = "dbhub-project"
// 项目 MCP 不收密钥(main 拒绝 requiredEnvVars 非空的项目安装)
delete (projectEntry.installSpec as { requiredEnvVars?: string[] }).requiredEnvVars
const canaryEntry = structuredClone(bundledCatalog.entries.find((item) => item.id === "mcp:dbhub")!)
canaryEntry.id = "mcp:dbhub-canary"
canaryEntry.name = "dbhub-canary"
canaryEntry.source = "codepuppy"
delete canaryEntry.curation
// 随包 dbhub 带「待核实」声明 ⇒ 不在可安装视图里(agent 看不见、codepuppy_hub_install 答 unknown entry);金丝雀条目去掉它
delete (canaryEntry.installSpec as { _verify?: string })._verify

mock.module("electron", () => ({
  BrowserWindow: class {
    static fromWebContents() {
      return undefined
    }
  },
  dialog: {
    showMessageBox: async () => ({ response: 1, checkboxChecked: false }),
    showOpenDialog: async () => ({ canceled: !pickedDirectory, filePaths: pickedDirectory ? [pickedDirectory] : [] }),
  },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => handlers.set(channel, handler),
  },
}))

mock.module("../src/main/ipc", () => ({
  pickedFiles: {
    read: async () => {
      throw new Error("unexpected picked-file read")
    },
  },
}))

mock.module("../src/main/logging", () => ({
  getLogger: () => ({
    error: () => {},
    log: () => {},
    warn: () => {},
  }),
}))

mock.module("../src/main/ext-advisory-gate", () => ({
  listAdvisoryBlockedFacts: () => ({ ids: [], fresh: true }),
  makeAdvisoryGate: () => () => ({ allowed: true }),
}))

mock.module("../src/main/remote-catalog", () => ({
  downloadRemoteAsset: async () => ({
    ok: false,
    reason: "unexpected remote asset download",
  }),
  readCachedCatalog: () => null,
  registerPackageCatalogReadIpcHandlers: (
    register: (channel: string, handler: IpcHandler) => void,
    refresh: () => Promise<unknown>,
  ) => {
    register("ext-remote-catalog", () => refresh())
    register("ext-package-detail", () => null)
  },
  refreshRemoteCatalog: async () => ({
    source: "remote",
    ...(catalogOverride ? { snapshotDigest: catalogProvenance.files.find(file => file.path === "catalog.json")!.sha256, packageViews: await Promise.all((catalogOverride as { packages: unknown[] }).packages.map(async envelope => {
      const { evaluatePackageForHost } = await import("../src/main/package-installability")
      return evaluatePackageForHost(envelope)
    })) } : {}),
    catalog: catalogOverride ?? { version: bundledCatalog.version, entries: [entry, disabledEntry, agentEntry, projectEntry, canaryEntry, chatEntry] },
    version: bundledCatalog.version,
    fetchedAt: "2026-07-30T00:00:00.000Z",
    via: "channel-dev",
    channel: "dev",
  }),
}))

// `#1529`:安装体不再在当前回答里 dispose + 读 status;MCP 是否连上由 hub-view 按目录核验(这里桩成已连接)。
mock.module("../src/main/ext-mcp-activation", () => ({
  verifyInstalledMcp: async (name: string) => ({
    reference: name,
    status: "connected",
  }),
  probeProjectMcpActivation: async () => "unverifiable" as const,
}))

// Keep the real runtime activation implementation; record the package identity at its main seam.
const activationModule = await import("../src/main/package-mcp-activation")
const applyRuntime = activationModule.applyPackageMcpV1
const removeRuntime = activationModule.removePackageMcpV1
const packageAppliesAt = activationModule.packageAppliesAt
const credentialActivations: string[] = []
let heldRuntime: { entered(): void; release: Promise<void> } | undefined
mock.module("../src/main/package-mcp-activation", () => ({
  applyPackageMcpV1: async (...args: Parameters<typeof applyRuntime>) => { credentialActivations.push(args[0]); if(heldRuntime){heldRuntime.entered();await heldRuntime.release} return applyRuntime(...args) },
  removePackageMcpV1: removeRuntime,
  packageAppliesAt,
}))

const { initCodePuppyEnvironment } = await import("../src/main/codepuppy-environment")
const { registerExtIpcHandlers } = await import("../src/main/ext-ipc")

delete process.env.CODEPUPPY_GLOBAL_DIR
initCodePuppyEnvironment({
  isPackaged: false,
  channel: "dev",
  appDataDir: root,
  baseRoot: join(root, "codepuppy-state"),
  homeDir: join(root, "home"),
})
const { codepuppySidecar, pluginSources } = registerExtIpcHandlers(
  join(root, "user-data"),
  "dev",
  async () => ({
    url: "http://127.0.0.1:39117",
    username: "opencode",
    password: "route-password",
  }),
  join(root, "home"),
  undefined, async () => undefined,
)
// `#1529`:像 server.ts 在 sidecar ready 时那样接上发送口 —— 装完之后发往 ext 的东西都落在这里。
const toSidecar: Array<Record<string, unknown>> = []
codepuppySidecar.attach((message) => void toSidecar.push(message as Record<string, unknown>))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

// Actual IPC/recovery gate; only the external capture or engine boundary is held.
for (const boundary of ["capture", "runtime"] as const) test("R12 A1 " + boundary + " cannot hold the global write mutex",async()=>{
 const {fixtureFetch}=await import("../test-fixtures/plugin-helper/source-fetch")
 const fetchSpy=spyOn(globalThis,"fetch").mockImplementation(fixtureFetch)
 const entered=Promise.withResolvers<void>()
 const release=Promise.withResolvers<void>()
 const candidate=(await pluginSources.searchSources("playwright")).candidates.find(candidate=>candidate.source==="claude-marketplace")!
 const original=pluginSources.convertCandidate
 const conversion=boundary==="capture"?spyOn(pluginSources,"convertCandidate").mockImplementation(async id=>{entered.resolve();await release.promise;return original(id)}):undefined
 if(boundary==="runtime")heldRuntime={entered:()=>entered.resolve(),release:release.promise}
 const installing=handlers.get("ext-install-from-source")!({sender:{id:1}},{requestId:"r12_lock_"+boundary,source:{kind:"candidate",candidateId:candidate.id},effect:{kind:"all-projects"},via:"hub"})
 let reload:Promise<unknown>|undefined
 try{
  await entered.promise
  reload=Promise.resolve(handlers.get("ext-reload-request")!({sender:{id:1}},{scope:"global",items:[],reason:"r12 write availability"}))
  const available=await Promise.race([reload.then(()=>true),Bun.sleep(1000).then(()=>false)])
  expect(available).toBe(true)
 }finally{
  release.resolve()
  conversion?.mockRestore()
  const outcome=await installing as {ok:boolean;packageId?:string}
  heldRuntime=undefined
  await reload
  if(outcome.packageId)await handlers.get("ext-uninstall-package")!({sender:{id:1}},outcome.packageId)
  fetchSpy.mockRestore()
 }
},10000)

test("真实 ext-install-catalog 返回值只含公开状态且不回显 canary", async () => {
  const install = handlers.get("ext-install-catalog")
  if (!install) throw new Error("ext-install-catalog handler was not registered")
  const intent = {
    catalogId: entry.id,
    scope: { scope: "global" },
    grants: {
      secrets: { DSN: canary },
    },
  }
  const first = await install({ sender: { id: 1 } }, intent)
  if (
    !first ||
    typeof first !== "object" ||
    (first as { ok?: unknown }).ok !== false ||
    (first as { stage?: unknown }).stage !== "authorize"
  )
    throw new Error(`expected authorization pause, got ${JSON.stringify(first)}`)
  const confirmed = Object.fromEntries(
    (
      first as {
        authorization: Array<{
          key: string
          requested: unknown
          requiresConfirmation: boolean
        }>
      }
    ).authorization
      .filter((decision) => decision.requiresConfirmation)
      .map((decision) => [decision.key, decision.requested]),
  )
  const result = await install({ sender: { id: 1 } }, { ...intent, authorization: { confirmed } })
  if (!result || typeof result !== "object") throw new Error(`expected install result, got ${JSON.stringify(result)}`)
  expect(result).toMatchObject({
    ok: true,
    kind: "mcp",
    name: entry.name,
  })
  const allowed = new Set(["ok", "kind", "name", "manifestDigest", "warning"])
  expect(
    Object.keys(result).every((key) => allowed.has(key)),
    JSON.stringify(result),
  ).toBe(true)
  expect(JSON.stringify(result)).not.toContain(canary)
  // `#1529`:提交成功之后是**请 ext 重载**(global,带这一项),而不是在这里 dispose。
  expect(toSidecar.at(-1)).toMatchObject({
    type: "codepuppy.reload.request",
    scope: "global",
    items: [{ id: entry.id, scope: "global" }],
  })
  expect(JSON.stringify(toSidecar)).not.toContain(canary)
})

// REQ-128 #702 R1 审计 B1:package 的两条 IPC 生产接线必须真的在 registerExtIpcHandlers 里。
// 原 wiring 用例自己调 registerPackageCatalogReadIpcHandlers / runCatalogInstallWithPackagePreflight,
// 于是 `ext-ipc.ts` 退回裸 ipcMain.handle / 裸 installCatalog 之后全量仍全绿。
// 本文件起的是**真的** registerExtIpcHandlers,所以这两条断言删接线即红。
test("REQ-128:真 registerExtIpcHandlers 注册了 package detail 通道", () => {
  expect(handlers.has("ext-package-detail")).toBe(true)
})

test("REQ-128:带 attempt identity 的意图走 package admission,不落 legacy planner", async () => {
  const install = handlers.get("ext-install-catalog")
  if (!install) throw new Error("ext-install-catalog handler was not registered")
  const result = await install(
    { sender: { id: 1 } },
    {
      catalogId: "skill:not-in-this-catalog",
      scope: { scope: "global" },
      attemptId: "missing-package-attempt",
    },
  )
  // admission 在场:package 权威接手,在本组件桩缺少 verified snapshot digest 时 fail-closed。
  // package 路由被摘掉:意图掉进不懂 package 的 legacy planner,返回另一条错误。
  //
  // `reason` 不能省:它区分 admission 的已签快照重取边界与 legacy catalog lookup。
  expect(result).toMatchObject({
    ok: false,
    reason: "package admission: verified Catalog snapshot digest unavailable",
  })
})

test("REQ-128:browse 通道的数据源是真的 refreshRemoteCatalog", async () => {
  const browse = (await handlers.get("ext-remote-catalog")!({ sender: { id: 1 } })) as {
    version?: string
  } | null
  // 把 registerPackageCatalogReadIpcHandlers 的 refresh 实参换成不刷新的桩时,本行变红。
  expect(browse?.version).toBe(bundledCatalog.version)
})

// 这一条守的是 `ext-ipc.ts` 里 `installedDisabled` 的**提前返回**分支 —— 真实 catalog 里
// 每一次首装走的都是它(8 条 MCP 全非 alpha 源)。上一条用例改了 source 才够得着另一条分支,
// 所以两条缺一不可。
test("默认关的真实 catalog MCP:提前返回分支同样只含公开状态且不回显 canary", async () => {
  const install = handlers.get("ext-install-catalog")
  if (!install) throw new Error("ext-install-catalog handler was not registered")
  const intent = {
    catalogId: disabledEntry.id,
    scope: { scope: "global" },
    grants: {
      secrets: { DSN: canary },
    },
  }
  const first = await install({ sender: { id: 1 } }, intent)
  if (
    !first ||
    typeof first !== "object" ||
    (first as { ok?: unknown }).ok !== false ||
    (first as { stage?: unknown }).stage !== "authorize"
  )
    throw new Error(`expected authorization pause, got ${JSON.stringify(first)}`)
  const confirmed = Object.fromEntries(
    (
      first as {
        authorization: Array<{ key: string; requested: unknown; requiresConfirmation: boolean }>
      }
    ).authorization
      .filter((decision) => decision.requiresConfirmation)
      .map((decision) => [decision.key, decision.requested]),
  )
  const result = await install({ sender: { id: 1 } }, { ...intent, authorization: { confirmed } })
  if (!result || typeof result !== "object") throw new Error(`expected install result, got ${JSON.stringify(result)}`)
  // 走到的必须真是提前返回那条:第三方 MCP 默认关。若这里变成 false,说明分支覆盖又漂掉了。
  expect((result as { installedDisabled?: unknown }).installedDisabled, JSON.stringify(result)).toBe(true)
  const allowedDisabled = new Set(["ok", "kind", "name", "manifestDigest", "installedDisabled", "warning"])
  expect(
    Object.keys(result).every((key) => allowedDisabled.has(key)),
    JSON.stringify(result),
  ).toBe(true)
  expect(JSON.stringify(result)).not.toContain(canary)
})

// ── REQ-234 `#1529` ─────────────────────────────────────────────────────────────────────────
// 下面两条走的是**真** registerExtIpcHandlers 交出来的两个入口:定制中心的 `ext-hub-view` IPC 与 parentPort 的
// `codepuppy.*` 分发。把其中一个改成自己算一份(或把会话字段带进状态计算),I4 这条就红。

const directory = join(root, "workspace")

test("#1529 I4:同一目录,定制中心(IPC)与 agent(parentPort)读到逐行同档同原因", async () => {
  const hubView = handlers.get("ext-hub-view")
  if (!hubView) throw new Error("ext-hub-view handler was not registered")
  const fromHub = (await hubView({ sender: { id: 1 } }, directory)) as { rows: Array<Record<string, unknown>> }
  const replies: Array<Record<string, unknown>> = []
  expect(
    codepuppySidecar.receive(
      { type: "codepuppy.hub.view.request", id: 41, directory, sessionID: "ses_x", agent: "build" },
      (message) => void replies.push(message as Record<string, unknown>),
    ),
  ).toBe(true)
  for (let i = 0; i < 100 && replies.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20))
  const reply = replies[0] as { id: number; view?: { rows: Array<Record<string, unknown>> } }
  expect(reply.id).toBe(41)
  const strip = (rows: Array<Record<string, unknown>>) => rows.map(({ agentNote: _note, ...rest }) => rest)
  expect(strip(reply.view!.rows)).toEqual(strip(fromHub.rows))
  const installed = fromHub.rows.find((row) => row.id === entry.id && row.scope === "global")
  expect(installed).toMatchObject({ installed: true, enabled: true, state: "available" })
  expect(fromHub.rows.find((row) => row.id === disabledEntry.id && row.scope === "global")).toMatchObject({
    installed: true,
    enabled: false,
    state: "installed",
  })
  expect(JSON.stringify(fromHub)).not.toContain(canary)
})

test("A3 sidecar installs a main-known catalog ID and renderer can only read its progress", async () => {
 const requestId="req_agent_0001"
 const replies: unknown[]=[]
 expect(handlers.has("ext-hub-request-stage")).toBe(false)
 const stage=handlers.get("ext-hub-request")!
 codepuppySidecar.receive({type:"codepuppy.hub.install.request",id:50,requestId,directory:join(root,"workspace"),sessionID:"ses_stage",agent:"build",ref:{kind:"id",id:chatEntry.id},scope:"all-projects"},message=>{replies.push(message)})
 expect(replies).toEqual([{type:"codepuppy.hub.install.reply",id:50,accepted:true}])
 for(let attempt=0;attempt<100;attempt++) {
  const record=await stage({sender:{id:1}},requestId) as {stage:string}
  if(record.stage!=="submitted")break
  await Bun.sleep(10)
 }
 expect(await stage({sender:{id:1}},requestId)).toMatchObject({stage:"committed",packageId:chatEntry.id,outcome:{ok:true}})
 expect(await stage({sender:{id:1}},{requestId,stage:"failed"})).toBeNull()
})

// ── REQ-234 `#1531` ─────────────────────────────────────────────────────────────────────────

/** 两段式安装(授权暂停 → 带全部需确认项重驱),与 Hub / 确认框守望者同一出站形状。 */
async function installTwice(intent: Record<string, unknown>) {
  const install = handlers.get("ext-install-catalog")!
  const first = (await install({ sender: { id: 1 } }, intent)) as {
    stage?: string
    authorization: Array<{ key: string; requested: unknown; requiresConfirmation: boolean }>
  }
  if (first?.stage !== "authorize") throw new Error(`expected authorization pause, got ${JSON.stringify(first)}`)
  const confirmed = Object.fromEntries(first.authorization.filter((d) => d.requiresConfirmation).map((d) => [d.key, d.requested]))
  return (await install({ sender: { id: 1 } }, { ...intent, authorization: { confirmed } })) as Record<string, unknown>
}

// #1529 审计 Minor ③:项目作用域提交成功 ⇒ 只请 ext 重载**该项目目录**(items 带 project 作用域),不是 global。
test("#1531:项目作用域安装 ⇒ 发往 ext 的是 { scope:{ directory }, items:[{ scope:'project' }] }", async () => {
  const projectDir = join(root, "project-a")
  mkdirSync(join(projectDir, PROJECT_HIDDEN_DIR), { recursive: true })
  const result = await installTwice({ catalogId: projectEntry.id, scope: { scope: "project", projectDir } })
  expect(result.ok, JSON.stringify(result)).toBe(true)
  expect(toSidecar.at(-1)).toMatchObject({
    type: "codepuppy.reload.request",
    scope: { directory: projectDir },
    items: [{ id: projectEntry.id, scope: "project" }],
  })
})

// 基线 §2.4 的金丝雀端到端(I2):agent 的 codepuppy_hub_install(**生产** ext 工具)经 parentPort 形状的消息接到**真** main 分发;
// main 受理请求并通过统一入口提交;工具不通过审批运输安装参数。
// 金丝雀值在工具参数、工具输出与 metadata、审批请求载荷、parentPort 双向全部消息、发往 ext 的重载请求里 **零命中**;
// 对照组:同一个值在 main 落盘的密钥文件里**必须命中**(证明这把 grep 看得见它)。
test("A3 canary stays in main secret files while the production tool/bridge/main chain installs without approval transport", async () => {
 const {createHubBridge}=await import("../../ext/src/hub-bridge")
 const {createHubTools}=await import("../../ext/src/hub-tools")
 const value="REQ234_AGENT_CANARY_7b31e0d4"
 // Account setup uses the existing main-owned secret writer; no secret enters the chat tool.
 expect((await installTwice({catalogId:canaryEntry.id,scope:{scope:"global"},grants:{secrets:{DSN:value}}})).ok).toBe(true)
 const wire:unknown[]=[]
 const listeners:Array<(event:{data:unknown})=>void>=[]
 const bridge=createHubBridge({postMessage:message=>{wire.push(message);codepuppySidecar.receive(message,reply=>{wire.push(reply);for(const listener of listeners)listener({data:reply})})},on:(_event,listener)=>{listeners.push(listener)}},{log:()=>{}})
 const asks:unknown[]=[]
 const context={location:{directory:join(root,"workspace")},permission:{assert:async(input:unknown)=>{asks.push(input);throw Error("chat must not assert")}}}
 const ctx={sessionID:"ses_canary",messageID:"msg_canary",agent:"build",id:"call_canary",signal:new AbortController().signal,progress:async()=>{}}
 const args={id:canaryEntry.id}
 // I-10:执行闸的那一次审批由生产 policy.askInstall 承接(plugin-host.test.ts 的 I-10 用例判);这里记下它被调用、视为已允许,
 // 它收到的调用身份同样进金丝雀扫描面。
 const approvals:unknown[]=[]
 const install=createHubTools(bridge,context as never,async call=>void approvals.push(call)).find(tool=>tool.name==="codepuppy_hub_install")!
 const result=await install.execute(args,ctx as never)
 expect(asks).toEqual([])
 expect(approvals).toEqual([{sessionID:"ses_canary",messageID:"msg_canary",id:"call_canary"}])
 expect(result).toMatchObject({metadata:{packageId:canaryEntry.id,stage:"committed"}})
 for(const surface of [args,result,asks,approvals,wire,toSidecar])expect(JSON.stringify(surface)).not.toContain(value)
 expect(wire.some(message=>(message as {type:string}).type==="codepuppy.hub.install.request")).toBe(true)
 expect(wire.some(message=>(message as {type:string}).type==="codepuppy.hub.request.reply")).toBe(true)
 expect(await bridge.packageAuthorization("not-in-ledger")).toMatchObject({ok:false})
 const hits:string[]=[]
 const walk=(dir:string):void=>{for(const item of readdirSync(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isDirectory())walk(path);else if(readFileSync(path).includes(value))hits.push(path)}}
 walk(root)
 expect(hits.length).toBeGreaterThan(0)
 expect(hits.every(path=>/secret/i.test(path)),JSON.stringify(hits)).toBe(true)
})


test("BC1 renderer source query and sidecar share main IDs, and search selection uses the source entry", async () => {
 const {fixtureFetch}=await import("../test-fixtures/plugin-helper/source-fetch")
 const fetchSpy=spyOn(globalThis,"fetch").mockImplementation(fixtureFetch)
 try {
  const search=handlers.get("ext-sources-search")
  expect(search).toBeFunction()
  const before=await search!({sender:{id:1}},"context7") as import("../src/main/plugin-sources").SourceSearchResultV1
  const candidate=before.candidates.find(candidate=>candidate.source==="claude-marketplace")!
  expect(candidate).toBeDefined()
  expect(candidate.installed).toBeUndefined()
  const replies:unknown[]=[]
  codepuppySidecar.receive({type:"codepuppy.sources.search.request",id:819,directory:root,query:"context7"}, reply=>replies.push(reply))
  for(let n=0;n<200&&!replies.length;n++)await Bun.sleep(5)
  expect(replies).toMatchObject([{type:"codepuppy.sources.search.reply",result:{candidates:[{id:candidate.id}]}}])
  const installed=await handlers.get("ext-install-from-source")!({sender:{id:1}},{requestId:"bc1_search_install",source:{kind:"candidate",candidateId:candidate.id},effect:{kind:"all-projects"},via:"hub"}) as import("../src/shared/plugin-install").InstallOutcomeV1
  expect(installed).toMatchObject({ok:true,packageId:"claude:context7"})
  const after=await search!({sender:{id:1}},"context7") as typeof before
  expect(after.candidates.find(item=>item.id===candidate.id)?.installed).toEqual({packageId:"claude:context7",enabled:true})
 } finally {fetchSpy.mockRestore()}
})


test("BC1 real formal GitHub identity wins for both chat and source plus without a second external package",async()=>{
 const formal=await Bun.file(join(import.meta.dir,"../test-fixtures/plugin-helper/catalog/catalog.json")).json()
 const provenance=await Bun.file(join(import.meta.dir,"../test-fixtures/plugin-helper/catalog/provenance.json")).json() as {files:{url:string;path:string}[]}
 const {fixtureFetch}=await import("../test-fixtures/plugin-helper/source-fetch")
 const {createPublicKey,verify}=await import("node:crypto")
 const bytes=await Bun.file(join(import.meta.dir,"../test-fixtures/plugin-helper/catalog/catalog.json")).bytes()
 const signature=Buffer.from((await Bun.file(join(import.meta.dir,"../test-fixtures/plugin-helper/catalog/catalog.json.sig")).text()).trim(),"base64")
 expect(verify(null,bytes,createPublicKey({key:Buffer.from("MCowBQYDK2VwAyEAqBBmG0mbZ3tZF7Vt8VEWhgm1RQdF2boFU5uUTSmsgHI=","base64"),format:"der",type:"spki"}),signature)).toBe(true)
 const fetchSpy=spyOn(globalThis,"fetch").mockImplementation(async(url)=>{
  const file=provenance.files.find(file=>file.url===String(url))
  return file ? new Response(await Bun.file(join(import.meta.dir,"../test-fixtures/plugin-helper/catalog",file.path)).bytes()) : fixtureFetch(url)
 })
 catalogOverride=formal
 try {
  const search=handlers.get("ext-sources-search")!
  const found=await search({sender:{id:1}},"github") as import("../src/main/plugin-sources").SourceSearchResultV1
  const candidate=found.candidates.find(candidate=>candidate.source==="claude-marketplace"&&candidate.name==="github")!
  expect(candidate.sameAs).toBe("package:github")
  const replies:unknown[]=[]
  codepuppySidecar.receive({type:"codepuppy.hub.install.request",id:820,requestId:"bc1_catalog_chat",directory:root,sessionID:"bc1_session",agent:"build",ref:{kind:"id",id:candidate.id},scope:"all-projects"},reply=>replies.push(reply))
  expect(replies).toMatchObject([{accepted:true}])
  let record:import("../src/main/codepuppy-sidecar-messages").HubRequestRecord|null=null
  for(let n=0;n<400;n++){record=await handlers.get("ext-hub-request")!({sender:{id:1}},"bc1_catalog_chat") as typeof record;if(record?.stage!=="submitted")break;await Bun.sleep(5)}
  expect(record?.outcome).toMatchObject({ok:true,packageId:"package:github",resolvedToCatalog:"package:github"})
  const selected=await handlers.get("ext-install-from-source")!({sender:{id:1}},{requestId:"bc1_catalog_plus",source:{kind:"candidate",candidateId:candidate.id},effect:{kind:"all-projects"},via:"hub"})
  expect(selected).toMatchObject({ok:true,packageId:"package:github",resolvedToCatalog:"package:github"})
  const state=await handlers.get("ext-installed-packages")!({sender:{id:1}}) as import("../src/preload/types").InstalledPackagesResultV1
  expect(state.ok).toBe(true)
  if(!state.ok)throw Error(state.reason)
  expect(state.packages.filter(pack=>pack.packageId==="package:github")).toHaveLength(1)
  expect(state.packages.find(pack=>pack.packageId==="package:github")?.version).toBe("1.0.1")
  expect(state.packages.some(pack=>pack.source?.kind==="marketplace"&&pack.source.entryName==="github")).toBe(false)
 } finally {catalogOverride=undefined;fetchSpy.mockRestore()}
})


test("BC2a.2 main picker captures a whole package without exposing its path or writing before selection", async () => {
 const {captureFixture}=await import("../test-fixtures/plugin-helper/fixture")
 const {createHash}=await import("node:crypto")
 const capture=await captureFixture("plugins/frontend-design")
 const directory=join(root,"picked-frontend")
 for(const node of capture.nodes)if(node.kind==="file"){
  const path=join(directory,node.path);mkdirSync(join(path,".."),{recursive:true});await Bun.write(path,await capture.readFile(node.path))
 }
 const digest=()=>capture.nodes.filter(node=>node.kind==="file").map(node=>createHash("sha256").update(readFileSync(join(directory,node.path))).digest("hex"))
 const before=digest()
 const list=()=>handlers.get("ext-installed-packages")!({sender:{id:1}})
 const old=await list()
 const prepare=handlers.get("ext-prepare-plugin-source")
 expect(prepare).toBeFunction()
 pickedDirectory=directory
 try {
  const result=await prepare!({sender:{id:1}},{kind:"folder"}) as {ok:true;prepared:{kind:string;candidateId:string;displayName:string}}
  expect(result).toMatchObject({ok:true,prepared:{kind:"package",displayName:"frontend-design"}})
  expect(result.prepared.candidateId).toMatch(/^cand_/)
  expect(JSON.stringify(result)).not.toContain(directory)
  expect(JSON.stringify(result)).not.toContain("SKILL.md")
  expect(await list()).toEqual(old)
  const outcome=await handlers.get("ext-install-from-source")!({sender:{id:1}},{requestId:"bc2a_folder_entry",source:{kind:"folder"},effect:{kind:"all-projects"},via:"hub"})
  expect(outcome).toMatchObject({ok:true,packageId:"local:frontend-design",source:{kind:"local-folder"}})
  expect(digest()).toEqual(before)
 } finally {pickedDirectory=undefined}
 const after=await list()
 expect(await prepare!({sender:{id:1}},{kind:"folder"})).toMatchObject({ok:false,canceled:true})
 expect(await list()).toEqual(after)
 expect(await prepare!({sender:{id:1}},{kind:"folder",path:directory})).toMatchObject({ok:false})
})

test("BC2a.2 Git market transport prepares real choices; only the selected entry reaches the installer",async()=>{
 const {fixtureFetch}=await import("../test-fixtures/plugin-helper/source-fetch")
 const fetchSpy=spyOn(globalThis,"fetch").mockImplementation(url=>fixtureFetch(String(url).replace("/tar.gz/HEAD","/tar.gz/refs/heads/main")))
 try {
  const list=()=>handlers.get("ext-installed-packages")!({sender:{id:1}})
  const before=await list()
  const prepared=await handlers.get("ext-prepare-plugin-source")!({sender:{id:1}},{kind:"git",url:"https://github.com/anthropics/claude-plugins-official"}) as {ok:true;prepared:{kind:string;entries:{id:string;displayName:string;source:string}[]}}
  expect(prepared).toMatchObject({ok:true,prepared:{kind:"marketplace"}})
  expect(prepared.prepared.entries.length).toBeGreaterThan(300)
  const selected=prepared.prepared.entries.find(entry=>entry.displayName==="context7")!
  expect(selected.source).toBe("claude-marketplace")
  expect(await list()).toEqual(before)
  const outcome=await handlers.get("ext-install-from-source")!({sender:{id:1}},{requestId:"bc2a_market_selected",source:{kind:"candidate",candidateId:selected.id},effect:{kind:"all-projects"},via:"hub"})
  expect(outcome).toMatchObject({ok:true,packageId:"claude:context7"})
  const after=await list() as {ok:true;packages:{packageId:string}[]}
  const previous=before as typeof after
  expect(after.packages.filter(pack=>pack.packageId!=="claude:context7")).toEqual(previous.packages.filter(pack=>pack.packageId!=="claude:context7"))
  expect(after.packages.filter(pack=>pack.packageId==="claude:context7")).toHaveLength(1)
 }finally{fetchSpy.mockRestore()}
})


test("BC2b old Hub skill import and plugin confirmation transports are retired",()=>{
 for(const channel of ["ext-import-skill-folder","ext-import-skill-git","ext-import-claude-plugin-preview","ext-import-claude-plugin-cancel","ext-import-claude-plugin-confirm"])
  expect(handlers.has(channel),channel).toBe(false)
 expect(handlers.has("ext-import-agent-confirm")).toBe(true)
 expect(handlers.has("ext-install-from-source")).toBe(true)
})

test("BC2b ordinary reload transport stays active after old import transports retire",async()=>{
 const reload=handlers.get("ext-reload-request")
 expect(reload).toBeFunction()
 const result=await reload!({sender:{id:1}},{scope:"global",items:[],reason:"normal reload after local import retirement"})
 expect(result).toMatchObject({ok:true})
 expect((result as {generation:number}).generation).toBeGreaterThan(0)
})


test("BC3 production account save re-applies the same standalone MCP package and reads its saved state without a Location reload",async()=>{
 const {fixtureFetch}=await import("../test-fixtures/plugin-helper/source-fetch")
 const fetchSpy=spyOn(globalThis,"fetch").mockImplementation(fixtureFetch)
 try{
  const found=await handlers.get("ext-sources-search")!({sender:{id:1}},"io.github.github/github-mcp-server") as import("../src/main/plugin-sources").SourceSearchResultV1
  const candidate=found.candidates.find(candidate=>candidate.source==="mcp-registry")!
  expect(candidate).toBeDefined()
  const result=await handlers.get("ext-install-from-source")!({sender:{id:1}},{requestId:"bc3_registry_account_install",source:{kind:"candidate",candidateId:candidate.id},effect:{kind:"all-projects"},via:"hub"}) as import("../src/shared/plugin-install").InstallOutcomeV1
  expect(result.ok,JSON.stringify(result)).toBe(true)
  if(!result.ok)throw Error(result.detail)
  const read=()=>handlers.get("ext-package-authorization")!({sender:{id:1}},result.packageId) as Promise<import("../src/shared/package-admission").PackageAuthorizationResultV1>
  const pending=await read()
  expect(pending).toMatchObject({ok:true,items:[{kind:"secret",saved:false}]})
  if(!pending.ok)throw Error(pending.reason)
  const item=pending.items.find(item=>item.kind==="secret")!
  const before=credentialActivations.length
  const reloads=toSidecar.filter(message=>message.type==="codepuppy.reload.request").length
  const saved=await handlers.get("ext-save-package-secrets")!({sender:{id:1}},{packageId:result.packageId,secrets:{[item.prerequisiteId]:"bc3-production-invalid-token"}})
  expect(saved).toMatchObject({ok:true})
  expect(credentialActivations.slice(before)).toEqual([result.packageId])
  expect(toSidecar.filter(message=>message.type==="codepuppy.reload.request")).toHaveLength(reloads)
  expect(await read()).toMatchObject({ok:true,packageId:result.packageId,items:[{saved:true}]})
  expect(JSON.stringify(toSidecar)).not.toContain("bc3-production-invalid-token")
 }finally{fetchSpy.mockRestore()}
})


test("R14 B3 current Registry package account state crosses the real tool bridge and matches renderer state", async () => {
 const {fixtureFetch}=await import("../test-fixtures/plugin-helper/source-fetch")
 const {createHubBridge}=await import("../../ext/src/hub-bridge")
 const fetchSpy=spyOn(globalThis,"fetch").mockImplementation(fixtureFetch)
 try {
  const result=await handlers.get("ext-sources-search")!({sender:{id:1}},"io.github.github/github-mcp-server") as import("../src/main/plugin-sources").SourceSearchResultV1
  const candidate=result.candidates.find(item=>item.source==="mcp-registry")!
  expect(candidate).toBeDefined()
  const installed=await handlers.get("ext-install-from-source")!({sender:{id:1}},{requestId:"r14_account_package",source:{kind:"candidate",candidateId:candidate.id},effect:{kind:"all-projects"},via:"hub"}) as import("../src/shared/plugin-install").InstallOutcomeV1
  expect(installed.ok).toBe(true)
  if(!installed.ok)throw Error(installed.code)
  const wire:unknown[]=[]
  const listeners:Array<(event:{data:unknown})=>void>=[]
  const bridge=createHubBridge({postMessage:message=>{wire.push(message);codepuppySidecar.receive(message,reply=>{wire.push(reply);listeners.forEach(listener=>listener({data:reply}))})},on:(_event,listener)=>{listeners.push(listener)}},{log:()=>{}})
  const read=()=>handlers.get("ext-package-authorization")!({sender:{id:1}},installed.packageId)
  const before=await bridge.packageAuthorization(installed.packageId)
  expect(before).toEqual(await read())
  expect(before).toMatchObject({ok:true,packageId:installed.packageId,items:[{kind:"secret"}]})
  if(!before.ok)throw Error("current package declarations unavailable")
  const secret=before.items.find(item=>item.kind==="secret")!
  const value="R14_DECLARED_PACKAGE_TOKEN_CANARY"
  expect(await handlers.get("ext-save-package-secrets")!({sender:{id:1}},{packageId:installed.packageId,secrets:{[secret.prerequisiteId]:value}})).toMatchObject({ok:true})
  expect(await bridge.packageAuthorization(installed.packageId)).toMatchObject({ok:true,items:[{kind:"secret",saved:true}]})
  expect(await bridge.packageAuthorization(installed.packageId)).toEqual(await read())
  expect(await bridge.packageAuthorization("not-in-ledger")).toMatchObject({ok:false})
  expect(JSON.stringify(wire)).not.toContain(value)
  expect(JSON.stringify(wire)).not.toContain("{file:")
  expect(JSON.stringify(wire)).not.toContain("declarations")
 }finally{fetchSpy.mockRestore()}
})

test("R14 source progress is sent only to its correlated renderer request", async () => {
 const {fixtureFetch}=await import("../test-fixtures/plugin-helper/source-fetch")
 const fetchSpy=spyOn(globalThis,"fetch").mockImplementation(fixtureFetch)
 try{
  const progress:unknown[]=[]
  const result=await handlers.get("ext-sources-search")!({sender:{id:1,send:(...args:unknown[])=>progress.push(args)}} as never,"context7","r14_search_progress")
  expect(progress.length).toBeGreaterThan(0)
  expect(progress.every(message=>Array.isArray(message)&&message[0]==="ext-sources-search-progress"&&message[1]==="r14_search_progress")).toBe(true)
  expect((progress.at(-1) as unknown[])[2]).toEqual(result)
 }finally{fetchSpy.mockRestore()}
})

test("R14 B6 all previously allowed Git forges prepare a whole real MCP package and clean their clone", async () => {
 const processModule=await import("node:child_process")
 const {captureFixture}=await import("../test-fixtures/plugin-helper/fixture")
 const {existsSync,writeFileSync}=await import("node:fs")
 const capture=await captureFixture("external_plugins/playwright")
 const files=await Promise.all(capture.nodes.filter(node=>node.kind==="file").map(async node=>({path:node.path,bytes:await capture.readFile(node.path)})))
 const cloned:string[]=[],directories:string[]=[]
 // Routing variants use real pinned plugin bytes, not claims that these forge mirrors exist.
 const clone=spyOn(processModule,"execFile").mockImplementation((command,args,options,callback)=>{
  if(command!=="git"||!Array.isArray(args)||typeof callback!=="function")throw Error("unexpected clone boundary")
  cloned.push(String(args.at(-2)));const target=String(args.at(-1));directories.push(target)
  for(const file of files){const dest=join(target,file.path);mkdirSync(join(dest,".."),{recursive:true});writeFileSync(dest,file.bytes)}
  callback(null,"","");return {} as never
 })
 try{
  let selected=""
  for(const host of ["gitlab.com","bitbucket.org","codeberg.org","git.sr.ht"]){
   const result=await handlers.get("ext-prepare-plugin-source")!({sender:{id:1}},{kind:"git",url:`https://${host}/anthropics/claude-plugins-official`}) as import("../src/main/plugin-sources").PreparePluginSourceResultV1
   expect(result).toMatchObject({ok:true,prepared:{kind:"package",displayName:"playwright"}})
   if(result.ok&&result.prepared.kind==="package")selected=result.prepared.candidateId
  }
  expect(cloned).toHaveLength(4)
  expect(directories.every(directory=>!existsSync(directory))).toBe(true)
  expect(await handlers.get("ext-install-from-source")!({sender:{id:1}},{requestId:"r14_forge_package",source:{kind:"candidate",candidateId:selected},effect:{kind:"all-projects"},via:"hub"})).toMatchObject({ok:true,installed:[{kind:"mcp",sourceName:"playwright"}]})
  const before=cloned.length
  expect(await handlers.get("ext-prepare-plugin-source")!({sender:{id:1}},{kind:"git",url:"https://localhost/private"})).toMatchObject({ok:false})
  expect(cloned).toHaveLength(before)
 }finally{clone.mockRestore()}
})

test("R14 A7 main source entry reloads a real bundled agent without force", async () => {
 catalogOverride=currentCatalog
 try{
  const before=toSidecar.filter(message=>message.type==="codepuppy.reload.request").length
  expect(await handlers.get("ext-install-from-source")!({sender:{id:1}},{requestId:"r14_native_agent_reload",source:{kind:"catalog",catalogId:"agent:code-reviewer"},effect:{kind:"all-projects"},via:"chat"})).toMatchObject({ok:true,packageId:"agent:code-reviewer"})
  const requests=toSidecar.filter(message=>message.type==="codepuppy.reload.request").slice(before)
  expect(requests).toContainEqual(expect.objectContaining({scope:"global",items:expect.arrayContaining([expect.objectContaining({id:"agent:code-reviewer"})])}))
  expect(requests.every(request=>!request.force)).toBe(true)
 }finally{catalogOverride=undefined}
})

for(const source of ["created","project"] as const)test("R14 A9 renderer cannot submit "+source+" writes", async () => {
 const {fixtureFetch}=await import("../test-fixtures/plugin-helper/source-fetch")
 const {captureFixture}=await import("../test-fixtures/plugin-helper/fixture")
 const fetchSpy=spyOn(globalThis,"fetch").mockImplementation(fixtureFetch)
 try{
  const search=await pluginSources.searchSources("r14-own-review")
  expect(search.sources.every(source=>source.status==="ok")).toBe(true)
  const capture=await captureFixture("plugins/frontend-design")
  const skill=new TextDecoder().decode(await capture.readFile("skills/frontend-design/SKILL.md")).replaceAll("frontend-design","r14-own-review")
  const project=join(root,"r14-renderer-project");mkdirSync(project,{recursive:true})
  const request={requestId:"r14_renderer_"+source,via:"hub",effect:source==="project"?{kind:"project",directory:project}:{kind:"all-projects"},source:source==="created"?{kind:"created",draft:{searchId:search.searchId,name:"r14-own-review",description:"Review notes",files:[{path:"skills/r14-own-review/SKILL.md",text:skill}]}}:{kind:"catalog",catalogId:chatEntry.id}}
  const before=await handlers.get("ext-installed-packages")!({sender:{id:1}})
  expect(await handlers.get("ext-install-from-source")!({sender:{id:1}},request)).toMatchObject({ok:false,code:"unknown-id"})
  expect(await handlers.get("ext-installed-packages")!({sender:{id:1}})).toEqual(before)
  expect(readdirSync(project)).toEqual([])
 }finally{fetchSpy.mockRestore()}
})

for(const kind of ["catalog","candidate"] as const)test("R14 B8 submitted "+kind+" stage has its main-owned display name before runtime settles",async()=>{
 const {fixtureFetch}=await import("../test-fixtures/plugin-helper/source-fetch")
 const fetchSpy=spyOn(globalThis,"fetch").mockImplementation(fixtureFetch)
 const candidate=(await pluginSources.searchSources("context7")).candidates.find(candidate=>candidate.source==="claude-marketplace")!
 const id=kind==="catalog"?chatEntry.id:candidate.id
 const name=kind==="catalog"?chatEntry.displayName:candidate.displayName
 expect(name).not.toBe(id)
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>()
 const requestId="r14_named_"+kind
 heldRuntime={entered:()=>entered.resolve(),release:release.promise}
 try{
  codepuppySidecar.receive({type:"codepuppy.hub.install.request",id:901,requestId,directory:join(root,"workspace"),sessionID:"ses_name",agent:"build",ref:{kind:"id",id},scope:"all-projects"},()=>{})
  await entered.promise
  expect(handlers.get("ext-hub-request")!({sender:{id:1}},requestId)).toMatchObject({stage:"submitted",displayName:name})
 }finally{
  release.resolve();heldRuntime=undefined
  for(let n=0;n<100;n++){
   const record=handlers.get("ext-hub-request")!({sender:{id:1}},requestId) as {stage:string}
   if(record.stage!=="submitted")break
   await Bun.sleep(10)
  }
  fetchSpy.mockRestore()
 }
})
