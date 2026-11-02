// ac#1571 —— keychain-name-migration.ts 的单测:假钥匙串端口 + 假迁移日志。
//
// 假日志只实现票面 §3 接口里 `step` / `undoAll` 的语义(先记 pending → apply → done;逆序撤销、跳过 undone、
// pending 也撤),payload 经一次 JSON 往返模拟落盘。与 #1569 真日志的联测留到接线阶段。
// 第 0 步实测的条目对(service / account)在这里写成独立字面量,不从被测模块推导。

import { describe, expect, test } from "bun:test"
import {
  KEYCHAIN_RENAME_STEP,
  KeychainRenameError,
  KeychainTargetExistsError,
  assertKeychainTargetFree,
  keychainItemFor,
  keychainRenameUndo,
  nativeKeychainPort,
  planKeychainRename,
  runKeychainRenameStep,
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

describe("预检:目标已存在 ⇒ 停止、源不变 (AC5)", () => {
  test("目标已存在 ⇒ assertKeychainTargetFree 抛 KeychainTargetExistsError,没有任何改名,两条都原样", () => {
    const keychain = fakePort([PROD_SOURCE, PROD_TARGET])
    expect(() => assertKeychainTargetFree(keychain.port, PROD_PLAN)).toThrow(KeychainTargetExistsError)
    expect(keychain.renames()).toEqual([])
    expect(keychain.has(PROD_SOURCE)).toBe(true)
    expect(keychain.has(PROD_TARGET)).toBe(true)
  })

  test("目标不存在 ⇒ 预检通过", () => {
    expect(() => assertKeychainTargetFree(fakePort([PROD_SOURCE]).port, PROD_PLAN)).not.toThrow()
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
