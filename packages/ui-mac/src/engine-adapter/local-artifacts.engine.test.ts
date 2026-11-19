// DESIGN-local-session-artifacts:产物页「本次对话」的本机产物。宿主:真判据在 local-artifacts.engine.cases.ts
// (独立 `bun test` 子进程:沙箱里的嵌入式引擎 + 生产注入 + 真 ext + 真 stdio MCP 写入桩 → 生产引擎适配器 → 面板推导)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("本机写成的文档重开会话后列出:Office(execute 内)、write、patch 新建、子会话;代码 / JSON / 目录外不列(local-artifacts.engine.cases.ts,1 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "180000", join(import.meta.dir, "local-artifacts.engine.cases.ts")],
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
