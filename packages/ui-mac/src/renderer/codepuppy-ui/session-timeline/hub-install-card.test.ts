import { expect, test } from "bun:test"
import { resolve } from "node:path"

test("A4 production install card: main progress, engine truth, remount, provenance and management", () => {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      "test",
      "--max-concurrency",
      "2",
      resolve(import.meta.dir, "../../../../test-component/hub-install-card.cases.ts"),
    ],
    cwd: resolve(import.meta.dir, "../../../.."),
    env: process.env,
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1]).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1]).toBe("7")
  expect(output.match(/Ran \d+ tests? across (\d+) files?/)?.[1]).toBe("1")
}, 60_000)
