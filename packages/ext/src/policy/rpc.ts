// Tool policy API over the OpenCode 2 plugin RPC (lane seams I5): `POST /api/rpc/codepuppy.tool-policy/<method>`.
// Replaces the four `/api/permission/tool-policy/*` routes v1 added inside the taken-over permission handler
// (packages/core/src/permission/codepuppy-tool-policy-api.ts) and the inventory service
// (packages/opencode/src/permission/codepuppy-tool-inventory.ts).
import { canonicalToolIdentity, type ToolAuthority } from "../../../schema/src/tool-identity"
import {
  classifyTool,
  parseToolPolicyDocument,
  selectorKey,
  selectorMatches,
  TOOL_POLICY_RPC,
  type ToolClass,
  type ToolPolicyRecord,
  type ToolPolicySelector,
  type ToolPolicySubject,
} from "../../../schema/src/codepuppy-tool-policy"
import {
  parseToolPolicyInventory,
  type ToolPolicyInventoryServiceV1,
  type ToolPolicyInventoryToolV1,
  type ToolPolicyInventoryV1,
} from "../../../schema/src/codepuppy-tool-inventory"
import type { PermissionRule } from "./managed"
import { effectiveFor } from "./gate"
import type { ToolFacts } from "./identity"
import { ToolPolicyWriteError, type ToolPolicySnapshot, type ToolPolicyStore } from "./resolver"

/** §3: a dynamic tool with no applicable broad override is "newly discovered" in Settings. */
const DYNAMIC_CLASSES = new Set<ToolClass>(["third-party-mcp", "plugin"])

export function buildInventory(
  snapshot: ToolPolicySnapshot,
  tools: readonly ToolFacts[],
  ruleset: readonly PermissionRule[],
): ToolPolicyInventoryV1 {
  const records: readonly ToolPolicyRecord[] = snapshot.user.status === "ok" ? snapshot.user.records : []
  const bySelector = new Map(records.map((record) => [selectorKey(record.selector), record]))
  const invalid: { technicalId: string; detail: string }[] = []
  const services = new Map<string, ToolPolicyInventoryServiceV1>()
  for (const facts of tools) {
    let canonical: string
    let cls: ToolClass | undefined
    try {
      canonical = canonicalToolIdentity(facts.identity)
      cls = classifyTool({ identity: facts.identity, authority: facts.authority })
    } catch (error) {
      invalid.push({ technicalId: facts.technicalId, detail: error instanceof Error ? error.message : String(error) })
      continue
    }
    if (cls === undefined) {
      invalid.push({ technicalId: facts.technicalId, detail: `unclassifiable subject: ${canonical}` })
      continue
    }
    const subject: ToolPolicySubject = { identity: facts.identity, authority: facts.authority, bindingDigest: facts.bindingDigest }
    const effective = effectiveFor(facts, snapshot, ruleset)
    const toolRecord = bySelector.get(selectorKey({ level: "tool", canonical }))
    const writeDigest = facts.authority.kind === "codepuppy-cloud" ? facts.authority.evidenceDigest : facts.bindingDigest
    const tool: ToolPolicyInventoryToolV1 = {
      canonical,
      identity: facts.identity,
      technicalId: facts.technicalId,
      authority: facts.authority,
      ...(writeDigest !== undefined ? { bindingDigest: writeDigest } : {}),
      effective: { state: effective.state, action: effective.action, reason: effective.reason as ToolPolicyInventoryToolV1["effective"]["reason"] },
      ...(toolRecord !== undefined ? { record: toolRecord } : {}),
      newlyDiscovered: DYNAMIC_CLASSES.has(cls) && !records.some((record) => selectorMatches(record.selector, subject)),
    }
    const key = selectorKey({ level: "service", source: facts.identity.source, origin: facts.identity.origin })
    let service = services.get(key)
    if (!service) {
      const serviceRecord = bySelector.get(key)
      service = {
        source: facts.identity.source,
        origin: facts.identity.origin,
        class: cls,
        authority: facts.authority as ToolAuthority,
        ...(writeDigest !== undefined ? { bindingDigest: writeDigest } : {}),
        ...(serviceRecord !== undefined ? { record: serviceRecord } : {}),
        tools: [],
      }
      services.set(key, service)
    }
    service.tools.push(tool)
  }
  for (const service of services.values()) service.tools.sort((a, b) => a.canonical.localeCompare(b.canonical))
  return parseToolPolicyInventory({
    version: 1,
    partition: snapshot.partition,
    user: snapshot.user.status === "quarantined" ? { status: "quarantined", reason: snapshot.user.reason } : { status: snapshot.user.status },
    managed: snapshot.managed.status === "unreadable" ? { status: "unreadable", reason: snapshot.managed.reason } : { status: "ok" },
    classRecords: records.filter((record) => record.selector.level === "class"),
    services: [...services.values()].toSorted((a, b) => a.source.localeCompare(b.source) || a.origin.localeCompare(b.origin)),
    invalid: { count: invalid.length, entries: invalid },
  })
}

/** Validates one record with the document decoder (the full schema check, binding guard included). */
export function parseRecord(value: unknown): ToolPolicyRecord {
  return parseToolPolicyDocument({ version: 1, partition: { account: "-", workspace: "-" }, records: [value] }).records[0]!
}

const ANY = {} as const
const OBJECT = { type: "object" } as const
const ERRORS = {
  [TOOL_POLICY_RPC.errors.quarantined]: ANY,
  [TOOL_POLICY_RPC.errors.invalidRecord]: ANY,
  [TOOL_POLICY_RPC.errors.writeFailed]: ANY,
}

/** The portable RPC definition: id and method names are the frozen `TOOL_POLICY_RPC` table. */
export const TOOL_POLICY_RPC_DEFINITION = {
  id: TOOL_POLICY_RPC.id,
  methods: {
    [TOOL_POLICY_RPC.methods.inventory]: { input: OBJECT, output: ANY },
    [TOOL_POLICY_RPC.methods.setRecord]: { input: ANY, output: ANY, errors: ERRORS },
    [TOOL_POLICY_RPC.methods.removeRecord]: { input: OBJECT, output: ANY, errors: ERRORS },
    [TOOL_POLICY_RPC.methods.reset]: { input: OBJECT, output: ANY },
  },
  events: {},
} as const

type Fail = (type: string, message: string) => unknown

export interface RpcDeps {
  readonly store: ToolPolicyStore
  readonly tools: () => Promise<readonly ToolFacts[]>
  /** Configured rules for Settings' view (the default agent's, before Code Puppy's own). */
  readonly ruleset: () => Promise<readonly PermissionRule[]>
  /** Called after every successful write so the catalog and asks follow the new document. */
  readonly changed: () => Promise<void>
}

function writeFailure(error: unknown, fail: Fail) {
  if (error instanceof ToolPolicyWriteError)
    return fail(error.kind === "quarantined" ? TOOL_POLICY_RPC.errors.quarantined : TOOL_POLICY_RPC.errors.writeFailed, error.message)
  return fail(TOOL_POLICY_RPC.errors.writeFailed, error instanceof Error ? error.message : String(error))
}

export function toolPolicyHandlers(deps: RpcDeps) {
  return {
    [TOOL_POLICY_RPC.methods.inventory]: async () => {
      const [snapshot, tools, ruleset] = await Promise.all([deps.store.snapshot(), deps.tools(), deps.ruleset()])
      return buildInventory(snapshot, tools, ruleset)
    },
    [TOOL_POLICY_RPC.methods.setRecord]: async (input: unknown, context: { error: Fail }) => {
      let record: ToolPolicyRecord
      try {
        record = parseRecord(input)
      } catch (error) {
        return context.error(TOOL_POLICY_RPC.errors.invalidRecord, error instanceof Error ? error.message : String(error))
      }
      try {
        await deps.store.setRecord(record)
      } catch (error) {
        return writeFailure(error, context.error)
      }
      await deps.changed()
      return undefined
    },
    [TOOL_POLICY_RPC.methods.removeRecord]: async (input: unknown, context: { error: Fail }) => {
      const selector = (input as { selector?: ToolPolicySelector } | null)?.selector
      let parsed: ToolPolicySelector
      try {
        parsed = parseRecord({ selector, state: "disabled" }).selector
      } catch (error) {
        return context.error(TOOL_POLICY_RPC.errors.invalidRecord, error instanceof Error ? error.message : String(error))
      }
      try {
        await deps.store.removeRecord(parsed)
      } catch (error) {
        return writeFailure(error, context.error)
      }
      await deps.changed()
      return undefined
    },
    [TOOL_POLICY_RPC.methods.reset]: async () => {
      const result = await deps.store.reset()
      await deps.changed()
      return result
    },
  }
}

