// `#1662` 换代回归:云端生图 / 数据分析的结果落回桌面。桌面认云任务只认**直接**的云工具调用(run-watcher `extractCloudRunHit`、
// 时间线生图卡 `cloudImageOf`、产物行 `artifactLinksOf` 都要求那次调用的 part 本身是第一方云 facade 的 `dispatch` / `artifacts`);
// OpenCode 2 默认把 MCP 工具收进 Code Mode(`packages/core/src/tool/mcp.ts` 的 `codemode: tool.codemode !== false`),模型只能经
// `execute` 间接调它们 ⇒ part 是 `execute`,三处一处都不命中(验证实测:生产云 job_1748ae4cd98e 出了 PNG、job_ccb255627759 出了图表,
// 桌面跟踪 0、生图卡 0、产物行 0)。
//
// 宿主:test-component/codepuppy-engine.ts(生产注入 + 真 ext),桌面一侧走生产引擎适配器(engine-adapter createEngineFetch)拿事件流与
// 消息,判据是 renderer 的三个生产识别函数本身。代付态:启动文档里的治理云 MCP 定义就是生产 `materializeCloudMcpConfig` 算的那一份
// (登录铸的 `CODEPUPPY_MCP_TOKEN` 由生产 `syncSecretFiles` 写),指向本文件的本机 streamable-HTTP 端点;端点的工具表是平台 vendored 的
// 真实 tools/list(fixtures/cloud-mcp-tools),各次调用的回执逐字取自生产云(test-component/fixtures/cloud-mcp-production-samples.json,
// 来源写在文件里)。脚本模型照用户回合里的
// `CP-CALL` 直接调 `codepuppy_dispatch` / `codepuppy_artifacts` —— 与 0.1.x 模型看到的工具名相同。
//
// 已知的坏(实测):云 MCP 定义不带 `codemode:false` ⇒ 模型请求的工具表里没有 `codepuppy_dispatch`,调用不成立,三处识别全空。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里;令牌是合成值,只发到本机端点。
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import type { TestBootstrapInput } from "../../test-component/codepuppy-bootstrap-fixture"
import samples from "../../test-component/fixtures/cloud-mcp-production-samples.json"
import { createEngineFetch } from "../engine-adapter/index"
import { extractCloudRunHit } from "../renderer/codepuppy-ui/cloud-run-core"
import { artifactLinksOf, cloudImageOf } from "../renderer/codepuppy-ui/session-timeline/timeline-model"
import { toolProvenanceOf } from "../renderer/codepuppy-ui/session-timeline/cards/tool-card-model"
import { materializeCloudMcpConfig } from "./cloud-sidecar-config"
import { CLOUD_MCP_SERVER_NAME } from "./cloud-web-search"
import { CLOUD_MCP_TOOL_LIST } from "./fixtures/cloud-mcp-tools"
import { secretFileRef, syncSecretFiles } from "./codepuppy-secret-files"

const sandbox = engineSandbox()
const model = scriptedModel()
const TOKEN = `SENTINEL-CLOUD-MCP-${crypto.randomUUID()}`
const NAME = "cloud-direct"
const ORIGIN = "http://127.0.0.1:47671"

// ── 本机云 MCP 端点(会话时代 streamable-HTTP),工具表与回执取自生产 ──────────────────────────────────────
const calls: Array<{ name: string; args: Record<string, unknown> }> = []
const resultOf = (name: string, args: Record<string, unknown>) =>
  name === "dispatch" ? samples.results[`dispatch:${String(args.kind)}` as keyof typeof samples.results] : name === "artifacts" ? samples.results.artifacts : undefined
const endpoint = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 0,
  async fetch(request) {
    if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) return new Response("unauthorized", { status: 401 })
    if (request.method === "GET") return new Response(null, { status: 405 })
    if (request.method === "DELETE") return new Response(null, { status: 200 })
    const message = (await request.json()) as { id?: number | string; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }
    if (message.id === undefined) return new Response(null, { status: 202 })
    if (message.method === "initialize")
      return Response.json(
        { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "codepuppy-cloud", version: "1" } } },
        { headers: { "mcp-session-id": "S1" } },
      )
    if (message.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: message.id, result: { tools: CLOUD_MCP_TOOL_LIST } })
    if (message.method === "tools/call") {
      const name = String(message.params?.name)
      const args = message.params?.arguments ?? {}
      calls.push({ name, args })
      const text = resultOf(name, args)
      return Response.json({
        jsonrpc: "2.0",
        id: message.id,
        result: text === undefined ? { isError: true, content: [{ type: "text", text: `no sample for ${name}` }] } : { content: [{ type: "text", text }] },
      })
    }
    return Response.json({ jsonrpc: "2.0", id: message.id, result: {} })
  },
})

// ── 宿主取产物的云端 REST(main 的 codepuppy-cloud-jobs 走它):回包逐字取自生产;产物字节只给带租户凭据的请求,
// 没带的照生产回 401 `{"error":"unauthorized"}`(0.2.3 里模型自己用 curl 去拿,落地的 circle.png 就是这 24 字节)。
const TENANT = `SENTINEL-TENANT-${crypto.randomUUID()}`
const ARTIFACTS = path.join(import.meta.dir, "../../test-component/fixtures/cloud-artifacts")
const rest = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const route = `${request.method} ${new URL(request.url).pathname}`
    if (request.headers.get("authorization") !== `Bearer ${TENANT}`)
      return new Response(samples.rest["unauthenticated content"], { status: 401, headers: { "content-type": "application/json" } })
    const body = samples.rest[route as keyof typeof samples.rest]
    if (body) return new Response(body, { headers: { "content-type": "application/json" } })
    const artifact = /^GET \/v1\/cloud\/artifacts\/([a-z0-9_]+)\/content$/.exec(route)?.[1]
    if (artifact && fs.existsSync(path.join(ARTIFACTS, artifact))) return new Response(fs.readFileSync(path.join(ARTIFACTS, artifact)))
    return new Response("not found", { status: 404 })
  },
})
// main 进程的身份与端点(electron 之外的那两样):登录后的租户凭据、云端地址。
mock.module("./codepuppy-auth", () => ({ getAccessToken: () => TENANT, getAuthIdentityTag: () => "tenant" }))
mock.module("./codepuppy-endpoints", () => ({ resolveEndpoints: () => ({ cloud: `http://127.0.0.1:${rest.port}` }) }))
mock.module("./logging", () => ({ getLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} }) }))
mock.module("./codepuppy-contract-health", () => ({ reportContractFailure: () => {} }))

let host: ReturnType<typeof codepuppyEngine>
let running: Running | undefined
let adapter: typeof fetch
const events: Array<{ directory: string; payload: any }> = []
const stream = new AbortController()

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  // fork 时:生产 syncSecretFiles 物化登录铸的云 MCP 令牌;启动文档里的定义 = main 用 materializeCloudMcpConfig 算的那一份
  const userData = path.join(sandbox.root, `${NAME}-userdata`)
  syncSecretFiles(userData, { CODEPUPPY_MCP_TOKEN: TOKEN })
  host = codepuppyEngine({
    sandbox,
    name: NAME,
    modelBaseURL: model.baseURL,
    cloudMcp: {
      name: CLOUD_MCP_SERVER_NAME,
      definition: materializeCloudMcpConfig(`http://127.0.0.1:${endpoint.port}/mcp`, secretFileRef(userData, "CODEPUPPY_MCP_TOKEN")),
    } as TestBootstrapInput["cloudMcp"],
  })
  if (host.userData !== userData) throw new Error(`userData ${host.userData} != ${userData}`)
  running = await host.start()
  adapter = createEngineFetch({
    isEngineOrigin: (origin) => origin === ORIGIN,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => running!.fetch(new Request(input, init))) as typeof fetch,
  }) as typeof fetch
  const response = await adapter(`${ORIGIN}/global/event`, { signal: stream.signal })
  void (async () => {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      for (let i = buffer.indexOf("\n\n"); i >= 0; i = buffer.indexOf("\n\n")) {
        const block = buffer.slice(0, i)
        buffer = buffer.slice(i + 2)
        if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)))
      }
    }
  })().catch(() => undefined)
  for (let i = 0; i < 200; i++) {
    const status = (await services())[CLOUD_MCP_SERVER_NAME]?.status
    if (status === "connected" || status === "failed") break
    await Bun.sleep(50)
  }
}, 120_000)

afterAll(async () => {
  stream.abort()
  await running?.close().catch(() => undefined)
  endpoint.stop(true)
  rest.stop(true)
  model.stop()
})

const headers = () => ({ "content-type": "application/json", "x-opencode-directory": encodeURIComponent(host.projectDirectory) })
const services = async () => (await (await adapter(`${ORIGIN}/mcp`, { headers: headers() })).json()) as Record<string, { status?: string; error?: string }>

/** 桌面发一回合(生产适配器的 v1 `prompt_async`),审批照「允许一次」回,等到 session.idle;返回这一回合的事件与消息。 */
async function turn(text: string) {
  const sessionID = ((await (await adapter(`${ORIGIN}/session`, { method: "POST", headers: headers(), body: "{}" })).json()) as { id: string }).id
  const before = events.length
  const prompt = await adapter(`${ORIGIN}/session/${sessionID}/prompt_async`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ agent: "build", model: { providerID: "codepuppy", modelID: "m" }, parts: [{ type: "text", text }] }),
  })
  if (prompt.status !== 204) throw new Error(`prompt_async ${prompt.status} ${await prompt.text()}`)
  const idle = () => events.slice(before).some((event) => event.payload.type === "session.idle" && event.payload.properties?.sessionID === sessionID)
  for (const until = Date.now() + 60_000; !idle() && Date.now() < until; await Bun.sleep(100)) {
    const pending = (await (await adapter(`${ORIGIN}/permission`, { headers: headers() })).json()) as Array<{ id: string; sessionID: string }>
    for (const request of pending.filter((item) => item.sessionID === sessionID))
      await adapter(`${ORIGIN}/permission/${request.id}/reply`, { method: "POST", headers: headers(), body: JSON.stringify({ reply: "once" }) })
  }
  if (!idle()) throw new Error(`session ${sessionID} did not go idle`)
  const messages = (await (await adapter(`${ORIGIN}/session/${sessionID}/message`, { headers: headers() })).json()) as Array<{ parts?: any[] }>
  return { events: events.slice(before), parts: messages.flatMap((message) => (message.parts ?? []).filter((part) => part.type === "tool")) }
}
const call = (name: string, args: unknown) => `CP-CALL ${JSON.stringify({ name, args })}`
const dispatch = (kind: string, input: Record<string, unknown>) =>
  call("codepuppy_dispatch", { schema_version: 1, idempotency_key: `direct-${kind}`, autonomy: "pipeline", kind, input, constraints: { network: "restricted" }, artifact_policy: { delivery: "descriptor_only" } })
const hitsOf = (turnEvents: unknown[]) => turnEvents.map((event) => extractCloudRunHit(event)).filter((hit) => hit !== null)

describe("#1662 云工具是模型的直接工具:云端生图 / 数据分析回到桌面的跟踪、生图卡与产物行", () => {
  test("云连接器已连上;模型请求的工具表里有直接的 codepuppy_dispatch / codepuppy_await / codepuppy_artifacts", async () => {
    expect((await services())[CLOUD_MCP_SERVER_NAME]?.status).toBe("connected")
    await turn("hello")
    const tools = model.requests.at(-1)?.tools ?? []
    expect(tools).toEqual(expect.arrayContaining(["codepuppy_dispatch", "codepuppy_await", "codepuppy_artifacts"]))
  }, 90_000)

  test("生图派发 ⇒ 桌面 run-watcher 命中这次受理的任务、时间线出生图卡(受理态,同一个任务)", async () => {
    const r = await turn(dispatch("image-generation", { prompt: "A blue square" }))
    expect(calls.filter((item) => item.name === "dispatch").map((item) => item.args.kind)).toContain("image-generation")
    expect(hitsOf(r.events).map((hit) => ({ runId: hit.runId, source: hit.source }))).toContainEqual({ runId: "job_1748ae4cd98e", source: "dispatch" })
    const cards = r.parts.map((part) => cloudImageOf(part)).filter((card) => card !== undefined)
    expect(cards.map((card) => ({ prompt: card.prompt, call: card.call.phase === "accepted" ? card.call.runId : card.call.phase }))).toEqual([
      { prompt: "A blue square", call: "job_1748ae4cd98e" },
    ])
  }, 90_000)

  test("数据分析派发 ⇒ 桌面 run-watcher 命中这次受理的任务", async () => {
    const r = await turn(dispatch("data-analysis", { csv: "month,revenue\n2026-01,120\n", question: "average?" }))
    expect(hitsOf(r.events).map((hit) => ({ runId: hit.runId, source: hit.source }))).toContainEqual({ runId: "job_ccb255627759", source: "dispatch" })
  }, 90_000)

  test("数据分析派发 ⇒ 宿主照 run-watcher 的命中跟住任务,用租户凭据把产物存到本机:落地的 chart.png 是真 PNG", async () => {
    const { createCloudRunTracker } = await import("./cloud-run-tracker")
    const { downloadCloudArtifactTo, getCloudJobStatus, listCloudArtifacts } = await import("./codepuppy-cloud-jobs")
    const { subscribeCloudJobEvents } = await import("./codepuppy-cloud-events")
    const { finalizeArtifactWithQuota, initializeArtifactQuotaEnvironment, registerDownloadedArtifact, registeredArtifactNameOwner } = await import("./artifact-service")
    await initializeArtifactQuotaEnvironment(host.userData) // main 启动时做的那一步(安装级 machine id)
    const saved: Array<{ dir: string; files: string[] }> = []
    const states: Array<{ runId: string; delivery: string }> = []
    // 与 cloud-ipc.ts 的装配同一套生产函数(那个模块挂着 electron 的窗口与 IPC,这里只换掉广播)
    let pendingRuns: unknown
    const tracker = createCloudRunTracker({
      identity: () => "tenant",
      account: () => "tenant",
      pending: { read: () => pendingRuns, write: (runs) => void (pendingRuns = runs) },
      status: getCloudJobStatus,
      artifacts: listCloudArtifacts,
      subscribe: subscribeCloudJobEvents,
      saveDeps: (directory, runId, signal) => ({
        download: (artifact, targetPath, jobId) => downloadCloudArtifactTo({ artifact, targetPath, jobId, signal }, (input) => finalizeArtifactWithQuota(directory, runId, input)),
        register: (input) => registerDownloadedArtifact(directory, runId, input),
        artifactNameOwner: (name) => registeredArtifactNameOwner(directory, runId, name),
      }),
      afterSave: (_directory, _runId, manifest) => void (manifest.ok && saved.push({ dir: manifest.dir, files: manifest.files })),
      broadcast: (state) => void states.push({ runId: state.runId, delivery: state.delivery.status }),
      wait: async () => {},
      log: () => {},
    })
    const r = await turn(dispatch("data-analysis", { csv: "month,revenue\n2026-01,120\n", question: "average?" }))
    // renderer cloud-run-watcher.tsx 对每个命中做的那一步:受理的 dispatch 带归属,交给 main 的 tracker
    for (const hit of hitsOf(r.events))
      tracker.track({ directory: hit.directory, runId: hit.runId, ...(hit.source === "dispatch" && hit.sessionID ? { origin: { sessionID: hit.sessionID, messageID: hit.messageID, partID: hit.partID } } : {}) })
    for (const until = Date.now() + 15_000; !states.some((state) => state.delivery === "saved" || state.delivery === "failed") && Date.now() < until; ) await Bun.sleep(50)
    // 只判这张图:同一任务的 report.md 生产描述符写 size 0、实际 113 字节,下载按尺寸不符拒收(平台侧,另报),整次交付因此记 failed
    expect(states.at(-1)?.runId).toBe("job_ccb255627759")
    const chart = saved.flatMap((manifest) => manifest.files.map((file) => path.resolve(manifest.dir, file))).find((file) => file.endsWith("chart.png"))
    expect(chart).toBeDefined()
    expect([...fs.readFileSync(chart!).subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  }, 90_000)

  test("云工具的调用记录带 codepuppy-cloud 权威(工具卡显示 Code Puppy 云来源,不是第三方)", async () => {
    // 已知的坏(实测):引擎给每个配置里的 MCP 条目补一个合并后的 `timeout`(无全局缺省时是 `{}`,core config/plugin/mcp.ts),
    // 治理核验要求条目与启动文档定义逐字相等 ⇒ 2.x 上云工具一律 not-asserted。
    const r = await turn(call("codepuppy_artifacts", { job_id: "job_1748ae4cd98e" }))
    const part = r.parts.find((item) => item.tool === "codepuppy_artifacts")
    expect(part?.display?.identity).toEqual({ source: "mcp", origin: CLOUD_MCP_SERVER_NAME, name: "artifacts" })
    expect(part?.display?.authority?.kind).toBe("codepuppy-cloud")
    expect(toolProvenanceOf(part)).toEqual({ source: "codepuppy-cloud", location: { kind: "cloud" } })
  }, 90_000)

  test("取产物 ⇒ 时间线出产物行(名字与产物 id 是云端回执里的)", async () => {
    const r = await turn(call("codepuppy_artifacts", { job_id: "job_1748ae4cd98e" }))
    expect(r.parts.flatMap((part) => artifactLinksOf(part))).toEqual([{ runId: "job_1748ae4cd98e", name: "image.png", id: "art_job_1748ae4cd98e_0_99b4a5be" }])
  }, 90_000)
})
