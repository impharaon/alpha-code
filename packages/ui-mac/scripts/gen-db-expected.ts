#!/usr/bin/env bun
// S17 T3(C17):构建期派生 app 支持面清单 → resources/db-expected-migrations.json
// (extraResources 进包;运行时 db-safety.loadExpectedIds 读取。)
// 为什么构建期生成而非运行时 import:ARCHITECTURE 硬约束② 禁止运行时 import core 内部模块。
//
// `#1664`(OpenCode 2):清单取引擎真正执行的那张表 —— core 的 migration.gen.ts import 的每个迁移模块里写的
// `id`(引擎把它写进 migration 表),不再扫目录。另列 `retired`:Code Puppy 1.x 时代自己的两条迁移,OpenCode 2
// 不认识。db-safety 只拿它们排除出「未知 id」,不计入「待前进」(#1662 裁决书 F1 / N2):不排除,老用户的库每次启动
// 都被判成「库比应用新」;并进支持面,2.x 新建的库每次启动都被判成「待前进」、整库备份。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const RETIRED_MIGRATION_IDS = [
  "20260720085655_permission-decision-receipt",
  "20260720094009_permission-request-admission",
]

/** `databaseDir` = core 的 `src/database`(里面有 migration.gen.ts 与 migration/)。 */
export function expectedMigrations(databaseDir: string) {
  const imported = [...readFileSync(join(databaseDir, "migration.gen.ts"), "utf8").matchAll(/from "\.\/migration\/([^"]+)\.js"/g)]
  const ids = imported
    .map((m) => {
      const id = /\bid:\s*"([^"]+)"/.exec(readFileSync(join(databaseDir, "migration", `${m[1]}.ts`), "utf8"))?.[1]
      if (!id) throw new Error(`gen-db-expected: migration/${m[1]}.ts has no id literal`)
      return id
    })
    .sort()
  if (ids.length === 0) throw new Error(`gen-db-expected: no migrations imported by ${join(databaseDir, "migration.gen.ts")}`)
  return { v: 1, ids, retired: RETIRED_MIGRATION_IDS }
}

if (import.meta.main) {
  const here = dirname(fileURLToPath(import.meta.url))
  const expected = expectedMigrations(join(here, "../../core/src/database"))
  const outDir = join(here, "../resources")
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "db-expected-migrations.json"), `${JSON.stringify(expected, null, 2)}\n`)
  console.log(
    `gen-db-expected: ${expected.ids.length} ids + ${expected.retired.length} retired → resources/db-expected-migrations.json (latest ${expected.ids[expected.ids.length - 1]})`,
  )
}
