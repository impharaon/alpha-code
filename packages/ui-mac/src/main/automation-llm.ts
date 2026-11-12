// REQ-024(A2)—— LLM 辅助解析:一句话 → {name, schedule, prompt}。只在确定性规则
// (shared/automation-nl.ts)解析不出时由用户显式点击触发(省 token);临时会话一次抽取后即删,
// 不污染会话列表。执行链只走 SDK(ADR-002);预览确认流不变 —— LLM 产物只是填表,存前仍过
// 存储层硬校验(interval 下限/档位白名单)。
import { engineClient } from "./engine-client"
import { promptAndWait } from "./engine-session-turn"
import type { AutomationParseErrorCode, AutomationSchedule } from "../shared/automation-types"
import type { AutomationServerInfo } from "./automation-scheduler"
import { getLogger } from "./logging"
import { moderationBlocks, MODERATION_BLOCKED_REASON } from "./moderation-keywords"

let awaitServer: (() => Promise<AutomationServerInfo>) | null = null
export function initAutomationLlm(deps: { awaitServer: () => Promise<AutomationServerInfo> }): void {
  awaitServer = deps.awaitServer
}

// [#1592] 失败只给界面结构码(三类:没识别出周期 / AI 不可用 / 未通过安全审核);`reason` 是日志串,不上屏。
export type LlmParseResult =
  | { ok: true; name: string; schedule: AutomationSchedule; prompt: string }
  | { ok: false; code: AutomationParseErrorCode; reason: string }

const noSchedule = (reason: string): LlmParseResult => ({ ok: false, code: "automation-parse-no-schedule", reason })
const unavailable = (reason: string): LlmParseResult => ({ ok: false, code: "automation-parse-unavailable", reason })

const EXTRACT_INSTRUCTION = `你是一个定时任务解析器。把用户的一句话拆成 JSON(只输出 JSON,不要任何其它文字/代码块围栏):
{"name":"<8字内任务名>","schedule":{"kind":"cron","expr":"<5字段 cron(分 时 日 月 周)>"} 或 {"kind":"interval","everyMinutes":<数字,≥5>},"prompt":"<给执行 agent 的任务指令,保留用户意图,不含时间信息>"}
规则:能用 cron 表达就用 cron;模糊时间取合理值(如「饭点前」= 11:30);解析不出周期就输出 {"error":"<一句原因>"}。
用户输入:`

function sane(parsed: unknown): parsed is { name: string; schedule: AutomationSchedule; prompt: string } {
  const p = parsed as Record<string, unknown>
  if (!p || typeof p.name !== "string" || typeof p.prompt !== "string" || !p.name.trim() || !p.prompt.trim()) return false
  const sc = p.schedule as Record<string, unknown> | undefined
  if (!sc) return false
  if (sc.kind === "cron") return typeof sc.expr === "string" && sc.expr.trim().split(/\s+/).length === 5
  if (sc.kind === "interval") return typeof sc.everyMinutes === "number" && sc.everyMinutes >= 5
  return false
}

export async function llmParseAutomation(text: string, projectDir: string): Promise<LlmParseResult> {
  if (!text.trim()) return noSchedule("输入为空")
  // REQ-160 AC2(`#1353`):这句话也要发给模型(`EXTRACT_INSTRUCTION + text`),所以在本机
  // 查一遍。失败形态用这里既有的那个 —— `{ ok:false, code, reason }`,**不新增界面**。
  if (moderationBlocks(text)) return { ok: false, code: "automation-parse-blocked", reason: MODERATION_BLOCKED_REASON }
  if (!awaitServer) return unavailable("引擎未就绪")
  const server = await awaitServer()
  // `#1667`(清点表 S6 / S9):OpenCode 2 的客户端;口令由 engineClient 补成 Basic 头(I8:只在 main 里)。
  const client = engineClient(server)
  let sessionID: string | undefined
  try {
    try {
      sessionID = (await client.session.create({ location: { directory: projectDir }, title: "⏱ 自动化解析(临时)" })).id
    } catch {
      return unavailable("临时会话创建失败")
    }
    let reply: string
    try {
      reply = await promptAndWait(client, { sessionID, text: EXTRACT_INSTRUCTION + text })
    } catch {
      return unavailable("模型调用失败")
    }
    // 容错:剥代码围栏 / 取首个 {...} 块
    const m = reply.match(/\{[\s\S]*\}/)
    if (!m) return noSchedule("模型未返回可解析的 JSON")
    let parsed: unknown
    try {
      parsed = JSON.parse(m[0])
    } catch {
      return noSchedule("模型返回的 JSON 无法解析")
    }
    const err = (parsed as { error?: unknown }).error
    if (typeof err === "string") return noSchedule(err)
    if (!sane(parsed)) return noSchedule("模型返回的结构不合法(缺 name/schedule/prompt 或周期过密)")
    return { ok: true, name: parsed.name.trim().slice(0, 32), schedule: parsed.schedule, prompt: parsed.prompt.trim() }
  } catch (error) {
    return unavailable(error instanceof Error ? error.message.slice(0, 200) : "解析失败")
  } finally {
    // 临时会话即删(best-effort;失败只留一条日志,不影响结果)
    if (sessionID) {
      const id = sessionID
      const del = () => client.session.remove({ sessionID: id })
      try {
        await del()
      } catch {
        // codex L:一次重试;仍失败留 loud 日志(残留会话含用户自动化文本,可手动删)
        await new Promise((r) => setTimeout(r, 1500))
        try {
          await del()
        } catch {
          getLogger().warn("automation-llm: temp session delete failed twice — manual cleanup may be needed", sessionID)
        }
      }
    }
  }
}
