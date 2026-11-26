import { pluginDataDirectory } from "../shared/installed-plugin-settings"
import { sha256Hex } from "./ext-manifest-v2"
import { expect, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureFixture, captureWholeFixture, captureStandardFixture, fixtureRoot } from "../../test-fixtures/plugin-helper/fixture"
import { convertPluginTree } from "../shared/host-extension-package-contract/plugin-conversion.mjs"
import { buildSkillTxItems } from "./ext-package-tx-builders"
import { promotePayloadToCas, setPackageStateV1, removeInstallGrants } from "./ext-install-planner"
import { computeInstalledGraphDigest, type PackageGraphV1 } from "./ext-package-ledger-v3"
import { diffPackageGraphsV1, planPackageClaimTransferV1 } from "./ext-package-lifecycle"
import { commitTransactionLedger } from "./ext-package-ledger-commit"
import { readPackageLedgerStateV1, type UpsertInput } from "./ext-receipt-v2"
import { runExtensionTransaction } from "./ext-transaction"
import { persistMcp, readMcpLeafStrict } from "./ext-config"
import { createPluginSources } from "./plugin-sources"
import { fixtureFetch } from "../../test-fixtures/plugin-helper/source-fetch"
import { makeRecoveryGate } from "./ext-recovery-gate"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { parse } from "jsonc-parser"
import { resolveLiveGenerationDir } from "./ext-transaction"

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
  const fetched: string[] = []
  const sources = createPluginSources({ catalog: async () => [], fetch: (url) => { fetched.push(String(url)); return fixtureFetch(url) } })
  const root = join(temporary, "env", "dev")
  const activation: string[] = []
  const reloads: string[] = []
  const install = createSourceInstaller({ sources, globalRoot: () => root, casBaseRoot: () => temporary, environment: () => "dev", userDataPath: temporary,
    dataHome: () => join(temporary, "data"), gate: makeRecoveryGate(() => ({})), advisoryGate: () => ({ allowed: true }), resolvePackage: async () => { throw Error("non-catalog must use graph declarations") },
    catalogInstall: async () => ({ ok: false, code: "unknown-id", detail: "no catalog entries in this controlled search" }),
    activateMcp: async (id) => { activation.push(id) }, reloadSkills: (id) => { reloads.push(id) }, removeDeparting: () => {},
  })
  const candidate = async (query: string, source = "claude-marketplace") => (await sources.searchSources(query)).candidates.find((row) => row.source === source)!.id
  const request = (candidateId: string, requestId = "request_a2_01") => ({ requestId, source: { kind: "candidate" as const, candidateId }, effect: { kind: "all-projects" as const }, via: "chat" as const })
  const installAndApply = async (request: Parameters<typeof install>[0]) => {
    const result = await install(request)
    await new Promise<void>(resolve => setImmediate(resolve))
    return result
  }
  return { install: installAndApply, installContent: install, sources, root, temporary, activation, reloads, candidate, request, fetched }
}

test("whole plugin skills retain sibling directories and root resources", () => installerHarness(async h => {
  const capture = await captureWholeFixture("plugin-dev", path => path.endsWith("/SKILL.md") || path === ".claude-plugin/plugin.json" || path === "README.md" || path === "skills/hook-development/scripts/hook-linter.sh")
  const converted = await convertPluginTree(capture)
  h.sources.convertCandidate = async () => ({ ok: true, ...converted, capture, runtimeIdentity: undefined })
  const outcome = await h.install(h.request("real_plugin_dev"))
  expect(outcome.ok && outcome.installed.filter(entry => entry.kind === "skill")).toHaveLength(7)
  expect(outcome.ok && outcome.notRunning.filter(entry => entry.reason === "needs-plugin-files")).toEqual([])
  const state = readPackageLedgerStateV1(h.root)
  if (!state.ok) throw Error(state.reason)
  const graph = state.packageGraphs[0]!
  expect(graph.root.kind).toBe("bundle")
  const resource = (graph as typeof graph & { pluginTree: { storeKey: string } }).pluginTree
  const live = resolveLiveGenerationDir(h.root, resource.storeKey)!
  expect(readFileSync(join(live, "tree/README.md"))).toEqual(Buffer.from(await capture.readFile("README.md")))
  expect(readFileSync(join(live, "tree/skills/skill-development/../hook-development/SKILL.md"), "utf8")).toBe(new TextDecoder().decode(await capture.readFile("skills/hook-development/SKILL.md")).replace("name: hook-development", "name: " + graph.children.find(node => node.name.startsWith("hook-development-"))!.name))
}))

test("plugin-dev installs commands and agents from the same live bundle", () => installerHarness(async h => {
  const capture = await captureStandardFixture("claude:plugin-dev")
  const converted = await convertPluginTree(capture)
  h.sources.convertCandidate = async () => ({ ok: true, ...converted, capture, runtimeIdentity: undefined })
  const outcome = await h.install(h.request("real_plugin_dev_invocation"))
  expect(outcome.ok).toBe(true)
  if (!outcome.ok) throw new Error(outcome.detail)
  expect(outcome.installed.filter(entry => entry.kind === "command")).toHaveLength(1)
  expect(outcome.installed.filter(entry => entry.kind === "agent")).toHaveLength(3)
  expect(outcome.notRunning.filter(entry => entry.kind === "command" || entry.kind === "agent")).toEqual([])
  const state = readPackageLedgerStateV1(h.root)
  if (!state.ok) throw new Error(state.reason)
  const graph = state.packageGraphs.find(graph => graph.packageId === outcome.packageId)!
  const live = resolveLiveGenerationDir(h.root, graph.pluginTree!.storeKey)!
  for (const entry of converted.package.entries.filter(entry => entry.kind === "command" || entry.kind === "agent")) {
    expect(readFileSync(join(live, "tree", entry.sourcePath), "utf8")).toBe(new TextDecoder().decode(await capture.readFile(entry.sourcePath)))
    expect(graph.declarations).toContainEqual(expect.objectContaining({ kind: entry.kind, sourceName: entry.sourceName }))
  }
  const keys = () => JSON.parse(readFileSync(join(h.root, "skills-enabled.json"), "utf8")).keys as string[]
  expect(keys().filter(key => key.startsWith("command--") || key.startsWith("agent--"))).toHaveLength(4)
  expect((await setPackageStateV1({ packageId: outcome.packageId, state: "disabled" }, { globalRoot: () => h.root, advisoryGate: () => ({ allowed: true }), resolvePackage: async () => { throw Error("direct source") } })).ok).toBe(true)
  expect(keys().filter(key => key.startsWith("command--") || key.startsWith("agent--"))).toEqual([])
}))

test("whole plugin remotion enables real cross-skill references", () => installerHarness(async h => {
  const capture = await captureWholeFixture("remotion", path => path === ".codex-plugin/plugin.json" || ["remotion-create", "remotion-best-practices"].some(name => path === "skills/" + name + "/SKILL.md"))
  const converted = await convertPluginTree(capture)
  h.sources.convertCandidate = async () => ({ ok: true, ...converted, capture, runtimeIdentity: undefined })
  const outcome = await h.install(h.request("real_remotion"))
  expect(outcome.ok && outcome.installed.map(entry => entry.sourceName).sort()).toEqual(["remotion-best-practices", "remotion-create"])
  expect(outcome.ok && outcome.notRunning).toEqual([])
}))

test("whole plugin removal deletes its owned tree without treating member skills as flat installs", () => installerHarness(async h => {
  const { uninstallPackageV1 } = await import("./ext-package-uninstall")
  const capture = await captureWholeFixture("superpowers", path => path === ".claude-plugin/plugin.json" || path === "skills/using-superpowers/SKILL.md")
  const converted = await convertPluginTree(capture)
  h.sources.convertCandidate = async () => ({ ok: true, ...converted, capture, runtimeIdentity: undefined })
  const installed = await h.install(h.request("real_owned_tree", "whole_remove"))
  if (!installed.ok) throw Error(installed.detail)
  const before = readPackageLedgerStateV1(h.root)
  if (!before.ok) throw Error(before.reason)
  const graph = before.packageGraphs[0]!
  const store = join(h.root, "ext-store", graph.pluginTree!.storeKey)
  const data = pluginDataDirectory(join(h.temporary, "data"), installed.packageId)
  expect(statSync(data).mode & 0o777).toBe(0o700)
  writeFileSync(join(data, "state"), "persistent")
  const neighbor = pluginDataDirectory(join(h.temporary, "data"), "claude:neighbor-package")
  mkdirSync(neighbor)
  writeFileSync(join(neighbor, "state"), "neighbor")
  const outside = join(h.temporary, "outside")
  mkdirSync(outside)
  writeFileSync(join(outside, "retained"), "unrelated")
  symlinkSync(outside, join(data, "link"))
  expect((await setPackageStateV1({ packageId: installed.packageId, state: "disabled" }, { globalRoot: () => h.root, environment: () => "dev", advisoryGate: () => ({ allowed: true }), resolvePackage: async () => { throw Error("not catalog") } })).ok).toBe(true)
  expect(readFileSync(join(data, "state"), "utf8")).toBe("persistent")
  const flat = join(h.root, "skills/using-superpowers/SKILL.md")
  mkdirSync(join(h.root, "skills/using-superpowers"), { recursive: true })
  const bytes = Buffer.from(await capture.readFile("skills/using-superpowers/SKILL.md"))
  writeFileSync(flat, bytes)
  const unused = () => { throw Error("No independent component files may be removed") }
  expect(uninstallPackageV1(installed.packageId, { globalRoot: () => h.root, installers: { removeFsInstall: unused, removeMcpConfig: unused, removeCommandConfig: unused, removeMcpSecretsStrict: unused, releaseCodePuppyConnectionBindings: unused, removePluginPath: unused, removeInstallGrants } })).toMatchObject({ ok: true })
  expect(existsSync(store)).toBe(false)
  expect(existsSync(data)).toBe(false)
  expect(readFileSync(join(neighbor, "state"), "utf8")).toBe("neighbor")
  expect(readFileSync(join(outside, "retained"), "utf8")).toBe("unrelated")
  expect(readFileSync(flat)).toEqual(bytes)
  const after = readPackageLedgerStateV1(h.root)
  expect(after.ok && after.records).toEqual([])
  expect(after.ok && after.packageGraphs).toEqual([])
}))

test("A2 marketplace context7 commits one real enabled package and durable declarations", () => installerHarness(async (h) => {
  const input = h.request(await h.candidate("context7"))
  const outcome = await h.install(input)
  expect(outcome).toMatchObject({ ok: true, packageId: "claude:context7", source: { kind: "marketplace", ecosystem: "claude" }, installed: [{ kind: "mcp", hostName: "context7-de6dee1ccd", sourceName: "context7" }] })
  const state = readPackageLedgerStateV1(h.root)
  expect(state.ok && state.records.map((record) => record.desiredState)).toEqual(["enabled", "enabled"])
  expect(state.ok && state.packageGraphs[0]?.declarations?.[0]?.mcp).toMatchObject({ type: "remote", url: "https://mcp.context7.com/mcp?client=claude-code-plugin" })
  expect(readMcpLeafStrict("context7-de6dee1ccd")).toMatchObject({ ok: true, value: { url: "https://mcp.context7.com/mcp?client=claude-code-plugin" } })
  expect(h.activation).toEqual(["claude:context7"])
  expect(h.reloads).toEqual(["claude:context7"])
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
  expect(persistedMcp(h.root, "context7-de6dee1ccd")).toMatchObject({ enabled: false })
  const state = readPackageLedgerStateV1(h.root)
  expect(state.ok && state.packageGraphs[0]?.effect).toEqual(identity.scope)
  expect(state.ok && state.records.every((record) => record.scope.kind === "global" && record.desiredState === "enabled")).toBe(true)
  const deps = { globalRoot: () => h.root, advisoryGate: () => ({ allowed: true as const }), resolvePackage: async () => { throw new Error("non-catalog package") } }
  for (const state of ["disabled", "enabled"] as const) {
    expect((await setPackageStateV1({ packageId: "claude:context7", state }, deps)).ok).toBe(true)
    expect(persistedMcp(h.root, "context7-de6dee1ccd")).toMatchObject({ enabled: false })
  }
  expect(JSON.parse(readFileSync(join(h.root, "skills-enabled.json"), "utf8"))).toEqual({
    v: 3, keys: [], scoped: [
      { kind: "bundle", name: state.ok && state.packageGraphs[0]!.root.name, projectPath: realpathSync(project) },
      { kind: "mcp", name: "context7-de6dee1ccd", projectPath: realpathSync(project) },
    ], mcp: [{ name: "context7-de6dee1ccd", enabled: false }],
  })
  expect(readdirSync(project)).toEqual(["existing.json"])
  expect(readFileSync(join(project, "existing.json"), "utf8")).toBe("project bytes\n")
}))

test("E3 remote definition publication retains the project-only disabled projection", () => installerHarness(async (h) => {
  const { mkdirSync } = await import("node:fs")
  const project = join(h.temporary, "remote-project")
  mkdirSync(project)
  expect(await h.install({ ...h.request(await h.candidate("context7")), effect: { kind: "project", directory: project } })).toMatchObject({ ok: true })
  const leaf = readMcpLeafStrict("context7-de6dee1ccd")
  if (!leaf.ok || !leaf.value) throw Error("installed definition missing")
  expect(persistMcp("context7-de6dee1ccd", leaf.value)).toMatchObject({ ok: true })
  expect(persistedMcp(h.root, "context7-de6dee1ccd")).toEqual({ enabled: false })
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
    v: 3, keys: [], scoped: [
      { kind: "bundle", name: state.ok && state.packageGraphs[0]!.root.name, projectPath: identity.scope.projectPath },
      { kind: "skill", name: "frontend-design-3ee253227f", projectPath: identity.scope.projectPath },
    ], mcp: [],
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
  expect(persistedMcp(h.root, "context7-de6dee1ccd")).toMatchObject({ enabled: false })
}))

test("A2 host-name collision preserves existing content and rewrites only installed skill name", () => installerHarness(async (h) => {
  const { mkdirSync, writeFileSync } = await import("node:fs")
  mkdirSync(join(h.root, "skills", "frontend-design"), { recursive: true })
  const original = join(h.root, "skills", "frontend-design", "SKILL.md")
  writeFileSync(original, "user owned bytes")
  const outcome = await h.install(h.request(await h.candidate("frontend-design")))
  expect(outcome.ok).toBe(true)
  if (!outcome.ok) throw Error(outcome.detail)
  expect(outcome.installed[0]?.hostName).toMatch(/^frontend-design-[a-f0-9]{10}$/)
  expect(readFileSync(original, "utf8")).toBe("user owned bytes")
  expect(h.reloads).toEqual([outcome.packageId])
  const { readCurrentGeneration } = await import("./ext-transaction")
  const state = readPackageLedgerStateV1(h.root)
  if (!state.ok) throw Error(state.reason)
  const current = readCurrentGeneration(h.root, state.packageGraphs[0]!.pluginTree!.storeKey)
  expect(current).toBeTruthy()
  expect(readFileSync(join(current!.dir, "tree/skills/frontend-design/SKILL.md"), "utf8")).toContain("name: " + outcome.installed[0]!.hostName)
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

// I-15(alpha-code#1726 审查):取得的来源字节不陪应用跑到退出 —— 一次安装结束(成功或失败)就放掉;
// 同一候选再装时重新取源。去掉释放 ⇒ 第二次安装命中旧缓存、下载计数不涨,当场红。
test("I-15 a finished install releases the fetched source bytes, success or failure; installing the same candidate again fetches again", () => installerHarness(async (h) => {
  const archives = () => h.fetched.filter((url) => url.startsWith("https://codeload.github.com/")).length
  const id = await h.candidate("context7")
  expect(await h.install(h.request(id))).toMatchObject({ ok: true, packageId: "claude:context7" })
  expect(archives()).toBe(1)
  expect(await h.install(h.request(id, "request_a2_02"))).toMatchObject({ ok: true, packageId: "claude:context7", alreadyInstalled: true })
  expect(archives()).toBe(2)
  const npm = (await h.sources.searchSources("skills")).candidates.find((row) => row.source === "opencode-npm" && row.name === "opencode-skills-hub")!.id
  const tarballs = () => h.fetched.filter((url) => url.endsWith(".tgz")).length
  expect(await h.install(h.request(npm, "request_a2_03"))).toMatchObject({ ok: false, code: "nothing-runnable" })
  expect(tarballs()).toBe(1)
  expect(await h.install(h.request(npm, "request_a2_04"))).toMatchObject({ ok: false, code: "nothing-runnable" })
  expect(tarballs()).toBe(2)
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
  expect(readMcpLeafStrict("context7-de6dee1ccd")).toMatchObject({ ok: true, value: { url: "https://mcp.context7.com/mcp?client=updated-definition" } })
  expect(after.ok && after.records.map((record) => record.desiredState)).toEqual(["enabled", "enabled"])
}))

function ownDraft(searchId: string, name = "own-report") {
  return { searchId, name, description: "My report format", files: [{ path: "skills/report/SKILL.md", text: "---\nname: report\ndescription: My report format\n---\nApply my report format.\n" }] }
}

test("D3 completed real source search admits an own package despite unrelated candidates", () => installerHarness(async (h) => {
  const search = await h.sources.searchSources("frontend-design")
  expect(search.sources.every((source) => source.status === "ok")).toBe(true)
  expect(search.candidates.length).toBeGreaterThan(0)
  const result = await h.install({ ...h.request("unused"), source: { kind: "created", draft: ownDraft(search.searchId) } })
  expect(result).toMatchObject({ ok: true, packageId: "mine:own-report", source: { kind: "created" } })
  const state = readPackageLedgerStateV1(h.root)
  expect(state.ok && state.records.every((record) => record.origin === "created" && record.desiredState === "enabled")).toBe(true)
  expect(state.ok && state.packageGraphs).toHaveLength(1)
  expect(h.reloads).toEqual(["mine:own-report"])
  const second = await h.install({ ...h.request("unused", "create_second"), source: { kind: "created", draft: ownDraft(search.searchId, "another-report") } })
  expect(second).toMatchObject({ ok: true, packageId: "mine:another-report" })
  const after = readPackageLedgerStateV1(h.root)
  expect(after.ok && after.packageGraphs).toHaveLength(2)
}))

test("D3 unknown, incomplete and failed search records deny creation without ledger or generation writes", () => installerHarness(async (h) => {
  const snapshot = (directory: string): unknown => readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).map(entry => entry.isDirectory() ? [entry.name, snapshot(join(directory, entry.name))] : [entry.name, sha256Hex(readFileSync(join(directory, entry.name)))])
  const before = snapshot(h.temporary)
  const search = await h.sources.searchSources("frontend-design")
  for (const [requestId, searchId] of [["create_unknown", "unknown"], ["create_missing", search.searchId], ["create_failed", search.searchId]]) {
    if (requestId === "create_missing") h.sources.searchedSources = () => search.sources.slice(1)
    if (requestId === "create_failed") h.sources.searchedSources = () => search.sources.map((source, index) => index ? source : { source: source.source, status: "failed", reason: "network", detail: "recorded source failure" })
    expect(await h.install({ ...h.request("unused", requestId), source: { kind: "created", draft: ownDraft(searchId) } })).toMatchObject({ ok: false, code: "not-searched" })
    expect(existsSync(join(h.root, "installs.json"))).toBe(false)
    expect(existsSync(join(h.root, "ext-store"))).toBe(false)
    expect(snapshot(h.temporary)).toEqual(before)
  }
}))

test("D3 a malformed draft does not write and project-only creation uses the same scope path", () => installerHarness(async (h) => {
  const { mkdirSync, readdirSync } = await import("node:fs")
  const search = await h.sources.searchSources("frontend-design")
  expect(await h.install({ ...h.request("unused", "create_bad"), source: { kind: "created", draft: { ...ownDraft(search.searchId), files: [{ path: "../escape", text: "x" }] } } })).toMatchObject({ ok: false, code: "invalid-draft" })
  expect(existsSync(join(h.root, "installs.json"))).toBe(false)
  const project = join(h.temporary, "created-project")
  mkdirSync(project)
  expect(await h.install({ ...h.request("unused", "create_scoped"), source: { kind: "created", draft: ownDraft(search.searchId) }, effect: { kind: "project", directory: project } })).toMatchObject({ ok: true, source: { kind: "created" } })
  const state = readPackageLedgerStateV1(h.root)
  expect(state.ok && state.packageGraphs[0]?.effect).toMatchObject({ kind: "project" })
  expect(readdirSync(project)).toEqual([])
}))

test("BC2a real local package captures install through the entry without replacing another local package", () => installerHarness(async h => {
  const { mkdirSync, writeFileSync } = await import("node:fs")
  const { dirname } = await import("node:path")
  for (const [sample, name] of [["plugins/frontend-design", "frontend-design"], ["external_plugins/context7", "context7"]]) {
    const original = await captureFixture(sample!)
    const directory = join(h.temporary, name!)
    for (const node of original.nodes) {
      if (node.kind !== "file") continue
      mkdirSync(dirname(join(directory, node.path)), { recursive: true })
      writeFileSync(join(directory, node.path), await original.readFile(node.path))
    }
    const captured = await h.sources.captureFolder(directory)
    const prepared = await h.sources.prepareCapture(captured)
    expect(prepared.kind).toBe("package")
    if (prepared.kind !== "package") throw Error("expected single package")
    expect(JSON.stringify(prepared)).not.toContain(directory)
    expect(await h.install(h.request(prepared.candidateId, "bc2_local_" + name))).toMatchObject({ ok: true, packageId: "local:" + name, source: { kind: "local-folder" } })
    const file = original.nodes.find(node => node.kind === "file")!
    expect(await captured.readFile(file.path)).toEqual(await original.readFile(file.path))
  }
  const state = readPackageLedgerStateV1(h.root)
  expect(state.ok && state.packageGraphs.map(graph => graph.packageId).sort()).toEqual(["local:context7", "local:frontend-design"])
  expect(state.ok && state.records.every(record => record.desiredState === "enabled")).toBe(true)
}))

test("BC2a pinned marketplace prepares opaque choices and only the selected real subtree installs", () => installerHarness(async h => {
  const { fixtureCommit } = await import("../../test-fixtures/plugin-helper/fixture")
  const captured = await h.sources.captureGit("https://github.com/anthropics/claude-plugins-official", "refs/heads/main")
  expect(captured.source.commit).toBe(fixtureCommit)
  const prepared = await h.sources.prepareCapture(captured)
  expect(prepared.kind).toBe("marketplace")
  if (prepared.kind !== "marketplace") throw Error("expected marketplace choices")
  const selected = prepared.entries.find(entry => entry.displayName === "context7")!
  expect(selected).toBeDefined()
  expect(prepared.entries.some(entry => entry.displayName === "playwright")).toBe(true)
  expect(readPackageLedgerStateV1(h.root)).toMatchObject({ ok: true, records: [] })
  const converted = await h.sources.convertCandidate(selected.id)
  expect(converted.ok && converted.capture.nodes.some(node => node.path.startsWith("external_plugins/"))).toBe(false)
  expect(await h.install(h.request(selected.id, "bc2_selected_context7"))).toMatchObject({ ok: true, packageId: "claude:context7" })
  const state = readPackageLedgerStateV1(h.root)
  expect(state.ok && state.packageGraphs.map(graph => graph.packageId)).toEqual(["claude:context7"])
  expect(state.ok && state.records.map(record => record.name)).toEqual([state.ok && state.packageGraphs[0]!.root.name, "context7-de6dee1ccd"])
  expect(h.activation).toEqual(["claude:context7"])
  expect(h.reloads).toEqual(["claude:context7"])
}))

test("BC2a captured local bytes remain usable after the original directory moves and source bytes stay unchanged", () => installerHarness(async h => {
  const { cpSync, renameSync } = await import("node:fs")
  const { fixtureRoot } = await import("../../test-fixtures/plugin-helper/fixture")
  const directory = join(h.temporary, "selected-source")
  cpSync(join(fixtureRoot, "plugins/frontend-design"), directory, { recursive: true })
  const captured = await h.sources.captureFolder(directory)
  const prepared = await h.sources.prepareCapture(captured)
  expect(prepared.kind).toBe("package")
  if (prepared.kind !== "package") throw Error("expected package")
  const moved = join(h.temporary, "source-moved")
  renameSync(directory, moved)
  expect(await h.install(h.request(prepared.candidateId, "bc2_moved_source"))).toMatchObject({ ok: true, packageId: "local:frontend-design" })
  for (const node of captured.nodes.filter(node => node.kind === "file"))
    expect(await Bun.file(join(moved, node.path)).bytes()).toEqual(await captured.readFile(node.path))
  expect(existsSync(directory)).toBe(false)
}))

test("R12 A4 identical package bytes update the same identity when the requested effect changes",()=>installerHarness(async h=>{
 const {mkdirSync,realpathSync,readdirSync}=await import("node:fs")
 const a=join(h.temporary,"project-a"),b=join(h.temporary,"project-b")
 mkdirSync(a);mkdirSync(b)
 const id=await h.candidate("frontend-design")
 const first=await h.install({...h.request(id,"r12_effect_a"),effect:{kind:"project",directory:a}})
 expect(first).toMatchObject({ok:true,packageId:"claude:frontend-design"})
 const global=await h.install(h.request(id,"r12_effect_all"))
 expect(global).toMatchObject({ok:true,packageId:"claude:frontend-design"})
 const all=readPackageLedgerStateV1(h.root)
 expect(all.ok&&all.packageGraphs).toHaveLength(1)
 expect(all.ok&&all.packageGraphs[0]!.effect).toBeUndefined()
 const next=await h.install({...h.request(id,"r12_effect_b"),effect:{kind:"project",directory:b}})
 expect(next).toMatchObject({ok:true,packageId:"claude:frontend-design"})
 const state=readPackageLedgerStateV1(h.root)
 expect(state.ok&&state.packageGraphs[0]!.effect?.projectPath).toBe(realpathSync(b))
 expect(state.ok&&state.records.every(record=>record.scope.kind==="global"&&record.desiredState==="enabled")).toBe(true)
 expect(await h.install({...h.request(id,"r12_effect_b_again"),effect:{kind:"project",directory:b}})).toMatchObject({ok:true,alreadyInstalled:true,packageId:"claude:frontend-design"})
 expect(readdirSync(a)).toEqual([]);expect(readdirSync(b)).toEqual([])
}))

test("R12 A5 command agent and connected package hooks retain whole package content", () => installerHarness(async h => {
  for (const [name, kinds] of [["explanatory-output-style", []], ["pr-review-toolkit", []]] as const) {
    const result = await h.install(h.request(await h.candidate(name), "r12_unsupported_" + name))
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw Error("expected content installation")
    expect(result.notRunning.map(entry => entry.kind).sort()).toEqual([...kinds].sort())
    expect(result.notRunning.every(entry => entry.reason === "kind-not-supported-yet" && !!entry.sourceName)).toBe(true)
  }
  const state = readPackageLedgerStateV1(h.root)
  expect(state.ok && state.packageGraphs).toHaveLength(2)
  expect(state.ok && state.records.filter(record => record.kind === "bundle")).toHaveLength(2)
  expect(state.ok && state.records.filter(record => record.kind === "command")).toHaveLength(1)
  expect(state.ok && state.records.filter(record => record.kind === "agent")).toHaveLength(6)
}))

test("R14 A6 an unresolved environment URL preserves installed content until runtime binding", () => installerHarness(async h => {
 const capture=await captureFixture("external_plugins/context7")
 const definition=JSON.parse(new TextDecoder().decode(await capture.readFile(".mcp.json")))
 const prepared=await h.sources.prepareCapture(await captureFixture("external_plugins/context7",{".mcp.json":JSON.stringify({...definition,mcpServers:{...definition.mcpServers,context7:{...definition.mcpServers.context7,url:"${WHOLE_URL}",oauth:false}}})}))
 if(prepared.kind!=="package")throw Error("expected a real package variant")
 const installed=await h.install(h.request(prepared.candidateId,"r14_remote_publish"))
 expect(installed).toMatchObject({ok:true})
 const state=readPackageLedgerStateV1(h.root)
 expect(state.ok&&state.packageGraphs).toHaveLength(1)
 if(!installed.ok)throw Error(installed.detail)
 expect(readMcpLeafStrict(installed.installed[0]!.hostName)).toMatchObject({ok:true,value:{url:"${WHOLE_URL}"}})
}))

for(const kind of ["agent","command"] as const)test("R14 A7 catalog "+kind+" schedules a non-force content reload",()=>installerHarness(async h=>{
 const {mixedBundleFixture}=await import("../../test-component/package-mixed-bundle.fixture")
 const {installCatalogFromSource}=await import("./install-from-source")
 const {resolveVerifiedPackageV1}=await import("./package-installability")
 const {sha256Hex}=await import("./ext-manifest-v2")
 const fixture=mixedBundleFixture()
 const component=fixture.envelope.components.find(component=>component.profileId===kind)!
 const envelope={...fixture.envelope,root:component.id,components:[{...component,required:true,dependencies:[]}],capabilities:component.capabilities}
 const catalog={version:"r14",entries:[],packages:[envelope]}
 const fetchBytes=async(ref:{sha256:string})=>{const bytes=fixture.payloadByDigest.get(ref.sha256)??fixture.assetByDigest.get(ref.sha256);if(!bytes)throw Error("fixture digest missing");return bytes}
 const planner={globalRoot:()=>h.root,resolveEntry:async()=>null,advisoryGate:()=>({allowed:true}),resolvePackage:async(id:string,version:string)=>resolveVerifiedPackageV1(catalog,id,version)}
 const admission={root:()=>h.root,userDataPath:h.temporary,casBaseRoot:()=>h.temporary,environment:()=>"dev" as const,loadVerifiedCatalog:async()=>({source:"remote" as const,catalog,snapshotDigest:sha256Hex(JSON.stringify(catalog))}),installability:{fetchPayload:fetchBytes},fetchAsset:fetchBytes}
 const reloads:string[]=[]
 const {createSourceInstaller}=await import("./install-from-source")
 const installer=createSourceInstaller({globalRoot:()=>h.root,casBaseRoot:()=>h.temporary,environment:()=>"dev",userDataPath:h.temporary,sources:h.sources,advisoryGate:planner.advisoryGate,resolvePackage:planner.resolvePackage as never,activateMcp:async()=>[],reloadSkills:id=>{reloads.push(id)},removeDeparting:()=>{},catalogInstall:(id,request)=>installCatalogFromSource(id,request,{planner:planner as never,admission,activateMcp:async()=>[],reloadSkills:()=>{},removeDeparting:()=>{}})})
 const result=await installer({requestId:"r14_reload_"+kind,source:{kind:"catalog",catalogId:envelope.prelude.packageId},effect:{kind:"all-projects"},via:"chat"})
 expect(result).toMatchObject({ok:true})
 expect(reloads).toEqual([])
 await new Promise<void>(resolve=>setImmediate(resolve))
 expect(reloads).toEqual([envelope.prelude.packageId])
}))


test("review C5 one real multi-component transaction rolls back a mid-populate failure and commits one identity", () => installerHarness(async h => {
  const id = await h.candidate("figma", "codex-marketplace")
  const converted = await h.sources.convertCandidate(id)
  if (!converted.ok) throw Error(converted.detail)
  expect(converted.package.entries.some(entry => entry.kind === "skill")).toBe(true)
  expect(converted.package.entries.some(entry => entry.kind === "mcp")).toBe(true)
  const transactions = await import("./ext-transaction")
  const real = transactions.runExtensionTransaction
  let populated = 0
  const probe = spyOn(transactions, "runExtensionTransaction").mockImplementation((root, request, hooks) => real(root, request, {
    ...hooks,
    populate: async (item, directory) => {
      await hooks.populate(item, directory)
      // The whole-tree generation is staged before receipt-only skills and MCP config.
      populated++
      throw Error("controlled skill populate failure after MCP staging")
    },
  }))
  try {
    expect(await h.install(h.request(id, "c5_failed"))).toMatchObject({ ok: false, code: "transaction-failed" })
    expect(populated).toBe(1)
    expect(probe.mock.calls[0]![1].items.map(item => item.action)).toEqual([undefined, "receipt", "file", "config"])
    expect(probe).toHaveBeenCalledTimes(1)
    const failed = readPackageLedgerStateV1(h.root)
    expect(failed.ok && failed.records).toEqual([])
    expect(failed.ok && failed.packageGraphs).toEqual([])
    expect(h.activation).toEqual([])
  } finally { probe.mockRestore() }
  const result = await h.install(h.request(id, "c5_success"))
  expect(result.ok).toBe(true)
  const state = readPackageLedgerStateV1(h.root)
  if (!state.ok || !result.ok) throw Error("real multi-component package not committed")
  expect(state.packageGraphs).toHaveLength(1)
  expect(state.records).toHaveLength(result.installed.length + 1)
  expect(state.records.length).toBeGreaterThan(1)
  expect(new Set(state.records.map(record => record.transaction?.id)).size).toBe(1)
  expect(state.records[0]!.transaction?.id).toBeTruthy()
  expect(state.records.map(record => record.kind).sort()).toEqual(["bundle", "mcp", "skill"])
}))

test("review C5 an existing user MCP keeps its name and bytes when a real same-name plugin installs", () => installerHarness(async h => {
  const id = await h.candidate("context7")
  const converted = await h.sources.convertCandidate(id)
  if (!converted.ok) throw Error(converted.detail)
  const entry = converted.package.entries.find(entry => entry.kind === "mcp")!
  if (entry.kind !== "mcp" || entry.transport === "stdio") throw Error("pinned context7 must remain a remote MCP")
  const user = { type: "remote", url: entry.url.join(""), oauth: false }
  expect(persistMcp("context7", user)).toMatchObject({ ok: true })
  const before = readMcpLeafStrict("context7")
  const result = await h.install(h.request(id, "c5_collision"))
  if (!result.ok) throw Error(result.detail)
  expect(result.installed).toHaveLength(1)
  expect(result.installed[0]!.hostName).toMatch(/^context7-[a-f0-9]{10}$/)
  expect(readMcpLeafStrict("context7")).toEqual(before)
  expect(readMcpLeafStrict(result.installed[0]!.hostName)).toMatchObject({ ok: true })
  const state = readPackageLedgerStateV1(h.root)
  expect(state.ok && state.records.map(record => record.name)).toEqual([state.ok && state.packageGraphs[0]!.root.name, result.installed[0]!.hostName])
  expect(state.ok && state.packageGraphs[0]!.children[0]!.name).toBe(result.installed[0]!.hostName)
}))


test("review AC11 local marketplace folder installs only the selected real plugin", () => installerHarness(async h => {
  const { mkdirSync } = await import("node:fs")
  const provenance = await Bun.file(join(import.meta.dir, "../../test-fixtures/plugin-helper/provenance.json")).json()
  const directory = join(h.temporary, "local-marketplace")
  for (const file of provenance.files as { path: string }[]) {
    const target = join(directory, file.path)
    mkdirSync(join(target, ".."), { recursive: true })
    await Bun.write(target, Bun.file(join(fixtureRoot, file.path)))
  }
  const prepared = await h.sources.prepareCapture(await h.sources.captureFolder(directory))
  if (prepared.kind !== "marketplace") throw Error("pinned local marketplace not recognized")
  expect(prepared.entries.length).toBeGreaterThan(300)
  const selected = prepared.entries.find(entry => entry.displayName === "context7")!
  expect(selected).toBeDefined()
  const before = readPackageLedgerStateV1(h.root)
  expect(before.ok && before.records).toEqual([])
  const result = await h.install(h.request(selected.id, "c11_folder_selected"))
  if (!result.ok) throw Error(result.detail)
  const state = readPackageLedgerStateV1(h.root)
  if (!state.ok) throw Error(state.reason)
  expect(state.packageGraphs.map(graph => graph.packageId)).toEqual([result.packageId])
  expect(state.records.filter(record => record.kind !== "bundle").map(record => record.name)).toEqual(result.installed.map(entry => entry.hostName))
  expect(result.source).toEqual({ kind: "local-folder" })
  expect(h.activation).toEqual([result.packageId])
  expect(h.reloads).toEqual([result.packageId])
  expect(state.records.some(record => ["github", "playwright", "frontend-design"].includes(record.name))).toBe(false)
}))


test("folder and Git use the whole plugin tree", () => installerHarness(async h => {
  const capture = await captureWholeFixture("plugin-dev", path => path.endsWith("/SKILL.md") || path === ".claude-plugin/plugin.json" || path === "README.md")
  for (const kind of ["folder", "git"] as const) {
    const source = { ...capture, source: { ...capture.source, kind, locator: kind + "-real-plugin-dev" } }
    const converted = await convertPluginTree(source)
    h.sources.convertCandidate = async () => ({ ok: true, ...converted, capture: source, runtimeIdentity: undefined })
    const outcome = await h.install(h.request(kind + "_plugin_dev", kind + "_whole_tree"))
    expect(outcome.ok && outcome.installed.filter(entry => entry.kind === "skill")).toHaveLength(7)
    const state = readPackageLedgerStateV1(h.root)
    if (!state.ok) throw Error(state.reason)
    const graph = state.packageGraphs.find(graph => graph.packageId === (outcome.ok && outcome.packageId))!
    expect(graph.root.kind).toBe("bundle")
    expect(readFileSync(join(resolveLiveGenerationDir(h.root, graph.pluginTree!.storeKey)!, "tree/README.md"))).toEqual(Buffer.from(await source.readFile("README.md")))
  }
}))

test("source component names preserve logical identity across kind case and definition relocation", async () => {
  const { pluginHostName, pluginComponentId } = await import("./plugin-package-install")
  const converted = await convertPluginTree(await captureStandardFixture("codex:supabase"))
  const entries = converted.package.entries.filter(entry => entry.sourceName === "supabase")
  expect(entries.map(entry => entry.kind).sort()).toEqual(["mcp", "skill"])
  const names = entries.map(entry => pluginHostName(entry, "codex:supabase", new Set(), () => true))
  expect(new Set(names).size).toBe(2)
  for (const [i, entry] of entries.entries()) {
    expect(names[i]).toMatch(/^[a-z0-9][a-z0-9_-]*-[a-f0-9]{10}$/)
    expect(pluginComponentId("codex:supabase", entry)).toBe("user:" + names[i])
  }
  const codspeed = await convertPluginTree(await captureStandardFixture("claude:codspeed"))
  const entry = codspeed.package.entries.find(entry => entry.kind === "mcp")!
  const first = pluginHostName(entry, "claude:codspeed", new Set(), () => true)
  expect(first).toBe(first.toLowerCase())
  expect(first.length).toBeLessThanOrEqual(24)
  const moved = { ...entry, sourcePath: "mcp.json", id: "mcp:mcp.json#" + entry.sourceName }
  expect(pluginHostName(moved, "claude:codspeed", new Set(), () => true)).toBe(first)
  expect(pluginComponentId("claude:codspeed", moved)).toBe(pluginComponentId("claude:codspeed", entry))
})

test("allocated plugin host names survive removal of a colliding connector", () => installerHarness(async h => {
  const { pluginHostName } = await import("./plugin-package-install")
  const { removeMcp } = await import("./ext-config")
  const capture = await captureFixture("external_plugins/context7")
  const converted = await convertPluginTree(capture)
  const entry = converted.package.entries.find(entry => entry.kind === "mcp")!
  const occupied = pluginHostName(entry, "claude:context7", new Set(), () => true)
  expect(persistMcp(occupied, { type: "remote", url: "https://mcp.context7.com/mcp?client=user", oauth: false })).toMatchObject({ ok: true })
  const candidate = await h.candidate("context7")
  const installed = await h.install(h.request(candidate, "allocated_name_first"))
  if (!installed.ok) throw Error(installed.detail)
  const dataState = join(pluginDataDirectory(join(h.temporary, "data"), installed.packageId), "state")
  writeFileSync(dataState, "retained across source update")
  const hostName = installed.installed[0]!.hostName
  expect(hostName).not.toBe(occupied)
  expect(removeMcp(occupied)).toMatchObject({ ok: true })
  const updatedCapture = await captureFixture("external_plugins/context7", { ".mcp.json": new TextDecoder().decode(await capture.readFile(".mcp.json")).replace("claude-code-plugin", "updated-definition") })
  const updated = await convertPluginTree(updatedCapture)
  h.sources.convertCandidate = async () => ({ ok: true, ...updated, capture: updatedCapture, runtimeIdentity: undefined })
  const result = await h.install(h.request(candidate, "allocated_name_update"))
  expect(result.ok && result.installed[0]!.hostName).toBe(hostName)
  expect(readFileSync(dataState, "utf8")).toBe("retained across source update")
  expect(readMcpLeafStrict(hostName)).toMatchObject({ ok: true, value: { url: "https://mcp.context7.com/mcp?client=updated-definition" } })
}))

test("standard plugin content installs before configuration programs or local services are ready", async () => {
  for (const name of ["claude:grafana-mcp", "claude:langfuse-observability", "claude:rill", "claude:cockroachdb", "claude:sap-hana-cli"]) await installerHarness(async h => {
    const capture = await captureStandardFixture(name)
    const converted = await convertPluginTree(capture)
    h.sources.convertCandidate = async () => ({ ok: true, ...converted, capture, runtimeIdentity: undefined })
    const result = await h.install(h.request(name, "standard_content_" + name.split(":")[1]!.replaceAll("-", "_")))
    expect(result.ok).toBe(true)
    const state = readPackageLedgerStateV1(h.root)
    if (!state.ok) throw Error(state.reason)
    expect(state.packageGraphs[0]?.root.kind).toBe("bundle")
    expect(state.packageGraphs[0]?.pluginTree).toBeDefined()
    expect(result.ok && result.installed.length).toBe(converted.package.entries.filter(entry => entry.kind === "skill" || entry.kind === "mcp").length)
  })
})


test("plugin service settings save typed values and keep sensitive values out of public state", () => installerHarness(async h => {
  const { readPackageAuthorizationV1, savePackageSecretsV1 } = await import("./package-admission")
  const deps = { root: () => h.root, userDataPath: h.temporary, casBaseRoot: () => h.temporary, environment: () => "dev" as const, loadVerifiedCatalog: async () => { throw Error("Direct package never loads catalog") } }
  for (const name of ["claude:grafana-mcp", "claude:langfuse-observability"]) {
    const capture = await captureStandardFixture(name)
    const converted = await convertPluginTree(capture)
    h.sources.convertCandidate = async () => ({ ok: true, ...converted, capture, runtimeIdentity: undefined })
    const installed = await h.install(h.request(name, "settings_" + name.replace(/[^a-zA-Z0-9_]/g, "_")))
    if (!installed.ok) throw Error(installed.detail)
    const before = await readPackageAuthorizationV1(installed.packageId, deps)
    expect(before.ok && before.items.some(item => item.kind === "option")).toBe(true)
    const options = name.includes("grafana") ? { grafana_url: "http://localhost:3000", grafana_service_account_token: "fixture-secret-do-not-publish" } : { LANGFUSE_SECRET_KEY: "fixture-secret-do-not-publish", CC_LANGFUSE_DEBUG: false, CC_LANGFUSE_MAX_CHARS: 0, LANGFUSE_USER_ID: "" }
    expect(await savePackageSecretsV1({ packageId: installed.packageId, options }, deps)).toMatchObject({ ok: true })
    const after = await readPackageAuthorizationV1(installed.packageId, deps)
    expect(JSON.stringify(after)).not.toContain("fixture-secret-do-not-publish")
    expect(after.ok && after.items.filter(item => item.kind === "option" && item.sensitive).every(item => item.configured && !("value" in item))).toBe(true)
    if (name.includes("langfuse")) {
      expect(after).toMatchObject({ items: expect.arrayContaining([
        expect.objectContaining({ kind: "option", key: "CC_LANGFUSE_DEBUG", value: false }),
        expect.objectContaining({ kind: "option", key: "CC_LANGFUSE_MAX_CHARS", value: 0 }),
        expect.objectContaining({ kind: "option", key: "LANGFUSE_USER_ID", value: "" }),
        expect.objectContaining({ kind: "option", key: "LANGFUSE_BASE_URL", value: "https://cloud.langfuse.com" }),
      ]) })
      expect(await savePackageSecretsV1({ packageId: installed.packageId, options: { CC_LANGFUSE_DEBUG: "false" } }, deps)).toMatchObject({ ok: false })
    }
    expect(readFileSync(join(h.root, "installs.json"), "utf8")).not.toContain("fixture-secret-do-not-publish")
  }
}))

test("plugin MCP runtime binds saved options and DATA while content retains references", () => installerHarness(async h => {
  const { savePackageSecretsV1 } = await import("./package-admission")
  const { installedPluginDescription } = await import("./plugin-package-config")
  const { bindPluginMcp } = await import("../shared/plugin-mcp-config")
  const { readInstalledPluginSettings } = await import("../shared/installed-plugin-settings")
  const { connectorCredentials } = await import("./package-mcp-activation")
  const { resolveConnectorLeaf } = await import("@opencode/util/codepuppy-credentials")
  const capture = await captureStandardFixture("claude:grafana-mcp")
  const converted = await convertPluginTree(capture)
  h.sources.convertCandidate = async () => ({ ok: true, ...converted, capture, runtimeIdentity: undefined })
  const installed = await h.install(h.request("grafana", "grafana_bind"))
  if (!installed.ok) throw Error(installed.detail)
  const state = readPackageLedgerStateV1(h.root)
  if (!state.ok) throw Error(state.reason)
  const graph = state.packageGraphs[0]!
  const metadata = installedPluginDescription(h.root, graph)!
  const entry = metadata.description.entries.find(entry => entry.kind === "mcp")!
  if (entry.kind !== "mcp") throw Error("Real Grafana sample has MCP")
  const deps = { root: () => h.root, userDataPath: h.temporary, casBaseRoot: () => h.temporary, environment: () => "dev" as const, loadVerifiedCatalog: async () => { throw Error("no catalog") } }
  const bind = () => bindPluginMcp({ description: metadata.description, entry, settings: readInstalledPluginSettings(h.root, graph.pluginTree!.storeKey)!, pluginRoot: metadata.pluginRoot, projectDir: h.temporary,
    resolveEnvironment: () => undefined, resolveSecret: () => undefined,
    resolveOptionSecret: reference => {
      const value = resolveConnectorLeaf({ server: graph.root.name, leaf: { environment: { value: reference } }, ...connectorCredentials({ root: deps.root, userDataPath: () => h.temporary }) }) as { environment: { value: string } }
      return value.environment.value
    },
  })
  expect(bind).toThrow(/missing-config: grafana_(url|service_account_token)/)
  expect(await savePackageSecretsV1({ packageId: installed.packageId, options: { grafana_url: "http://localhost:3000", grafana_service_account_token: "runtime-only-fixture-token" } }, deps)).toMatchObject({ ok: true })
  const bound = bind()
  expect(bound).toMatchObject({ type: "local", command: ["docker", "run", "--rm", "-i", "-e", "GRAFANA_URL", "-e", "GRAFANA_SERVICE_ACCOUNT_TOKEN", "grafana/mcp-grafana", "-t", "stdio"], environment: { GRAFANA_URL: "http://localhost:3000", GRAFANA_SERVICE_ACCOUNT_TOKEN: "runtime-only-fixture-token", CLAUDE_PLUGIN_DATA: pluginDataDirectory(join(h.temporary, "data"), installed.packageId) } })
  expect(JSON.stringify(graph)).not.toContain("runtime-only-fixture-token")
  const settingsFile = join(h.root, "ext-store", graph.pluginTree!.storeKey, "package-settings.json")
  const previous = readFileSync(settingsFile)
  const refs = Object.values(readInstalledPluginSettings(h.root, graph.pluginTree!.storeKey)!.secretRefs)
  expect(await savePackageSecretsV1({ packageId: installed.packageId, options: { grafana_service_account_token: "replacement-token" } }, { ...deps, transaction: (root, plan, hooks) => runExtensionTransaction(root, plan, { ...hooks, probePrepared: () => ({ healthy: false, reason: "injected option resource failure" }) }) })).toMatchObject({ ok: false })
  expect(readFileSync(settingsFile)).toEqual(previous)
  expect(refs.every(ref => existsSync(ref.slice(6, -1)))).toBe(true)
  expect(await savePackageSecretsV1({ packageId: installed.packageId, options: { grafana_service_account_token: "replacement-token" } }, deps)).toMatchObject({ ok: true })
  expect(refs.every(ref => existsSync(ref.slice(6, -1)))).toBe(false)
}))

test("connector version selection preserves the source argv when pinned or cleared", () => installerHarness(async h => {
  const { readPackageAuthorizationV1, savePackageSecretsV1 } = await import("./package-admission")
  const { installedPluginDescription } = await import("./plugin-package-config")
  const { bindPluginMcp } = await import("../shared/plugin-mcp-config")
  const { readInstalledPluginSettings } = await import("../shared/installed-plugin-settings")
  const capture = await captureStandardFixture("codex:build-ios-apps")
  const converted = await convertPluginTree(capture)
  h.sources.convertCandidate = async () => ({ ok: true, ...converted, capture, runtimeIdentity: undefined })
  const installed = await h.install(h.request("build-ios-apps", "version_selection"))
  if (!installed.ok) throw Error(installed.detail)
  const deps = { versionSuggestion: async () => undefined, root: () => h.root, userDataPath: h.temporary, casBaseRoot: () => h.temporary, environment: () => "dev" as const, loadVerifiedCatalog: async () => { throw Error("no catalog") } }
  const authorization = await readPackageAuthorizationV1(installed.packageId, deps)
  expect(authorization.ok && authorization.items.some(item => item.kind === "mcp-version")).toBe(true)
  const state = readPackageLedgerStateV1(h.root)
  if (!state.ok) throw Error(state.reason)
  const graph = state.packageGraphs[0]!
  const metadata = installedPluginDescription(h.root, graph)!
  const entry = metadata.description.entries.find(entry => entry.kind === "mcp")!
  if (entry.kind !== "mcp") throw Error("build-ios-apps has its real XcodeBuildMCP definition")
  for (const version of ["2.0.0", ""]) {
    expect(await savePackageSecretsV1({ packageId: installed.packageId, mcpVersions: { [entry.id]: version } }, deps)).toMatchObject({ ok: true })
    const bound = bindPluginMcp({ description: metadata.description, entry, settings: readInstalledPluginSettings(h.root, graph.pluginTree!.storeKey)!, pluginRoot: metadata.pluginRoot, projectDir: h.temporary, resolveEnvironment: () => undefined, resolveSecret: () => undefined, resolveOptionSecret: () => undefined })
    expect(bound).toMatchObject({ type: "local", command: ["npx", "-y", version ? "xcodebuildmcp@2.0.0" : "xcodebuildmcp@latest", "mcp"] })
  }
}))


test("remote plugin declarations retain explicit transport in their installed MCP projection", async () => {
  const { pluginMcpConfig } = await import("../shared/plugin-mcp-config")
  const { validMcpConfigLeaf } = await import("../shared/plugin-install")
  const converted = await convertPluginTree(await captureStandardFixture("claude:cloudinary"))
  for (const entry of converted.package.entries) {
    if (entry.kind !== "mcp" || entry.transport === "stdio") continue
    for (const transport of ["http", "sse"] as const) {
      const leaf = pluginMcpConfig({ ...entry, transport })
      expect(leaf).toMatchObject({ type: "remote", transport })
      expect(validMcpConfigLeaf(leaf)).toBe(true)
    }
  }
})


test("source installation returns committed content before default enable and runtime activation", () => installerHarness(async h => {
  const capture = await captureStandardFixture("claude:sap-hana-cli")
  const converted = await convertPluginTree(capture)
  h.sources.convertCandidate = async () => ({ ok: true, ...converted, capture, runtimeIdentity: undefined })
  const result = await h.installContent(h.request("sap", "install_before_activation"))
  expect(result.ok).toBe(true)
  const before = readPackageLedgerStateV1(h.root)
  expect(before.ok && before.records.every(record => record.desiredState === "disabled")).toBe(true)
  expect(h.activation).toEqual([])
  expect(readdirSync(join(h.root, "ext-tx/journal")).map(file => JSON.parse(readFileSync(join(h.root, "ext-tx/journal", file), "utf8")).state)).toEqual(["committed"])
  await new Promise<void>(resolve => setImmediate(resolve))
  const after = readPackageLedgerStateV1(h.root)
  expect(after.ok && after.records.every(record => record.desiredState === "enabled")).toBe(true)
  expect(h.activation).toEqual([result.ok ? result.packageId : ""])
}))

// Real build-ios-apps fixture declares xcodebuildmcp@latest; metadata is held, not a timing fixture.
test("connector version metadata never blocks authorization and is refreshed once available", () => installerHarness(async h => {
  const { readPackageAuthorizationV1 } = await import("./package-admission")
  const capture = await captureStandardFixture("codex:build-ios-apps")
  const converted = await convertPluginTree(capture)
  h.sources.convertCandidate = async () => ({ ok: true, ...converted, capture, runtimeIdentity: undefined })
  const installed = await h.install(h.request("build-ios-apps", "version_hint_pending"))
  if (!installed.ok) throw Error(installed.detail)
  let release!: (version: string) => void
  const metadata = new Promise<string>(resolve => { release = resolve })
  let requests = 0
  const deps = { versionSuggestion: async () => { requests++; return metadata }, root: () => h.root, userDataPath: h.temporary, casBaseRoot: () => h.temporary, environment: () => "dev" as const, loadVerifiedCatalog: async () => { throw Error("no catalog") } }
  let first: Awaited<ReturnType<typeof readPackageAuthorizationV1>> | undefined
  const pending = readPackageAuthorizationV1(installed.packageId, deps).then(result => { first = result })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(first).toMatchObject({ ok: true })
    expect(first?.ok && first.items.find(item => item.kind === "mcp-version")).toMatchObject({ value: "" })
    if (first?.ok) expect(first.items.find(item => item.kind === "mcp-version")).not.toHaveProperty("suggestion")
  } finally { release("2.0.0"); await metadata; await pending }
  const refreshed = await readPackageAuthorizationV1(installed.packageId, deps)
  expect(refreshed.ok && refreshed.items.find(item => item.kind === "mcp-version")).toMatchObject({ value: "2.0.0", suggestion: "2.0.0" })
  expect(requests).toBe(1)
}))

test("unset plugin MCP environment variables preserve the source and report a named dependency at binding", async () => {
  const { bindPluginMcp, PluginMcpBindingError } = await import("../shared/plugin-mcp-config")
  const captured = await captureFixture("external_plugins/github")
  const source = new TextDecoder().decode(await captured.readFile(".mcp.json"))
  // Real GitHub connector, with a non-sensitive named URL variable instead of the recorded literal URL.
  const converted = await convertPluginTree(await captureFixture("external_plugins/github", { ".mcp.json": source.replace("https://api.githubcopilot.com/mcp/", "${PLUGIN_REMOTE_ENDPOINT}") }))
  const entry = converted.package.entries.find(entry => entry.kind === "mcp")!
  if (entry.kind !== "mcp" || entry.transport === "stdio") throw Error("Expected the real GitHub remote connector")
  const input = { description: converted.package, entry, settings: { packageId: "claude:github", dataHome: "/tmp/plugin-data", values: {}, secretRefs: {}, versions: {}, mcpVersions: {} }, pluginRoot: "/tmp/plugin-tree", projectDir: "/tmp/project", resolveEnvironment: () => undefined, resolveSecret: () => undefined, resolveOptionSecret: () => undefined }
  expect(() => bindPluginMcp(input)).toThrow("dependency-missing: PLUGIN_REMOTE_ENDPOINT")
  try { bindPluginMcp(input) } catch (error) { expect(error).toBeInstanceOf(PluginMcpBindingError) }
  expect(entry.url).toEqual([{ environment: { name: "PLUGIN_REMOTE_ENDPOINT" } }])
  const resolved = bindPluginMcp({ ...input, resolveEnvironment: name => name === "PLUGIN_REMOTE_ENDPOINT" ? "https://example.com/mcp" : name === "GITHUB_PERSONAL_ACCESS_TOKEN" ? "invalid-local-token" : undefined })
  expect(resolved).toMatchObject({ type: "remote", url: "https://example.com/mcp", headers: { Authorization: "Bearer invalid-local-token" } })
  expect(() => bindPluginMcp({ ...input, resolveEnvironment: name => name === "PLUGIN_REMOTE_ENDPOINT" ? "https://example.com/mcp" : undefined })).toThrow("dependency-missing: GITHUB_PERSONAL_ACCESS_TOKEN")
})

test("a nonlocal plain HTTP plugin connector fails by itself after the whole package installs", () => installerHarness(async h => {
  const { createManagedMcpConvergence } = await import("./package-mcp-activation")
  const capture = await captureFixture("external_plugins/context7")
  const source = new TextDecoder().decode(await capture.readFile(".mcp.json"))
  const skill = new TextDecoder().decode(await (await captureFixture("plugins/frontend-design")).readFile("skills/frontend-design/SKILL.md"))
  const variant = await captureFixture("external_plugins/context7", { ".mcp.json": source.replace("https://mcp.context7.com/", "http://mcp.context7.com/"), "skills/frontend-design/SKILL.md": skill })
  const converted = await convertPluginTree(variant)
  h.sources.convertCandidate = async () => ({ ok: true, ...converted, capture: variant, runtimeIdentity: undefined })
  const installed = await h.install(h.request("context7", "plain_http_connector"))
  expect(installed).toMatchObject({ ok: true })
  if (!installed.ok) throw Error(installed.detail)
  expect(installed.installed.some(entry => entry.kind === "skill")).toBe(true)
  const name = installed.installed.find(entry => entry.kind === "mcp")!.hostName
  expect(readMcpLeafStrict(name)).toMatchObject({ ok: true, value: { url: "http://mcp.context7.com/mcp?client=claude-code-plugin" } })
  const requests: string[] = []
  // This repository's own typed API response shape (protocol/groups/{debug,mcp}); no MCP protocol imitation.
  const engine = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    const path = new URL(request.url).pathname
    requests.push(request.method + " " + path)
    if (path === "/api/debug/location") return Response.json([])
    if (path === "/api/mcp") return Response.json({ location: { directory: h.temporary }, data: [] })
    if (path.endsWith("/disconnect")) return new Response(null, { status: 204 })
    return new Response(null, { status: 500 })
  } })
  try {
    const converge = createManagedMcpConvergence({ root: () => h.root, directory: () => h.temporary, userDataPath: () => h.temporary, awaitServer: async () => ({ url: engine.url.href, username: null, password: null }) })
    expect(await converge([name])).toMatchObject([{ name, status: "failed", detail: "only https:// server URLs are supported" }])
    expect(requests.some(request => request.startsWith("PUT "))).toBe(false)
    expect(readPackageLedgerStateV1(h.root)).toMatchObject({ ok: true, packageGraphs: [{ packageId: installed.packageId }] })
  } finally { await engine.stop(true) }
}))

test("a custom MCP record never inherits plugin validation from a colliding graph name", () => installerHarness(async h => {
  const { upsertRecordV2 } = await import("./ext-receipt-v2")
  const installed = await h.install(h.request(await h.candidate("context7"), "origin_not_name"))
  if (!installed.ok) throw Error(installed.detail)
  const name = installed.installed.find(entry => entry.kind === "mcp")!.hostName
  const state = readPackageLedgerStateV1(h.root)
  if (!state.ok) throw Error(state.reason)
  const record = state.records.find(record => record.kind === "mcp" && record.name === name)!
  expect(persistMcp(name, { type: "local", command: ["/tmp/plugin-entry", "--source-argv"] })).toMatchObject({ ok: true })
  expect(upsertRecordV2(h.root, { ...record, origin: "created", transaction: undefined })).toMatchObject({ ok: true })
  expect(persistMcp(name, { type: "local", command: ["/tmp/custom-entry", "--source-argv"] })).toMatchObject({ ok: false, reason: "command not allowed: /tmp/custom-entry" })
  expect(persistMcp(name, { type: "remote", url: "http://localhost:9876/mcp" })).toMatchObject({ ok: false })
}))
