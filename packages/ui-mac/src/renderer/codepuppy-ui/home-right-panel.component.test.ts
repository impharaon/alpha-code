import { expect, test } from "bun:test"
import path from "node:path"

// 子进程跑:用例文件用 mock.module 顶替 `@opencode-ai/app` 与终端窄导出,同进程会污染其它测试文件
// (与 new-session-workspace.component.test.ts 同因)。
test(
  "desktop-ui-refresh BR-05 首页右栏(文件/终端)按项目挂载的真组件用例",
  () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, "test", path.resolve(import.meta.dir, "../../../test-component/home-right-panel.cases.ts")],
      cwd: path.resolve(import.meta.dir, "../../.."),
      env: process.env,
    })
    const output = `${result.stdout.toString()}${result.stderr.toString()}`
    if (result.exitCode !== 0) throw new Error(output)
    // 判据只有「子进程绿」,并要求至少跑过一条(同 new-session-workspace.component.test.ts)。
    const fail = output.match(/(\d+) fail\b/)?.[1]
    const pass = Number(output.match(/(\d+) pass\b/)?.[1] ?? 0)
    expect({ fail, ran: pass > 0 }).toEqual({ fail: "0", ran: true })
  },
  60_000,
)
