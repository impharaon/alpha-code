import { expect, test } from "bun:test"
import { join } from "node:path"

// DESIGN-domestic-cloud-connectivity §4.6:子进程跑 updater-wiring.cases.ts(mock.module("electron") 会污染同进程的其它测试文件;
// cloud-job-notify.test.ts 同款宿主)。OPENCODE_CHANNEL=prod 让 constants.ts 的 UPDATER_ENABLED 与打包 prod 构建相同。
test("§4.6 生产 setupAutoUpdater 的检查经香港转发入口、失败改走 github.com(接线)", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", join(import.meta.dir, "updater-wiring.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: { ...process.env, OPENCODE_CHANNEL: "prod" },
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  // 真实数字判据:fail 恰为 0 且 pass 恰为 3(cases 里的用例数;少了 = 有用例被删)。
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("3")
})
