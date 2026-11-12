// REQ-236 AC2 / AC3(`#1562`)在 OpenCode 2 上(`#1662` parity B4):续期热应用的端到端判据。
// 宿主:真判据在 token-hot-apply.engine.cases.ts(独立 `bun test` 子进程:沙箱里的嵌入式引擎 + 生产注入 + 真 ext + 本机假网关)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("续期热应用:令牌 A ⇒ A、热应用 B ⇒ B、删文件 ⇒ 具名失败零请求、令牌不进日志与响应;不装 ext ⇒ 占位值被拒(token-hot-apply.engine.cases.ts,2 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "150000", join(import.meta.dir, "token-hot-apply.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("2")
}, 300_000)
