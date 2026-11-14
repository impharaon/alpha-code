import { Option, Schema } from "effect"
import { UNATTENDED_DENIAL_KEY, UnattendedDenial, unattendedDenialCopy, type UnattendedProfile } from "@opencode/schema/codepuppy-unattended"
import type { EngineClient } from "./engine-client"
import { getLogger } from "./logging"

type Messages = Awaited<ReturnType<EngineClient["message"]["list"]>>["data"]

export function firstAutomationDenial(messages: Messages, profile: UnattendedProfile): string | undefined {
  const calls = messages.flatMap((message) => message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [])
    .toSorted((a, b) => a.time.created - b.time.created)
  for (const part of calls) {
    if (part.state.status !== "completed" && part.state.status !== "error") continue
    const denial = Schema.decodeUnknownOption(UnattendedDenial)(part.state.metadata?.[UNATTENDED_DENIAL_KEY])
    if (Option.isSome(denial)) return denial.value.message
    if (part.state.status === "error" && part.state.error.type === "permission.rejected")
      return unattendedDenialCopy(profile === "readonly" ? "readonly" : "refused", part.name)
  }
}

/** 本次会话为运行新建;全量读消息,不受最终回复的 50 条窗口影响。 */
export async function readAutomationDenial(client: EngineClient, sessionID: string, profile: UnattendedProfile) {
  try {
    const messages: Messages = []
    let cursor: string | undefined
    do {
      const page = await client.message.list({ sessionID, limit: 200, ...(cursor ? { cursor } : { order: "asc" as const }) })
      messages.push(...page.data)
      cursor = page.cursor?.next ?? undefined
    } while (cursor)
    return firstAutomationDenial(messages, profile)
  } catch (error) {
    getLogger().warn("automation: denial projection unavailable", { sessionID, error: String(error) })
  }
}
