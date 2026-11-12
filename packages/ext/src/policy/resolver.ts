// Code Puppy tool policy — the three-state resolver (#724 CLOSE_DECIDE §2–§5) and the per-call snapshot.
// Moved from packages/opencode/src/permission/codepuppy-tool-policy.ts (deleted with v1, #1662 L4). The pure core
// (`resolveToolPolicy`, binding digests) is unchanged; the Effect service became a plain object because OpenCode 2
// plugins run on the promise API, and the partition comes from the plugin's Location instead of v1 InstanceState.
//
// Composition order (§4):
//   1. Unbreakable caps first: managed deny, server entitlement missing/deny, sovereignty / kill-switch deny.
//   2. Then the user's selector for this account + workspace (exact tool > service > class). User disabled cannot be
//      opened by a session approval; user enabled replaces the class-default ask but never a cap. Service/tool enabled
//      also passes the binding guard: a rebind returns to ask.
//   3. Without a deny, a remaining ask means "this call waits for approval", handed to OpenCode's permission engine.
import path from "node:path"
import { canonicalToolIdentity } from "../../../schema/src/tool-identity"
import {
  classDefaultState,
  classifyTool,
  selectorKey,
  selectorMatches,
  selectorSpecificity,
  toPermissionAction,
  type ToolClass,
  type ToolPolicyPartition,
  type ToolPolicyRecord,
  type ToolPolicySelector,
  type ToolPolicyState,
  type ToolPolicySubject,
} from "../../../schema/src/codepuppy-tool-policy"
import { managedCapDenies, readManagedPolicy, type ManagedPolicyResult } from "./managed"
import {
  canonicalJsonDigest,
  loadPolicyDocument,
  resetPolicyDocument,
  savePolicyDocument,
  type PolicyLoadResult,
} from "./store"

// ── binding digest (§5) ────────────────────────────────────────────────────────
// Code Puppy Cloud reuses the verified `authority.evidenceDigest`. A third-party MCP server's digest is derived from
// the de-secreted effective definition: headers / environment / oauth hold tokens, so they neither enter the digest
// nor count as a rebind when rotated; url (remote) or command + cwd (local) changing is a rebind.
export function mcpBindingEvidence(name: string, entry: McpEntry): unknown {
  if (entry.type === "remote") return { kind: "mcp-remote", name, url: entry.url }
  return { kind: "mcp-local", name, command: entry.command, cwd: entry.cwd ?? null }
}

/** The de-secreted part of an OpenCode 2 MCP server config the policy reads (`@opencode/schema/mcp` ServerConfig). */
export type McpEntry =
  | { readonly type: "remote"; readonly url: string }
  | { readonly type: "local"; readonly command: readonly string[]; readonly cwd?: string }

export function mcpBindingDigest(name: string, entry: McpEntry): string {
  return canonicalJsonDigest(mcpBindingEvidence(name, entry))
}

export function subjectBindingDigest(subject: ToolPolicySubject): string | undefined {
  if (subject.authority.kind === "codepuppy-cloud") return subject.authority.evidenceDigest
  return subject.bindingDigest
}

// ── effective policy ─────────────────────────────────────────────────────────
export type EffectiveToolPolicyReason =
  | { kind: "invalid-identity"; detail: string }
  | { kind: "cap-managed" }
  | { kind: "cap-managed-unreadable"; detail: string }
  | { kind: "cap-entitlement"; verdict: "deny" | "missing" }
  | { kind: "cap-hard-deny"; sources: readonly string[] }
  | { kind: "quarantine"; detail: string }
  | { kind: "user"; level: "class" | "service" | "tool" }
  | { kind: "binding-changed"; level: "service" | "tool" }
  | { kind: "default"; class: ToolClass }

export interface EffectiveToolPolicy {
  readonly state: ToolPolicyState
  /** The OpenCode permission effect it compiles to (§2: no second approval engine). */
  readonly action: "allow" | "ask" | "deny"
  readonly reason: EffectiveToolPolicyReason
}

function effective(state: ToolPolicyState, reason: EffectiveToolPolicyReason): EffectiveToolPolicy {
  return { state, action: toPermissionAction(state), reason }
}

export interface ToolPolicyCaps {
  readonly managed: ManagedPolicyResult
  readonly entitlement?: "allow" | "deny" | "missing"
  /** Existing sovereignty / kill-switch deny sources; non-empty = cap hit. */
  readonly hardDeny?: readonly string[]
}

export type ToolPolicyUserLayer =
  | { status: "ok"; records: readonly ToolPolicyRecord[] }
  | { status: "absent" }
  | { status: "quarantined"; reason: string }

/** Pure composition core (§4): every fact is an input, no IO. */
export function resolveToolPolicy(input: {
  readonly subject: ToolPolicySubject
  readonly caps: ToolPolicyCaps
  readonly user: ToolPolicyUserLayer
}): EffectiveToolPolicy {
  // 0. Missing / invalid identity or a contradictory classification ⇒ disabled, never advertised.
  let canonical: string
  try {
    canonical = canonicalToolIdentity(input.subject.identity)
  } catch (error) {
    return effective("disabled", { kind: "invalid-identity", detail: error instanceof Error ? error.message : String(error) })
  }
  const cls = classifyTool(input.subject)
  if (cls === undefined) return effective("disabled", { kind: "invalid-identity", detail: "unclassifiable subject" })

  // 1. Caps: any hit is disabled, and nothing below (user enabled, saved approvals) opens it.
  if (input.caps.managed.status === "unreadable")
    return effective("disabled", { kind: "cap-managed-unreadable", detail: input.caps.managed.reason })
  if (managedCapDenies(canonical, input.caps.managed.ruleset)) return effective("disabled", { kind: "cap-managed" })
  if (input.caps.entitlement === "deny" || input.caps.entitlement === "missing")
    return effective("disabled", { kind: "cap-entitlement", verdict: input.caps.entitlement })
  if (input.caps.hardDeny !== undefined && input.caps.hardDeny.length > 0)
    return effective("disabled", { kind: "cap-hard-deny", sources: input.caps.hardDeny })

  // 2. User layer. Quarantine ⇒ every user-configurable tool is disabled (caps above still apply).
  if (input.user.status === "quarantined") return effective("disabled", { kind: "quarantine", detail: input.user.reason })
  if (input.user.status === "ok") {
    const matches = input.user.records.filter((record) => selectorMatches(record.selector, input.subject))
    if (matches.length > 0) {
      const best = Math.max(...matches.map((record) => selectorSpecificity(record.selector)))
      const chosen = matches.filter((record) => selectorSpecificity(record.selector) === best)
      if (chosen.length > 1)
        return effective("disabled", {
          kind: "quarantine",
          detail: `conflicting policy records for ${selectorKey(chosen[0]!.selector)}`,
        })
      const record = chosen[0]!
      const level = record.selector.level
      if (record.state === "disabled") return effective("disabled", { kind: "user", level })
      if (record.state === "ask") return effective("ask", { kind: "user", level })
      if (level === "class") return effective("enabled", { kind: "user", level })
      const current = subjectBindingDigest(input.subject)
      if (current === undefined || current !== record.bindingDigest) return effective("ask", { kind: "binding-changed", level })
      return effective("enabled", { kind: "user", level })
    }
  }

  // 3. The four class defaults (§2): local tools enabled, everything else ask.
  return effective(classDefaultState(cls), { kind: "default", class: cls })
}

/** Writer-side failure; `kind` lets the RPC map quarantine and IO apart without parsing text. */
export class ToolPolicyWriteError extends Error {
  constructor(
    readonly kind: "quarantined" | "io",
    message: string,
  ) {
    super(message)
    this.name = "ToolPolicyWriteError"
  }
}

/** One read of the current state (§6: the executor re-reads on every call; nothing is cached across calls). */
export interface ToolPolicySnapshot {
  readonly partition: ToolPolicyPartition
  readonly managed: ManagedPolicyResult
  readonly user: ToolPolicyUserLayer
  readonly load: PolicyLoadResult
  /** Revision of the user document; identity-axis saved approvals bind to it (`<bindingDigest>@<revision>`). */
  readonly revision: string
}

export function policyRevision(load: PolicyLoadResult): string {
  return load.status === "ok" ? canonicalJsonDigest(load.doc.records) : load.status
}

/**
 * K5 / S4: OpenCode 2 renamed three builtins (`v2:packages/core/src/database/v1-migration.bun.ts` `RENAMED_TOOLS`).
 * A saved tool-level record under the v1 name keeps applying to the renamed tool — a deny must not silently stop
 * matching — and every such record is reported loudly when the document loads.
 */
export const RENAMED_BUILTINS: Readonly<Record<string, string>> = { bash: "shell", task: "subagent", apply_patch: "patch" }

/** A tool-level selector under a v1 builtin name, as the renamed tool's selector; anything else unchanged. */
export function renamedSelector(selector: ToolPolicySelector): ToolPolicySelector {
  if (selector.level !== "tool") return selector
  const match = /^builtin::(.+)$/.exec(selector.canonical)
  const next = match ? RENAMED_BUILTINS[match[1]!] : undefined
  return next ? { level: "tool", canonical: `builtin::${next}` } : selector
}

export function renamedRecords(records: readonly ToolPolicyRecord[]): { records: ToolPolicyRecord[]; renamed: string[] } {
  const renamed: string[] = []
  const out = records.map((record) => {
    const selector = renamedSelector(record.selector)
    if (selector === record.selector) return record
    if (record.selector.level === "tool") renamed.push(record.selector.canonical)
    return { ...record, selector }
  })
  return { records: out, renamed }
}

export function userLayerFrom(load: PolicyLoadResult): ToolPolicyUserLayer {
  switch (load.status) {
    case "ok":
      return { status: "ok", records: renamedRecords(load.doc.records).records }
    case "absent":
      return { status: "absent" }
    case "quarantined":
      return { status: "quarantined", reason: load.reason }
  }
}

export interface ToolPolicyStoreOptions {
  /** Policy document root. */
  readonly baseDir: string
  /** Account subject; production reads `CODEPUPPY_POLICY_ACCOUNT` (main writes `acct:<hash>` when signed in). */
  readonly account: () => string
  /** Workspace identity of the plugin's Location (project id, or the directory for the global project). */
  readonly workspace: () => string
  /** Managed cap reader (production: `readManagedPolicy()`; the system directory cannot be replaced by env). */
  readonly managed?: () => Promise<ManagedPolicyResult>
}

export interface ToolPolicyStore {
  readonly snapshot: () => Promise<ToolPolicySnapshot>
  readonly setRecord: (record: ToolPolicyRecord) => Promise<void>
  readonly removeRecord: (selector: ToolPolicySelector) => Promise<void>
  readonly reset: () => Promise<{ backup?: string }>
}

export function createToolPolicyStore(options: ToolPolicyStoreOptions): ToolPolicyStore {
  const managedRead = options.managed ?? (() => readManagedPolicy())
  const partition = (): ToolPolicyPartition => ({ account: options.account(), workspace: options.workspace() })

  const reported = new Set<string>()
  const snapshot = async (): Promise<ToolPolicySnapshot> => {
    const managed = await managedRead()
    const part = partition()
    const loaded = loadPolicyDocument(options.baseDir, part)
    const revision = policyRevision(loaded)
    if (loaded.status === "ok" && !reported.has(revision)) {
      reported.add(revision)
      const { renamed } = renamedRecords(loaded.doc.records)
      for (const canonical of renamed)
        console.warn(
          `[codepuppy-policy] tool policy record for ${canonical} uses the OpenCode 1 tool name; it now applies to builtin::${RENAMED_BUILTINS[canonical.slice("builtin::".length)]}`,
        )
    }
    return { partition: part, managed, user: userLayerFrom(loaded), load: loaded, revision }
  }

  const mutate = async (description: string, change: (records: readonly ToolPolicyRecord[]) => readonly ToolPolicyRecord[]) => {
    const part = partition()
    const loaded = loadPolicyDocument(options.baseDir, part)
    if (loaded.status === "quarantined")
      throw new ToolPolicyWriteError(
        "quarantined",
        `refusing to ${description}: policy document is quarantined (${loaded.reason}); reset to defaults first`,
      )
    const records = loaded.status === "ok" ? loaded.doc.records : []
    try {
      savePolicyDocument(options.baseDir, part, change(records))
    } catch (error) {
      throw new ToolPolicyWriteError("io", error instanceof Error ? error.message : String(error))
    }
  }

  return {
    snapshot,
    // Review R1 #9: writes and deletes compare selectors after the K5 rename, as reads do, so a record saved under the
    // v1 name is replaced or removed through the new name instead of surviving next to it (a conflict ⇒ disabled).
    setRecord: (record) =>
      mutate("write a record", (records) => {
        const key = selectorKey(renamedSelector(record.selector))
        return [
          ...renamedRecords(records).records.filter((item) => selectorKey(item.selector) !== key),
          { ...record, selector: renamedSelector(record.selector) },
        ]
      }),
    removeRecord: (selector) =>
      mutate("remove a record", (records) => {
        const key = selectorKey(renamedSelector(selector))
        return renamedRecords(records).records.filter((item) => selectorKey(item.selector) !== key)
      }),
    reset: async () => resetPolicyDocument(options.baseDir, partition()),
  }
}

/** Production document root: `<XDG data>/opencode/codepuppy-tool-policy`, the same directory v1 used. */
export function defaultPolicyBaseDir(dataDir: string): string {
  return path.join(dataDir, "codepuppy-tool-policy")
}
