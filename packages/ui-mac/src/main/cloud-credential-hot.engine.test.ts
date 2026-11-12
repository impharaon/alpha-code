// REQ-236 AC2 / AC3(`#1562`)的云连接器一半在 OpenCode 2 上(`#1662` parity 第 5 项):每个请求现读凭据,续期热应用不重启。
// 宿主:真判据在 cloud-credential-hot.engine.cases.ts(独立 `bun test` 子进程:沙箱里的嵌入式引擎 + 生产注入 + 真 ext + 本机 MCP 端点)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("云连接器:同一条连接上令牌 A ⇒ A、热应用 B ⇒ 下一个 POST 与重连的 GET 流带 B、会话过期 ⇒ 重新 initialize 带 C、删文件 ⇒ 不出网(cloud-credential-hot.engine.cases.ts,5 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "cloud-credential-hot.engine.cases.ts")],
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
}, 300_000)
