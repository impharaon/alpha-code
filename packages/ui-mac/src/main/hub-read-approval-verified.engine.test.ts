// Codex 审查(fix/hub-status-approval R1/1 #2):助手只读查找 / 状态在出货形态身份下的过期「始终允许」三档格。宿主:真判据在
// hub-read-approval-verified.engine.cases.ts(独立 `bun test` 子进程:沙箱真引擎 + 生产注入 + 经随包清单核验的真 ext + 本机模型桩)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("核验过的身份 + 摘要不同的 enabled 记录:三档零询问、照常执行;用户设成询问照旧问(hub-read-approval-verified.engine.cases.ts,1 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "120000", join(import.meta.dir, "hub-read-approval-verified.engine.cases.ts")],
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
