// `#1665`:ext 在 OpenCode 2 真插件宿主里(plugin-host.harness.ts)—— 每条用例装的是生产的默认导出 `CodePuppyExt`,
// 经上游真的钩子链 / 工具注册表 / transform 服务判结果。「权威保持」类用例都带反向臂:同一个输入在**不装 ext** 的宿主里
// 走上游默认,结论必须相反 —— 去掉我们的钩子 ⇒ 这条用例红。
import { afterEach, beforeAll, expect } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LoadAPIKeyError } from "@ai-sdk/provider"
import { Cause, Effect, Exit } from "effect"
import { Agent } from "../../core/src/agent.ts"
import { Location } from "../../core/src/location.ts"
import { Command } from "../../core/src/command.ts"
import { PluginHooks } from "../../core/src/plugin/hooks.ts"
import { Skill } from "../../core/src/skill.ts"
import { Tool } from "../../core/src/tool.ts"
import { WebSearch } from "../../core/src/websearch.ts"
import { Session } from "../../schema/src/session.ts"
import { SessionMessage } from "../../schema/src/session-message.ts"
import type { Plugin } from "@opencode/plugin"
import CodePuppyExt from "./plugin"
import { activate, it, recordingMcp } from "./plugin-host.harness"
import { CODEPUPPY_EXPLORE_PROMPT } from "./codepuppy-prompts"
import { TOOL_TEXT } from "./context-injection"

const ENV_KEYS = [
  "CODEPUPPY_GLOBAL_DIR",
  "CODEPUPPY_LOCAL_WEBSEARCH_DENY",
  "CODEPUPPY_CLOUD_WEBSEARCH_DENY",
  "CODEPUPPY_CLOUD_MCP_ARM",
  "CODEPUPPY_CLOUD_MCP_DEF",
  "CODEPUPPY_CLOUD_MCP_SERVER",
  "CODEPUPPY_BASE_URL",
  "CODEPUPPY_PLATFORM_AUTH_REF",
  "CODEPUPPY_FACTORY_DENY_SKILLS",
  "CODEPUPPY_PROMPT_REBRAND_DISABLE",
] as const
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
let scratch = ""
beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-ext-host-")))
  mkdirSync(join(scratch, "global"), { recursive: true })
})
const env = (values: Partial<Record<(typeof ENV_KEYS)[number], string>>) => {
  for (const key of ENV_KEYS) delete process.env[key]
  process.env.CODEPUPPY_GLOBAL_DIR = join(scratch, "global")
  Object.assign(process.env, values)
}
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

const ids = {
  sessionID: Session.ID.make("ses_codepuppy_ext_host"),
  agent: "build" as never,
  messageID: SessionMessage.ID.make("msg_codepuppy_ext_host"),
}
const before = (tool: string, input: unknown = {}) =>
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    return yield* hooks.trigger("tool", "execute.before", { tool, ...ids, id: "call_1" as never, input }).pipe(Effect.exit)
  })
const contextEvent = (system: string[], model = { providerID: "stub", id: "stub-model" }) => ({
  ...ids,
  model: model as never,
  system: system.map((text) => ({ type: "text" as const, text })),
  messages: [],
  options: { maxTokens: 32000 } as Record<string, unknown>,
  tools: {},
})

it.live("P1 / P8:真宿主装上 ext 的默认导出 —— 八个 codepuppy 工具进工具表(一等工具,不进 Code Mode),codepuppy_echo 经真工具执行返回", () =>
  Effect.gen(function* () {
    env({})
    yield* activate(CodePuppyExt)
    const tools = yield* Tool.Service
    const listed = (yield* tools.list()).map((tool) => tool.id)
    expect(listed.toSorted()).toEqual(Object.keys(TOOL_TEXT).toSorted())
    const snapshot = yield* tools.snapshot()
    const ours = snapshot.definitions.filter((definition) => definition.name.startsWith("codepuppy_"))
    expect(ours.map((definition) => definition.name).toSorted()).toEqual(Object.keys(TOOL_TEXT).toSorted())
    expect(JSON.stringify(snapshot.codeModeCatalog ?? {})).not.toContain("codepuppy_")
    for (const definition of ours)
      expect(definition.description).toBe(TOOL_TEXT[definition.name as keyof typeof TOOL_TEXT].description)
    const result = yield* snapshot.execute({ ...ids, call: { type: "tool-call", id: "call_echo", name: "codepuppy_echo", input: { text: "hi", shout: true } } })
    expect(JSON.stringify(result.content)).toContain("codepuppy_echo: HI")
  }),
)

it.live("权威 · 联网搜索准入(L5r):kill-switch 下 2.x 内置 websearch 与第三方 web search MCP 在 execute.before 被拒;反向臂:不装 ext ⇒ 放行", () =>
  Effect.gen(function* () {
    env({ CODEPUPPY_LOCAL_WEBSEARCH_DENY: "1", CODEPUPPY_CLOUD_WEBSEARCH_DENY: "1" })
    const baseline = yield* before("websearch", { query: "x" })
    expect(Exit.isSuccess(baseline)).toBe(true)
    yield* activate(CodePuppyExt)
    for (const tool of ["websearch", "exa_web_search_exa"]) {
      const exit = yield* before(tool, { query: "x" })
      expect(Exit.isFailure(exit)).toBe(true)
      expect(JSON.stringify(exit)).toContain("kill switch")
    }
    // 兄弟工具不误杀(AC4)
    expect(Exit.isSuccess(yield* before("codepuppy_dispatch"))).toBe(true)
  }),
)

it.live("权威 · 本地 keyless 搜网的供应商(L5r):没有任何选择时 ext 定为 exa,上游不必弹选择表单;用户 / 上游已选的不动;反向臂:不装 ext ⇒ 无默认", () =>
  Effect.gen(function* () {
    env({})
    yield* activate({
      id: "test.websearch-providers",
      async setup(context) {
        await context.websearch.transform((editor) => {
          for (const id of ["exa", "parallel"]) editor.add({ id, name: id, execute: async () => [] })
        })
      },
    })
    const websearch = yield* WebSearch.Service
    expect(yield* websearch.default()).toBeUndefined()
    yield* activate(CodePuppyExt)
    expect((yield* websearch.default())?.id).toBe("exa")
    yield* activate({
      id: "test.user-websearch-choice",
      async setup(context) {
        await context.websearch.transform((editor) => editor.default.set("parallel"))
      },
    })
    expect((yield* websearch.default())?.id).toBe("parallel")
  }),
)

it.live("联网搜索:不在 kill-switch(代付 / 登出)⇒ 内置 websearch 照常放行(ADR-046 D1)", () =>
  Effect.gen(function* () {
    env({})
    yield* activate(CodePuppyExt)
    expect(Exit.isSuccess(yield* before("websearch", { query: "x" }))).toBe(true)
  }),
)

it.live("权威 · 云工具接入(M3):ARM+DEF 在场 ⇒ ext 的 mcp.transform 用解析过 {file:} 的定义整条替换中和条目;反向臂:不装 ext ⇒ 中和条目原样留着", () =>
  Effect.gen(function* () {
    const token = join(scratch, "mcp-token")
    writeFileSync(token, "secret-token\n")
    const definition = { type: "remote", url: "https://cloud.example/mcp", oauth: false, headers: { Authorization: `Bearer {file:${token}}` } }
    env({ CODEPUPPY_CLOUD_MCP_ARM: "codepuppy", CODEPUPPY_CLOUD_MCP_DEF: JSON.stringify(definition), CODEPUPPY_CLOUD_MCP_SERVER: "codepuppy" })
    const neutralised = { type: "remote", url: "http://127.0.0.1:1/withheld", disabled: true }
    const without = recordingMcp({ codepuppy: neutralised })
    expect(without.servers.get("codepuppy")).toEqual(neutralised)
    const mcp = recordingMcp({ codepuppy: neutralised })
    yield* activate(CodePuppyExt, { mcp })
    expect(mcp.servers.get("codepuppy")).toEqual({
      type: "remote",
      url: "https://cloud.example/mcp",
      oauth: false,
      headers: { Authorization: "Bearer secret-token" },
    })
  }),
)

it.live("云工具接入:{file:} 引用读不到 ⇒ 不装(fail-closed),中和条目留着", () =>
  Effect.gen(function* () {
    const definition = { type: "remote", url: "https://cloud.example/mcp", headers: { Authorization: `Bearer {file:${join(scratch, "missing")}}` } }
    env({ CODEPUPPY_CLOUD_MCP_ARM: "codepuppy", CODEPUPPY_CLOUD_MCP_DEF: JSON.stringify(definition) })
    const neutralised = { type: "remote", url: "http://127.0.0.1:1/withheld", disabled: true }
    const mcp = recordingMcp({ codepuppy: neutralised })
    yield* activate(CodePuppyExt, { mcp })
    expect(mcp.servers.get("codepuppy")).toEqual(neutralised)
  }),
)

it.live("权威 · 云工具准入:治理云 server 上的 web search 只按本 Location 核验过的端点身份豁免;冒名 server 上的同形工具照样被拒", () =>
  Effect.gen(function* () {
    const definition = { type: "remote", url: "https://cloud.example/mcp" }
    // 只置 LOCAL:第三方 web search 关,治理云 server 的 web search 豁免(只有 CLOUD 信号关它)。
    env({ CODEPUPPY_CLOUD_MCP_ARM: "cloud", CODEPUPPY_CLOUD_MCP_DEF: JSON.stringify(definition), CODEPUPPY_CLOUD_MCP_SERVER: "cloud", CODEPUPPY_LOCAL_WEBSEARCH_DENY: "1" })
    const mcp = recordingMcp({ cloud_attacker: { type: "remote", url: "https://evil.example/mcp" } })
    yield* activate(CodePuppyExt, { mcp })
    expect(Exit.isSuccess(yield* before("cloud_web_search"))).toBe(true)
    expect(Exit.isFailure(yield* before("cloud_attacker_web_search"))).toBe(true)
  }),
)

it.live("P3 / L3r:session.hook.context 的品牌转写只换登记过的上游底座句;反向臂:不装 ext ⇒ 底座原样", () =>
  Effect.gen(function* () {
    env({})
    // 能看图的模型:识图说明不进来,只看品牌转写。
    yield* activate(providerPlugin("stub", "https://api.stub.test/v1", "stub-model").withImage)
    const hooks = yield* PluginHooks.Service
    const kimi = "You are OpenCode, an interactive general AI agent running on a user's computer."
    const userText = "My project is called OpenCode-tools."
    const untouched = yield* hooks.trigger("session", "context", contextEvent([kimi, userText]))
    expect(untouched.system.map((part) => part.text)).toEqual([kimi, userText])
    yield* activate(CodePuppyExt)
    const out = yield* hooks.trigger("session", "context", contextEvent([kimi, userText]))
    expect(out.system.map((part) => part.text)).toEqual([
      "You are Code Puppy, an interactive general AI agent running on a user's computer.",
      userText,
    ])
  }),
)

/** 测试用旁路插件:在真 provider / model 服务里登记一个 provider(端点 + 一个模型),供 ext 的 modelFacts 查。 */
const providerPlugin = (providerID: string, baseURL: string, ...modelIDs: string[]) =>
  Object.assign(providerPluginWith(providerID, baseURL, ["text"], modelIDs), { withImage: providerPluginWith(providerID, baseURL, ["text", "image"], modelIDs) })
const providerPluginWith = (providerID: string, baseURL: string, input: string[], modelIDs: string[]): Plugin.Plugin => ({
  id: `test.provider.${providerID}`,
  async setup(context) {
    await context.provider.transform((editor) =>
      editor.add({
        info: { id: providerID, name: providerID, activation: "auto", package: "@opencode/ai/providers/openai-compatible", settings: { baseURL } } as never,
        models: modelIDs.map(
          (modelID) =>
            ({
            id: modelID,
            modelID,
            providerID,
            name: modelID,
            capabilities: { tools: true, input, output: ["text"] },
            variants: [],
            time: { released: 0 },
            cost: [],
            status: "active",
            enabled: true,
            limit: { context: 128000, output: 32000 },
          }) as never,
        ),
      }),
    )
  },
})

it.live("P5:平台代理节点 ⇒ 不发 maxTokens(网关按 route 上限填);别的节点 ⇒ 原样;反向臂:不装 ext ⇒ maxTokens 留着", () =>
  Effect.gen(function* () {
    env({ CODEPUPPY_BASE_URL: "https://gateway.codepuppy.test/v1" })
    yield* activate(providerPlugin("codepuppy", "https://gateway.codepuppy.test/v1", "route-a"))
    yield* activate(providerPlugin("other", "https://api.other.test/v1", "model-b"))
    const hooks = yield* PluginHooks.Service
    const untouched = yield* hooks.trigger("session", "context", contextEvent([], { providerID: "codepuppy", id: "route-a" }))
    expect(untouched.options.maxTokens).toBe(32000)
    yield* activate(CodePuppyExt)
    const platform = yield* hooks.trigger("session", "context", contextEvent([], { providerID: "codepuppy", id: "route-a" }))
    expect("maxTokens" in platform.options).toBe(false)
    const other = yield* hooks.trigger("session", "context", contextEvent([], { providerID: "other", id: "model-b" }))
    expect(other.options.maxTokens).toBe(32000)
  }),
)

it.live("P5:直连 BYOK 节点按逐模型实读上限抬(同一 provider 的两个模型各拿各的数);无读数 / 端点不符 / 目录里查不到 ⇒ 原样;未登录(无 CODEPUPPY_BASE_URL)谁都不置空", () =>
  Effect.gen(function* () {
    env({})
    const ZHIPU = "https://open.bigmodel.cn/api/paas/v4"
    yield* activate(providerPlugin("zhipuai-byok", ZHIPU, "glm-5.2", "glm-4.5-air"))
    yield* activate(providerPlugin("my-own", "https://my.proxy.example/v1", "glm-5.2"))
    yield* activate(providerPlugin("codepuppy", "https://gateway.codepuppy.test/v1", "route-a"))
    yield* activate(CodePuppyExt)
    const hooks = yield* PluginHooks.Service
    const cap = (providerID: string, id: string) =>
      hooks.trigger("session", "context", contextEvent([], { providerID, id })).pipe(Effect.map((event) => event.options.maxTokens))
    expect(yield* cap("zhipuai-byok", "glm-5.2")).toBe(131072)
    expect(yield* cap("zhipuai-byok", "glm-4.5-air")).toBe(98304)
    expect(yield* cap("my-own", "glm-5.2")).toBe(32000)
    expect(yield* cap("zhipuai-byok", "not-in-catalog")).toBe(32000)
    expect(yield* cap("codepuppy", "route-a")).toBe(32000)
  }),
)

it.live("P6 / S5:平台凭据头只对平台节点、每次现读;别的节点不带;反向臂:不装 ext ⇒ 不带", () =>
  Effect.gen(function* () {
    const ref = join(scratch, "platform-token")
    writeFileSync(ref, "plat-1\n")
    env({ CODEPUPPY_BASE_URL: "https://gateway.codepuppy.test/v1", CODEPUPPY_PLATFORM_AUTH_REF: `{file:${ref}}` })
    const hooks = yield* PluginHooks.Service
    const request = (baseURL: string) => ({ ...ids, model: { providerID: "p", id: "m" } as never, kind: "primary" as const, baseURL, headers: {} as Record<string, string> })
    expect((yield* hooks.trigger("session", "model.request", request("https://gateway.codepuppy.test/v1"))).headers).toEqual({})
    yield* activate(CodePuppyExt)
    expect((yield* hooks.trigger("session", "model.request", request("https://gateway.codepuppy.test/v1"))).headers).toEqual({ authorization: "Bearer plat-1" })
    writeFileSync(ref, "plat-2\n")
    expect((yield* hooks.trigger("session", "model.request", request("https://gateway.codepuppy.test/v1"))).headers).toEqual({ authorization: "Bearer plat-2" })
    expect((yield* hooks.trigger("session", "model.request", request("https://api.other.test/v1"))).headers).toEqual({})
    // 凭据文件没了 ⇒ 钩子抛 LoadAPIKeyError(2.x 里这次模型请求在发出前失败),消息不带路径、不带令牌,不回落旧值。
    rmSync(ref)
    const failed = yield* hooks.trigger("session", "model.request", request("https://gateway.codepuppy.test/v1")).pipe(Effect.exit)
    expect(Exit.isFailure(failed)).toBe(true)
    const thrown = Exit.isFailure(failed) ? Cause.squash(failed.cause) : undefined
    expect(LoadAPIKeyError.isInstance(thrown)).toBe(true)
    expect(String((thrown as Error).message)).not.toContain(ref)
  }),
)

it.live("权威 · 定制中心安装(I10):codepuppy_hub_install 的权限评估恒 ask,自动化 agent 恒 deny,压过先注册的 allow;反向臂:不装 ext ⇒ allow 留着", () =>
  Effect.gen(function* () {
    env({})
    const hooks = yield* PluginHooks.Service
    const evaluation = (agent: string) => ({ sessionID: ids.sessionID, agent: agent as never, action: "codepuppy_hub_install", resources: ["mcp:github"], effect: "allow" as const })
    expect((yield* hooks.trigger("permission", "evaluate", evaluation("build"))).effect).toBe("allow")
    yield* activate(CodePuppyExt)
    expect((yield* hooks.trigger("permission", "evaluate", evaluation("build"))).effect).toBe("ask")
    expect((yield* hooks.trigger("permission", "evaluate", evaluation("codepuppy-automation-standard"))).effect).toBe("deny")
    // 别的动作不碰
    const other = yield* hooks.trigger("permission", "evaluate", { ...evaluation("build"), action: "read" })
    expect(other.effect).toBe("allow")
  }),
)

it.live("权威 · 出厂禁用技能(REQ-067):禁项的 skill 权限评估一律 deny,技能目录里拿掉;反向臂:不装 ext ⇒ allow、技能在", () =>
  Effect.gen(function* () {
    env({ CODEPUPPY_FACTORY_DENY_SKILLS: JSON.stringify(["customize-opencode"]) })
    const hooks = yield* PluginHooks.Service
    const skills = yield* Skill.Service
    yield* activate({
      id: "test.builtin-skill",
      async setup(context) {
        await context.skill.transform((editor) =>
          editor.add({ id: "customize-opencode", name: "customize-opencode", path: join(scratch, "SKILL.md"), content: "x" } as never),
        )
      },
    })
    const evaluation = { sessionID: ids.sessionID, action: "skill", resources: ["customize-opencode"], effect: "allow" as const }
    expect((yield* hooks.trigger("permission", "evaluate", evaluation)).effect).toBe("allow")
    expect((yield* skills.list()).map((skill) => skill.id)).toContain("customize-opencode" as never)
    yield* activate(CodePuppyExt)
    expect((yield* hooks.trigger("permission", "evaluate", evaluation)).effect).toBe("deny")
    expect((yield* skills.list()).map((skill) => skill.id)).not.toContain("customize-opencode" as never)
  }),
)

it.live("权威 · 提示词接管(L3r):ext 的 agent.transform 换掉上游 explore 的 system、新增 docs;出厂 /init /review 不由 ext 注册(归 L5 内联配置);反向臂:不装 ext ⇒ 上游原样", () =>
  Effect.gen(function* () {
    env({})
    yield* activate({
      id: "test.upstream-builtins",
      async setup(context) {
        await context.agent.transform((editor) => editor.update("explore", (agent) => void (agent.system = "upstream explore prompt")))
        await context.command.transform((editor) => editor.add({ name: "init", description: "upstream init", execute: async () => {} }))
      },
    })
    const agents = yield* Agent.Service
    const commands = yield* Command.Service
    expect((yield* agents.get(Agent.ID.make("explore")))?.system).toBe("upstream explore prompt")
    yield* activate(CodePuppyExt)
    expect((yield* agents.get(Agent.ID.make("explore")))?.system).toBe(CODEPUPPY_EXPLORE_PROMPT)
    expect((yield* agents.get(Agent.ID.make("docs")))?.mode).toBe("all")
    // 编排器裁决 2026-11-09:出厂 /init /review 由 L5 写进主进程的内联配置文档(上游 opencode.config.command 实现模板与子任务),
    // ext 不再 editor.add 它们 —— 这里看到的仍是宿主里原有的那一条,ext 也没有加 review。
    const listed = yield* commands.list()
    expect(listed.find((command) => command.name === "init")?.description).toBe("upstream init")
    expect(listed.some((command) => command.name === "review")).toBe(false)
  }),
)

it.live("权威 · 项目可执行扩展的同意(C10 / P10):没同意 ⇒ 项目 MCP 不进引擎、项目插件不装,只加载说明类的 agent 字段;同意之后才装", () =>
  Effect.gen(function* () {
    env({})
    const directory = realpathSync((yield* Location.Service).directory)
    const root = join(directory, ".codepuppy")
    mkdirSync(join(root, "plugins"), { recursive: true })
    writeFileSync(
      join(root, "codepuppy.jsonc"),
      JSON.stringify({ mcp: { proj: { type: "local", command: ["proj-mcp"] } }, agent: { helper: { prompt: "project helper prompt", mode: "primary" } } }),
    )
    writeFileSync(join(root, "plugins", "probe.js"), `export default { id: "project.probe", setup() { globalThis.__codepuppyProjectProbe = (globalThis.__codepuppyProjectProbe ?? 0) + 1 } }\n`)
    const probe = () => (globalThis as { __codepuppyProjectProbe?: number }).__codepuppyProjectProbe ?? 0
    const agents = yield* Agent.Service
    const untrusted = recordingMcp()
    yield* activate(CodePuppyExt, { mcp: untrusted })
    expect(untrusted.servers.has("proj")).toBe(false)
    expect(probe()).toBe(0)
    const helper = yield* agents.get(Agent.ID.make("helper"))
    expect(helper?.system).toBe("project helper prompt")
    expect(helper?.mode).toBe("all") // 控制字段(mode)在没同意时被剥掉
    writeFileSync(join(root, "prefs.json"), JSON.stringify({ extensionsConsent: { version: 1, granted: true } }))
    const trusted = recordingMcp()
    yield* activate(CodePuppyExt, { mcp: trusted })
    expect(trusted.servers.get("proj")).toEqual({ type: "local", command: ["proj-mcp"] })
    expect(probe()).toBe(1)
  }),
)
