// I-08:ui-mac 的每个 `bun test` 进程在共享预载(bunfig.toml → scripts/test-isolation/preload.ts)之下跑。取代 `#1667` 的逐文件
// isolateEngineHome():那个函数要每个文件记得调用,而且同进程混跑时会被别的文件的还原抢走。
//
// ① 本进程:隔离键与引擎路径都在新建的临时根里。引擎路径按生产推导取:spawnLocalServer 用 createSidecarEnv() 的结果与
//    `import { homedir }`(bun 进程内仍是启动时的真 HOME,预载钉不住)算库、数据目录与全局配置目录 —— 推导先看 XDG_* /
//    OPENCODE_DB,所以照样落在根里;上游 Global.Path(含 log / state)同样在根里。
// ② host 起的子 `bun test`(cwd 是本包、`env: process.env`,57 个 host 都是这个形状)继承根标记 ⇒ 沿用同一个根;
//    对照:同样的环境去掉根标记 ⇒ 子进程新建另一个根 —— 证明这条断言测得出「没沿用」。
// ③ 已知的坏:不装预载、用预载之前的 HOME / XDG_* ⇒ 引擎根落在真 HOME 下。只比较路径,不读那些目录。
import { expect, test } from "bun:test"
import { homedir } from "node:os"
import path from "node:path"
import { Path } from "../../../util/src/global.ts"
import { TEST_ROOT_KEY, testRoot } from "../../../../scripts/test-isolation/env"
import { expectChildIsolatedAndRealEnvOutside, expectIsolatedProcess } from "../../../../scripts/test-isolation/guard"
import { engineDataDirectory } from "./engine-legacy-credentials"
import { engineDatabasePath, engineGlobalConfigDirectory } from "./engine-paths"
import { createSidecarEnv } from "./sidecar-env"

const UI_MAC = path.resolve(import.meta.dir, "../..")
const CHILD = path.join(UI_MAC, "test-component", "test-isolation-child.cases.ts")

function childIsolation(env: Record<string, string | undefined>) {
  const result = Bun.spawnSync({ cmd: [process.execPath, "test", CHILD], cwd: UI_MAC, env })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  const line = output.split("\n").find((l) => l.startsWith("ISOLATION "))
  if (result.exitCode !== 0 || !line) throw new Error(output)
  return JSON.parse(line.slice("ISOLATION ".length)) as Record<"root" | "home" | "data" | "db" | "homedir", string>
}

test("本进程:隔离键、上游 Global.Path、spawnLocalServer 推导的库 / 数据目录 / 全局配置目录全在新建的临时根里", () => {
  const sidecarEnv = createSidecarEnv()
  expectIsolatedProcess({
    ...Object.fromEntries(Object.entries({ ...Path, home: Path.home }).map(([key, value]) => [`Global.Path.${key}`, value])),
    engineDataDirectory: engineDataDirectory(sidecarEnv, homedir()),
    engineDatabasePath: engineDatabasePath({ packaged: false, env: sidecarEnv, home: homedir(), channel: "dev" }),
    engineGlobalConfigDirectory: engineGlobalConfigDirectory(sidecarEnv, homedir()),
  })
})

test("host 起的子 bun test 继承隔离环境并沿用同一个根;对照:去掉根标记的同一环境 ⇒ 子进程新建另一个根", () => {
  const root = testRoot()
  const inherited = childIsolation(process.env)
  expect(inherited).toEqual({ root, home: process.env.HOME!, data: process.env.XDG_DATA_HOME!, db: process.env.OPENCODE_DB!, homedir: process.env.HOME! })

  const { [TEST_ROOT_KEY]: _marker, ...unmarked } = process.env
  const fresh = childIsolation(unmarked)
  expect(fresh.root).not.toBe(root)
  expect(fresh.home).toBe(path.join(fresh.root, "home"))
}, 60_000)

test("已知的坏:不装预载、用预载之前的 HOME / XDG_* ⇒ 引擎根落在真 HOME 下(只比较路径);isolatedEnv() 子进程则在根里", () => {
  expectChildIsolatedAndRealEnvOutside()
})
