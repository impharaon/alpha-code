// alpha-code#1662 L1a — Node thin adapter for the ONE bun:sqlite use in upstream v1-migration.bun.ts (:808,
// opening a read-only `opencode-next.db`). Only the members that file calls: query().get/all, run, inTransaction, close.
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
