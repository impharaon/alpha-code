// `#1667`(#1662 L5,设计 1662「MCP OAuth on OpenCode 2」决定 3):admission 的 MCP OAuth 就绪探针在 OpenCode 2 上的语义。
// 宿主:真判据在 package-mcp-oauth.engine.cases.ts(独立 `bun test` 子进程:沙箱真引擎 + 本机 OAuth/MCP 替身 + 生产接缝)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("就绪探针走 2.x 路由:登录前 needs_auth、登录后同名同 URL connected、换名 needs_auth、引擎拒绝 ⇒ ok:false、v1 路由拿不到状态(package-mcp-oauth.engine.cases.ts,3 条)", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "package-mcp-oauth.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("3")
}, 300_000)
