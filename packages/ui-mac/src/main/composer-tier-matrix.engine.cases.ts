// `#1662` parity(REQ-236 §2.2 R1–R12,`#1573`;v1 的 codepuppy-tier-tool-matrix / codepuppy-composer-tiers /
// codepuppy-tier-delegation 随 OpenCode 2 换代删除):composer 三档 ——「全部批准」= build、「请求审批」= codepuppy-ask、
// 「只读」= codepuppy-readonly —— 在**嵌进 sidecar 的那台 OpenCode 2**上逐格得出方案写的结局。
//
// 供数方全是生产的:三档的规则来自真 `injectCodePuppyConfig`(内联文档 + 显式文件,原样交给 `start()`);引擎的底座规则、
// agent 合成、Permission 服务都是引擎自己的;真 ext(`packages/ext/src/plugin.ts`,以本地目录插件装,与 sidecar 同一个入口形状)
// 的策略与 evaluate 钩子都在。测试只加两样:一个探针插件(拿到插件上下文、注册两个插件工具),一个本机 OpenAI 兼容模型桩
// (平台节点经 `CODEPUPPY_BASE_URL` 指向它;用户回合里写 `CP-CALL {json}` 就回一次那个工具调用)。
//
// 三种结局:放行(调用直接通过 / 工具真执行)、询问(引擎的待批列表里出现一条;经引擎自己的回复路由拒绝后零副作用)、
// 拒绝(具名拒绝、没有待批请求、零副作用)。
//   · 能力轴(R1 R3 R4 R5 R6a R8,R2 只读格):探针插件上下文的 `permission.assert`,即工具体内调用的同一个服务,动作名与资源
//     取 2.x 工具真实断言的(read 的相对路径、external_directory 的 `<目录>/*`、shell 的命令、subagent 的目标 agent)。
//   · 工具表(R4 R5 只读「不进工具表」):模型桩记下的这一轮请求的 tools。
//   · 入口(R6b 带 agent 附件的 prompt、R6c 自带其它助手的非子任务命令、R6d 子任务命令):走引擎的 HTTP 路由。
//   · 身份轴(R11 插件工具、R12 设置里停用):模型桩发出真工具调用,经 ext 的执行闸。
// 已知的坏:「全部批准」列就是对照 —— 另两档与它不同的每一格,换成 build 都变放行,证明三种结局分得开;R6c 的反向臂是
// 同一条命令在 build 档里照样换了助手(探针看得见「换了」)。
// 不在本文件判的格:R7(出网围栏与总闸,不是规则层);R2 的「全部批准 / 请求审批 ⇒ 询问」两格 —— 2.x 上实测不成立(底座
// `*: allow` 放行 external_directory),见 docs/specs/1662-opencode2/plan-parity.md 第 3 项;R9 / R10(云工具、第三方 MCP)的
// 身份轴与 R11 同一道执行闸,按来源派生身份由 packages/ext/src/policy/register-policy.test.ts 判。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../test-component/engine-sandbox"
import { buildEngineServerOptions } from "./engine-server-options"
import { withEngineAuthorization } from "./engine-authorization"
import { injectCodePuppyConfig } from "./codepuppy-config-injection"
import { secretFilePath, secretFileRef } from "./codepuppy-secret-files"
import type { EngineFetch } from "./in-process-engine"

const sandbox = engineSandbox()
const PASSWORD = "cp-parity-tiers"
const BUILD = "build"
const ASK = "codepuppy-ask"
const READONLY = "codepuppy-readonly"
const TIERS = [BUILD, ASK, READONLY] as const
type Tier = (typeof TIERS)[number]
type Outcome = "allow" | "ask" | "deny"

// ── 模型桩 ────────────────────────────────────────────────────────────────────────────────────────
const modelRequests: Array<{ tools: string[] }> = []
const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "chatcmpl-cp-tiers", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const text = (value: string) => chunk({ role: "assistant", content: value }) + chunk({}, "stop") + "data: [DONE]\n\n"
const textOf = (content: unknown) => (typeof content === "string" ? content : Array.isArray(content) ? content.map((part: any) => part?.text ?? "").join("") : "")
let callSeq = 0
const llm = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (!request.url.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
    const body = (await request.json()) as { messages?: Array<{ role: string; content?: unknown }>; tools?: Array<{ function?: { name?: string } }> }
    modelRequests.push({ tools: (body.tools ?? []).map((tool) => String(tool.function?.name)) })
    const messages = body.messages ?? []
    const headers = { "content-type": "text/event-stream" }
    if (messages.at(-1)?.role === "tool") return new Response(text("done"), { headers })
    const marker = textOf(messages.filter((message) => message.role === "user").at(-1)?.content).match(/CP-CALL (\{.*\})/)
    if (!marker) return new Response(text("ok"), { headers })
    const call = JSON.parse(marker[1]!) as { name: string; args: Record<string, unknown> }
    const id = `call_cp_tiers_${++callSeq}`
    const body2 =
      chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }) +
      chunk({}, "tool_calls") +
      "data: [DONE]\n\n"
    return new Response(body2, { headers })
  },
})

// ── 引擎 ──────────────────────────────────────────────────────────────────────────────────────────
type Probe = { ctx: any; runs: Record<string, number> }
const probe = () => (globalThis as { __cpTierProbe?: Probe }).__cpTierProbe!
let fetch: EngineFetch
let projectDirectory = ""
let engine: { close: () => Promise<void> } | undefined

const send = async (method: string, route: string, body?: unknown) => {
  const response = await fetch(
    new Request(`http://codepuppy-sidecar.invalid${route}`, {
      method,
      headers: { "x-opencode-directory": encodeURIComponent(projectDirectory), "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
  const raw = await response.text()
  return { status: response.status, json: raw ? (JSON.parse(raw) as any) : undefined }
}

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  const userData = path.join(sandbox.root, "tiers-userdata")
  process.env.CODEPUPPY_GLOBAL_DIR = path.join(sandbox.root, "tiers-state", "codepuppy-state", "env", "dev")
  fs.mkdirSync(process.env.CODEPUPPY_GLOBAL_DIR, { recursive: true })
  const key = secretFilePath(userData, "CODEPUPPY_API_KEY")
  fs.mkdirSync(path.dirname(key), { recursive: true })
  fs.writeFileSync(key, "sk-cp-parity-tiers", { mode: 0o600 })
  // sidecar 在 fork 时置的两样:平台节点地址(这里指向模型桩)与平台凭据的 {file:} 引用(ext 的请求头每次现读它)
  process.env.CODEPUPPY_BASE_URL = `http://127.0.0.1:${llm.port}/v1`
  process.env.CODEPUPPY_PLATFORM_AUTH_REF = secretFileRef(userData, "CODEPUPPY_API_KEY")
  process.env.CODEPUPPY_POLICY_ACCOUNT = `t-tiers-${Math.random().toString(36).slice(2)}`

  // 真 ext:2.x 只装目录形式的本地插件,入口 server.js 的 default 导出(packages/core/src/plugin/module.ts)
  const ext = path.join(sandbox.root, "tiers-ext")
  fs.mkdirSync(ext, { recursive: true })
  fs.writeFileSync(path.join(ext, "server.js"), `export { default } from ${JSON.stringify(path.resolve(import.meta.dir, "../../../ext/src/plugin.ts"))}\n`)
  const probeDir = path.join(sandbox.root, "tiers-probe")
  fs.mkdirSync(probeDir, { recursive: true })
  fs.writeFileSync(
    path.join(probeDir, "server.js"),
    `export default { id: "codepuppy.test.tier-probe", setup: async (ctx) => {
  const state = { ctx, runs: { cp_probe: 0, cp_disabled: 0 } }
  globalThis.__cpTierProbe = state
  await ctx.tool.transform((editor) => {
    for (const name of ["cp_probe", "cp_disabled"])
      editor.add({ name, description: name, input: { type: "object", properties: {} }, options: { codemode: false },
        execute: async () => { state.runs[name] += 1; return { content: name + " ran" } } })
  })
} }\n`,
  )

  const injection = injectCodePuppyConfig(userData, ext, "stable")
  const content = JSON.parse(injection.config.content) as { plugins: string[]; providers: Record<string, { models?: Record<string, unknown> }> }
  content.plugins = [...content.plugins, probeDir]
  // 沙箱里没有已应用的平台目录,平台节点的模型表是空的(`#1556`);补一个模型只为能发出请求
  content.providers.codepuppy!.models = { m: { name: "m" } }

  const slot = engineSlot(sandbox, "tiers")
  projectDirectory = slot.projectDirectory
  fs.writeFileSync(path.join(projectDirectory, "a.txt"), "a\n")
  // R6c / R6d 的两类命令:非子任务、自带其它助手;子任务(目标 general / 只读档自身)
  fs.writeFileSync(
    path.join(projectDirectory, "opencode.json"),
    JSON.stringify({
      commands: {
        "cp-as-build": { template: "as build", agent: BUILD },
        "cp-as-general": { template: "review", agent: "general", subtask: true },
        "cp-as-readonly": { template: "review", agent: READONLY, subtask: true },
      },
    }),
  )
  const { startEngine } = await import("../../engine/engine-embed")
  engine = await startEngine(
    buildEngineServerOptions({
      hostname: "127.0.0.1",
      port: 0,
      password: PASSWORD,
      engineVersion: "test",
      databasePath: slot.databasePath,
      configDirectory: slot.configDirectory,
      config: { content: JSON.stringify(content), file: injection.config.file },
      models: { ...(injection.models.file ? { file: injection.models.file } : {}), fetch: false },
      filewatcher: false,
      platform: process.platform,
    }),
    { onDispatch: (dispatch) => (fetch = withEngineAuthorization(dispatch, PASSWORD)) },
  )
  // Location 在第一次带目录的请求时才起,插件随之装载:轮询到 ext 与探针都不再是 loading
  const status = async (id: string) =>
    (((await send("GET", "/api/plugin")).json?.data ?? []) as Array<{ id: string; state: { status: string } }>).find((plugin) => plugin.id === id)?.state.status
  for (let i = 0; i < 200 && ((await status("codepuppy.ext")) !== "active" || !(globalThis as { __cpTierProbe?: Probe }).__cpTierProbe); i++) await Bun.sleep(50)
  // 前提:ext 真装上了(不然身份轴的格判的是「没有 ext」)
  expect(await status("codepuppy.ext")).toBe("active")
  expect(probe()).toBeDefined()
  // ext 的策略模块在沙箱就位之后才装载(静态 import 会先于沙箱算出全局根目录)
  const { createToolPolicyStore, defaultPolicyBaseDir } = await import("../../../ext/src/policy/resolver")
  const { policyWorkspace } = await import("../../../ext/src/policy/index")
  // R12:用户在设置里停用 cp_disabled —— 经生产的策略存储写进 ext 读的那个位置(数据根 / 账户 / 工作区与 registerPolicy 同一套)
  const store = createToolPolicyStore({
    baseDir: defaultPolicyBaseDir(path.join(process.env.XDG_DATA_HOME!, "opencode")),
    account: () => process.env.CODEPUPPY_POLICY_ACCOUNT!,
    workspace: () => policyWorkspace(probe().ctx.location),
  })
  await store.setRecord({ selector: { level: "tool", canonical: "plugin::cp_disabled" }, state: "disabled" } as never)
}, 60_000)

afterAll(async () => {
  await engine?.close().catch(() => undefined)
  llm.stop(true)
})

// ── 小工具 ────────────────────────────────────────────────────────────────────────────────────────
async function session(agent: Tier) {
  const created = await send("POST", "/api/session", { location: { directory: projectDirectory }, agent, model: { id: "m", providerID: "codepuppy" } })
  expect(created.status).toBe(200)
  return created.json.data as { id: string; agent: string }
}
const pendingOf = async (sessionID: string) => ((await send("GET", `/api/session/${sessionID}/permission`)).json?.data ?? []) as Array<{ id: string; action: string; resources: string[]; save: string[]; metadata?: any }>
const reject = (sessionID: string, requestID: string) => send("POST", `/api/session/${sessionID}/permission/${requestID}/reply`, { decision: "reject" })
const children = async (parentID: string) => (((await send("GET", "/api/session")).json?.data ?? []) as Array<{ id: string; parentID?: string }>).filter((item) => item.parentID === parentID)
const agentOf = async (sessionID: string) => (await send("GET", `/api/session/${sessionID}`)).json.data.agent as string
const idle = (sessionID: string) => send("POST", `/api/experimental/session/${sessionID}/wait`)

async function waitPending(sessionID: string, ms = 5000) {
  for (const until = Date.now() + ms; Date.now() < until; ) {
    const list = await pendingOf(sessionID)
    if (list.length) return list
    await Bun.sleep(25)
  }
  return []
}

/** 能力轴一格:插件上下文的 `permission.assert`(工具体内同一个服务)。询问则经引擎的回复路由拒掉,并断言它随之失败。 */
async function capability(agent: Tier, action: string, resource: string): Promise<Outcome> {
  const owner = await session(agent)
  const settled = Promise.resolve(probe().ctx.permission.assert({ sessionID: owner.id, agent, action, resources: [resource], save: [resource] })).then(
    () => "allow" as const,
    (error: unknown) => ({ error: String((error as { message?: string })?.message ?? error) }),
  )
  const early = await Promise.race([settled, Bun.sleep(300).then(() => "pending" as const)])
  if (early === "allow") return "allow"
  if (early !== "pending") {
    expect(await pendingOf(owner.id)).toEqual([])
    expect(early.error).toContain(`Permission denied: ${action}`)
    return "deny"
  }
  const [request, ...more] = await pendingOf(owner.id)
  expect(more).toEqual([])
  expect([request?.action, request?.resources]).toEqual([action, [resource]])
  await reject(owner.id, request!.id)
  expect(await settled).not.toBe("allow")
  return "ask"
}

/** 一个用户回合,模型桩据此发出一次工具调用;询问则拒掉。返回结局与这一轮期间出现的待批请求。 */
async function toolTurn(agent: Tier, name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const owner = await session(agent)
  const prompt = await send("POST", `/api/session/${owner.id}/prompt`, { text: `CP-CALL ${JSON.stringify({ name, args })}`, ...extra })
  expect(prompt.status).toBeLessThan(300)
  const settled = idle(owner.id)
  const raced = await Promise.race([settled.then(() => "idle" as const), waitPending(owner.id, 8000).then((list) => (list.length ? list : ("none" as const)))])
  if (raced === "idle" || raced === "none") {
    await settled
    return { session: owner, asked: [] as Awaited<ReturnType<typeof pendingOf>> }
  }
  for (const request of raced) await reject(owner.id, request.id)
  await settled
  return { session: owner, asked: raced }
}

const expected = (table: Record<Tier, Outcome>) => table

// ── 能力轴 ────────────────────────────────────────────────────────────────────────────────────────
describe("能力轴:真注入的三档规则 + 引擎底座 + ext 的 evaluate 钩子(R1 R3 R4 R5 R6a R8)", () => {
  const cells: Array<[string, string, string, Record<Tier, Outcome>]> = [
    ["R1 工作区内读", "read", "a.txt", expected({ build: "allow", "codepuppy-ask": "allow", "codepuppy-readonly": "allow" })],
    ["R3 读 .env", "read", ".env", expected({ build: "ask", "codepuppy-ask": "ask", "codepuppy-readonly": "deny" })],
    ["R4 改文件", "edit", "a.txt", expected({ build: "allow", "codepuppy-ask": "ask", "codepuppy-readonly": "deny" })],
    ["R5 运行命令", "shell", "ls", expected({ build: "allow", "codepuppy-ask": "ask", "codepuppy-readonly": "deny" })],
    ["R6a 派给其它助手", "subagent", "general", expected({ build: "allow", "codepuppy-ask": "ask", "codepuppy-readonly": "deny" })],
    ["R8 宿主工具(列 MCP 资源)", "opencode_list_mcp_resources", "any", expected({ build: "allow", "codepuppy-ask": "allow", "codepuppy-readonly": "allow" })],
  ]
  for (const [label, action, resource, table] of cells)
    test(`${label}:${TIERS.map((tier) => `${tier}=${table[tier]}`).join(" / ")}`, async () => {
      const got: Record<string, Outcome> = {}
      for (const tier of TIERS) got[tier] = await capability(tier, action, resource)
      expect(got).toEqual(table)
    }, 30_000)

  test("R6a 同档自身:只读档派给只读档、请求审批档派给请求审批档 ⇒ 放行;只读档派给请求审批档 ⇒ 拒绝", async () => {
    expect(await capability(READONLY, "subagent", READONLY)).toBe("allow")
    expect(await capability(ASK, "subagent", ASK)).toBe("allow")
    expect(await capability(READONLY, "subagent", ASK)).toBe("deny")
  }, 30_000)

  test("R2 只读档:工作区外的目录 ⇒ 拒绝", async () => {
    expect(await capability(READONLY, "external_directory", `${path.join(sandbox.root, "outside")}/*`)).toBe("deny")
  }, 30_000)
})

// ── 工具表 ────────────────────────────────────────────────────────────────────────────────────────
describe("工具表:只读档里改文件、运行命令的工具不进模型这一轮的 tools(R4 / R5「不进工具表」)", () => {
  test("只读档的请求里没有 edit / write / patch / shell;全部批准档的请求里有 edit 与 shell(对照)", async () => {
    const toolsFor = async (agent: Tier) => {
      const before = modelRequests.length
      const owner = await session(agent)
      await send("POST", `/api/session/${owner.id}/prompt`, { text: "hello" })
      await idle(owner.id)
      // 同一轮里引擎还会发起不带工具的起标题请求;判模型这一轮手里的工具表,取带工具最多的那一次
      const turn = modelRequests.slice(before).toSorted((a, b) => b.tools.length - a.tools.length)[0]
      expect(turn?.tools.length, JSON.stringify(modelRequests.slice(before))).toBeGreaterThan(0)
      return turn!.tools
    }
    const build = await toolsFor(BUILD)
    expect(build).toEqual(expect.arrayContaining(["edit", "shell"]))
    const readonly = await toolsFor(READONLY)
    expect(readonly).toEqual(expect.arrayContaining(["read"]))
    for (const name of ["edit", "write", "patch", "shell"]) expect([name, readonly.includes(name)]).toEqual([name, false])
  }, 30_000)
})

// ── 委派入口 ──────────────────────────────────────────────────────────────────────────────────────
describe("委派入口与直接路径同判(R6b / R6c / R6d)", () => {
  const SUBAGENT_CALL = { agent: "general", description: "probe", prompt: "do the thing" }

  test("R6b 带 agent 附件(@general)的 prompt:模型据此派子任务 —— 只读档具名拒绝、零子会话;请求审批档先问,拒绝后零子会话;全部批准档建出子会话", async () => {
    const attach = { agents: [{ name: "general" }] }
    const readonly = await toolTurn(READONLY, "subagent", SUBAGENT_CALL, attach)
    expect(readonly.asked).toEqual([])
    expect(await children(readonly.session.id)).toEqual([])
    expect(await agentOf(readonly.session.id)).toBe(READONLY)

    const ask = await toolTurn(ASK, "subagent", SUBAGENT_CALL, attach)
    expect(ask.asked.map((request) => [request.action, request.resources])).toEqual([["subagent", ["general"]]])
    expect(await children(ask.session.id)).toEqual([])

    const build = await toolTurn(BUILD, "subagent", SUBAGENT_CALL, attach)
    expect(build.asked).toEqual([])
    expect(await children(build.session.id)).toHaveLength(1)
  }, 60_000)

  test("R6c 自带其它助手的非子任务命令(agent: build):只读档具名拒绝、会话仍是只读档、模型没被调用;请求审批档先问,拒绝后仍是请求审批档", async () => {
    const readonly = await session(READONLY)
    const before = modelRequests.length
    const refused = await send("POST", `/api/session/${readonly.id}/command`, { name: "cp-as-build", text: "" })
    await idle(readonly.id)
    expect(refused.status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(refused.json)).toContain("subagent")
    expect(await pendingOf(readonly.id)).toEqual([])
    expect(await agentOf(readonly.id)).toBe(READONLY)
    expect(modelRequests.length).toBe(before)

    const ask = await session(ASK)
    const running = send("POST", `/api/session/${ask.id}/command`, { name: "cp-as-build", text: "" })
    const [request, ...more] = await waitPending(ask.id)
    expect(more).toEqual([])
    expect([request?.action, request?.resources]).toEqual(["subagent", [BUILD]])
    expect(await agentOf(ask.id)).toBe(ASK)
    await reject(ask.id, request!.id)
    await running
    await idle(ask.id)
    expect(await agentOf(ask.id)).toBe(ASK)
  }, 60_000)

  test("R6c 反向臂(探针看得见「换了」):同一条命令在全部批准档里不问,会话换成命令的助手", async () => {
    const owner = await session(ASK)
    const running = send("POST", `/api/session/${owner.id}/command`, { name: "cp-as-build", text: "" })
    const [request] = await waitPending(owner.id)
    await send("POST", `/api/session/${owner.id}/permission/${request!.id}/reply`, { decision: "once" })
    await running
    await idle(owner.id)
    expect(await agentOf(owner.id)).toBe(BUILD)

    const build = await session(BUILD)
    await send("POST", `/api/session/${build.id}/command`, { name: "cp-as-build", text: "" })
    await idle(build.id)
    expect(await pendingOf(build.id)).toEqual([])
    expect(await agentOf(build.id)).toBe(BUILD)
  }, 60_000)

  test("R6d 子任务命令:目标是其它助手 —— 只读档拒绝、请求审批档先问(拒绝后零子会话)、全部批准档建出子会话;目标是只读档自身 ⇒ 只读档放行", async () => {
    const readonly = await session(READONLY)
    await send("POST", `/api/session/${readonly.id}/command`, { name: "cp-as-general", text: "" })
    await idle(readonly.id)
    expect(await pendingOf(readonly.id)).toEqual([])
    expect(await children(readonly.id)).toEqual([])

    const ask = await session(ASK)
    const running = send("POST", `/api/session/${ask.id}/command`, { name: "cp-as-general", text: "" })
    const [request] = await waitPending(ask.id)
    expect([request?.action, request?.resources]).toEqual(["subagent", ["general"]])
    await reject(ask.id, request!.id)
    await running
    expect(await children(ask.id)).toEqual([])

    const build = await session(BUILD)
    await send("POST", `/api/session/${build.id}/command`, { name: "cp-as-general", text: "" })
    expect(await children(build.id)).toHaveLength(1)

    const self = await session(READONLY)
    await send("POST", `/api/session/${self.id}/command`, { name: "cp-as-readonly", text: "" })
    expect(await children(self.id)).toHaveLength(1)
  }, 60_000)
})

// ── 身份轴 ────────────────────────────────────────────────────────────────────────────────────────
describe("身份轴:模型发出的真工具调用经 ext 的执行闸(R11 插件工具的全部批准格 / R12 设置里停用)", () => {
  test("R11 无记录的插件工具:全部批准档直接执行、不问", async () => {
    const start = probe().runs.cp_probe
    const build = await toolTurn(BUILD, "cp_probe", {})
    expect(build.asked).toEqual([])
    expect(probe().runs.cp_probe).toBe(start + 1)
  }, 60_000)

  test("R12 设置里停用的工具:三档都具名拒绝、不问、零执行", async () => {
    for (const tier of TIERS) {
      const turn = await toolTurn(tier, "cp_disabled", {})
      expect([tier, turn.asked]).toEqual([tier, []])
    }
    expect(probe().runs.cp_disabled).toBe(0)
  }, 60_000)
})
