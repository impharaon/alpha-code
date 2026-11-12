// I-08(由 `#1665` 审计 R1 的 ext 版升格):测试不许读写开发机真实的 HOME / XDG 目录 / 引擎库。
// packages/{ext,ui-mac,schema,ai,plugin}/bunfig.toml 的 `[test] preload` 在任何测试文件求值之前装本文件 —— 必须是预载:
// `bun test` 把一个包的很多文件跑在同一个进程里,而上游 `util/src/global-roots.ts` 在**模块求值时**就把全局路径算死,
// 测试文件里再改环境变量已经晚了;逐文件函数在混跑时会被别的文件抢先或还原(ui-mac `#1667` 实测)。
//
// 实测(bun 1.4.4,本机):运行时改 `process.env.HOME` **不**改变 `os.homedir()`(启动时的 HOME 才算数),
// 所以这里另把 `node:os` 默认导出上的 `homedir` 钉到临时 HOME —— 上游 `global-roots.ts` / `global.ts` 用的是默认导出。
// 钉不住的:`import { homedir }` 与 `import * as os` 仍返回启动时的 HOME;引擎路径的推导先看 XDG_* / OPENCODE_DB,
// 不受影响(守卫断言的正是这些推导)。子进程启动时拿到的是隔离后的 HOME,完全跟着走。`os.tmpdir()` 跟运行时 TMPDIR。
//
// 子进程:环境里已有临时根标记 ⇒ 本进程是被一个已隔离的进程起的,环境原样沿用(起它的测试显式写的值照样生效),不新建根。
import { afterAll } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import os from "node:os"
import { join } from "node:path"
import { ISOLATED_KEYS, REAL_HOME_KEY, REAL_XDG_KEY, REMOVED_KEYS, TEST_ROOT_KEY, isInside } from "./env"

if (!process.env[TEST_ROOT_KEY]) {
  // 根放在原 TMPDIR 下、名字短:macOS 的套接字路径上限 104 字节,测试还会在 TMPDIR 里再建自己的目录。
  const root = realpathSync(mkdtempSync(join(os.tmpdir(), "cp-test-")))
  const home = join(root, "home")
  const dirs = {
    HOME: home,
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_RUNTIME_DIR: join(root, "run"),
    XDG_DATA_DIRS: join(root, "xdg-data-dirs"),
    XDG_CONFIG_DIRS: join(root, "xdg-config-dirs"),
    TMPDIR: join(root, "tmp"),
  }
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true })

  process.env[REAL_HOME_KEY] ??= os.homedir()
  process.env[REAL_XDG_KEY] ??= JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("XDG_"))))
  for (const key of Object.keys(process.env)) if (key.startsWith("XDG_")) delete process.env[key]
  for (const key of REMOVED_KEYS) delete process.env[key]
  Object.assign(process.env, dirs, { OPENCODE_DB: join(root, "opencode.db"), [TEST_ROOT_KEY]: root })
  os.homedir = () => home

  const outside = ISOLATED_KEYS.filter((key) => !isInside(root, process.env[key] ?? ""))
  if (outside.length) throw new Error(`test isolation preload left keys outside ${root}: ${outside.join(", ")}`)

  // 预载里注册的 afterAll 在整次运行结束时跑一次(实测);只有建根的进程删它,沿用它的子进程不删。
  afterAll(() => rmSync(root, { recursive: true, force: true }))
}
