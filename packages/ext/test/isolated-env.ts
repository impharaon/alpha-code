// `#1665` 审计 R1:ext 测试的隔离环境 —— 预载(./preload.ts)写进 process.env 的那几个键,与子进程用例该拿到的环境。
// 子进程**不**传 process.env(开发机 shell 里的 CODEPUPPY_* / 令牌之类会一并漏进去),只传 PATH + 这里列的隔离键。

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
  "OPENCODE_TEST_HOME",
  "TMPDIR",
] as const

/** 预载记下的临时根;另记预载之前的 HOME 与 XDG_*,只给「不装预载」那条已知的坏臂用。 */
export const TEST_ROOT_KEY = "CODEPUPPY_EXT_TEST_ROOT"
export const REAL_HOME_KEY = "CODEPUPPY_EXT_TEST_REAL_HOME"
export const REAL_XDG_KEY = "CODEPUPPY_EXT_TEST_REAL_XDG"

/** 子进程用例的环境:PATH + 隔离键(取自本进程预载之后的值);预载没装就抛,不悄悄退回真环境。 */
export function isolatedEnv(extra: Record<string, string> = {}): Record<string, string> {
  const root = process.env[TEST_ROOT_KEY]
  if (!root) throw new Error("ext test preload not loaded: run bun test from packages/ext (bunfig.toml preloads ./test/preload.ts)")
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", [TEST_ROOT_KEY]: root }
  for (const key of ISOLATED_KEYS) env[key] = process.env[key]!
  return { ...env, ...extra }
}
