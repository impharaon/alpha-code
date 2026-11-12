// Code Puppy execution gate on OpenCode 2 (#725 group B, baseline S1): every tool call passes Code Puppy's decision in
// `tool.hook["execute.before"]`, the only path to `Tool.execute` (packages/core/src/tool.ts `beforeExecute`).
// Replaces the v1 takeovers of session/tools.ts and the policy gate in permission/codepuppy-tool-policy-gate.ts.
//
// Two axes, three outcomes (#724 §4: deny is a ceiling, ask is a pending decision):
//   · ruleset axis — agent + session permission rules. A deny on the exact canonical identity folds into the cap
//     (`hardDeny: ["permission-ruleset"]`); its ask/allow stays with OpenCode's own permission engine.
//   · document axis — `resolveToolPolicy`: caps → user selector → class default.
//   deny  ⇒ a named `Tool.Error` (canonical + reason) before any later hook or side effect.
//   ask   ⇒ one identity-axis request through `permission.assert` (the I7a envelope). The document-axis ask is a rule
//           Code Puppy places after every configured rule (catalog.ts), so OpenCode's saved "always" approvals for the
//           same binding + revision still discharge it, exactly as v1's appended ask rule did.
//   allow ⇒ no identity prompt; the ruleset axis and the tool's own ability checks stay as they are.
//
// Two positions (lane seams I3): `decide` runs first in the chain (`registerPolicy`), so a denied call reaches no other
// hook; `confirm` runs at `seal()`, after the extension's hooks and the project plugin fan-out, asks with the input the
// implementation will receive, re-decides after the answer, and then pins `tool` and `input` so any later rewrite
// rejects the call (S1, option 2: plugins activated after the extension cannot be ordered behind it).
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { canonicalToolIdentity } from "../../../schema/src/tool-identity"
import { match } from "../../../core/src/util/wildcard"
import type { PermissionRule } from "./managed"
import { resolveToolPolicy, subjectBindingDigest, type EffectiveToolPolicy, type ToolPolicyStore } from "./resolver"
import type { ToolFacts } from "./identity"
import { classifyPermissionRequest, withRiskClassification } from "./risk"
import { displaySnapshot } from "./display"

/** Source name a ruleset-axis deny folds into the cap under (shown in Settings reasons). */
export const RULESET_HARD_DENY_SOURCE = "permission-ruleset"

/**
 * OpenCode 2 `Permission.evaluate` (packages/core/src/permission.ts), restated: that module imports the engine's bus,
 * agents, session store and plugin hooks, so it is not a pure leaf the extension can import the way it imports
 * `util/wildcard`. identity.test.ts compares the two case by case.
 */
export function evaluate(action: string, resource: string, ...rulesets: (readonly PermissionRule[])[]): PermissionRule {
  return (
    rulesets.flat().findLast((rule) => match(action, rule.action) && match(resource, rule.resource)) ?? {
      action,
      resource: "*",
      effect: "ask",
    }
  )
}

/** Ruleset-axis verdict on one canonical identity (identity-axis rules are written with resource `*`). */
export function rulesetIdentityEffect(canonical: string, ruleset: readonly PermissionRule[]) {
  return evaluate(canonical, "*", ruleset).effect
}

export function effectiveFor(
  facts: ToolFacts,
  snapshot: Awaited<ReturnType<ToolPolicyStore["snapshot"]>>,
  ruleset: readonly PermissionRule[],
): EffectiveToolPolicy {
  let hardDeny: string[] = []
  try {
    if (rulesetIdentityEffect(canonicalToolIdentity(facts.identity), ruleset) === "deny") hardDeny = [RULESET_HARD_DENY_SOURCE]
  } catch {
    // No canonical identity ⇒ the resolver itself disables the tool as invalid-identity.
  }
  return resolveToolPolicy({
    subject: { identity: facts.identity, authority: facts.authority, bindingDigest: facts.bindingDigest },
    caps: { managed: snapshot.managed, hardDeny },
    user: snapshot.user,
  })
}

function describe(facts: ToolFacts | undefined, tool: string) {
  if (!facts) return tool
  try {
    return canonicalToolIdentity(facts.identity)
  } catch {
    return `${facts.identity.source}:${facts.identity.origin}:${facts.identity.name}`
  }
}

/** A named, loud refusal: the user and the model read the same sentence. */
export function namedDeny(tool: string, facts: ToolFacts | undefined, reason: string, detail?: string) {
  return new ToolError({
    message: `Code Puppy tool policy denied ${describe(facts, tool)} (${reason})${detail ? `: ${detail}` : ""}`,
    ...(facts ? { metadata: { codepuppyDisplay: displaySnapshot(facts) } } : {}),
  })
}

export interface GateCall {
  readonly tool: string
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly input: unknown
}

export interface GateDeps {
  readonly store: ToolPolicyStore
  /** Identity facts for the effective tool name, from the current registry; undefined = unknown identity. */
  readonly facts: (tool: string) => Promise<ToolFacts | undefined>
  /** Configured rules for this call: the agent's rules before Code Puppy's own, then the session's. */
  readonly ruleset: (sessionID: string, agent: string) => Promise<readonly PermissionRule[]>
  readonly directory: () => string
  readonly assert: (input: {
    sessionID: string
    agent: string
    action: string
    resources: string[]
    save: string[]
    metadata: Record<string, unknown>
    source: { type: "tool"; messageID: string; id: string }
  }) => Promise<void>
}

export interface GateDecision {
  readonly facts: ToolFacts
  readonly effective: EffectiveToolPolicy
  readonly revision: string
  readonly ruleset: readonly PermissionRule[]
}

/** Head of the chain: re-read the document and the current binding on every call; deny before anything else runs. */
export async function decide(deps: GateDeps, call: Pick<GateCall, "tool" | "sessionID" | "agent">): Promise<GateDecision> {
  const facts = await deps.facts(call.tool)
  if (!facts) throw namedDeny(call.tool, undefined, "unknown-tool-identity")
  const [snapshot, ruleset] = await Promise.all([deps.store.snapshot(), deps.ruleset(call.sessionID, call.agent)])
  const effective = effectiveFor(facts, snapshot, ruleset)
  if (effective.action === "deny") throw namedDeny(call.tool, facts, effective.reason.kind)
  return { facts, effective, revision: snapshot.revision, ruleset }
}

/**
 * Tail of the chain: ask when needed with the input the implementation will receive, then decide again. Disabled
 * while the request waited ⇒ named deny; the binding changed (rebind, endpoint switch) ⇒ named deny, retry.
 */
export async function confirm(deps: GateDeps, decision: GateDecision, call: GateCall): Promise<void> {
  const { facts } = decision
  const canonical = canonicalToolIdentity(facts.identity)
  const bindingDigest = subjectBindingDigest({ identity: facts.identity, authority: facts.authority, bindingDigest: facts.bindingDigest })
  const askedBy = rulesetIdentityEffect(canonical, decision.ruleset) === "ask" ? "ruleset" : "policy"
  const patterns = askedBy === "ruleset" ? [`call:${call.id}`] : [`${bindingDigest ?? "binding:unknown"}@${decision.revision}`]
  const metadata: Record<string, unknown> = {
    identity: facts.identity,
    authority: facts.authority,
    ...(facts.transport ? { transport: facts.transport } : {}),
    ...(facts.location && facts.identity.source === "mcp" ? { location: facts.location } : {}),
    ...(call.input !== undefined ? { args: call.input } : {}),
    // No digest (plugin and builtin tools) ⇒ no key: the engine lists pending requests over HTTP, and its encoder rejects
    // `undefined` at any depth, so the approval surface would never see this request.
    policy: { directory: deps.directory(), canonical, ...(bindingDigest ? { bindingDigest } : {}), askedBy },
  }
  await deps.assert({
    sessionID: call.sessionID,
    agent: call.agent,
    action: canonical,
    resources: patterns,
    save: askedBy === "policy" ? patterns : [],
    metadata: withRiskClassification(
      metadata,
      classifyPermissionRequest({ permission: canonical, patterns, always: askedBy === "policy" ? patterns : [], metadata }),
    ),
    source: { type: "tool", messageID: call.messageID, id: call.id },
  })
  const now = await decide(deps, call)
  const current = subjectBindingDigest({ identity: now.facts.identity, authority: now.facts.authority, bindingDigest: now.facts.bindingDigest })
  if (current !== bindingDigest)
    throw namedDeny(call.tool, facts, "binding-changed-during-approval", "the service definition changed while waiting for approval; retry")
}

/**
 * Review R1 #2 (#1129 E6): a request for a tool's own permission action made without a tool call — a subtask command
 * asserting the subagent tool's permission (core config/plugin/command.ts) — gets that tool's identity-axis decision,
 * as `decide` + `confirm` give a tool call: deny ⇒ denied by name; ask (document or ruleset axis) ⇒ asked with Code
 * Puppy's identity envelope and held against later evaluate hooks; allow ⇒ OpenCode's own evaluation stands.
 */
export async function gateWithoutToolCall(
  deps: GateDeps,
  event: {
    readonly sessionID: string
    readonly agent?: string
    readonly metadata?: Record<string, unknown>
    effect: string
    message?: string
  },
  facts: ToolFacts,
  agent: string,
): Promise<void> {
  const [snapshot, ruleset] = await Promise.all([deps.store.snapshot(), deps.ruleset(event.sessionID, event.agent ?? agent)])
  const effective = effectiveFor(facts, snapshot, ruleset)
  if (effective.action === "deny") {
    event.effect = "deny"
    event.message = namedDeny(facts.technicalId, facts, effective.reason.kind).message
    return
  }
  const canonical = canonicalToolIdentity(facts.identity)
  const askedBy = rulesetIdentityEffect(canonical, ruleset) === "ask" ? "ruleset" : effective.action === "ask" ? "policy" : undefined
  if (!askedBy) return
  const bindingDigest = subjectBindingDigest({ identity: facts.identity, authority: facts.authority, bindingDigest: facts.bindingDigest })
  if (event.metadata)
    Object.assign(event.metadata, {
      identity: facts.identity,
      authority: facts.authority,
      policy: { directory: deps.directory(), canonical, ...(bindingDigest ? { bindingDigest } : {}), askedBy },
    })
  event.effect = "ask"
  holdAsk(event)
}

/**
 * Pins the approved call (S1 option 2): `tool` and `input` become read-only on the shared event, and the input is
 * deep-frozen, so any callback registered after this one that rewrites either throws, which rejects the call
 * (`execute.before` failures reject; packages/plugin/src/promise/adapter.ts `toolHook`).
 */
export function pin(event: { tool: string; input: unknown }) {
  const tool = event.tool
  const input = deepFreeze(event.input)
  Object.defineProperty(event, "tool", { get: () => tool, enumerable: true, configurable: false })
  Object.defineProperty(event, "input", { get: () => input, enumerable: true, configurable: false })
}

/**
 * Holds the ask of Code Puppy's own gate request (`metadata.policy`) against every later `permission.hook.evaluate`
 * callback. OpenCode 2 lets any evaluate hook rewrite `effect`, and hooks run in registration order, so a plugin
 * activated after the extension — or one that registers through the extension's Context after `seal()` — could turn
 * the ask into allow and the call would run without the user's answer. Stricter stays possible (a managed policy
 * deny); looser is ignored. Runs from the extension's early evaluate hook, ahead of every configured plugin.
 */
export function holdAsk(event: { effect: string }) {
  if (event.effect !== "ask") return
  let effect: string = "ask"
  Object.defineProperty(event, "effect", {
    get: () => effect,
    set: (next: unknown) => {
      if (next === "deny") effect = "deny"
    },
    enumerable: true,
    configurable: false,
  })
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const item of Object.values(value)) deepFreeze(item)
  }
  return value
}
