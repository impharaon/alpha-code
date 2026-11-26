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
// · SPEC-engine-config-fence BR-03 (DESIGN §4.5, CF-11): the directory is protected configuration, so in the app the writers run in
//   main only — main receives the extension's request over the narrow channel (`receiveToolPolicyWrite`, below) and calls them.
//   The store's default writer still calls them in-process for the CLI and unit tests (resolver.ts).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { canonicalJsonDigest } from "../../../util/src/codepuppy-hash"
export { canonicalJson, canonicalJsonDigest } from "../../../util/src/codepuppy-hash"
import path from "node:path"
import {
  parseToolPolicyDocument,
  selectorKey,
  type ToolPolicyDocumentV1,
  type ToolPolicyPartition,
  type ToolPolicyRecord,
} from "../../../schema/src/codepuppy-tool-policy"
import {
  buildToolPolicyWriteReply,
  parseToolPolicyWriteRequest,
  type ToolPolicyWriteReply,
} from "../../../ui-mac/src/main/codepuppy-sidecar-messages"

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

/**
 * Main's side of the narrow channel (SPEC-engine-config-fence BR-03, DESIGN-engine-config-fence §4.5): the extension inside the fence
 * sends `codepuppy.tool-policy.write.request`; main writes with the same two writers and replies after the write. Returns false for any
 * other message (the caller's chain goes on). A malformed request is answered with an error when it carries an id, and logged. A failed
 * write is answered with an error and logged in one line; the reply names the path and errno, never document content. Lives here, next
 * to the writers it calls, so that main and an outside-the-fence test helper run the same function (server.ts imports Electron).
 */
export function receiveToolPolicyWrite(
  message: unknown,
  deps: { baseDir: string; post: (reply: ToolPolicyWriteReply) => void; log: (line: string) => void },
): boolean {
  if (!message || typeof message !== "object" || (message as { type?: unknown }).type !== "codepuppy.tool-policy.write.request") return false
  const request = parseToolPolicyWriteRequest(message)
  if (!request) {
    const id = (message as { id?: unknown }).id
    deps.log("[I-13] tool policy write request is malformed — nothing written")
    if (typeof id === "number" && Number.isSafeInteger(id) && id >= 0) deps.post(buildToolPolicyWriteReply(id, { error: "malformed tool policy write request" }))
    return true
  }
  let reply: ToolPolicyWriteReply
  try {
    if (request.op === "save") {
      savePolicyDocument(deps.baseDir, request.partition, request.records)
      reply = buildToolPolicyWriteReply(request.id, { ok: true })
    } else {
      const { backup } = resetPolicyDocument(deps.baseDir, request.partition)
      reply = buildToolPolicyWriteReply(request.id, backup === undefined ? { ok: true } : { ok: true, backup })
    }
  } catch (error) {
    // fs errors carry the path and errno and nothing of the file; anything else (a schema rejection) is named by its class only
    const reason =
      error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string" ? error.message.slice(0, 1024) : `tool policy document rejected (${error instanceof Error ? error.name : typeof error})`
    deps.log(`[I-13] tool policy ${request.op} failed: ${reason}`)
    reply = buildToolPolicyWriteReply(request.id, { error: reason })
  }
  deps.post(reply)
  return true
}
