// alpha-code#1662 L1b — judge a database COPY with Code Puppy's own db-safety (packages/ui-mac/src/main/db-safety.ts),
// against two expected-id sets: (A) the 2.x support surface = upstream `migrations` ids at 33f94fce96, and
// (B) A + alpha's two retired ids. Audit F1 expects A ⇒ db-ahead, B ⇒ migrate-ahead (then a verified backup).
// Prints ids and plan kinds only — never row content.
// Usage (bun 1.4.4, so the upstream module imports): bun l1b-db-safety.ts <pristine copy.db> <oc2 root> <backupDir>
// <pristine copy.db> must never have been opened (same file layout as the source: db, plus -wal only if the source had one);
// every read below works on its own clone (db + -wal, never -shm), because opening a file is what changes the layout.
//
// Two reads, both reported:
//   production — readDbMigrationIds() exactly as db-safety-boot.ts runs it (`/usr/bin/sqlite3 -readonly`), on a clone laid out as the source;
//   logic      — the same ids read through a writable scratch clone, so decidePlan() is judged even when the
//                production read cannot open the file (a quiescent WAL database: see l1b-copy-proof.sh).
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { SQLITE3, createVerifiedBackupSync, decidePlan, readDbMigrationIds } from "../../../packages/ui-mac/src/main/db-safety"

const [copy, oc2, backupDir] = process.argv.slice(2)
if (!copy || !oc2 || !backupDir) throw new Error("usage: l1b-db-safety.ts <copy.db> <oc2 root> <backupDir>")
for (const p of [copy, backupDir]) if (!p.startsWith("/private/tmp/")) throw new Error(`refusing: ${p} is not under /private/tmp`)
const { migrations } = await import(join(oc2, "packages/core/src/database/migration.gen.ts"))
const surface: string[] = migrations.map((m: { id: string }) => m.id)
const retired = ["20260720085655_permission-decision-receipt", "20260720094009_permission-request-admission"]
const exec = (args: string[]) => {
  const r = spawnSync(SQLITE3 ?? "/usr/bin/sqlite3", args, { encoding: "utf8" })
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
}
const summarize = (plan: ReturnType<typeof decidePlan>) =>
  plan.kind === "db-ahead" ? { kind: plan.kind, unknown: plan.unknown } : plan.kind === "migrate-ahead" ? { kind: plan.kind, pending: plan.pending.length } : plan

const clone = (name: string) => {
  const target = join(dirname(copy), name)
  for (const suffix of ["", "-wal", "-shm"]) rmSync(target + suffix, { force: true })
  for (const suffix of ["", "-wal"]) if (existsSync(copy + suffix)) copyFileSync(copy + suffix, target + suffix)
  return target
}
const prod = clone("clone-production-read.db")
const production = await readDbMigrationIds(prod, async (args) => exec(args), existsSync)
const prodBackupTarget = clone("clone-production-backup.db")
const scratch = clone("clone-logic.db")
const ids = exec([scratch, "SELECT id FROM migration ORDER BY id;"])
const logic = ids.code === 0 ? { ok: true as const, ids: ids.stdout.split("\n").filter(Boolean), legacy: false } : { ok: false as const, kind: "error" as const, detail: ids.stderr.trim() }
const fs = {
  exists: existsSync,
  mkdir: (p: string) => void mkdirSync(p, { recursive: true }),
  readdir: (p: string) => readdirSync(p),
  rename: renameSync,
  copy: copyFileSync,
  remove: (p: string) => rmSync(p, { force: true }),
  readText: (p: string) => readFileSync(p, "utf8"),
}
const report = {
  surfaceIds: surface.length,
  production: {
    read: production.ok ? { ok: true, ids: production.ids.length, legacy: production.legacy } : production,
    planA: summarize(decidePlan(production, surface)),
    planB: summarize(decidePlan(production, [...surface, ...retired])),
    // what db-safety-boot.ts does on migrate-ahead, against a clone laid out as the source
    backupAsAtBoot: createVerifiedBackupSync({ dbPath: prodBackupTarget, backupDir, exec, fs, now: new Date() }),
  },
  logic: {
    read: logic.ok ? { ok: true, ids: logic.ids.length } : logic,
    planA: summarize(decidePlan(logic, surface)),
    planB: summarize(decidePlan(logic, [...surface, ...retired])),
    backupOfScratch: createVerifiedBackupSync({ dbPath: scratch, backupDir, exec, fs, now: new Date(Date.now() + 1000) }),
  },
}
for (const target of [prod, prodBackupTarget, scratch]) for (const suffix of ["", "-wal", "-shm"]) rmSync(target + suffix, { force: true })
console.log(JSON.stringify(report, null, 2))
