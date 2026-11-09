// `#1665` I2:宿主 —— 在子进程里跑 plugin-process-singleton.cases.ts(理由见那个文件的抬头)。
// 反向臂:把 plugin.ts 的进程级对象改回模块顶层无条件创建 ⇒ 两个监听、同一条请求报两次 ⇒ 子进程里那条用例红。
import { expect, test } from "bun:test"
import path from "node:path"

test("ext 的进程级单例:两次求值只挂一个 parentPort 监听、一条重载请求只入队一次(子进程)", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", path.resolve(import.meta.dir, "plugin-process-singleton.cases.ts")],
    cwd: path.resolve(import.meta.dir, ".."),
    env: process.env,
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output).toMatch(/\b1 pass\b/)
  expect(output).toMatch(/\b0 fail\b/)
}, 60_000)
