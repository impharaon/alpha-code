import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { resolve, join } from "node:path"
import { spawnSync } from "node:child_process"
import { buildFenceAddon } from "../../scripts/build-fence-addon"
import { buildPackageManagerHelper } from "../../scripts/build-package-manager-helper"

test.skipIf(process.platform !== "darwin")("native package-manager helper authenticates the kernel peer, streams bytes, and preserves fenced stdin", async () => {
  const cache = resolve(import.meta.dirname, "../../node_modules/.cache")
  mkdirSync(cache, { recursive: true })
  const scratch = mkdtempSync(join(cache, "package-manager-helper-"))
  try {
    const addon = buildFenceAddon({ out: join(scratch, "codepuppy_fence.node"), buildId: "package-manager-helper-test" }).out
    const helper = buildPackageManagerHelper(join(scratch, "codepuppy-package-manager"))
    const driver = join(scratch, "driver.mjs")
    await Bun.write(driver, `
import { createRequire } from "node:module"
import { copyFileSync } from "node:fs"
import { spawn } from "node:child_process"
import http from "node:http"
import { once } from "node:events"
const native = createRequire(import.meta.url)(${JSON.stringify(addon)})
const helper = ${JSON.stringify(helper)}
const proof = "a1".repeat(32), authorization = "b2".repeat(32)
const bytes = Buffer.from([0,255,120,10,128,90])
let mode, claims = [], requests = 0, frames = [], response
const server = http.createServer(async (req,res) => {
 requests++
 const authorized = req.headers.authorization === "Bearer " + authorization
 if(!authorized) throw Error("test authorization mismatch")
 if(mode==="consumed") { const body=JSON.stringify({error:"node-consumed"}); res.writeHead(409,{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)});res.end(body);return }
 let input = "", first = true, sequence = 0
 for await (const chunk of req) {
  input += chunk.toString()
  while(input.includes("\\n")) {
   const newline=input.indexOf("\\n"), value=JSON.parse(input.slice(0,newline)); input=input.slice(newline+1)
   if(first) {
    first=false
    if(Object.keys(value).length!==2 || value.executionID!=="execution" || value.nodeID!=="node") throw Error("test node mismatch")
    res.writeHead(200,{"Content-Type":"application/x-ndjson"})
    if(mode==="fenced") { res.end(JSON.stringify({type:"fenced"})+"\\n"); break }
    res.write(JSON.stringify({type:"stdout",seq:sequence++,dataBase64:""})+"\\n")
    continue
   }
   frames.push(value.type)
   if(value.type==="stdin") res.write(JSON.stringify({type:"stdout",seq:sequence++,dataBase64:value.dataBase64})+"\\n")
   if(value.type==="stdin-eof") {
    res.write(JSON.stringify({type:"stderr",seq:sequence++,dataBase64:Buffer.from("native stderr").toString("base64")})+"\\n")
    res.end(JSON.stringify({type:"exit",exitCode:17,signal:null})+"\\n")
   }
  }
  if(mode==="fenced") break
 }
})
server.listen(0,"127.0.0.1"); await once(server,"listening")
const root=native.packageManagerProcessIdentity(process.pid)
const serviceName="app.codepuppy.helper.test."+process.pid
const service=native.startPackageManagerService(serviceName,helper,(input,peer,reply)=>{
 claims.push({proofMatches:input.nodeProof===proof,pid:peer.pid,pidversion:peer.pidversion,descendant:native.packageManagerBoundDescendant(peer.pid,peer.pidversion,root),wrongVersion:native.packageManagerBoundDescendant(peer.pid,peer.pidversion+1,root),wrongBirth:native.packageManagerBoundDescendant(peer.pid,peer.pidversion,{...root,startAbstime:root.startAbstime+1n})})
 reply(mode==="reject"?{kind:"error",error:"unauthorized"}:{kind:"delegated",brokerPort:server.address().port,authorization})
})
const rows=[]
const rogue=helper+"-copy"; copyFileSync(helper,rogue)
for(mode of ["reject","success","fenced","consumed","rogue"]) {
 const before=claims.length, priorRequests=requests
 const child=spawn(mode==="rogue"?rogue:helper,["--service",serviceName,"--execution","execution","--node","node","--proof-fd","9","--","/bin/cat"],{stdio:["pipe","pipe","pipe","ignore","ignore","ignore","ignore","ignore","ignore","pipe"]})
 const stdout=[],stderr=[]; child.stdout.on("data",b=>stdout.push(b)); child.stderr.on("data",b=>stderr.push(b))
 const exited=once(child,"close")
 child.stdio[9].end(proof+"\\n");child.stdin.end(bytes)
 const [code,signal]=await exited
 rows.push({mode,code,signal,pid:child.pid,claims:claims.slice(before),requests:requests-priorRequests,stdout:Buffer.concat(stdout).toString("base64"),stderr:Buffer.concat(stderr).toString(),argvContainsCredential:child.spawnargs.some(value=>value.includes(proof)||value.includes(authorization))})
}
native.closePackageManagerService(service)
await new Promise(resolve=>server.close(resolve))
console.log(JSON.stringify({rows,frames}))
`)
    const result = spawnSync(Bun.which("node")!, [driver], { encoding: "utf8", timeout: 20_000 })
    expect(result.status, result.stderr).toBe(0)
    const record = JSON.parse(result.stdout)
    expect(record.rows.map((row: { code: number }) => row.code)).toEqual([126, 17, 0, 126, 126])
    for (const row of record.rows) {
      expect(row.argvContainsCredential).toBe(false)
      if (row.mode === "rogue") { expect(row.claims).toEqual([]); expect(row.requests).toBe(0); continue }
      expect(row.claims).toEqual([{ proofMatches: true, pid: row.pid, pidversion: expect.any(Number), descendant: true, wrongVersion: false, wrongBirth: false }])
    }
    expect(record.rows[0].stderr).toContain("unauthorized")
    expect(record.rows[0].requests).toBe(0)
    expect(record.rows[1].stdout).toBe(Buffer.from([0,255,120,10,128,90]).toString("base64"))
    expect(record.rows[1].stderr).toBe("native stderr")
    expect(record.rows[2].stdout).toBe(record.rows[1].stdout)
    expect(record.rows[3].stderr).toContain("node-consumed")
    expect(record.frames).toContain("stdin-eof")
  } finally { rmSync(scratch, { recursive: true, force: true }) }
})
