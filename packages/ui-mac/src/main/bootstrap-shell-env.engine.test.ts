// `#1698` R33:独立子进程运行真实引擎用例,全局环境与 HOME/XDG 沙箱不影响其它测试。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("shell 子进程从文档收到全局根、三份技能路径照常展开、sidecar 进程无该变量(bootstrap-shell-env.engine.cases.ts,1 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "120000", join(import.meta.dir, "bootstrap-shell-env.engine.cases.ts")],
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
