import { expect, test } from "bun:test"
import { join } from "node:path"
import { prepareEngineNpmCache } from "../../test-component/engine-npm-cache"

test("A2 actual package install reaches two Locations and rebuild (two real-engine cases)", async () => {
  const cache = await prepareEngineNpmCache(["@playwright/mcp@latest"])
  try {
    const result = Bun.spawnSync({ cmd: [process.execPath, "test", "--max-concurrency", "2", "--timeout", "180000", join(import.meta.dir, "install-from-source.engine.cases.ts")], cwd: join(import.meta.dir, "../.."), env: cache.env })
    const output = result.stdout.toString() + result.stderr.toString()
    if (result.exitCode !== 0) throw Error(output)
    expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("2")
    expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  } finally { cache.close() }
}, 360000)
