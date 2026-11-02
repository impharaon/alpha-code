// 升级到新名字后第一次启动的一次性迁移(alpha-code#1569;方案 §3、§4、§7)。
//
// owner 电脑上 0.1.24 及更早版本写下的数据还挂在旧名字下;新版只认新名字。这里在拿到单实例锁之后、
// 任何钥匙串访问与引擎启动之前,把它们一次挪到新名字下:
//   A 段(preferAppEnv 之前,runNamingMigrationBoot):全局根、当前环境配置 / 收据 / 授权账 / 治理文件、
//        userData 改名、引擎配置、目录 LKG、缓存删除、设置键、模型选择;
//   B 段(preferAppEnv 之后,naming-migration-db.ts 的 runNamingMigrationDbStep):会话库。
// 每一步先记日志再动手(naming-migration-journal.ts);任一步失败按日志逆序撤销,启动停下并给出可读错误;
// 完成标记写入前被杀,下次启动先撤销再重跑;完成后第二次启动直接跳过。
// 写盘只经 naming-migration-fs.ts 的白名单端口;不读、不解密任何凭据(加密文件只改名)。electron-free。
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readlinkSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { applyEdits, parseTree, type Edit, type JSONPath, type Node, type ParseError } from "jsonc-parser"
import { defaultCodePuppyBaseRoot } from "./codepuppy-environment"
import { readLedger } from "./codepuppy-installs"
import { grantKeyFor, readCapabilityGrant } from "./ext-capability-grants"
import { probeTransactionJournals } from "./ext-transaction"
import type { MigrationFs, WriteAllowList } from "./naming-migration-fs"
import { dbUndo, resolveDbPorts, type NamingMigrationDbPorts, type SqliteRun } from "./naming-migration-db"
import {
  openJournal,
  readJournalFile,
  type JournalFile,
  type JournalJson,
  type JournalUndo,
  type NamingMigrationJournal,
} from "./naming-migration-journal"
import {
  AGENT_NAMES,
  DISCARDED_CACHE_FILES,
  DISCARDED_USER_DATA,
  ENV_CONFIG,
  FACTORY_SKILL_NAMES,
  LEGACY_BASE_DIR,
  LEGACY_ENV_CONFIG,
  LEGACY_USER_DATA,
  OFFICE_SERVER_KEYS,
  PROVIDER_ID,
  SETTINGS_KEYS,
} from "./naming-migration-map"
import { isModelSelectionStore, rewriteModelSelections } from "./naming-migration-model-selection"
import { sqliteBinary } from "./platform"
import { USER_DATA_LAYOUT, type UserDataItem } from "./user-data-layout"

export type { NamingMigrationJournal } from "./naming-migration-journal"

export type NamingMigrationBoot =
  | { kind: "skip"; reason: "dev" | "onboarding-test" | "unsupported-platform" | "complete" }
  | { kind: "ready"; journal: NamingMigrationJournal }
  | { kind: "failed"; message: string }

/** 测试端口(fs / sqlite / now / 平台 / 进程探测);生产全用默认值。 */
export type NamingMigrationPorts = {
  fs?: (allow: WriteAllowList) => MigrationFs
  sqlite?: SqliteRun
  now?: () => Date
  platform?: NodeJS.Platform
  /** pid 活着吗(默认 process.kill(pid, 0))。 */
  pidAlive?: (pid: number) => boolean
  /** pid 的可执行文件完整路径(默认 `/bin/ps -o comm= -p <pid>`)。 */
  executableOf?: (pid: number) => string | undefined
}

/** 迁移目录:userData 下,0700;日志、备份、挪开的目标根、项目名单都在这里。 */
export const MIGRATION_DIR = "codepuppy-naming-migration"
export const PROJECTS_LOG = "projects.log"

function resolveNamingMigrationPorts(ports: NamingMigrationPorts = {}): NamingMigrationDbPorts & Required<NamingMigrationPorts> {
  return {
    ...resolveDbPorts(ports),
    platform: ports.platform ?? process.platform,
    pidAlive: ports.pidAlive ?? defaultPidAlive,
    executableOf: ports.executableOf ?? defaultExecutableOf,
  }
}

export function runNamingMigrationBoot(
  input: {
    environment: "prod" | "beta" | "dev"
    onboardingTest: boolean
    userData: string
    appData: string
    home: string
    env: Readonly<Record<string, string | undefined>>
    /** 另外两个渠道的 userData;任一目录的 SingletonLock 指向本机存活进程 ⇒ 返回 failed,撤销与迁移都不做。 */
    otherChannelUserData: readonly string[]
    /** 本票以外的步类型 → 撤销动作(#1571 传 "keychain-rename");日志里出现未登记的 kind ⇒ fail closed。 */
    extraUndo: Readonly<Record<string, JournalUndo>>
    /** 确定要跑新一轮之后、执行任何一步之前调用;抛错 ⇒ 不写任何东西,返回 failed。 */
    precheck: () => void
  },
  portsInput?: NamingMigrationPorts,
): NamingMigrationBoot {
  if (input.environment === "dev") return { kind: "skip", reason: "dev" }
  if (input.onboardingTest) return { kind: "skip", reason: "onboarding-test" }
  const ports = resolveNamingMigrationPorts(portsInput)
  if (!sqliteBinary(ports.platform)) return { kind: "skip", reason: "unsupported-platform" }

  const environment = input.environment
  const layout = migrationLayout(input.userData, input.appData, environment)
  const fs = ports.fs({ trees: [input.userData, layout.srcBase, layout.dstBase] })
  const journalFile = join(layout.dir, "journal.json")
  try {
    const existing = readJournalFile(fs, journalFile)
    if (existing?.status === "complete") return { kind: "skip", reason: "complete" }

    const running = otherChannelRunning(input.otherChannelUserData, ports)
    if (running) return { kind: "failed", message: running }

    const undo = { ...builtinUndo(fs, ports), ...input.extraUndo }
    if (existing) {
      const unknown = existing.steps.find((step) => !undo[step.kind])
      if (unknown) return { kind: "failed", message: `升级迁移日志里有本版本认不出的步骤「${unknown.kind}」,不敢撤销(日志:${journalFile})` }
      if (existing.status === "running") openJournal(fs, journalFile, existing, undo).undoAll()
      fs.rename(journalFile, join(layout.dir, `journal-${existing.runId}-undone.json`))
    }

    const runId = `${ports.now().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`
    const plan = planSteps(fs, layout, runId)
    input.precheck()
    fs.mkdir(layout.dir)
    const data: JournalFile = { v: 1, runId, status: "running", environment, steps: [] }
    const journal = openJournal(fs, journalFile, data, undo)
    try {
      for (const run of plan) run(journal)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        journal.undoAll()
      } catch (undoError) {
        throw new Error(`${message}; rollback also failed: ${undoError instanceof Error ? undoError.message : String(undoError)}`)
      }
      fs.rename(journalFile, join(layout.dir, `journal-${runId}-undone.json`))
      throw error
    }
    return { kind: "ready", journal }
  } catch (error) {
    return { kind: "failed", message: error instanceof Error ? error.message : String(error) }
  }
}

// ── 布局 ───────────────────────────────────────────────────────────────────────────────

type Layout = {
  userData: string
  dir: string
  srcBase: string
  dstBase: string
  environment: "prod" | "beta"
  /** 当前环境根(迁移后的位置)。 */
  envRoot: string
}

function migrationLayout(userData: string, appData: string, environment: "prod" | "beta"): Layout {
  const dstBase = defaultCodePuppyBaseRoot(appData)
  return {
    userData,
    dir: join(userData, MIGRATION_DIR),
    srcBase: join(appData, LEGACY_BASE_DIR),
    dstBase,
    environment,
    envRoot: join(dstBase, "env", environment),
  }
}

// ── 计划与预检(只读;任一不过 ⇒ 抛,一个字节都没写)──────────────────────────────────────

type PlannedStep = (journal: NamingMigrationJournal) => void

function planSteps(fs: MigrationFs, layout: Layout, runId: string): PlannedStep[] {
  const steps: PlannedStep[] = []
  const backups = { n: 0 }
  const backupDir = join(layout.dir, "backup")
  const nextBackup = (name: string) => join(backupDir, `${++backups.n}-${name}`)
  const rename = (from: string, to: string): PlannedStep => (journal) =>
    journal.step("rename", { from, to }, () => {
      if (!fs.exists(dirname(to))) fs.mkdir(dirname(to))
      fs.rename(from, to)
    })
  const rewrite = (file: string, transform: (text: string) => string, verify?: (before: string) => void): PlannedStep => {
    const backup = nextBackup(basename(file))
    return (journal) =>
      journal.step("rewrite", { file, backup }, () => {
        const before = fs.readText(file)
        fs.mkdir(backupDir)
        fs.copy(file, `${backup}.tmp`)
        fs.rename(`${backup}.tmp`, backup)
        const after = transform(before)
        if (after !== before) fs.writeAtomic(file, after)
        verify?.(before)
      })
  }

  // 全局根(R6 / R20-2):源在、目标不在 ⇒ 改名;目标在且里面没有 prod/beta 的东西 ⇒ 先把目标挪开再改名;
  // 目标里有 prod/beta 的东西 ⇒ 不敢合并,预检失败;源不在 ⇒ 另一个渠道已经搬过,跳过。
  const srcExists = fs.exists(layout.srcBase)
  const dstExists = fs.exists(layout.dstBase)
  if (srcExists && dstExists) {
    const owned = prodOrBetaFiles(fs, layout.dstBase)
    if (owned)
      throw new Error(`旧数据目录 ${layout.srcBase} 和新数据目录 ${layout.dstBase} 同时存在,而且新目录里已经有正式版或测试版的数据(${owned}),不敢合并。请参照升级说明处理后再打开。`)
    steps.push(rename(layout.dstBase, join(layout.dir, `aside-${runId}`)))
  }
  if (srcExists) steps.push(rename(layout.srcBase, layout.dstBase))
  const currentBase = srcExists ? layout.srcBase : layout.dstBase
  const currentEnv = join(currentBase, "env", layout.environment)

  // 路径前缀:迁移后,配置与收据里指向旧位置的绝对路径换成新位置(按顺序逐对替换)。
  const prefixes: Array<readonly [string, string]> = [
    [layout.srcBase, layout.dstBase],
    [join(layout.envRoot, LEGACY_ENV_CONFIG), join(layout.envRoot, ENV_CONFIG)],
    ...OFFICE_SERVER_KEYS.map(
      ([from, to]) => [join(layout.envRoot, "ext-store", grantKeyFor("mcp", from)), join(layout.envRoot, "ext-store", grantKeyFor("mcp", to))] as const,
    ),
    ...renamedUserData().map(([from, to]) => [join(layout.userData, from), join(layout.userData, to)] as const),
  ]
  const rewritePaths = (value: string) =>
    prefixes.reduce((text, [from, to]) => text.replace(new RegExp(`${escapeRegExp(from)}(?=/|}|$)`, "g"), to), value)

  // 环境配置
  const legacyConfig = join(currentEnv, LEGACY_ENV_CONFIG)
  if (fs.exists(legacyConfig)) {
    if (fs.exists(join(currentEnv, ENV_CONFIG)))
      throw new Error(`${join(currentEnv, LEGACY_ENV_CONFIG)} 与 ${join(currentEnv, ENV_CONFIG)} 同时存在,不知道该用哪一份。请参照升级说明处理后再打开。`)
    const config = join(layout.envRoot, ENV_CONFIG)
    steps.push(rename(join(layout.envRoot, LEGACY_ENV_CONFIG), config))
    steps.push(
      rewrite(config, (text) =>
        editJsonText(text, {
          key: (path, key) => (path.length === 1 && path[0] === "mcp" ? lookup(OFFICE_SERVER_KEYS, key) : path.length === 1 && path[0] === "agent" ? lookup(AGENT_NAMES, key) : undefined),
          value: (_path, value) => rewritePaths(value),
        }),
      ),
    )
  }

  // 安装收据(R4):Office 四件的 name / id / configKey 与授权账键按映射精确改;files[] 绝对路径换前缀。回读核验。
  if (fs.exists(join(currentEnv, "installs.json"))) {
    const exact = new Map(
      OFFICE_SERVER_KEYS.flatMap(([from, to]) => [
        [from, to],
        [`mcp:${from}`, `mcp:${to}`],
        [`mcp.${from}`, `mcp.${to}`],
        [grantKeyFor("mcp", from), grantKeyFor("mcp", to)],
      ]),
    )
    steps.push(
      rewrite(
        join(layout.envRoot, "installs.json"),
        (text) => editJsonText(text, { value: (_path, value) => exact.get(value) ?? rewritePaths(value) }),
        () => verifyLedger(layout.envRoot, exact),
      ),
    )
  }

  // 授权账 ×4(AC2):目录改名,文件内 key 跟着改;capabilities / manifestDigest / txId / grantedAt 原样。回读核验。
  for (const [from, to] of OFFICE_SERVER_KEYS) {
    const oldKey = grantKeyFor("mcp", from)
    const newKey = grantKeyFor("mcp", to)
    const oldDir = join(currentEnv, "ext-store", oldKey)
    if (!fs.exists(oldDir)) continue
    if (fs.exists(join(currentEnv, "ext-store", newKey))) throw targetExists(join(currentEnv, "ext-store", newKey))
    const before = readCapabilityGrant(currentEnv, oldKey)
    const newDir = join(layout.envRoot, "ext-store", newKey)
    steps.push(rename(join(layout.envRoot, "ext-store", oldKey), newDir))
    if (!fs.exists(join(oldDir, "grants.json"))) continue
    steps.push(
      rewrite(
        join(newDir, "grants.json"),
        (text) => editJsonText(text, { value: (path, value) => (path.length === 1 && path[0] === "key" && value === oldKey ? newKey : undefined) }),
        () => {
          const after = readCapabilityGrant(layout.envRoot, newKey)
          if (before && (!after || JSON.stringify(after.capabilities) !== JSON.stringify(before.capabilities)))
            throw new Error(`授权记录 ${newKey} 改名后读不回来,已撤销`)
        },
      ),
    )
  }

  // 治理文件(R8 / R20-5):agent 名、出厂技能 id、override 里的模型供应商前缀。
  if (fs.exists(join(currentEnv, "governance.json"))) {
    const [oldProvider, newProvider] = PROVIDER_ID
    steps.push(
      rewrite(join(layout.envRoot, "governance.json"), (text) =>
        editJsonText(text, {
          key: (path, key) => (path.length === 2 && path[0] === "agents" && path[1] === "override" ? lookup(AGENT_NAMES, key) : undefined),
          value: (path, value) => {
            if (path[0] === "agents" && ["hide", "disable", "allow"].includes(String(path[1])) && path.length === 3) return lookup(AGENT_NAMES, value)
            if (path[0] === "agents" && path[1] === "override" && path[3] === "model" && path.length === 4 && value.startsWith(`${oldProvider}/`))
              return `${newProvider}/${value.slice(oldProvider.length + 1)}`
            if (path[0] === "skills" && path[1] === "deny" && path.length === 3) return lookup(FACTORY_SKILL_NAMES, value)
            return undefined
          },
        }),
      ),
    )
  }

  // userData 改名(加密文件只改名;目录内不读)、两份目录 LKG 原字节改名(R3);引擎配置改名后改写路径前缀
  for (const [from, to] of renamedUserData()) {
    const source = join(layout.userData, from)
    if (!fs.exists(source)) continue
    if (fs.exists(join(layout.userData, to))) throw targetExists(join(layout.userData, to))
    steps.push(rename(source, join(layout.userData, to)))
    if (to === USER_DATA_LAYOUT.engineConfig && fs.exists(join(source, "opencode.json")))
      steps.push(rewrite(join(layout.userData, to, "opencode.json"), (text) => editJsonText(text, { value: (_path, value) => rewritePaths(value) })))
  }

  // 签名或可重取的缓存(AC5):挪进迁移备份目录(字节不改),由正常拉取重建
  for (const name of [...DISCARDED_USER_DATA.map((item) => LEGACY_USER_DATA[item]), ...DISCARDED_CACHE_FILES]) {
    const source = join(layout.userData, name)
    if (fs.exists(source)) steps.push(rename(source, nextBackup(name)))
  }

  // 设置键:读旧写新删旧;新键已在则留新删旧
  const settings = join(layout.userData, "opencode.settings")
  const settingsData = fs.exists(settings) ? (JSON.parse(fs.readText(settings)) as Record<string, unknown>) : {}
  if (SETTINGS_KEYS.some(([from]) => from in settingsData))
    steps.push(
      rewrite(settings, (text) => {
        const data = JSON.parse(text) as Record<string, unknown>
        for (const [from, to] of SETTINGS_KEYS) {
          if (!(from in data)) continue
          if (!(to in data)) data[to] = data[from]
          delete data[from]
        }
        return JSON.stringify(data, null, "\t")
      }),
    )

  // 模型选择(R8):global / 各工作区 / 各草稿 store 文件,一个改动的文件一步
  for (const name of fs.readdir(layout.userData).filter(isModelSelectionStore).sort()) {
    const file = join(layout.userData, name)
    if (rewriteModelSelections(name, fs.readText(file)) !== fs.readText(file)) steps.push(rewrite(file, (text) => rewriteModelSelections(name, text)))
  }

  // 未完成的扩展事务(R8 改 / R20-8):只看 prod、beta;有 ⇒ 不迁
  for (const env of ["prod", "beta"]) {
    const probe = probeTransactionJournals(join(currentBase, "env", env))
    if (probe.unreadableDir || probe.entries.some((entry) => !entry.terminal))
      throw new Error("有未完成的扩展安装,请先装回旧版打开一次完成恢复,再装新版。")
  }
  return steps
}

/** 改名的 userData 项(旧 → 新);缓存删除项不在其中(AC5)。 */
function renamedUserData(): Array<readonly [string, string]> {
  return (Object.keys(USER_DATA_LAYOUT) as UserDataItem[])
    .filter((item) => !DISCARDED_USER_DATA.includes(item))
    .map((item) => [LEGACY_USER_DATA[item], USER_DATA_LAYOUT[item]] as const)
}

/** 目标根里属于 prod/beta 的第一个文件(R20-2):`env/prod|beta/` 下任何非目录项,或任一子目录里的 `prod.json` / `beta.json`。 */
export function prodOrBetaFiles(fs: MigrationFs, base: string): string | undefined {
  const walk = (dir: string): string | undefined => {
    if (!fs.isDirectory(dir)) return undefined
    for (const name of fs.readdir(dir)) {
      const p = join(dir, name)
      const hit = fs.isDirectory(p) ? walk(p) : p
      if (hit) return hit
    }
    return undefined
  }
  for (const env of ["prod", "beta"]) {
    const hit = walk(join(base, "env", env))
    if (hit) return hit
  }
  for (const name of fs.isDirectory(base) ? fs.readdir(base) : []) {
    const dir = join(base, name)
    if (!fs.isDirectory(dir)) continue
    const hit = ["prod.json", "beta.json"].map((file) => join(dir, file)).find((p) => fs.exists(p))
    if (hit) return hit
  }
  return undefined
}

function verifyLedger(envRoot: string, exact: ReadonlyMap<string, string>) {
  const ledger = readLedger(envRoot)
  if (ledger.warning) throw new Error(`安装记录改写后读不回来,已撤销:${ledger.warning}`)
  const leftovers = ledger.receipts.filter((receipt) => exact.has(receipt.name) || exact.has(receipt.id))
  if (leftovers.length > 0) throw new Error(`安装记录改写后仍有旧名:${leftovers.map((receipt) => receipt.id).join(", ")}`)
}

// ── 内置步类型的撤销(撤销幂等:apply 只做了一半或根本没做都能撤)──────────────────────────────

function builtinUndo(fs: MigrationFs, ports: NamingMigrationDbPorts): Record<string, JournalUndo> {
  return {
    rename: (payload: JournalJson) => {
      const p = payload as { from: string; to: string }
      const from = fs.exists(p.from)
      const to = fs.exists(p.to)
      if (to && !from) return fs.rename(p.to, p.from)
      if (from && !to) return
      throw new Error(`cannot undo rename: ${p.from} and ${p.to} are ${from ? "both present" : "both missing"}`)
    },
    rewrite: (payload: JournalJson) => {
      const p = payload as { file: string; backup: string }
      if (!fs.exists(p.backup)) return
      fs.copy(p.backup, `${p.file}.naming-undo-tmp`)
      fs.rename(`${p.file}.naming-undo-tmp`, p.file)
    },
    db: dbUndo(ports),
  }
}

// ── 另外两个渠道在跑吗(R10 补 / R20-6)─────────────────────────────────────────────────

const APP_EXECUTABLE = /\/(Code Puppy|Code Puppy Beta|alpha-code)\.app\/Contents\/MacOS\/[^/]+$/

function otherChannelRunning(userDataDirs: readonly string[], ports: Required<NamingMigrationPorts>): string | undefined {
  for (const dir of userDataDirs) {
    const lock = join(dir, "SingletonLock")
    const pid = singletonLockPid(lock)
    if (pid === undefined || pid === process.pid || !ports.pidAlive(pid)) continue
    const executable = ports.executableOf(pid)
    if (!executable || !APP_EXECUTABLE.test(executable)) continue
    const app = APP_EXECUTABLE.exec(executable)![1]
    return `${app} 的另一个渠道正在运行,请先退出它再打开(锁:${lock})`
  }
  return undefined
}

/** Chromium 的 SingletonLock 是符号链接,目标 `<主机名>-<pid>`;读不出或不是这个形状 ⇒ 视为不在跑。 */
function singletonLockPid(lock: string): number | undefined {
  let target: string
  try {
    target = readlinkSync(lock)
  } catch {
    return undefined
  }
  const match = /-(\d+)$/.exec(target)
  return match ? Number(match[1]) : undefined
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

function defaultExecutableOf(pid: number): string | undefined {
  const proc = spawnSync("/bin/ps", ["-o", "comm=", "-p", String(pid)], { encoding: "utf8" })
  const out = proc.status === 0 ? proc.stdout.trim() : ""
  return out || undefined
}

// ── JSON(C) 精确改写:只替换命中的键 / 字符串值的那几个字节,注释与格式原样 ───────────────────

export function editJsonText(
  text: string,
  edits: { key?: (path: JSONPath, key: string) => string | undefined; value?: (path: JSONPath, value: string) => string | undefined },
): string {
  const errors: ParseError[] = []
  const root = parseTree(text, errors, { allowTrailingComma: true })
  if (!root || errors.length > 0) throw new Error("file is not parseable JSON")
  const out: Edit[] = []
  const walk = (node: Node, path: JSONPath) => {
    if (node.type === "object")
      for (const property of node.children ?? []) {
        const [keyNode, valueNode] = property.children ?? []
        if (!keyNode) continue
        const key = String(keyNode.value)
        const renamed = edits.key?.(path, key)
        if (renamed !== undefined && renamed !== key) out.push({ offset: keyNode.offset, length: keyNode.length, content: JSON.stringify(renamed) })
        if (valueNode) walk(valueNode, [...path, key])
      }
    if (node.type === "array") (node.children ?? []).forEach((child, index) => walk(child, [...path, index]))
    if (node.type === "string") {
      const next = edits.value?.(path, String(node.value))
      if (next !== undefined && next !== node.value) out.push({ offset: node.offset, length: node.length, content: JSON.stringify(next) })
    }
  }
  walk(root, [])
  return applyEdits(text, out)
}

function lookup(pairs: ReadonlyArray<readonly [string, string]>, value: string): string | undefined {
  return pairs.find(([from]) => from === value)?.[1]
}

function targetExists(target: string): Error {
  return new Error(`要改成的新名字 ${target} 已经存在,不敢覆盖。请参照升级说明处理后再打开。`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
