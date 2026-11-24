import { resolve } from "node:path"
import { expect, test } from "bun:test"

test.skipIf(process.platform !== "darwin")(
  "official GitHub and DBHub encrypted recipes, IPC lifecycle, protocol and real SQLite gates",
  () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, "test", "--max-concurrency", "2", resolve(import.meta.dir, "../../test-component/official-connectors.cases.ts")],
      cwd: resolve(import.meta.dir, "../.."),
      env: process.env,
    })
    const output = `${result.stdout.toString()}${result.stderr.toString()}`
    if (result.exitCode !== 0) throw new Error(output)
    expect(output).toMatch(/\b18 pass\b/)
    expect(output).toMatch(/\b0 fail\b/)
  },
  180_000,
)
