// I-08:本包的每个 `bun test` 进程在共享预载(bunfig.toml → scripts/test-isolation/preload.ts)之下跑:隔离键与上游
// global-roots 推导的引擎 data / cache / config / state 根全在新建的临时根里。
// 已知的坏:不装预载、用预载之前的 HOME / XDG_* ⇒ 同一推导落在真 HOME 下(子进程里只算路径,不读那些目录)。
import { test } from "bun:test"
import { expectChildIsolatedAndRealEnvOutside, expectIsolatedProcess } from "../../../scripts/test-isolation/guard.js"

test("预载在位:隔离键与上游 global-roots 的引擎路径全在新建的临时根里", () => {
  expectIsolatedProcess()
})

test("已知的坏:不装预载、用预载之前的 HOME / XDG_* ⇒ 引擎根落在真 HOME 下(只比较路径);isolatedEnv() 子进程则在根里", () => {
  expectChildIsolatedAndRealEnvOutside()
})
