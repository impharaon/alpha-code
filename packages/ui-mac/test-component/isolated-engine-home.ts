// `#1667`(审计 R1 第 1 条的跟进):凡是会走到生产 `spawnLocalServer` 的测试文件,在 import 块之后、`await import(".../server")`
// 之前调用一次 `isolateEngineHome()`。
//
// spawnLocalServer 在 fork 之前对引擎这次要打开的库与数据目录做旧凭证检查(engine-legacy-credentials.ts),每种运行形态都做。
// 数据目录 = `XDG_DATA_HOME || ~/.local/share` + `opencode`,库 = `OPENCODE_DB`(非打包态缺省是数据目录下的 `opencode-<渠道>.db`)。
// 不隔离的话,测试会去看本机真实的 `~/.local/share/opencode`(独立 OpenCode 的 auth.json、旧库)—— 结果随机器而变,而且碰了不该碰的目录。
//
// 为什么是函数而不是「import 一下就生效」:`bun test src` 把很多文件跑在同一个进程里,模块只求值一次 —— 只有第一个 import 它的文件
// 会被隔离,而那个文件的 afterAll 一还原,后面的文件就落回真实环境(实测)。所以每个文件各调一次:当场把 HOME / XDG_* /
// OPENCODE_DB 指向一个新的临时根(只建空目录,不放任何文件),本文件结束时(afterAll)还原并删掉临时根,不漏给后面的文件。
// 检查读环境是在调用时(createSidecarEnv() 与 engineDataDirectory),所以只要在 spawnLocalServer 跑之前调用就够。
// 注意:bun 的 `os.homedir()` 在进程启动时就定了,改 HOME 改不动它;数据目录的推导先看 `XDG_DATA_HOME`,所以这里设了它,
// 旧凭证检查就不会落回真实 HOME。判据在 src/main/isolated-engine-home.test.ts。
import { afterAll } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const KEYS = ["HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "OPENCODE_DB"] as const

export function isolateEngineHome() {
  const ambient = Object.fromEntries(KEYS.map((key) => [key, process.env[key]])) as Record<(typeof KEYS)[number], string | undefined>
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cp-isolated-engine-home-")))
  const isolated = {
    HOME: join(root, "home"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: join(root, "state"),
    OPENCODE_DB: join(root, "data", "opencode", "opencode-test.db"),
  }
  for (const dir of [isolated.HOME, isolated.XDG_DATA_HOME, isolated.XDG_CONFIG_HOME, isolated.XDG_CACHE_HOME, isolated.XDG_STATE_HOME])
    mkdirSync(dir, { recursive: true })
  Object.assign(process.env, isolated)
  afterAll(() => {
    for (const key of KEYS) {
      const value = ambient[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(root, { recursive: true, force: true })
  })
  return { root, ...isolated }
}
