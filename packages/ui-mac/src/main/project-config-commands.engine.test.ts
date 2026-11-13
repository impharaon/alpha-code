// INT-safety I-12:未授权项目的配置键让项目选的命令执行的时点(今天的行为,修复时翻转;实测记录 docs/architecture/2026-11-13-project-config-command-surface.md)。
// 宿主:真判据在 project-config-commands.engine.cases.ts(独立 `bun test` 子进程:沙箱里的嵌入式引擎 + 生产注入 + 真 ext + 本机模型桩,不出网)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("I-12 未授权项目:opencode.json 的 mcp / formatter / shell / commands / 模型级 package 与插件指令的执行时点(project-config-commands.engine.cases.ts,14 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "120000", join(import.meta.dir, "project-config-commands.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("14")
}, 600_000)
