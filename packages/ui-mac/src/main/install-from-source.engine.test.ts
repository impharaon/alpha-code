import { expect, test } from "bun:test"
import { join } from "node:path"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

test("A2 actual package install reaches two Locations and rebuild (two real-engine cases)", () => {
  const cache = mkdtempSync(join(tmpdir(), "a2-clean-npm-"))
  try {
  const result = Bun.spawnSync({ cmd: [process.execPath, "test", "--max-concurrency", "2", "--timeout", "180000", join(import.meta.dir, "install-from-source.engine.cases.ts")], cwd: join(import.meta.dir, "../.."), env: { ...process.env, npm_config_cache: cache, npm_config_offline: "true" } })
  const output = result.stdout.toString() + result.stderr.toString()
  if (result.exitCode !== 0) throw Error(output)
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("2")
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  } finally { rmSync(cache, { recursive: true, force: true }) }
}, 240000)
