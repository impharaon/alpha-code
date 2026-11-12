// `#1667`(#1662 L5;编排器裁决 alpha-code#1666 评论 6737930969 第 1 条 `l1r-naming-resume`,#1569):0.1.24 的旧名在
// OpenCode 2 把 v1 会话转成 2.x 之前改掉。
//
// 宿主:真判据在 naming-before-v1-conversion.cases.ts(独立 `bun test` 子进程:沙箱 + 真引擎 + 夹具库 + 真改名一步),
// 两条 —— 生产顺序 ⇒ 2.x 里是新名;反向臂(转换先跑)⇒ 2.x 里留着旧名。
// 最后一条锚:生产里「先改名、后起引擎」由 index.ts 的源码顺序决定(改名一步在第一个异步边界之前,spawnLocalServer 在后面)。
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

test("#1569 会话库改名先于 v1 → 2.x 转换:生产顺序 ⇒ 新名;转换先跑 ⇒ 旧名留在 2.x(naming-before-v1-conversion.cases.ts,2 条)", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--timeout", "120000", join(import.meta.dir, "naming-before-v1-conversion.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("2")
}, 300_000)

// 分类与「这处锚守不住什么」登记在 ./source-text-anchors.ts。
test("ANCHOR (not a gate): index.ts 先调 runNamingMigrationDbStep,两处 spawnLocalServer(boot / respawn)都在它后面", () => {
  const index = readFileSync(join(import.meta.dir, "index.ts"), "utf8")
  const rename = index.indexOf("runNamingMigrationDbStep(naming.journal")
  expect(rename).toBeGreaterThan(-1)
  const spawns = [...index.matchAll(/spawnLocalServer\(hostname/g)].map((match) => match.index!)
  expect(spawns.length).toBe(2)
  for (const spawn of spawns) expect(spawn).toBeGreaterThan(rename)
})
