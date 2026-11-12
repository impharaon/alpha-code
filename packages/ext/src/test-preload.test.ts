// I-08(`#1665` 审计 R1 的硬约束):ext 的测试在共享预载(packages/ext/bunfig.toml → scripts/test-isolation/preload.ts)之下,
// HOME / 全部 XDG_* / OPENCODE_DB / TMPDIR 都在一个新建的临时根里,上游 Global 的路径(模块求值时就算死)全部解析在里面。
// 已知的坏:同一个上游模块,不装预载(原来的 HOME / XDG_*)⇒ 解析在真 HOME 下 —— 证明这条测试测得出「没隔离」。
import { expect, test } from "bun:test"
import { Path } from "../../util/src/global.ts"
import { expectChildIsolatedAndRealEnvOutside, expectIsolatedProcess } from "../../../scripts/test-isolation/guard"

test("预载在位:隔离键全在新建的临时根下;os.homedir() 跟着走;上游 Global.Path 与 roots() 的每条路径都解析在临时根里", () => {
  const paths: Record<string, string> = { ...Path, home: Path.home }
  expect(Object.keys(paths).sort()).toEqual(["bin", "cache", "config", "data", "home", "log", "repos", "state", "tmp"])
  expectIsolatedProcess(Object.fromEntries(Object.entries(paths).map(([key, value]) => [`Global.Path.${key}`, value])))
})

test("子进程:isolatedEnv() 带过去的环境本身就够隔离(子进程不装预载也解析在临时根里);已知的坏 —— 不装预载、原来的 HOME / XDG_* ⇒ 解析在真 HOME 下", () => {
  expectChildIsolatedAndRealEnvOutside()
})
