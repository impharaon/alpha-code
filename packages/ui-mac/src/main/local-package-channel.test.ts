// Public namespace and installed-source contracts survive the retired Hub import transports.
import { resolve } from "node:path"
import { expect, test } from "bun:test"

test("`local:` 命名空间双向闸(G8)与已装包只读投影的来源维", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", resolve(import.meta.dir, "../../test-component/local-package-namespace.cases.ts")],
    cwd: resolve(import.meta.dir, "../.."),
    env: process.env,
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output).toMatch(/\b5 pass\b/)
  expect(output).toMatch(/\b0 fail\b/)
  expect(output).toMatch(/Ran 5 tests across 1 file/)
}, 180_000)
