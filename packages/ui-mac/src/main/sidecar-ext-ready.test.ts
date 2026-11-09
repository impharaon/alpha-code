// `#1667`(#1662 L5,接口文档 I4 / 裁决书 R22):@codepuppy/ext 在初始目录上没装上,sidecar 就不报 ready。
// 判据直接问真引擎(沙箱里起的 OpenCode 2,`GET /api/plugin`),插件用临时目录里的桩:2.x 只装目录形式的本地插件,
// 入口 `server.js`,`default` 导出 promise 形状的 `{ id, setup }`(`packages/core/src/plugin/module.ts`)。
//   · ext 装上(setup 正常返回)⇒ 放行;
//   · ext 装了但 setup 抛错 ⇒ 拒绝(状态 failed);
//   · 配置里没有 ext ⇒ 拒绝(找不到这一项);main 没解析出 ext 目录 ⇒ 拒绝。
// 反向臂:去掉这道判定(下面最后一条 ANCHOR 钉住 sidecar.ts 在发 ready 之前 await 它)⇒ 后两种情况照样报 ready。
//
// 宿主:真判据在 sidecar-ext-ready.cases.ts(独立的 `bun test` 子进程 —— 引擎沙箱改的环境变量不出那个进程)。
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

test("I4:ext 没装上时 sidecar 不报 ready —— 真引擎 + 桩插件(sidecar-ext-ready.cases.ts,5 条)", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "sidecar-ext-ready.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("5")
}, 300_000)

// 分类与「这处锚守不住什么」登记在 ./source-text-anchors.ts。
test("ANCHOR (not a gate): sidecar.ts 在发 ready 之前 await assertExtPluginActive(初始目录、ext 目录)", () => {
  const source = readFileSync(join(import.meta.dir, "sidecar.ts"), "utf8")
  const gate = source.indexOf("await assertExtPluginActive(fetch, command.initialDirectory, command.extPluginPath)")
  const ready = source.indexOf("parentPort.postMessage(buildReadyMessage(injection, prewarmResult))")
  expect(gate).toBeGreaterThan(-1)
  expect(ready).toBeGreaterThan(gate)
})
