// `#1669`:同一个对话里切回「全部批准」/ 默认助手,引擎的下一轮真的回到默认助手(0.1.26:不带 agent = 默认助手)。
// 宿主:真判据在 default-agent.engine.cases.ts(独立 `bun test` 子进程:沙箱真引擎 + 生产注入 + 真 ext + 生产适配器 + 界面的请求构造)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("#1669 普通发送、斜杠命令、继续、终端命令切回默认后由默认助手跑;量具自检判得出差别(default-agent.engine.cases.ts,5 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "120000", join(import.meta.dir, "default-agent.engine.cases.ts")],
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
