import { expect, test } from "bun:test"
import { join } from "node:path"

test("endpoint route authority cases", async () => {
  const child = Bun.spawn([process.execPath, "test", "--max-concurrency", "2", join(import.meta.dir, "endpoint-route.cases.ts")], { cwd: join(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = stdout + stderr
  expect(code, output).toBe(0)
  expect(output).toContain("6 pass")
  expect(output).toContain("0 fail")
}, 30_000)
