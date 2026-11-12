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
//   · 能力轴(R1 R2 R3 R4 R5 R6a R8):探针插件上下文的 `permission.assert`,即工具体内调用的同一个服务,动作名与资源
//     取 2.x 工具真实断言的(read 的相对路径、external_directory 的 `<目录>/*`、shell 的命令、subagent 的目标 agent)。
//   · 工具表(R4 R5 只读「不进工具表」):模型桩记下的这一轮请求的 tools。
//   · 入口(R6b 带 agent 附件的 prompt、R6c 自带其它助手的非子任务命令、R6d 子任务命令):走引擎的 HTTP 路由。
//   · 身份轴(R10 第三方 MCP 工具、R11 插件工具、R12 设置里停用):模型桩发出真工具调用,经 ext 的执行闸。
//   · 审批请求的整条路径:ext 造出的每一种待批请求(身份轴的规则集询问 / 策略询问、内置工具的设置询问、子任务命令的询问、
//     定制中心安装)都能经引擎自己的 `GET /api/session/:id/permission` 列出来(桌面审批面读的就是它),且任何一层都没有 undefined。
// 已知的坏:「全部批准」列就是对照 —— 另两档与它不同的每一格,换成 build 都变放行,证明三种结局分得开;R6c 的反向臂是
// 同一条命令在 build 档里照样换了助手(探针看得见「换了」)。
// 不在本文件判的格:R7(出网围栏与总闸,不是规则层);R9(云工具)—— 与 R10 / R11 同一道执行闸,区别只在身份派生
// (codepuppy-cloud 权威只从核验过的定义铸,packages/ext/src/policy/register-policy.test.ts 与 plugin-host.test.ts 判),
// 在这里起一台受治理的远端 MCP 要 ARM / DEF 与云凭据整套,不在本文件做。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, policyStore, probe, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { explicitSkillDirs } from "./codepuppy-config-injection"
import { watchExplicitSources } from "./engine-explicit-config"

const sandbox = engineSandbox()
const FACTORY_SKILLS = path.join(sandbox.root, "factory-skills")
const MCP_CALLS = path.join(sandbox.root, "tiers-mcp-calls.log")
const BUILD = "build"
const ASK = "codepuppy-ask"
const READONLY = "codepuppy-readonly"
const TIERS = [BUILD, ASK, READONLY] as const
type Tier = (typeof TIERS)[number]
type Outcome = "allow" | "ask" | "deny"

// ── 引擎(test-component/codepuppy-engine.ts:生产注入 + 真 ext + 探针插件 + 模型桩)──────────────────────
const model = scriptedModel()
const modelRequests = model.requests
let running: Running | undefined
let projectDirectory = ""
let store: Awaited<ReturnType<typeof policyStore>> | undefined
const send = (method: string, route: string, body?: unknown) => running!.send(method, route, body)

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  // R2:出厂技能目录(main 启动时算好、经这个变量交给注入)
  fs.mkdirSync(FACTORY_SKILLS, { recursive: true })
  process.env.CODEPUPPY_FACTORY_SKILL_DIRS = JSON.stringify([FACTORY_SKILLS])
  const host = codepuppyEngine({
    sandbox,
    name: "tiers",
    modelBaseURL: model.baseURL,
    // R10:用户在 Code Puppy 里加的本地 MCP,真 stdio MCP 服务器,只列一个 echo 工具
    mcpCallLog: MCP_CALLS,
    projectFiles: {
      "a.txt": "a\n",
      // R6c / R6d 的两类命令:非子任务、自带其它助手;子任务(目标 general / 只读档自身)
      "opencode.json": JSON.stringify({
        commands: {
          "cp-as-build": { template: "as build", agent: BUILD },
          "cp-as-general": { template: "review", agent: "general", subtask: true },
          "cp-as-readonly": { template: "review", agent: READONLY, subtask: true },
        },
      }),
    },
  })
  projectDirectory = host.projectDirectory
  running = await host.start()
  expect(probe()).toBeDefined()
  await firstTurn(running, projectDirectory)
  // R12:用户在设置里停用 cp_disabled —— 经生产的策略存储写进 ext 读的那个位置
  store = await policyStore()
  await store.setRecord({ selector: { level: "tool", canonical: "plugin::cp_disabled" }, state: "disabled" } as never)
}, 60_000)

afterAll(async () => {
  await running?.close().catch(() => undefined)
  model.stop()
})

/**
 * 生产里引擎的第一句 prompt 先于任何工具调用;ext 在那一刻注册排在配置规则之后的那部分(策略目录的尾规则、R2 的 external_directory)。
 * 这里的判据有的直接问权限服务、不经 prompt,所以每台引擎先跑一轮。
 */
async function firstTurn(engine: Running, directory: string) {
  const sessionID = (await engine.send("POST", "/api/session", { location: { directory }, model: { id: "m", providerID: "codepuppy" } })).json.data.id as string
  await engine.send("POST", `/api/session/${sessionID}/prompt`, { text: "hello" })
  await engine.send("POST", `/api/experimental/session/${sessionID}/wait`)
}

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

/** 第三方 MCP 服务器连上(它的工具才进目录;MCP 工具默认进 Code Mode,模型经 `execute` 的程序调它)。 */
async function mcpConnected() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const servers = ((await send("GET", "/api/mcp")).json?.data ?? []) as Array<{ name: string; status: { status: string } }>
    if (servers.find((server) => server.name === "probe")?.status.status === "connected") return
    await Bun.sleep(50)
  }
  throw new Error(`the probe MCP server never connected: ${JSON.stringify((await send("GET", "/api/mcp")).json)}`)
}
const ECHO_PROGRAM = { code: 'return await tools.probe.echo({ text: "hi" })' }

/** 任何一层出现 undefined 的路径(JSON 里没有 undefined;引擎的 HTTP 编码器遇到它就整张列表失败)。 */
function undefinedPaths(value: unknown, at = "$"): string[] {
  if (value === undefined) return [at]
  if (value === null || typeof value !== "object") return []
  return Object.entries(value).flatMap(([key, item]) => undefinedPaths(item, `${at}.${key}`))
}

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

  // v1(`origin/alpha` codepuppy-tier-tool-matrix.test.ts「R2 external_directory」⇒ ASK / ASK / DENY;v1 引擎默认 agent 的白名单:
  // 截断输出目录、引擎临时目录、技能目录)。规则由 ext 的 agent 变换插在引擎底座之后(packages/ext/src/external-directory-rule.ts)。
  // 放行目录的期望值取引擎自己算的路径(`Global.Path`)与出厂目录,不取 ext 的推导。
  test("R2 工作区外的目录:全部批准 / 请求审批先问,只读拒绝;引擎的工具输出目录、临时目录与出厂技能目录在前两档放行,只读档仍拒绝", async () => {
    const { Global } = await import("@opencode/util/global")
    const dirs = {
      outside: `${path.join(sandbox.root, "outside")}/*`,
      toolOutput: `${path.join(Global.Path.data, "tool-output", "ses_x")}/*`,
      tmp: `${path.join(fs.realpathSync(Global.Path.tmp), "work")}/*`,
      skill: `${path.join(FACTORY_SKILLS, "probe-skill")}/*`,
    }
    const got: Record<string, Record<string, Outcome>> = {}
    for (const [label, resource] of Object.entries(dirs)) {
      got[label] = {}
      for (const tier of TIERS) got[label][tier] = await capability(tier, "external_directory", resource)
    }
    expect(got).toEqual({
      outside: expected({ build: "ask", "codepuppy-ask": "ask", "codepuppy-readonly": "deny" }),
      toolOutput: expected({ build: "allow", "codepuppy-ask": "allow", "codepuppy-readonly": "deny" }),
      tmp: expected({ build: "allow", "codepuppy-ask": "allow", "codepuppy-readonly": "deny" }),
      skill: expected({ build: "allow", "codepuppy-ask": "allow", "codepuppy-readonly": "deny" }),
    })
  }, 60_000)
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
describe("身份轴:模型发出的真工具调用经 ext 的执行闸(R10 第三方 MCP 工具 / R11 插件工具 / R12 设置里停用)", () => {
  test("R11 无记录的插件工具:全部批准档直接执行;请求审批档按 Code Puppy 策略问(askedBy policy);只读档每次问且不可始终允许(askedBy ruleset、save 为空);拒绝后零执行", async () => {
    const runs = () => probe().runs.cp_probe
    const start = runs()
    const build = await toolTurn(BUILD, "cp_probe", {})
    expect(build.asked).toEqual([])
    expect(runs()).toBe(start + 1)

    const ask = await toolTurn(ASK, "cp_probe", {})
    expect(ask.asked.map((request) => [request.action, request.metadata?.policy?.askedBy])).toEqual([["plugin::cp_probe", "policy"]])

    const readonly = await toolTurn(READONLY, "cp_probe", {})
    expect(readonly.asked.map((request) => [request.action, request.metadata?.policy?.askedBy, request.save])).toEqual([["plugin::cp_probe", "ruleset", []]])
    expect(runs()).toBe(start + 1)
  }, 60_000)

  test("R10 用户加的第三方 MCP 工具(真 stdio 服务器,经 Code Mode 调):全部批准档直接执行;请求审批档按策略问;只读档每次问且不可始终允许;拒绝后服务器零调用", async () => {
    const calls = () => (fs.existsSync(MCP_CALLS) ? fs.readFileSync(MCP_CALLS, "utf8").split("\n").filter(Boolean).length : 0)
    await mcpConnected()
    const build = await toolTurn(BUILD, "execute", ECHO_PROGRAM)
    expect(build.asked).toEqual([])
    expect(calls()).toBe(1)

    const ask = await toolTurn(ASK, "execute", ECHO_PROGRAM)
    expect(ask.asked.map((request) => [request.action, request.metadata?.policy?.askedBy])).toEqual([["mcp:probe:echo", "policy"]])

    const readonly = await toolTurn(READONLY, "execute", ECHO_PROGRAM)
    expect(readonly.asked.map((request) => [request.action, request.metadata?.policy?.askedBy, request.save])).toEqual([["mcp:probe:echo", "ruleset", []]])
    expect(calls()).toBe(1)
  }, 60_000)

  test("R12 设置里停用的工具:三档都具名拒绝、不问、零执行", async () => {
    for (const tier of TIERS) {
      const turn = await toolTurn(tier, "cp_disabled", {})
      expect([tier, turn.asked]).toEqual([tier, []])
    }
    expect(probe().runs.cp_disabled).toBe(0)
  }, 60_000)
})

// ── 审批请求的整条路径 ─────────────────────────────────────────────────────────────────────────────
describe("ext 造出的每一种待批请求都能经引擎路由列出,且 JSON 往返无损、任何一层没有 undefined", () => {
  /** 等这一轮出现待批请求:引擎持有的那份(插件上下文)与 HTTP 路由列出的那份都要在,两者一致。 */
  async function listed(sessionID: string) {
    for (const until = Date.now() + 8000; Date.now() < until; ) {
      const held = (await probe().ctx.permission.list({ sessionID })) as Array<Record<string, unknown>>
      if (held.length) {
        const route = await send("GET", `/api/session/${sessionID}/permission`)
        return { held, route }
      }
      await Bun.sleep(25)
    }
    throw new Error(`no pending request appeared in ${sessionID}`)
  }
  async function check(sessionID: string, action: string) {
    const { held, route } = await listed(sessionID)
    const request = held.find((item) => item.action === action)
    expect(request, JSON.stringify(held)).toBeDefined()
    expect(undefinedPaths(request)).toEqual([])
    expect(JSON.parse(JSON.stringify(request))).toEqual(request)
    expect([action, route.status]).toEqual([action, 200])
    expect((route.json.data as Array<Record<string, unknown>>).find((item) => item.id === request!.id)).toEqual(request)
    for (const item of held) await reject(sessionID, String(item.id))
  }
  /** 发一轮,模型桩发出这次工具调用;不等它结束(它停在审批上)。 */
  async function turn(agent: Tier, name: string, args: Record<string, unknown>) {
    const owner = await session(agent)
    await send("POST", `/api/session/${owner.id}/prompt`, { text: `CP-CALL ${JSON.stringify({ name, args })}` })
    return owner
  }

  test("身份轴的规则集询问(只读档 × 插件工具)与策略询问(请求审批档 × 插件工具)", async () => {
    const readonly = await turn(READONLY, "cp_probe", {})
    await check(readonly.id, "plugin::cp_probe")
    await idle(readonly.id)
    const ask = await turn(ASK, "cp_probe", {})
    await check(ask.id, "plugin::cp_probe")
    await idle(ask.id)
  }, 60_000)

  test("内置工具在设置里设为询问(全部批准档 × glob)", async () => {
    await store!.setRecord({ selector: { level: "tool", canonical: "builtin::glob" }, state: "ask" } as never)
    const owner = await turn(BUILD, "glob", { pattern: "*.txt" })
    await check(owner.id, "builtin::glob")
    await idle(owner.id)
  }, 60_000)

  test("子任务命令在 Code Puppy 策略里设为询问(evaluate 钩子写进身份信封)", async () => {
    await store!.setRecord({ selector: { level: "tool", canonical: "builtin::subagent" }, state: "ask" } as never)
    const owner = await session(BUILD)
    const running = send("POST", `/api/session/${owner.id}/command`, { name: "cp-as-general", text: "" })
    await check(owner.id, "subagent")
    await running
    await store!.removeRecord({ level: "tool", canonical: "builtin::subagent" } as never)
  }, 60_000)

  test("定制中心安装:调用前的身份询问与安装确认两条", async () => {
    const owner = await turn(ASK, "codepuppy_hub_install", { catalogId: "mcp:github" })
    const first = await listed(owner.id)
    expect(first.held.map((item) => item.action)).toEqual(["plugin::codepuppy_hub_install"])
    expect(first.route.status).toBe(200)
    await send("POST", `/api/session/${owner.id}/permission/${String(first.held[0]!.id)}/reply`, { decision: "once" })
    for (let i = 0; i < 200 && !((await probe().ctx.permission.list({ sessionID: owner.id })) as Array<{ action: string }>).some((item) => item.action === "codepuppy_hub_install"); i++)
      await Bun.sleep(25)
    await check(owner.id, "codepuppy_hub_install")
    await idle(owner.id)
  }, 60_000)

  test("已知的坏:同一条路由上,metadata 里藏一层 undefined 的请求列不出来(判据看得见这一类)", async () => {
    const owner = await session(ASK)
    const settled = Promise.resolve(
      probe().ctx.permission.assert({ sessionID: owner.id, agent: ASK, action: "shell", resources: ["ls"], save: ["ls"], metadata: { policy: { canonical: "x", bindingDigest: undefined } } }),
    ).catch(() => undefined)
    // 请求确实建了(引擎的待批表里有它),但两条读法都过同一个编码器,都在 metadata.policy 上失败:
    // 插件上下文的 list 拒绝,HTTP 路由回 5xx。拒不掉它也无妨 —— 引擎关闭时待批请求一律以拒绝收尾。
    let refused = ""
    for (const until = Date.now() + 8000; Date.now() < until && !refused; await Bun.sleep(25))
      await Promise.resolve(probe().ctx.permission.list({ sessionID: owner.id })).then(
        (held: unknown[]) => void (held.length && (refused = "listed")),
        (error: unknown) => void (refused = String((error as { message?: string })?.message ?? error)),
      )
    expect(refused).toContain("Expected JSON value")
    expect((await send("GET", `/api/session/${owner.id}/permission`)).status).toBeGreaterThanOrEqual(500)
    void settled
  }, 30_000)
})

// ── R2:用户自己的规则照 v1 胜出;技能翻代不必重新注入 ─────────────────────────────────────────────────────
// 这一组各起各的引擎(放在文件最后:新引擎的探针插件会接管 probe())。v1:用户配置里的 `external_directory` 排在引擎默认规则
// 之后(`merge(defaults, user)`),所以用户写的放行生效;只读档自己的 deny 在它的 agent 规则里,放不开。
describe("R2:用户在四处写的 external_directory 放行照 v1 胜出(全部批准 / 请求审批放行,只读仍拒绝);新一代技能目录不必重新注入", () => {
  async function outcomeOn(engine: Running, directory: string, agent: Tier, resource: string): Promise<Outcome> {
    const sessionID = (await engine.send("POST", "/api/session", { location: { directory }, agent })).json.data.id as string
    const settled = Promise.resolve(probe().ctx.permission.assert({ sessionID, agent, action: "external_directory", resources: [resource], save: [resource] })).then(
      () => "allow" as const,
      () => "deny" as const,
    )
    const early = await Promise.race([settled, Bun.sleep(300).then(() => "pending" as const)])
    if (early !== "pending") return early
    for (const request of ((await engine.send("GET", `/api/session/${sessionID}/permission`)).json.data ?? []) as Array<{ id: string }>)
      await engine.send("POST", `/api/session/${sessionID}/permission/${request.id}/reply`, { decision: "reject" })
    await settled
    return "ask"
  }
  const allowedDir = path.join(sandbox.root, "user-allowed")
  const userRule = { permission: { external_directory: { [`${allowedDir}/*`]: "allow" } } }

  for (const place of ["项目 opencode.json 顶层", "全局 opencode.json 顶层", "codepuppy.jsonc", "项目 opencode.json 的 agent 段"] as const)
    test(`${place}:放行 ⇒ allow / allow / deny;别的工作区外目录照旧先问`, async () => {
      const name = `tiers-user-${["项目 opencode.json 顶层", "全局 opencode.json 顶层", "codepuppy.jsonc", "项目 opencode.json 的 agent 段"].indexOf(place)}`
      if (place === "codepuppy.jsonc") {
        const root = path.join(sandbox.root, `${name}-state`, "codepuppy-state", "env", "dev")
        fs.mkdirSync(root, { recursive: true })
        fs.writeFileSync(path.join(root, "codepuppy.jsonc"), JSON.stringify(userRule))
      }
      const projectFiles =
        place === "项目 opencode.json 顶层"
          ? { "opencode.json": JSON.stringify(userRule) }
          : place === "项目 opencode.json 的 agent 段"
            ? { "opencode.json": JSON.stringify({ agent: { [BUILD]: userRule, [ASK]: userRule, [READONLY]: userRule } }) }
            : {}
      const host = codepuppyEngine({ sandbox, name, modelBaseURL: model.baseURL, projectFiles })
      if (place === "全局 opencode.json 顶层") fs.writeFileSync(path.join(host.slot.configDirectory, "opencode.json"), JSON.stringify(userRule))
      const engine = await host.start()
      try {
        await firstTurn(engine, host.projectDirectory)
        const got: Record<string, Outcome> = {}
        for (const tier of TIERS) got[tier] = await outcomeOn(engine, host.projectDirectory, tier, `${allowedDir}/*`)
        expect(got).toEqual(expected({ build: "allow", "codepuppy-ask": "allow", "codepuppy-readonly": "deny" }))
        expect(await outcomeOn(engine, host.projectDirectory, BUILD, `${path.join(sandbox.root, "not-allowed")}/*`)).toBe("ask")
      } finally {
        await engine.close()
      }
    }, 60_000)

  test("技能翻代:新一代的目录不必重新注入就放行(sidecar 的监听重写显式文件 ⇒ 引擎重载配置 ⇒ ext 的变换重算)", async () => {
    const name = "tiers-generation"
    const root = path.join(sandbox.root, `${name}-state`, "codepuppy-state", "env", "dev")
    const generation = (genId: string) => {
      const dir = path.join(root, "ext-store", "skill--cp-r2", "generations", genId)
      fs.mkdirSync(path.join(dir, "cp-r2"), { recursive: true })
      fs.writeFileSync(path.join(dir, "cp-r2", "SKILL.md"), "---\nname: cp-r2\ndescription: cp-r2 probe\n---\n\ncp-r2\n")
      fs.writeFileSync(path.join(root, "ext-store", "skill--cp-r2", "current.json"), JSON.stringify({ generation: genId }))
      return fs.realpathSync(dir)
    }
    const g1 = generation("gen-000001-aaaaaa")
    fs.writeFileSync(path.join(root, "skills-enabled.json"), JSON.stringify({ v: 1, keys: ["skill--cp-r2"] }))
    const host = codepuppyEngine({ sandbox, name, modelBaseURL: model.baseURL, filewatcher: true })
    const stop = watchExplicitSources({ ...host.injection.explicit!, skills: explicitSkillDirs, log: () => {} })
    const engine = await host.start()
    try {
      await firstTurn(engine, host.projectDirectory)
      expect(await outcomeOn(engine, host.projectDirectory, BUILD, `${g1}/*`)).toBe("allow")
      const g2 = generation("gen-000002-bbbbbb")
      let outcome: Outcome = "ask"
      for (const until = Date.now() + 15_000; Date.now() < until && outcome !== "allow"; await Bun.sleep(200))
        outcome = await outcomeOn(engine, host.projectDirectory, BUILD, `${g2}/*`)
      expect(outcome).toBe("allow")
    } finally {
      stop()
      await engine.close()
    }
  }, 60_000)
})

