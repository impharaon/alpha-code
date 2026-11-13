// `#1669`:首探 `/global/health` 失败一次,冻结界面的协议判定仍是 v1、事件照常到达(否则这个服务器上下文里再也收不到事件)。
// 宿主:真判据在 protocol-probe.engine.cases.ts(独立 `bun test` 子进程:沙箱真引擎 + 生产注入 + 真 ext + 生产的引擎适配器,
// 冻结 app 的 detectServerProtocol 与 server-sdk 按协议选的事件订阅)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("#1669 首探传输报错 / 超过 5 秒期限 ⇒ 冻结界面判 v1、v1 事件流收到 server.connected(protocol-probe.engine.cases.ts,2 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "protocol-probe.engine.cases.ts")],
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
