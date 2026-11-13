// `#1669`:全新数据上界面的项目清单为空,Code Puppy 自己的目录(引擎工作目录、无对话的默认对话目录)不进项目清单与事件流。
// 宿主:真判据在 internal-projects.engine.cases.ts(独立 `bun test` 子进程:沙箱真引擎 + 生产起法 + 生产适配器)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("#1669 全新数据清单为空、反向臂复现两行、打开真实目录恰好一个、默认对话目录有对话才出现(internal-projects.engine.cases.ts,4 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "internal-projects.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("4")
}, 300_000)
