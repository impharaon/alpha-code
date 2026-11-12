// #607:alpha 注入的**执行级**闸门。#603 R2 勘破的缺口:全仓没有任何测试 import 过 sidecar.ts
// (它的第一个 import 就是 bun 未实现的 `node:module` registerHooks,顶层还有 getParentPort()),
// 于是「注入到底有没有跑起来」零覆盖 —— 而 injectCodePuppyConfig 有一层**函数级 catch**,内部任何
// 抛错都被静默吞掉,可见症状只是「模型全灰 / 正在同步」(2026-07-24 事故的表现)。
//
// 本文件执行的是**生产 composition**:真 injectCodePuppyConfig + 真 12 个 sibling 模块 + 真临时盘,
// **零模块/依赖 mock**、不重写任何接线(rev2c ③″3-1 禁止镜像)。
// 唯一的替身是反向闸门里拦截 `console.warn` 这个**日志 sink** —— 它证明生产代码调用了 warn,
// 不证明真实 stderr 输出。不写「零替身」:那句话与下方的拦截冲突,而交付物不得声称未达成的状态
// (rev2c ③″3-6/12)。
//   · 正向闸门:content 必须携带 model / policies(provider.use)/ providers / 四个 alpha agent / {file:} ref。
//   · `#1667`(#1662 L5,清点表 C2 / C4 / C9,接口文档 I9):注入直接写 OpenCode 2 的配置键,不经环境变量交给引擎
//     (结果里带着 `config.content` / `config.file` / `models.file`,sidecar 放进 `start()` 的选项);判据用上游自己的
//     normalize 与 `Config.Info` / `Permission.Ruleset` 解码,零诊断、零改写;v2 读侧的那座 `OPENCODE_CONFIG_DIR` 桥已删除。
//   · 反向闸门(rev2c ③″3-7):用真实故障(userDataPath 的父级是普通文件 → 生产代码 mkdirSync 抛
//     ENOTDIR)触发那层 catch,并要求 ①失败必须出声 ②正向闸门的断言体在这条路径上**真的转红**。
//
// 边界,不谎报:catch 语义本票不改(#607 明令等价搬迁),**生产端仍然会吞掉抛错**。本文件改变的
// 是「吞掉之后无人知晓」——从此任何让注入抛错的回归都会撞红正向闸门。
//
// #613 追加:生产侧不再沉默 —— injectCodePuppyConfig 把结果作为返回值交出(sidecar.ts 随 ready IPC
// 上报 main,终态生产者发布 "injection-failed")。本文件锁链条的第一环:返回值,含 R1 Blocker 1
// 的 v2 桥反向闸门(v1 成功 + v2 桥失败曾被自吞 catch 报成 ok:true,而 picker 只经 v2 目录读模型)。
// 第二环(sidecar.ts 转发)在 R1 后一分为二:「失败值真的上车」由可真执行的 buildReadyMessage
// 运行时闸门守(sidecar-ready-message.test.ts —— 纯文本锚被 `injection.error && undefined`
// 变异实证绕过);留在本文件的源码锚只锁 bun 无法运行时验证的接线事实(唯一通路 + 捕获值整体入参)。

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Schema } from "effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Config as ConfigSchema } from "@opencode/schema/config"
import { Permission } from "@opencode/schema/permission"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { CODEPUPPY_V2_CATALOG_READY_PROVIDER_ID } from "../shared/codepuppy-config"
import { ECOSYSTEM_COMPATIBILITY_PLUGIN, ENGINE_EXPERIMENTAL_FLAGS, injectCodePuppyConfig } from "./codepuppy-config-injection"
import { customProviderSecretName, secretFilePath } from "./codepuppy-secret-files"
import { writeMcpServerTruth } from "./mcp-server-truth-write"
import { NEUTRALIZED_MCP_SERVER } from "./mcp-default-deny"
import {
  CLOUD_MCP_ARM_ENV,
  CLOUD_MCP_DEF_ENV,
  CLOUD_MCP_SERVER_ENV,
  CLOUD_WEB_SEARCH_TOOL_ID,
  cloudMcpToolId,
  WITHHELD_CLOUD_MCP,
} from "./cloud-web-search"
import { PLATFORM_API_KEY_PLACEHOLDER } from "./codepuppy-models"
import {
  CODEPUPPY_INIT_DESCRIPTION,
  CODEPUPPY_INIT_TEMPLATE,
  CODEPUPPY_REVIEW_DESCRIPTION,
  CODEPUPPY_REVIEW_TEMPLATE,
} from "../../../ext/src/codepuppy-prompts"
const CLOUD_DISPATCH_TOOL_ID = cloudMcpToolId("cloud_dispatch")

// 注入读到的每一个 env 输入 + 它自己写出的 env 输出:逐个快照/清空/还原,
// 既隔离宿主机真实配置,也不把注入结果泄漏给同进程的其它测试文件。
const MANAGED = [
  "CODEPUPPY_JSONC_TRUTH_DISABLE",
  "CODEPUPPY_LEGACY_INSTALL_ROOT",
  "CODEPUPPY_GLOBAL_DIR",
  "CODEPUPPY_OPENCODE_HOME",
  "CODEPUPPY_ECOSYSTEM_INHERIT",
  "XDG_CONFIG_HOME",
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_MODELS_PATH",
  "CODEPUPPY_IDENTITY_DISABLE",
  "CODEPUPPY_BEHAVIOR_DISABLE",
  "CODEPUPPY_MODELS_DISABLE",
  "CODEPUPPY_AUTOMATION_DISABLE",
  "CODEPUPPY_READONLY_DISABLE",
  "CODEPUPPY_WEBSEARCH_DISABLE",
  "CODEPUPPY_CLOUD_MCP_URL",
  "XDG_DATA_HOME",
  "CODEPUPPY_CLOUD_MCP_ARM",
  "CODEPUPPY_CLOUD_MCP_DEF",
  "CODEPUPPY_CLOUD_MCP_SERVER",
  "CODEPUPPY_BASE_URL",
  "CODEPUPPY_DEFAULT_MODEL",
  "CODEPUPPY_FACTORY_SKILL_DIRS",
  "CODEPUPPY_PROMPT_REBRAND_DISABLE",
] as const

const PLATFORM_KEY = "sk-platform-injection-gate"
const BYOK_KEY = "sk-deepseek-injection-gate"
const DEFAULT_MODEL = "deepseek/deepseek-chat"
const EXT_DIR = "/Applications/Code Puppy.app/Contents/Resources/codepuppy-ext"

const saved: Record<string, string | undefined> = {}
let tmp = ""
let userData = ""

/** 按 main 的 syncSecretFiles 姿势把密钥种进 {file:} 通道(A6:env 里从不出现密钥值)。 */
const plantSecret = (varName: string, value: string) => {
  const file = secretFilePath(userData, varName)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, value, { mode: 0o600 })
}

beforeEach(() => {
  for (const k of MANAGED) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-inject-")))
  process.env.CODEPUPPY_GLOBAL_DIR = path.join(tmp, "codepuppy-state", "env", "dev")
  fs.mkdirSync(process.env.CODEPUPPY_GLOBAL_DIR, { recursive: true })
  // 用户全局引擎配置面(injectMcpDefaultDeny 的枚举源)—— 指向空目录,宿主机 ~/.config/opencode 不得渗进断言。
  process.env.XDG_CONFIG_HOME = path.join(tmp, "xdg")
  process.env.CODEPUPPY_OPENCODE_HOME = path.join(tmp, "opencode-home")
  process.env.XDG_DATA_HOME = path.join(tmp, "xdg-data")
  for (const d of [process.env.XDG_CONFIG_HOME, process.env.CODEPUPPY_OPENCODE_HOME, process.env.XDG_DATA_HOME])
    fs.mkdirSync(d, { recursive: true })
  userData = path.join(tmp, "userdata")
  fs.mkdirSync(userData, { recursive: true })
})

afterEach(() => {
  for (const k of MANAGED) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

const givenLoggedInWithByok = () => {
  plantSecret("CODEPUPPY_API_KEY", PLATFORM_KEY)
  plantSecret("DEEPSEEK_API_KEY", BYOK_KEY)
  process.env.CODEPUPPY_BASE_URL = "https://gateway.example.invalid/v1"
  process.env.CODEPUPPY_DEFAULT_MODEL = DEFAULT_MODEL
}

type Rule = { action: string; resource: string; effect: string }
type Injected = {
  plugins?: string[]
  experimental?: Record<string, boolean>
  model?: unknown
  policies?: Rule[]
  providers?: Record<string, { settings?: { apiKey?: unknown; baseURL?: unknown }; package?: string; models?: Record<string, any> }>
  agents?: Record<string, { permissions?: Rule[]; system?: string; disabled?: boolean }>
  permissions?: Rule[]
  mcp?: { servers?: Record<string, unknown> }
  skills?: string[]
  commands?: Record<string, { template: string; description?: string; subagent?: boolean; subtask?: boolean }>
  command?: unknown
}

function inject(extPluginPath?: string) {
  const result = injectCodePuppyConfig(userData, extPluginPath, "stable")
  // `#1667`(编排器裁决 r1 第 2 条、C7 重裁):`config.file` 是 main 合成的显式文件;出厂命令、skills 与第一层 policies 在那里。
  const explicit = result.config.file && fs.existsSync(result.config.file) ? (JSON.parse(fs.readFileSync(result.config.file, "utf8")) as Injected & { $schema?: string; command?: unknown }) : undefined
  return { result, config: JSON.parse(result.config.content) as Injected, explicit }
}

const allows = (rules: Rule[] | undefined, action: string, resource = "*") =>
  rules?.filter((rule) => rule.action === action && rule.resource === resource).at(-1)?.effect

/**
 * 正向闸门的断言体。**反向用例会把同一个函数对着「注入抛错之后」的产物再跑一遍并要求它抛** ——
 * 所以这里每一条 expect 既是正向锁也是反向锁,不得改成宽松断言(改宽 = 两个闸门同时失效)。
 */
function assertInjectedFacts(content: string, userDataPath: string): void {
  const config = JSON.parse(content) as Injected
  expect(config.model).toBe(DEFAULT_MODEL)
  // provider.use:先拒全部、再逐个放行 —— 2.x 的 provider 白名单(v1 的 enabled_providers)。
  expect(config.policies?.[0]).toEqual({ action: "provider.use", resource: "*", effect: "deny" })
  for (const id of ["codepuppy", "deepseek-byok", CODEPUPPY_V2_CATALOG_READY_PROVIDER_ID])
    expect(config.policies).toContainEqual({ action: "provider.use", resource: id, effect: "allow" })
  // 白名单里的每个 id 必须真有节点定义,否则白名单是空头支票。
  expect(Object.keys(config.providers ?? {})).toEqual(expect.arrayContaining(["codepuppy", "deepseek-byok"]))
  expect(Object.keys(config.agents ?? {})).toEqual(
    expect.arrayContaining(["codepuppy-automation", "codepuppy-readonly", "codepuppy-automation-standard", "codepuppy-ask"]),
  )
  for (const agent of ["codepuppy-ask", "codepuppy-automation", "codepuppy-automation-standard"])
    expect(allows(config.agents?.[agent]?.permissions, "tool-policy-default")).toBe("ask")
  // A6:BYOK 密钥以 {file:} ref 进 content,明文永不进;平台 provider 只带非凭据占位值(REQ-236 `#1562`)。
  expect(config.providers!.codepuppy.settings!.apiKey).toBe(PLATFORM_API_KEY_PLACEHOLDER)
  expect(config.providers!["deepseek-byok"].settings!.apiKey).toBe(`{file:${secretFilePath(userDataPath, "DEEPSEEK_API_KEY")}}`)
  expect(content).not.toContain(PLATFORM_KEY)
  expect(content).not.toContain(BYOK_KEY)
}

/**
 * C2 判据:上游 normalize 对这份产物零诊断、除 `model` 的短写被规范成 `{ providerID, model }` 之外零改写(短写是 2.x 自己的
 * 合法写法,`ConfigModel.Selection`),并且过 `Config.Info` 解码。写回 v1 的任何一个旧键(`provider` / `agent` / `permission` /
 * `plugin` / `enabled_providers` / lone `enabled:false` 的 MCP 叶子…)都会在这里变成诊断或改写。
 */
function assertNativeV2(content: string) {
  const input = JSON.parse(content)
  const normalized = ConfigNormalize.normalize(input)
  expect(normalized.type).toBe("normalized")
  expect(normalized.diagnostics).toEqual([])
  const decoded = Schema.decodeUnknownSync(ConfigSchema.Info)(input)
  if (normalized.type === "normalized")
    expect(normalized.encoded).toEqual(input.model === undefined ? input : { ...input, model: { ...decoded.model } })
}

describe("injectCodePuppyConfig —— 注入组合体的执行级闸门(#607)", () => {
  test("正向闸门:生产 composition 跑通,结果携带 model/policies/providers/四个 alpha agent/{file:} ref", () => {
    givenLoggedInWithByok()

    const { result } = inject(EXT_DIR)

    expect(result.ok).toBe(true)
    assertInjectedFacts(result.config.content, userData)
    // `config.file` 是 main 合成的显式文件(Code Puppy 自己的 userData 下),当前环境的 codepuppy.jsonc 在里面;治理过的模型目录快照经 `models.file`。
    expect(result.config.file).toBe(path.join(userData, "codepuppy-engine-config", "codepuppy-explicit.json"))
    expect(result.explicit?.userConfig).toBe(path.join(process.env.CODEPUPPY_GLOBAL_DIR!, "codepuppy.jsonc"))
    expect(result.models.file).toBe(path.join(userData, "codepuppy-engine-config", "models.json"))
    // #857:早到的 models.dev 底表从**同一份**投影机械派生:每个 provider 的模型集合与注入的 providers 相同,带就绪标记,不带 key。
    const raw = fs.readFileSync(result.models.file!, "utf8")
    const base = JSON.parse(raw) as Record<string, { models: Record<string, unknown> }>
    expect(Object.keys(base).sort()).toEqual(["codepuppy", "deepseek-byok", CODEPUPPY_V2_CATALOG_READY_PROVIDER_ID].sort())
    for (const id of ["codepuppy", "deepseek-byok"])
      expect(Object.keys(base[id]!.models).sort()).toEqual(Object.keys(JSON.parse(result.config.content).providers[id].models).sort())
    expect(raw).not.toContain(PLATFORM_KEY)
    expect(raw).not.toContain(BYOK_KEY)
    expect(raw).not.toContain("apiKey")
  })

  test("C4:不再经环境变量交给引擎,也不再写 v2 读侧的桥目录", () => {
    givenLoggedInWithByok()
    inject(EXT_DIR)
    for (const name of ["OPENCODE_CONFIG", "OPENCODE_CONFIG_CONTENT", "OPENCODE_CONFIG_DIR", "OPENCODE_MODELS_PATH"])
      expect([name, process.env[name]]).toEqual([name, undefined])
    expect(fs.existsSync(path.join(userData, "codepuppy-engine-config", "opencode.jsonc"))).toBe(false)
    expect(fs.existsSync(path.join(userData, "codepuppy-engine-config", "opencode.json"))).toBe(false)
  })

  test("继承来的 OPENCODE_CONFIG_CONTENT 不是起点(每次 fork 从零起;引擎本来也不读这个变量)", () => {
    givenLoggedInWithByok()
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ mcp: { codepuppy: { type: "remote", url: "https://inherited.example/mcp" } } })
    const { result } = inject(EXT_DIR)
    expect(result.config.content).not.toContain("inherited.example")
  })

  test("C2:内联文档与显式文件都直接是 OpenCode 2 的配置键 —— 上游 normalize 零诊断、零改写,过 Config.Info 解码(登录 + BYOK 态,带出厂技能与命令)", () => {
    givenLoggedInWithByok()
    process.env.CODEPUPPY_FACTORY_SKILL_DIRS = JSON.stringify([path.join(tmp, "factory")])
    const { result, config, explicit } = inject(EXT_DIR)
    // 出厂命令与 skills 只在显式文件里(编排器裁决 r1 第 2 条),内联文档不再带
    expect(config.skills).toBeUndefined()
    expect(config.commands).toBeUndefined()
    expect(explicit?.skills).toEqual([path.join(tmp, "factory")])
    expect(Object.keys(explicit?.commands ?? {})).toEqual(["init", "review"])
    assertNativeV2(result.config.content)
    assertNativeV2(fs.readFileSync(result.config.file!, "utf8"))
  })

  test("C7(重裁):provider 白名单的 policies 写进显式文件(第一层),与内联文档里那份(第二层)逐条相同、出自同一次计算", () => {
    givenLoggedInWithByok()
    const { config, explicit } = inject(EXT_DIR)
    expect(explicit?.policies).toEqual(config.policies)
    expect(explicit?.policies?.[0]).toEqual({ action: "provider.use", resource: "*", effect: "deny" })
    process.env.CODEPUPPY_MODELS_DISABLE = "1"
    expect(inject(EXT_DIR).explicit?.policies).toBeUndefined()
  })

  test("显式文件里用户的 codepuppy.jsonc 原样在下:用户自己的 /init 不被出厂的覆盖;用户文件坏了 ⇒ 只放 Code Puppy 这一层", () => {
    const truth = path.join(process.env.CODEPUPPY_GLOBAL_DIR!, "codepuppy.jsonc")
    fs.writeFileSync(truth, `{ "command": { "init": { "template": "my own init" } }, "mcp": { "tool": { "type": "local", "command": ["t"] } } }`)
    const { explicit } = inject(EXT_DIR)
    expect(explicit?.command).toEqual({ init: { template: "my own init" } })
    expect(Object.keys(explicit?.commands ?? {})).toEqual(["review"])
    expect(explicit?.mcp).toEqual({ tool: { type: "local", command: ["t"] } } as never)
    fs.writeFileSync(truth, "{ broken")
    expect(Object.keys(inject(EXT_DIR).explicit?.commands ?? {})).toEqual(["init", "review"])
  })

  test("I9:每一份注入的 permissions(顶层与各 agent)都能用 Permission.Ruleset 解码;动作名用 2.x 的,不出现 bash / task / apply_patch", () => {
    givenLoggedInWithByok()
    process.env.CODEPUPPY_WEBSEARCH_DISABLE = "1"
    const { config } = inject(EXT_DIR)
    const rulesets = [config.permissions ?? [], ...Object.values(config.agents ?? {}).map((agent) => agent.permissions ?? [])]
    expect(rulesets.length).toBeGreaterThan(4)
    for (const ruleset of rulesets) expect(() => Schema.decodeUnknownSync(Permission.Ruleset)(ruleset)).not.toThrow()
    const actions = rulesets.flat().map((rule) => rule.action)
    for (const legacy of ["bash", "task", "apply_patch"]) expect(actions).not.toContain(legacy)
    expect(actions).toEqual(expect.arrayContaining(["shell", "subagent", "tool-policy-default"]))
    // 档位载体的伪动作原样保留(接口文档 I9):L4 的执行闸读 `{ action: "tool-policy-default", resource: "*" }`。
    expect(config.agents?.["codepuppy-ask"]?.permissions).toContainEqual({ action: "tool-policy-default", resource: "*", effect: "ask" })
  })

  test("S6 / C9:plugins 写 ext 目录与移除指令 -opencode.config.compatibility;CODEPUPPY_ECOSYSTEM_INHERIT=1 时不写移除指令", () => {
    expect(inject(EXT_DIR).config.plugins).toEqual([EXT_DIR, `-${ECOSYSTEM_COMPATIBILITY_PLUGIN}`])
    process.env.CODEPUPPY_ECOSYSTEM_INHERIT = "1"
    expect(inject(EXT_DIR).config.plugins).toEqual([EXT_DIR])
  })

  test("OOR-1 / U1:五个实验开关显式写值 —— todo 开,其余四个关", () => {
    expect(inject(EXT_DIR).config.experimental).toEqual({
      todo: true,
      schedules: false,
      media_blob: false,
      artifacts: false,
      background_compaction: false,
    })
    expect(ENGINE_EXPERIMENTAL_FLAGS.todo).toBe(true)
  })

  /** 按 main 的 ext-transaction 姿势种一个已启用的技能生成目录(current.json 指向这一代,skills-enabled.json 里有这个键)。 */
  const plantGeneration = (key: string, generation: string, enabled: string[]) => {
    const root = process.env.CODEPUPPY_GLOBAL_DIR!
    const dir = path.join(root, "ext-store", key, "generations", generation)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(root, "ext-store", key, "current.json"), JSON.stringify({ generation }))
    fs.writeFileSync(path.join(root, "skills-enabled.json"), JSON.stringify({ v: 1, keys: enabled }))
    return dir
  }

  test("接缝裁决 A / 裁决 r3 第 1 条:显式文件的 skills = 出厂技能目录 + 已启用技能当前那一代的真实目录;没启用的不写,没有输入时不写", () => {
    expect(inject(EXT_DIR).explicit?.skills).toBeUndefined()
    const factory = [path.join(tmp, "factory", "a"), path.join(tmp, "factory", "b")]
    process.env.CODEPUPPY_FACTORY_SKILL_DIRS = JSON.stringify(factory)
    const live = plantGeneration("skill--enabled-one", "gen-000001-abcdef", ["skill--enabled-one"])
    plantGeneration("skill--not-enabled", "gen-000002-abcdef", ["skill--enabled-one"])
    expect(inject(EXT_DIR).explicit?.skills).toEqual([...factory, live])
    // 不再有任何软链(owner 2026-07-07「不用 symlink」)
    expect(fs.existsSync(path.join(process.env.CODEPUPPY_GLOBAL_DIR!, "skills-live"))).toBe(false)
    // 账本缺失 ⇒ 生成目录一个都不写(ext 的 fail-closed 门原样生效),出厂目录照旧
    fs.rmSync(path.join(process.env.CODEPUPPY_GLOBAL_DIR!, "skills-enabled.json"))
    expect(inject(EXT_DIR).explicit?.skills).toEqual(factory)
  })

  test("接缝裁决 C / 裁决 r1 第 2 条:显式文件的 commands 写出厂 /init、/review —— 文字逐字来自 ext 登记的模板,review 用 2.x 原生键 subagent: true;CODEPUPPY_PROMPT_REBRAND_DISABLE=1 ⇒ 不写", () => {
    expect(inject(EXT_DIR).explicit?.commands).toEqual({
      init: { template: CODEPUPPY_INIT_TEMPLATE, description: CODEPUPPY_INIT_DESCRIPTION },
      review: { template: CODEPUPPY_REVIEW_TEMPLATE, description: CODEPUPPY_REVIEW_DESCRIPTION, subagent: true },
    })
    process.env.CODEPUPPY_PROMPT_REBRAND_DISABLE = "1"
    expect(inject(EXT_DIR).explicit?.commands).toBeUndefined()
  })

  test("CODEPUPPY_MODELS_DISABLE:不写 providers / policies,也不给 models.file", () => {
    process.env.CODEPUPPY_MODELS_DISABLE = "1"
    const { result, config } = inject(EXT_DIR)
    expect(result.ok).toBe(true)
    expect(config.providers).toBeUndefined()
    expect(config.policies).toBeUndefined()
    expect(result.models.file).toBeUndefined()
    expect(fs.existsSync(path.join(userData, "codepuppy-engine-config", "models.json"))).toBe(false)
  })

  test("#1392 codepuppy.jsonc 里的 provider 块不进注入面;真源一条记录以 2.x 形状进 providers 与 provider.use", () => {
    givenLoggedInWithByok()
    fs.writeFileSync(
      path.join(process.env.CODEPUPPY_GLOBAL_DIR!, "codepuppy.jsonc"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        provider: {
          "user-file-provider": {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: "https://exfil.example/v1", apiKey: "not-a-real-key-Zq81" },
            models: { "user-model": { name: "User Model" } },
          },
        },
      }),
    )
    const truthPath = path.join(tmp, "codepuppy-state", "custom-providers", "dev.json")
    fs.mkdirSync(path.dirname(truthPath), { recursive: true })
    fs.writeFileSync(
      truthPath,
      JSON.stringify({ v: 1, providers: [{ id: "my-openai", name: "My OpenAI", compat: "openai", baseURL: "https://api.openai.com/v1", models: ["gpt-5.4"] }] }),
    )
    // `#1667`(裁决 r3 第 2 条):自定义节点只在有可用 key 时注入。
    plantSecret(customProviderSecretName("my-openai"), "sk-custom-injection-gate")

    const { result, config } = inject(EXT_DIR)
    expect(result.ok).toBe(true)
    expect(config.providers?.["user-file-provider"]).toBeUndefined()
    expect(config.policies).not.toContainEqual({ action: "provider.use", resource: "user-file-provider", effect: "allow" })
    expect(config.policies).toContainEqual({ action: "provider.use", resource: "my-openai", effect: "allow" })
    expect(config.providers?.["my-openai"]).toEqual({
      name: "My OpenAI",
      package: "aisdk:@ai-sdk/openai-compatible",
      settings: { baseURL: "https://api.openai.com/v1", apiKey: `{file:${secretFilePath(userData, customProviderSecretName("my-openai"))}}` },
      models: { "gpt-5.4": { name: "gpt-5.4", capabilities: { input: ["text"] } } },
    })
    expect(result.config.content).not.toContain("exfil.example")
    const base = JSON.parse(fs.readFileSync(result.models.file!, "utf8")) as Record<string, { models: Record<string, { provider?: unknown }> }>
    expect(base["user-file-provider"]).toBeUndefined()
    expect(base["my-openai"]!.models["gpt-5.4"]!.provider).toEqual({ npm: "@ai-sdk/openai-compatible", api: "https://api.openai.com/v1" })
  })

  test("`#1667` 裁决 r3 第 2 条:BYOK / 自定义节点的 key 缺失或为空 ⇒ 整个不注入(不在 providers、不在 provider.use 放行里);平台节点(占位 apiKey,凭据走 ext 请求头)照常注入", () => {
    givenLoggedInWithByok()
    const truthPath = path.join(tmp, "codepuppy-state", "custom-providers", "dev.json")
    fs.mkdirSync(path.dirname(truthPath), { recursive: true })
    fs.writeFileSync(truthPath, JSON.stringify({ v: 1, providers: [{ id: "keyless", name: "Keyless", compat: "openai", baseURL: "https://keyless.example/v1", models: ["m"] }] }))
    const absent = (config: Injected, id: string) => {
      expect(config.providers?.[id]).toBeUndefined()
      expect(config.policies).not.toContainEqual({ action: "provider.use", resource: id, effect: "allow" })
    }
    absent(inject(EXT_DIR).config, "keyless")
    plantSecret(customProviderSecretName("keyless"), "  \n")
    absent(inject(EXT_DIR).config, "keyless")
    plantSecret("DEEPSEEK_API_KEY", "")
    absent(inject(EXT_DIR).config, "deepseek-byok")
    const { config } = inject(EXT_DIR)
    expect(config.providers?.codepuppy?.settings?.apiKey).toBe(PLATFORM_API_KEY_PLACEHOLDER)
    expect(config.policies).toContainEqual({ action: "provider.use", resource: "codepuppy", effect: "allow" })
  })

  test("反向闸门:注入内部抛错时失败必须出声、以 ok:false 离开,产物只剩治理底线,且正向闸门的断言体真的转红", () => {
    givenLoggedInWithByok()
    // 真实故障、零模块/依赖 mock(仅拦截日志 sink):userDataPath 的父级是一个普通文件 → 生产代码里的
    // `fs.mkdirSync(userDataPath, { recursive: true })` 抛 ENOTDIR,正落进那层函数级 catch。
    const parentIsAFile = path.join(tmp, "not-a-directory")
    fs.writeFileSync(parentIsAFile, "")
    const brokenUserData = path.join(parentIsAFile, "userdata")

    const warned: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warned.push(args.map((a) => String(a)).join(" "))
    }
    let result: ReturnType<typeof injectCodePuppyConfig>
    try {
      result = injectCodePuppyConfig(brokenUserData, EXT_DIR, "stable")
    } finally {
      console.warn = originalWarn
    }

    expect(warned.some((w) => w.includes("failed to inject alpha config"))).toBe(true)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message.length).toBeGreaterThan(0)
    // 治理底线不随注入失败丢掉:ext 目录、外部技能移除指令、实验开关照样在(没有 ext ⇒ sidecar 的 I4 拒绝 ready)。
    const floor = JSON.parse(result.config.content) as Injected
    expect(floor.plugins).toEqual([EXT_DIR, `-${ECOSYSTEM_COMPATIBILITY_PLUGIN}`])
    expect(floor.experimental).toEqual({ ...ENGINE_EXPERIMENTAL_FLAGS })
    assertNativeV2(result.config.content)
    // 把正向闸门的断言体对着这条被吞掉的路径再跑一遍,它**必须**转红。
    expect(() => assertInjectedFacts(result.config.content, brokenUserData)).toThrow()
  })

  test("#613 反向闸门:models.json 写不进去 ⇒ ok:false(不是可忽略的局部降级),错误自证抛点", () => {
    givenLoggedInWithByok()
    fs.writeFileSync(path.join(userData, "codepuppy-engine-config"), "")
    const originalWarn = console.warn
    console.warn = () => {}
    let result: ReturnType<typeof injectCodePuppyConfig>
    try {
      result = injectCodePuppyConfig(userData, EXT_DIR, "stable")
    } finally {
      console.warn = originalWarn
    }
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("codepuppy-engine-config")
  })

  // #613 接线锚(R1 后收窄):sidecar.ts 无法被 bun import(首个 import 即 registerHooks,
  // 顶层 getParentPort 必抛)。R1 实证纯文本锚锁不住值上车 —— 「失败字段真的在 ready 消息上」
  // 已迁入真执行的 buildReadyMessage(sidecar-ready-message.test.ts)。留给源码锚的只剩
  // bun 无法运行时验证的接线事实,按 rev2c ③″3-2 锁位置/顺序与唯一通路:
  // 分类与「这处锚守不住什么」登记在 ./source-text-anchors.ts(`#968` 第 ⑤ 层机械校验)。
  test("ANCHOR (not a gate): #613 sidecar.ts 的 ready 上报必须走 buildReadyMessage(injection),别无通路", () => {
    const source = fs.readFileSync(path.join(import.meta.dir, "sidecar.ts"), "utf8")

    // ① start() 捕获注入结果,ready 发送在捕获之后、以捕获值**整体**入参 —— 精确到字符:
    //    `buildReadyMessage(injection && …)` / `(injection ?? …)` 等义改写都无法命中该子串。
    //    #881:第二个入参是 prewarm 的结局(同样整体入参,同样精确到字符)。
    const capture = source.indexOf("const injection = prepareSidecarEnv(")
    const ready = source.indexOf("parentPort.postMessage(buildReadyMessage(injection, prewarmResult))")
    expect(capture).toBeGreaterThan(-1)
    expect(ready).toBeGreaterThan(capture)
    // ② 被调用的必须是 sidecar-ready-message 导出的那一个(换源 import = 红),
    //    且本文件不得 shadow 重定义同名函数(重定义 = 红)。
    expect(source).toMatch(/import \{ buildReadyMessage[^}]*\} from "\.\/sidecar-ready-message"/)
    expect(source).not.toMatch(/(?:function|const|let|var)\s+buildReadyMessage/)
    // ③ 唯一通路:本文件不得再出现字面量构造的 ready 消息 —— R1 的绕过手法
    //    (另发 {type:"ready"} 裸消息、把旧表达式留在注释里)从此撞红。
    expect(source).not.toMatch(/postMessage\(\s*\{\s*type:\s*"ready"/)
    // ④ 中间环节不得吞:prepareSidecarEnv 以 injectCodePuppyConfig 的结果作为函数**最后一条语句**
    //    整体返回(锁到行尾 + 函数闭括号:`return injectCodePuppyConfig(...), {ok:true}` 逗号改写、
    //    换行续写表达式,都无处容身)。
    expect(source).toMatch(/return injectCodePuppyConfig\(userDataPath, extPluginPath, registryChannel\)\n\}/)
  })
})

describe("web search 主权在 2.x 权限规则里仍成立(#223)", () => {
  const givenPlatformPays = () => {
    givenLoggedInWithByok()
    plantSecret("CODEPUPPY_CLOUD_TOKEN", "cloud-token")
    plantSecret("CODEPUPPY_MCP_TOKEN", "mcp-token-value")
    process.env.CODEPUPPY_CLOUD_MCP_URL = "https://cloud.example/mcp"
  }

  test("平台代付:两条腿都留着 —— 注入面不写任何 web search 的 deny,云 server 照常在册", () => {
    givenPlatformPays()
    const { config } = inject(EXT_DIR)
    expect(allows(config.permissions, "websearch")).toBeUndefined()
    expect(allows(config.permissions, CLOUD_WEB_SEARCH_TOOL_ID)).toBeUndefined()
    expect(config.mcp?.servers?.codepuppy).toMatchObject({ type: "remote", url: "https://cloud.example/mcp" })
    expect(config.mcp?.servers?.codepuppy).not.toHaveProperty("disabled")
    for (const [name, agent] of Object.entries(config.agents ?? {}))
      expect([name, allows(agent.permissions, "websearch")]).toEqual([name, "allow"])
    assertNativeV2(JSON.stringify(config))
  })

  for (const [name, ext] of [
    ["ext 目录已解析", true],
    ["ext 目录缺席", false],
  ] as const)
    test(`kill-switch(${name}):配置里只有中和条目,本地与云两个 web search 都被 deny 并钉在规则表末位`, () => {
      givenPlatformPays()
      process.env.CODEPUPPY_WEBSEARCH_DISABLE = "1"
      const original = console.error
      const errors: unknown[][] = []
      console.error = (...args: unknown[]) => void errors.push(args)
      let config: Injected
      try {
        config = inject(ext ? EXT_DIR : undefined).config
      } finally {
        console.error = original
      }
      expect(config.permissions?.slice(-2)).toEqual([
        { action: CLOUD_WEB_SEARCH_TOOL_ID, resource: "*", effect: "deny" },
        { action: "websearch", resource: "*", effect: "deny" },
      ])
      expect(allows(config.permissions, CLOUD_DISPATCH_TOOL_ID)).toBeUndefined()
      for (const agent of Object.values(config.agents ?? {})) expect(agent.permissions?.at(-1)).toEqual({ action: "websearch", resource: "*", effect: "deny" })
      expect(config.mcp?.servers?.codepuppy).toEqual({ ...WITHHELD_CLOUD_MCP })
      const content = JSON.stringify(config)
      expect(content).not.toContain("cloud.example")
      expect(content).not.toContain("Authorization")
      expect(process.env[CLOUD_MCP_ARM_ENV]).toBe("codepuppy")
      // DEF 托管的是 2.x `Mcp.RemoteConfig` 形状的真定义(带 {file:} 引用,不带 token 值)。
      expect(JSON.parse(process.env[CLOUD_MCP_DEF_ENV]!)).toEqual({
        type: "remote",
        url: "https://cloud.example/mcp",
        headers: { Authorization: `Bearer {file:${secretFilePath(userData, "CODEPUPPY_MCP_TOKEN")}}` },
        oauth: false,
      })
      expect(process.env[CLOUD_MCP_DEF_ENV]).not.toContain("mcp-token-value")
      expect(process.env[CLOUD_MCP_SERVER_ENV]).toBe("codepuppy")
      expect(errors.flat().join("\n")).toContain("WITHHELD from the engine config")
      assertNativeV2(content)
    })

  test("不代付(登出 / BYOK)且有云 URL:云 server 是无凭证的 disabled 定义,不带任何凭证通道", () => {
    givenLoggedInWithByok()
    process.env.CODEPUPPY_CLOUD_MCP_URL = "https://cloud.example/mcp"
    const { config } = inject(EXT_DIR)
    expect(config.mcp?.servers?.codepuppy).toEqual({ type: "remote", url: "https://cloud.example/mcp", disabled: true, oauth: false })
  })

  test("继承/伪造的 arm+def 变量在每条分支上都被注入面覆盖或清掉", () => {
    givenPlatformPays()
    process.env[CLOUD_MCP_ARM_ENV] = "forged"
    process.env[CLOUD_MCP_DEF_ENV] = JSON.stringify({ type: "remote", url: "https://attacker.example/mcp" })
    process.env[CLOUD_MCP_SERVER_ENV] = "forged"
    inject(EXT_DIR)
    expect(process.env[CLOUD_MCP_ARM_ENV]).toBeUndefined()
    expect(process.env[CLOUD_MCP_DEF_ENV]).not.toContain("attacker.example")
    expect(process.env[CLOUD_MCP_SERVER_ENV]).toBe("codepuppy")
    delete process.env.CODEPUPPY_CLOUD_MCP_URL
    inject(EXT_DIR)
    expect(process.env[CLOUD_MCP_ARM_ENV]).toBeUndefined()
    expect(process.env[CLOUD_MCP_DEF_ENV]).toBeUndefined()
    expect(process.env[CLOUD_MCP_SERVER_ENV]).toBeUndefined()
  })
})

describe("`#1381` 远程 MCP 从真源注入;codepuppy.jsonc 与用户全局里不受治理的条目压成中和条目", () => {
  const truthFile = () => path.join(tmp, "codepuppy-state", "mcp-servers", "dev.json")

  test("真源一条 ⇒ 注入完整的 2.x 条目;codepuppy.jsonc 的远程条目、用户全局的非治理条目 ⇒ 中和条目;本地条目不动", () => {
    writeMcpServerTruth(truthFile(), [{ name: "my-mcp", url: "https://mcp.example.com/mcp", headers: { "X-Token": "t" } }], fs)
    fs.writeFileSync(
      path.join(process.env.CODEPUPPY_GLOBAL_DIR!, "codepuppy.jsonc"),
      JSON.stringify({ mcp: { "exfil-mcp": { type: "remote", url: "https://exfil-mcp.example/mcp" }, "local-ok": { type: "local", command: ["x"] } } }),
    )
    const xdg = path.join(process.env.XDG_CONFIG_HOME!, "opencode")
    fs.mkdirSync(xdg, { recursive: true })
    fs.writeFileSync(path.join(xdg, "config.json"), JSON.stringify({ mcp: { "my-mcp": { type: "remote", url: "https://user-global.example/mcp" }, stray: { type: "remote", url: "https://stray.example/mcp" } } }))
    const original = console.error
    console.error = () => {}
    let config: Injected
    try {
      config = inject(EXT_DIR).config
    } finally {
      console.error = original
    }
    expect(config.mcp?.servers?.["my-mcp"]).toEqual({ type: "remote", url: "https://mcp.example.com/mcp", headers: { "X-Token": "t" } })
    expect(config.mcp?.servers?.["exfil-mcp"]).toEqual({ ...NEUTRALIZED_MCP_SERVER })
    expect(config.mcp?.servers?.stray).toEqual({ ...NEUTRALIZED_MCP_SERVER })
    expect(config.mcp?.servers?.["local-ok"]).toBeUndefined()
    assertNativeV2(JSON.stringify(config))
  })
})
