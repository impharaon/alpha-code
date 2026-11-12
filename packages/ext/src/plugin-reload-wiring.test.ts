// REQ-234 `#1531` / `#1665`:宿主 —— 在子进程里跑 plugin-reload-wiring.cases.ts(理由见那个文件的抬头:parentPort 必须在插件模块
// 装载之前就在,同进程的别的测试早已把它装成没有 port 的那一份)。
import { expect, test } from "bun:test"
import path from "node:path"
import { isolatedEnv } from "../../../scripts/test-isolation/env"

test("ext 的重载接线(OpenCode 2 真宿主):parentPort → 进程级调度器 → 本 Location → 进程内引擎 → 报告(子进程)", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", path.resolve(import.meta.dir, "plugin-reload-wiring.cases.ts")],
    cwd: path.resolve(import.meta.dir, ".."),
    // 审计 R1:只传隔离环境(PATH + 预载的隔离键),不传 process.env;子进程从 packages/ext 起跑,它的预载见到根标记就沿用这个根。
    env: isolatedEnv(),
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output).toMatch(/\b1 pass\b/)
  expect(output).toMatch(/\b0 fail\b/)
}, 60_000)
