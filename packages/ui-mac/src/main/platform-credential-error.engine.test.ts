// REQ-236 AC3(`#1562`)在 OpenCode 2 上(`#1662` parity 第 6 项):平台凭据出错 ⇒ 失败一次、带名字,不进退避重试。
// 宿主:真判据在 platform-credential-error.engine.cases.ts(独立 `bun test` 子进程:沙箱里的嵌入式引擎 + 生产注入 + 真 ext + 本机假网关)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("平台凭据出错:读不到 ⇒ 零请求具名失败;401 / 403 ⇒ 一次 provider.auth;503 对照 ⇒ 看得见重试(platform-credential-error.engine.cases.ts,5 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "platform-credential-error.engine.cases.ts")],
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
