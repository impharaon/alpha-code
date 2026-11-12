// I-08(由 `#1665` 审计 R1 的 ext 版升格):测试隔离的键表与给测试用的函数。预载本体在 ./preload.ts,
// 由 packages/{ext,ui-mac,schema,ai,plugin}/bunfig.toml 在任何测试文件求值之前装上。
// 本文件没有副作用:守卫与子进程用例 import 它,不会再触发一次隔离。
import path from "node:path"

/** 预载改写的键。XDG 列全:四个 *_HOME、运行时目录、两条搜索路径。 */
export const ISOLATED_KEYS = [
  "HOME",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "XDG_DATA_DIRS",
  "XDG_CONFIG_DIRS",
  "OPENCODE_DB",
  "TMPDIR",
] as const

/** 预载删掉的键:引擎配置路径的输入,留着就可能把配置指回开发机的真目录。 */
export const REMOVED_KEYS = ["OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG"] as const

/**
 * 临时根。它也是「这个进程已经隔离过」的标记:子进程继承到它,预载就原样沿用父进程给的环境,不再新建根
 * (起子进程的测试显式写的 HOME / XDG 值照样生效)。
 */
export const TEST_ROOT_KEY = "CODEPUPPY_TEST_ROOT"
/** 预载第一次求值时记下的 HOME 与 XDG_*,只给守卫「不隔离会落在哪」那条已知的坏臂用;子进程继承,不覆盖。 */
export const REAL_HOME_KEY = "CODEPUPPY_TEST_REAL_HOME"
export const REAL_XDG_KEY = "CODEPUPPY_TEST_REAL_XDG"

export function testRoot(): string {
  const root = process.env[TEST_ROOT_KEY]
  if (!root) throw new Error("test isolation preload not loaded: the package's bunfig.toml must preload scripts/test-isolation/preload.ts")
  return root
}

export const isInside = (root: string, p: string) => p === root || p.startsWith(root + path.sep)

/** 子进程用例的环境:PATH + 根标记 + 隔离键(取本进程预载之后的值);不带开发机 shell 里的其它变量。 */
export function isolatedEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", [TEST_ROOT_KEY]: testRoot() }
  for (const key of ISOLATED_KEYS) env[key] = process.env[key]!
  return { ...env, ...extra }
}

/** 预载之前的 HOME 与 XDG_*(只用于比较路径)。 */
export function realEnv(): { HOME: string; xdg: Record<string, string> } {
  const home = process.env[REAL_HOME_KEY]
  const xdg = process.env[REAL_XDG_KEY]
  if (!home || xdg === undefined) throw new Error("test isolation preload did not record the real HOME / XDG_*")
  return { HOME: home, xdg: JSON.parse(xdg) }
}

const GLOBAL_ROOTS = path.resolve(import.meta.dir, "../../packages/util/src/global-roots.ts")

/**
 * 只算路径、不建目录:在一个不装预载的子进程(`bun -e`,cwd 是临时根)里求值上游 global-roots,
 * 给定环境下它把 opencode 的全局根放在哪。已知的坏臂拿它在「真 HOME / XDG_*」下求值,只比较字符串。
 */
export function rootsInChild(env: Record<string, string>): Record<"data" | "cache" | "config" | "state" | "tmp", string> {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "-e", `import { roots } from ${JSON.stringify(GLOBAL_ROOTS)}; console.log(JSON.stringify(roots("opencode")))`],
    cwd: testRoot(),
    env,
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return JSON.parse(result.stdout.toString())
}

/** 真 HOME / XDG_* 下 global-roots 应得的四个根(XDG 规则:有 XDG_*_HOME 用它,否则 HOME 下的默认位置)。 */
export function expectedRealRoots(real: { HOME: string; xdg: Record<string, string> }) {
  return {
    data: path.join(real.xdg.XDG_DATA_HOME || path.join(real.HOME, ".local", "share"), "opencode"),
    cache: path.join(real.xdg.XDG_CACHE_HOME || path.join(real.HOME, ".cache"), "opencode"),
    config: path.join(real.xdg.XDG_CONFIG_HOME || path.join(real.HOME, ".config"), "opencode"),
    state: path.join(real.xdg.XDG_STATE_HOME || path.join(real.HOME, ".local", "state"), "opencode"),
  }
}
