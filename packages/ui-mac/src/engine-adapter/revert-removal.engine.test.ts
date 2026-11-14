// `#1669`:编辑中间一条消息并重发后,界面上的对话 = 引擎历史 = 重新加载(被删的旧问答不留在屏幕上)。
// 宿主:真判据在 revert-removal.engine.cases.ts(独立 `bun test` 子进程:沙箱真引擎 + 生产适配器 + 冻结 app 的会话 store)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("#1669 长对话编辑重发:暂存不删、重发后两个窗口 = 引擎 = 重新加载、暂存期间落下的消息一并删、反向臂(去掉 message.removed)旧问答残留(revert-removal.engine.cases.ts,5 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "180000", join(import.meta.dir, "revert-removal.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("5")
}, 400_000)
