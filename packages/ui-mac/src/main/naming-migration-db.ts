// 升级迁移的会话库一步(alpha-code#1569 AC3;方案 §5、R17、R18、裁决 C2)。
//
// 只改让旧会话还能接着用的指针,不改历史:
//   · `session.model` 的供应商、`session.agent`;
//   · 每个会话**最近一条用户消息**(续写回落 prompt.ts 与压缩 compaction.ts 取的那条)与**最近一条普通用户消息**
//     (不带压缩部件 —— compaction.ts 溢出重放复制 agent/model 的来源)的 `model.providerID` / `agent`;
//   · 全部 part 的显示快照 `display.identity` / `display.authority.kind`,与云端识图标记键 `alpha_vision`(值原样)。
// 其余消息、`tool` 别名、`technicalId`、`bindingId`、正文一律不碰。排序照抄 message-v2.ts `latest()`:
// `time.created` 降序、`id` 降序。
//
// 改写前经 db-safety 的同步驱动备份到迁移目录(不进轮转 5 份的日常备份目录);撤销 = 从这份备份可续做地恢复(R16)。
// 库路径与引擎同源:`resolveDbPath(env)`,在 preferAppEnv 之后算(R17)。electron-free。
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { backupFileName, createVerifiedBackupSync, resolveDbPath, restoreFromBackup, type FsDeps } from "./db-safety"
import { createMigrationFs, type MigrationFs, type WriteAllowList } from "./naming-migration-fs"
import { journalDirectory, type JournalJson, type JournalUndo, type NamingMigrationJournal } from "./naming-migration-journal"
import {
  AGENT_NAMES,
  AUTHORITY_KINDS,
  BUNDLED_PLUGIN_TOOL_NAMES,
  CLOUD_REMOTE_NAMES,
  CLOUD_SERVER_KEY,
  OFFICE_SERVER_KEYS,
  PLUGIN_TOOL_NAMES,
  PROVIDER_ID,
  VISION_MARKER_KEY,
} from "./naming-migration-map"
import { sqliteBinary } from "./platform"

/** 一次 sqlite3 调用:参数数组(无 shell),可选 stdin。 */
export type SqliteRun = (args: string[], stdin?: string) => { code: number; stdout: string; stderr: string }

export type NamingMigrationDbPorts = {
  fs: (allow: WriteAllowList) => MigrationFs
  sqlite: SqliteRun
  now: () => Date
}

/** 默认端口:真 fs 白名单端口、固定路径 sqlite3、真时钟。 */
export function resolveDbPorts(ports: Partial<NamingMigrationDbPorts> = {}): NamingMigrationDbPorts {
  const binary = sqliteBinary()
  return {
    fs: ports.fs ?? createMigrationFs,
    sqlite: ports.sqlite ?? (binary ? sqliteRunner(binary) : () => ({ code: 127, stdout: "", stderr: "sqlite3 unavailable on this platform" })),
    now: ports.now ?? (() => new Date()),
  }
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
const inList = (pairs: ReadonlyArray<readonly [string, string]>) => `(${pairs.map(([from]) => quote(from)).join(", ")})`
const caseOf = (expr: string, pairs: ReadonlyArray<readonly [string, string]>) =>
  `CASE ${expr} ${pairs.map(([from, to]) => `WHEN ${quote(from)} THEN ${quote(to)}`).join(" ")} ELSE ${expr} END`

/** 一个事务内的全部改写;纯 SQL(引擎侧 AC4 测试直接在测试库上执行同一份)。 */
export function buildSessionRewriteSql(): string {
  const [oldProvider, newProvider] = PROVIDER_ID
  const [oldServer, newServer] = CLOUD_SERVER_KEY
  const [oldMarker, newMarker] = VISION_MARKER_KEY
  const id = (field: string) => `json_extract(data, '$.display.identity.${field}')`
  const latest = (plainOnly: boolean) =>
    `SELECT id FROM (SELECT m.id, ROW_NUMBER() OVER (PARTITION BY m.session_id ORDER BY json_extract(m.data, '$.time.created') DESC, m.id DESC) AS rn FROM message m WHERE json_extract(m.data, '$.role') = 'user'${
      plainOnly ? ` AND NOT EXISTS (SELECT 1 FROM part p WHERE p.message_id = m.id AND json_extract(p.data, '$.type') = 'compaction')` : ""
    }) WHERE rn = 1`
  const pointers = `id IN (SELECT id FROM temp.naming_latest_user UNION SELECT id FROM temp.naming_latest_plain_user)`
  const marker = (base: string) =>
    `UPDATE part SET data = json_set(json_remove(data, '${base}.${oldMarker}'), '${base}.${newMarker}', json(data -> '${base}.${oldMarker}')) WHERE json_type(data, '${base}.${oldMarker}') IS NOT NULL;`
  return [
    "BEGIN IMMEDIATE;",
    `UPDATE session SET model = json_set(model, '$.providerID', ${quote(newProvider)}) WHERE json_valid(model) AND json_extract(model, '$.providerID') = ${quote(oldProvider)};`,
    `UPDATE session SET agent = ${caseOf("agent", AGENT_NAMES)} WHERE agent IN ${inList(AGENT_NAMES)};`,
    "DROP TABLE IF EXISTS temp.naming_latest_user;",
    "DROP TABLE IF EXISTS temp.naming_latest_plain_user;",
    `CREATE TEMP TABLE naming_latest_user AS ${latest(false)};`,
    `CREATE TEMP TABLE naming_latest_plain_user AS ${latest(true)};`,
    `UPDATE message SET data = json_set(data, '$.model.providerID', ${quote(newProvider)}) WHERE ${pointers} AND json_extract(data, '$.model.providerID') = ${quote(oldProvider)};`,
    `UPDATE message SET data = json_set(data, '$.agent', ${caseOf("json_extract(data, '$.agent')", AGENT_NAMES)}) WHERE ${pointers} AND json_extract(data, '$.agent') IN ${inList(AGENT_NAMES)};`,
    // 显示快照:先改身份(hub_* 要看旧的 authority.kind 才知道是不是随包工具),最后改 authority.kind
    `UPDATE part SET data = json_set(data, '$.display.identity.origin', ${quote(newServer)}, '$.display.identity.name', ${caseOf(id("name"), CLOUD_REMOTE_NAMES)}) WHERE ${id("source")} = 'mcp' AND ${id("origin")} = ${quote(oldServer)} AND ${id("name")} IN ${inList(CLOUD_REMOTE_NAMES)};`,
    `UPDATE part SET data = json_set(data, '$.display.identity.origin', ${caseOf(id("origin"), OFFICE_SERVER_KEYS)}) WHERE ${id("source")} = 'mcp' AND ${id("origin")} IN ${inList(OFFICE_SERVER_KEYS)};`,
    `UPDATE part SET data = json_set(data, '$.display.identity.name', ${caseOf(id("name"), PLUGIN_TOOL_NAMES)}) WHERE ${id("source")} = 'plugin' AND ${id("name")} IN ${inList(PLUGIN_TOOL_NAMES)};`,
    `UPDATE part SET data = json_set(data, '$.display.identity.name', ${caseOf(id("name"), BUNDLED_PLUGIN_TOOL_NAMES)}) WHERE ${id("source")} = 'plugin' AND ${id("name")} IN ${inList(BUNDLED_PLUGIN_TOOL_NAMES)} AND json_extract(data, '$.display.authority.kind') = ${quote(AUTHORITY_KINDS[1]![0])};`,
    `UPDATE part SET data = json_set(data, '$.display.authority.kind', ${caseOf("json_extract(data, '$.display.authority.kind')", AUTHORITY_KINDS)}) WHERE json_extract(data, '$.display.authority.kind') IN ${inList(AUTHORITY_KINDS)};`,
    marker("$.metadata"),
    marker("$.state.metadata"),
    "COMMIT;",
  ].join("\n")
}

/** 提交后回查:受影响范围内旧值的总数;非 0 ⇒ 这一步失败、整套撤销。须与改写同一连接(用到两张临时表)。 */
export function buildSessionRewriteCheckSql(): string {
  const [oldProvider] = PROVIDER_ID
  const [oldServer] = CLOUD_SERVER_KEY
  const [oldMarker] = VISION_MARKER_KEY
  const pointers = `id IN (SELECT id FROM temp.naming_latest_user UNION SELECT id FROM temp.naming_latest_plain_user)`
  const id = (field: string) => `json_extract(data, '$.display.identity.${field}')`
  return `SELECT
  (SELECT count(*) FROM session WHERE json_valid(model) AND json_extract(model, '$.providerID') = ${quote(oldProvider)})
+ (SELECT count(*) FROM session WHERE agent IN ${inList(AGENT_NAMES)})
+ (SELECT count(*) FROM message WHERE ${pointers} AND (json_extract(data, '$.model.providerID') = ${quote(oldProvider)} OR json_extract(data, '$.agent') IN ${inList(AGENT_NAMES)}))
+ (SELECT count(*) FROM part WHERE json_extract(data, '$.display.authority.kind') IN ${inList(AUTHORITY_KINDS)})
+ (SELECT count(*) FROM part WHERE ${id("source")} = 'mcp' AND (${id("origin")} IN ${inList(OFFICE_SERVER_KEYS)} OR (${id("origin")} = ${quote(oldServer)} AND ${id("name")} IN ${inList(CLOUD_REMOTE_NAMES)})))
+ (SELECT count(*) FROM part WHERE ${id("source")} = 'plugin' AND ${id("name")} IN ${inList(PLUGIN_TOOL_NAMES)})
+ (SELECT count(*) FROM part WHERE json_type(data, '$.metadata.${oldMarker}') IS NOT NULL OR json_type(data, '$.state.metadata.${oldMarker}') IS NOT NULL);`
}

/** 会话库一步:在 preferAppEnv 之后、第一个异步边界之前调用;库路径 = resolveDbPath(env)。失败时本函数已调过 undoAll()。 */
export function runNamingMigrationDbStep(
  journal: NamingMigrationJournal,
  input: { packaged: boolean; env: Readonly<Record<string, string | undefined>>; home: string },
  portsInput?: Partial<NamingMigrationDbPorts>,
): { ok: true } | { ok: false; message: string } {
  const ports = resolveDbPorts(portsInput)
  const dbPath = resolveDbPath({ packaged: input.packaged, env: { ...input.env }, home: input.home }).path
  if (!dbPath) return { ok: true }
  const migrationDir = journalDirectory(journal)
  const fs = ports.fs(dbAllowList(dbPath, migrationDir))
  if (!fs.exists(dbPath)) return { ok: true }
  const backupDir = join(migrationDir, "db")
  const now = ports.now()
  const backupPath = join(backupDir, backupFileName(now))
  try {
    journal.step("db", { dbPath, backupPath, migrationDir }, () => {
      const backup = createVerifiedBackupSync({
        dbPath,
        backupDir,
        exec: (args) => ports.sqlite(args),
        fs: fsDeps(fs),
        now,
        keep: Number.POSITIVE_INFINITY,
      })
      if (!backup.ok) throw new Error(`session database backup failed: ${backup.error}`)
      const result = ports.sqlite(["-batch", "-bail", dbPath], `.timeout 5000\n${buildSessionRewriteSql()}\n${buildSessionRewriteCheckSql()}\n`)
      if (result.code !== 0) throw new Error(`session database rewrite failed: ${(result.stderr || result.stdout).trim()}`)
      const left = result.stdout.trim().split("\n").at(-1)
      if (left !== "0") throw new Error(`session database still holds ${left} old-name pointer(s) after the rewrite`)
    })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      journal.undoAll()
    } catch (undoError) {
      return { ok: false, message: `${message}; rollback also failed: ${undoError instanceof Error ? undoError.message : String(undoError)}` }
    }
    return { ok: false, message }
  }
}

/** `db` 步的撤销:备份在 ⇒ 可续做地恢复;备份不在(备份前就失败了)⇒ 库没被动过,无事。 */
export function dbUndo(ports: NamingMigrationDbPorts): JournalUndo {
  return (payload: JournalJson) => {
    const p = payload as { dbPath: string; backupPath: string; migrationDir: string }
    const fs = ports.fs(dbAllowList(p.dbPath, p.migrationDir))
    if (!fs.exists(p.backupPath)) return
    const restored = restoreFromBackup({ dbPath: p.dbPath, backupPath: p.backupPath, fs: fsDeps(fs), now: ports.now() })
    if (!restored.ok) throw new Error(`session database restore failed: ${restored.error}`)
  }
}

/** 真 sqlite3:固定绝对路径(db-safety 同款),SQL 走 stdin,一次调用一个连接。 */
export function sqliteRunner(binary: string): SqliteRun {
  return (args, stdin) => {
    const proc = spawnSync(binary, args, { input: stdin ?? "", encoding: "utf8" })
    return { code: proc.status ?? -1, stdout: proc.stdout ?? "", stderr: proc.stderr ?? String(proc.error ?? "") }
  }
}

function dbAllowList(dbPath: string, migrationDir: string): WriteAllowList {
  return {
    trees: [migrationDir],
    files: [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}.restore-tmp`],
    prefixes: [`${dbPath}.corrupt-`],
  }
}

function fsDeps(fs: MigrationFs): FsDeps {
  return {
    exists: fs.exists,
    mkdir: fs.mkdir,
    readdir: fs.readdir,
    rename: fs.rename,
    copy: fs.copy,
    remove: fs.remove,
    readText: fs.readText,
  }
}
