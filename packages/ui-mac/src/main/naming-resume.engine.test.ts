// `#1569` AC4 在 OpenCode 2 上(`#1662` parity 第 7 项):升级迁移之后,旧会话的三条续写路径都能完成。
// 宿主:真判据在 naming-resume.engine.cases.ts(独立 `bun test` 子进程:沙箱真引擎 + 生产注入 + 真 ext + 模型桩 + v1 夹具库)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("#1569 AC4:迁移后继续生成、压缩后续写、溢出后续写都能完成;反向顺序具名失败(naming-resume.engine.cases.ts,2 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "150000", join(import.meta.dir, "naming-resume.engine.cases.ts")],
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
