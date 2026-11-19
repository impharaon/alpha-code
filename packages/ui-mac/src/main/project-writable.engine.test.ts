import { expect, test } from "bun:test"
import { join } from "node:path"

test.skipIf(process.platform !== "darwin")("V3/V4/V5 real engine, fence and main grant wiring", async () => {
  const child = Bun.spawn({ cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "project-writable.engine.cases.ts")], cwd: join(import.meta.dir, "../.."), env: process.env, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  expect(code, output).toBe(0)
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("6")
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
}, 300_000)
