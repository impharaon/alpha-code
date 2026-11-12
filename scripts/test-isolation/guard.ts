// I-08:各包守卫测试共用的断言。每个包一条守卫文件调用这两个函数(各包再加自己的引擎路径推导),
// 因此删掉某个包 bunfig 里的预载那一项,那个包的守卫就红(根标记不在、HOME 不在根内)。
import { expect } from "bun:test"
import os from "node:os"
import { roots } from "../../packages/util/src/global-roots.ts"
import { REMOVED_KEYS, expectedRealRoots, isInside, isolatedEnv, realEnv, rootsInChild, testRoot } from "./env"

/** 本进程:隔离键全在新建的临时根里,`os.homedir()` 跟着走,上游 global-roots 与调用方给的每条引擎路径也都在根里。 */
export function expectIsolatedProcess(enginePaths: Record<string, string> = {}) {
  const root = testRoot()
  for (const key of ["HOME", "TMPDIR"]) expect([key, isInside(root, process.env[key] ?? "")]).toEqual([key, true])
  // 库:在根里,或是内存库(core 的上游预载排在共享预载之后,把它改成 `:memory:`)。
  const db = process.env.OPENCODE_DB ?? ""
  expect(["OPENCODE_DB", db === ":memory:" || isInside(root, db)]).toEqual(["OPENCODE_DB", true])
  // 环境里的每个 XDG_* 都在根里(共享预载设全部七个;上游 core 入口只设四个 *_HOME)。
  for (const key of Object.keys(process.env).filter((key) => key.startsWith("XDG_")))
    expect([key, isInside(root, process.env[key]!)]).toEqual([key, true])
  // 配置路径的输入:不存在,或指在根里。
  for (const key of REMOVED_KEYS) expect([key, process.env[key] === undefined || isInside(root, process.env[key]!)]).toEqual([key, true])
  expect(os.homedir()).toBe(process.env.HOME!)
  const all = { ...prefixed("roots.", roots("opencode")), ...enginePaths }
  for (const [name, value] of Object.entries(all)) expect([name, value, isInside(root, value)]).toEqual([name, value, true])
}

/**
 * 子进程:只带 isolatedEnv() 的子进程(不装预载)也解析在根里。
 * 已知的坏:同一个子进程换成预载之前的 HOME / XDG_* ⇒ 解析在真 HOME 下、不在根里。只比较路径,不建、不读那些目录。
 */
export function expectChildIsolatedAndRealEnvOutside() {
  const root = testRoot()
  const isolated = rootsInChild(isolatedEnv())
  for (const key of ["data", "cache", "config", "state"] as const) expect([key, isInside(root, isolated[key])]).toEqual([key, true])

  const real = realEnv()
  expect(isInside(root, real.HOME)).toBe(false)
  const bare = rootsInChild({ PATH: process.env.PATH ?? "", HOME: real.HOME, ...real.xdg })
  for (const [key, value] of Object.entries(expectedRealRoots(real))) {
    expect([key, bare[key as keyof typeof bare]]).toEqual([key, value])
    expect([key, isInside(root, bare[key as keyof typeof bare])]).toEqual([key, false])
  }
}

const prefixed = (prefix: string, record: Record<string, string>) =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [prefix + key, value]))
