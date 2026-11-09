// `#1667`(#1662 L5,裁决书 R14):上游 `v1-migration.bun.ts` 里唯一一处 `bun:sqlite`(打开只读的 `opencode-next.db`)的
// Node 薄适配,只实现那个文件调到的成员:`query().get/all`、`run`、`inTransaction`、`close`。
// 来源:L1a 实测过的 `docs/verification/2026-11-09-1662-l1/shims/bun-sqlite.ts`(e3next 臂)。只由 scripts/build-engine.ts 接入。
import { DatabaseSync, type SQLInputValue } from "node:sqlite"

export class Database {
  readonly #db: DatabaseSync
  constructor(path: string, options: { readonly?: boolean } = {}) {
    this.#db = new DatabaseSync(path, { readOnly: options.readonly ?? false })
  }
  query(sql: string) {
    const statement = this.#db.prepare(sql)
    return {
      get: (...params: SQLInputValue[]) => statement.get(...params) ?? null,
      all: (...params: SQLInputValue[]) => statement.all(...params),
    }
  }
  run(sql: string) {
    this.#db.exec(sql)
  }
  get inTransaction() {
    return this.#db.isTransaction
  }
  close() {
    this.#db.close()
  }
}
