// Run from the alpha-web worktree. Production gate functions; read-only source tree.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = process.cwd()
const directory = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const results = join(directory, "results")
const read = (file) => JSON.parse(readFileSync(file, "utf8"))
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex")
const save = (name, value) => {
  const text = JSON.stringify(value, null, 2) + "\n"
  assert.ok(!text.includes("github_pat_"), "SECRET_SCAN_REJECTED")
  writeFileSync(join(results, name), text, { flag: "wx" })
}
const gate = await import(pathToFileURL(join(root, "scripts/lib/curation-gate.mjs")))
const packages = await import(pathToFileURL(join(root, "scripts/lib/extension-package-core.mjs")))
const channels = await import(pathToFileURL(join(root, "scripts/lib/catalog-channels-core.mjs")))
const install = read(join(results, "install.json"))
assert.equal(read(join(results, "live-process.json")).status, 0)
const records = Object.fromEntries(install.packages.map((item) => {
  const calls = read(join(results, `${item.name}-calls.json`))
  return [item.packageId, { version: item.version, digest: item.digest, install: "pass", use: "pass", method: "package-install",
    verifiedAt: calls.startedAt.slice(0, 10), logSha256: sha(join(results, `${item.name}-calls.json`)),
    installationEvidence: { repo: "jinjunnn/alpha-code", hostCommit: install.hostCommit, hostVersion: install.hostVersion,
      file: "docs/verification/2026-10-15-aw256-connector-evidence/results/install.json", sha256: sha(join(results, "install.json")),
      method: "runCatalogInstallWithPackagePreflight; real Electron safeStorage; grants.secrets; committed receipt" },
    runtimeEvidence: { method: "tools/call", serverInfo: { name: calls.serverInfo.name, version: calls.serverInfo.version },
      file: `docs/verification/2026-10-15-aw256-connector-evidence/results/${item.name}-calls.json`,
      elapsedMs: calls.elapsedMs,
      ...(item.name === "dbhub-readonly" ? { serverVersion: "1.5.0", select: "SELECT 1 AS aw256_ok", result: [{ aw256_ok: 1 }],
        write: "CREATE TABLE aw256_should_not_exist(id INTEGER)", writeError: "READONLY_VIOLATION", tableCreated: false }
        : { repository: "github/github-mcp-server", query: "repo:github/github-mcp-server" }) } }]
}))
save("runtime-records.json", records)
const now = new Date()
const advisoryState = channels.loadEstablishedAdvisoryState({
  channelsDir: join(root, "public/catalog/v1/channels"),
  advisoriesSchema: read(join(root, "contracts/catalog-channels/advisories.v1.schema.json")),
  snapshotSchema: read(join(root, "contracts/catalog-channels/snapshot.v1.schema.json")), now,
  headAdvisoryBytes: channels.readHeadAdvisoryBaseline({ repoRoot: root }),
})
const compiled = ["github-official", "dbhub-readonly"].map((name) => {
  const item = packages.readPackageSource(join(root, `catalog-src/packages/package.${name}/1.0.0`), { root })
  packages.assertCompiledPackageCurated(item, { root, stable: true, now })
  assert.equal(gate.catalogRuntimeDigest(item.envelope), records[item.envelope.prelude.packageId].digest)
  return item
})
// Existing published payload plus exactly the two held candidates. No releaseHold mutation.
const catalog = read(join(root, "public/catalog/v1/catalog.json"))
catalog.packages = [...(catalog.packages ?? []), ...compiled.map((item) => item.envelope)]
packages.assertPackagesReadyForStable(Buffer.from(JSON.stringify(catalog)), { root, now })
gate.assertCurationsNotExpired(Buffer.from(JSON.stringify(catalog)), now)
const before = (() => {
  try { gate.assertCatalogReady(catalog, { root, advisories: advisoryState.activeRecords }); return "unexpected-pass" }
  catch (error) { return String(error) }
})()
assert.ok(before.includes("package:github-official") && before.includes("package:dbhub-readonly"))
// Only the runtime evidence file differs in this temporary gate input root.
const overlay = mkdtempSync(join(directory, ".tmp-gate-"))
try {
  mkdirSync(join(overlay, "catalog-src", "intake"), { recursive: true })
  symlinkSync(join(root, "catalog-src/curation"), join(overlay, "catalog-src/curation"))
  const evidence = { ...read(join(root, "catalog-src/intake/runtime-verification.json")), ...records }
  writeFileSync(join(overlay, "catalog-src/intake/runtime-verification.json"), JSON.stringify(evidence))
  gate.assertCatalogReady(catalog, { root: overlay, advisories: advisoryState.activeRecords })
  save("curation-gate.json", { checkedAt: now.toISOString(), status: "pass", baselineWithoutNewRecords: before,
    declarationCommit: install.declarationCommit, entries: catalog.entries.length, packages: catalog.packages.length,
    candidateIds: Object.keys(records), activeAdvisories: advisoryState.activeRecords,
    checks: ["assertCompiledPackageCurated(stable=true)", "assertPackagesReadyForStable", "assertCurationsNotExpired",
      "loadEstablishedAdvisoryState(signature/schema/expiry/snapshot/HEAD)", "assertCatalogReady(full published catalog + two candidates)"],
    runtimeRecordsSha256: sha(join(results, "runtime-records.json")), publicationStateChanged: false,
    note: "Production gates called read-only; temporary evidence overlay only. build-catalog --check itself creates a publish lock, so it is not run against the frozen worktree." })
} finally {
  rmSync(overlay, { recursive: true, force: true })
}
console.log("AW256: both candidates and the full existing published catalog pass; no waiver or source mutation")
