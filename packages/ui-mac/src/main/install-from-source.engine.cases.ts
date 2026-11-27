import { ClientApi } from "../../../protocol/src/client"
import { test, expect } from 'bun:test'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { engineSandbox, assertEngineSandboxed, engineSlot } from "../../test-component/engine-sandbox"
import { publishPluginDataHome } from "./plugin-package-data"
import { buildEngineServerOptions } from "./engine-server-options"
import { engineClient } from "./engine-client"
import { publishTestBootstrap } from "../../test-component/codepuppy-bootstrap-fixture"
import { publishInProcessEngine } from "./in-process-engine"
const repo = join(import.meta.dir, "../../../..")
const reloadEndpoint = ClientApi.groups["server.location"].endpoints["location.reload"]
const sandbox = engineSandbox()
// server.ts publishes the generation's engine data home before main installs anything (#1776 793de9eb96, plugin-package-data.ts);
// these cases drive main's installer without server.ts, so they publish the sandbox engine's data home the same way.
publishPluginDataHome(sandbox.data)
import { createSourceInstaller } from "./install-from-source"
import { pluginHostName } from "./plugin-package-install"
// c6197943ad: a source tree's MCP is installed under the product's package-scoped host name, not its source name.
const PLAYWRIGHT = pluginHostName({ kind: "mcp", sourceName: "playwright", sourcePath: "" }, "claude:playwright", new Set(), () => true)
import { createPluginSources } from "./plugin-sources"
import { fixtureFetch } from "../../test-fixtures/plugin-helper/source-fetch"
import { makeRecoveryGate } from "./ext-recovery-gate"
import { createManagedMcpConvergence, managedMcpNamesOf } from "./package-mcp-activation"
import { uninstallPackageV1 } from "./ext-package-uninstall"
import { readPackageLedgerStateV1 } from "./ext-receipt-v2"
import { readMcpLeafStrict } from "./ext-config"
import { setPackageStateV1 } from "./ext-install-planner"
import { mkdtempSync, rmSync } from "node:fs"


test('A2 real package installation updates two loaded Locations without reload, persists after rebuild, and disconnects', async () => {
 await assertEngineSandboxed(sandbox)
 const slot = engineSlot(sandbox, 'slice-a-runtime')
 const sockets = mkdtempSync("/tmp/a2-pw-")
 process.env.PWTEST_SOCKETS_DIR = sockets
 const globalRoot = join(sandbox.root, 'state', 'env', 'dev')
 mkdirSync(globalRoot, {recursive:true})
 process.env.CODEPUPPY_GLOBAL_DIR = globalRoot
 const other = join(sandbox.root, 'other-loaded-project')
 mkdirSync(other)
 publishTestBootstrap({ globalRoot })
 const effect = Bun.resolveSync('effect', join(repo, 'packages/ui-mac'))
 const ext = join(sandbox.root, 'ext')
 const observer = join(sandbox.root, 'observer')
 mkdirSync(ext); mkdirSync(observer)
 writeFileSync(join(ext, 'server.js'), `export {default} from ${JSON.stringify(join(repo,'packages/ext/src/plugin.ts'))}`)
 writeFileSync(join(observer, 'server.js'), `
import {Schema} from ${JSON.stringify(effect)}
let setups=0
export default { id:'test.slice-a-observer', setup:async(ctx)=>{
 const setup=++setups
 await ctx.rpc.register({id:'slice-a-observer',methods:{tools:{input:Schema.Undefined,output:Schema.Unknown},call:{input:Schema.String,output:Schema.Unknown}},events:{}},{
 tools:async()=>({setup,tools:(await ctx.tool.list()).filter(t=>t.name.startsWith('browser_')).map(t=>({name:t.name,id:t.id,options:t.options}))}),
 call:async(sessionID)=>{const tool=(await ctx.tool.list()).find(t=>t.name==='browser_close');if(!tool)throw Error('browser_close absent');return tool.execute({}, {sessionID, agent:'build', messageID:'msg_slice_a_probe',id:'call_slice_a_probe',signal:new AbortController().signal,progress:async()=>{}})}
 })
} }
`)
 const previous=process.cwd(); process.chdir(slot.projectDirectory)
 const {startEngine}=await import("../../engine/engine-embed")
 let reloads=0
 const start=()=>startEngine(buildEngineServerOptions({hostname:'127.0.0.1',port:0,password:'slice-a-probe',engineVersion:'test',databasePath:slot.databasePath,configDirectory:slot.configDirectory,config:{file:join(globalRoot,'codepuppy.jsonc'),content:JSON.stringify({plugins:[ext,observer]})},models:{fetch:false},filewatcher:false,platform:process.platform}),{projectTrust:()=>true,onDispatch:(dispatch)=>publishInProcessEngine(async(request)=>{if(request.method===reloadEndpoint.method && new URL(request.url).pathname===reloadEndpoint.path) reloads++;return dispatch(request)})})
 let engine=await start()
 try {
 let client=engineClient({url:engine.url,username:'opencode',password:'slice-a-probe'})
 for(const end=Date.now()+15000;;await Bun.sleep(50)){
 const plugins=(await client.plugin.list()).data
 if(['codepuppy.ext','opencode.config.mcp','test.slice-a-observer','opencode.config.policy'].every(id=>plugins.some(p=>p.id===id&&p.state.status==='active')))break
 if(Date.now()>end)throw Error('plugins not active: '+JSON.stringify(plugins.map(p=>({id:p.id,state:p.state}))))
 }
 const session=await client.session.create({permissions:[{action:'*',resource:'*',effect:'allow'}]})
 await client.session.create({location:{directory:other}})
 for(const end=Date.now()+15000;;await Bun.sleep(50)){
 const plugins=(await client.plugin.list({location:{directory:other}})).data
 if(plugins.some(p=>p.id==='test.slice-a-observer'&&p.state.status==='active'))break
 if(Date.now()>end)throw Error('second Location observer not active')
 }
 const beforeOther=(await client.rpc.call({rpcID:'slice-a-observer',method:'tools',location:{directory:other}})).output
 expect(beforeOther.tools).toHaveLength(0)
 const before=(await client.rpc.call({rpcID:'slice-a-observer',method:'tools'})).output

 expect(before.tools).toHaveLength(0)
 const sources=createPluginSources({catalog:async()=>[],fetch:fixtureFetch})
 const rootDeps={globalRoot:()=>globalRoot,advisoryGate:()=>({allowed:true as const}),resolvePackage:async()=>{throw Error('noncatalog')}}
 const converge=createManagedMcpConvergence({root:()=>globalRoot,awaitServer:async()=>({url:engine.url,username:'opencode',password:'slice-a-probe'}),directory:()=>slot.projectDirectory,userDataPath:()=>sandbox.root})
 const deps={...rootDeps,casBaseRoot:()=>join(sandbox.root,'state'),environment:()=>"dev" as const,userDataPath:sandbox.root,sources,gate:makeRecoveryGate(()=>({})),catalogInstall:async()=>{throw Error('controlled catalog is empty')},activateMcp:(id:string)=>converge(managedMcpNamesOf(globalRoot,id)),reloadSkills:()=>{throw Error('MCP-only install must not reload')},removeDeparting:()=>{}}
 const install=createSourceInstaller(deps)
 const candidate=(await sources.searchSources('playwright')).candidates.find(row=>row.source==='claude-marketplace')!
 expect(await install({requestId:'engine_install_a2',source:{kind:'candidate',candidateId:candidate.id},effect:{kind:'all-projects'},via:'chat'})).toMatchObject({ok:true,packageId:'claude:playwright'})
 for(const end=Date.now()+60000;;await Bun.sleep(100)){
 const state=(await client.mcp.list()).data.find(s=>s.name===PLAYWRIGHT)
 if(state?.status.status==='connected')break
 if(state&&state.status.status!=='pending')throw Error(JSON.stringify(state))
 if(Date.now()>end)throw Error('MCP connect timed out')
 }
 let after
 for(const end=Date.now()+10000;;await Bun.sleep(100)){
 after=(await client.rpc.call({rpcID:'slice-a-observer',method:'tools'})).output
 if(after.tools.some(t=>t.name==='browser_navigate'))break
 if(Date.now()>end)throw Error('browser_navigate absent')
 }
 expect(after.setup).toBe(before.setup)
 expect(after.tools.some(t=>t.name==='browser_close')).toBe(true)
 const otherTools=()=>client.rpc.call({rpcID:'slice-a-observer',method:'tools',location:{directory:other}}).then(result=>result.output)
 for(const end=Date.now()+15000;!(await otherTools()).tools.some(t=>t.name==='browser_navigate');await Bun.sleep(50))if(Date.now()>end)throw Error('second Location has no browser tool')
 expect((await otherTools()).setup).toBe(beforeOther.setup)
 const result=(await client.rpc.call({rpcID:'slice-a-observer',method:'call',input:session.id})).output

 expect(result.content.some(part=>part.type==='text'&&part.text.length>0)).toBe(true)
 expect(reloads).toBe(0)
 const durable=readMcpLeafStrict(PLAYWRIGHT)
 expect(durable).toMatchObject({ok:true,value:{command:['npx','@playwright/mcp@latest']}})
 await engine.close()
 engine=await start()
 client=engineClient({url:engine.url,username:'opencode',password:'slice-a-probe'})
 for(const end=Date.now()+15000;;await Bun.sleep(50)){
 const plugins=(await client.plugin.list()).data
 if(plugins.some(p=>p.id==='test.slice-a-observer'&&p.state.status==='active'))break
 if(Date.now()>end)throw Error('rebuild not active')
 }
 for(const end=Date.now()+60000;;await Bun.sleep(50)){
 if((await client.rpc.call({rpcID:'slice-a-observer',method:'tools'})).output.tools.some(t=>t.name==='browser_close'))break
 if(Date.now()>end)throw Error('persistent definition did not load after rebuild')
 }
 expect(readMcpLeafStrict(PLAYWRIGHT)).toEqual(durable)
 expect(await setPackageStateV1({packageId:'claude:playwright',state:'disabled'},rootDeps)).toMatchObject({ok:true})
 await deps.activateMcp('claude:playwright')
 for(const end=Date.now()+10000;;await Bun.sleep(100)){
 const stopped=(await client.rpc.call({rpcID:'slice-a-observer',method:'tools'})).output
 if(stopped.tools.length===0)break
 if(Date.now()>end)throw Error('disconnect did not remove tools')
 }
 const failure=await createManagedMcpConvergence({root:()=>globalRoot,awaitServer:async()=>{throw Error('test engine unavailable')},directory:()=>slot.projectDirectory,userDataPath:()=>sandbox.root})([PLAYWRIGHT])
 expect(failure).toMatchObject([{name:PLAYWRIGHT,status:'unavailable'}])
 expect(readPackageLedgerStateV1(globalRoot)).toMatchObject({ok:true,packageGraphs:[{packageId:'claude:playwright'}]})
 // Removal = the package leaves the ledger, then the one runtime entry converges the name away (ext-ipc's order).
 const kept={ok:true as const}
 expect(await uninstallPackageV1('claude:playwright',{globalRoot:()=>globalRoot,installers:{removeFsInstall:()=>({ok:true as const,files:[]}),removeMcpConfig:()=>kept,removeCommandConfig:()=>kept,removeMcpSecretsStrict:()=>kept,releaseCodePuppyConnectionBindings:()=>kept,removeInstallGrants:()=>({ok:true as const,removed:[]}),removePluginPath:()=>kept}})).toMatchObject({ok:true})
 await converge([PLAYWRIGHT])
 expect((await client.mcp.list()).data.some(server=>server.name===PLAYWRIGHT)).toBe(false)
 }finally{await engine.close();process.chdir(previous);rmSync(sockets,{recursive:true,force:true})}
},180000)

// A controlled command-path change to the real pinned Playwright definition exercises engine failure.
test('A2 real engine startup failure keeps the enabled package and exposes failed status', async () => {
 const {captureFixture}=await import('../../test-fixtures/plugin-helper/fixture')
 const {convertPluginTree}=await import('../shared/host-extension-package-contract/plugin-conversion.mjs')
 const slot=engineSlot(sandbox,'a2-failed-startup')
 const root=join(sandbox.root,'failed-state','env','dev')
 mkdirSync(root,{recursive:true})
 process.env.CODEPUPPY_GLOBAL_DIR=root
 publishTestBootstrap({globalRoot:root})
 const previous=process.cwd()
 process.chdir(slot.projectDirectory)
 const {startEngine}=await import('../../engine/engine-embed')
 const engine=await startEngine(buildEngineServerOptions({hostname:'127.0.0.1',port:0,password:'a2-failure',engineVersion:'test',databasePath:slot.databasePath,configDirectory:slot.configDirectory,config:{content:'{}'},models:{fetch:false},filewatcher:false,platform:process.platform}),{projectTrust:()=>true})
 try {
 const original=await captureFixture('external_plugins/playwright')
 const definition=JSON.parse(new TextDecoder().decode(await original.readFile('.mcp.json')))
 const capture=await captureFixture('external_plugins/playwright',{'.mcp.json':JSON.stringify({...definition,playwright:{...definition.playwright,command:'node',args:[join(sandbox.root,'missing-a2-cli.js')]}})})
 const converted=await convertPluginTree(capture)
 const {pluginRuntimeIdentity}=await import('./plugin-sources')
 const connect=async()=>({url:engine.url,username:'opencode',password:'a2-failure'})
 const installer=createSourceInstaller({globalRoot:()=>root,casBaseRoot:()=>join(sandbox.root,'failed-state'),environment:()=> 'dev',userDataPath:sandbox.root,advisoryGate:()=>({allowed:true}),resolvePackage:async()=>{throw Error('not catalog')},sources:{convertCandidate:async()=>({ok:true,...converted,capture,runtimeIdentity:pluginRuntimeIdentity(converted.package)}),catalogComparisons:async()=>[],release:()=>{}},catalogInstall:async()=>{throw Error('not catalog')},activateMcp:(id)=>createManagedMcpConvergence({root:()=>root,awaitServer:connect,directory:()=>slot.projectDirectory,userDataPath:()=>sandbox.root})(managedMcpNamesOf(root,id)),reloadSkills:()=>{throw Error('not skill')},removeDeparting:()=>{}})
 expect(await installer({requestId:'failed_start_a2',source:{kind:'candidate',candidateId:'cand_controlled_failure'},effect:{kind:'all-projects'},via:'chat'})).toMatchObject({ok:true,packageId:'claude:playwright'})
 const client=engineClient(await connect())
 let observed
 for(const end=Date.now()+15000;;await Bun.sleep(50)) {
 observed=(await client.mcp.list()).data.find(server=>server.name===PLAYWRIGHT)
 if(observed&&observed.status.status!=='pending')break
 if(Date.now()>end)throw Error('failed MCP did not settle')
 }
 expect(observed?.status.status).toBe('failed')
 // Whole-tree installation owns a bundle root and its MCP, even when the runtime fails to start.
 expect(readPackageLedgerStateV1(root)).toMatchObject({ok:true,packageGraphs:[{packageId:'claude:playwright',root:{kind:'bundle'},children:[{kind:'mcp',name:PLAYWRIGHT}]}],records:[{kind:'bundle',desiredState:'enabled'},{kind:'mcp',name:PLAYWRIGHT,desiredState:'enabled'}]})
 } finally {await engine.close();process.chdir(previous)}
},30000)
