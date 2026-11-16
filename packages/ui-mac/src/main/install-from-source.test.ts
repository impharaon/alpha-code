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
import { persistMcp, readMcpLeafStrict } from "./ext-config"

test("A2 remote MCP leaf retains timeout and OAuth policy through main truth publication", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "helper-a2-remote-truth-"))
  const previousRoot = process.env.CODEPUPPY_GLOBAL_DIR
  process.env.CODEPUPPY_GLOBAL_DIR = join(temporary, "env", "dev")
  try {
    const converted = await convertPluginTree(await captureFixture("external_plugins/context7"))
    const entry = converted.package.entries.find((entry) => entry.kind === "mcp")!
    expect(entry.kind === "mcp" && entry.transport).toBe("http")
    if (entry.kind !== "mcp" || entry.transport === "stdio") throw new Error("recorded context7 must remain remote")
    // The real URL plus our normalized leaf contract's explicit timeout/OAuth fields;
    // this is not a fabricated third-party manifest or definition.
    const leaf = { type: "remote", url: entry.url.join(""), timeout: 7890, oauth: false }
    expect(persistMcp("context7", leaf)).toMatchObject({ ok: true })
    expect(readMcpLeafStrict("context7")).toMatchObject({ ok: true, value: leaf })
  } finally {
    if (previousRoot === undefined) delete process.env.CODEPUPPY_GLOBAL_DIR
    else process.env.CODEPUPPY_GLOBAL_DIR = previousRoot
    rmSync(temporary, { recursive: true, force: true })
  }
})

test("A2 MCP leaf builder preserves normalized fields and owns secret references", async () => {
  const { buildMcpTxItems } = await import("./ext-package-tx-builders")
  const temporary = mkdtempSync(join(tmpdir(), "helper-a2-leaf-"))
  const root = join(temporary, "env", "dev")
  const previousRoot = process.env.CODEPUPPY_GLOBAL_DIR
  process.env.CODEPUPPY_GLOBAL_DIR = root
  try {
    // Our normalized boundary, derived from the recorded real GitHub definition.
    const capture = await captureFixture("external_plugins/github")
    const converted = await convertPluginTree(capture)
    const need = converted.package.secrets[0]!
    const receipt: UpsertInput = { id: "user:github", kind: "mcp", name: "github", environment: "dev", scope: { kind: "global" }, origin: "imported-claude", desiredState: "disabled", installedAt: "2026-11-16T07:24:11Z" }
    const built = buildMcpTxItems({ root, key: "mcp--github", name: "github", capabilities: [], manifestDigest: converted.package.treeDigest, receipt, userDataPath: temporary, newSecretVersionId: () => "a2-test-version", leaf: { type: "remote", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: `Bearer {secret:${need.id}}` }, timeout: 7890, oauth: false }, secretNeeds: [{ needId: need.id }], secretValues: { [need.id]: "fixture-not-a-real-token" } })
    expect(built.ok).toBe(true)
    if (!built.ok) throw new Error(built.reason)
    expect(built.build.items[0]?.config?.edits[0]?.value).toMatchObject({ type: "remote", timeout: 7890, oauth: false, enabled: false })
    expect(JSON.stringify(built.build.items)).not.toContain("fixture-not-a-real-token")
    expect(built.build.prepared?.descriptor).toMatchObject({ kind: "mcp-secret-version", server: "github", version: "a2-test-version" })
    expect(String((built.build.items[0]?.config?.edits[0]?.value as { headers: { Authorization: string } }).headers.Authorization)).toContain("{file:")
  } finally {
    if (previousRoot === undefined) delete process.env.CODEPUPPY_GLOBAL_DIR
    else process.env.CODEPUPPY_GLOBAL_DIR = previousRoot
    rmSync(temporary, { recursive: true, force: true })
  }
})

test("A2 graph metadata is strict, digest-bound and rejects plaintext credential declarations", async () => {
  const { decodePackageGraphV1 } = await import("./ext-package-ledger-v3")
  const capture = await captureFixture("external_plugins/context7")
  const converted = await convertPluginTree(capture)
  const base = { packageId: "claude:context7", envelopeDigest: converted.package.treeDigest, root: { componentId: "user:context7", kind: "mcp" as const, name: "context7", required: true, manifestDigest: converted.package.treeDigest }, children: [], source: { kind: "marketplace", ecosystem: "claude", repository: capture.source.repository!, commit: capture.source.commit!, path: capture.source.pluginPath!, entryName: "context7" }, notRunning: [{ kind: "plugin", sourceName: "example.js", reason: "native-js-plugin" }], declarations: [{ componentId: "user:context7", kind: "mcp", hostName: "context7", sourceName: "context7", mcp: { type: "remote", url: "https://mcp.context7.com/mcp?client=claude-code-plugin" }, secretNeeds: [] }] }
  const graph = { ...base, installedGraphDigest: computeInstalledGraphDigest(base) }
  expect(decodePackageGraphV1(graph)).toMatchObject({ ok: true, value: { source: base.source, notRunning: base.notRunning, declarations: base.declarations } })
  expect(decodePackageGraphV1({ ...graph, source: { ...base.source, commit: "different" } }).ok).toBe(false)
  const bad = { ...base, declarations: [{ ...base.declarations[0]!, mcp: { ...base.declarations[0]!.mcp, headers: { Authorization: "Bearer fixture-not-a-real-token" } } }] }
  expect(decodePackageGraphV1({ ...bad, installedGraphDigest: computeInstalledGraphDigest(bad) }).ok).toBe(false)
})

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
