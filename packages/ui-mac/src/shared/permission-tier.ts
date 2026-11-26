export type PermMode = "allow" | "ask" | "readonly"

export const READONLY_AGENT = "codepuppy-readonly"
export const ASK_AGENT = "codepuppy-ask"
export const PERM_AGENT: Record<PermMode, string | null> = {
  allow: null,
  ask: ASK_AGENT,
  readonly: READONLY_AGENT,
}

export function tierAgent(mode: PermMode): string | undefined {
  return PERM_AGENT[mode] ?? undefined
}
