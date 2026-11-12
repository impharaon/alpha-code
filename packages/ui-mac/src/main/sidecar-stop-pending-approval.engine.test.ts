// `#1647` AC1 在 OpenCode 2 上(`#1662` parity 第 8 项):停在审批上的一轮,停止引擎即被释放。
// 宿主:真判据在 sidecar-stop-pending-approval.engine.cases.ts(独立 `bun test` 子进程:沙箱真引擎 + 生产注入 + 真 ext + 模型桩 + 真 MCP)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("#1647 AC1:等审批时停引擎 ⇒ 这一轮被释放、工具零执行(sidecar-stop-pending-approval.engine.cases.ts,3 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "sidecar-stop-pending-approval.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("3")
}, 300_000)
