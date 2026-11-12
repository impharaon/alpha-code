// `#1667`(#1662 L5,清点表 S6 / S9):main 的两个自动化入口(定时任务执行 automation-scheduler.ts、一句话解析
// automation-llm.ts)在 v1 用 `session.prompt` —— 那是同步的:等整轮跑完,把最后一条助手消息带回来。
// OpenCode 2 拆成三步:`POST /api/session/:id/prompt` 只「收下输入并排进执行」(`packages/core/src/session/session.ts` 的
// prompt 在返回前 `execution.wake`);`POST /api/experimental/session/:id/wait` 等这一轮跑到空闲;回复从消息列表里读。
// 这一轮的结局在最新那条 `idle` 消息上(`succeeded` / `failed` / `interrupted`,失败带 `error`)。
// 前提:会话是调用方刚建的(两个入口都是),所以「最新的 idle / assistant」就是这一轮的。
import { parseFailureCode } from "@opencode/schema/codepuppy-net-failure"
import type { EngineClient } from "./engine-client"

type Content = { type: string; text?: string }
type Listed = { type: string; outcome?: string; error?: { message?: string }; content?: Content[] }

/** 发一条用户输入、等这一轮跑完,返回最后一条助手消息的文字;这一轮没有成功结束就抛(原因来自引擎)。 */
export async function promptAndWait(client: EngineClient, input: { sessionID: string; text: string }, signal?: AbortSignal): Promise<string> {
  await client.session.prompt({ sessionID: input.sessionID, text: input.text }, { signal })
  await client.experimental.session.wait({ sessionID: input.sessionID }, { signal })
  const page = await client.message.list({ sessionID: input.sessionID, order: "desc", limit: 50 }, { signal })
  const messages = (page as { data: Listed[] }).data
  const idle = messages.find((message) => message.type === "idle")
  const reason = idle?.error?.message ? (parseFailureCode(idle.error.message)?.text ?? idle.error.message) : undefined
  if (idle?.outcome !== "succeeded") throw new Error(`engine turn ${idle?.outcome ?? "did not finish"}${reason ? `: ${reason}` : ""}`)
  const reply = messages.find((message) => message.type === "assistant")
  return (reply?.content ?? [])
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n\n")
    .trim()
}
