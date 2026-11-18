// `#1724`:独立子进程运行真实引擎用例(runner-mcp-startup.engine.cases.ts,1 条)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("经包运行器启动的本地 MCP 首次下载超过默认握手时长仍能连上,坏的给出具名失败(真引擎)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "180000", join(import.meta.dir, "runner-mcp-startup.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("1")
}, 300_000)
