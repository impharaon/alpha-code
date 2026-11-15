// `#1697` 放回单元 2:真引擎的 shell / patch 审批经过约定后仍画命令 / 改文件卡。
// 子进程隔离引擎与 DOM 运行时;用例直接检查生产 PermissionDialog 的可见文字。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("命令卡标题与记忆范围、patch 改文件卡(command-approval.engine.cases.ts,2 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "command-approval.engine.cases.ts")],
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
