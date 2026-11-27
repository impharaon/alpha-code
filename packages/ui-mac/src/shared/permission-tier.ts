export type PermMode = "allow" | "ask" | "readonly"

export const READONLY_AGENT = "codepuppy-readonly"
export const ASK_AGENT = "codepuppy-ask"
export const PERM_AGENT: Record<PermMode, string | null> = {
  allow: null,
  ask: ASK_AGENT,
  readonly: READONLY_AGENT,
}

/**
 * Session metadata key: the default agent a session was pinned to at its first prompt (#1776 S-11). ext writes it; the
 * engine adapter returns a session without an explicit agent to it, so a later default only leads new sessions.
 */
export const SESSION_DEFAULT_AGENT_KEY = "codepuppyDefaultAgent"

export function tierAgent(mode: PermMode): string | undefined {
  return PERM_AGENT[mode] ?? undefined
}
