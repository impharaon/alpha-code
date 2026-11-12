// `#1662` parity(REQ-236 §2.2 R1–R12、`#1573`):composer 三档在嵌进 sidecar 的 OpenCode 2 上逐格得出方案写的结局。
// 宿主:真判据在 composer-tier-matrix.engine.cases.ts(独立 `bun test` 子进程:沙箱真引擎 + 生产注入 + 真 ext + 本机模型桩)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("三档 × R1–R12 与三条委派入口(composer-tier-matrix.engine.cases.ts,15 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "composer-tier-matrix.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("15")
}, 300_000)
