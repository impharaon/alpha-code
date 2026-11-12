// `#1667`(#1662 L5,清点表 S6 / S9):自动化入口在 OpenCode 2 上「发一条、等跑完、拿回复」。
// 宿主:真判据在 engine-session-turn.cases.ts(独立 `bun test` 子进程:沙箱真引擎 + 本机 OpenAI 兼容模型桩 + 生产 engineClient)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("prompt → wait → 读回复:成功拿到模型的话、失败抛出引擎的原因、不等就读不到(engine-session-turn.cases.ts,3 条)", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "engine-session-turn.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("3")
}, 300_000)
