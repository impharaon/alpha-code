// REQ-153 #1266 / #1267 / #1237 的真引擎判据,在 OpenCode 2 上(`#1662`;v1 版跑的是已删的 `packages/opencode/src/index.ts run --variant`)。
// 宿主 codepuppy-reasoning-badge-parity.test.ts 起独立 `bun test` 子进程跑本文件(沙箱要在上游模块装载之前改指 HOME / XDG)。
//
// 「推理」徽标 ⇔ 引擎实际带推理参数,双向:
//   有徽标 ⇒ chip 列出 ≥1 档;每一档经真引擎发出的主请求体与档位声明逐字对上(`reasoningEffort: x` ⇒ `reasoning_effort === x`;
//           `thinking: { type: t }` ⇒ `thinking.type === t`);显式关闭档(`t === "disabled"`,#1267)⇒ 逐字 disabled 且零推理控制参数;
//           其余每一档都必须真的带推理控制参数。引擎拒绝一个 chip 列出的档 = 红(用户点了档,发送失败)。
//   无徽标 ⇒ chip 零档;默认发出的主请求体不带任何推理控制参数。
//
// 每一格走的都是生产函数:已应用目录(上游 V3 producer fixture 钉成 LKG)+ 全部直连 key → 生产 injectCodePuppyConfig
// (buildCodePuppyModelConfig → engineModelConfig,档位写成 2.x 的 `variants: [{ id, settings, body }]`)→ 嵌进 sidecar 的引擎 + 真 ext;
// picker 行 = 生产 buildModelPickerRows(已应用目录 + 引擎自己的 GET /api/model);发送 = 生产 buildPromptRequest + v1PromptModelFields
// 写出的 v1 `prompt_async` 请求体,经生产引擎适配器(engine-adapter createEngineFetch → routes.ts 的 prompt:switchModel 带 variant,
// 再 session.prompt)进引擎 —— 与桌面 composer 发的是同一个请求。唯一的改动是端点:每个 provider 的 baseURL(内联文档与 models 底表)
// 指向本机桩 `/p/<provider>/v1`。桩按发送正文里的标记把每个请求体归到它那一格(主请求与标题请求都带用户那句话)。
//
// 标题辅助调用(#1237)按 0.1.26 的规则判:不论用户选哪一档(或没选),标题请求体都等于档位表**第一档**的参数(origin/alpha
// packages/opencode/src/provider/transform.ts:1390-1391,packages/opencode/src/session/llm/request.ts:84-89;目录把「关」放第一位就是为了让
// 辅助调用不思考);没有档位的模型,标题请求体零推理控制参数。2.x 的 selectTitle 只认 id 为 none / minimal / low 的档
// (packages/core/src/session/context.ts:94-123、:191-203),Code Puppy 的档 id 是 chip 标签,所以 engineModelConfig 在有档位的模型的
// 档位表末尾多写一档 `none`(TITLE_VARIANT_ALIAS)= 第一档的原样拷贝,让 2.x 自己挑它。判据 judgeTitle:标题请求体的推理控制参数与
// `thinking` 原文 == 第一档那次发送的主请求体。反向臂:注入里去掉这一档 ⇒ 标题跟着所选的档走,点名红。
// 用户看不见这一档:矩阵组的 UI 侧那条判适配器给冻结界面的 v1 provider 列表里,每个模型的档位恰好是目录的(桌面 chip 读目录)。
//
// HOME / XDG 全在临时沙箱里;key 是刻意不像真密钥的测试值,只发到本机桩。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { createOpencodeClient, type ModelV2Info } from "@opencode-ai/sdk/v2/client"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, type Running } from "../../test-component/codepuppy-engine"
import { v3Snapshot } from "../../test-component/effective-catalog.fixture"
import { createEngineFetch } from "../engine-adapter/index"
import { normalizeProviderList } from "../../../codepuppy-app/src/context/global-sync/utils"
import { buildModelPickerRows, type ModelPickerRow } from "../renderer/codepuppy-ui/model-picker-core"
import { buildPromptRequest, DEFAULT_PERM, v1PromptModelFields } from "../renderer/codepuppy-ui/composer-state"
import { createModelContract } from "../renderer/codepuppy-ui/model-contract"
import { byokModelMeta, isByokEngineId, TITLE_VARIANT_ALIAS } from "../shared/codepuppy-model-types"
import { getModelCatalog } from "./codepuppy-models"
import { pinAppliedCatalog, writeCatalogSnapshot } from "./codepuppy-live-allowlist"
import { secretFilePath } from "./codepuppy-secret-files"

const sandbox = engineSandbox()

/** 引擎请求体里算作「推理控制」的键(与 #1239 判据同一张表,去掉 `top_k` —— 那是采样参数)。
 *  `thinking: { type: "disabled" }` 是显式关闭,不算「在推理」。 */
const REASONING_KEYS = [
  "reasoning_effort",
  "reasoning",
  "thinking",
  "enable_thinking",
  "chat_template_kwargs",
  "chat_template_args",
  "effort",
  "thinkingConfig",
  "reasoning_summary",
] as const

type Body = Record<string, unknown>

function reasoningControls(body: Body): Body {
  const out: Body = {}
  for (const key of REASONING_KEYS) {
    if (!(key in body)) continue
    const value = body[key]
    if (key === "thinking" && typeof value === "object" && value !== null && (value as { type?: unknown }).type === "disabled") continue
    out[key] = value
  }
  return out
}

// ── 本机桩:记下每一个请求体,回一段最短的 SSE ─────────────────────────────────────────────────────────────
const captured: Array<{ path: string; body: Body }> = []
const stub = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    let body: Body = {}
    if (request.method === "POST") {
      try {
        body = JSON.parse(await request.text()) as Body
      } catch {
        body = { "<unparsable>": true }
      }
    }
    captured.push({ path: url.pathname, body })
    const chunk = (delta: Body, finish: string | null) =>
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "fake", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    return new Response(chunk({ role: "assistant", content: "ok" }, null) + chunk({}, "stop") + "data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    })
  },
})
const upstream = `http://127.0.0.1:${stub.port}`
const running: Running[] = []

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  for (const engine of running) await engine.close().catch(() => undefined)
  stub.stop(true)
})

// ── 一台机器 ────────────────────────────────────────────────────────────────────────────────────────────────
type Injected = { capabilities?: Record<string, unknown>; variants?: Array<Record<string, unknown>>; body?: Body }
type Machine = {
  rows: ModelPickerRow[]
  userData: string
  send: (row: ModelPickerRow, variant?: string) => Promise<Sent>
  /** 冻结界面拿到的 v1 provider 列表(经生产适配器 GET /provider)与同一时刻引擎自己的 2.x 清单。 */
  lists: () => Promise<{
    v1: { all: Array<{ id: string; models: Record<string, { variants?: Record<string, unknown> }> }> }
    providers: unknown[]
    models: ModelV2Info[]
    /** composer 的模型合同(生产 createModelContract + 冻结 v1 SDK 客户端,`client.v2.model.list`)经生产适配器拿到的清单。 */
    composer: { data?: ModelV2Info[]; error?: string }
  }>
}
type InjectedProviders = Record<string, { settings?: { baseURL?: string }; models?: Record<string, Injected> }>

/** 装好已应用平台目录与全部直连 key 的一台机器;`mutate` 只给反向臂用(改注入里的模型表)。端点全部指向本机桩。 */
async function machine(name: string, mutate?: (models: (providerID: string, id: string) => Injected, all: InjectedProviders) => void): Promise<Machine> {
  const userData = path.join(sandbox.root, `${name}-userdata`)
  fs.mkdirSync(userData, { recursive: true })
  writeCatalogSnapshot(userData, v3Snapshot())
  pinAppliedCatalog(userData, 1)
  for (const secret of ["CODEPUPPY_API_KEY", ...getModelCatalog(userData).byokProviders.map((provider) => provider.keyEnv)]) {
    fs.mkdirSync(path.dirname(secretFilePath(userData, secret)), { recursive: true })
    fs.writeFileSync(secretFilePath(userData, secret), `sk-fake-${secret}`, { mode: 0o600 })
  }
  const host = codepuppyEngine({ sandbox, name, modelBaseURL: `${upstream}/p/codepuppy/v1`, platformModels: null })
  const providers = host.content.providers as InjectedProviders
  for (const [id, provider] of Object.entries(providers)) if (provider.settings?.baseURL) provider.settings.baseURL = `${upstream}/p/${id}/v1`
  const file = host.injection.models.file
  if (file) {
    const base = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { api?: string; models?: Record<string, { provider?: { api?: string } }> }>
    for (const [id, provider] of Object.entries(base)) {
      if (provider.api) provider.api = `${upstream}/p/${id}/v1`
      for (const model of Object.values(provider.models ?? {})) if (model.provider?.api) model.provider.api = `${upstream}/p/${id}/v1`
    }
    fs.writeFileSync(file, JSON.stringify(base))
  }
  // 端点没漏改:注入面与 models 底表里不剩任何非本机地址(否则测试 key 会发去真服务商)
  expect(JSON.stringify(providers).match(/https?:\/\/(?!127\.0\.0\.1:)[^"\s]+/g) ?? []).toEqual([])
  if (file) expect(fs.readFileSync(file, "utf8").match(/https?:\/\/(?!127\.0\.0\.1:)[^"\s]+/g) ?? []).toEqual([])
  mutate?.((providerID, id) => {
    const model = providers[providerID]?.models?.[id]
    if (!model) throw new Error(`no injected model ${providerID}/${id}`)
    return model
  }, providers)

  const engine = await host.start()
  running.push(engine)
  const listed = ((await engine.send("GET", "/api/model")).json?.data ?? []) as ModelV2Info[]
  const catalog = getModelCatalog(userData)
  const rows = buildModelPickerRows({
    catalog: {
      ...catalog,
      liveSync: { status: "cache" },
      pricingBasisModelId: null,
      applied: { platformFetchedAt: null, byokVersion: 1 },
      downloaded: { platformFetchedAt: null, byokVersion: 1 },
    },
    models: listed,
    listState: "ready",
    keyStatusState: "ready",
    keyStatus: Object.fromEntries(catalog.byokProviders.map((provider) => [provider.id, { configured: true, source: "keychain" as const }])),
    accountState: "member",
    sessionScoped: false,
    query: "",
  })

  // 冻结界面的 v1 请求经生产适配器进引擎(适配器的 2.x 客户端发往引擎源,交给引擎的原始分发)
  const origin = "http://codepuppy-sidecar.invalid"
  const adapter = createEngineFetch({ isEngineOrigin: (candidate) => candidate === origin, fetch: (async (input: RequestInfo | URL, init?: RequestInit) => engine.fetch(new Request(input, init))) as typeof fetch })
  const directory = `directory=${encodeURIComponent(host.projectDirectory)}`
  const send = async (row: ModelPickerRow, variant?: string): Promise<Sent> => {
    const marker = `[cp-badge:${++sends}]`
    const created = await adapter(`${origin}/session?${directory}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const sessionID = ((await created.json()) as { id: string }).id
    const request = buildPromptRequest({ text: `hi ${marker}`, model: row.model, effort: variant ?? null, perm: DEFAULT_PERM, agent: null })
    const sent = await adapter(`${origin}/session/${sessionID}/prompt_async?${directory}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parts: request.parts, ...(request.agent ? { agent: request.agent } : {}), ...v1PromptModelFields(request.model) }),
    })
    await engine.send("POST", `/api/experimental/session/${sessionID}/wait`)
    const mine = () => captured.filter((entry) => Array.isArray(entry.body.messages) && JSON.stringify(entry.body.messages).includes(marker))
    const isTitle = (body: Body) => (body.messages as Array<{ role?: string; content?: unknown }>).some((message) => message.role === "system" && JSON.stringify(message.content).includes(TITLE_PROMPT))
    // 这一轮失败(例如引擎查不到所选的档:`idle` 消息 outcome=failed、error.type=provider.no-route)⇒ 时间线上用户看到的就是这条错误
    const messages = ((await engine.send("GET", `/api/session/${sessionID}/message`)).json?.data ?? []) as Array<{ type: string; error?: { type?: string; message?: string } }>
    const failed = messages.find((message) => message.error)?.error
    // 标题调用与主回合并行,回合结束时它可能还没发出:等到捕获到,或 10 秒
    if (!failed) for (let i = 0; i < 200 && !mine().some((entry) => isTitle(entry.body)); i++) await Bun.sleep(50)
    const mains = mine().filter((entry) => !isTitle(entry.body))
    const titles = mine().filter((entry) => isTitle(entry.body))
    return {
      accepted: sent.status,
      error: failed ? `${failed.type ?? "error"}: ${failed.message ?? ""}` : undefined,
      main: mains.length === 1 ? mains[0]!.body : null,
      title: titles.length === 1 ? titles[0]!.body : null,
      counts: `main=${mains.length} title=${titles.length}`,
    }
  }
  const lists = async () => {
    const v1 = await (await adapter(`${origin}/provider?${directory}`)).json()
    const raw = { providers: (await engine.send("GET", "/api/provider")).json?.data ?? [], models: ((await engine.send("GET", "/api/model")).json?.data ?? []) as ModelV2Info[] }
    const client = createOpencodeClient({ baseUrl: origin, fetch: adapter as typeof fetch })
    const composer = await createModelContract(() => client)
      .list(host.projectDirectory)
      .then(
        (data) => ({ data }),
        (error: Error & { cause?: unknown }) => ({ error: `${error.message} ${JSON.stringify(error.cause ?? null)}` }),
      )
    return { v1, ...raw, composer }
  }
  return { rows, userData, send, lists }
}
/** 每次发送一个标记,主请求与标题请求都带着它,桩据此把请求体归到那一格。 */
let sends = 0
/** 2.x 标题 agent 的系统提示开头(packages/core/src/plugin/agent.ts:19 的 PROMPT_TITLE)—— 认出标题调用。 */
const TITLE_PROMPT = "You name conversations so the user can find them later"

type Sent = { accepted: number; error?: string; main: Body | null; title: Body | null; counts: string }

let realMachine: Promise<Machine> | undefined
/** 生产注入原样(只改端点)的那台,手段自证与矩阵共用。 */
const real = () => (realMachine ??= machine("badge"))

const rowKey = (row: ModelPickerRow) => `${row.model.providerID}:${row.model.id}`
const labelOf = (row: ModelPickerRow, variant?: string) => (variant ? `${rowKey(row)}@${variant}` : `${rowKey(row)}(默认)`)

/** 目录里该档位声明的 wire 值,与生产同一份派生:平台行读已应用平台快照的条目;BYOK 行经 byokModelMeta。
 *  `reasoningEffort: x` → 请求体 `reasoning_effort: x`;`thinking: { type: t }` → 请求体 `thinking.type: t`;其它形状只判「有参数」。 */
function declaredControl(userData: string, row: ModelPickerRow, variant: string): { reasoningEffort?: string; thinkingType?: string } {
  const catalog = getModelCatalog(userData)
  const declared = isByokEngineId(row.model.providerID)
    ? byokModelMeta(catalog, row.model.providerID, row.model.id).variants?.[variant]
    : catalog.platformModels.find((model) => model.id === row.model.id)?.variants?.[variant]
  const thinking = declared?.thinking as { type?: unknown } | undefined
  return {
    ...(typeof declared?.reasoningEffort === "string" ? { reasoningEffort: declared.reasoningEffort } : {}),
    ...(typeof thinking?.type === "string" ? { thinkingType: thinking.type } : {}),
  }
}

/** 一格主请求的判据(纯函数,手段自证与矩阵共用)。返回失败文案;空数组 = 这一格通过。 */
function judge(userData: string, row: ModelPickerRow, variant: string | undefined, sent: Pick<Sent, "error" | "main">): string[] {
  const label = labelOf(row, variant)
  if (sent.error) return [`${label}: 引擎拒绝了这次发送(${sent.error})`]
  const body = sent.main!
  const controls = reasoningControls(body)
  const carried = Object.keys(controls).length > 0
  const failures: string[] = []
  if (row.reasoning) {
    if (variant === undefined) {
      if (row.model.variants.length === 0) failures.push(`${label}: 有徽标但档位 chip 一档都没有(#1266)`)
      return failures
    }
    const declared = declaredControl(userData, row, variant)
    const wireThinking = (body.thinking as { type?: unknown } | undefined)?.type
    if (declared.thinkingType === "disabled") {
      // 显式关闭档(#1267):必须逐字 disabled 落到请求体,且零推理控制参数 —— 上游会静默忽略写错的 type 并继续思考。
      if (wireThinking !== "disabled") failures.push(`${label}: 档位声明 thinking.type=disabled,请求体 thinking.type=${String(wireThinking)}`)
      if (carried) failures.push(`${label}: 显式关闭档的请求体却带 ${JSON.stringify(controls)}(#1267)`)
      return failures
    }
    if (!carried) failures.push(`${label}: 有徽标、选了档,主请求体却零推理参数(#1266)`)
    if (declared.reasoningEffort !== undefined && body.reasoning_effort !== declared.reasoningEffort)
      failures.push(`${label}: 档位声明 reasoningEffort=${declared.reasoningEffort},请求体 reasoning_effort=${String(body.reasoning_effort)}`)
    if (declared.thinkingType !== undefined && wireThinking !== declared.thinkingType)
      failures.push(`${label}: 档位声明 thinking.type=${declared.thinkingType},请求体 thinking.type=${String(wireThinking)}`)
    return failures
  }
  if (variant !== undefined) failures.push(`${label}: 无徽标却列出了档位`)
  else if (carried) failures.push(`${label}: 无徽标,默认请求却带 ${JSON.stringify(controls)}(#1267)`)
  return failures
}

/** 标题辅助调用(#1237,0.1.26 规则):标题请求体的推理控制参数与 `thinking` 原文 == 第一档那次发送的主请求体;没有档位的模型 == 零推理控制参数。 */
function judgeTitle(row: ModelPickerRow, variant: string | undefined, title: Body, first: Body): string[] {
  const shape = (body: Body) => JSON.stringify({ controls: reasoningControls(body), thinking: body.thinking ?? null })
  const tier = row.model.variants[0] === undefined ? "无档" : `第一档 ${row.model.variants[0]}`
  return shape(title) === shape(first) ? [] : [`${labelOf(row, variant)}(标题辅助调用): 应同${tier} ${shape(first)},标题请求 ${shape(title)}`]
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (;;) {
        const index = next++
        if (index >= items.length) return
        out[index] = await fn(items[index]!)
      }
    }),
  )
  return out
}

/** 对一组行跑「默认 + chip 每一档」,返回逐格结论、判据失败、harness 故障。 */
async function matrix(target: Machine, rows: ModelPickerRow[]) {
  const jobs = rows.flatMap((row) => [{ row, variant: undefined as string | undefined }, ...row.model.variants.map((variant) => ({ row, variant }))])
  const results = await pool(jobs, 4, async (job) => ({ ...job, sent: await target.send(job.row, job.variant) }))
  // 标题的期望:没有档位 ⇒ 空体;否则第一档那一格的主请求体。第一档那一格被引擎拒绝 ⇒ 判据已经点名,这一行的标题不再判。
  const titleExpectation = (row: ModelPickerRow): { body?: Body; void?: string } => {
    const first = row.model.variants[0]
    if (first === undefined) return { body: {} }
    const cell = results.find((result) => result.row === row && result.variant === first)?.sent
    if (!cell) return { void: "第一档那一格不在本次矩阵里" }
    if (cell.error) return {}
    return cell.main ? { body: cell.main } : { void: "第一档那一格没捕到主请求" }
  }
  const failures: string[] = []
  const harness: string[] = []
  const verdicts: string[] = []
  for (const { row, variant, sent } of results) {
    const label = labelOf(row, variant)
    if (sent.accepted !== 204) harness.push(`${label}: prompt_async 回 ${sent.accepted}`)
    else if (sent.error) failures.push(...judge(target.userData, row, variant, sent))
    else if (!sent.main || !sent.title) harness.push(`${label}: 捕获 ${sent.counts}(各应恰好 1 条)—— 本格测量作废`)
    else {
      verdicts.push(
        `${label} badge=${row.reasoning} chip=[${row.model.variants.join("|")}] main=${JSON.stringify(reasoningControls(sent.main))} thinking=${JSON.stringify(sent.main.thinking ?? null)} title=${JSON.stringify(reasoningControls(sent.title))} title.thinking=${JSON.stringify(sent.title.thinking ?? null)}`,
      )
      failures.push(...judge(target.userData, row, variant, sent))
      const expected = titleExpectation(row)
      if (expected.void) harness.push(`${label}: ${expected.void} —— 标题判据作废`)
      else if (expected.body) failures.push(...judgeTitle(row, variant, sent.title, expected.body))
    }
  }
  return { failures, harness, verdicts, cells: jobs.length }
}

const findRow = (target: Machine, key: string) => {
  const row = target.rows.find((candidate) => rowKey(candidate) === key)
  if (!row) throw new Error(`no picker row ${key}`)
  return row
}

describe("REQ-153 #1266/#1267:手段自证(嵌入式 OpenCode 2 · 本机桩)", () => {
  test("手段自证:桩的捕获不是恒空", async () => {
    const response = await fetch(`${upstream}/p/__probe__/v1/chat/completions`, { method: "POST", body: JSON.stringify({ probe: "KNOWN-GOOD", messages: [] }) })
    expect(response.ok).toBe(true)
    expect(captured.find((entry) => entry.path.startsWith("/p/__probe__/"))?.body.probe).toBe("KNOWN-GOOD")
  })

  test("手段自证:注入丢了推理转发 ⇒ 判据逐档点名红(整张档位表不进引擎 / 档位在、内容丢了)", async () => {
    const dropped = await machine("badge-dropped", (model) => {
      // 形状一:模型的 variants 与 capabilities.reasoning 都没写进引擎配置(engineModel 不转发)
      for (const [providerID, id] of [["codepuppy", "qwen3.7-max"], ["zhipuai-byok", "glm-4.5-air"]] as const) {
        const injected = model(providerID, id)
        delete injected.variants
        delete injected.capabilities?.reasoning
      }
      // 形状二:档位 id 写进去了,每一档的 settings / body 丢了(拆分 settings / body 时丢值)
      for (const variant of model("deepseek-byok", "deepseek-v4-pro").variants as Array<Record<string, unknown>>) {
        delete variant.settings
        delete variant.body
      }
    })
    const rows = ["codepuppy:qwen3.7-max", "zhipuai-byok:glm-4.5-air", "deepseek-byok:deepseek-v4-pro"].map((key) => findRow(dropped, key))
    // picker 侧没动:三行仍亮徽标、chip 照旧 —— 只有引擎那一头丢了
    expect(rows.map((row) => ({ key: rowKey(row), badge: row.reasoning, chip: row.model.variants }))).toEqual([
      { key: "codepuppy:qwen3.7-max", badge: true, chip: ["关", "开"] },
      { key: "zhipuai-byok:glm-4.5-air", badge: true, chip: ["关", "开"] },
      { key: "deepseek-byok:deepseek-v4-pro", badge: true, chip: ["低", "中", "高", "最高"] },
    ])
    const result = await matrix(dropped, rows)
    expect(result.harness).toEqual([])
    expect(result.failures).toEqual(DROPPED_FAILURES)
  }, 120_000)

  test("手段自证:无此能力的模型亮徽标 ⇒ 判据点名红(默认那格:chip 零档;硬塞一档:引擎拒绝)", async () => {
    const target = await real()
    const plain = findRow(target, "minimax-byok:MiniMax-M2")
    expect({ badge: plain.reasoning, chip: plain.model.variants }).toEqual({ badge: false, chip: [] })
    const badged: ModelPickerRow = { ...plain, reasoning: true }
    const sent = await target.send(badged)
    expect({ error: sent.error, main: sent.main !== null }).toEqual({ error: undefined, main: true })
    expect(judge(target.userData, badged, undefined, sent)).toEqual(["minimax-byok:MiniMax-M2(默认): 有徽标但档位 chip 一档都没有(#1266)"])
    const tiered: ModelPickerRow = { ...plain, reasoning: true, model: { ...plain.model, variants: ["高"] } }
    const forced = await target.send(tiered, "高")
    expect(forced.main).toBeNull()
    expect(judge(target.userData, tiered, "高", forced)).toEqual([`minimax-byok:MiniMax-M2@高: 引擎拒绝了这次发送(${forced.error})`])
    expect(forced.error).toContain("Variant unavailable")
  }, 120_000)

  test("手段自证(#1267 方向):无徽标的模型被注入无条件的 thinking:enabled ⇒ 默认那格点名红", async () => {
    const forced = await machine("badge-unconditional", (model) => {
      model("minimax-byok", "MiniMax-M2").body = { thinking: { type: "enabled" } }
    })
    const row = findRow(forced, "minimax-byok:MiniMax-M2")
    expect({ badge: row.reasoning, chip: row.model.variants }).toEqual({ badge: false, chip: [] })
    const result = await matrix(forced, [row])
    expect(result.harness).toEqual([])
    // 模型级的请求体参数主请求与标题请求都带着 —— 两条判据各点一次名
    expect(result.failures).toEqual([
      'minimax-byok:MiniMax-M2(默认): 无徽标,默认请求却带 {"thinking":{"type":"enabled"}}(#1267)',
      'minimax-byok:MiniMax-M2(默认)(标题辅助调用): 应同无档 {"controls":{},"thinking":null},标题请求 {"controls":{"thinking":{"type":"enabled"}},"thinking":{"type":"enabled"}}',
    ])
  }, 120_000)

  test("手段自证(#1237 标题调用):注入里有 `none` 那一档 ⇒ 两类参数的标题都取第一档;去掉它(2.x 原样)⇒ 标题跟着所选的档走,逐格点名红", async () => {
    // 生产注入:选「开」时标题请求是第一档「关」—— reasoning_effort 一类与请求体 thinking 一类都成立
    const target = await real()
    const qwenOn = await target.send(findRow(target, "codepuppy:qwen3.7-max"), "开")
    const airOn = await target.send(findRow(target, "zhipuai-byok:glm-4.5-air"), "开")
    expect({ main: qwenOn.main?.reasoning_effort, title: qwenOn.title?.reasoning_effort }).toEqual({ main: "medium", title: "none" })
    expect({ main: airOn.main?.thinking, title: airOn.title?.thinking, controls: reasoningControls(airOn.title ?? {}) }).toEqual({
      main: { type: "enabled" },
      title: { type: "disabled" },
      controls: {},
    })
    // 反向臂:同一份注入,只去掉每个模型档位表里的 `none`
    let removed = 0
    const bare = await machine("badge-no-alias", (_model, all) => {
      for (const provider of Object.values(all))
        for (const model of Object.values(provider.models ?? {})) {
          const kept = model.variants?.filter((variant) => variant.id !== TITLE_VARIANT_ALIAS)
          if (!kept || kept.length === model.variants!.length) continue
          removed++
          model.variants = kept
        }
    })
    // 生产注入里每个有档位的模型都带着它(否则这条反向臂是空对空)
    expect(removed).toBe(bare.rows.filter((row) => row.model.variants.length > 0).length)
    const rows = ["codepuppy:qwen3.7-max", "zhipuai-byok:glm-4.5-air", "codepuppy:claude-opus-4.8"].map((key) => findRow(bare, key))
    const result = await matrix(bare, rows)
    expect(result.harness).toEqual([])
    expect(result.failures).toEqual(NO_ALIAS_FAILURES)
  }, 120_000)
})

/** 「去掉 `none`」的期望(实测,2.x 原样的标题选档):标题跟着所选的档走 —— 选第一档那一格碰巧对,其余每一格(含没选档)都点名。 */
const NO_ALIAS_FAILURES = [
  'codepuppy:qwen3.7-max(默认)(标题辅助调用): 应同第一档 关 {"controls":{"reasoning_effort":"none"},"thinking":null},标题请求 {"controls":{},"thinking":null}',
  'codepuppy:qwen3.7-max@开(标题辅助调用): 应同第一档 关 {"controls":{"reasoning_effort":"none"},"thinking":null},标题请求 {"controls":{"reasoning_effort":"medium"},"thinking":null}',
  'zhipuai-byok:glm-4.5-air(默认)(标题辅助调用): 应同第一档 关 {"controls":{},"thinking":{"type":"disabled"}},标题请求 {"controls":{},"thinking":null}',
  'zhipuai-byok:glm-4.5-air@开(标题辅助调用): 应同第一档 关 {"controls":{},"thinking":{"type":"disabled"}},标题请求 {"controls":{"thinking":{"type":"enabled"}},"thinking":{"type":"enabled"}}',
  'codepuppy:claude-opus-4.8(默认)(标题辅助调用): 应同第一档 低 {"controls":{"reasoning":{"effort":"low"}},"thinking":null},标题请求 {"controls":{},"thinking":null}',
  'codepuppy:claude-opus-4.8@中(标题辅助调用): 应同第一档 低 {"controls":{"reasoning":{"effort":"low"}},"thinking":null},标题请求 {"controls":{"reasoning":{"effort":"medium"}},"thinking":null}',
  'codepuppy:claude-opus-4.8@高(标题辅助调用): 应同第一档 低 {"controls":{"reasoning":{"effort":"low"}},"thinking":null},标题请求 {"controls":{"reasoning":{"effort":"high"}},"thinking":null}',
]

/** 「注入丢了推理转发」的期望(实测):默认那格判据只看 chip(chip 没动 ⇒ 不红)。形状一的每一档引擎拒绝(时间线上是一条
 *  provider.no-route 错误);形状二的每一档发得出去,但主请求体零推理参数。 */
const DROPPED_FAILURES = [
  "codepuppy:qwen3.7-max@关: 引擎拒绝了这次发送(provider.no-route: Variant unavailable for codepuppy/qwen3.7-max: 关)",
  "codepuppy:qwen3.7-max@开: 引擎拒绝了这次发送(provider.no-route: Variant unavailable for codepuppy/qwen3.7-max: 开)",
  "zhipuai-byok:glm-4.5-air@关: 引擎拒绝了这次发送(provider.no-route: Variant unavailable for zhipuai-byok/glm-4.5-air: 关)",
  "zhipuai-byok:glm-4.5-air@开: 引擎拒绝了这次发送(provider.no-route: Variant unavailable for zhipuai-byok/glm-4.5-air: 开)",
  ...[
    ["低", "low"],
    ["中", "medium"],
    ["高", "high"],
    ["最高", "max"],
  ].flatMap(([tier, effort]) => [
    `deepseek-byok:deepseek-v4-pro@${tier}: 有徽标、选了档,主请求体却零推理参数(#1266)`,
    `deepseek-byok:deepseek-v4-pro@${tier}: 档位声明 reasoningEffort=${effort},请求体 reasoning_effort=undefined`,
  ]),
]

describe("REQ-153 #1266/#1267:矩阵(嵌入式 OpenCode 2 · 本机桩 · 双向)", () => {
  test("矩阵:有徽标 ⇒ 每一档请求带参数且值逐字对上;无徽标 ⇒ 零档且默认请求不带参数;标题调用取第一档(0.1.26 规则)", async () => {
    const target = await real()
    const rows = target.rows
    // 空集会让下面所有断言空转 —— 先钉住两侧都非空、平台与直连都在
    expect(rows.some((row) => row.reasoning)).toBe(true)
    expect(rows.some((row) => !row.reasoning)).toBe(true)
    expect(rows.some((row) => isByokEngineId(row.model.providerID) && row.reasoning)).toBe(true)
    expect(rows.some((row) => row.model.providerID === "codepuppy" && row.reasoning)).toBe(true)
    const result = await matrix(target, rows)
    expect(result.cells).toBe(rows.length + rows.reduce((sum, row) => sum + row.model.variants.length, 0))
    // 引擎没跑起来 / 没捕到请求 = 本次测量作废,不是通过也不是红 —— 单独报,先于判据
    expect(result.harness, "引擎侧 harness 故障(测量作废)").toEqual([])
    expect(result.failures, `逐格结论:\n${result.verdicts.join("\n")}`).toEqual([])
    expect(result.verdicts.length).toBe(result.cells)
  }, 300_000)

  test("矩阵 UI 侧:冻结界面的 v1 provider 列表与 composer 的模型清单(GET /api/model)都经生产适配器拿到,每个模型的档位恰好是目录的(`none` 不可见);同一份引擎清单不经适配器剥离 ⇒ 每个有档模型多出 `none`", async () => {
    const target = await real()
    const { v1, providers, models, composer } = await target.lists()
    const tiered = target.rows.filter((row) => row.model.variants.length > 0)
    expect(tiered.length).toBeGreaterThan(0)
    // 引擎自己的清单里确实有这一档(否则下面是空对空)
    expect(tiered.map((row) => ({ key: rowKey(row), engine: models.find((model) => model.providerID === row.model.providerID && model.id === row.model.id)?.variants.map((variant) => variant.id) }))).toEqual(
      tiered.map((row) => ({ key: rowKey(row), engine: [...row.model.variants, TITLE_VARIANT_ALIAS] })),
    )
    // 生产适配器(GET /provider → toV1ProviderList)给冻结界面的:每一行的档位 == 目录的 chip(含无档行)
    const shown = (row: ModelPickerRow) => Object.keys(v1.all.find((provider) => provider.id === row.model.providerID)?.models[row.model.id]?.variants ?? {})
    expect(target.rows.map((row) => ({ key: rowKey(row), variants: shown(row) }))).toEqual(target.rows.map((row) => ({ key: rowKey(row), variants: row.model.variants })))
    // composer 的模型合同(生产 createModelContract → 冻结 v1 SDK 的 `client.v2.model.list` → 生产适配器 GET /api/model):清单拿得到
    // (拿不到 ⇒ 模型链一直 recovering、发送按钮不亮、平台行停在「正在同步…」),每一行的档位 == 目录的 chip
    expect(composer.error).toBeUndefined()
    const listed = (row: ModelPickerRow) => composer.data?.find((model) => model.providerID === row.model.providerID && model.id === row.model.id)?.variants.map((variant) => variant.id)
    expect(target.rows.map((row) => ({ key: rowKey(row), variants: listed(row) }))).toEqual(target.rows.map((row) => ({ key: rowKey(row), variants: row.model.variants })))
    // 已知的坏:同一份引擎清单直接交冻结 app 的归一函数(适配器不剥)⇒ 每个有档模型多出 `none`
    const raw = normalizeProviderList(providers as never, models as never)
    expect(tiered.map((row) => ({ key: rowKey(row), variants: Object.keys(raw.all.get(row.model.providerID)?.models[row.model.id]?.variants ?? {}) }))).toEqual(
      tiered.map((row) => ({ key: rowKey(row), variants: [...row.model.variants, TITLE_VARIANT_ALIAS] })),
    )
  }, 120_000)
})
