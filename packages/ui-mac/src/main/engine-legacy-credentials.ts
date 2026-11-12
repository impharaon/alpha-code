// `#1667`(#1662 L5,基线 §3 S2 / S7,清点表 D5):凭证只来自 Code Puppy 的钥匙串。
//
// OpenCode 2 的迁移 `20260805200742_import_legacy_credentials` 在它**第一次**跑的那次启动里,把数据目录下的 `auth.json`
// 整份导进库里的 `credential` 表(`packages/core/src/database/migration/20260805200742_import_legacy_credentials.ts`;
// 路径取的是引擎的全局数据目录,与 `database.path` 无关)。导入迁移不看配置,配置拦不住它。Code Puppy 的数据目录与独立安装的
// OpenCode 是同一个(本票不搬目录,裁决书 R5),那份 `auth.json` 属于用户自己的 OpenCode —— 一旦导入,它的凭证就进了
// Code Puppy 引擎可用的凭证表。
//
// 什么时候会导入(读码 + 沙箱真引擎实测,engine-legacy-credentials.cases.ts):只有**已有的库**升级时 —— 2.x 对已有会话表的库
// 逐条补跑缺的迁移(`packages/core/src/database/migration.ts` 的 `applyOnly`);全新的库走 schema bootstrap,只登记迁移、
// 不跑数据迁移,不导入。
// 处置:库在、读得出、里面没有这条迁移,而 `auth.json` 在场 ⇒ 拒绝 fork,原因写清楚(fail-closed,与围栏计划失败同一条路);
// 库读不出同样拒绝(判断不了就不放)。库不存在 ⇒ bootstrap 不导入,放行;迁移已经跑过 ⇒ 不会再导入,放行。
// 不动用户的文件:它是独立 OpenCode 的,搬走会弄坏用户自己的安装。
// S7:同一目录里看得到别的 OpenCode 留下的数据时,在启动日志里点名(只列文件名,不读内容)。
import { existsSync, readdirSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { readDbMigrationIds, resolveDbPath, SQLITE3, type WatermarkRead } from "./db-safety"
import { sqliteRunner } from "./naming-migration-db"

export const LEGACY_CREDENTIAL_IMPORT_MIGRATION = "20260805200742_import_legacy_credentials"
export const LEGACY_CREDENTIAL_FILE = "auth.json"

/** 引擎的全局数据目录:db-safety 推导打包态库路径用的同一个目录(`XDG_DATA_HOME || ~/.local/share` + `opencode`)。 */
export function engineDataDirectory(env: Record<string, string | undefined>, home: string): string {
  return dirname(resolveDbPath({ packaged: true, env: { ...env, OPENCODE_DB: undefined }, home }).path!)
}

const readIdsWithSqlite = (dbPath: string): Promise<WatermarkRead> => {
  if (!SQLITE3) return Promise.resolve({ ok: false, kind: "error", detail: "sqlite3 unavailable on this platform" })
  const run = sqliteRunner(SQLITE3)
  return readDbMigrationIds(dbPath, async (args) => run(args), existsSync)
}

/** 会导入 ⇒ 返回拒绝启动的原因;不会导入 ⇒ undefined。 */
export async function legacyCredentialImportRefusal(input: {
  dataDir: string
  databasePath: string
  exists?: (path: string) => boolean
  readIds?: (dbPath: string) => Promise<WatermarkRead>
}): Promise<string | undefined> {
  const exists = input.exists ?? existsSync
  const file = join(input.dataDir, LEGACY_CREDENTIAL_FILE)
  if (!exists(file)) return undefined
  if (input.databasePath === ":memory:") return undefined
  const read = await (input.readIds ?? readIdsWithSqlite)(input.databasePath)
  if (!read.ok && read.kind === "missing") return undefined
  if (read.ok && read.ids.includes(LEGACY_CREDENTIAL_IMPORT_MIGRATION)) return undefined
  return (
    `refusing to start the engine: ${file} exists and OpenCode 2 would import it into its credential table on this start ` +
    `(migration ${LEGACY_CREDENTIAL_IMPORT_MIGRATION}). Code Puppy only uses credentials from its own keychain; that file ` +
    `belongs to a standalone OpenCode install sharing this data directory. Move it out of ${input.dataDir} and start again.`
  )
}

/** S7:数据目录里不是这台 Code Puppy 引擎的那些 OpenCode 文件(只看文件名)。 */
export function foreignOpenCodeData(dataDir: string, databasePath: string, list: (dir: string) => string[] = safeList): string[] {
  const ours = new Set([basename(databasePath), `${basename(databasePath)}-wal`, `${basename(databasePath)}-shm`])
  return list(dataDir)
    .filter((name) => !ours.has(name))
    .filter((name) => name === LEGACY_CREDENTIAL_FILE || /^opencode(-[^/]+)?\.db$/.test(name))
    .sort()
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
