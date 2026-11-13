import { expect, test } from "bun:test"
import { join } from "node:path"

// 子进程跑 app-version-ipc.wiring.cases.ts(mock.module("electron") 会污染同进程的其它测试文件)。
test("app-version / build-identity IPC wiring(取值来源 = app.getVersion 实时值与构建事实)", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", join(import.meta.dir, "app-version-ipc.wiring.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  // 真实数字判据:fail 恰为 0 且 pass 恰为 4(app-version 一条 + #237 build-identity 三条:AC-01/03/04)。
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("4")
})
