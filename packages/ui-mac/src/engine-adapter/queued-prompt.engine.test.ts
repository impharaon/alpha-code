// `#1669`:回合停在审批上时追加的一句,回答审批之前就显示成用户气泡(同 0.1.26),回答后只有一条、回合照跑。
// 宿主:真判据在 queued-prompt.engine.cases.ts(独立 `bun test` 子进程:沙箱真引擎 + 生产适配器 + 冻结 app 的会话 store)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("#1669 审批等待中追加一句:回答前两个窗口与重新加载都有这条用户消息、反向臂(去掉 session.inbox.enqueued)没有、允许一次后一条气泡 = 引擎 = 重新加载、停止后留在收件箱气泡留着(queued-prompt.engine.cases.ts,4 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "180000", join(import.meta.dir, "queued-prompt.engine.cases.ts")],
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
