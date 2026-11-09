// `#1665` 审计 R1(硬约束):ext 的测试在预载(packages/ext/bunfig.toml → test/preload.ts)之下,HOME / 全部 XDG_* /
// OPENCODE_DB 都在一个新建的临时根里,上游 Global 的路径(模块求值时就算死)全部解析在里面。
// 已知的坏:同一个上游模块,不装预载(原来的 HOME / XDG_*)⇒ 解析在真 HOME 下 —— 证明这条测试测得出「没隔离」。
import { expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { Path } from "../../util/src/global.ts"
import { roots } from "../../util/src/global-roots.ts"
import { ISOLATED_KEYS, REAL_HOME_KEY, REAL_XDG_KEY, TEST_ROOT_KEY, isolatedEnv } from "../test/isolated-env"

const root = process.env[TEST_ROOT_KEY] ?? ""
const inside = (p: string) => root !== "" && p.startsWith(root + path.sep)
const GLOBAL_ROOTS = path.resolve(import.meta.dir, "../../util/src/global-roots.ts")

/** 只算路径、不建目录:在一个不装预载的子进程里求值上游 global-roots,给定环境下它把 opencode 的全局根放在哪。 */
function rootsInChild(env: Record<string, string>): Record<string, string> {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "-e", `import { roots } from ${JSON.stringify(GLOBAL_ROOTS)}; console.log(JSON.stringify(roots("opencode")))`],
    cwd: root,
    env,
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return JSON.parse(result.stdout.toString())
}

test("预载在位:隔离键全在新建的临时根下;os.homedir() 跟着走;上游 Global.Path 与 roots() 的每条路径都解析在临时根里", () => {
  expect(root).not.toBe("")
  expect(path.basename(root).startsWith("codepuppy-ext-test-")).toBe(true)
  for (const key of ISOLATED_KEYS) expect([key, inside(process.env[key] ?? "")]).toEqual([key, true])
  expect(os.homedir()).toBe(process.env.HOME!)
  const paths = { ...Path, home: Path.home }
  expect(Object.keys(paths).sort()).toEqual(["bin", "cache", "config", "data", "home", "log", "repos", "state", "tmp"])
  for (const [key, value] of Object.entries(paths)) expect([key, value, inside(value)]).toEqual([key, value, true])
  for (const [key, value] of Object.entries(roots("opencode"))) expect([key, value, inside(value)]).toEqual([key, value, true])
})

test("子进程:isolatedEnv() 带过去的环境本身就够隔离(子进程不装预载也解析在临时根里);已知的坏 —— 不装预载、原来的 HOME / XDG_* ⇒ 解析在真 HOME 下", () => {
  const isolated = rootsInChild(isolatedEnv())
  for (const key of ["data", "cache", "config", "state"]) expect([key, inside(isolated[key]!)]).toEqual([key, true])

  const realHome = process.env[REAL_HOME_KEY]!
  const realXdg = JSON.parse(process.env[REAL_XDG_KEY]!) as Record<string, string>
  expect(inside(realHome)).toBe(false)
  const bare = rootsInChild({ PATH: process.env.PATH ?? "", HOME: realHome, ...realXdg })
  const expected = {
    data: path.join(realXdg.XDG_DATA_HOME || path.join(realHome, ".local", "share"), "opencode"),
    cache: path.join(realXdg.XDG_CACHE_HOME || path.join(realHome, ".cache"), "opencode"),
    config: path.join(realXdg.XDG_CONFIG_HOME || path.join(realHome, ".config"), "opencode"),
    state: path.join(realXdg.XDG_STATE_HOME || path.join(realHome, ".local", "state"), "opencode"),
  }
  for (const [key, value] of Object.entries(expected)) {
    expect([key, bare[key]]).toEqual([key, value])
    expect([key, inside(bare[key]!)]).toEqual([key, false])
  }
})
