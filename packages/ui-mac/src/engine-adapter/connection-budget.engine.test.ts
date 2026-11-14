// `#1669` G2:挂着界面的订阅时审批回复当即落到引擎(renderer 对引擎源的连接受 Chromium 每源 6 条的上限)。
// 宿主:真判据在 connection-budget.engine.cases.ts(独立 `bun test` 子进程:沙箱里真监听端口的嵌入式引擎 + 生产注入 + 真 ext +
// 生产的引擎适配器,出网 fetch 按 Chromium 每源 6 连接的池建模)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("审批回复与等待中的动作在 6 连接上限下当即到达引擎;量具自检占满即饿死(connection-budget.engine.cases.ts,5 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "connection-budget.engine.cases.ts")],
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
