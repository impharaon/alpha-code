import { expect, test } from "bun:test"
import { join } from "node:path"

test("own plugin completes its task in the real engine and is removed whole", () => {
  const result = Bun.spawnSync({ cmd: [process.execPath, "test", "--max-concurrency", "2", "--timeout", "120000", join(import.meta.dir, "created-plugin.engine.cases.ts")], cwd: join(import.meta.dir, "../.."), env: process.env })
  const output = result.stdout.toString() + result.stderr.toString()
  if (result.exitCode !== 0) throw Error(output)
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("1")
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
}, 180000)
