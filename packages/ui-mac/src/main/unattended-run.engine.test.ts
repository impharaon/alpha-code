// #1699:真实入口和真引擎在隔离子进程中运行,防 Electron mock 与全局引擎根目录污染其它测试。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("无人值守运行的真实入口证据(unattended-run.engine.cases.ts)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "unattended-run.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (code !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(Number(output.match(/(\d+) pass\b/)?.[1]), output).toBeGreaterThanOrEqual(3)
}, 300_000)
