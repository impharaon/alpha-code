// #1739:账户状态(订阅 / 余额 / 5 小时与 7 日用量)在渲染层只有这一份。账户面板、模型选择器、输入框(能否用平台模型)
// 都读它;取值只走 `readAccountSummary`(三处原来各取各的,谁取到谁自己知道,别人要等下一次登录事件)。
//
// 取值时刻(SPEC-account-balance-presentation BR-04):登录身份变化时各消费方自己的首取(保持原样)、回到应用窗口时
// (距上次取值超过 30 秒)、打开账户面板时、一轮对话结束后。不轮询、不持久化。
// 失败:只有成功的回复才会成为共享现值;失败保留上一次的内容,不清空、不报错。
// 换号:侧栏在登录身份变化 / 登出时调 `clearAccountSummary`,代号前进 —— 较早发出、较晚回来的回复(可能属于上一个账号)
// 不再写进共享现值(消费方自己那一份回复照旧自己处理,#1686)。

import { createSignal } from "solid-js"
import type { AccountSummary } from "../preload/types"

/** 回到应用窗口时「上次取值已经太旧」的门槛;语义同云任务表单预检区的焦点刷新(cloud-preflight.tsx)。 */
export const ACCOUNT_SUMMARY_STALE_MS = 30_000

const [shared, setShared] = createSignal<AccountSummary | null>(null)
/** 当前账号最近一次成功取到的账户状态;未取到 / 已登出 / 换号后为 null。 */
export const accountSummary = shared

let generation = 0
/** 上次发出取值的时刻;失败的取值不算数(下次回到窗口照样取)。 */
let requestedAt: number | undefined

const isSummary = (result: unknown): result is AccountSummary =>
  !!result && typeof result === "object" && !("error" in result)

let watchingFocus = false

/** 渲染层里唯一调 `window.api.account.summary()` 的地方。原样返回回复;成功的回复同时成为共享现值。 */
export function readAccountSummary() {
  if (!watchingFocus) {
    // 回到应用窗口(付款回来的那一下)由本模块自己盯,随应用一直在,不挂在某个组件上。
    watchingFocus = true
    window.addEventListener("focus", refreshAccountSummaryIfStale)
  }
  const mine = generation
  requestedAt = Date.now()
  return window.api.account.summary().then(
    (result) => {
      if (isSummary(result)) {
        if (mine === generation) setShared(result)
      } else if (mine === generation) requestedAt = undefined
      return result
    },
    (error) => {
      if (mine === generation) requestedAt = undefined
      throw error
    },
  )
}

/** 登出或换号:丢掉上一个账号的数,并让仍在途的取值不再写进共享现值。 */
export function clearAccountSummary() {
  generation++
  requestedAt = undefined
  setShared(null)
}

/** 打开账户面板 / 一轮对话结束:现在就取。失败静默(保留已显示的内容)。 */
export function refreshAccountSummary() {
  void readAccountSummary().catch(() => {})
}

/** 回到应用窗口:距上次取值超过 30 秒才取。 */
export function refreshAccountSummaryIfStale() {
  if (requestedAt !== undefined && Date.now() - requestedAt <= ACCOUNT_SUMMARY_STALE_MS) return
  refreshAccountSummary()
}

/** 测试用:清空共享现值与取值记录。 */
export function resetAccountSummaryForTests() {
  clearAccountSummary()
}
