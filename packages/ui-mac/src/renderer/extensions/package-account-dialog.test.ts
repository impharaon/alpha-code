import { expect, test } from "bun:test"
import { resolve } from "node:path"
test("BC4 shared package token dialog uses main declarations and one credential writer",()=>{
 const result=Bun.spawnSync({cmd:[process.execPath,"test","--max-concurrency","2",resolve(import.meta.dir,"../../../test-component/package-account-dialog.cases.ts")],cwd:resolve(import.meta.dir,"../../.."),env:process.env})
 const output=result.stdout.toString()+result.stderr.toString()
 if(result.exitCode!==0)throw Error(output)
 expect(output).toMatch(/\b4 pass\b/);expect(output).toMatch(/\b0 fail\b/)
},60000)
