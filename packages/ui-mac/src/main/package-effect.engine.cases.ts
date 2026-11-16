import { expect, test } from "bun:test"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { engineSandbox, assertEngineSandboxed, engineSlot } from "../../test-component/engine-sandbox"
import { publishTestBootstrap } from "../../test-component/codepuppy-bootstrap-fixture"
import { fixtureFetch } from "../../test-fixtures/plugin-helper/source-fetch"
import { skillGenerationLiveDirs } from "../../../ext/src/gen-skill-paths"
import { createPluginSources } from "./plugin-sources"
import { createSourceInstaller, installCatalogFromSource } from "./install-from-source"
import { buildEngineServerOptions } from "./engine-server-options"
import { engineClient } from "./engine-client"
import { makeRecoveryGate } from "./ext-recovery-gate"
import { applyMcpWritePolicy } from "./ext-mcp-policy"
import { collectLegacyMcpRefPathsStrict, gcMcpSecretsAgainstConfig, mcpConfigTruthPath, readMcpLeafStrict } from "./ext-config"
import type { PlannerDeps } from "./ext-install-planner"
import type { CatalogEntry } from "../renderer/extensions/catalog-types"
import { setPackageStateV1 } from "./ext-install-planner"
import { applyPackageMutation, projectScopeIdentity, readPackageLedgerStateV1 } from "./ext-receipt-v2"
import { computeInstalledGraphDigest } from "./ext-package-ledger-v3"
import { applyPackageMcpV1, removePackageMcpV1 } from "./package-mcp-activation"
import type { EngineConnection } from "./engine-authorization"
import { writeExplicitConfig, watchExplicitSources } from "./engine-explicit-config"

const sandbox = engineSandbox()
const repo = join(import.meta.dir, "../../../..")
const password = "package-effect-test"

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean) {
  for (const end = Date.now() + 15000;; await Bun.sleep(20)) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > end) throw Error("Runtime did not reach expected state: " + JSON.stringify(value))
  }
}
function snapshot(directory: string): unknown {
  return readdirSync(directory, { withFileTypes: true }).map((entry) => [entry.name, entry.isDirectory() ? snapshot(join(directory, entry.name)) : readFileSync(join(directory, entry.name), "hex")])
}
async function harness(name: string, scoped: boolean) {
  await assertEngineSandboxed(sandbox)
  const slot = engineSlot(sandbox, name)
  const root = join(sandbox.root, name, "state", "env", "dev")
  const other = join(sandbox.root, name, "other")
  mkdirSync(root, { recursive: true })
  mkdirSync(other, { recursive: true })
  process.env.CODEPUPPY_GLOBAL_DIR = root
  publishTestBootstrap({ globalRoot: root })
  const snapshots = [snapshot(slot.projectDirectory), snapshot(other)]
  const sources = createPluginSources({ catalog: async () => [], fetch: fixtureFetch })
  const planner = { globalRoot: () => root, advisoryGate: () => ({ allowed: true as const }), resolvePackage: async () => { throw Error("noncatalog fixture") } }
  let connection: EngineConnection | undefined
  const awaitServer = async () => { if (!connection) throw Error("engine not started"); return connection }
  const install = createSourceInstaller({ ...planner, casBaseRoot: () => join(sandbox.root, name, "state"), environment: () => "dev", userDataPath: join(sandbox.root, name), sources, gate: makeRecoveryGate(() => ({})), catalogInstall: async () => { throw Error("empty catalog") }, activateMcp: (packageId) => applyPackageMcpV1(packageId, slot.projectDirectory, { root: () => root, awaitServer }), reloadSkills: () => {}, removeDeparting: () => {} })
  const candidate = (await sources.searchSources("frontend-design")).candidates.find((row) => row.source === "claude-marketplace")!
  const installed = await install({ requestId: "effect_" + name, source: { kind: "candidate", candidateId: candidate.id }, effect: scoped ? { kind: "project", directory: slot.projectDirectory } : { kind: "all-projects" }, via: "chat" })
  expect(installed.ok).toBe(true)
  if (!installed.ok) throw Error(installed.detail)
  const ext = join(sandbox.root, name, "ext")
  const observer = join(sandbox.root, name, "observer")
  mkdirSync(ext)
  mkdirSync(observer)
  writeFileSync(join(ext, "server.js"), `export {default} from ${JSON.stringify(join(repo, "packages/ext/src/plugin.ts"))}`)
  writeFileSync(join(observer, "server.js"), `
import {Schema} from ${JSON.stringify(Bun.resolveSync("effect", join(repo, "packages/ui-mac")))}
export default {id:"test.package-effect",setup:async(ctx)=>{
 await ctx.rpc.register({id:"package-effect", methods:{skills:{input:Schema.Undefined,output:Schema.Unknown},rebuild:{input:Schema.Undefined,output:Schema.Unknown},tools:{input:Schema.Undefined,output:Schema.Unknown},close:{input:Schema.String,output:Schema.Unknown},use:{input:Schema.Struct({sessionID:Schema.String,id:Schema.String}),output:Schema.Unknown}},events:{}},{
 skills:async()=>(await ctx.skill.list()).data,
 tools:async()=>(await ctx.tool.list()).map(t=>t.name),
 close:async(sessionID)=>await (await ctx.tool.list()).find(t=>t.name==="browser_close").execute({},{sessionID,agent:"build",messageID:"msg_effect",id:"call_effect",signal:new AbortController().signal,progress:async()=>{}}),
 rebuild:async()=>{await ctx.skill.reload();return (await ctx.skill.list()).data},
 use:async({sessionID,id})=>{try{return await (await ctx.tool.list()).find(t=>t.name==="skill").execute({id},{sessionID,agent:"build",messageID:"msg_effect",id:"call_effect",signal:new AbortController().signal,progress:async()=>{}})}catch{return {denied:true}}}
 })
}}`)
  const file = join(sandbox.root, name, "explicit.json")
  const user = join(root, "codepuppy.jsonc")
  writeFileSync(user, JSON.stringify({ plugins: [ext, observer] }))
  const layer = { policies: [], commands: {}, skills: skillGenerationLiveDirs(root) }
  writeExplicitConfig(file, user, layer, root)
  const previous = process.cwd()
  process.chdir(slot.projectDirectory)
  const { startEngine } = await import("../../engine/engine-embed")
  const engine = await startEngine(buildEngineServerOptions({ hostname: "127.0.0.1", port: 0, password, engineVersion: "test", databasePath: slot.databasePath, configDirectory: slot.configDirectory, config: { file }, models: { fetch: false }, filewatcher: false, platform: process.platform }), { projectTrust: () => true })
  connection = { url: engine.url, username: "opencode", password }
  const client = engineClient(connection)
  const session = await client.session.create({ permissions: [{ action: "*", resource: "*", effect: "allow" }] })
  await client.session.create({ location: { directory: other } })
  for (const directory of [slot.projectDirectory, other]) await until(() => client.plugin.list({ location: { directory } }), (result) => ["codepuppy.ext", "opencode.config.policy", "test.package-effect"].every((id) => result.data.some((plugin) => plugin.id === id && plugin.state.status === "active")))
  const rpc = async (method: string, directory = slot.projectDirectory, input?: unknown) => (await client.rpc.call({ rpcID: "package-effect", method, input, location: { directory } })).output
  let refreshes = 0
  const stop = watchExplicitSources({ file, userConfig: user, root, layer, skills: () => { refreshes++; return skillGenerationLiveDirs(root) }, log: (line) => { throw Error(line) } })
  return { root, other, slot, planner, installed, rpc, session, file, snapshots, sources, install, awaitServer, client, refreshes: () => refreshes, close: async () => { stop(); await engine.close(); process.chdir(previous) } }
}

for (const initial of ["global", "project"] as const) test(`disabled managed skill stays absent with stale explicit config (${initial})`, async () => {
  const h = await harness("scope-off-" + initial, initial === "project")
  try {
    const skills = await until(() => h.rpc("skills"), (items) => items.some((skill) => skill.name === "frontend-design"))
    const skill = skills.find((skill) => skill.name === "frontend-design")
    expect((await h.rpc("use", undefined, { sessionID: h.session.id, id: skill.id })).content).toContain("Frontend Design")
    expect((await h.rpc("skills", h.other)).some((skill) => skill.name === "frontend-design")).toBe(initial === "global")
    const refreshes = h.refreshes()
    const stale = readFileSync(h.file, "utf8")
    expect(await setPackageStateV1({ packageId: h.installed.packageId, state: "disabled" }, h.planner)).toMatchObject({ ok: true })
    expect(JSON.parse(readFileSync(join(h.root, "skills-enabled.json"), "utf8"))).toEqual({ v: 2, keys: [], scoped: [] })
    expect(readFileSync(h.file, "utf8")).toBe(stale)
    expect((await h.rpc("rebuild")).some((skill) => skill.name === "frontend-design")).toBe(false)
    // Fail if this did not hit the actual production 100 ms config-refresh window.
    expect(readFileSync(h.file, "utf8")).toBe(stale)
    expect(await h.rpc("use", undefined, { sessionID: h.session.id, id: skill.id })).toEqual({ denied: true })
    expect(h.refreshes()).toBe(refreshes)
    await until(async () => h.refreshes(), (count) => count > refreshes)
    expect([snapshot(h.slot.projectDirectory), snapshot(h.other)]).toEqual(h.snapshots)
  } finally { await h.close() }
}, 90000)

test("scope change cannot revive a parsed skill in another project", async () => {
  const h = await harness("scope-change", false)
  try {
    await until(() => h.rpc("skills", h.other), (items) => items.some((skill) => skill.name === "frontend-design"))
    const state = readPackageLedgerStateV1(h.root)
    if (!state.ok) throw Error(state.reason)
    const before = state.packageGraphs.find((graph) => graph.packageId === h.installed.packageId)!
    const identity = projectScopeIdentity(h.slot.projectDirectory)
    if (!identity.ok) throw Error(identity.reason)
    const graph = { ...before, effect: identity.scope }
    graph.installedGraphDigest = computeInstalledGraphDigest(graph)
    const refreshes = h.refreshes()
    const stale = readFileSync(h.file, "utf8")
    expect(applyPackageMutation(h.root, { operation: "update", transactionId: "scope-change", graphBeforeDigest: before.installedGraphDigest, graphAfter: graph, claimMutations: [], childRecordMutations: [] })).toMatchObject({ ok: true })
    expect(readFileSync(h.file, "utf8")).toBe(stale)
    expect((await h.rpc("rebuild", h.other)).some((skill) => skill.name === "frontend-design")).toBe(false)
    expect(readFileSync(h.file, "utf8")).toBe(stale)
    expect((await h.rpc("rebuild")).some((skill) => skill.name === "frontend-design")).toBe(true)
    expect(h.refreshes()).toBe(refreshes)
    await until(async () => h.refreshes(), (count) => count > refreshes)
  } finally { await h.close() }
}, 90000)


test("project MCP activates only in matching Locations and scope narrowing revokes old runtime tools", async () => {
  const h = await harness("scope-mcp", false)
  const sockets = (await import("node:fs")).mkdtempSync("/tmp/scope-pw-")
  process.env.PWTEST_SOCKETS_DIR = sockets
  try {
    const candidate = (await h.sources.searchSources("playwright")).candidates.find((row) => row.source === "claude-marketplace")!
    const result = await h.install({ requestId: "scope_mcp_install", source: { kind: "candidate", candidateId: candidate.id }, effect: { kind: "project", directory: h.slot.projectDirectory }, via: "chat" })
    expect(result).toMatchObject({ ok: true, packageId: "claude:playwright" })
    await until(() => h.rpc("tools"), (items) => items.includes("browser_close"))
    expect(await h.rpc("tools", h.other)).not.toContain("browser_close")
    expect((await h.rpc("close", undefined, h.session.id)).content.some((part) => part.type === "text" && part.text.length > 0)).toBe(true)
    const projection = readFileSync(join(h.root, "skills-enabled.json"), "utf8")
    writeFileSync(join(h.root, "skills-enabled.json"), JSON.stringify({ v: 2, keys: [], scoped: [] }))
    await applyPackageMcpV1("claude:playwright", h.slot.projectDirectory, { root: () => h.root, awaitServer: h.awaitServer })
    await until(() => h.rpc("tools"), (items) => !items.includes("browser_close"))
    writeFileSync(join(h.root, "skills-enabled.json"), projection)
    await applyPackageMcpV1("claude:playwright", h.slot.projectDirectory, { root: () => h.root, awaitServer: h.awaitServer })
    await until(() => h.rpc("tools"), (items) => items.includes("browser_close"))
    // Later/rebuilt Locations must consume the globally disabled leaf through ext's own scope transform.
    await until(async () => JSON.parse(readFileSync(h.file, "utf8")), (document) => document.mcp?.playwright?.enabled === false)
    await h.client.location.reload()
    await until(() => h.rpc("tools"), (items) => items.includes("browser_close"))
    expect(await h.rpc("tools", h.other)).not.toContain("browser_close")
    const later = join(h.root, "later-project")
    mkdirSync(later)
    await h.client.session.create({ location: { directory: later } })
    await until(() => h.client.plugin.list({ location: { directory: later } }), (result) => result.data.some((plugin) => plugin.id === "test.package-effect" && plugin.state.status === "active"))
    expect(await h.rpc("tools", later)).not.toContain("browser_close")
    expect(snapshot(later)).toEqual([])
    const state = readPackageLedgerStateV1(h.root)
    if (!state.ok) throw Error(state.reason)
    let before = state.packageGraphs.find((graph) => graph.packageId === "claude:playwright")!
    const move = async (directory?: string) => {
      const identity = directory ? projectScopeIdentity(directory) : undefined
      if (identity && !identity.ok) throw Error(identity.reason)
      const { effect, ...base } = before
      const graph = { ...base, ...(identity?.ok ? { effect: identity.scope } : {}) }
      graph.installedGraphDigest = computeInstalledGraphDigest(graph)
      expect(applyPackageMutation(h.root, { operation: "update", transactionId: "mcp-effect", graphBeforeDigest: before.installedGraphDigest, graphAfter: graph, claimMutations: [], childRecordMutations: [] })).toMatchObject({ ok: true })
      before = graph
      await applyPackageMcpV1(graph.packageId, h.slot.projectDirectory, { root: () => h.root, awaitServer: h.awaitServer })
    }
    await move()
    await until(() => h.rpc("tools", h.other), (items) => items.includes("browser_close"))
    await move(h.other)
    await until(() => h.rpc("tools"), (items) => !items.includes("browser_close"))
    await until(() => h.rpc("tools", h.other), (items) => items.includes("browser_close"))
    expect(await h.rpc("tools", h.other)).toContain("browser_close")
    expect(await setPackageStateV1({ packageId: before.packageId, state: "disabled" }, h.planner)).toMatchObject({ ok: true })
    await applyPackageMcpV1(before.packageId, h.slot.projectDirectory, { root: () => h.root, awaitServer: h.awaitServer })
    await until(() => h.rpc("tools", h.other), (items) => !items.includes("browser_close"))
    await removePackageMcpV1(before, h.slot.projectDirectory, h.awaitServer)
    expect((await h.client.mcp.list()).data.some((server) => server.name === "playwright")).toBe(false)
    expect((await h.client.mcp.list({ location: { directory: h.other } })).data.some((server) => server.name === "playwright")).toBe(false)
    expect([snapshot(h.slot.projectDirectory), snapshot(h.other)]).toEqual(h.snapshots)
  } finally { await h.close(); (await import("node:fs")).rmSync(sockets, { recursive: true, force: true }); delete process.env.PWTEST_SOCKETS_DIR }
}, 180000)


test("catalog item is usable only in project A and leaves both projects' config bytes unchanged", async () => {
  const h = await harness("scope-native-catalog", false)
  const sockets = (await import("node:fs")).mkdtempSync("/tmp/catalog-pw-")
  process.env.PWTEST_SOCKETS_DIR = sockets
  const unexpected = (): never => { throw Error("unexpected adapter: the real pinned catalog fixture needs neither credentials nor non-MCP installers") }
  const entry = await Bun.file(join(import.meta.dir, "../../test-fixtures/plugin-helper/catalog-scope/playwright.json")).json() as CatalogEntry
  const native: PlannerDeps = {
    ...h.planner, platform: () => process.platform, environment: () => "dev", casBaseRoot: () => join(h.root, "cas"),
    resolveEntry: async (id) => id === entry.id ? { entry, channel: "bundled", catalogVersion: entry.version! } : null,
    resolvePackage: unexpected,
    installers: {
      applyMcpWritePolicy, readMcpLeafStrict, mcpConfigTruthPath,
      gcMcpSecrets: (name) => gcMcpSecretsAgainstConfig(h.root, name), legacyMcpRefPaths: collectLegacyMcpRefPathsStrict,
      mcpSecretRefFor: unexpected, claimMcpSecretVersionDir: unexpected, writeMcpSecretVersioned: unexpected, removeMcpSecretVersionDir: unexpected,
      removeMcpConfigInLock: unexpected, removeProjectMcpConfigInLock: unexpected, removeMcpSecretsStrict: unexpected,
      releaseCodePuppyConnectionBindings: unexpected, findPluginBaseConflictStrict: unexpected, readPluginArrayStrict: unexpected, readLegacyPluginArrayStrict: unexpected,
      removePlugin: unexpected, collectVendoredPluginPayload: unexpected, removePluginPath: unexpected,
      installBuiltinSkill: unexpected, collectBuiltinSkillPayload: unexpected, collectBuiltinAgentPayload: unexpected,
      installRemoteSkill: unexpected, removeFsInstall: unexpected, agentPresent: unexpected, downloadRemoteAsset: unexpected,
    },
  }
  const apply = (packageId: string) => applyPackageMcpV1(packageId, h.slot.projectDirectory, { root: () => h.root, awaitServer: h.awaitServer })
  const install = createSourceInstaller({
    ...native, userDataPath: h.root, sources: h.sources, gate: makeRecoveryGate(() => ({})), activateMcp: apply, reloadSkills: unexpected, removeDeparting: unexpected,
    catalogInstall: (id, request) => installCatalogFromSource(id, request, {
      planner: native, admission: { root: () => h.root, userDataPath: h.root, casBaseRoot: native.casBaseRoot, environment: native.environment, loadVerifiedCatalog: unexpected },
      activateMcp: apply, reloadSkills: unexpected, removeDeparting: unexpected,
    }),
  })
  try {
    for (const directory of [h.slot.projectDirectory, h.other]) {
      mkdirSync(join(directory, ".codepuppy"))
      writeFileSync(join(directory, ".codepuppy", "codepuppy.jsonc"), "// existing project config\n" + JSON.stringify({ mcp: {} }, null, 2) + "\n")
    }
    const before = [snapshot(h.slot.projectDirectory), snapshot(h.other)]
    expect(await install({ requestId: "native_catalog_scope", source: { kind: "catalog", catalogId: entry.id }, effect: { kind: "project", directory: h.slot.projectDirectory }, via: "chat" })).toMatchObject({ ok: true, packageId: entry.id, source: { kind: "catalog" } })
    await until(() => h.rpc("tools"), (items) => items.includes("browser_close"))
    expect(await h.rpc("tools", h.other)).not.toContain("browser_close")
    expect((await h.rpc("close", undefined, h.session.id)).content.some((part) => part.type === "text" && part.text.length > 0)).toBe(true)
    const state = readPackageLedgerStateV1(h.root)
    expect(state.ok && state.packageGraphs.find((graph) => graph.packageId === entry.id)?.effect).toMatchObject({ kind: "project", projectPath: h.slot.projectDirectory })
    expect(state.ok && state.records.find((record) => record.id === entry.id)).toMatchObject({ scope: { kind: "global" }, desiredState: "enabled" })
    expect(await setPackageStateV1({ packageId: entry.id, state: "disabled" }, native)).toMatchObject({ ok: true })
    await apply(entry.id)
    await until(() => h.rpc("tools"), (items) => !items.includes("browser_close"))
    expect(await setPackageStateV1({ packageId: entry.id, state: "enabled" }, native)).toMatchObject({ ok: true })
    await apply(entry.id)
    await until(() => h.rpc("tools"), (items) => items.includes("browser_close"))
    expect(await h.rpc("tools", h.other)).not.toContain("browser_close")
    expect([snapshot(h.slot.projectDirectory), snapshot(h.other)]).toEqual(before)
  } finally { await h.close(); (await import("node:fs")).rmSync(sockets, { recursive: true, force: true }); delete process.env.PWTEST_SOCKETS_DIR }
}, 180000)
