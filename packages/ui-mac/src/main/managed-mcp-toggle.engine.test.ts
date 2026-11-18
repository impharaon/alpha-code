import { expect, test } from "bun:test"
import { join } from "node:path"

// I-11 方案 A(alpha-code#1724):受管全局 MCP 的开关只影响该连接器 —— 真引擎证明在 cases 文件里,独立子进程跑(进程级 HOME/XDG 沙箱)。
test("managed MCP toggles converge per connector on the real engine with production injection and the real ext", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--timeout", "180000", join(import.meta.dir, "../../test-component/managed-mcp-toggle.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("6")
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
}, 480_000)
