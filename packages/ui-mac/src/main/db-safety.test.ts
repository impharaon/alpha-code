// db-safety 单测(S17 T3):纯逻辑(mock exec/fs)+ 真 /usr/bin/sqlite3 集成(skipIf 缺失)。
// 集成层直接验证设计文档 F6/F7 的实证契约(损坏签名 exit 26、VACUUM INTO + 必验、恢复往返)。
import { afterAll, describe, expect, test } from "bun:test"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  BACKUP_PREFIX,
  backupFileName,
  createVerifiedBackup,
  createVerifiedBackupSync,
  decidePlan,
  diffWatermarks,
  exportVerifiedCopy,
  listBackups,
  loadExpectedIds,
  newestBackup,
  readDbMigrationIds,
  resolveDbPath,
  restoreFromBackup,
  rotationVictims,
  timestamp,
  type Exec,
  type ExecSync,
  type ExpectedMigrations,
  type FsDeps,
} from "./db-safety"
import { expectedMigrations, RETIRED_MIGRATION_IDS } from "../../scripts/gen-db-expected"

// ── helpers ──────────────────────────────────────────────────────────────────
function memFs(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial))
  const dirs = new Set<string>()
  const fs: FsDeps = {
    exists: (p) => files.has(p) || dirs.has(p),
    mkdir: (p) => void dirs.add(p),
    readdir: (p) =>
      [...files.keys()]
        .filter((f) => f.startsWith(`${p}/`))
        .map((f) => f.slice(p.length + 1))
        .filter((n) => !n.includes("/")),
    rename: (from, to) => {
      const v = files.get(from)
      if (v === undefined) throw new Error(`ENOENT ${from}`)
      files.delete(from)
      files.set(to, v)
    },
    copy: (from, to) => {
      const v = files.get(from)
      if (v === undefined) throw new Error(`ENOENT ${from}`)
      files.set(to, v)
    },
    remove: (p) => void files.delete(p),
    readText: (p) => {
      const v = files.get(p)
      if (v === undefined) throw new Error(`ENOENT ${p}`)
      return v
    },
  }
  return { fs, files, dirs }
}

const HOME = "/Users/probe"
const DEFAULT_DB = "/Users/probe/.local/share/opencode/opencode.db"

// ── resolveDbPath(路径镜像,契约锚 database.ts:path())────────────────────────
describe("resolveDbPath", () => {
  test("dev(非打包)→ null(守卫不适用)", () => {
    const r = resolveDbPath({ packaged: false, env: {}, home: HOME })
    expect(r.path).toBeNull()
  })
  test(":memory: 测试态 → null", () => {
    const r = resolveDbPath({ packaged: true, env: { OPENCODE_DB: ":memory:" }, home: HOME })
    expect(r.path).toBeNull()
  })
  test("OPENCODE_DB 绝对路径覆盖", () => {
    const r = resolveDbPath({ packaged: true, env: { OPENCODE_DB: "/tmp/x.db" }, home: HOME })
    expect(r.path).toBe("/tmp/x.db")
  })
  test("OPENCODE_DB 相对路径 → join(dataDir)", () => {
    const r = resolveDbPath({ packaged: true, env: { OPENCODE_DB: "alt.db" }, home: HOME })
    expect(r.path).toBe("/Users/probe/.local/share/opencode/alt.db")
  })
  test("XDG_DATA_HOME 覆盖 data 根", () => {
    const r = resolveDbPath({ packaged: true, env: { XDG_DATA_HOME: "/xdg" }, home: HOME })
    expect(r.path).toBe("/xdg/opencode/opencode.db")
  })
  test("packaged 默认 = ~/.local/share/opencode/opencode.db(F4)", () => {
    const r = resolveDbPath({ packaged: true, env: {}, home: HOME })
    expect(r.path).toBe(DEFAULT_DB)
  })
})

// ── diffWatermarks / decidePlan ───────────────────────────────────────────────
describe("diffWatermarks + decidePlan", () => {
  const A = "20260101000000_a"
  const B = "20260202000000_b"
  const C = "20260303000000_c"

  test("pending only(app 超前 DB)", () => {
    const d = diffWatermarks([A, B, C], [A, B], [])
    expect(d.pending).toEqual([C])
    expect(d.unknown).toEqual([])
  })
  test("unknown only(DB 超前 app)", () => {
    const d = diffWatermarks([A, B], [A, B, C], [])
    expect(d.unknown).toEqual([C])
    expect(d.pending).toEqual([])
  })
  test("相等 → proceed", () => {
    expect(decidePlan({ ok: true, ids: [A, B], legacy: false }, { ids: [A, B], retired: [] })).toEqual({ kind: "proceed" })
  })
  test("db-ahead:latest = 最末未知 id", () => {
    const plan = decidePlan({ ok: true, ids: [A, B, C], legacy: false }, { ids: [A], retired: [] })
    expect(plan.kind).toBe("db-ahead")
    if (plan.kind === "db-ahead") {
      expect(plan.unknown).toEqual([B, C])
      expect(plan.latest).toBe(C)
    }
  })
  test("migrate-ahead:pending 列表齐全", () => {
    const plan = decidePlan({ ok: true, ids: [A], legacy: false }, { ids: [A, B, C], retired: [] })
    expect(plan).toEqual({ kind: "migrate-ahead", pending: [B, C] })
  })
  test("legacy(无 migration 表旧库)→ 全量 pending = migrate-ahead", () => {
    const plan = decidePlan({ ok: true, ids: [], legacy: true }, { ids: [A, B], retired: [] })
    expect(plan).toEqual({ kind: "migrate-ahead", pending: [A, B] })
  })
  test("missing → skip(fresh install)", () => {
    const plan = decidePlan({ ok: false, kind: "missing", detail: "" }, { ids: [A], retired: [] })
    expect(plan.kind).toBe("skip")
  })
  test("corrupt → corrupt", () => {
    const plan = decidePlan({ ok: false, kind: "corrupt", detail: "file is not a database" }, { ids: [A], retired: [] })
    expect(plan.kind).toBe("corrupt")
  })
  test("读取 error → skip(fail-open,守卫不伤启动)", () => {
    const plan = decidePlan({ ok: false, kind: "error", detail: "locked" }, { ids: [A], retired: [] })
    expect(plan.kind).toBe("skip")
  })
  test("支持面清单缺失 → skip(fail-open)", () => {
    expect(decidePlan({ ok: true, ids: [A], legacy: false }, null).kind).toBe("skip")
    expect(decidePlan({ ok: true, ids: [A], legacy: false }, { ids: [], retired: [] }).kind).toBe("skip")
  })
  test("退役 id(#1664,裁决书 N2):库里有 ⇒ 不算 unknown;库里没有 ⇒ 不算 pending", () => {
    const R = "20260720085655_retired"
    expect(diffWatermarks([A, B], [A, B, R], [R])).toEqual({ pending: [], unknown: [] })
    expect(diffWatermarks([A, B], [A, B], [R])).toEqual({ pending: [], unknown: [] })
    expect(diffWatermarks([A, B], [A, B, R], [])).toEqual({ pending: [], unknown: [R] })
  })
})

// ── 命名与轮转 ────────────────────────────────────────────────────────────────
describe("backup naming + rotation", () => {
  test("timestamp/backupFileName 形态(字典序即时序)", () => {
    const d = new Date(2026, 6, 5, 9, 8, 7) // 2026-07-05 09:08:07 local
    expect(timestamp(d)).toBe("20260705-090807")
    expect(backupFileName(d)).toBe(`${BACKUP_PREFIX}20260705-090807.db`)
  })
  test("listBackups 过滤 .tmp/杂物并排序", () => {
    const files = [
      `${BACKUP_PREFIX}20260702-000000.db`,
      "junk.txt",
      `${BACKUP_PREFIX}20260701-000000.db`,
      `${BACKUP_PREFIX}20260703-000000.db.tmp`,
    ]
    expect(listBackups(files)).toEqual([`${BACKUP_PREFIX}20260701-000000.db`, `${BACKUP_PREFIX}20260702-000000.db`])
  })
  test("rotationVictims:≤keep 无牺牲;超出删最旧", () => {
    const five = ["1", "2", "3", "4", "5"].map((n) => `${BACKUP_PREFIX}2026070${n}-000000.db`)
    expect(rotationVictims(five, 5)).toEqual([])
    const seven = ["1", "2", "3", "4", "5", "6", "7"].map((n) => `${BACKUP_PREFIX}2026070${n}-000000.db`)
    expect(rotationVictims(seven, 5)).toEqual([
      `${BACKUP_PREFIX}20260701-000000.db`,
      `${BACKUP_PREFIX}20260702-000000.db`,
    ])
  })
  test("newestBackup:空 → null;有 → 最新", () => {
    expect(newestBackup([])).toBeNull()
    expect(
      newestBackup([`${BACKUP_PREFIX}20260701-000000.db`, `${BACKUP_PREFIX}20260702-000000.db`, "junk"]),
    ).toBe(`${BACKUP_PREFIX}20260702-000000.db`)
  })
})

// ── loadExpectedIds ───────────────────────────────────────────────────────────
describe("loadExpectedIds", () => {
  const P = "/res/db-expected-migrations.json"
  test("缺文件 → null(fail-open 上游)", () => {
    const { fs } = memFs()
    expect(loadExpectedIds({ resourcesPath: "/res", exists: fs.exists, readText: fs.readText })).toBeNull()
  })
  test("坏 JSON / 错 schema / 空 ids → null", () => {
    for (const content of ["not json", JSON.stringify({ v: 2, ids: ["a"] }), JSON.stringify({ v: 1, ids: "x" }), JSON.stringify({ v: 1, ids: [] })]) {
      const { fs } = memFs({ [P]: content })
      expect(loadExpectedIds({ resourcesPath: "/res", exists: fs.exists, readText: fs.readText })).toBeNull()
    }
  })
  test("正常 → ids(滤掉非字符串)", () => {
    const { fs } = memFs({ [P]: JSON.stringify({ v: 1, ids: ["a", 42, "b"] }) })
    expect(loadExpectedIds({ resourcesPath: "/res", exists: fs.exists, readText: fs.readText })).toEqual({ ids: ["a", "b"], retired: [] })
  })
  test("retired 字段原样读出(滤掉非字符串);旧产物没有这个字段 ⇒ [](上一条)", () => {
    const { fs } = memFs({ [P]: JSON.stringify({ v: 1, ids: ["a"], retired: ["r", 7] }) })
    expect(loadExpectedIds({ resourcesPath: "/res", exists: fs.exists, readText: fs.readText })).toEqual({ ids: ["a"], retired: ["r"] })
  })
})

// ── restoreFromBackup(memFs)──────────────────────────────────────────────────
describe("restoreFromBackup", () => {
  const now = new Date(2026, 6, 5, 1, 2, 3)
  test("损坏件改名保留 + WAL 残件连带挪走 + 备份复制回位", () => {
    const { fs, files } = memFs({
      "/data/opencode.db": "CORRUPT",
      "/data/opencode.db-wal": "OLDWAL",
      "/data/opencode.db-shm": "OLDSHM",
      "/bk/opencode-backup-20260704-000000.db": "GOOD",
    })
    const r = restoreFromBackup({ dbPath: "/data/opencode.db", backupPath: "/bk/opencode-backup-20260704-000000.db", fs, now })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.damagedPath).toBe("/data/opencode.db.corrupt-20260705-010203")
    expect(files.get("/data/opencode.db")).toBe("GOOD")
    expect(files.get("/data/opencode.db.corrupt-20260705-010203")).toBe("CORRUPT")
    expect(files.get("/data/opencode.db.corrupt-20260705-010203-wal")).toBe("OLDWAL")
    expect(files.has("/data/opencode.db-wal")).toBe(false)
    expect(files.has("/data/opencode.db-shm")).toBe(false)
  })
  test("备份也不存在 → ok:false(不半途留摊子)", () => {
    const { fs } = memFs({}) // 主库与备份都不在 → 拷备份时抛
    const r = restoreFromBackup({ dbPath: "/data/opencode.db", backupPath: "/bk/x.db", fs, now })
    expect(r.ok).toBe(false)
  })
})

// ── #1569 R16:恢复可续做 —— 上一次恢复在「主库已挪走、备份仍在」处被打断(连同残留 -wal)──────
describe("restoreFromBackup 续做(#1569 R16)", () => {
  const now = new Date(2026, 10, 2, 3, 4, 5)
  test("主库已不在、残留 -wal 仍在 ⇒ 残件挪开、备份就位", () => {
    const { fs, files } = memFs({
      "/data/opencode.db.corrupt-20261102-010000": "MOVED-BY-FIRST-ATTEMPT",
      "/data/opencode.db-wal": "LEFTOVER",
      "/bk/opencode-backup-20261102-000000.db": "GOOD",
    })
    const r = restoreFromBackup({ dbPath: "/data/opencode.db", backupPath: "/bk/opencode-backup-20261102-000000.db", fs, now })
    expect(r.ok).toBe(true)
    expect(files.get("/data/opencode.db")).toBe("GOOD")
    expect(files.has("/data/opencode.db-wal")).toBe(false)
    expect(files.get("/data/opencode.db.corrupt-20261102-030405-wal")).toBe("LEFTOVER")
    expect(files.has("/data/opencode.db.restore-tmp")).toBe(false)
  })
  test("拷到一半的 .restore-tmp 被覆盖,主库位置只出现完整件", () => {
    const { fs, files } = memFs({
      "/data/opencode.db.restore-tmp": "HALF",
      "/bk/b.db": "GOOD",
    })
    const r = restoreFromBackup({ dbPath: "/data/opencode.db", backupPath: "/bk/b.db", fs, now })
    expect(r.ok).toBe(true)
    expect(files.get("/data/opencode.db")).toBe("GOOD")
    expect(files.has("/data/opencode.db.restore-tmp")).toBe(false)
  })
})

// ── createVerifiedBackup:验证失败必须删产物(反 placebo,F7)────────────────────
describe("createVerifiedBackup(mock exec)", () => {
  const now = new Date(2026, 6, 5, 1, 2, 3)
  test("integrity 非 ok → 删 tmp + 报错", async () => {
    const { fs, files } = memFs({ "/data/opencode.db": "DB" })
    const calls: string[][] = []
    const exec: Exec = async (args) => {
      calls.push(args)
      // SQL 恒在最后一个参数(`#1664` 起 VACUUM INTO 走普通连接,参数里不再有 `-readonly`,位置不能写死)。
      if (args.at(-1)?.startsWith("VACUUM INTO")) {
        files.set("/bk/opencode-backup-20260705-010203.db.tmp", "SNAP")
        return { code: 0, stdout: "", stderr: "" }
      }
      return { code: 0, stdout: "*** in database main ***\nPage 5 is never used\n", stderr: "" }
    }
    const r = await createVerifiedBackup({ dbPath: "/data/opencode.db", backupDir: "/bk", exec, fs, now })
    // 校验那一次必须真的跑到 —— 否则这条用例红在 VACUUM 那一步,测的就不是「验不过即删」。
    expect(calls.length, `只跑了 ${calls.length} 次 sqlite3,校验没跑到:${JSON.stringify(calls)}`).toBe(2)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("快照验证失败")
    expect(files.has("/bk/opencode-backup-20260705-010203.db.tmp")).toBe(false)
    expect(files.has("/bk/opencode-backup-20260705-010203.db")).toBe(false)
  })
  test("VACUUM 声称成功但没写文件(F7 静默假成功形态)→ 报错", async () => {
    const { fs } = memFs({ "/data/opencode.db": "DB" })
    const exec: Exec = async () => ({ code: 0, stdout: "", stderr: "" })
    const r = await createVerifiedBackup({ dbPath: "/data/opencode.db", backupDir: "/bk", exec, fs, now })
    expect(r.ok).toBe(false)
  })
})

// ── 真 sqlite3 集成(macOS 本地 + GH ubuntu 均有;缺失则 skip)────────────────────
const sqlite3 = Bun.which("sqlite3")
const itSql = test.skipIf(!sqlite3)

const execReal: Exec = async (args) => {
  const proc = Bun.spawn([sqlite3!, ...args], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}
const realFs: FsDeps = {
  exists: existsSync,
  mkdir: (p) => mkdirSync(p, { recursive: true }),
  readdir: (p) => readdirSync(p),
  rename: renameSync,
  copy: copyFileSync,
  remove: (p) => rmSync(p, { force: true }),
  readText: (p) => readFileSync(p, "utf8"),
}

const tmpRoot = mkdtempSync(join(tmpdir(), "db-safety-test-"))
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }))

const M1 = "20260101000000_alpha"
const M2 = "20260202000000_beta"

async function makeFixtureDb(path: string, ids: string[]) {
  const values = ids.map((id) => `('${id}', 1)`).join(",")
  const sql = `CREATE TABLE migration(id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL);${
    ids.length > 0 ? ` INSERT INTO migration VALUES ${values};` : ""
  } CREATE TABLE session(id TEXT);`
  const res = await execReal([path, sql])
  if (res.code !== 0) throw new Error(`fixture failed: ${res.stderr}`)
}

describe("integration(real sqlite3)", () => {
  itSql("读水位:fixture ids 原样返回", async () => {
    const db = join(tmpRoot, "read.db")
    await makeFixtureDb(db, [M1, M2])
    const r = await readDbMigrationIds(db, execReal, existsSync)
    expect(r).toEqual({ ok: true, ids: [M1, M2], legacy: false })
  })

  itSql("无 migration 表(纯旧库)→ legacy + ids []", async () => {
    const db = join(tmpRoot, "legacy.db")
    await execReal([db, "CREATE TABLE session(id TEXT);"])
    const r = await readDbMigrationIds(db, execReal, existsSync)
    expect(r).toEqual({ ok: true, ids: [], legacy: true })
  })

  itSql("垃圾文件 → corrupt(F6 签名)", async () => {
    const db = join(tmpRoot, "garbage.db")
    writeFileSync(db, "this is not a sqlite database at all — padding to pass header sniff length")
    const r = await readDbMigrationIds(db, execReal, existsSync)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe("corrupt")
  })

  itSql("文件不存在 → missing", async () => {
    const r = await readDbMigrationIds(join(tmpRoot, "nope.db"), execReal, existsSync)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe("missing")
  })

  itSql("备份:VACUUM INTO + 验证 + 轮转(F7)", async () => {
    const db = join(tmpRoot, "bk-src.db")
    await makeFixtureDb(db, [M1, M2])
    const dir = join(tmpRoot, "backups")
    mkdirSync(dir, { recursive: true })
    // 预置 5 份旧备份(内容无关,轮转按名字)→ 新增 1 份后应删最旧 1 份
    for (let i = 1; i <= 5; i++) writeFileSync(join(dir, `${BACKUP_PREFIX}2026070${i}-000000.db`), "old")
    const r = await createVerifiedBackup({ dbPath: db, backupDir: dir, exec: execReal, fs: realFs, now: new Date(2026, 6, 9) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(existsSync(r.path)).toBe(true)
    expect(r.rotated).toEqual([`${BACKUP_PREFIX}20260701-000000.db`])
    expect(existsSync(join(dir, `${BACKUP_PREFIX}20260701-000000.db`))).toBe(false)
    // 备份可读且水位一致
    const back = await readDbMigrationIds(r.path, execReal, existsSync)
    expect(back).toEqual({ ok: true, ids: [M1, M2], legacy: false })
  })

  itSql("同步驱动(#1569):同一套步骤,备份可读、水位一致、keep 无穷时不轮转", () => {
    const execSync: ExecSync = (args) => {
      const proc = Bun.spawnSync([sqlite3!, ...args], { stdout: "pipe", stderr: "pipe" })
      return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() }
    }
    const db = join(tmpRoot, "bk-sync-src.db")
    const dir = join(tmpRoot, "sync-backups")
    mkdirSync(dir, { recursive: true })
    Bun.spawnSync([sqlite3!, db, `CREATE TABLE migration(id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL); INSERT INTO migration VALUES ('${M1}', 1);`])
    for (let i = 1; i <= 5; i++) writeFileSync(join(dir, `${BACKUP_PREFIX}2026070${i}-000000.db`), "old")
    const r = createVerifiedBackupSync({ dbPath: db, backupDir: dir, exec: execSync, fs: realFs, now: new Date(2026, 6, 9), keep: Number.POSITIVE_INFINITY })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rotated).toEqual([])
    expect(execSync(["-readonly", r.path, "SELECT id FROM migration;"]).stdout.trim()).toBe(M1)
    const broken = createVerifiedBackupSync({ dbPath: join(tmpRoot, "nope.db"), backupDir: dir, exec: execSync, fs: realFs, now: new Date(2026, 6, 10) })
    expect(broken.ok).toBe(false)
  })

  itSql("导出:目标可读", async () => {
    const db = join(tmpRoot, "exp-src.db")
    await makeFixtureDb(db, [M1])
    const target = join(tmpRoot, "exported.db")
    const r = await exportVerifiedCopy({ dbPath: db, targetPath: target, exec: execReal, fs: realFs })
    expect(r.ok).toBe(true)
    const back = await readDbMigrationIds(target, execReal, existsSync)
    expect(back).toEqual({ ok: true, ids: [M1], legacy: false })
  })

  itSql("恢复往返:损坏 → 从备份复原 → 水位回来;损坏件+WAL 残件保留在侧", async () => {
    const db = join(tmpRoot, "restore.db")
    await makeFixtureDb(db, [M1, M2])
    const dir = join(tmpRoot, "restore-backups")
    const bk = await createVerifiedBackup({ dbPath: db, backupDir: dir, exec: execReal, fs: realFs, now: new Date(2026, 6, 9) })
    expect(bk.ok).toBe(true)
    if (!bk.ok) return
    // 弄坏原库 + 伪造 WAL 残件
    writeFileSync(db, "garbage garbage garbage garbage garbage garbage garbage")
    writeFileSync(`${db}-wal`, "stale wal")
    const corrupt = await readDbMigrationIds(db, execReal, existsSync)
    expect(corrupt.ok).toBe(false)
    const restored = restoreFromBackup({ dbPath: db, backupPath: bk.path, fs: realFs, now: new Date(2026, 6, 10, 1, 2, 3) })
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    const after = await readDbMigrationIds(db, execReal, existsSync)
    expect(after).toEqual({ ok: true, ids: [M1, M2], legacy: false })
    expect(existsSync(restored.damagedPath)).toBe(true)
    expect(existsSync(`${restored.damagedPath}-wal`)).toBe(true)
    expect(existsSync(`${db}-wal`)).toBe(false)
  })
})

// ── `#1664`:OpenCode 2 的支持面清单 + 干净关闭的 WAL 库(#1662 裁决书 F1 / N2 / R18)────────────────────
// owner 的库是 WAL 模式、干净关闭后没有 -wal/-shm;只读直开这种库失败(exit 14),预检曾因此静默 skip、备份也失败
// (L1 勘破 §9.2,真库副本复现)。夹具照这个形态造:建库、TRUNCATE 检查点、关库、删掉 -wal/-shm —— 干净关闭留下的
// 就是这个样子(macOS 的 sqlite3 关库后会保留它们,所以要删)。支持面清单取生产生成器从本树 core 的 migration.gen.ts
// 算出的那份,经生产的 loadExpectedIds 读回。
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..")
/**
 * 1.18.35 形态的库:`git ls-tree --name-only e56ae0c036 packages/core/src/database/migration/` 的 40 个 id
 * (= owner 真库副本 migration 表的 40 行,L1 勘破 §9.1):38 条上游迁移 + Code Puppy 自己的 2 条。
 */
const DB_1_18_35_IDS = [
  "20260127222353_familiar_lady_ursula",
  "20260211171708_add_project_commands",
  "20260213144116_wakeful_the_professor",
  "20260225215848_workspace",
  "20260227213759_add_session_workspace_id",
  "20260228203230_blue_harpoon",
  "20260303231226_add_workspace_fields",
  "20260309230000_move_org_to_state",
  "20260312043431_session_message_cursor",
  "20260323234822_events",
  "20260410174513_workspace-name",
  "20260413175956_chief_energizer",
  "20260423070820_add_icon_url_override",
  "20260427172553_slow_nightmare",
  "20260428004200_add_session_path",
  "20260501142318_next_venus",
  "20260504145000_add_sync_owner",
  "20260507164347_add_workspace_time",
  "20260510033149_session_usage",
  "20260511000411_data_migration_state",
  "20260511173437_session-metadata",
  "20260601010001_normalize_storage_paths",
  "20260601202201_amazing_prowler",
  "20260602002951_lowly_union_jack",
  "20260602182828_add_project_directories",
  "20260603001617_session_message_projection_indexes",
  "20260603040000_session_message_projection_order",
  "20260603141458_session_input_inbox",
  "20260603160727_jittery_ezekiel_stane",
  "20260604172448_event_sourced_session_input",
  "20260605003541_add_session_context_snapshot",
  "20260605042240_add_context_epoch_agent",
  "20260611035744_credential",
  "20260611192811_lush_chimera",
  "20260612174303_project_dir_strategy",
  "20260622142730_simplify_session_context_epoch",
  "20260622170816_reset_v2_session_state",
  "20260622202450_simplify_session_input",
  "20260720085655_permission-decision-receipt",
  "20260720094009_permission-request-admission",
]

async function makeCleanWalDb(path: string, ids: string[]) {
  const values = ids.map((id) => `('${id}', 1)`).join(",")
  const res = await execReal([
    path,
    `PRAGMA journal_mode=WAL; CREATE TABLE migration(id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL); INSERT INTO migration VALUES ${values}; CREATE TABLE session(id TEXT); PRAGMA wal_checkpoint(TRUNCATE);`,
  ])
  if (res.code !== 0) throw new Error(`fixture failed: ${res.stderr}`)
  rmSync(`${path}-wal`, { force: true })
  rmSync(`${path}-shm`, { force: true })
  // 夹具自检:文件头第 18/19 字节都是 2 才是 WAL 库,且旁边没有 -wal/-shm。
  const header = readFileSync(path).subarray(18, 20)
  if (header[0] !== 2 || header[1] !== 2 || existsSync(`${path}-wal`) || existsSync(`${path}-shm`))
    throw new Error("夹具不是「干净关闭的 WAL 库」—— 本次测量作废")
}

function expectedFromGenerator(): ExpectedMigrations {
  const resources = mkdtempSync(join(tmpRoot, "resources-"))
  writeFileSync(
    join(resources, "db-expected-migrations.json"),
    JSON.stringify(expectedMigrations(join(REPO_ROOT, "packages/core/src/database"))),
  )
  const loaded = loadExpectedIds({ resourcesPath: resources, exists: existsSync, readText: (p) => readFileSync(p, "utf8") })
  if (!loaded) throw new Error("生成器的产物经 loadExpectedIds 读不回来 —— 本次测量作废")
  return loaded
}

describe("#1664 OpenCode 2 支持面 + 干净关闭的 WAL 库", () => {
  test("生成器:清单取自 core 的 migration.gen.ts;退役的两条单列、不在支持面里;1.18.35 的其余 38 条都在", () => {
    const expected = expectedFromGenerator()
    expect(expected.retired).toEqual(RETIRED_MIGRATION_IDS)
    expect(expected.ids.filter((id) => expected.retired.includes(id))).toEqual([])
    expect(DB_1_18_35_IDS.filter((id) => !expected.ids.includes(id))).toEqual(RETIRED_MIGRATION_IDS)
  })

  itSql("1.18.35 形态的干净关闭 WAL 库 ⇒ migrate-ahead(不是 skip、不是 db-ahead);控制组:只读直开 ⇒ skip", async () => {
    const expected = expectedFromGenerator()
    const db = join(tmpRoot, "wal-1.18.35.db")
    await makeCleanWalDb(db, DB_1_18_35_IDS)

    // 控制组 = 读法改回 `-readonly` 直开。必须先跑:普通连接读过之后,macOS 的 sqlite3 会把 -wal/-shm 留在盘上,
    // 只读直开就不再失败了。
    const viaReadonly = await readDbMigrationIds(db, (args) => execReal(["-readonly", ...args]), existsSync)
    expect(decidePlan(viaReadonly, expected).kind, `控制组没 skip —— 夹具不是只读直开打不开的那种库:${JSON.stringify(viaReadonly)}`).toBe("skip")

    const read = await readDbMigrationIds(db, execReal, existsSync)
    const plan = decidePlan(read, expected)
    expect(plan.kind, `干净关闭的 WAL 库没走到「待前进」:${JSON.stringify(plan)}`).toBe("migrate-ahead")
    if (plan.kind !== "migrate-ahead") return
    expect(plan.pending.length).toBeGreaterThan(0)
    expect(plan.pending).toEqual(expected.ids.filter((id) => !DB_1_18_35_IDS.includes(id)))
    // 不单列退役 id(只给 2.x 的支持面)⇒ db-ahead,未知的正好是那两条 —— 退役字段挡的就是这个。
    expect(decidePlan(read, { ids: expected.ids, retired: [] })).toEqual({
      kind: "db-ahead",
      unknown: RETIRED_MIGRATION_IDS,
      latest: RETIRED_MIGRATION_IDS[1]!,
    })
  })

  itSql("干净关闭的 WAL 库直接备份(前进前备份、菜单「立即备份」都走它)⇒ 成功并通过校验;控制组:只读会话的 VACUUM INTO ⇒ 失败", async () => {
    // 每一臂各用一份新夹具、之前不读水位:普通连接读过之后 macOS 的 sqlite3 留下 -wal/-shm,只读会话的备份也就不再失败。
    const control = join(tmpRoot, "wal-backup-control.db")
    await makeCleanWalDb(control, DB_1_18_35_IDS)
    const viaReadonly = await createVerifiedBackup({
      dbPath: control,
      backupDir: join(tmpRoot, "wal-backups-control"),
      exec: (args) => execReal(["-readonly", ...args]),
      fs: realFs,
      now: new Date(2026, 10, 9),
    })
    expect(viaReadonly.ok, `控制组的只读备份居然成功了 —— 夹具测不出要修的那条缺陷:${JSON.stringify(viaReadonly)}`).toBe(false)

    const db = join(tmpRoot, "wal-backup.db")
    await makeCleanWalDb(db, DB_1_18_35_IDS)
    const backup = await createVerifiedBackup({
      dbPath: db,
      backupDir: join(tmpRoot, "wal-backups"),
      exec: execReal,
      fs: realFs,
      now: new Date(2026, 10, 9),
    })
    expect(backup.ok, `干净关闭的 WAL 库备份失败:${JSON.stringify(backup)}`).toBe(true)
    if (!backup.ok) return
    expect(await readDbMigrationIds(backup.path, execReal, existsSync)).toEqual({ ok: true, ids: DB_1_18_35_IDS, legacy: false })
  })

  itSql("2.x 新建的库(支持面全部 id,没有退役那两条)⇒ proceed:不前进、不备份(控制组:退役 id 并进支持面 ⇒ 每次启动 migrate-ahead)", async () => {
    const expected = expectedFromGenerator()
    const db = join(tmpRoot, "wal-2x.db")
    await makeCleanWalDb(db, expected.ids)
    const read = await readDbMigrationIds(db, execReal, existsSync)
    expect(decidePlan(read, expected)).toEqual({ kind: "proceed" })
    expect(decidePlan(read, { ids: [...expected.ids, ...expected.retired], retired: [] })).toEqual({
      kind: "migrate-ahead",
      pending: RETIRED_MIGRATION_IDS,
    })
  })
})
