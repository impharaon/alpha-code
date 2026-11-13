// `#1669` R17:从 @ 菜单点名的助手,这一轮派给它(0.1.26:派子任务;请求审批档弹委派卡)。
// 宿主:真判据在 agent-mention.engine.cases.ts(独立 `bun test` 子进程:沙箱真引擎 + 生产注入 + 真 ext + 生产适配器 + 界面的请求构造与审批卡通道)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("#1669 R17 选中 @general 派子任务、请求审批档拿到委派卡、没选中不派(agent-mention.engine.cases.ts,3 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "120000", join(import.meta.dir, "agent-mention.engine.cases.ts")],
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
}, 400_000)
