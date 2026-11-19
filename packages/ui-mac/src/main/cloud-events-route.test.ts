import { expect, test } from "bun:test"
import { join } from "node:path"

test("cloud SSE reselects its destination on reconnect without losing the cursor", async () => {
  const child = Bun.spawn([process.execPath, "test", "--max-concurrency", "2", join(import.meta.dir, "cloud-events-route.cases.ts")], { cwd: join(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = stdout + stderr
  expect(code, output).toBe(0)
  expect(output).toContain("1 pass")
  expect(output).toContain("0 fail")
}, 15_000)
