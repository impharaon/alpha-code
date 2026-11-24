// `#1709` 的真引擎判据宿主:真判据在 project-consent-store.engine.cases.ts(独立 `bun test` 子进程:沙箱里的嵌入式引擎 + 生产注入 + 真 ext)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("项目自带「已同意」⇒ 项目插件不执行、项目 MCP 不启动;用户的记录同意 ⇒ 两样都生效;改成拒绝 ⇒ 都不再出现(project-consent-store.engine.cases.ts,2 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "240000", join(import.meta.dir, "project-consent-store.engine.cases.ts")],
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
}, 400_000)
