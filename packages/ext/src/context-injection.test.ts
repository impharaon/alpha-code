// REQ-157 `#1284` —— Alpha 注入模型上下文的咽喉(AC1)、上限响亮失败(AC2)、库存快照(AC3)。`#1665` 起对 OpenCode 2。
//
// 咽喉的完备性不靠「我列了几个注入点」这种散文,靠一条派生链,每一环都是可执行断言:
//   ① 2.x 插件 Context 上的钩子(`packages/plugin/src/promise/` 的各 `*Hooks` 接口)与 transform domain = 插件能碰引擎的
//      **全部**方式(单一权威)。从源码解析键集,与登记簿的 HOOK_CONTEXT_CLASS 键集比对 —— 上游加一个,我们漏分类,即红。
//   ② 真 CodePuppyExt 注册了的通路里,分类为「载上下文」的那几个,集合必须逐字等于本文件设了咽喉的那几个 ——
//      alpha 明天多注册一个 session.prompt 而没写咽喉,即红。
//   ③ 每个咽喉:在**真插件宿主**里跑真钩子 / 真 transform,把它送出去的每一个字符串与登记簿比对;并在同一测试里用一个
//      **已知的坏**(多塞一段)证明判官看得见 —— 「先证明手段能测出已知的坏」。
//
// ui-mac 经 instructions 写的两份 .md(`#1296`)与经 agent 写的几个 agent 的字(`#1299`)也在同一份登记簿里;
// ui-mac 侧的咽喉(跑真注入、罩整份 config)在 packages/ui-mac/src/main/config-injection-throat.test.ts(`#1305`),
// 本文件只钉登记形状、判官与跨包前提(③e / ③f)。
// 已知不覆盖:项目自己的 plugins / codepuppy.jsonc(用户的字);skills 正文与 MCP 工具表(别人的字)。

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Effect } from "effect"
import { PluginHooks } from "../../core/src/plugin/hooks.ts"
import { Tool } from "../../core/src/tool.ts"
import { Message } from "../../ai/src/schema/messages.ts"
import * as Media from "../../ai/src/media.ts"
import {
  applyRegisteredRebrands,
  BEHAVIOR_FRAGMENT_ID,
  CONTEXT_INJECTIONS,
  ContextBudgetError,
  contextBytes,
  contextText,
  defineRebrand,
  defineTemplate,
  defineText,
  explainAgentText,
  explainConfigReference,
  explainConfigString,
  explainInstructionBody,
  explainAttachmentBlock,
  explainVisionBlock,
  HOOK_CONTEXT_CLASS,
  IDENTITY_FRAGMENT_ID,
  identityCapsFromId,
  inventory,
  renderInventory,
  renderTemplate,
  TOOL_TEXT,
  UI_MAC_AGENT_NAMES,
  uiMacAgentFragmentId,
  uiMacAgentFragmentIds,
  VISION_SYSTEM_NOTE_OFFLINE_TEXT,
  VISION_SYSTEM_NOTE_TEMPLATE,
  VISION_TOOL_REFUSED_TEXT,
} from "./context-injection"
import { REBRAND_RULES } from "./prompt-rebrand"
import { applyPromptTakeover } from "./codepuppy-prompts"
import { CODEPUPPY_AGENT_TEXT } from "../../ui-mac/src/main/codepuppy-agents"
import { CODEPUPPY_BEHAVIOR_MD } from "../../ui-mac/src/main/codepuppy-behavior"
import { buildCodePuppyIdentity } from "../../ui-mac/src/main/codepuppy-identity"
import { CLOUD_MCP_ARM_ENV, CLOUD_MCP_DEF_ENV, CLOUD_MCP_SERVER_ENV } from "./cloud-websearch-kill"
import CodePuppyExt from "./plugin"
import { toLLMMessages } from "../../core/src/session/runner/to-llm-message.ts"
import { STAGED_ATTACHMENT_PART_NAME, stagedAttachmentPart } from "./staged-attachment-part"
import { activate, it, recordingContext, recordingMcp } from "./plugin-host.harness"

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..")
const PROMISE_DIR = join(REPO_ROOT, "packages", "plugin", "src", "promise")
const CORE_SRC = join(REPO_ROOT, "packages", "core", "src")
const SNAPSHOT = join(import.meta.dir, "context-injection-inventory.snapshot.txt")

// ── ① 单一权威:2.x 插件 Context 的钩子与 transform ────────────────────────────────

/** 一个接口顶层成员的键(两格缩进;`readonly "a.b": …` 或 `name: …`)。 */
function interfaceKeys(src: string, name: string): string[] {
  const start = src.indexOf(`interface ${name} {`)
  if (start < 0) throw new Error(`接口 ${name} 没找到`)
  const endMatch = /\n\}(\n|$)/.exec(src.slice(start))
  if (!endMatch) throw new Error(`接口 ${name} 没有闭合`)
  const keys: string[] = []
  for (const line of src.slice(start, start + endMatch.index).split("\n")) {
    const m = /^ {2}(?:readonly )?"?([A-Za-z_][\w.]*)"?\??: /.exec(line)
    if (m) keys.push(m[1]!)
  }
  return keys
}

function pluginSurfaceKeys(): string[] {
  const hookSpecs = { tool: "ToolHooks", session: "SessionHooks", permission: "PermissionHooks", shell: "ShellHooks", aisdk: "AISDKHooks" } as const
  const keys = Object.entries(hookSpecs).flatMap(([domain, spec]) =>
    interfaceKeys(readFileSync(join(PROMISE_DIR, `${domain}.ts`), "utf8"), spec).map((key) => `${domain}.${key}`),
  )
  for (const file of readdirSync(PROMISE_DIR).filter((f) => f.endsWith(".ts")).sort())
    if (readFileSync(join(PROMISE_DIR, file), "utf8").includes("readonly transform: Transform<")) keys.push(`${file.slice(0, -3)}.transform`)
  return keys
}

describe("① 通路枚举派生自 2.x 插件 Context(packages/plugin/src/promise)", () => {
  test("解析手段先测出已知的形状:≥25 个键、含几个已知的钩子与 transform、无重复", () => {
    const keys = pluginSurfaceKeys()
    expect(keys.length).toBeGreaterThanOrEqual(25)
    for (const k of ["tool.execute.before", "session.context", "session.model.request", "permission.evaluate", "aisdk.sdk", "agent.transform", "tool.transform"])
      expect(keys).toContain(k)
    expect(new Set(keys).size).toBe(keys.length)
  })
  test("HOOK_CONTEXT_CLASS 的键集与源码 1:1 —— 上游新增钩子 / transform 而这里没分类,即红", () => {
    expect([...pluginSurfaceKeys()].sort()).toEqual(Object.keys(HOOK_CONTEXT_CLASS).sort())
  })
})

// ── 夹具 ────────────────────────────────────────────────────────────────────────

const SANITIZE = [
  "CODEPUPPY_FACTORY_SKILL_DIRS",
  "CODEPUPPY_FACTORY_DENY_SKILLS",
  "CODEPUPPY_PROMPT_REBRAND_DISABLE",
  "CODEPUPPY_EXT_VERBOSE",
  "CODEPUPPY_GLOBAL_DIR",
  // `#1419`:云端识图的三个输入 —— 没有它们时 context 钩子走「云端不可用」那一句与失败块。
  "CODEPUPPY_BASE_URL",
  CLOUD_MCP_ARM_ENV,
  CLOUD_MCP_DEF_ENV,
  CLOUD_MCP_SERVER_ENV,
] as const

let root = ""
const saved = new Map<string, string | undefined>()

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-ext-ctxinj-")))
  const global = join(root, "global", "env", "dev")
  mkdirSync(global, { recursive: true })
  mkdirSync(join(root, "project"), { recursive: true })
  for (const k of SANITIZE) {
    saved.set(k, process.env[k])
    delete process.env[k]
  }
  process.env.CODEPUPPY_GLOBAL_DIR = global
})
afterEach(() => {
  for (const k of SANITIZE) {
    const v = saved.get(k)
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(root, { recursive: true, force: true })
})

/** 本文件为之设了咽喉的通路。② 要求它与「真 CodePuppyExt 注册且分类为 context」的集合逐字相等。 */
const THROATED = ["agent.transform", "command.transform", "mcp.transform", "session.compaction", "session.context", "session.generate", "session.prompt", "session.title", "skill.transform", "tool.execute.after", "tool.transform", "websearch.transform"].sort()
/** 2.x 组装一次模型请求的四条钩子(`session/model-request.ts`:主循环 / 压缩 / 无工具生成 / 起标题各触发自己那条,互不经过)。 */
const REQUEST_HOOKS = ["context", "compaction", "generate", "title"] as const

describe("② alpha 注册的每个载上下文通路都有咽喉", () => {
  test("注册集 ∩ context 分类 == 本文件设咽喉的集合;注册的每个通路都在分类表里", async () => {
    const recorded = recordingContext(join(root, "project"))
    await CodePuppyExt.setup(recorded.context)
    const registered = [
      ...Object.keys(recorded.hooks),
      ...Object.keys(recorded.transforms).map((domain) => `${domain}.transform`),
    ]
    for (const k of registered) expect(Object.keys(HOOK_CONTEXT_CLASS), `通路 ${k} 不在 HOOK_CONTEXT_CLASS 里`).toContain(k)
    const ctx = registered.filter((k) => HOOK_CONTEXT_CLASS[k as keyof typeof HOOK_CONTEXT_CLASS] === "context").sort()
    expect(ctx).toEqual(THROATED)
    // 四条请求钩子挂的是**同一个**回调对象:下面 ③b / ③h 在四条钩子上逐一过真宿主,这里再钉住它们不会各自漂移。
    // session.context 上另有 L4 策略的目录闸(registerPolicy 里先注册,只删工具表条目、不写字;③b / ③h 的真宿主链里同在);
    // ext 自己的组装回调是那里的最后一个。
    const [context, ...rest] = REQUEST_HOOKS.map((name) => recorded.hooks[`session.${name}`] ?? [])
    expect(context).toHaveLength(2)
    const assemble = context!.at(-1)!
    for (const other of rest) {
      expect(other).toHaveLength(1)
      expect(other[0]).toBe(assemble)
    }
  })
})

// ── ③a 配置域 transform 咽喉(agent / command / mcp / skill)────────────────────────

type Leaf = { pointer: string; value: string }
function stringLeaves(v: unknown, pointer = ""): Leaf[] {
  if (typeof v === "string") return [{ pointer, value: v }]
  if (Array.isArray(v)) return v.flatMap((x, i) => stringLeaves(x, `${pointer}/${i}`))
  if (v && typeof v === "object")
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) =>
      stringLeaves(x, `${pointer}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`),
    )
  return []
}
/**
 * 执行命令时传的「用户参数」哨兵:发出的字里哨兵之外的部分才是 alpha 的字。用户敲的字不归登记簿(用户的字)。
 * 判官先把哨兵换回模板占位符 `$ARGUMENTS`,再去掉「模板里没有占位符 ⇒ 用户的字接在后面」那一段,剩下的必须是登记过的模板
 * (两头空白不算字:发出前整体 trim,与上游 `opencode.config.command` 同一规则)。
 */
const ARGS_SENTINEL = "⟦codepuppy-args⟧"
function commandTemplateOf(sent: string): string {
  return sent.replaceAll(ARGS_SENTINEL, "$ARGUMENTS").replace(/\n\n\$ARGUMENTS$/, "")
}
function explainCommandText(sent: string): boolean {
  const body = commandTemplateOf(sent)
  return CONTEXT_INJECTIONS.some((f) => {
    if (f.kind === "reference" || f.sink !== "command-template") return false
    if (f.kind === "text") return f.text.trim() === body
    if (f.kind === "template") {
      const [head, tail] = f.template.trim().split("{name}")
      return body.length >= head!.length + tail!.length && body.startsWith(head!) && body.endsWith(tail!)
    }
    return false
  })
}
/** 判官:transform 之后新出现的叶子里登记簿解释不了的那些;`/commands/<name>/template` 按上面的命令文字判。 */
function unexplainedWrites(after: unknown): Leaf[] {
  return stringLeaves(after).filter((l) =>
    /^\/commands\/[^/]+\/template$/.test(l.pointer) ? !explainCommandText(l.value) : !explainConfigString(l.pointer, l.value).ok,
  )
}

/**
 * ext 经配置域 transform 写进引擎的东西,摊成一份「配置形状」:`/agents/<id>/{system,description}`、
 * `/commands/<name>/{description,template}`(template = 用空参数执行该命令时发给会话的那段字)、`/mcp/<name>/…`。
 * 只收字符串,所以 `mode` 一类枚举不进判官。transform 回调由本函数用记账的编辑器驱动(宿主里的接线在 plugin-host.test.ts)。
 */
async function extWrites(): Promise<Record<string, Record<string, Record<string, unknown>>>> {
  const recorded = recordingContext(join(root, "project"))
  await CodePuppyExt.setup(recorded.context)
  const agents = new Map<string, Record<string, unknown>>()
  for (const transform of recorded.transforms.agent ?? [])
    transform({
      get: (id: string) => agents.get(id),
      update: (id: string, fn: (agent: Record<string, unknown>) => void) => {
        const current = agents.get(id) ?? {}
        fn(current)
        agents.set(id, current)
      },
    } as never)
  const definitions: Array<{ name: string; description?: string; execute: (input: unknown) => Promise<void> }> = []
  for (const transform of recorded.transforms.command ?? []) transform({ add: (definition: never) => void definitions.push(definition) } as never)
  const servers = new Map<string, unknown>()
  for (const transform of recorded.transforms.mcp ?? [])
    transform({
      list: () => Array.from(servers),
      get: (name: string) => servers.get(name),
      set: (name: string, config: unknown) => void servers.set(name, config),
      update: () => {},
      remove: (name: string) => void servers.delete(name),
    } as never)
  const view: Record<string, Record<string, Record<string, unknown>>> = { agents: {}, commands: {}, mcp: {} }
  for (const [id, agent] of agents)
    view.agents[id] = Object.fromEntries(Object.entries(agent).filter(([key, value]) => (key === "system" || key === "description") && typeof value === "string"))
  for (const definition of definitions) {
    const before = recorded.invocations.length
    await definition.execute({ sessionID: "ses_throat", prompt: { text: ARGS_SENTINEL }, delivery: "queue" })
    const sent = recorded.invocations.slice(before).find((entry) => entry.call === "session.prompt")?.args[0] as { text?: string } | undefined
    view.commands[definition.name] = { ...(definition.description ? { description: definition.description } : {}), ...(sent?.text !== undefined ? { template: sent.text } : {}) }
  }
  for (const [name, config] of servers) view.mcp[name] = config as Record<string, unknown>
  return view
}

describe("③a 配置域 transform 咽喉:ext 写进 agent / command / mcp 的每个字符串都必须由登记簿解释", () => {
  test("空项目:ext 写的零无解释叶子;且确实写了(不是空跑);出厂 /init /review 不由 ext 写(归 L5 内联配置)", async () => {
    const after = await extWrites()
    const leaves = stringLeaves(after)
    expect(leaves.length).toBeGreaterThanOrEqual(4)
    for (const p of ["/agents/general/system", "/agents/explore/system", "/agents/docs/system", "/agents/docs/description"])
      expect(leaves.map((l) => l.pointer)).toContain(p)
    expect(Object.keys(after.commands)).toEqual([])
    expect(unexplainedWrites(after)).toEqual([])
  })
  test("L5 写进内联配置的出厂命令来自同一个纯函数:applyPromptTakeover 产出的每个命令字符串都是登记项(review 带 subtask)", () => {
    const cfg: Record<string, unknown> = {}
    applyPromptTakeover(cfg)
    const commands = cfg.command as Record<string, Record<string, unknown>>
    expect(Object.keys(commands).sort()).toEqual(["init", "review"])
    expect(commands.review!.subtask).toBe(true)
    const leaves = stringLeaves({ command: commands })
    expect(leaves.filter((l) => !explainConfigString(l.pointer, l.value).ok)).toEqual([])
    // 已知的坏:模板多一个字 ⇒ 解释不了
    expect(explainConfigString("/command/init/template", `${commands.init!.template}!`).ok).toBe(false)
  })
  test("#1522 AC3:弃用占位只指向 /customize-codepuppy,不提供恢复路径", async () => {
    process.env.CODEPUPPY_FACTORY_DENY_SKILLS = JSON.stringify(["customize-opencode"])
    const after = await extWrites()
    const command = after.commands["customize-opencode"] as { description: string; template: string }
    expect(command.description).toBe("(已弃用)请使用 /customize-codepuppy")
    expect(commandTemplateOf(command.template)).toBe("该技能(customize-opencode)已弃用。定制 Code Puppy 请改用 /customize-codepuppy。")
    expect(explainConfigString("/commands/customize-opencode/template", commandTemplateOf(command.template))).toEqual({ ok: true, id: "command.factory-denied.template", kind: "template" })
    expect(unexplainedWrites(after)).toEqual([])
  })
  test("云 MCP 定义落在声明过的引用 /mcp 下(ARM + DEF 在场时 ext 装进去)", async () => {
    process.env[CLOUD_MCP_ARM_ENV] = "codepuppy"
    process.env[CLOUD_MCP_DEF_ENV] = JSON.stringify({ type: "remote", url: "https://cloud.invalid/mcp", oauth: false })
    const after = await extWrites()
    expect(after.mcp.codepuppy).toEqual({ type: "remote", url: "https://cloud.invalid/mcp", oauth: false })
    expect(unexplainedWrites(after)).toEqual([])
  })
  test("已知的坏 ①:绕过登记簿写一个 agent system —— 判官点名那一条", async () => {
    const after = await extWrites()
    after.agents.rogue = { system: "rogue prompt written straight into the agent" }
    expect(unexplainedWrites(after)).toEqual([{ pointer: "/agents/rogue/system", value: "rogue prompt written straight into the agent" }])
  })
  test("已知的坏 ②:往一个登记簿从没声明过的键(instructions)塞东西 —— 不是白名单,新 pointer 照样红", async () => {
    const after = (await extWrites()) as Record<string, unknown>
    after.instructions = { 0: "/tmp/sneaky.md" }
    expect(unexplainedWrites(after).map((l) => l.pointer)).toEqual(["/instructions/0"])
  })
  test("已知的坏 ③:登记过的文字被改动一个字节 —— 逐字比对,不是「像」", async () => {
    const after = await extWrites()
    ;(after.agents.general as { system: string }).system += "!"
    expect(unexplainedWrites(after).map((l) => l.pointer)).toEqual(["/agents/general/system"])
  })
  test("已知的坏 ③′:命令发出的字在用户参数之外多一段(不是登记过的模板 + 用户的字)⇒ 点名", async () => {
    process.env.CODEPUPPY_FACTORY_DENY_SKILLS = JSON.stringify(["customize-opencode"])
    const after = await extWrites()
    const command = after.commands["customize-opencode"] as { template: string }
    expect(unexplainedWrites(after)).toEqual([])
    command.template = "rogue " + command.template
    expect(unexplainedWrites(after).map((l) => l.pointer)).toEqual(["/commands/customize-opencode/template"])
  })
  test("已知的坏 ④:模板实例前后缀之外多了字 —— 模板识别是前后缀逐字,不是包含", () => {
    const good = renderTemplate("command.factory-denied.template", { name: "x" })
    expect(explainConfigString("/commands/x/template", good).ok).toBe(true)
    expect(explainConfigString("/commands/x/template", good + " and more").ok).toBe(false)
    expect(explainConfigString("/commands/x/template", "prefix " + good).ok).toBe(false)
  })
  test("已知的坏 ⑤(`#1305`):explainConfigReference 只认引用 —— ui-mac 的引用子树解释得通;登记过的文字放在没登记 sink 的位置不由它放行;/instructions 仍不是引用;段边界精确", () => {
    for (const p of ["/$schema", "/plugin/0", "/enabled_providers/1", "/model", "/provider/alpha/models/x/variants/高/reasoning/effort", "/mcp/cloud/headers/Authorization"])
      expect(explainConfigReference(p).ok, p).toBe(true)
    expect(explainConfigReference("/provider")).toEqual({ ok: true, id: "ref.provider", kind: "reference" })
    for (const p of ["/commands/x/template", "/instructions/0", "/agents/x/system", "/providers/x", "/provider_extra", "/models", "/permission/websearch", ""])
      expect(explainConfigReference(p).ok, p).toBe(false)
    expect(explainConfigString("/commands/x/template", contextText("command.init.template")).ok).toBe(true)
    expect(explainConfigReference("/commands/x/template").ok).toBe(false)
  })
})

describe("③a″ skill / websearch transform 不写字:只拿掉出厂禁项、只选供应商", () => {
  test("skill.transform 只调 remove;websearch.transform 只在没有选择时调 default.set(供应商 id),不加任何带字的供应商", async () => {
    process.env.CODEPUPPY_FACTORY_DENY_SKILLS = JSON.stringify(["customize-opencode"])
    const recorded = recordingContext(join(root, "project"))
    await CodePuppyExt.setup(recorded.context)
    const calls: string[] = []
    for (const transform of recorded.transforms.skill ?? [])
      transform({ remove: (id: string) => void calls.push(`skill.remove ${id}`), add: () => void calls.push("skill.add"), update: () => void calls.push("skill.update") } as never)
    for (const transform of recorded.transforms.websearch ?? [])
      transform({
        add: () => void calls.push("websearch.add"),
        remove: () => void calls.push("websearch.remove"),
        default: { get: () => undefined, set: (selection: unknown) => void calls.push(`websearch.default ${String(selection)}`) },
      } as never)
    expect(calls).toEqual(["skill.remove customize-opencode", "websearch.default exa"])
  })
})

// ── ③b session.hook.context 的 system 咽喉 ──────────────────────────────────────

/** `#1419`:看不了图的模型末尾允许**恰好一段**登记过的 vision 系统说明(sink=system 的 text,或模板的渲染实例)。 */
function isRegisteredVisionNote(segment: string): boolean {
  if (segment === VISION_SYSTEM_NOTE_OFFLINE_TEXT) return true
  const [head, tail] = VISION_SYSTEM_NOTE_TEMPLATE.split("{name}")
  return segment.length > head!.length + tail!.length && segment.startsWith(head!) && segment.endsWith(tail!)
}
/** 判官:输出必须逐段等于「输入 + 登记过的替换」,后面至多跟一段登记过的 vision 说明;段数多了、某段多了字、尾段不是登记项,都点名。 */
function unexplainedSystem(input: readonly string[], output: readonly string[]): string[] {
  const bad: string[] = []
  const extra = output.length - input.length
  if (extra < 0 || extra > 1) bad.push(`segment count ${input.length} → ${output.length}`)
  for (let i = 0; i < Math.min(input.length, output.length); i++)
    if (output[i] !== applyRegisteredRebrands(input[i]!)) bad.push(`segment ${i} differs from registered substitutions`)
  if (extra === 1 && !isRegisteredVisionNote(output[output.length - 1]!)) bad.push("trailing segment is not a registered vision note")
  return bad
}

/** 旁路插件:真 provider / model 服务里一个能看图、一个看不了图的模型。 */
const visionModels = {
  id: "test.ctx-models",
  async setup(context: { provider: { transform: (cb: (editor: { add: (input: unknown) => void }) => void) => Promise<unknown> } }) {
    await context.provider.transform((editor) =>
      editor.add({
        info: { id: "alpha", name: "alpha", activation: "auto", package: "@opencode/ai/providers/openai-compatible" },
        models: [
          ["glm-5", ["text"]],
          ["kimi-k3", ["text", "image"]],
        ].map(([id, input]) => ({ id, modelID: id, providerID: "alpha", name: id, capabilities: { tools: true, input, output: ["text"] }, variants: [], time: { released: 0 }, cost: [], status: "active", enabled: true, limit: { context: 128000, output: 32000 } })),
      }),
    )
  },
} as never
const SEES = { providerID: "alpha", id: "kimi-k3" }
const BLIND = { providerID: "alpha", id: "glm-5" }

const runContext = (system: string[], model: unknown, messages: unknown[] = [], hook: (typeof REQUEST_HOOKS)[number] = "context") =>
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    return yield* hooks.trigger("session", hook, {
      sessionID: "ses_throat" as never,
      agent: "build" as never,
      model: model as never,
      system: system.map((text) => ({ type: "text" as const, text })),
      messages: messages as never,
      options: {},
      tools: {},
    })
  })
const systemOf = (event: { system: Array<{ text: string }> }) => event.system.map((part) => part.text)
const baseFiles = () => [
  "session/runner/prompt/system.txt",
  ...readdirSync(join(CORE_SRC, "plugin/system-prompt"))
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => `plugin/system-prompt/${f}`),
]
const readBase = (f: string) => readFileSync(join(CORE_SRC, f), "utf8").replaceAll("${OPENCODE_TOOL_GUIDANCE}", "")

describe("③b system 咽喉:输出 == 输入 + 登记过的替换,一个字不多", () => {
  test("登记簿的 rebrand 集合与 REBRAND_RULES 1:1(id 与 to 逐字)", () => {
    const registered = CONTEXT_INJECTIONS.filter((f) => f.kind === "rebrand")
    expect(registered.map((f) => f.id)).toEqual(REBRAND_RULES.map((r) => `rebrand.${r.id}`))
    expect(registered.map((f) => (f.kind === "rebrand" ? f.to : ""))).toEqual(REBRAND_RULES.map((r) => r.to))
  })
  it.live("全部上游底座过真钩子(能看图的模型;context / compaction / generate / title 四条):零无解释差异,且至少一份真的被改写了(不是空跑)", () =>
    Effect.gen(function* () {
      yield* activate(visionModels)
      yield* activate(CodePuppyExt)
      const files = baseFiles()
      expect(files.length).toBeGreaterThanOrEqual(7)
      let changed = 0
      for (const f of files)
        for (const hook of REQUEST_HOOKS) {
          const input = [readBase(f)]
          const output = systemOf(yield* runContext(input, SEES, [], hook))
          expect([f, hook, unexplainedSystem(input, output)]).toEqual([f, hook, []])
          if (output[0] !== input[0]) changed += 1
        }
      expect(changed).toBeGreaterThanOrEqual(1)
      expect(systemOf(yield* runContext([], SEES))).toEqual([])
      expect(systemOf(yield* runContext(["nothing to rebrand here"], SEES))).toEqual(["nothing to rebrand here"])
    }),
  )
  test("已知的坏:多推一段 / 多接几个字 —— 判官都点名", () => {
    const input = [readBase("plugin/system-prompt/kimi.txt")]
    const good = input.map(applyRegisteredRebrands)
    expect(unexplainedSystem(input, [...good, "rogue extra segment"])).toEqual(["trailing segment is not a registered vision note"])
    expect(unexplainedSystem(input, [...good, "rogue", "second rogue"])).toEqual(["segment count 1 → 3"])
    expect(unexplainedSystem(input, [good[0] + " rogue tail"])).toEqual(["segment 0 differs from registered substitutions"])
  })
  it.live("`#1419` 看不了图的模型:恰好多一段,且是登记过的说明;云端不可用 ⇒ 离线那一句,可用 ⇒ 带工具 id 的那一句;两句都不提 gemini;能力未知按看不了图", () =>
    Effect.gen(function* () {
      yield* activate(visionModels)
      yield* activate(CodePuppyExt)
      const input = [readBase("plugin/system-prompt/anthropic.txt")]
      const offline = systemOf(yield* runContext(input, BLIND))
      expect(unexplainedSystem(input, offline)).toEqual([])
      expect(offline).toHaveLength(2)
      expect(offline[1]).toBe(VISION_SYSTEM_NOTE_OFFLINE_TEXT)
      const token = join(root, "mcp-token")
      writeFileSync(token, "tok-throat\n")
      process.env.CODEPUPPY_BASE_URL = "https://gateway.invalid/v1"
      process.env[CLOUD_MCP_SERVER_ENV] = "codepuppy"
      process.env[CLOUD_MCP_DEF_ENV] = JSON.stringify({ type: "remote", url: "https://cloud.invalid/mcp", headers: { Authorization: `Bearer {file:${token}}` }, oauth: false })
      const online = systemOf(yield* runContext(input, BLIND))
      expect(unexplainedSystem(input, online)).toEqual([])
      expect(online[1]).toContain("codepuppy_vision")
      for (const note of [offline[1]!, online[1]!]) expect(/gemini/i.test(note)).toBe(false)
      const unknown = systemOf(yield* runContext(input, { providerID: "alpha", id: "ghost" }))
      expect(unexplainedSystem(input, unknown)).toEqual([])
      expect(unknown).toHaveLength(2)
      const tampered = [...online]
      tampered[1] += "!"
      expect(unexplainedSystem(input, tampered)).toEqual(["trailing segment is not a registered vision note"])
    }),
  )
})

// ── ③c 工具表咽喉 ───────────────────────────────────────────────────────────────

type ToolView = Record<string, { description: string; args: Record<string, string | undefined> }>
/** 判官:每个工具的 description 与每个入参的 description 都必须是登记项;登记项也不许多出实际没有的工具。 */
function unexplainedTools(tools: ToolView): string[] {
  const bad: string[] = []
  const byId = new Map(CONTEXT_INJECTIONS.filter((f) => f.kind === "text").map((f) => [f.id, f.kind === "text" ? f.text : ""]))
  for (const [name, t] of Object.entries(tools)) {
    if (byId.get(`tool.${name}.description`) !== t.description) bad.push(`tool.${name}.description`)
    for (const [arg, description] of Object.entries(t.args)) if (byId.get(`tool.${name}.args.${arg}`) !== description) bad.push(`tool.${name}.args.${arg}`)
  }
  const actualIds = new Set(Object.entries(tools).flatMap(([name, t]) => [`tool.${name}.description`, ...Object.keys(t.args).map((a) => `tool.${name}.args.${a}`)]))
  for (const id of byId.keys()) if (id.startsWith("tool.") && !actualIds.has(id)) bad.push(`stale registration ${id}`)
  return bad
}
/** 真宿主工具注册表里 ext 的工具 → 工具表上模型看到的 description 与每个入参的 description(JSON schema 的 properties)。 */
const toolView = Effect.gen(function* () {
  const tools = yield* Tool.Service
  const view: ToolView = {}
  for (const tool of yield* tools.list()) {
    if (!(tool.id in TOOL_TEXT)) continue
    const properties = ((tool.input as { properties?: Record<string, { description?: string }> }).properties ?? {}) as Record<string, { description?: string }>
    view[tool.id] = { description: tool.description, args: Object.fromEntries(Object.entries(properties).map(([arg, schema]) => [arg, schema.description])) }
  }
  return view
})

describe("③c 工具表咽喉:每个 description 都是登记项,登记项也不许有实际没有的工具", () => {
  it.live("真宿主里 ext 的工具:零无解释;且 TOOL_TEXT 的键集 == 实际工具名", () =>
    Effect.gen(function* () {
      yield* activate(CodePuppyExt)
      const tools = yield* toolView
      expect(Object.keys(tools).sort()).toEqual(Object.keys(TOOL_TEXT).sort())
      expect(unexplainedTools(tools)).toEqual([])
      // 已知的坏:多一个未登记的工具 / 改一个 description / 登记簿多一条 —— 判官各点名
      expect(unexplainedTools({ ...tools, rogue: { description: "unregistered tool", args: {} } })).toEqual(["tool.rogue.description"])
      expect(unexplainedTools({ ...tools, codepuppy_ping: { ...tools.codepuppy_ping!, description: tools.codepuppy_ping!.description + "!" } })).toEqual([
        "tool.codepuppy_ping.description",
      ])
      const { codepuppy_ping: _drop, ...rest } = tools
      expect(unexplainedTools(rest)).toEqual(["stale registration tool.codepuppy_ping.description", "stale registration tool.codepuppy_ping.args.note"])
    }),
  )
  it.live("REQ-232 AC1 codepuppy_access is available without Cloud MCP and returns a login entry", () =>
    Effect.gen(function* () {
      yield* activate(CodePuppyExt)
      const tools = yield* Tool.Service
      const snapshot = yield* tools.snapshot()
      const call = () =>
        snapshot.execute({ sessionID: "ses_a" as never, agent: "build" as never, messageID: "msg_a" as never, call: { type: "tool-call", id: "call_a", name: "codepuppy_access", input: {} } })
      const text = (result: { content: unknown }) => JSON.parse((result.content as Array<{ text: string }>)[0]!.text)
      expect(text(yield* call())).toEqual({
        logged_in: false,
        state: "logged-out",
        cloud_tools_enabled: false,
        login_hint: "在 CodePuppy 左侧栏账户区点「登录」,或打开定制中心的云端页点登录;登录完成后下一条消息起云端工具可用。",
      })
      process.env.CODEPUPPY_BASE_URL = "https://gateway.invalid/v1"
      const { materializeCloudMcpConfig } = yield* Effect.promise(() => import("../../ui-mac/src/main/cloud-sidecar-config"))
      // The real desktop producer; an existing directory makes a file-content read throw.
      process.env[CLOUD_MCP_DEF_ENV] = JSON.stringify(materializeCloudMcpConfig("https://cloud.invalid/mcp", `{file:${root}}`))
      const ready = text(yield* call())
      expect(ready).toMatchObject({ logged_in: true, state: "ready", cloud_tools_enabled: false })
      expect(JSON.stringify(ready)).not.toContain(root)
    }),
  )
})

// ── ③d tool.execute.after 咽喉 ───────────────────────────────────────────────────

describe("③d tool.execute.after 咽喉:工具结果回模型的路上,alpha 换进去的每个字都由登记簿解释", () => {
  const after = (tool: string, result: unknown) =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      return yield* hooks.trigger("tool", "execute.after", {
        tool,
        sessionID: "ses_after" as never,
        agent: "build" as never,
        messageID: "msg_after" as never,
        id: "call_after" as never,
        input: {},
        status: "completed",
        result: result as never,
      })
    })
  it.live("非云工具的结果原样;治理云工具的结果过不了契约 ⇒ 换成一句登记过的拒绝(sink=tool-output);已知的坏:改一个字即点名", () =>
    Effect.gen(function* () {
      process.env[CLOUD_MCP_SERVER_ENV] = "codepuppy"
      process.env[CLOUD_MCP_DEF_ENV] = JSON.stringify({ type: "remote", url: "https://cloud.invalid/mcp" })
      process.env[CLOUD_MCP_ARM_ENV] = "codepuppy"
      const mcp = recordingMcp()
      yield* activate(CodePuppyExt, { mcp })
      const plain = { content: "tool said this", metadata: { a: 1 } }
      expect((yield* after("shell", { ...plain })).result).toEqual(plain)
      const refused = (yield* after("codepuppy_status", { output: { status: "not-a-real-status" } })) as { result: { content: string } }
      const explain = (text: string) =>
        CONTEXT_INJECTIONS.some((f) => {
          if (f.kind !== "template" || f.sink !== "tool-output") return false
          const [head, tail] = f.template.split("{name}")
          return text.startsWith(head!) && text.endsWith(tail!)
        })
      expect(refused.result.content.startsWith("codepuppy_status ")).toBe(true)
      expect(explain(refused.result.content)).toBe(true)
      expect(explain(refused.result.content + " (and more)")).toBe(false)
    }),
  )
})

// ── ③h context 钩子的消息咽喉(`#1419`):只换不加,换进去的都是登记过的识图块 ─────────────

/** 本次请求里新出现的文字(消息里的 text 部件 + 工具结果里的 text 项),去掉原来就有的。 */
function addedStrings(before: readonly unknown[], after: readonly unknown[]): string[] {
  const collect = (messages: readonly unknown[]) =>
    messages.flatMap((message) =>
      ((message as { content?: unknown[] }).content ?? []).flatMap((part) => {
        const p = part as { type?: string; text?: string; result?: { value?: unknown } }
        if (p.type === "text" && typeof p.text === "string") return [p.text]
        if (p.type === "tool-result") return [typeof p.result?.value === "string" ? p.result.value : JSON.stringify(p.result?.value ?? "")]
        return []
      }),
    )
  const had = new Set(collect(before))
  return collect(after).filter((text) => !had.has(text))
}

describe("③h context 钩子的消息咽喉:只换不加,换进去的每段字都是登记过的识图块", () => {
  it.live("看不了图 + 云端不可用:图片换成登记过的失败块,零别的新字;能看图:消息对象原样(context / compaction / generate / title 四条)", () =>
    Effect.gen(function* () {
      yield* activate(visionModels)
      yield* activate(CodePuppyExt)
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
      const messages = [Message.user([Message.text("看图"), Message.media(Media.base64(png, "image/png"), { filename: "a.png" })])]
      for (const hook of REQUEST_HOOKS) {
        const blind = yield* runContext(["base"], BLIND, [...messages], hook)
        const added = addedStrings(messages, blind.messages)
        expect([hook, added.length]).toEqual([hook, 1])
        expect(explainVisionBlock(added[0]!).ok).toBe(true)
        expect(explainVisionBlock(added[0]! + "!").ok).toBe(false)
        const sees = yield* runContext(["base"], SEES, [...messages], hook)
        expect(sees.messages[0]).toBe(messages[0]!)
      }
    }),
  )
  it.live("`#1553` / I11':暂存附件部件在本次请求里换成一段登记过的读取指令(sink=attachment-block),零别的新字;已知的坏:改一个字即点名;反向臂:不装 ext ⇒ 原始部件原样进请求", () =>
    Effect.gen(function* () {
      const staged = { v: 1, name: "季度复盘.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 2048, path: "attachments/0b8c7f9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f/季度复盘.docx", reader: "word" }
      const part = stagedAttachmentPart(staged)
      // 上游真的渲染(toLLMMessages):composer 发的部件经引擎存成 text/plain 的 inline 文件
      const history = toLLMMessages(
        [{ id: "msg_i11", time: { created: 1 }, type: "user", text: "读一下", files: [{ data: part.uri.slice(part.uri.indexOf(",") + 1), mime: "text/plain", name: part.name, source: { type: "inline" } }] } as never],
        BLIND as never,
      )
      const rawText = (history[0] as unknown as { content: Array<{ text: string }> }).content[1]!.text
      expect(rawText.startsWith(`\n\nAttached file: ${STAGED_ATTACHMENT_PART_NAME}`)).toBe(true)
      yield* activate(visionModels)
      for (const hook of REQUEST_HOOKS) expect((yield* runContext(["base"], SEES, [...history], hook)).messages[0]).toBe(history[0]!)
      yield* activate(CodePuppyExt)
      for (const hook of REQUEST_HOOKS) {
        const out = yield* runContext(["base"], SEES, [...history], hook)
        const added = addedStrings(history, out.messages)
        expect([hook, added.length]).toEqual([hook, 1])
        expect(explainAttachmentBlock(added[0]!).ok).toBe(true)
        expect(explainAttachmentBlock(added[0]! + "!").ok).toBe(false)
        const texts = (out.messages[0] as unknown as { content: Array<{ text: string }> }).content.map((p) => p.text)
        expect(texts[0]).toBe("读一下")
        expect(texts.some((text) => text.includes(STAGED_ATTACHMENT_PART_NAME))).toBe(false)
      }
    }),
  )
  it.live("`#1447` B2:历史里 codepuppy_vision 的审核拒绝结果换成登记句(VISION_TOOL_REFUSED_TEXT),其余字符串一个不多", () =>
    Effect.gen(function* () {
      process.env[CLOUD_MCP_SERVER_ENV] = "codepuppy"
      yield* activate(visionModels)
      yield* activate(CodePuppyExt)
      const refusal = Message.tool({ id: "call_v", name: "codepuppy_vision", result: { type: "error", value: "content_refused" } } as never)
      const out = yield* runContext(["base"], SEES, [refusal])
      const added = addedStrings([refusal], out.messages)
      expect(added).toEqual([VISION_TOOL_REFUSED_TEXT])
    }),
  )
})
// ── ③i session.prompt 通路(#1662 整合):L4 策略在用户消息钩子上只登记目录尾规则,不往消息里写字 ──────────
describe("③i session.prompt 咽喉:用户消息上 alpha 一个字不加", () => {
  it.live("真宿主:ext(含 L4 策略的 prompt 钩子)装上后,用户消息的每个字符串叶子与输入逐字相同,且钩子真跑了;已知的坏:之后的插件往消息里塞一段 ⇒ 判官点名", () =>
    Effect.gen(function* () {
      yield* activate(CodePuppyExt)
      const hooks = yield* PluginHooks.Service
      const input = () => ({ sessionID: "ses_prompt_throat", messageID: "msg_prompt_throat", prompt: { text: "帮我看一下 a.txt" }, delivery: "queue" })
      const leaves = (event: unknown) => stringLeaves(event).map((leaf) => `${leaf.pointer}=${leaf.value}`)
      const added = (event: unknown) => leaves(event).filter((leaf) => !leaves(input()).includes(leaf))
      const info = spyOn(console, "info").mockImplementation(() => {})
      try {
        const out = yield* hooks.trigger("session", "prompt", input() as never)
        expect(added(out)).toEqual([])
        // 不是空跑:策略的 prompt 钩子在这一次登记了目录尾规则
        expect(info.mock.calls.some((call) => String(call[0]).includes("tool policy catalog rules active"))).toBe(true)
      } finally {
        info.mockRestore()
      }
      yield* activate({
        id: "test.prompt-writer",
        async setup(context) {
          await context.session.hook("prompt", (event) => void ((event.prompt as { text: string }).text += " 多一段"))
        },
      })
      expect(added(yield* hooks.trigger("session", "prompt", input() as never))).toEqual(["/prompt/text=帮我看一下 a.txt 多一段"])
    }),
  )
})

// ── ③e instructions 通路(`#1296`):ui-mac 写 cfg.instructions 的两份文件 ────────────────
// 真注入的咽喉在 ui-mac 那边(config-injection-throat.test.ts 跑真 injectCodePuppyConfig,8 组 env 矩阵
// 与这里登记的形状集合双向比对)。这里钉三件登记簿自己的事:登记形状、判官能测出已知的坏、
// 跨包 import 的前提(ui-mac 那两个内容模块零依赖)仍然成立。

const DEPENDENCY_LINE = /^\s*import\b|\brequire\(|^\s*export\s.*\sfrom\s/

describe("③e instructions 通路:登记形状 + 判官 + 跨包前提", () => {
  test("登记了 behavior 1 条 + identity 2^|CodePuppyCapabilities| 条,全在 sink=instruction;变体 id 可反推 caps、正文 = 生产 buildCodePuppyIdentity(caps)、两两不同", () => {
    const rows = CONTEXT_INJECTIONS.filter((f): f is Extract<typeof f, { kind: "text" }> => f.kind === "text" && f.sink === "instruction")
    const behavior = rows.find((f) => f.id === BEHAVIOR_FRAGMENT_ID)
    expect(behavior?.text).toBe(CODEPUPPY_BEHAVIOR_MD)
    const identity = rows.filter((f) => f.id.startsWith(IDENTITY_FRAGMENT_ID))
    const capKeys = Object.keys(identityCapsFromId(IDENTITY_FRAGMENT_ID) ?? {})
    expect(capKeys.length).toBeGreaterThanOrEqual(2)
    expect(identity.length).toBe(2 ** capKeys.length)
    for (const f of identity) {
      const caps = identityCapsFromId(f.id)
      expect(caps, f.id).toBeDefined()
      expect(f.text, f.id).toBe(buildCodePuppyIdentity(caps))
    }
    expect(new Set(identity.map((f) => f.text)).size).toBe(identity.length)
    expect(rows.length).toBe(identity.length + 1)
  })
  test("判官 explainInstructionBody:逐字命中;已知的坏 —— 一字节之差 / 少一字节 / 其它 sink 的登记文字 / 空串 都不解释", () => {
    expect(explainInstructionBody(CODEPUPPY_BEHAVIOR_MD)).toEqual({ ok: true, id: BEHAVIOR_FRAGMENT_ID, kind: "text" })
    expect(explainInstructionBody(buildCodePuppyIdentity({ websearch: true, cloudDispatch: false }))).toEqual({
      ok: true,
      id: `${IDENTITY_FRAGMENT_ID}+websearch`,
      kind: "text",
    })
    expect(explainInstructionBody(CODEPUPPY_BEHAVIOR_MD + "!").ok).toBe(false)
    expect(explainInstructionBody(CODEPUPPY_BEHAVIOR_MD.slice(0, -1)).ok).toBe(false)
    // agent prompt 是登记过的字,但它的 sink 是 system(顶替底座),不是 instruction 文件 —— 不许串格解释
    expect(explainInstructionBody(contextText("agent.general.prompt")).ok).toBe(false)
    expect(explainInstructionBody("").ok).toBe(false)
    expect(identityCapsFromId("agent.general.prompt")).toBeUndefined()
    expect(identityCapsFromId(`${IDENTITY_FRAGMENT_ID}+cloudDispatch`)).toEqual({ websearch: false, cloudDispatch: true })
  })
  test("跨包前提:ui-mac 那三个内容模块保持零 import / require(否则 ext 自包含 bundle 会把 main 世界拖进引擎,ADR-006)", () => {
    // 先证明手段能测出已知的坏:三种依赖写法各抓一行,普通 export 不误抓
    expect(['import * as fs from "node:fs"', 'const x = require("electron")', 'export { a } from "./b"'].filter((l) => DEPENDENCY_LINE.test(l))).toHaveLength(3)
    expect(["export function f() {}", "export const X = 1", 'const s = "from here"'].filter((l) => DEPENDENCY_LINE.test(l))).toHaveLength(0)
    for (const f of ["codepuppy-behavior.ts", "codepuppy-identity.ts", "codepuppy-agents.ts"]) {
      const src = readFileSync(join(REPO_ROOT, "packages", "ui-mac", "src", "main", f), "utf8")
      expect(src.length).toBeGreaterThan(100)
      expect(src.split("\n").filter((l) => DEPENDENCY_LINE.test(l)), `${f} 引入了依赖`).toEqual([])
    }
  })
})

// ── ③f agent 通路(`#1299`):ui-mac 写 cfg.agent.<name>.{prompt,description} 的三个 alpha agent ──────
// 真注入的咽喉在 ui-mac 那边(config-injection-throat.test.ts 跑真 injectCodePuppyConfig,cfg.agent 下每个新写入的
// 字符串叶子过判官,并与这里的登记集合双向比对)。这里只钉登记形状与判官 explainAgentText 的已知的坏。

describe("③f agent 通路:登记形状 + 判官 explainAgentText", () => {
  test("ui-mac 的每个 agent 登记 description(sink=agent-description),有 prompt 的再登记 prompt(sink=system),正文 = CODEPUPPY_AGENT_TEXT 逐字;名字集合 = 内容模块键集;没有 prompt 的不许凭空多出一格", () => {
    expect([...UI_MAC_AGENT_NAMES].sort()).toEqual(Object.keys(CODEPUPPY_AGENT_TEXT).sort())
    expect(UI_MAC_AGENT_NAMES.length).toBeGreaterThanOrEqual(3)
    let withPrompt = 0
    let withoutPrompt = 0
    for (const name of UI_MAC_AGENT_NAMES) {
      const text: { prompt?: string; description: string } = CODEPUPPY_AGENT_TEXT[name]
      const prompt = CONTEXT_INJECTIONS.find((f) => f.id === uiMacAgentFragmentId(name, "prompt"))
      const description = CONTEXT_INJECTIONS.find((f) => f.id === uiMacAgentFragmentId(name, "description"))
      expect(description?.kind, name).toBe("text")
      if (description?.kind !== "text") throw new Error("unreachable")
      expect(description.sink).toBe("agent-description")
      expect(description.text).toBe(text.description)
      if (text.prompt === undefined) {
        // `#1413` codepuppy-ask:没有 prompt 就不能有 prompt 那格(登记一个永远不会被写出的 id = 咽喉等一段不存在的字)
        expect(prompt, name).toBeUndefined()
        expect(uiMacAgentFragmentIds(name)).toEqual([uiMacAgentFragmentId(name, "description")])
        withoutPrompt += 1
        continue
      }
      expect(prompt?.kind, name).toBe("text")
      if (prompt?.kind !== "text") throw new Error("unreachable")
      expect(prompt.sink).toBe("system")
      expect(prompt.text).toBe(text.prompt)
      expect(prompt.bytes).toBe(contextBytes(text.prompt))
      expect(uiMacAgentFragmentIds(name)).toEqual([uiMacAgentFragmentId(name, "prompt"), uiMacAgentFragmentId(name, "description")])
      withPrompt += 1
    }
    // 两种形状都真的在场(否则上面某一支是死代码,判官对那一支从没被证明过)
    expect(withPrompt).toBeGreaterThanOrEqual(3)
    expect(withoutPrompt).toBeGreaterThanOrEqual(1)
    // 所有字两两不同(否则「集合相等」可能是同一段字登记了多次)
    const texts = UI_MAC_AGENT_NAMES.flatMap((n) => {
      const text: { prompt?: string; description: string } = CODEPUPPY_AGENT_TEXT[n]
      return text.prompt === undefined ? [text.description] : [text.prompt, text.description]
    })
    expect(new Set(texts).size).toBe(texts.length)
  })
  test("判官 explainAgentText:逐字命中对应 sink;已知的坏 —— 一字节之差 / 串格(description 当 prompt、instruction 文件当 prompt)/ 空串 都不解释", () => {
    const name = UI_MAC_AGENT_NAMES[0]!
    expect(explainAgentText("prompt", CODEPUPPY_AGENT_TEXT[name].prompt)).toEqual({ ok: true, id: uiMacAgentFragmentId(name, "prompt"), kind: "text" })
    expect(explainAgentText("description", CODEPUPPY_AGENT_TEXT[name].description)).toEqual({
      ok: true,
      id: uiMacAgentFragmentId(name, "description"),
      kind: "text",
    })
    // ext 自己的 agent prompt 也是 sink=system 的登记文字 —— 同一格,判官同样认(不是按 id 前缀认的)
    expect(explainAgentText("prompt", contextText("agent.general.prompt"))).toEqual({ ok: true, id: "agent.general.prompt", kind: "text" })
    expect(explainAgentText("prompt", CODEPUPPY_AGENT_TEXT[name].prompt + "!").ok).toBe(false)
    expect(explainAgentText("prompt", CODEPUPPY_AGENT_TEXT[name].prompt.slice(0, -1)).ok).toBe(false)
    expect(explainAgentText("prompt", CODEPUPPY_AGENT_TEXT[name].description).ok).toBe(false)
    expect(explainAgentText("description", CODEPUPPY_AGENT_TEXT[name].prompt).ok).toBe(false)
    expect(explainAgentText("prompt", CODEPUPPY_BEHAVIOR_MD).ok).toBe(false)
    expect(explainAgentText("prompt", "").ok).toBe(false)
    expect(explainAgentText("description", "").ok).toBe(false)
  })
})

// ── AC2:超限响亮失败,不裁剪;单位是字节 ─────────────────────────────────────────

describe("AC2 上限:登记时超限即抛,不裁剪;计量单位是 UTF-8 字节", () => {
  test("64/65 边界:65 字节对 64 上限抛 ContextBudgetError(信息含 id、实测、上限);对 65 上限原样通过", () => {
    const text = "a".repeat(65)
    let err: unknown
    try {
      defineText({ id: "probe.boundary", sink: "system", text, maxBytes: 64 })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ContextBudgetError)
    expect((err as Error).message).toContain("probe.boundary")
    expect((err as Error).message).toContain("65 bytes")
    expect((err as Error).message).toContain("64 bytes")
    const ok = defineText({ id: "probe.boundary", sink: "system", text, maxBytes: 65 })
    expect(ok.text.length).toBe(65)
    expect(ok.bytes).toBe(65)
  })
  test("多字节:「中中」是 6 字节 2 字符 —— 上限 5 抛、上限 6 过(单位是字节不是字符)", () => {
    expect(contextBytes("中中")).toBe(6)
    expect(() => defineText({ id: "probe.cjk", sink: "system", text: "中中", maxBytes: 5 })).toThrow(ContextBudgetError)
    expect(defineText({ id: "probe.cjk", sink: "system", text: "中中", maxBytes: 6 }).bytes).toBe(6)
  })
  test("rebrand 只量 to(alpha 塞进去的字),from 是上游原文不计", () => {
    expect(() => defineRebrand({ id: "probe.rb", from: "x".repeat(500), to: "y".repeat(9), maxBytes: 8 })).toThrow(ContextBudgetError)
    expect(defineRebrand({ id: "probe.rb", from: "x".repeat(500), to: "y".repeat(8), maxBytes: 8 }).bytes).toBe(8)
  })
  test("模板:占位符必须恰好一个;渲染结果超限在渲染处抛(真登记项 + 超长技能名)", () => {
    expect(() => defineTemplate({ id: "probe.t0", sink: "command-template", template: "no placeholder", maxBytes: 64 })).toThrow(/exactly one/)
    expect(() => defineTemplate({ id: "probe.t2", sink: "command-template", template: "{name} and {name}", maxBytes: 64 })).toThrow(/exactly one/)
    const f = CONTEXT_INJECTIONS.find((x) => x.id === "command.factory-denied.template")
    expect(f?.kind).toBe("template")
    const cap = f && f.kind === "template" ? f.maxBytes : 0
    const ok = renderTemplate("command.factory-denied.template", { name: "customize-opencode" })
    expect(ok).toContain("customize-opencode")
    expect(() => renderTemplate("command.factory-denied.template", { name: "n".repeat(cap) })).toThrow(ContextBudgetError)
  })
  test("当前登记的每一条都在上限之内,且 id 唯一(模块能装载就已证明;这里把数字钉在断言里)", () => {
    const rows = inventory()
    expect(rows.length).toBeGreaterThanOrEqual(20)
    for (const r of rows) expect(r.bytes, r.id).toBeLessThanOrEqual(r.maxBytes)
    expect(new Set(CONTEXT_INJECTIONS.map((f) => f.id)).size).toBe(CONTEXT_INJECTIONS.length)
  })
})

// ── AC3:库存快照 ───────────────────────────────────────────────────────────────

describe("AC3 库存:一处列全,快照逐字节比对(codepuppy-check 第 [12/12] 步打印同一份)", () => {
  test("快照在位,且与 renderInventory() 逐字节相同 —— 改了任何片段就得重生快照并让评审读 diff", () => {
    expect(existsSync(SNAPSHOT), `快照缺失:${SNAPSHOT} —— 跑 bun packages/ext/scripts/context-injection-inventory.ts --write`).toBe(true)
    const expected = readFileSync(SNAPSHOT, "utf8")
    const actual = renderInventory()
    expect(actual, "库存与快照不一致 —— 跑 bun packages/ext/scripts/context-injection-inventory.ts --write 并把快照 diff 交给评审").toBe(expected)
  })
  test("快照列全了每一条登记项与每一条引用(不是摘要)", () => {
    const text = renderInventory()
    for (const f of CONTEXT_INJECTIONS) expect(text, f.id).toContain(f.id)
    for (const r of inventory()) expect(text).toContain(`${String(r.bytes).padStart(6)}  ${String(r.maxBytes).padStart(6)}`)
  })
})
