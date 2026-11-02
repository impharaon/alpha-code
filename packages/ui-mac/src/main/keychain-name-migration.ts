// keychain-name-migration —— #1571:把 Electron safeStorage 的 macOS 钥匙串条目从旧应用名改到新应用名。
//
// 登录文件、BYOK 密钥库和网页 Cookie 都用这条条目里的秘密加密,而条目名跟着 Electron 应用名走:应用名改了、
// 条目不跟着改,新版就找不到它,Chromium 还会另生成一个随机秘密,存量全部解不开。本模块只改条目的
// `svce` / `acct` 两个属性(原生 `SecItemUpdate`,见 native/codepuppy-fence/keychain_rename.c),从不读出秘密。
//
// 第 0 步实测(Electron 42.3.3):条目 = `<应用名> Safe Storage` / `<应用名> Key`(` Key` 后缀来自 Electron 自带
// 补丁;目标若不带它,Electron 会读出秘密复制成新条目再删旧条目)。bundle id 与 CFBundleName 不参与条目选择。
// 第 0b 步实测:改名本身不弹框;目标已存在返回 -25299 且两条都不变。
//
// 迁移是 #1569 迁移日志里的最后一步:预检(源与目标都在 ⇒ 任何数据改动之前就停)→ 会话库步之后登记改名 →
// ready 后对登录文件与 BYOK 密钥库各解密一次 → 全部解得开才写完成标记;任一步失败或解不开 ⇒ 日志逆序撤销,
// 撤销动作就是同一个调用把名字改回去。
// dev 渠道不迁移:今天 dev 与 prod 共用同一条条目,dev 迁移会把 prod 的条目改成 dev 的名字。
// 本模块不 import electron;在启动流程里的位置由 index.ts 决定(顺序闸:keychain-boot-order.test.ts)。

import type { AppEnvironment } from "./codepuppy-environment"
import type { safeStorageBackend } from "./platform"
import type { FenceAddon } from "./process-fence-apply"
import { journalDirectory, type JournalUndo, type NamingMigrationJournal } from "./naming-migration-journal"
import { completeNamingMigration } from "./naming-migration"

export const KEYCHAIN_RENAME_STEP = "keychain-rename"

export type KeychainItem = { service: string; account: string }
/** 也是迁移日志里这一步的 payload:只有名字。 */
export type KeychainRenamePlan = { from: KeychainItem; to: KeychainItem }

/** 改名前 prod / beta 的 Electron 应用名(第 0 步实测的迁移源)。随迁移代码一起删除。 */
export const LEGACY_KEYCHAIN_APP_NAMES = {
  prod: "alpha-code",
  beta: "alpha-code Beta",
} as const

export function keychainItemFor(appName: string): KeychainItem {
  return { service: `${appName} Safe Storage`, account: `${appName} Key` }
}

/** dev 或非钥匙串后端 ⇒ null(不迁移);否则旧名 → `targetAppName`(即传给 app.setName 的那个名字)。 */
export function planKeychainRename(input: {
  environment: AppEnvironment
  backend: ReturnType<typeof safeStorageBackend>
  targetAppName: string
}): KeychainRenamePlan | null {
  if (input.environment === "dev" || input.backend !== "keychain") return null
  return { from: keychainItemFor(LEGACY_KEYCHAIN_APP_NAMES[input.environment]), to: keychainItemFor(input.targetAppName) }
}

/**
 * 改名后对登录文件与 BYOK 密钥库各解密一次的结果(probeStoredAuthDecryption / probeByokVaultDecryption)。
 * 任一为 failed ⇒ 按迁移日志整套撤销(含反向改名)并停止启动;absent / unencrypted 不阻止完成。
 */
export type StoredSecretProbe = "absent" | "unencrypted" | "decrypted" | "failed"

export class KeychainRenameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "KeychainRenameError"
  }
}

export class KeychainTargetExistsError extends KeychainRenameError {
  constructor(readonly target: KeychainItem) {
    super(`钥匙串里已有一条「${target.service}」记录,为避免覆盖,没有改名。请按升级说明处理后重开。`)
    this.name = "KeychainTargetExistsError"
  }
}

export type KeychainPort = {
  exists(item: KeychainItem): boolean
  rename(from: KeychainItem, to: KeychainItem): void
}

/** 原生模块里本模块用到的两个函数(返回 OSStatus);类型的权威是 process-fence-apply.ts 的 FenceAddon。 */
export type KeychainAddon = Pick<FenceAddon, "keychainItemStatus" | "keychainRenameItem">

const ERR_SEC_SUCCESS = 0
const ERR_SEC_ITEM_NOT_FOUND = -25300
const ERR_SEC_DUPLICATE_ITEM = -25299

/**
 * 原生端口。模块在第一次查询或改名时才加载(迁移已完成的启动不加载);加载失败即抛 —— 在预检里就是预检失败。
 * OSStatus 只区分三个:0 成功、-25300 不存在、-25299 目标已存在;其余一律带错误码抛(第 0b 步实测改名不弹框,
 * 「被拒 / 取消 / 不允许交互」到不了,不单列)。
 */
export function nativeKeychainPort(loadAddon: () => KeychainAddon): KeychainPort {
  let addon: KeychainAddon | undefined
  const native = () => (addon ??= loadAddon())
  return {
    exists(item) {
      const status = native().keychainItemStatus(item.service, item.account)
      if (status === ERR_SEC_SUCCESS) return true
      if (status === ERR_SEC_ITEM_NOT_FOUND) return false
      throw new KeychainRenameError(`查询钥匙串记录「${item.service}」失败(错误码 ${status})。`)
    },
    rename(from, to) {
      const status = native().keychainRenameItem(from.service, from.account, to.service, to.account)
      if (status === ERR_SEC_SUCCESS) return
      if (status === ERR_SEC_DUPLICATE_ITEM) throw new KeychainTargetExistsError(to)
      throw new KeychainRenameError(`钥匙串记录「${from.service}」改名为「${to.service}」失败(错误码 ${status})。`)
    },
  }
}

/**
 * 迁移预检:源与目标**都在** ⇒ 抛(不覆盖、不合并),此时还没有任何数据被改动,两条都保持原样。
 * 只有目标、没有源(例如迁移完成后清除过数据,迁移目录没了而新名条目还在)⇒ 不需要改名,不拦 ——
 * 改名步会因源不存在而不登记、不自检,迁移正常完成。
 */
export function assertKeychainTargetFree(port: KeychainPort, plan: KeychainRenamePlan): void {
  if (port.exists(plan.to) && port.exists(plan.from)) throw new KeychainTargetExistsError(plan.to)
}

/**
 * 改名步:会话库步之后、第一个异步边界之前调用。源条目不存在 ⇒ 不登记、返回 false(不改名,也不阻止启动)。
 * 否则登记一步并改名,返回 true;改名抛错原样抛出(该步留在 pending),由调用方按日志整套撤销。
 */
export function runKeychainRenameStep(journal: NamingMigrationJournal, port: KeychainPort, plan: KeychainRenamePlan): boolean {
  if (!port.exists(plan.from)) return false
  journal.step(KEYCHAIN_RENAME_STEP, plan, () => port.rename(plan.from, plan.to))
  return true
}

/**
 * 这一步的撤销动作(`extraUndo["keychain-rename"]`),对「改名只做了一半或根本没做」幂等:
 * 目标在、源不在 ⇒ 改回;源在、目标不在 ⇒ 什么都不做;两条都在或都不在 ⇒ 抛(不知道该留哪条 / 条目丢了)。
 */
export function keychainRenameUndo(port: KeychainPort): JournalUndo {
  return (payload) => {
    const plan = parsePlan(payload)
    const targetExists = port.exists(plan.to)
    const sourceExists = port.exists(plan.from)
    if (targetExists && sourceExists)
      throw new KeychainRenameError(`撤销改名时「${plan.from.service}」与「${plan.to.service}」同时存在,无法判断该保留哪一条。`)
    if (!targetExists && !sourceExists)
      throw new KeychainRenameError(`撤销改名时「${plan.from.service}」与「${plan.to.service}」都不存在。`)
    if (targetExists) port.rename(plan.to, plan.from)
  }
}

/**
 * ready 之后收尾(在任何会打开 Cookie 库的代码之前调用):改过名才跑 `probes`(登录文件、BYOK 密钥库各解密一次);
 * 任一 failed ⇒ 按日志整套撤销(含把钥匙串记录名改回),不写完成标记,返回给用户看的原因;
 * 否则经 #1569 的 completeNamingMigration 写完成标记(写不下去同样返回失败,不抛)。没改名 ⇒ 不自检,直接完成。
 */
export function settleNamingMigration(
  journal: NamingMigrationJournal,
  keychainRenamed: boolean,
  probes: () => readonly StoredSecretProbe[],
): { ok: true } | { ok: false; message: string } {
  if (keychainRenamed && probes().includes("failed")) {
    const rollback = rollBackNamingMigration(journal)
    const retry = rollback.undone ? "重新打开时请在钥匙串授权框里选「始终允许」。" : ""
    return { ok: false, message: `改名后读不出登录信息或 BYOK 密钥(多半是钥匙串授权框没有选「允许」)。${rollback.text}${retry}` }
  }
  return completeNamingMigration(journal)
}

/** 按日志整套撤销,给出接在失败原因后面的那句说明;撤销本身失败时说清迁移日志在哪。 */
export function rollBackNamingMigration(journal: NamingMigrationJournal): { undone: boolean; text: string } {
  try {
    journal.undoAll()
    return { undone: true, text: "已把这次升级的所有改动退回原样。" }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { undone: false, text: `自动撤销没有完成(${reason}),迁移日志在 ${journalDirectory(journal)}。` }
  }
}

function parsePlan(payload: unknown): KeychainRenamePlan {
  const plan = payload as Partial<Record<"from" | "to", unknown>> | null
  if (isItem(plan?.from) && isItem(plan?.to)) return { from: plan.from, to: plan.to }
  throw new KeychainRenameError("迁移日志里的钥匙串改名记录格式不对,无法撤销。")
}

function isItem(value: unknown): value is KeychainItem {
  const item = value as Partial<KeychainItem> | null | undefined
  return typeof item?.service === "string" && typeof item.account === "string"
}
