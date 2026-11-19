import { expect, test } from "bun:test"
import { join } from "node:path"

test("main project-write eligibility, IPC and live listener wiring", async () => {
  const child = Bun.spawn({ cmd: [process.execPath, "test", "--timeout", "30000", join(import.meta.dir, "project-writable-ipc.cases.ts")], cwd: join(import.meta.dir, "../.."), env: process.env, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  expect(code, output).toBe(0)
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("10")
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
}, 60_000)
