// ac#1571 —— keychain-name-migration.ts 的单测:假钥匙串端口 + 假迁移日志。
//
// 假日志只实现票面 §3 接口里 `step` / `undoAll` 的语义(先记 pending → apply → done;逆序撤销、跳过 undone、
// pending 也撤),payload 经一次 JSON 往返模拟落盘。与 #1569 真日志的联测留到接线阶段。
// 第 0 步实测的条目对(service / account)在这里写成独立字面量,不从被测模块推导。

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MIGRATION_DIR, runNamingMigrationBoot } from "./naming-migration"
import { sqliteBinary } from "./platform"
import {
  KEYCHAIN_RENAME_STEP,
  KeychainRenameError,
  KeychainTargetExistsError,
  assertKeychainTargetFree,
  keychainItemFor,
  keychainRenameUndo,
  nativeKeychainPort,
  planKeychainRename,
  rollBackNamingMigration,
  runKeychainRenameStep,
  settleNamingMigration,
  type KeychainAddon,
  type KeychainItem,
  type KeychainPort,
  type KeychainRenamePlan,
} from "./keychain-name-migration"
import { loadFenceAddon } from "./process-fence-apply"

const PROD_SOURCE = { service: "alpha-code Safe Storage", account: "alpha-code Key" }
const PROD_TARGET = { service: "Code Puppy Safe Storage", account: "Code Puppy Key" }
const BETA_SOURCE = { service: "alpha-code Beta Safe Storage", account: "alpha-code Beta Key" }
const BETA_TARGET = { service: "Code Puppy Beta Safe Storage", account: "Code Puppy Beta Key" }
const PROD_PLAN: KeychainRenamePlan = { from: PROD_SOURCE, to: PROD_TARGET }

const key = (item: KeychainItem) => `${item.service}\u0000${item.account}`

/** 内存钥匙串:只有条目名,外加调用记录。 */
function fakePort(initial: KeychainItem[], options: { renameFails?: boolean } = {}) {
  const items = new Set(initial.map(key))
  const calls: string[] = []
  const port: KeychainPort = {
    exists(item) {
      calls.push(`exists ${item.service}`)
      return items.has(key(item))
    },
    rename(from, to) {
      calls.push(`rename ${from.service} -> ${to.service}`)
      if (options.renameFails) throw new KeychainRenameError("injected rename failure")
      if (items.has(key(to))) throw new KeychainTargetExistsError(to)
      if (!items.delete(key(from))) throw new KeychainRenameError("source missing")
      items.add(key(to))
    },
  }
  return { port, calls, has: (item: KeychainItem) => items.has(key(item)), renames: () => calls.filter((c) => c.startsWith("rename")) }
}

/** §3 的 step / undoAll 语义,最小形状。 */
function fakeJournal(undo: Record<string, (payload: unknown) => void>) {
  const steps: { kind: string; payload: unknown; state: "pending" | "done" | "undone" }[] = []
  return {
    steps,
    step(kind: string, payload: unknown, apply: () => void) {
      const entry = { kind, payload: JSON.parse(JSON.stringify(payload)) as unknown, state: "pending" as "pending" | "done" | "undone" }
      steps.push(entry)
      apply()
      entry.state = "done"
    },
    undoAll() {
      for (const entry of [...steps].reverse()) {
        if (entry.state === "undone") continue
        undo[entry.kind]!(entry.payload)
        entry.state = "undone"
      }
    },
  }
}

describe("条目名与迁移计划 (AC4 目标属性 / AC5 渠道)", () => {
  test("keychainItemFor 取第 0 步实测形状:<应用名> Safe Storage / <应用名> Key", () => {
    expect(keychainItemFor("Code Puppy")).toEqual(PROD_TARGET)
    expect(keychainItemFor("Code Puppy Beta")).toEqual(BETA_TARGET)
  })

  test("prod:旧 prod 条目 → Code Puppy;beta:旧 beta 条目 → Code Puppy Beta", () => {
    expect(planKeychainRename({ environment: "prod", backend: "keychain", targetAppName: "Code Puppy" })).toEqual(PROD_PLAN)
    expect(planKeychainRename({ environment: "beta", backend: "keychain", targetAppName: "Code Puppy Beta" })).toEqual({
      from: BETA_SOURCE,
      to: BETA_TARGET,
    })
  })

  test("dev 不迁移;非钥匙串后端不迁移", () => {
    expect(planKeychainRename({ environment: "dev", backend: "keychain", targetAppName: "Code Puppy Dev" })).toBeNull()
    expect(planKeychainRename({ environment: "prod", backend: "dpapi", targetAppName: "Code Puppy" })).toBeNull()
    expect(planKeychainRename({ environment: "beta", backend: "other", targetAppName: "Code Puppy Beta" })).toBeNull()
  })
})

describe("预检:源与目标都在 ⇒ 停止、两条都不变 (AC5)", () => {
  test("源与目标都在 ⇒ assertKeychainTargetFree 抛 KeychainTargetExistsError(带「请按升级说明处理后重开」),没有任何改名,两条都原样", () => {
    const keychain = fakePort([PROD_SOURCE, PROD_TARGET])
    expect(() => assertKeychainTargetFree(keychain.port, PROD_PLAN)).toThrow(KeychainTargetExistsError)
    expect(() => assertKeychainTargetFree(keychain.port, PROD_PLAN)).toThrow("请按升级说明处理后重开")
    expect(keychain.renames()).toEqual([])
    expect(keychain.has(PROD_SOURCE)).toBe(true)
    expect(keychain.has(PROD_TARGET)).toBe(true)
  })

  test("目标不存在 ⇒ 预检通过;只有目标、没有源 ⇒ 也通过(不需要改名)", () => {
    expect(() => assertKeychainTargetFree(fakePort([PROD_SOURCE]).port, PROD_PLAN)).not.toThrow()
    expect(() => assertKeychainTargetFree(fakePort([PROD_TARGET]).port, PROD_PLAN)).not.toThrow()
  })
})

describe("改名步与日志撤销 (AC5 可逆改名)", () => {
  test("源条目不存在 ⇒ 不登记、不改名,返回 false", () => {
    const keychain = fakePort([])
    const journal = fakeJournal({ [KEYCHAIN_RENAME_STEP]: keychainRenameUndo(keychain.port) })
    expect(runKeychainRenameStep(journal, keychain.port, PROD_PLAN)).toBe(false)
    expect(journal.steps).toEqual([])
    expect(keychain.renames()).toEqual([])
  })

  test("源在 ⇒ 登记一步(payload 只有名字)并改名;undoAll ⇒ 同一调用改回源名", () => {
    const keychain = fakePort([PROD_SOURCE])
    const journal = fakeJournal({ [KEYCHAIN_RENAME_STEP]: keychainRenameUndo(keychain.port) })
    expect(runKeychainRenameStep(journal, keychain.port, PROD_PLAN)).toBe(true)
    expect(journal.steps).toEqual([{ kind: "keychain-rename", payload: PROD_PLAN, state: "done" }])
    expect(keychain.has(PROD_SOURCE)).toBe(false)
    expect(keychain.has(PROD_TARGET)).toBe(true)

    journal.undoAll()
    expect(keychain.has(PROD_SOURCE)).toBe(true)
    expect(keychain.has(PROD_TARGET)).toBe(false)
    expect(keychain.renames()).toEqual([
      "rename alpha-code Safe Storage -> Code Puppy Safe Storage",
      "rename Code Puppy Safe Storage -> alpha-code Safe Storage",
    ])
  })

  test("改名抛错 ⇒ 原样抛出、该步留在 pending;undoAll 对「没改成」幂等,源条目原样", () => {
    const keychain = fakePort([PROD_SOURCE], { renameFails: true })
    const journal = fakeJournal({ [KEYCHAIN_RENAME_STEP]: keychainRenameUndo(keychain.port) })
    expect(() => runKeychainRenameStep(journal, keychain.port, PROD_PLAN)).toThrow("injected rename failure")
    expect(journal.steps.map((s) => s.state)).toEqual(["pending"])
    journal.undoAll()
    expect(journal.steps.map((s) => s.state)).toEqual(["undone"])
    expect(keychain.renames()).toEqual(["rename alpha-code Safe Storage -> Code Puppy Safe Storage"])
    expect(keychain.has(PROD_SOURCE)).toBe(true)
  })
})

describe("settleNamingMigration 写完成标记 (AC6)", () => {
  test("完成标记写不下去 ⇒ 返回失败与可读原因,不抛(经 completeNamingMigration,与自检失败走同一个失败分支)", () => {
    const journal = {
      step: () => {},
      undoAll: () => {},
      complete: () => {
        throw new Error("ENOSPC: no space left on device")
      },
    }
    const settled = settleNamingMigration(journal, true, () => ["decrypted", "absent"])
    expect(settled.ok).toBe(false)
    expect(!settled.ok && settled.message).toContain("完成标记没写下去")
    expect(!settled.ok && settled.message).toContain("ENOSPC")
  })
})

describe("keychainRenameUndo 的状态 (AC5)", () => {
  test("目标在、源不在 ⇒ 改回", () => {
    const keychain = fakePort([PROD_TARGET])
    keychainRenameUndo(keychain.port)(PROD_PLAN)
    expect(keychain.has(PROD_SOURCE)).toBe(true)
    expect(keychain.has(PROD_TARGET)).toBe(false)
  })

  test("源在、目标不在 ⇒ 什么都不做", () => {
    const keychain = fakePort([PROD_SOURCE])
    keychainRenameUndo(keychain.port)(PROD_PLAN)
    expect(keychain.renames()).toEqual([])
    expect(keychain.has(PROD_SOURCE)).toBe(true)
  })

  test("两条都不在 ⇒ 抛;两条都在 ⇒ 抛且不改名", () => {
    expect(() => keychainRenameUndo(fakePort([]).port)(PROD_PLAN)).toThrow("都不存在")
    const both = fakePort([PROD_SOURCE, PROD_TARGET])
    expect(() => keychainRenameUndo(both.port)(PROD_PLAN)).toThrow("同时存在")
    expect(both.renames()).toEqual([])
  })

  test("日志 payload 形状不对 ⇒ 抛,不碰端口", () => {
    const keychain = fakePort([PROD_TARGET])
    expect(() => keychainRenameUndo(keychain.port)({ from: PROD_SOURCE })).toThrow(KeychainRenameError)
    expect(() => keychainRenameUndo(keychain.port)(null)).toThrow(KeychainRenameError)
    expect(keychain.calls).toEqual([])
  })
})

describe("nativeKeychainPort:OSStatus 只区分 0 / -25300 / -25299 (R21-4)", () => {
  function fakeAddon(status: { item?: number; rename?: number }) {
    const calls: string[][] = []
    const addon: KeychainAddon = {
      keychainItemStatus: (service, account) => {
        calls.push(["status", service, account])
        return status.item ?? 0
      },
      keychainRenameItem: (fromService, fromAccount, toService, toAccount) => {
        calls.push(["rename", fromService, fromAccount, toService, toAccount])
        return status.rename ?? 0
      },
    }
    return { addon, calls }
  }

  test("模块在第一次使用时才加载,只加载一次;加载失败从第一次查询抛出", () => {
    let loads = 0
    const fake = fakeAddon({})
    const port = nativeKeychainPort(() => {
      loads++
      return fake.addon
    })
    expect(loads).toBe(0)
    port.exists(PROD_TARGET)
    port.rename(PROD_SOURCE, PROD_TARGET)
    expect(loads).toBe(1)
    expect(fake.calls).toEqual([
      ["status", "Code Puppy Safe Storage", "Code Puppy Key"],
      ["rename", "alpha-code Safe Storage", "alpha-code Key", "Code Puppy Safe Storage", "Code Puppy Key"],
    ])
    const broken = nativeKeychainPort(() => {
      throw new Error("dlopen failed")
    })
    expect(() => broken.exists(PROD_TARGET)).toThrow("dlopen failed")
  })

  test("生产加载器(loadFenceAddon)拒绝没有钥匙串导出的旧构建,而不是返回一个缺函数的模块", () => {
    const exportsOf = (extra: Record<string, unknown>) => (module: { exports: unknown }) => {
      module.exports = { apply: () => ({ rc: 0, error: "" }), buildId: "test", libsandbox: "x", ...extra }
    }
    expect(() => loadFenceAddon(import.meta.path, exportsOf({}))).toThrow(/keychain rename functions/)
    const full = loadFenceAddon(import.meta.path, exportsOf({ keychainItemStatus: () => 0, keychainRenameItem: () => 0 }))
    expect(nativeKeychainPort(() => full).exists(PROD_TARGET)).toBe(true)
  })

  test("exists:0 ⇒ true,-25300 ⇒ false,其余带错误码抛", () => {
    expect(nativeKeychainPort(() => fakeAddon({ item: 0 }).addon).exists(PROD_TARGET)).toBe(true)
    expect(nativeKeychainPort(() => fakeAddon({ item: -25300 }).addon).exists(PROD_TARGET)).toBe(false)
    expect(() => nativeKeychainPort(() => fakeAddon({ item: -25293 }).addon).exists(PROD_TARGET)).toThrow(
      /错误码 -25293/,
    )
  })

  test("rename:0 ⇒ 成功,-25299 ⇒ KeychainTargetExistsError,其余(含 -25300)带错误码抛", () => {
    expect(() => nativeKeychainPort(() => fakeAddon({ rename: 0 }).addon).rename(PROD_SOURCE, PROD_TARGET)).not.toThrow()
    expect(() => nativeKeychainPort(() => fakeAddon({ rename: -25299 }).addon).rename(PROD_SOURCE, PROD_TARGET)).toThrow(
      KeychainTargetExistsError,
    )
    for (const status of [-25300, -25308, -1]) {
      const attempt = () => nativeKeychainPort(() => fakeAddon({ rename: status }).addon).rename(PROD_SOURCE, PROD_TARGET)
      expect(attempt).toThrow(KeychainRenameError)
      expect(attempt).toThrow(`错误码 ${status}`)
      expect(attempt).not.toThrow(KeychainTargetExistsError)
    }
  })
})

// ── 与 #1569 真迁移日志联测(方案 §7 AC5 / AC6 行)──────────────────────────────────────────
// 用真的 runNamingMigrationBoot + 真日志(空的临时 userData / appData,没有旧名文件 ⇒ #1569 的文件步为空),
// 钥匙串仍是假端口。index.ts 的接线顺序由启动顺序闸判;这里判接上之后的行为。
const canBoot = Boolean(sqliteBinary(process.platform))
if (!canBoot) console.warn(`[SKIP] keychain-name-migration 真日志联测:${process.platform} 上没有 sqlite3,#1569 的迁移直接 skip`)

describe.skipIf(!canBoot)("与 #1569 真日志联测 (AC5 / AC6)", () => {
  const roots: string[] = []
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

  function bootDirs() {
    const root = mkdtempSync(join(tmpdir(), "codepuppy-keychain-journal-"))
    roots.push(root)
    return { userData: join(root, "userData"), appData: join(root, "appData"), home: join(root, "home") }
  }

  function boot(
    dirs: ReturnType<typeof bootDirs>,
    port: KeychainPort,
    options: { environment?: "prod" | "beta" | "dev"; extraUndo?: Record<string, (payload: unknown) => void> } = {},
  ) {
    const environment = options.environment ?? "prod"
    const plan = planKeychainRename({ environment, backend: "keychain", targetAppName: "Code Puppy" })
    return runNamingMigrationBoot({
      environment,
      onboardingTest: false,
      ...dirs,
      env: {},
      otherChannelUserData: [],
      extraUndo: { [KEYCHAIN_RENAME_STEP]: keychainRenameUndo(port), ...options.extraUndo },
      precheck: () => {
        if (plan) assertKeychainTargetFree(port, plan)
      },
    })
  }

  const journalOf = (dirs: ReturnType<typeof bootDirs>) =>
    JSON.parse(readFileSync(join(dirs.userData, MIGRATION_DIR, "journal.json"), "utf8")) as {
      status: string
      steps: { kind: string; payload: unknown; state: string }[]
    }

  test("源与目标都在 ⇒ 预检失败、迁移目录都没建、两条都不动", () => {
    const dirs = bootDirs()
    const keychain = fakePort([PROD_SOURCE, PROD_TARGET])
    const result = boot(dirs, keychain.port)
    expect(result.kind).toBe("failed")
    expect(result.kind === "failed" && result.message).toContain("Code Puppy Safe Storage")
    expect(existsSync(join(dirs.userData, MIGRATION_DIR))).toBe(false)
    expect(keychain.renames()).toEqual([])
    expect(keychain.has(PROD_SOURCE)).toBe(true)
  })

  test("改名后登录文件解不开 ⇒ 整套撤销(假端口回源名)、不写完成标记、给出原因", () => {
    const dirs = bootDirs()
    const keychain = fakePort([PROD_SOURCE])
    const result = boot(dirs, keychain.port)
    if (result.kind !== "ready") throw new Error(`boot: ${JSON.stringify(result)}`)
    expect(runKeychainRenameStep(result.journal, keychain.port, PROD_PLAN)).toBe(true)
    expect(journalOf(dirs).steps).toEqual([{ seq: 1, kind: "keychain-rename", payload: PROD_PLAN, state: "done" }])
    const settled = settleNamingMigration(result.journal, true, () => ["failed", "absent"])
    expect(settled.ok).toBe(false)
    expect(!settled.ok && settled.message).toContain("已把这次升级的所有改动退回原样")
    expect(keychain.has(PROD_SOURCE)).toBe(true)
    expect(keychain.has(PROD_TARGET)).toBe(false)
    expect(journalOf(dirs).status).toBe("undone")
  })

  test("只有 BYOK 密钥库且它解不开 ⇒ 同样整套撤销", () => {
    const dirs = bootDirs()
    const keychain = fakePort([PROD_SOURCE])
    const result = boot(dirs, keychain.port)
    if (result.kind !== "ready") throw new Error(`boot: ${JSON.stringify(result)}`)
    runKeychainRenameStep(result.journal, keychain.port, PROD_PLAN)
    expect(settleNamingMigration(result.journal, true, () => ["absent", "failed"]).ok).toBe(false)
    expect(keychain.has(PROD_SOURCE)).toBe(true)
    expect(journalOf(dirs).status).toBe("undone")
  })

  test("两个都解得开 ⇒ 写完成标记,改名保留;下次启动整段跳过", () => {
    const dirs = bootDirs()
    const keychain = fakePort([PROD_SOURCE])
    const result = boot(dirs, keychain.port)
    if (result.kind !== "ready") throw new Error(`boot: ${JSON.stringify(result)}`)
    runKeychainRenameStep(result.journal, keychain.port, PROD_PLAN)
    expect(settleNamingMigration(result.journal, true, () => ["decrypted", "absent"])).toEqual({ ok: true })
    expect(journalOf(dirs).status).toBe("complete")
    expect(keychain.has(PROD_TARGET)).toBe(true)
    expect(boot(dirs, keychain.port)).toEqual({ kind: "skip", reason: "complete" })
  })

  test("只有目标、没有源(例如清除数据后迁移目录没了)⇒ 正常启动:不登记改名、不自检、完成标记写入", () => {
    const dirs = bootDirs()
    const keychain = fakePort([PROD_TARGET])
    const result = boot(dirs, keychain.port)
    if (result.kind !== "ready") throw new Error(`boot: ${JSON.stringify(result)}`)
    expect(runKeychainRenameStep(result.journal, keychain.port, PROD_PLAN)).toBe(false)
    expect(settleNamingMigration(result.journal, false, () => ["failed"])).toEqual({ ok: true })
    expect(journalOf(dirs)).toMatchObject({ status: "complete", steps: [] })
    expect(keychain.renames()).toEqual([])
    expect(keychain.has(PROD_TARGET)).toBe(true)
  })

  test("源条目不存在 ⇒ 不登记、不自检、照样完成", () => {
    const dirs = bootDirs()
    const keychain = fakePort([])
    const result = boot(dirs, keychain.port)
    if (result.kind !== "ready") throw new Error(`boot: ${JSON.stringify(result)}`)
    expect(runKeychainRenameStep(result.journal, keychain.port, PROD_PLAN)).toBe(false)
    let probed = false
    expect(
      settleNamingMigration(result.journal, false, () => {
        probed = true
        return ["failed"]
      }),
    ).toEqual({ ok: true })
    expect(probed).toBe(false)
    expect(journalOf(dirs)).toMatchObject({ status: "complete", steps: [] })
  })

  test("dev ⇒ 迁移整段跳过,预检没跑,端口一次都没被调用", () => {
    const keychain = fakePort([PROD_SOURCE])
    expect(boot(bootDirs(), keychain.port, { environment: "dev" })).toEqual({ kind: "skip", reason: "dev" })
    expect(keychain.calls).toEqual([])
  })

  test("改名步 done 之后被杀 ⇒ 下次启动先按日志改回,再开新一轮", () => {
    const dirs = bootDirs()
    const keychain = fakePort([PROD_SOURCE])
    const first = boot(dirs, keychain.port)
    if (first.kind !== "ready") throw new Error(`boot: ${JSON.stringify(first)}`)
    runKeychainRenameStep(first.journal, keychain.port, PROD_PLAN)
    // 这里进程被杀:日志停在 running,钥匙串已是新名
    const second = boot(dirs, keychain.port)
    expect(second.kind).toBe("ready")
    expect(keychain.renames()).toEqual([
      "rename alpha-code Safe Storage -> Code Puppy Safe Storage",
      "rename Code Puppy Safe Storage -> alpha-code Safe Storage",
    ])
    expect(keychain.has(PROD_SOURCE)).toBe(true)
  })

  test("撤销途中(改名步已 undone)被杀 ⇒ 续撤时不再调用 rename", () => {
    const dirs = bootDirs()
    const keychain = fakePort([PROD_SOURCE])
    let earlierUndoFails = true
    const extraUndo = {
      "test-earlier-step": () => {
        if (earlierUndoFails) throw new Error("killed while undoing")
      },
    }
    const first = boot(dirs, keychain.port, { extraUndo })
    if (first.kind !== "ready") throw new Error(`boot: ${JSON.stringify(first)}`)
    first.journal.step("test-earlier-step", null, () => {})
    runKeychainRenameStep(first.journal, keychain.port, PROD_PLAN)
    const rollback = rollBackNamingMigration(first.journal)
    expect(rollback.undone).toBe(false)
    expect(rollback.text).toContain(join(dirs.userData, MIGRATION_DIR))
    expect(journalOf(dirs).steps.map((step) => step.state)).toEqual(["done", "undone"])
    const renamesBefore = keychain.renames().length
    earlierUndoFails = false
    expect(boot(dirs, keychain.port, { extraUndo }).kind).toBe("ready")
    expect(keychain.renames().length).toBe(renamesBefore)
    expect(keychain.has(PROD_SOURCE)).toBe(true)
  })
})
