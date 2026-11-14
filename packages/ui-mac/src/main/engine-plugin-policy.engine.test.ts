// #1713:真引擎沙箱两臂,项目插件按生产信任放行,用户全局插件与用户自己的 deny 照旧生效。
import { expect, test } from "bun:test"
import { join } from "node:path"

// 两条输出流并行读完再等退出(多台真引擎的日志会写满 stderr 管道,依次读会卡住子进程)。
test("项目插件按生产信任放行、用户全局与用户 deny 照常(engine-plugin-policy.engine.cases.ts,6 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "120000", join(import.meta.dir, "engine-plugin-policy.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("6")
}, 300_000)
