import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { resolve, join } from "node:path"
import { spawnSync } from "node:child_process"
import { buildFenceAddon } from "../../scripts/build-fence-addon"
import { buildPackageManagerHelper } from "../../scripts/build-package-manager-helper"
import { packageManagerScannerCode, PACKAGE_MANAGER_SCANNER } from "../../scripts/package-manager-build"

// Integration uses the real main book, kernel claims and signed helper. Real formula installs are scenario-only.
test.skipIf(process.platform !== "darwin")("main node book rejects bad proofs and frames, consumes once, and cleans the whole process group", async () => {
  const cache = resolve(import.meta.dirname, "../../node_modules/.cache")
  mkdirSync(cache, { recursive: true })
  const scratch = mkdtempSync(join(cache, "package-manager-execution-"))
  try {
    const addon = buildFenceAddon({ out: join(scratch, "codepuppy_fence.node"), buildId: "package-manager-execution-test" }).out
    const helper = buildPackageManagerHelper(join(scratch, "codepuppy-package-manager"))
    const driver = join(scratch, "driver.ts")
    await Bun.write(driver, `import {openPackageManagerGeneration,handlePackageManagerProcess,stopPackageManagerExecutions} from ${JSON.stringify(resolve(import.meta.dirname, "package-manager-execution.ts"))}\nimport {readHomebrewInstallations} from ${JSON.stringify(resolve(import.meta.dirname, "homebrew-installation.ts"))}\nconst root=${JSON.stringify(scratch)},addon=${JSON.stringify(addon)},helper=${JSON.stringify(helper)}\n` + String.raw`
import assert from "node:assert/strict"
import http from "node:http"
import {once} from "node:events"
import {spawn} from "node:child_process"
import {mkdirSync,writeFileSync,readFileSync,existsSync,chmodSync,unlinkSync} from "node:fs"
import {join} from "node:path"
const prefix=join(root,"homebrew"),cwd=join(root,"project"),report=join(root,"spawns.jsonl"),pids=join(root,"pids")
mkdirSync(join(prefix,"bin"),{recursive:true});mkdirSync(join(prefix,"Library/Homebrew"),{recursive:true});mkdirSync(cwd)
writeFileSync(join(prefix,"Library/Homebrew/brew.sh"),"owned test fixture")
const launcher=join(prefix,"bin/brew")
writeFileSync(launcher, '#!/bin/bash\nprintf \'{"pid":%s,"cwd":"%s","arg":"%s","bash_env":"%s","proxy":"%s"}\\n\' "$$" "$PWD" "$1" "$BASH_ENV" "$HTTP_PROXY" >> '+JSON.stringify(report)+'\ncase "$1" in\n stream) /bin/cat; printf stderr >&2; exit 17;;\n wait) trap \'exit 0\' TERM; /bin/bash -c \'trap "" TERM; printf child-ready > "$1"; while :; do sleep 1; done\' child '+JSON.stringify(pids+'-ready')+' & while [ ! -e '+JSON.stringify(pids+'-ready')+' ]; do sleep 0.01; done; printf "%s %s" "$$" "$!" > '+JSON.stringify(pids)+'; printf ready; wait;;\n *) printf "%s" "$1";;\nesac\n')
chmodSync(launcher,0o755)
const installations=readHomebrewInstallations([prefix],[]);assert.equal(installations.length,1)
const actual=http.createServer((req,res)=>{void handlePackageManagerProcess(req,res)})
actual.listen(0,"127.0.0.1");await once(actual,"listening")
let mode="normal",status
// A transport attacker changes frames, never the main plan or native proof.
const front=http.createServer((req,res)=>{
 const outgoing=http.request({host:"127.0.0.1",port:actual.address().port,path:req.url,method:req.method,headers:{...req.headers,host:"127.0.0.1"}},response=>{
  status=response.statusCode;res.writeHead(response.statusCode,response.headers);response.on("data",bytes=>{
   res.write(bytes)
   if(mode==="late" && bytes.toString().includes(Buffer.from("ready").toString("base64"))){mode="late-sent";outgoing.end(JSON.stringify({type:"stdin",dataBase64:123})+"\n")}
  });response.on("end",()=>res.end())
 });outgoing.on("error",()=>res.destroy())
 let buffer="",first=true
 req.on("data",bytes=>{
  buffer+=bytes.toString()
  while(buffer.includes("\n")){
   const at=buffer.indexOf("\n"),line=buffer.slice(0,at);buffer=buffer.slice(at+1)
   if(first){first=false;const ids=JSON.parse(line);outgoing.write(mode==="early"?JSON.stringify({...ids,argv:["evil"]})+"\n":line+"\n");if(mode==="early")outgoing.end()}
   else if(mode==="normal")outgoing.write(line+"\n")
  }
 });req.on("end",()=>{if(mode==="normal")outgoing.end()})
})
front.listen(0,"127.0.0.1");await once(front,"listening")
const generation=openPackageManagerGeneration({env:{HOME:root,PATH:join(prefix,"bin")+":/usr/bin:/bin",HTTP_PROXY:"http://user.example:1234",BASH_ENV:"/ignored/injection",PS4:"injection"},installations,port:front.address().port,addon})
const authorize=async command=>{const result=await generation.control({op:"authorize",input:{shellID:"shell",sessionID:"session",messageID:"message",callID:"call",command,cwd,shell:"/bin/bash"}});assert.equal(result.ok,true);return result.lease}
const collect=child=>{const stdout=[],stderr=[];child.stdout.on("data",x=>stdout.push(x));child.stderr.on("data",x=>stderr.push(x));return once(child,"close").then(([exit,signal])=>({exit,signal,stdout:Buffer.concat(stdout).toString(),stderr:Buffer.concat(stderr).toString()}))}
const spawns=()=>existsSync(report)?readFileSync(report,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse):[]
const rows=[]
// Binding to this actual test host permits sibling signed helpers; production H2 binds the actual Shell.
const lease=await authorize("brew stream");await generation.control({op:"bind",executionID:lease.executionID,pid:process.pid})
const sibling=async proof=>{const c=spawn(helper,["--service",lease.helperService,"--execution",lease.executionID,"--node",lease.nodes[0].nodeID,"--proof-fd","3","--","brew","ignored"],{stdio:["pipe","pipe","pipe","pipe"]});const done=collect(c);c.stdio[3].end(proof);c.stdin.end("binary input\n");return done}
for(const proof of ["G".repeat(64)+"\n","1".repeat(64)+"\n"]){const result=await sibling(proof);assert.equal(result.exit,126);assert.match(result.stderr,/unauthorized/);assert.equal(spawns().length,0)}
const streamed=await sibling(Buffer.from(lease.shellPrivateInput.data));assert.equal(streamed.exit,17);assert.equal(streamed.stdout,"binary input\n");assert.equal(streamed.stderr,"stderr");assert.equal(spawns().length,1);assert.equal(spawns()[0].bash_env,"");assert.equal(spawns()[0].proxy,"http://user.example:1234")
const replay=await sibling(Buffer.from(lease.shellPrivateInput.data));assert.equal(replay.exit,126);assert.match(replay.stderr,/node-consumed/);assert.equal(spawns().length,1)
await generation.control({op:"finish",executionID:lease.executionID});await generation.control({op:"finish",executionID:lease.executionID});rows.push("proof-format/wrong/pending/real/once/finish")
// Bind the real shell before exec; its process instance survives the image change.
const execLease=await authorize("brew stream")
const execRoot=spawn("/bin/bash",["-c",'printf exec-ready; IFS= read -r go; exec /bin/sh -c "$1"',"root",execLease.executionSource],{cwd,env:{HOME:root,PATH:join(prefix,"bin")+":/usr/bin:/bin"},stdio:["pipe","pipe","pipe","pipe"]})
const execDone=collect(execRoot)
await once(execRoot.stdout,"data")
await generation.control({op:"bind",executionID:execLease.executionID,pid:execRoot.pid})
execRoot.stdio[3].end(Buffer.from(execLease.shellPrivateInput.data));execRoot.stdin.end("go\n")
const execResult=await execDone;assert.equal(execResult.exit,17,execResult.stderr);assert.equal(execResult.stdout,"exec-ready");assert.equal(execResult.stderr,"stderr")
await generation.control({op:"finish",executionID:execLease.executionID});rows.push("root-exec")
for(const kind of ["early","late"]){
 mode=kind;const l=await authorize(kind==="early"?"brew stream":"brew wait"),before=spawns().length
 const c=spawn("/bin/bash",["-c",l.executionSource],{cwd,env:{HOME:root,PATH:join(prefix,"bin")+":/usr/bin:/bin"},stdio:["pipe","pipe","pipe","pipe"]});const done=collect(c);await generation.control({op:"bind",executionID:l.executionID,pid:c.pid});c.stdio[3].end(Buffer.from(l.shellPrivateInput.data));c.stdin.end();const result=await done
 assert.notEqual(result.exit,0);assert.match(result.stderr,/invalid-request/);await generation.control({op:"finish",executionID:l.executionID})
 if(kind==="early"){assert.equal(status,400);assert.equal(spawns().length,before)}
 else {assert.equal(status,200);await generation.close();for(const pid of readFileSync(pids,"utf8").split(" "))assert.throws(()=>process.kill(Number(pid),0),/ESRCH/)}
 rows.push(kind+"-invalid")
}
await generation.close();mode="normal";unlinkSync(pids);unlinkSync(pids+"-ready")
const quitting=openPackageManagerGeneration({env:{HOME:root,PATH:join(prefix,"bin")+":/usr/bin:/bin"},installations,port:actual.address().port,addon})
const q=(await quitting.control({op:"authorize",input:{shellID:"quit",sessionID:"session",messageID:"message",callID:"call",command:"brew wait",cwd,shell:"/bin/bash"}})).lease
const c=spawn("/bin/bash",["-c",q.executionSource],{cwd,env:{HOME:root,PATH:join(prefix,"bin")+":/usr/bin:/bin"},stdio:["pipe","pipe","pipe","pipe"]});const done=collect(c);await quitting.control({op:"bind",executionID:q.executionID,pid:c.pid});c.stdio[3].end(Buffer.from(q.shellPrivateInput.data));c.stdin.end()
while(!existsSync(pids))await new Promise(r=>setTimeout(r,10))
await stopPackageManagerExecutions();const result=await done;assert.notEqual(result.exit,0);for(const pid of readFileSync(pids,"utf8").split(" "))assert.throws(()=>process.kill(Number(pid),0),/ESRCH/);rows.push("normal-app-exit-group")
front.closeAllConnections();actual.closeAllConnections();front.close();actual.close();console.log(JSON.stringify({rows,spawns:spawns().length}))
`)
    const build = await Bun.build({ entrypoints: [driver], target: "node", outdir: join(scratch, "out"), plugins: [{ name: "actual-shell-scan", setup(build) {
      build.onResolve({ filter: /^virtual:codepuppy-shell-scan$/ }, () => ({ path: PACKAGE_MANAGER_SCANNER, namespace: "scanner" }))
      build.onLoad({ filter: /.*/, namespace: "scanner" }, () => ({ contents: packageManagerScannerCode(), loader: "ts" }))
    } }] })
    if (!build.success) throw new AggregateError(build.logs, "main package-manager test build failed")
    const result = spawnSync("node", [build.outputs[0].path], { encoding: "utf8", timeout: 30000 })
    expect(result.status, result.stderr + result.stdout).toBe(0)
    const evidence = JSON.parse(result.stdout.trim())
    expect(evidence.rows).toEqual(["proof-format/wrong/pending/real/once/finish", "root-exec", "early-invalid", "late-invalid", "normal-app-exit-group"])
    expect(evidence.spawns).toBe(4)
  } finally { rmSync(scratch, { recursive: true, force: true }) }
}, 40000)
