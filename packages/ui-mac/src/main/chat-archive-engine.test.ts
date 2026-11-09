// `#1667`(#1662 L5):对话存档上报器在真 OpenCode 2 上由执行事件唤醒(2.x 不发 v1 的 session.idle / session.status)。
// 宿主:真判据在 chat-archive-engine.cases.ts(独立 `bun test` 子进程:沙箱真引擎 + 本机模型桩 + 生产上报器)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("真执行事件唤醒存档上报、turn 体是这一轮的话;反向臂:事件流里没有旧名字、按旧名字订阅什么都等不到(chat-archive-engine.cases.ts,2 条)", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "chat-archive-engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("2")
}, 300_000)
