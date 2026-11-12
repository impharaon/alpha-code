// `#1214` AC2 / ADR-038 在 OpenCode 2 上(`#1662` parity):审批等到期限无人应答 ⇒ 时间线工具卡认出「审批超时」。
// 宿主:真判据在 permission-ask-timeout.engine.cases.ts(独立 `bun test` 子进程:沙箱里的嵌入式引擎 + 生产注入 + 真 ext + 桌面的消息适配器与卡片模型)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("审批超时:到期的工具部件经桌面适配器被卡片分类为审批超时,模型读到同一句(permission-ask-timeout.engine.cases.ts,1 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "permission-ask-timeout.engine.cases.ts")],
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
