// `#1411` / `#1443`(ADR-046 D1)在 OpenCode 2 上(`#1662` parity 第 9 项合成判据):真 fork env → 引擎这一刻交给模型的 web search 工具。
// 宿主:真判据在 websearch-account-tool-table.engine.cases.ts(独立 `bun test` 子进程:main 的 spawnLocalServer 假 fork 取 env + 生产注入 +
// 沙箱里的嵌入式引擎 + 真 ext + 本机云 MCP 桩与模型桩)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("账户态工具表:代付两条都在、登出只剩本地、kill-switch 两条都不在;去掉注入的 deny 即回来(websearch-account-tool-table.engine.cases.ts,4 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "websearch-account-tool-table.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("4")
}, 400_000)
