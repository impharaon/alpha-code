import { expect, test } from "bun:test"
import { resolve } from "node:path"
test("项目信任组件:不完整下次再查、已有决定不再查、允许后重载(ext-trust-watcher.cases.ts,3 条)", async () => {
  const child = Bun.spawn({ cmd: [process.execPath, "test", resolve(import.meta.dir, "../../../test-component/ext-trust-watcher.cases.ts")], cwd: resolve(import.meta.dir, "../../.."), env: process.env, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = out + err
  if (code !== 0) throw new Error(output)
  expect(output).toMatch(/\b3 pass\b/)
  expect(output).toMatch(/\b0 fail\b/)
}, 60_000)
