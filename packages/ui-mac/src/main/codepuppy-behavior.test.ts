// `#1240`(REQ-154 T5)—— codepuppy-behavior 质量基线的**执行级**闸门。
//
// 本票只承诺一个**结构事实**:那段质量基线经生产注入链路落进 `instructions`,且落进去的字节
// **与当前用的是哪个模型无关**。它**不**承诺「输出会更长/更好」—— 方案基线
// (docs/design/req-153-output-capability.md §6.1)记着那条行为结果零 A/B 实测。
//
// 为什么「与模型无关」需要一条真判据,而不是一句注释:上游按模型 id 子串路由底座提示词(OpenCode 2:
// `packages/core/src/plugin/optimize.ts` 的 `opencode.prompt.*` 插件,不命中的落默认底座
// `session/runner/prompt/system.txt`;v1 时是 `session/system.ts:29-42`),于是「这条要求
// 到底覆盖了几个模型」是一个真会变的量。本文件跑**真的** `injectCodePuppyConfig`,用三个**分别
// 落在三份不同底座**上的模型 id 各跑一遍,断言写出的 `codepuppy-behavior.md` 逐字节相同 ——
// 任何按模型分叉的实现都会当场红。「这三个 id 真的落三份底座」不靠我记得:下面的 drift 锁
// 直接读上游的路由原文(同 `packages/ext/src/prompt-rebrand.test.ts` 的做法)。

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import { CODEPUPPY_BEHAVIOR_MD } from "./codepuppy-behavior"
import { injectCodePuppyConfig } from "./codepuppy-config-injection"

const MANAGED = [
  "CODEPUPPY_JSONC_TRUTH_DISABLE",
  "CODEPUPPY_LEGACY_INSTALL_ROOT",
  "CODEPUPPY_GLOBAL_DIR",
  "CODEPUPPY_OPENCODE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
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
  "CODEPUPPY_CLOUD_MCP_ARM",
  "CODEPUPPY_CLOUD_MCP_DEF",
  "CODEPUPPY_CLOUD_MCP_SERVER",
  "CODEPUPPY_BASE_URL",
  "CODEPUPPY_DEFAULT_MODEL",
  "OPENCODE_ENABLE_EXA",
  "OPENCODE_EXPERIMENTAL",
] as const

const saved: Record<string, string | undefined> = {}
let tmp = ""
let userData = ""

beforeEach(() => {
  for (const k of MANAGED) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-behavior-")))
  process.env.CODEPUPPY_GLOBAL_DIR = path.join(tmp, "codepuppy-state", "env", "dev")
  process.env.XDG_CONFIG_HOME = path.join(tmp, "xdg")
  process.env.CODEPUPPY_OPENCODE_HOME = path.join(tmp, "opencode-home")
  process.env.XDG_DATA_HOME = path.join(tmp, "xdg-data")
  userData = path.join(tmp, "userdata")
  for (const d of [
    process.env.CODEPUPPY_GLOBAL_DIR,
    process.env.XDG_CONFIG_HOME,
    process.env.CODEPUPPY_OPENCODE_HOME,
    process.env.XDG_DATA_HOME,
    userData,
  ])
    fs.mkdirSync(d, { recursive: true })
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

/** 跑一次生产注入,返回引擎会看到的 instructions 与真正落盘的 behavior 正文。 */
function inject(): { instructions: string[]; model: unknown; behaviorFile: string; behaviorBody: string | null } {
  const result = injectCodePuppyConfig(userData, undefined, "stable")
  expect(result.ok ? true : result.error).toBe(true)
  // `#1667`:注入产物不再进环境变量,引擎从结果的 `config.content` 拿(sidecar 放进 `start()` 的选项)。
  const config = JSON.parse(result.config.content) as { instructions?: string[]; model?: unknown }
  const behaviorFile = path.join(userData, "codepuppy-behavior.md")
  return {
    instructions: config.instructions ?? [],
    model: config.model,
    behaviorFile,
    behaviorBody: fs.existsSync(behaviorFile) ? fs.readFileSync(behaviorFile, "utf8") : null,
  }
}

// 三个模型 id,分别落在上游底座路由的三个不同分支(claude 追加 / gpt 替换 / 兜底默认)。
// 下面的 drift 锁证明这三条分支今天仍然存在 —— 否则「跨三份底座都成立」是一句空话。
const ROUTED_MODELS = [
  { model: "deepseek/deepseek-chat", route: "runner/prompt/system.txt(兜底)" },
  { model: "alpha/claude-sonnet-4-5", route: "system.txt + anthropic.txt" },
  { model: "alpha/gpt-5", route: "gpt.txt" },
] as const

describe("drift 锁 —— 上游按模型 id 分叉底座这件事仍然成立", () => {
  // 读的是上游路由的**文本**,登记为减速带(source-text-anchors.ts):它只证明三条分支的原文还在,证不了它们真的生效。
  test("ANCHOR (not a gate): 上游底座路由原文仍按 claude / gpt / 兜底分三支", () => {
    const coreSrc = path.join(import.meta.dir, "../../../core/src")
    const optimize = fs.readFileSync(path.join(coreSrc, "plugin/optimize.ts"), "utf8")
    const systemPrompt = fs.readFileSync(path.join(coreSrc, "session/system-prompt.ts"), "utf8")
    expect([
      optimize.includes('if (!id.includes("claude")) return undefined'),
      optimize.includes('if (!id.includes("gpt")) return undefined'),
      systemPrompt.includes('import PROMPT from "./runner/prompt/system.txt"'),
    ]).toEqual([true, true, true])
  })
})

describe("codepuppy-behavior 质量基线 —— 注入链路(#1240)", () => {
  test("基线段的每个咽喉小节都在正文里(删一节即红)", () => {
    for (const section of ["## Shape of a substantial deliverable", "## Tables, lists, prose", "## Chinese typography"]) {
      expect(CODEPUPPY_BEHAVIOR_MD.includes(section)).toBe(true)
    }
    // 逐条要求的咽喉句。断言前先把软换行折平 —— 否则重排一次段落就假红,
    // 而假红门会被训练成「忽略它」(本仓 `#754` 的形态)。
    const flat = CODEPUPPY_BEHAVIOR_MD.replace(/\s+/g, " ")
    for (const requirement of [
      "Lead with the conclusion or the outcome, then the evidence",
      "one heading level for the main parts, at most one more beneath",
      "A table when every row carries the same fields",
      "A list when the items are peers, and there are at least three of them",
      "Use full-width punctuation",
      "Half-width digits, and a space between a number and its unit",
      "Do not claim a typeface you did not set",
    ]) {
      expect(flat, `质量基线少了这条要求:${requirement}`).toContain(requirement)
    }
  })

  test("additive-only:基线段不试图撤销基座里的压制指令(ADR-015 no hard overrides)", () => {
    // 一个 instruction 文件在 `request.ts:62-70` 是**追加**进同一个串的,删不掉任何东西。
    // 写「忽略上面那条」只会制造自相矛盾的 system 段,故明令不得出现祈使式撤销。
    for (const forbidden of ["ignore the", "disregard the", "override the base", "do not follow the base"]) {
      expect(CODEPUPPY_BEHAVIOR_MD.toLowerCase().includes(forbidden)).toBe(false)
    }
  })

  test("生产注入:behavior 文件真落盘、真进 instructions,且正文 = CODEPUPPY_BEHAVIOR_MD", () => {
    process.env.CODEPUPPY_DEFAULT_MODEL = ROUTED_MODELS[0].model
    const r = inject()
    expect(r.behaviorBody).toBe(CODEPUPPY_BEHAVIOR_MD)
    expect(r.instructions).toContain(r.behaviorFile)
  })

  test("与模型无关:三份不同底座路由下,落盘的 behavior 正文逐字节相同", () => {
    const bodies: string[] = []
    const models: unknown[] = []
    for (const { model } of ROUTED_MODELS) {
      // 每一轮换一份 userData,确保读到的是**这一轮**写出来的文件,而不是上一轮的残留。
      userData = fs.mkdtempSync(path.join(tmp, "ud-"))
      delete process.env.OPENCODE_CONFIG_CONTENT
      process.env.CODEPUPPY_DEFAULT_MODEL = model
      const r = inject()
      expect(r.instructions, `${model} 的 instructions 少了 behavior 文件`).toContain(r.behaviorFile)
      bodies.push(r.behaviorBody!)
      models.push(r.model)
    }
    // 先证明这三轮**确实换了模型**(否则「三轮相同」是同义反复)。
    expect(models).toEqual(ROUTED_MODELS.map((m) => m.model))
    expect(new Set(bodies).size).toBe(1)
    expect(bodies[0]).toBe(CODEPUPPY_BEHAVIOR_MD)
  })

  test("逃生门仍然真:CODEPUPPY_BEHAVIOR_DISABLE=1 → 文件不写、不进 instructions", () => {
    process.env.CODEPUPPY_BEHAVIOR_DISABLE = "1"
    const r = inject()
    expect(r.behaviorBody).toBeNull()
    expect(r.instructions).not.toContain(r.behaviorFile)
    // 反证:identity 那份仍在 —— 说明红的不是「整个 instructions 通路没跑」。
    expect(r.instructions.some((f) => f.endsWith("codepuppy-identity.md"))).toBe(true)
  })
})
