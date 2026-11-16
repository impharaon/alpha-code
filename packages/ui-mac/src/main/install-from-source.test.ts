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
import { createPluginSources } from "./plugin-sources"
import { fixtureFetch } from "../../test-fixtures/plugin-helper/source-fetch"
import { makeRecoveryGate } from "./ext-recovery-gate"
import { existsSync, readFileSync } from "node:fs"
import { parse } from "jsonc-parser"

function persistedMcp(root: string, name: string) {
  return (parse(readFileSync(join(root, "codepuppy.jsonc"), "utf8")) as { mcp?: Record<string, unknown> }).mcp?.[name]
}

async function installerHarness(run: (h: Awaited<ReturnType<typeof sourceHarness>>) => Promise<void>) {
  const temporary = mkdtempSync(join(tmpdir(), "helper-a2-entry-"))
  const previous = process.env.CODEPUPPY_GLOBAL_DIR
  process.env.CODEPUPPY_GLOBAL_DIR = join(temporary, "env", "dev")
  try { await run(await sourceHarness(temporary)) } finally {
    if (previous === undefined) delete process.env.CODEPUPPY_GLOBAL_DIR
    else process.env.CODEPUPPY_GLOBAL_DIR = previous
    rmSync(temporary, { recursive: true, force: true })
  }
}
async function sourceHarness(temporary: string) {
  const { createSourceInstaller } = await import("./install-from-source")
  const sources = createPluginSources({ catalog: async () => [], fetch: fixtureFetch })
  const root = join(temporary, "env", "dev")
  const activation: string[] = []
  const reloads: string[] = []
  const install = createSourceInstaller({ sources, globalRoot: () => root, casBaseRoot: () => temporary, environment: () => "dev", userDataPath: temporary,
    gate: makeRecoveryGate(() => ({})), advisoryGate: () => ({ allowed: true }), resolvePackage: async () => { throw Error("non-catalog must use graph declarations") },
    catalogInstall: async () => ({ ok: false, code: "unknown-id", detail: "no catalog entries in this controlled search" }),
    activateMcp: async (id) => { activation.push(id) }, reloadSkills: (id) => { reloads.push(id) }, removeDeparting: () => {},
  })
  const candidate = async (query: string, source = "claude-marketplace") => (await sources.searchSources(query)).candidates.find((row) => row.source === source)!.id
  const request = (candidateId: string, requestId = "request_a2_01") => ({ requestId, source: { kind: "candidate" as const, candidateId }, effect: { kind: "all-projects" as const }, via: "chat" as const })
  return { install, sources, root, temporary, activation, reloads, candidate, request }
}

test("A2 marketplace context7 commits one real enabled package and durable declarations", () => installerHarness(async (h) => {
  const input = h.request(await h.candidate("context7"))
  const outcome = await h.install(input)
  expect(outcome).toMatchObject({ ok: true, packageId: "claude:context7", source: { kind: "marketplace", ecosystem: "claude" }, installed: [{ kind: "mcp", hostName: "context7", sourceName: "context7" }] })
  const state = readPackageLedgerStateV1(h.root)
  expect(state.ok && state.records.map((record) => record.desiredState)).toEqual(["enabled"])
  expect(state.ok && state.packageGraphs[0]?.declarations?.[0]?.mcp).toMatchObject({ type: "remote", url: "https://mcp.context7.com/mcp?client=claude-code-plugin" })
  expect(readMcpLeafStrict("context7")).toMatchObject({ ok: true, value: { url: "https://mcp.context7.com/mcp?client=claude-code-plugin" } })
  expect(h.activation).toEqual(["claude:context7"])
  expect(h.reloads).toEqual([])
  expect(await h.install(input)).toEqual(outcome)
  expect(await h.install(h.request(input.source.candidateId, "request_a2_02"))).toMatchObject({ ok: true, packageId: "claude:context7", alreadyInstalled: true })
  const after = readPackageLedgerStateV1(h.root)
  expect(after.ok && after.packageGraphs).toHaveLength(1)
}))

test("E3 main rechecks project identity after source capture before committing", () => installerHarness(async (h) => {
  const { mkdirSync, symlinkSync, unlinkSync } = await import("node:fs")
  const first = join(h.temporary, "first")
  const second = join(h.temporary, "second")
  const alias = join(h.temporary, "alias")
  mkdirSync(first)
  mkdirSync(second)
  symlinkSync(first, alias)
  const candidate = await h.candidate("frontend-design")
  const convert = h.sources.convertCandidate
  h.sources.convertCandidate = async (id) => {
    const result = await convert(id)
    unlinkSync(alias)
    symlinkSync(second, alias)
    return result
  }
  expect(await h.install({ ...h.request(candidate), effect: { kind: "project", directory: alias } })).toMatchObject({ ok: false })
  const state = readPackageLedgerStateV1(h.root)
  expect(state.ok && state.packageGraphs).toEqual([])
}))

test("E2 project-only MCP stays globally disabled through install and package-root toggles", () => installerHarness(async (h) => {
  const { mkdirSync, realpathSync, readdirSync, symlinkSync, writeFileSync } = await import("node:fs")
  const { projectScopeIdentity } = await import("./ext-receipt-v2")
  const project = join(h.temporary, "project")
  mkdirSync(project)
  writeFileSync(join(project, "existing.json"), "project bytes\n")
  const alias = join(h.temporary, "project-alias")
  symlinkSync(project, alias)
  const identity = projectScopeIdentity(alias)
  expect(identity.ok).toBe(true)
  if (!identity.ok) throw new Error(identity.reason)
  const outcome = await h.install({ ...h.request(await h.candidate("context7")), effect: { kind: "project", directory: alias } })
  expect(outcome).toMatchObject({ ok: true, packageId: "claude:context7" })
  expect(persistedMcp(h.root, "context7")).toMatchObject({ enabled: false })
  const state = readPackageLedgerStateV1(h.root)
  expect(state.ok && state.packageGraphs[0]?.effect).toEqual(identity.scope)
  expect(state.ok && state.records.every((record) => record.scope.kind === "global" && record.desiredState === "enabled")).toBe(true)
  const deps = { globalRoot: () => h.root, advisoryGate: () => ({ allowed: true as const }), resolvePackage: async () => { throw new Error("non-catalog package") } }
  for (const state of ["disabled", "enabled"] as const) {
    expect((await setPackageStateV1({ packageId: "claude:context7", state }, deps)).ok).toBe(true)
    expect(persistedMcp(h.root, "context7")).toMatchObject({ enabled: false })
  }
  expect(JSON.parse(readFileSync(join(h.root, "skills-enabled.json"), "utf8"))).toEqual({
    v: 2, keys: [], scoped: [{ kind: "mcp", name: "context7", projectPath: realpathSync(project) }],
  })
  expect(readdirSync(project)).toEqual(["existing.json"])
  expect(readFileSync(join(project, "existing.json"), "utf8")).toBe("project bytes\n")
}))

test("E3 remote definition publication retains the project-only disabled projection", () => installerHarness(async (h) => {
  const { mkdirSync } = await import("node:fs")
  const project = join(h.temporary, "remote-project")
  mkdirSync(project)
  expect(await h.install({ ...h.request(await h.candidate("context7")), effect: { kind: "project", directory: project } })).toMatchObject({ ok: true })
  const leaf = readMcpLeafStrict("context7")
  if (!leaf.ok || !leaf.value) throw Error("installed definition missing")
  expect(persistMcp("context7", leaf.value)).toMatchObject({ ok: true })
  expect(persistedMcp(h.root, "context7")).toEqual({ enabled: false })
}))

test("E2 project-only skill is stored globally and projected only as scoped", () => installerHarness(async (h) => {
  const { mkdirSync } = await import("node:fs")
  const { projectScopeIdentity } = await import("./ext-receipt-v2")
  const project = join(h.temporary, "project")
  mkdirSync(project)
  const identity = projectScopeIdentity(project)
  if (!identity.ok) throw new Error(identity.reason)
  const outcome = await h.install({ ...h.request(await h.candidate("frontend-design")), effect: { kind: "project", directory: project } })
  expect(outcome.ok).toBe(true)
  const state = readPackageLedgerStateV1(h.root)
  expect(state.ok && state.packageGraphs[0]?.effect).toEqual(identity.scope)
  expect(JSON.parse(readFileSync(join(h.root, "skills-enabled.json"), "utf8"))).toEqual({
    v: 2, keys: [], scoped: [{ kind: "skill", name: "frontend-design", projectPath: identity.scope.projectPath }],
  })
  expect(existsSync(join(project, ".codepuppy"))).toBe(false)
}))

test("E2 unresolved project identity cannot silently install for all projects", () => installerHarness(async (h) => {
  const outcome = await h.install({ ...h.request(await h.candidate("context7")), effect: { kind: "project", directory: join(h.temporary, "absent") } })
  expect(outcome.ok).toBe(false)
  expect(existsSync(join(h.root, "installs.json"))).toBe(false)
  expect(h.activation).toEqual([])
}))

test("E2 startup reconcile cannot globally enable a project-only MCP", () => installerHarness(async (h) => {
  const { mkdirSync } = await import("node:fs")
  const { reconcileDesiredStateAtBoot } = await import("./ext-install-planner")
  const project = join(h.temporary, "project")
  mkdirSync(project)
  expect((await h.install({ ...h.request(await h.candidate("context7")), effect: { kind: "project", directory: project } })).ok).toBe(true)
  expect(reconcileDesiredStateAtBoot(h.root, { userDataPath: h.temporary, channel: "stable" }).ok).toBe(true)
  expect(persistedMcp(h.root, "context7")).toMatchObject({ enabled: false })
}))

test("A2 host-name collision preserves existing content and rewrites only installed skill name", () => installerHarness(async (h) => {
  const { mkdirSync, writeFileSync } = await import("node:fs")
  mkdirSync(join(h.root, "skills", "frontend-design"), { recursive: true })
  const original = join(h.root, "skills", "frontend-design", "SKILL.md")
  writeFileSync(original, "user owned bytes")
  const outcome = await h.install(h.request(await h.candidate("frontend-design")))
  expect(outcome.ok).toBe(true)
  if (!outcome.ok) throw Error(outcome.detail)
  expect(outcome.installed[0]?.hostName).toMatch(/^frontend-design-[a-f0-9]{8}$/)
  expect(readFileSync(original, "utf8")).toBe("user owned bytes")
  expect(h.reloads).toEqual([outcome.packageId])
  const { readCurrentGeneration } = await import("./ext-transaction")
  // Read the real generation written by the existing builder, not a synthetic probe.
  const current = readCurrentGeneration(h.root, "skill--" + outcome.installed[0]!.hostName)
  expect(current).toBeTruthy()
  expect(readFileSync(join(current!.dir, "SKILL.md"), "utf8")).toContain("name: " + outcome.installed[0]!.hostName)
}))

test("A2 zero runnable package maps diagnostics without writing ledger", () => installerHarness(async (h) => {
  // npm/provenance.json:4 pins this package; the recorded search contains other packages too.
  const selected = (await h.sources.searchSources("skills")).candidates.find((row) => row.source === "opencode-npm" && row.name === "opencode-skills-hub")
  expect(selected).toBeDefined()
  const id = selected!.id
  const outcome = await h.install(h.request(id))
  expect(outcome).toMatchObject({ ok: false, code: "nothing-runnable", notRunning: [{ kind: "plugin", reason: "native-js-plugin" }] })
  expect(existsSync(join(h.root, "installs.json"))).toBe(false)
  expect(h.activation).toEqual([])
}))

test("A2 unknown candidate and conflicting request ID do not create a second package", () => installerHarness(async (h) => {
  expect(await h.install(h.request("not-issued"))).toMatchObject({ ok: false, code: "unknown-id" })
  expect(await h.install(h.request(await h.candidate("context7")))).toMatchObject({ ok: false, code: "unknown-id" })
  expect(existsSync(join(h.root, "installs.json"))).toBe(false)
}))

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

for (const sample of [
  { query: "figma", source: "codex-marketplace", name: "figma", expected: { kind: "marketplace", ecosystem: "codex" } },
  { query: "io.github.github/github-mcp-server", source: "mcp-registry", name: "io.github.github/github-mcp-server", expected: { kind: "mcp-registry", serverName: "io.github.github/github-mcp-server", version: "2.1.0" } },
]) test("A2 shared entry installs pinned " + sample.source + " definitions and retains diagnostics", () => installerHarness(async (h) => {
  const row = (await h.sources.searchSources(sample.query)).candidates.find((row) => row.source === sample.source && row.name === sample.name)
  expect(row).toBeDefined()
  const outcome = await h.install(h.request(row!.id))
  expect(outcome).toMatchObject({ ok: true, source: sample.expected })
  if (!outcome.ok) throw Error(outcome.detail)
  const state = readPackageLedgerStateV1(h.root)
  expect(state.ok && state.records.every((record) => record.desiredState === "enabled")).toBe(true)
  expect(state.ok && state.packageGraphs[0]?.source).toMatchObject(sample.expected)
  if (sample.source === "codex-marketplace") expect(outcome.notRunning).toContainEqual(expect.objectContaining({ kind: "app", reason: "unresolved-app-id" }))
  const { createPackageDeclarationResolver } = await import("./package-declarations")
  expect(await createPackageDeclarationResolver({ root: () => h.root, catalog: async () => { throw Error("non-catalog must not load catalog") } })(outcome.packageId)).toMatchObject({ ok: true, origin: "installed", declarations: state.ok && state.packageGraphs[0]?.declarations })
}))

test("A2 same pinned source with changed real bytes updates its package instead of duplicating", () => installerHarness(async (h) => {
  const id = await h.candidate("context7")
  const first = await h.install(h.request(id))
  expect(first).toMatchObject({ ok: true, packageId: "claude:context7" })
  const before = readPackageLedgerStateV1(h.root)
  const captured = await captureFixture("external_plugins/context7")
  const original = new TextDecoder().decode(await captured.readFile(".mcp.json"))
  const updatedCapture = await captureFixture("external_plugins/context7", { ".mcp.json": original.replace("client=claude-code-plugin", "client=updated-definition") })
  const updated = await convertPluginTree(updatedCapture)
  const { pluginRuntimeIdentity } = await import("./plugin-sources")
  h.sources.convertCandidate = async () => ({ ok: true, ...updated, capture: updatedCapture, runtimeIdentity: pluginRuntimeIdentity(updated.package) })
  expect(await h.install(h.request(id, "request_update_02"))).toMatchObject({ ok: true, packageId: "claude:context7" })
  const after = readPackageLedgerStateV1(h.root)
  expect(after.ok && after.packageGraphs).toHaveLength(1)
  expect(after.ok && before.ok && after.packageGraphs[0]!.installedGraphDigest).not.toBe(before.ok && before.packageGraphs[0]!.installedGraphDigest)
  expect(readMcpLeafStrict("context7")).toMatchObject({ ok: true, value: { url: "https://mcp.context7.com/mcp?client=updated-definition" } })
  expect(after.ok && after.records.map((record) => record.desiredState)).toEqual(["enabled"])
}))
