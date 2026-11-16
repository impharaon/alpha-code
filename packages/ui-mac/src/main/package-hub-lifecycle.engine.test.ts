import { expect, test } from "bun:test"
import { join } from "node:path"

test("desktop package lifecycle uses main IPC, the real ext scheduler and sandbox engine", () => {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      "test",
      "--timeout",
      "180000",
      join(import.meta.dir, "package-hub-lifecycle.engine.cases.ts"),
    ],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output).toMatch(/\b3 pass\b/)
  expect(output).toMatch(/\b0 fail\b/)
}, 240_000)
