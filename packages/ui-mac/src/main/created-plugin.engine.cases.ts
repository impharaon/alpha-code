import { expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { engineSandbox, assertEngineSandboxed, engineSlot } from "../../test-component/engine-sandbox"
import { publishTestBootstrap } from "../../test-component/codepuppy-bootstrap-fixture"
import { fixtureFetch } from "../../test-fixtures/plugin-helper/source-fetch"
import { skillGenerationLiveDirs } from "../../../ext/src/gen-skill-paths"
import { createPluginSources } from "./plugin-sources"
import { createSourceInstaller } from "./install-from-source"
import { makeRecoveryGate } from "./ext-recovery-gate"
import { factorySkillSources } from "./factory-skills"
import { writeExplicitConfig, watchExplicitSources } from "./engine-explicit-config"
import { buildEngineServerOptions } from "./engine-server-options"
import { engineClient } from "./engine-client"
import { readPackageLedgerStateV1 } from "./ext-receipt-v2"
import { uninstallPackageV1 } from "./ext-package-uninstall"
import { removeInstallGrants } from "./ext-install-planner"

const sandbox = engineSandbox()
const repo = join(import.meta.dir, "../../../..")
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean) {
  for (const end = Date.now() + 20000;; await Bun.sleep(20)) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > end) throw Error("Created plugin did not become usable: " + JSON.stringify(value))
  }
}
function snapshot(directory: string): unknown {
  return readdirSync(directory, { withFileTypes: true }).map((entry) => [entry.name, entry.isDirectory() ? snapshot(join(directory, entry.name)) : readFileSync(join(directory, entry.name), "hex")])
}

test("created skill installs hot through the shared entry, completes its task and is removed as one package", async () => {
  await assertEngineSandboxed(sandbox)
  const slot = engineSlot(sandbox, "created-task")
  const root = join(sandbox.root, "created", "state", "env", "dev")
  mkdirSync(root, { recursive: true })
  process.env.CODEPUPPY_GLOBAL_DIR = root
  const factory = factorySkillSources({ packaged: false, resourcesPath: "", moduleDir: import.meta.dir })["plugin-helper"]!
  publishTestBootstrap({ globalRoot: root, factoryDirs: [factory] })
  const input = join(slot.projectDirectory, "input.json")
  writeFileSync(input, JSON.stringify({ rows: [{ name: "柚子", count: 2 }, { name: "柚子", count: 5 }, { name: "苹果", count: 3 }] }))
  const before = snapshot(slot.projectDirectory)
  const ext = join(sandbox.root, "created-ext")
  const observer = join(sandbox.root, "created-observer")
  mkdirSync(ext)
  mkdirSync(observer)
  writeFileSync(join(ext, "server.js"), `export {default} from ${JSON.stringify(join(repo, "packages/ext/src/plugin.ts"))}`)
  writeFileSync(join(observer, "server.js"), `
import {Schema} from ${JSON.stringify(Bun.resolveSync("effect", join(repo, "packages/ui-mac")))}
import {join} from "node:path"
import {shellEscape} from ${JSON.stringify(join(repo, "packages/ui-mac/src/main/wsl/runtime.ts"))}
export default {id:"test.created-plugin",setup:async(ctx)=>{
 const invoke=async(name,input,sessionID)=>(await ctx.tool.list()).find(tool=>tool.name===name).execute(input,{sessionID,agent:"build",messageID:"msg_created",id:"call_created",signal:new AbortController().signal,progress:async()=>{}})
 await ctx.rpc.register({id:"created-plugin",methods:{skills:{input:Schema.Undefined,output:Schema.Unknown},use:{input:Schema.Struct({id:Schema.String,sessionID:Schema.String}),output:Schema.Unknown},run:{input:Schema.Struct({id:Schema.String,sessionID:Schema.String,file:Schema.String}),output:Schema.Unknown}},events:{}},{
 skills:async()=>(await ctx.skill.list()).data,
 use:async(input)=>await invoke("skill",{id:input.id},input.sessionID),
 run:async(input)=>{const loaded=await invoke("skill",{id:input.id},input.sessionID);return await invoke("shell",{command:["node",join(loaded.output.directory,"summarize.mjs"),input.file].map(shellEscape).join(" ")},input.sessionID)}
 })
}}`)
  const explicit = join(sandbox.root, "created-explicit.json")
  const layer = { policies: [], commands: {}, skills: [factory] }
  writeExplicitConfig(explicit, undefined, layer, root)
  const stop = watchExplicitSources({ file: explicit, root, layer, skills: () => [factory, ...skillGenerationLiveDirs(root)], log: (line) => { throw Error(line) } })
  const previous = process.cwd()
  process.chdir(slot.projectDirectory)
  const { startEngine } = await import("../../engine/engine-embed")
  const engine = await startEngine(buildEngineServerOptions({ hostname: "127.0.0.1", port: 0, password: "created-plugin-test", engineVersion: "test", databasePath: slot.databasePath, configDirectory: slot.configDirectory, config: { file: explicit, content: JSON.stringify({ plugins: [ext, observer] }) }, models: { fetch: false }, filewatcher: true, platform: process.platform }), { packageManagerEnvironment: {}, projectTrust: () => true })
  try {
    const client = engineClient({ url: engine.url, username: "opencode", password: "created-plugin-test" })
    const session = await client.session.create({ permissions: [{ action: "*", resource: "*", effect: "allow" }] })
    await until(() => client.plugin.list(), (result) => ["codepuppy.ext", "opencode.config.policy", "test.created-plugin"].every((id) => result.data.some((plugin) => plugin.id === id && plugin.state.status === "active")))
    const rpc = async (method: string, value?: unknown) => (await client.rpc.call({ rpcID: "created-plugin", method, input: value })).output
    const builtins = await until(() => rpc("skills"), (skills) => skills.some((skill) => skill.name === "plugin-helper"))
    const helper = builtins.find((skill) => skill.name === "plugin-helper")
    expect(helper.path).toBe(join(factory, "SKILL.md"))
    expect((await rpc("use", { id: helper.id, sessionID: session.id })).output.name).toBe("plugin-helper")
    expect(existsSync(join(root, "installs.json"))).toBe(false)
    const sources = createPluginSources({ catalog: async () => [], fetch: fixtureFetch })
    const search = await sources.searchSources("frontend-design")
    expect(search.sources.every((source) => source.status === "ok")).toBe(true)
    const reloaded: string[] = []
    const install = createSourceInstaller({ globalRoot: () => root, casBaseRoot: () => join(sandbox.root, "created", "state"), environment: () => "dev", userDataPath: sandbox.root, sources, advisoryGate: () => ({ allowed: true }), resolvePackage: async () => { throw Error("created content is not a signed catalog package") }, catalogInstall: async () => { throw Error("the controlled catalog is empty") }, gate: makeRecoveryGate(() => ({})), activateMcp: async () => [], reloadSkills: (id) => { reloaded.push(id) }, removeDeparting: () => {} })
    expect(await install({ requestId: "create_real_task", via: "chat", effect: { kind: "all-projects" }, source: { kind: "created", draft: {
      searchId: search.searchId, name: "own-report", description: "Group my input rows by fruit and count",
      files: [
        { path: "skills/report/SKILL.md", text: "---\nname: report\ndescription: Group the given JSON rows by fruit and count\n---\nRun node <skill base directory>/summarize.mjs <input JSON file>. Print its output without changing the project.\n" },
        { path: "skills/report/summarize.mjs", text: "import {readFileSync} from 'node:fs';const totals=new Map();for(const row of JSON.parse(readFileSync(process.argv[2],'utf8')).rows)totals.set(row.name,(totals.get(row.name)||0)+row.count);console.log([...totals].map(([name,count])=>name+'='+count).join('|'));\n" },
      ],
    } } })).toMatchObject({ ok: true, packageId: "mine:own-report", source: { kind: "created" } })
    expect(reloaded).toEqual(["mine:own-report"])
    const skills = await until(() => rpc("skills"), (items) => items.some((skill) => skill.name === "report"))
    const report = skills.find((skill) => skill.name === "report")
    const result = await rpc("run", { id: report.id, sessionID: session.id, file: input })
    expect(result.output.exit).toBe(0)
    expect(JSON.stringify(result)).toContain("柚子=7|苹果=3")
    const state = readPackageLedgerStateV1(root)
    expect(state.ok && state.packageGraphs).toHaveLength(1)
    expect(state.ok && state.records[0]).toMatchObject({ origin: "created", desiredState: "enabled", scope: { kind: "global" } })
    const unexpected = (): never => { throw Error("unexpected non-skill removal") }
    expect(uninstallPackageV1("mine:own-report", { globalRoot: () => root, installers: { removeFsInstall: unexpected, removeMcpConfig: unexpected, removeCommandConfig: unexpected, removeMcpSecretsStrict: unexpected, releaseCodePuppyConnectionBindings: unexpected, removePluginPath: unexpected, removeInstallGrants } })).toMatchObject({ ok: true, removed: [{ kind: "skill", name: "report" }] })
    await until(() => rpc("skills"), (items) => !items.some((skill) => skill.name === "report"))
    expect(existsSync(join(root, "ext-store", "skill--report"))).toBe(false)
    expect(readPackageLedgerStateV1(root)).toMatchObject({ ok: true, packageGraphs: [], records: [] })
    expect(snapshot(slot.projectDirectory)).toEqual(before)
  } finally { stop(); await engine.close(); process.chdir(previous) }
}, 90000)
