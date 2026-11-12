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

// I-05 契约 C(design upgrade-fewer-takeovers §4):引擎记下的失败原因可能带 Code Puppy 的登记码前缀
// (`[codepuppy:<code>] `,接管的 to-session-error.ts 经 withFailureCode 写进 message)。这里抛出的原因会原样进自动化运行记录的
// 失败摘要(automation-scheduler.ts),所以先经 parseFailureCode 去掉前缀。真引擎上造这个前缀要走 Transport 失败、按退避重试
// 一分多钟,不进门;idle 的形状取 engine-session-turn.cases.ts 的真引擎那条(type / outcome / error.message),前缀由生产函数生成。
test("引擎记下的失败带登记码前缀 ⇒ 抛出的原因是去掉前缀的原文(自动化失败摘要里不出现 [codepuppy:…]);没有前缀的原样", async () => {
  const { promptAndWait } = await import("./engine-session-turn")
  const { withFailureCode } = await import("@opencode/schema/codepuppy-net-failure")
  const clientWith = (message: string) =>
    ({
      session: { prompt: async () => ({}) },
      experimental: { session: { wait: async () => ({}) } },
      message: { list: async () => ({ data: [{ type: "idle", outcome: "failed", error: { type: "provider.transport", message } }] }) },
    }) as never
  const prefixed = await promptAndWait(clientWith(withFailureCode("tcp", "Unable to connect")), { sessionID: "ses_1", text: "go" }).catch((error: Error) => error)
  expect((prefixed as Error).message).toBe("engine turn failed: Unable to connect")
  const plain = await promptAndWait(clientWith("cp-l5 model stub refused"), { sessionID: "ses_1", text: "go" }).catch((error: Error) => error)
  expect((plain as Error).message).toBe("engine turn failed: cp-l5 model stub refused")
})
