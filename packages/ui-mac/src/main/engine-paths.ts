// `#1667`(#1662 L5,基线 §2.7、清点表 D1 / E3,裁决书 F7 ARCH-NOTE ③):引擎读哪个会话库、哪个全局配置目录,由 Code Puppy
// 算、经 `start()` 的 `database.path` / `config.directory` 显式交给引擎 —— H1 下上游 CLI 宿主的推导
// (`packages/cli/src/database-path.ts`、`server-process.ts` 的 `OPENCODE_CONFIG_DIR`)不在路径上。
//
// 库在哪只算一次:数据目录与 `OPENCODE_DB` 覆盖规则就是 db-safety 的 `resolveDbPath`(DB 安全带预检读的同一个库),
// 这里不另写一份。差别只有一处是 Code Puppy 自己的决定:**非打包态**(dev / preview)不用正式库 `opencode.db`,
// 用 `opencode-<构建渠道>.db`(db-safety 的「dev 跑分支后缀库、守卫不适用」),免得开发构建碰到日用正式版的会话库。
import { join } from "node:path"
import { resolveDbPath } from "./db-safety"

/** `OPENCODE_DB=:memory:` 时 db-safety 不守(path=null),引擎也就用内存库。 */
const IN_MEMORY = ":memory:"

export function engineDatabasePath(input: {
  packaged: boolean
  env: Record<string, string | undefined>
  home: string
  /** Code Puppy 的构建渠道(dev / beta / prod),只决定非打包态的库文件名。 */
  channel: string
}): string {
  const env = input.packaged
    ? input.env
    : { ...input.env, OPENCODE_DB: input.env.OPENCODE_DB || `opencode-${input.channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db` }
  return resolveDbPath({ packaged: true, env, home: input.home }).path ?? IN_MEMORY
}

/**
 * 引擎读的全局配置目录:用户显式导出的 `OPENCODE_CONFIG_DIR` 优先,否则 `XDG_CONFIG_HOME || ~/.config` 再拼 `opencode`
 * (与上游 CLI 宿主同一规则 —— `packages/cli/src/server-process.ts` 把 `OPENCODE_CONFIG_DIR` 映射成 `config.directory`;
 * main 侧 ext-config.ts / codepuppy-migrate.ts 写用户配置时也按这条规则找目录)。本票不搬目录(裁决书 R5)。
 * v1 时代 sidecar 会把 `OPENCODE_CONFIG_DIR` 改指 Code Puppy 自有的 v2 桥目录,那座桥已随 `#1667` 删除(清点表 C4),
 * 这个变量从此只可能是用户自己导出的。mcp-default-deny.ts 枚举的就是这一个目录。
 */
export function engineGlobalConfigDirectory(env: Record<string, string | undefined>, home: string): string {
  return env.OPENCODE_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode")
}
