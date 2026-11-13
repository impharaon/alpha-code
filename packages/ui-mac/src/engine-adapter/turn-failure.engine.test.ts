// `#1669`:失败的回合在 OpenCode 2 上说出 0.1.26 的原因。宿主:真判据在 turn-failure.engine.cases.ts(独立 `bun test` 子进程:
// 沙箱里的嵌入式引擎 + 生产注入 + 真 ext + 本机模型桩 → 生产引擎适配器 → 冻结归约器 → 时间线回合错误行)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("模型不可用 / BYOK 401 / 平台 401 / 402 两种 / 429 / 平台凭据读不到 / 拒连,两条入口的回合错误行(turn-failure.engine.cases.ts,8 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "turn-failure.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("8")
}, 300_000)
