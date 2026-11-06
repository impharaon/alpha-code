import { createSignal } from "solid-js"

// #1652: user message ids identify turns across engine/page restarts; retain only the latest 128.
const USER_STOPS_KEY = "codepuppy-user-stopped-turns-v1"
const [stopRevision, setStopRevision] = createSignal(0)
function stoppedTurns(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(USER_STOPS_KEY) ?? "[]")
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(-128) : []
  } catch {
    return []
  }
}
function writeStoppedTurns(ids: string[]) {
  try {
    localStorage.setItem(USER_STOPS_KEY, JSON.stringify(ids.slice(-128)))
    setStopRevision((value) => value + 1)
  } catch { /* Storage unavailable: keep the interruption unattributed. */ }
}
export function userStoppedTurn(userMessageID: string): boolean {
  void stopRevision()
  return stoppedTurns().includes(userMessageID)
}
export async function abortUserTurn(
  messages: readonly { role: string; id?: string; parentID?: string; time?: { created?: number; completed?: number } }[] | undefined,
  abort: () => Promise<unknown>,
): Promise<unknown> {
  const active = messages?.findLast((message) => message.role === "assistant" && message.time?.completed === undefined)
  const id = active?.parentID ?? messages?.findLast((message) => message.role === "user")?.id
  if (id) writeStoppedTurns([...stoppedTurns().filter((item) => item !== id), id])
  try {
    const result = await abort()
    if ((result as { error?: unknown } | undefined)?.error !== undefined) throw new Error("abort rejected")
    return result
  } catch (error) {
    if (id) writeStoppedTurns(stoppedTurns().filter((item) => item !== id))
    throw error
  }
}
