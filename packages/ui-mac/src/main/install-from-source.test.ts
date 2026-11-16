import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureFixture } from "../../test-fixtures/plugin-helper/fixture"
import { convertPluginTree } from "../shared/host-extension-package-contract/plugin-conversion.mjs"
import { buildSkillTxItems } from "./ext-package-tx-builders"
import { promotePayloadToCas, setPackageStateV1 } from "./ext-install-planner"
import { computeInstalledGraphDigest, type PackageGraphV1 } from "./ext-package-ledger-v3"
import { diffPackageGraphsV1, planPackageClaimTransferV1 } from "./ext-package-lifecycle"
import { commitTransactionLedger } from "./ext-package-ledger-commit"
import { readPackageLedgerStateV1, type UpsertInput } from "./ext-receipt-v2"
import { runExtensionTransaction } from "./ext-transaction"

test("A2 automatic enable uses H's package-root action for a real skill-only package without config edits", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "helper-a2-state-"))
  const root = join(temporary, "env", "dev")
  const previousRoot = process.env.CODEPUPPY_GLOBAL_DIR
  process.env.CODEPUPPY_GLOBAL_DIR = root
  try {
    // Real pinned frontend-design bytes; the graph/receipt are our own transaction contract.
    const capture = await captureFixture("plugins/frontend-design")
    const converted = await convertPluginTree(capture)
    const files = await Promise.all(capture.nodes.filter((node) => node.kind === "file" && node.path.startsWith("skills/frontend-design/")).map(async (node) => ({ path: node.path.slice("skills/frontend-design/".length), data: Buffer.from(await capture.readFile(node.path)) })))
    const promoted = promotePayloadToCas(temporary, files, files.map((file) => ({ path: file.path, bytes: file.data.length, sha256: new Bun.CryptoHasher("sha256").update(file.data).digest("hex") })))
    expect(promoted.ok).toBe(true)
    if (!promoted.ok) throw new Error(promoted.reason)
    const receipt: UpsertInput = { id: "user:frontend-design", kind: "skill", name: "frontend-design", environment: "dev", scope: { kind: "global" }, origin: "imported-claude", desiredState: "disabled", version: "1.0.0", installedAt: "2026-11-16T06:48:38Z" }
    const graph: PackageGraphV1 = { packageId: "claude:frontend-design", envelopeDigest: converted.package.treeDigest, installedGraphDigest: "", displayName: converted.package.name, root: { componentId: receipt.id, kind: "skill", name: receipt.name, required: true, manifestDigest: converted.package.treeDigest }, children: [] }
    graph.installedGraphDigest = computeInstalledGraphDigest(graph)
    const diff = diffPackageGraphsV1(null, graph, { before: null, after: receipt.version! })
    expect(diff.ok).toBe(true)
    if (!diff.ok) throw new Error(diff.reason)
    const built = buildSkillTxItems({ root, key: "skill--frontend-design", name: receipt.name, manifestDigest: converted.package.treeDigest, capabilities: [], receipt, assetFiles: promoted.specs, casBaseRoot: temporary })
    expect(built.ok).toBe(true)
    if (!built.ok) throw new Error(built.reason)
    built.build.items[0]!.packageMutation = { operation: "install", graphBeforeDigest: null, graphAfter: graph, claimMutations: planPackageClaimTransferV1(diff.diff), childRemovals: [] }
    const installed = await runExtensionTransaction(root, { items: built.build.items }, { populate: built.build.populate, precondition: built.build.precondition, probe: built.build.probe, commitReceipt: (records) => commitTransactionLedger(root, records) })
    expect(installed.ok).toBe(true)
    if (!installed.ok) throw new Error("real skill transaction did not commit")
    const before = readPackageLedgerStateV1(root)
    expect(before.ok && before.records.map((record) => record.desiredState)).toEqual(["disabled"])
    const enabled = await setPackageStateV1({ packageId: graph.packageId, state: "enabled" }, { globalRoot: () => root, advisoryGate: () => ({ allowed: true }), resolvePackage: async () => { throw new Error("non-catalog package must not resolve signed catalog") } })
    expect(enabled).toMatchObject({ ok: true })
    const after = readPackageLedgerStateV1(root)
    expect(after.ok && after.records.map((record) => record.desiredState)).toEqual(["enabled"])
  } finally {
    if (previousRoot === undefined) delete process.env.CODEPUPPY_GLOBAL_DIR
    else process.env.CODEPUPPY_GLOBAL_DIR = previousRoot
    rmSync(temporary, { recursive: true, force: true })
  }
})
