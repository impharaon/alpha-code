import { expect, test } from "bun:test"
import { join } from "node:path"

test("BC5 recorded entrypoints use the real desktop install entry and engine (five cases)", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--max-concurrency", "2", "--timeout", "180000", join(import.meta.dir, "plugin-entrypoints.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
  })
  const output = result.stdout.toString() + result.stderr.toString()
  if (result.exitCode !== 0) throw Error(output)
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("5")
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
}, 240_000)
