// 升级迁移日志(#1569 AC6;方案 §3 —— 接口块与 #1571 方案逐字一致,#1571 按它接入钥匙串一步)。
//
// 先记后做:每一步先以 pending 原子落盘,再执行;执行正常返回才标 done。撤销按日志逆序,
// 每撤完一步立即标 undone 并落盘 —— 撤销途中被杀,重启后从停下处续撤,已撤的步不再执行(R15)。
// 落盘全部经 naming-migration-fs 的白名单端口。electron-free。
import { dirname } from "node:path"
import type { MigrationFs } from "./naming-migration-fs"

export type JournalJson = null | boolean | number | string | JournalJson[] | { [key: string]: JournalJson }
export type JournalUndo = (payload: JournalJson) => void
export interface NamingMigrationJournal {
  /** 登记一步:先把 {kind, payload, state:"pending"} 原子落盘,再同步执行 apply;apply 正常返回才把该步改为 "done" 并落盘。
   *  apply 抛错 ⇒ 原样抛出,该步保持 "pending";撤销时同样执行它的 undo —— undo 必须对「apply 只做了一半或根本没做」幂等。 */
  step(kind: string, payload: JournalJson, apply: () => void): void
  /** 按日志逆序撤销:跳过已是 "undone" 的步,对其余步(含 pending)执行 undo,每撤完一步立即把它标 "undone" 并落盘;
   *  全部撤完后日志标 "undone"。任一 undo 抛错 ⇒ 停在该步并抛出;重启后再调用即从停下处续撤。 */
  undoAll(): void
  /** 写完成标记(status:"complete");此后启动看到它即整段跳过。 */
  complete(): void
}

export type JournalStep = { seq: number; kind: string; payload: JournalJson; state: "pending" | "done" | "undone" }
export type JournalFile = {
  v: 1
  runId: string
  status: "running" | "complete" | "undone"
  environment: string
  steps: JournalStep[]
  undoError?: string
}

/** 读日志:不存在 ⇒ null;存在但不是本格式 ⇒ 抛(不猜,调用方按失败处理)。 */
export function readJournalFile(fs: MigrationFs, file: string): JournalFile | null {
  if (!fs.exists(file)) return null
  const parsed = JSON.parse(fs.readText(file)) as JournalFile
  const statuses = ["running", "complete", "undone"]
  if (parsed?.v !== 1 || typeof parsed.runId !== "string" || !statuses.includes(parsed.status) || !Array.isArray(parsed.steps))
    throw new Error(`naming migration journal is not a v1 journal: ${file}`)
  return parsed
}

const directories = new WeakMap<NamingMigrationJournal, string>()

/** 日志所在的迁移目录(B 段把会话库备份放在它下面;接口块不变,所以不放进 NamingMigrationJournal)。 */
export function journalDirectory(journal: NamingMigrationJournal): string {
  const dir = directories.get(journal)
  if (!dir) throw new Error("not a naming migration journal")
  return dir
}

export function openJournal(
  fs: MigrationFs,
  file: string,
  data: JournalFile,
  undo: Readonly<Record<string, JournalUndo>>,
): NamingMigrationJournal {
  const persist = () => fs.writeAtomic(file, JSON.stringify(data, null, 2) + "\n")
  persist()
  const journal: NamingMigrationJournal = {
    step(kind, payload, apply) {
      if (!undo[kind]) throw new Error(`naming migration step kind has no undo: ${kind}`)
      const entry: JournalStep = { seq: data.steps.length + 1, kind, payload, state: "pending" }
      data.steps.push(entry)
      persist()
      apply()
      entry.state = "done"
      persist()
    },
    undoAll() {
      for (const entry of [...data.steps].reverse()) {
        if (entry.state === "undone") continue
        try {
          const run = undo[entry.kind]
          if (!run) throw new Error(`no undo registered for step kind "${entry.kind}"`)
          run(entry.payload)
        } catch (error) {
          data.undoError = `step ${entry.seq} (${entry.kind}): ${error instanceof Error ? error.message : String(error)}`
          persist()
          throw error
        }
        entry.state = "undone"
        persist()
      }
      data.status = "undone"
      delete data.undoError
      persist()
    },
    complete() {
      data.status = "complete"
      persist()
    },
  }
  directories.set(journal, dirname(file))
  return journal
}
