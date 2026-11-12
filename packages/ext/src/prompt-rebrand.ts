// prompt-rebrand — REQ-062 路线A(T1):系统提示词品牌转写(ADR-015 2026-07-08 修订)。
//
// 机制(`#1665` 起,OpenCode 2):上游按模型选底座提示词的是 internal.pre 里的 `opencode.prompt.*` 插件
// (`packages/core/src/plugin/optimize.ts`),它们在 `session.hook.context` 里把底座推进 `system`;ext 的同名钩子注册在
// 它们之后,拿到的 `system` 是**逐段**的(底座、环境、用户 instructions 各自一段)。仍然绝不做全局词替换(会篡改用户
// 自己的文本 = 对模型撒谎),只做**精选子串对**转写(ADR-007 brand-i18n 同款纪律):每条 from 都是上游底座 .txt 的逐字节
// 原文,用户文本撞上的概率趋零;上游改版导致 from 失配 = 该句不再出现 → 由 residual 审计 warn 兜底(不静默)。
//
// 纪律(REQ-062):
//   - 真实事物名不转:opencode.json(c) / .opencode 路径 / @opencode 包名 / CLI 等实体引用
//     (本模块只按整句替换,天然不触及);
//   - 漏改 warn:转写后残留「You are opencode」行首句 / anomalyco 仓指引 / opencode.ai 文档域 →
//     报 warning(每进程每签名一次,防每条消息刷屏);用户 instructions 里的合法提及也会触发
//     (如 alpha-code 仓自身),warning 是诚实提示而非错误;
//   - 逃生 CODEPUPPY_PROMPT_REBRAND_DISABLE=1(hook 侧判,本模块纯函数);
//   - 底座改版复核:tests 逐条断言 from 子串仍存在于上游 .txt(sync 后红 = 清单需复核,
//     与 ADR-015 合并验证 / sync tripwire 呼应)。`#1665` 按 2.x 的六份底座重新清点:v1 的 anthropic / beast / gemini /
//     copilot 自指句、help/feedback 块、产品问答指引、anthropic 客观性段在 2.x 底座里都已不存在(anthropic.txt 不再自指),
//     这些规则随之删除;新增 gpt / gpt-astra 与 meta 的自指句。

export const REBRAND_TO = "Code Puppy"

export type RebrandRule = {
  id: string
  /** 上游底座逐字节原文(tests 断言仍在;失配 = 上游改版,该条静默不再命中 → residual 审计接手)。 */
  from: string
  to: string
  /** 断言 from 存在的上游文件(相对 packages/core/src/),供 drift 锁测。 */
  file: string
}

export const REBRAND_RULES: readonly RebrandRule[] = [
  // ── 自指首句(2.x 的默认底座 + 六份按模型选的底座里自指的五份;anthropic.txt 不自指)──────
  {
    id: "identity-gpt",
    from: "You are an AI agent running in OpenCode, a coding agent harness.",
    to: "You are an AI agent running in Code Puppy, a coding agent harness.",
    file: "plugin/system-prompt/gpt.txt",
  },
  {
    // 没有按模型选中任何底座时的默认底座(`packages/core/src/session/model-request.ts` → SessionSystemPrompt.make)。
    id: "identity-default",
    from: "You are an AI agent running in OpenCode, a coding agent harness.",
    to: "You are an AI agent running in Code Puppy, a coding agent harness.",
    file: "session/runner/prompt/system.txt",
  },
  {
    id: "identity-gpt-astra",
    from: "You are an AI agent running in OpenCode, a coding agent harness.",
    to: "You are an AI agent running in Code Puppy, a coding agent harness.",
    file: "plugin/system-prompt/gpt-astra.txt",
  },
  {
    id: "identity-trinity",
    from: "You are opencode, an interactive CLI tool that helps users with software engineering tasks.",
    to: "You are Code Puppy, an interactive coding agent that helps users with software engineering tasks.",
    file: "plugin/system-prompt/trinity.txt",
  },
  {
    id: "identity-kimi",
    from: "You are OpenCode, an interactive general AI agent running on a user's computer.",
    to: "You are Code Puppy, an interactive general AI agent running on a user's computer.",
    file: "plugin/system-prompt/kimi.txt",
  },
  {
    id: "identity-meta",
    from: "You are OpenCode, a coding agent that helps users with software engineering tasks.",
    to: "You are Code Puppy, a coding agent that helps users with software engineering tasks.",
    file: "plugin/system-prompt/meta.txt",
  },
  {
    id: "tool-use-meta",
    from: "# Tool Use - OpenCode Specifics",
    to: "# Tool Use - Code Puppy Specifics",
    file: "plugin/system-prompt/meta.txt",
  },
] as const

/** 转写后残留审计:仍像「上游自指/指引」的形态 → warning(上游改版清单失配,或用户文本合法提及)。 */
const RESIDUAL_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "identity-line", re: /^you are opencode\b/im },
  { id: "name-line", re: /^your name is opencode\b/im },
  { id: "upstream-repo", re: /github\.com\/anomalyco\/opencode/i },
  { id: "upstream-docs", re: /https?:\/\/opencode\.ai/i },
  { id: "harness-line", re: /\brunning in opencode\b/i },
]

export type RebrandResult = { system: string[]; changed: boolean; warnings: string[] }

/** 纯函数:对 system 段做精选子串转写 + 残留审计。不修改入参。 */
export function rebrandSystem(system: readonly string[]): RebrandResult {
  const out: string[] = []
  const warnings: string[] = []
  let changed = false
  for (const seg of system) {
    let t = seg
    for (const rule of REBRAND_RULES) {
      if (t.includes(rule.from)) t = t.split(rule.from).join(rule.to)
    }
    if (t !== seg) changed = true
    for (const p of RESIDUAL_PATTERNS) {
      if (p.re.test(t)) warnings.push(`residual ${p.id} after rebrand — upstream base drifted or user text mentions it (curated list may need review)`)
    }
    out.push(t)
  }
  return { system: out, changed, warnings }
}
