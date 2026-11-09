// REQ-062 T3/T6 — alpha 内容层 set-if-absent 接管(优先级:用户治理 > alpha 出厂 > 上游内置)。

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  CODEPUPPY_DOCS_DESCRIPTION,
  CODEPUPPY_DOCS_PROMPT,
  CODEPUPPY_EXPLORE_PROMPT,
  CODEPUPPY_GENERAL_PROMPT,
  CODEPUPPY_INIT_TEMPLATE,
  CODEPUPPY_REVIEW_TEMPLATE,
  applyPromptTakeover,
} from "./codepuppy-prompts"

describe("alpha 模板内容纪律", () => {
  test("四份 alpha 文本零 opencode 痕迹(内容 100% alpha 承载)", () => {
    for (const t of [CODEPUPPY_INIT_TEMPLATE, CODEPUPPY_REVIEW_TEMPLATE, CODEPUPPY_GENERAL_PROMPT, CODEPUPPY_EXPLORE_PROMPT, CODEPUPPY_DOCS_PROMPT, CODEPUPPY_DOCS_DESCRIPTION]) {
      expect(/opencode/i.test(t)).toBe(false)
    }
  })
  test("init/review 模板保留 $ARGUMENTS 占位(引擎 hints 解析依赖)且不含 ${path}(config command 无此替换)", () => {
    for (const t of [CODEPUPPY_INIT_TEMPLATE, CODEPUPPY_REVIEW_TEMPLATE]) {
      expect(t.includes("$ARGUMENTS")).toBe(true)
      expect(t.includes("${path}")).toBe(false)
    }
  })
})

describe("applyPromptTakeover — set-if-absent", () => {
  test("空 config → 接管 init + review + general/explore prompt(用户拍板:两个命令都换)", () => {
    const cfg: Record<string, unknown> = {}
    const r = applyPromptTakeover(cfg)
    expect(r.applied.sort()).toEqual([
      "agent.docs.prompt",
      "agent.explore.prompt",
      "agent.general.prompt",
      "command.init",
      "command.review",
    ])
    expect((cfg.command as any).init.template).toBe(CODEPUPPY_INIT_TEMPLATE)
    expect((cfg.command as any).review.template).toBe(CODEPUPPY_REVIEW_TEMPLATE)
    expect((cfg.command as any).review.subtask).toBe(true) // 与上游内置行为对齐(子任务执行)
    expect((cfg.agent as any).general.prompt).toBe(CODEPUPPY_GENERAL_PROMPT)
    expect((cfg.agent as any).explore.prompt).toBe(CODEPUPPY_EXPLORE_PROMPT)
    expect((cfg.agent as any).docs.prompt).toBe(CODEPUPPY_DOCS_PROMPT)
    expect((cfg.agent as any).docs.description).toBe(CODEPUPPY_DOCS_DESCRIPTION)
  })
  test("用户已配同名 command.review → 让位(用户治理 > alpha 出厂)", () => {
    const cfg: Record<string, unknown> = { command: { review: { template: "user's own review" } } }
    const r = applyPromptTakeover(cfg)
    expect(r.applied).not.toContain("command.review")
    expect((cfg.command as any).review.template).toBe("user's own review")
  })
  test("用户已配同名 command.init(治理 override 经 codepuppy.jsonc 已在 cfg)→ 一概让位", () => {
    const cfg: Record<string, unknown> = { command: { init: { template: "user's own init" } } }
    const r = applyPromptTakeover(cfg)
    expect(r.applied).not.toContain("command.init")
    expect((cfg.command as any).init.template).toBe("user's own init")
  })
  test("用户已覆盖 agent prompt → 让位;只覆盖其它字段(model 等)→ 补 prompt 且保留用户字段", () => {
    const cfg: Record<string, unknown> = {
      agent: { general: { prompt: "user general" }, explore: { model: "anthropic/claude" } },
    }
    const r = applyPromptTakeover(cfg)
    expect((cfg.agent as any).general.prompt).toBe("user general")
    expect((cfg.agent as any).explore.prompt).toBe(CODEPUPPY_EXPLORE_PROMPT)
    expect((cfg.agent as any).explore.model).toBe("anthropic/claude")
    expect(r.applied).toEqual(["command.init", "command.review", "agent.explore.prompt", "agent.docs.prompt"]) // 无用户配置的照常接管
  })
  test("幂等:第二次调用 no-op", () => {
    const cfg: Record<string, unknown> = {}
    applyPromptTakeover(cfg)
    const r2 = applyPromptTakeover(cfg)
    expect(r2.applied).toEqual([])
  })
})

// ── `#1241`(REQ-154 T6)—— 文档类 agent ────────────────────────────────────────────
//
// 本票只承诺一个**结构事实**:文档任务不再跑基座提示词。它**不**承诺输出变长/变好
// (方案基线 docs/design/req-153-output-capability.md §6.1:该行为结果零 A/B 实测)。
//
// 那个结构事实由四条断言合起来成立,缺一条就变成一句自说自话(`#1665` 起读 OpenCode 2 的原文):
//   ① 上游 `session/model-request.ts` 仍然在 `agent.system` 与默认底座之间**二选一**,且按模型选底座的
//      `opencode.prompt.*` 插件(`plugin/optimize.ts`)在 agent 有自己的 system 时不动它 —— 这条是**读上游原文**,
//      不是我们手写一个它的替身(本仓最贵的返工形态);
//   ② 默认底座里那条简短要求仍然逐字节在(否则「不含特征串」测的是一个不存在的东西);
//   ③ `CODEPUPPY_DOCS_PROMPT` 一条特征串都不含;
//   ④ `applyPromptTakeover` 真的把它写进 `agent.docs.prompt`(ext 译成 2.x 的 `system`,非空 ⇒ ① 的左支成立)。
const REPO_ROOT = join(import.meta.dir, "../../..")
const readUpstream = (rel: string) => readFileSync(join(REPO_ROOT, "packages/core/src", rel), "utf8")

/** 2.x 默认底座(`session/runner/prompt/system.txt`)的简短要求。挑的是**不被 prompt-rebrand 改写**的句子
 *  (REBRAND_RULES 只动自指句),所以它在最终 system 段里也是逐字节的。 */
const DEFAULT_TXT_MARKERS = ["Keep responses clear and concise, and avoid unnecessary technical jargon."] as const

describe("#1241 drift 锁 —— 结论所依赖的上游事实今天仍然成立", () => {
  test("model-request.ts 仍在 agent.system 与默认底座之间二选一(基座整段不跑的机制)", () => {
    expect(readUpstream("session/model-request.ts")).toMatch(/input\.agent\.system\s*\?\s*input\.agent\.system\s*:\s*SessionSystemPrompt\.make\(/)
  })
  test("按模型选底座的插件在 agent 有自己的 system 时不改写它", () => {
    expect(readUpstream("plugin/optimize.ts").includes("if ((yield* ctx.agent.get({ agentID: event.agent })).data.system) return")).toBe(true)
  })
  for (const marker of DEFAULT_TXT_MARKERS) {
    test(`默认底座仍逐字节含:${marker.slice(0, 40)}…`, () => {
      expect(readUpstream("session/runner/prompt/system.txt").includes(marker)).toBe(true)
    })
  }
})

describe("#1241 docs agent —— 装配出的 system 段不含 default.txt 特征串", () => {
  test("prompt 本身一条特征串都不含", () => {
    for (const marker of DEFAULT_TXT_MARKERS) {
      expect(CODEPUPPY_DOCS_PROMPT.includes(marker), `docs prompt 里混进了基座特征串:${marker}`).toBe(false)
    }
  })
  test("接管真的落到 agent.docs.prompt 且非空(⇒ model-request.ts 走左支,底座整段不跑)", () => {
    const cfg: Record<string, unknown> = {}
    applyPromptTakeover(cfg)
    const docs = (cfg.agent as Record<string, Record<string, unknown>>).docs
    expect(typeof docs.prompt).toBe("string")
    expect((docs.prompt as string).trim().length).toBeGreaterThan(0)
    expect(docs.prompt).toBe(CODEPUPPY_DOCS_PROMPT)
  })
})

describe("#1241 安全边界 —— 只改 prompt(方案基线 §3.5)", () => {
  test("注入的 agent.docs 只有 prompt/description,绝无 permission / tools", () => {
    const cfg: Record<string, unknown> = {}
    applyPromptTakeover(cfg)
    const docs = (cfg.agent as Record<string, Record<string, unknown>>).docs
    expect(Object.keys(docs).sort()).toEqual(["description", "prompt"])
    // 逐条点名,而不是只比键集 —— 键集断言在有人加了别的键时仍会红,但读者看不出红的是什么。
    expect("permission" in docs).toBe(false)
    expect("tools" in docs).toBe(false)
  })
  test("prompt 正文不自称放宽了任何审批(不得用文案替代权限)", () => {
    const flat = CODEPUPPY_DOCS_PROMPT.toLowerCase()
    for (const forbidden of ["without asking", "no approval", "skip the permission", "auto-approve"]) {
      expect(flat.includes(forbidden), `docs prompt 里出现了放宽审批的措辞:${forbidden}`).toBe(false)
    }
  })
})

describe("#1241 内容要求 —— 票面点名的三块都在", () => {
  test("结构与深度 / 排版与视觉纪律 / 中文排版,各有其节", () => {
    for (const heading of [
      "## Depth and structure",
      "## Typography and visual discipline",
      "## When the document is in Chinese",
    ]) {
      expect(CODEPUPPY_DOCS_PROMPT.includes(heading), `docs prompt 少了这一节:${heading}`).toBe(true)
    }
  })
  test("逐条咽喉要求(折平软换行后比对,重排段落不假红)", () => {
    const flat = CODEPUPPY_DOCS_PROMPT.replace(/\s+/g, " ")
    for (const requirement of [
      "Length here follows the substance of the work, not a line budget",
      "Open with the answer, the decision, or the outcome",
      "One heading level for the main parts, at most one more beneath",
      "No emoji",
      "A table only when the rows share the same fields",
      "Full-width punctuation for the Chinese text itself",
      "One space between Chinese characters and adjacent Latin letters or digits",
      "State the real limits of the format instead of implying styling you did not apply",
    ]) {
      expect(flat, `docs prompt 少了这条要求:${requirement}`).toContain(requirement)
    }
  })
})

describe("#1241 set-if-absent —— 用户治理仍然优先", () => {
  test("用户已配 agent.docs.prompt → 让位,alpha 一个字节都不写", () => {
    const cfg: Record<string, unknown> = { agent: { docs: { prompt: "user's own docs agent" } } }
    const r = applyPromptTakeover(cfg)
    expect(r.applied).not.toContain("agent.docs.prompt")
    expect((cfg.agent as any).docs.prompt).toBe("user's own docs agent")
    expect((cfg.agent as any).docs.description).toBeUndefined()
  })
  test("用户只配了别的字段(model/description)→ 补 prompt,用户的 description 不被出厂值顶掉", () => {
    const cfg: Record<string, unknown> = { agent: { docs: { model: "alpha/x", description: "我自己的说明" } } }
    const r = applyPromptTakeover(cfg)
    expect(r.applied).toContain("agent.docs.prompt")
    expect((cfg.agent as any).docs.prompt).toBe(CODEPUPPY_DOCS_PROMPT)
    expect((cfg.agent as any).docs.model).toBe("alpha/x")
    expect((cfg.agent as any).docs.description).toBe("我自己的说明")
  })
  test("幂等:第二次调用不再写 docs", () => {
    const cfg: Record<string, unknown> = {}
    applyPromptTakeover(cfg)
    expect(applyPromptTakeover(cfg).applied).toEqual([])
  })
})
