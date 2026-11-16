import { expect, test } from "bun:test"
import { join } from "node:path"
import { prepareEngineNpmCache } from "../../test-component/engine-npm-cache"

test("package effect isolation uses real engines and the config debounce window", async () => {
  const cache = await prepareEngineNpmCache(["@playwright/mcp@latest", "@playwright/mcp@0.0.77"])
  try {
    const result = Bun.spawnSync({ cmd: [process.execPath, "test", "--max-concurrency", "2", "--timeout", "180000", join(import.meta.dir, "package-effect.engine.cases.ts")], cwd: join(import.meta.dir, "../.."), env: cache.env })
    const output = result.stdout.toString() + result.stderr.toString()
    if (result.exitCode !== 0) throw Error(output)
    expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("5")
    expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  } finally { cache.close() }
}, 480000)
