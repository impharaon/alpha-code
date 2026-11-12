// Code Puppy tool policy — versioned persistence of the user policy document (#724 CLOSE_DECIDE §5).
// Moved from packages/opencode/src/permission/codepuppy-tool-policy-store.ts (deleted with v1, #1662 L4);
// behaviour unchanged.
//
// · One document per (account subject or "anonymous", workspace/project identity) partition; the file name is the
//   sha256 of the partition's canonical JSON, so neither account nor path is written into a file name. The partition
//   is written in the document body and checked on load: a mismatch (a file copied from another account) is
//   quarantine, never silent adoption.
// · No file = first use, approved defaults (`absent`, not an error).
// · Corrupt / partly invalid / unknown version / wrong partition / duplicate selector = the whole document is
//   quarantined: a bad record that might have been a deny is never silently ignored. Recovery is `reset` (the bad file
//   moves to a `.quarantined-<ts>` backup and defaults return), surfaced in Settings.
// · Writes are atomic: tmp + rename.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import {
  parseToolPolicyDocument,
  selectorKey,
  type ToolPolicyDocumentV1,
  type ToolPolicyPartition,
  type ToolPolicyRecord,
} from "../../../schema/src/codepuppy-tool-policy"

/** Canonical JSON (sorted keys, undefined dropped); non-JSON values fail loudly. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error("tool policy evidence contains a non-JSON value")
  return encoded
}

export function canonicalJsonDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
}

export function policyFilePath(baseDir: string, partition: ToolPolicyPartition): string {
  const digest = canonicalJsonDigest({ account: partition.account, workspace: partition.workspace })
  return path.join(baseDir, `${digest.slice("sha256:".length)}.json`)
}

export type PolicyLoadResult =
  | { status: "ok"; doc: ToolPolicyDocumentV1 }
  | { status: "absent" }
  | { status: "quarantined"; reason: string; file: string }

/** Selector uniqueness (§3): two records for one selector may contradict each other, so the whole document is bad. */
function duplicateSelector(records: readonly ToolPolicyRecord[]): string | undefined {
  const seen = new Set<string>()
  for (const record of records) {
    const key = selectorKey(record.selector)
    if (seen.has(key)) return key
    seen.add(key)
  }
  return undefined
}

export function loadPolicyDocument(baseDir: string, partition: ToolPolicyPartition): PolicyLoadResult {
  const file = policyFilePath(baseDir, partition)
  if (!existsSync(file)) return { status: "absent" }
  let doc: ToolPolicyDocumentV1
  try {
    doc = parseToolPolicyDocument(JSON.parse(readFileSync(file, "utf8")))
  } catch (error) {
    return {
      status: "quarantined",
      reason: `tool policy document failed to parse: ${error instanceof Error ? error.message : String(error)}`,
      file,
    }
  }
  if (doc.partition.account !== partition.account || doc.partition.workspace !== partition.workspace)
    return { status: "quarantined", reason: "tool policy document belongs to a different account/workspace partition", file }
  const duplicate = duplicateSelector(doc.records)
  if (duplicate !== undefined) return { status: "quarantined", reason: `duplicate selector record: ${duplicate}`, file }
  return { status: "ok", doc }
}

export function savePolicyDocument(
  baseDir: string,
  partition: ToolPolicyPartition,
  records: readonly ToolPolicyRecord[],
): void {
  const duplicate = duplicateSelector(records)
  if (duplicate !== undefined) throw new Error(`duplicate selector record: ${duplicate}`)
  // Decoding once runs the full schema check before writing, so a bad record fails in the writer's hands instead of
  // quarantining every tool after it lands on disk.
  const doc = parseToolPolicyDocument({
    version: 1,
    partition: { account: partition.account, workspace: partition.workspace },
    records,
  })
  const file = policyFilePath(baseDir, partition)
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, JSON.stringify(doc, null, 2))
  renameSync(tmp, file)
}

/** Quarantine recovery: the bad file moves to a timestamped backup; the next load is `absent` (approved defaults). */
export function resetPolicyDocument(baseDir: string, partition: ToolPolicyPartition): { backup?: string } {
  const file = policyFilePath(baseDir, partition)
  if (!existsSync(file)) return {}
  const backup = `${file}.quarantined-${Date.now()}`
  renameSync(file, backup)
  return { backup }
}
