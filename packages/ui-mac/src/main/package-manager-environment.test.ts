import { beforeAll, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

let driver: string
let scratch: string
const node = Bun.which("node")!
const projection = { npm_config_cache: "/app/caches/npm", GOCACHE: "/app/caches/go" }

beforeAll(async () => {
  const cache = resolve(import.meta.dir, "../../node_modules/.cache")
  mkdirSync(cache, { recursive: true })
  scratch = mkdtempSync(join(cache, "package-manager-environment-"))
  driver = join(scratch, "driver.mjs")
  const result = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "../../test-fixtures/process-fence/package-manager-driver.ts")],
    target: "node", format: "esm", outdir: scratch, naming: "driver.mjs",
  })
  if (!result.success) throw new AggregateError(result.logs)
})

function run(mode: string, env: Record<string, string | undefined> = {}, args: string[] = []) {
  const result = spawnSync(node, [driver, mode, ...args], {
    env: { ...process.env, DROP_ME: "parent", KEEP_ME: "parent", CACHE_PROJECTION: JSON.stringify(projection), ...env },
    encoding: "utf8", timeout: 20_000,
  })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim().split("\n").findLast((line) => line.startsWith("RESULT "))?.slice(7) ?? result.stdout.trim())
}

test("package manager spawn environment: real Node spawner preserves inheritance, deletion, pipes and exit", () => {
  const result = run("spawn")
  expect(result.explicit).toMatchObject({ ...projection, PLAIN: "explicit", CARGO_HOME: "/caller/cargo", KEEP_ME: "parent" })
  expect(result.explicit.DROP_ME).toBeUndefined()
  expect(result.isolated).toEqual({ ...projection, PLAIN: "isolated" })
  expect(result.inherited).toMatchObject({ ...projection, KEEP_ME: "parent" })
  expect(result.piped).toBe(`pipe input${projection.npm_config_cache}\n`)
  expect(result.exit).toBe(23)
})

test("package manager spawn environment: real native PTY receives final projection", () => {
  const native = Bun.resolveSync("@lydell/node-pty", resolve(import.meta.dir, "../../../core"))
  expect(run("pty", { OPENCODE_NODE_PTY_PATH: native })).toMatchObject({ ...projection, PLAIN: "pty" })
})

test("npm cache after config load failure uses the same projection", () => {
  const malformed = join(scratch, "config-directory")
  mkdirSync(malformed)
  const config = run("npm", { npm_config_userconfig: malformed, npm_config_globalconfig: malformed }, [scratch])
  expect(config.original).toEqual({})
  expect(config.projected.cache).toBe(projection.npm_config_cache)
  // A normal explicit npm configuration still has its existing precedence.
  expect(run("npm", { npm_config_cache: join(scratch, "explicit-cache") }, [scratch]).projected.cache).toBe(join(scratch, "explicit-cache", "_cacache"))
})
