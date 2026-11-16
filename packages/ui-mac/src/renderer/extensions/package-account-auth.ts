import type { createOpencodeClient } from "../../engine-adapter/contract/v1"
import { connectOutcome } from "./ext-session-toggle"

/** The existing SDK route owns OAuth, system-browser launch and the engine's token store. */
export async function authenticatePackageMcp(client: Pick<ReturnType<typeof createOpencodeClient>, "mcp"> | undefined, name: string) {
  if (!client) return { ok: false as const, reason: "no server" }
  try {
    const result = await client.mcp.auth.authenticate({ name })
    if (!connectOutcome(result)) return { ok: false as const, reason: "auth-failed" }
    const current = await client.mcp.status()
    return connectOutcome(current) && (current.data?.[name]?.status === "connected" || result.data?.status === "disabled")
      ? { ok: true as const }
      : { ok: false as const, reason: "auth-failed" }
  } catch {
    return { ok: false as const, reason: "auth-failed" }
  }
}
