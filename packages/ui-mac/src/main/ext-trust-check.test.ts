// `#1709`:生产 `ext-trust-check` 的判据宿主。子进程跑:用例要先 `mock.module` 掉 electron 再 `await import` 真的 ext-ipc,
// 模块图必须干净地只建一次(与 local-package-channel.test.ts 同因)。真判据在 test-component/ext-trust-check.ipc.cases.ts。
import { resolve } from "node:path"
import { expect, test } from "bun:test"

test("项目扩展信任确认:升级后弹一次、只记进 main 的记录、文案只少那个括号、身份一变再问(ext-trust-check.ipc.cases.ts,12 条)", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", resolve(import.meta.dir, "../../test-component/ext-trust-check.ipc.cases.ts")],
    cwd: resolve(import.meta.dir, "../.."),
    env: process.env,
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  // 用词边界而非 toContain:`"112 pass"` 含 `"12 pass"`
  expect(output).toMatch(/\b12 pass\b/)
  expect(output).toMatch(/\b0 fail\b/)
  expect(output).toMatch(/Ran 12 tests across 1 file/)
}, 180_000)
