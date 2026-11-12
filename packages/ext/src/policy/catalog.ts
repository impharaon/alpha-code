// Code Puppy catalog gate on OpenCode 2 (#725 group A, baseline S1 / ruling F6): the model never sees a tool the
// policy denies — neither as a direct tool nor inside the Code Mode catalog. Replaces the v1 identity hard-deny in
// permission/index.ts (`disabled()`) and the code-mode.ts / registry.ts takeovers.
//
// Mechanism (F6, first of the two options): deny rules injected into the ruleset OpenCode builds the tool snapshot
// from. `Tool.snapshot(permissions)` drops every tool whose whole-tool permission action is denied before splitting
// direct and Code Mode tools (packages/core/src/tool.ts `whollyDisabled`), and `SessionContext.select` passes the
// agent's rules merged with the session's (packages/core/src/session/context.ts). So Code Puppy appends, per agent:
//   · `{ action: <tool permission>, resource: "*", effect: "deny" }` for each policy-denied tool (catalog, Code Mode);
//   · `{ action: <canonical>, resource: "*", effect: "deny" }` and, for a document-axis ask the agent's
//     `tool-policy-default` does not waive, `{ action: <canonical>, resource: "*", effect: "ask" }` — the rules the
//     identity-axis `permission.assert` is judged by (gate.ts).
// The rules must come after every configured rule (OpenCode appends config `permissions` in an internal plugin that
// activates after configured plugins, packages/core/src/config/plugin/agent.ts), so the transform is registered once
// plugin activation has settled (`ensureTail`), which also puts it after the extension's own transforms.
// `session.hook.context` is the second layer for the request in flight: it removes denied direct tools, and while the
// tail rules are not in place yet it removes the Code Mode runner for that request (fail-closed).
import { canonicalToolIdentity } from "../../../schema/src/tool-identity"
import type { PermissionRule } from "./managed"
import { effectiveFor, evaluate } from "./gate"
import { CODE_MODE_TOOL, type ToolFacts } from "./identity"
import type { ToolPolicySnapshot } from "./resolver"

/** I9: the tier pseudo-action the injected tier-carrier agents carry (`codepuppy-config-injection.ts`, L5). */
export const TOOL_POLICY_DEFAULT = "tool-policy-default"

/** Rules Code Puppy appends to one agent's configured rules. */
export function catalogRules(
  configured: readonly PermissionRule[],
  tools: readonly ToolFacts[],
  snapshot: ToolPolicySnapshot,
): PermissionRule[] {
  const rules: PermissionRule[] = []
  const tierAllows = evaluate(TOOL_POLICY_DEFAULT, "*", configured).effect === "allow"
  for (const facts of tools) {
    let canonical: string
    try {
      canonical = canonicalToolIdentity(facts.identity)
    } catch {
      rules.push({ action: facts.permission, resource: "*", effect: "deny" })
      continue
    }
    const effective = effectiveFor(facts, snapshot, configured)
    if (effective.action === "deny") {
      rules.push({ action: facts.permission, resource: "*", effect: "deny" })
      rules.push({ action: canonical, resource: "*", effect: "deny" })
      continue
    }
    if (effective.action === "ask" && !(effective.reason.kind === "default" && tierAllows))
      rules.push({ action: canonical, resource: "*", effect: "ask" })
  }
  return rules
}

export interface CatalogDeps {
  /** Facts for every registered tool (current registry). */
  readonly tools: () => Promise<readonly ToolFacts[]>
  readonly snapshot: () => Promise<ToolPolicySnapshot>
  /** Registers an agent transform on the plugin scope. */
  readonly transform: (callback: (editor: AgentEditor) => void) => Promise<unknown>
  readonly reload: () => Promise<void>
  readonly log: (message: string, extra?: Record<string, unknown>) => void
}

export interface AgentEditor {
  list(): readonly { id: string; permissions: PermissionRule[] }[]
  update(id: string, update: (agent: { permissions: PermissionRule[] }) => void): void
}

export function createCatalog(deps: CatalogDeps) {
  /** Each agent's configured rules as the tail transform last saw them (before Code Puppy's own). */
  const configured = new Map<string, readonly PermissionRule[]>()
  let tools: readonly ToolFacts[] = []
  let snapshot: ToolPolicySnapshot | undefined
  let tail: "none" | "pending" | "active" = "none"
  let signature = ""

  const apply = (editor: AgentEditor) => {
    for (const agent of editor.list()) {
      configured.set(agent.id, [...agent.permissions])
      if (!snapshot) continue
      const extra = catalogRules(agent.permissions, tools, snapshot)
      if (extra.length > 0) editor.update(agent.id, (draft) => draft.permissions.push(...extra))
    }
  }

  /** Recomputes the inputs; reloads agents when they changed so the next snapshot carries the new rules. */
  const refresh = async () => {
    const [nextTools, nextSnapshot] = await Promise.all([deps.tools(), deps.snapshot()])
    const nextSignature = JSON.stringify([nextSnapshot.revision, nextSnapshot.managed, nextTools.map((t) => [t.technicalId, t.permission, t.identity, t.authority, t.bindingDigest])])
    tools = nextTools
    snapshot = nextSnapshot
    if (nextSignature === signature) return false
    signature = nextSignature
    if (tail === "active") await deps.reload()
    return true
  }

  /**
   * Registers the tail transform; callers run after plugin activation (prompt and context hooks), so it lands after
   * every configured rule. Returns true when this call registered it.
   */
  const ensureTail = async () => {
    if (tail !== "none") return false
    tail = "pending"
    await refresh()
    await deps.transform(apply)
    tail = "active"
    deps.log("tool policy catalog rules active")
    return true
  }

  return {
    refresh,
    ensureTail,
    tailActive: () => tail === "active",
    /** The agent's rules before Code Puppy's; undefined until the tail transform has seen the agent. */
    configured: (agent: string) => configured.get(agent),
    /** `session.hook.context` body. */
    async prune(event: { tools: Record<string, unknown> }, denied: (name: string) => Promise<boolean>) {
      const registeredNow = await ensureTail()
      // Tools registered after the first prompt (an MCP server that connected later) get their rules now (review R1 #1).
      if (!registeredNow) await refresh()
      for (const name of Object.keys(event.tools)) {
        if (name === CODE_MODE_TOOL) continue
        if (await denied(name)) delete event.tools[name]
      }
      if ((registeredNow || tail !== "active") && CODE_MODE_TOOL in event.tools) delete event.tools[CODE_MODE_TOOL]
    },
  }
}
