// `#1665` 审计 R1(硬约束):ext 的测试不许读写真机的 HOME / XDG 目录 / 引擎库。bunfig.toml 在任何测试文件求值之前装本文件。
//
// 实测(bun 1.3.14,本机):运行时改 `process.env.HOME` **不**改变 `os.homedir()` 的返回值(启动时的 HOME 才算数);
// `os.tmpdir()` 则跟随运行时的 TMPDIR。所以这里除了改环境变量,还把 `node:os` 默认导出上的 `homedir` 钉到临时 HOME ——
// 上游 `global-roots.ts` / `global.ts` 用的是默认导出(`import os from "os"`)。具名导入(`import { homedir }`)钉不住,
// 那几处在 ext 里只做路径比较、不写盘。
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import os from "node:os"
import { join } from "node:path"
import { ISOLATED_KEYS, REAL_HOME_KEY, REAL_XDG_KEY, TEST_ROOT_KEY } from "./isolated-env"

const root = realpathSync(mkdtempSync(join(os.tmpdir(), "codepuppy-ext-test-")))
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

process.env[REAL_HOME_KEY] = os.homedir()
process.env[REAL_XDG_KEY] = JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("XDG_"))))
for (const key of Object.keys(process.env)) if (key.startsWith("XDG_")) delete process.env[key]
Object.assign(process.env, dirs, { OPENCODE_DB: join(root, "opencode.db"), OPENCODE_TEST_HOME: home, [TEST_ROOT_KEY]: root })
os.homedir = () => home

const missing = ISOLATED_KEYS.filter((key) => !process.env[key]?.startsWith(root))
if (missing.length) throw new Error(`ext test preload left keys outside ${root}: ${missing.join(", ")}`)
