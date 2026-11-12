// `#1665` I3:宿主 —— 在子进程里跑 plugin-setup-order.cases.ts(它 mock 掉 L4 的策略模块;理由见那个文件的抬头)。
// 反向臂:把 plugin.ts 里的 `seal()` 挪到项目插件扇出之前,或把 `registerPolicy` 挪到任何注册之后 ⇒ 子进程里那条用例红。
import { expect, test } from "bun:test"
import path from "node:path"
import { isolatedEnv } from "../test/isolated-env"

test("registerPolicy 是 setup 里第一个被 await 的,seal 是最后一个;ext 自己的钩子与项目插件扇出都在两者之间(子进程)", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", path.resolve(import.meta.dir, "plugin-setup-order.cases.ts")],
    cwd: path.resolve(import.meta.dir, ".."),
    // 只传隔离环境(PATH + 预载的隔离键),不传 process.env;子进程从 packages/ext 起跑,自己的预载再建一个新根。
    env: isolatedEnv(),
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output).toMatch(/\b1 pass\b/)
  expect(output).toMatch(/\b0 fail\b/)
}, 60_000)
