// #1686(DESIGN-cloud-job-form-preflight §4.4;批准稿 docs/design/2026-11-13-1686-cloud-form-preflight-r3/)
// 两种云发送框共用的提交前预检区:一张「卡片 + 名称 — 值列表」写账户事实,一条 Banner 写这项任务现在能不能发。
// 只作提示 —— 不禁用、不延迟提交;真正的准入在派发时由平台再判一次。
//
// 取数时机:登录现值每送达一次(含挂载后的首值,即「打开时取一次」;换号 / 登出也走这里)就清空重取;每次派发
// 请求返回后由宿主调 `refresh()`;窗口重新获得焦点且上次结果超过 30 秒时重取。不轮询、不持久化。
// 乱序:本表单内递增序号,只采用「当前任务 + 最新序号」的回复;旧序号的回复(含主进程的 identity-changed)丢弃。

import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { t } from "../i18n"
import { Banner } from "../codepuppy-ui/Banner"
import { Card } from "../codepuppy-ui/Card"
import { KeyValueList, type KeyValueRow } from "../codepuppy-ui/KeyValueList"
import { subscribeAuthState } from "../auth-recovery"
import type { CloudAccountStatus } from "../../preload/types"
import { failureCopy } from "./cloud-failure-copy"
import { dispatchError } from "./cloud-job-lifecycle"

/** 焦点刷新的新鲜度门槛(设计 §4.4「取数时机」;表单内常量,不是配置)。 */
export const PREFLIGHT_STALE_MS = 30_000

type PreflightView =
  | { kind: "off" } // 表单未就绪:不请求、不显示
  | { kind: "loading" }
  | { kind: "ready"; body: CloudAccountStatus }
  | { kind: "signed-out" }
  | { kind: "refused-kind"; code: string }
  | { kind: "unavailable" }

/**
 * 决定点 D1(plan.md,待 owner):拒绝码在现有文案权威里没有对应时怎么办。批准稿:只显示卡片、不下结论 ——
 * 返回 null。owner 若选通用句,改成 `failureCopy(code) ?? { text: t(<新键>), action: null }` 这一行。
 * 今天可达的只有 `route_usage_stopped`。
 */
const refusalCopy = (code: string) => failureCopy(code)

const yuan = (fen: number) => (fen / 100).toFixed(2)

export function createCloudPreflight(input: { task: () => string; ready: () => boolean }) {
  const [view, setView] = createSignal<PreflightView>({ kind: "off" })
  // 忙时卡片保留最近一次结果(设计状态表 busy 行)。只在同一个登录里保留:每次登录现值送达都清掉。
  const [last, setLast] = createSignal<CloudAccountStatus | undefined>()
  let seq = 0
  let inFlight = false
  let appliedAt = 0

  const fetchNow = () => {
    if (!input.ready()) return
    const mine = ++seq
    const task = input.task()
    inFlight = true
    setView({ kind: "loading" })
    void window.api.cloud.accountStatus(task).then((result) => {
      if (mine !== seq || task !== input.task() || !input.ready()) return
      inFlight = false
      if ("error" in result) {
        // 请求在途时换了号:主进程已丢掉上一个账号的结果。不在这里自己重取(那会和主进程互相追成循环),
        // 停在「…」等登录现值送达 —— 换号必发 auth-state(main 签名带账号标记),送达时清空并按新身份重取。
        if (result.error === "identity-changed") return
        appliedAt = Date.now()
        if (result.error === "not-authenticated" || result.error === "unauthorized") return setView({ kind: "signed-out" })
        if (result.error === "pipeline_kind_retired" || result.error === "unknown_pipeline_kind")
          return setView({ kind: "refused-kind", code: result.error })
        return setView({ kind: "unavailable" })
      }
      appliedAt = Date.now()
      setLast(result)
      setView({ kind: "ready", body: result })
    })
  }

  const clear = () => {
    seq++
    inFlight = false
    setLast(undefined)
    setView({ kind: "off" })
  }

  createEffect(() => {
    if (!input.ready()) return clear()
    // 每次送达都清空重取(设计 §4.4「身份变化与乱序」):上一个账号的数不会留在新账号的界面上。
    const release = subscribeAuthState(() => {
      clear()
      fetchNow()
    })
    onCleanup(() => {
      release()
      clear()
    })
  })

  // 任务换了(同一个组件换条目):旧回复按「当前任务」丢弃,并为新任务重取。
  let previousTask = input.task()
  createEffect(() => {
    const task = input.task()
    if (task === previousTask) return
    previousTask = task
    setLast(undefined)
    fetchNow()
  })

  const onFocus = () => {
    if (!input.ready() || inFlight || Date.now() - appliedAt <= PREFLIGHT_STALE_MS) return
    fetchNow()
  }
  window.addEventListener("focus", onFocus)
  onCleanup(() => window.removeEventListener("focus", onFocus))

  return {
    view,
    last,
    /** 宿主在每次派发请求返回后调用(受理或拒绝)。 */
    refresh: fetchNow,
    /** 目录表单原来那行「预留 US$…」:只在查不到、或表单未就绪(不请求)时保留。 */
    showsLegacyHold: () => view().kind === "off" || view().kind === "unavailable",
  }
}

export type CloudPreflight = ReturnType<typeof createCloudPreflight>

function accountRows(body: CloudAccountStatus): KeyValueRow[] {
  const { plan, wallet, wallet_overflow } = body.account
  const credits = (w: { remaining_credits: number; limit_credits: number }) =>
    `${w.remaining_credits.toLocaleString()} / ${w.limit_credits.toLocaleString()}`
  return [
    { label: t("codepuppy.sidebar.balance"), value: `¥${yuan(wallet.available_fen)}` },
    ...(plan.status === "active" && plan.window5h ? [{ label: t("codepuppy.sidebar.fiveHour"), value: credits(plan.window5h) }] : []),
    ...(plan.status === "active" && plan.window7d ? [{ label: t("codepuppy.sidebar.sevenDay"), value: credits(plan.window7d) }] : []),
    {
      label: t("codepuppy.ext.preflightOverflow"),
      value: t(wallet_overflow ? "codepuppy.ext.preflightOn" : "codepuppy.ext.preflightOff"),
    },
  ]
}

const PENDING_ROWS = (): KeyValueRow[] => [
  { label: t("codepuppy.sidebar.balance"), state: "pending" },
  { label: t("codepuppy.sidebar.fiveHour"), state: "pending" },
  { label: t("codepuppy.sidebar.sevenDay"), state: "pending" },
  { label: t("codepuppy.ext.preflightOverflow"), state: "pending" },
]

/** 预留句:只在按用量结算(estimate 不可估)且有首步预留时写;写成预留,不写成报价。 */
function holdSentence(body: CloudAccountStatus) {
  const task = body.task
  if (!task?.reserve || task.estimate.available) return undefined
  return t("codepuppy.ext.preflightHold", { yuan: yuan(task.reserve.hold_fen) })
}

function runAction(action: "login" | "recharge" | "overflow") {
  if (action === "login") return void window.api.auth.start()
  void window.api.cloud.openBillingPage(action)
}

const actionLabel = (action: "login" | "recharge" | "overflow") =>
  t(action === "login" ? "codepuppy.ext.cloudGoLogin" : action === "recharge" ? "codepuppy.ext.cloudGoRecharge" : "codepuppy.ext.cloudOpenOverflow")

/** 卡片 + 提示条,作为宿主容器里的两个兄弟节点渲染(批准稿的结构)。 */
export function CloudPreflightArea(props: { preflight: CloudPreflight; busy: boolean }) {
  const rows = (): KeyValueRow[] | undefined => {
    const view = props.preflight.view()
    if (props.busy) {
      const last = props.preflight.last()
      if (last) return accountRows(last)
      return view.kind === "loading" ? PENDING_ROWS() : undefined
    }
    if (view.kind === "loading") return PENDING_ROWS()
    if (view.kind === "ready") return accountRows(view.body)
    return undefined
  }

  const banner = () => {
    if (props.busy) return undefined
    const view = props.preflight.view()
    if (view.kind === "signed-out") {
      const copy = failureCopy("unauthorized")!
      return { kind: "warning" as const, title: t("codepuppy.ext.preflightBlocked"), detail: copy.text, action: copy.action }
    }
    if (view.kind === "refused-kind")
      return { kind: "warning" as const, title: t("codepuppy.ext.preflightBlocked"), detail: dispatchError(view.code), action: null }
    if (view.kind !== "ready") return undefined
    const admission = view.body.task?.admission
    if (!admission) return undefined
    if (admission.ok)
      return { kind: "success" as const, title: t("codepuppy.ext.preflightReady"), detail: holdSentence(view.body), action: null }
    const copy = admission.code ? refusalCopy(admission.code) : null
    if (!copy) return undefined
    return {
      kind: "warning" as const,
      title: t("codepuppy.ext.preflightBlocked"),
      detail: copy.text,
      more: admission.code === "account_wallet_insufficient" ? holdSentence(view.body) : undefined,
      action: copy.action,
    }
  }

  return (
    <>
      <Show when={rows()}>
        {(list) => (
          <Card label={t("codepuppy.ext.preflightAccount")}>
            <KeyValueList rows={list()} />
          </Card>
        )}
      </Show>
      <Show when={banner()}>
        {(b) => (
          <Banner
            kind={b().kind}
            title={b().title}
            detail={b().detail}
            action={b().action ? { label: actionLabel(b().action!), onClick: () => runAction(b().action!) } : undefined}
          >
            <Show when={"more" in b() && b().more}>{(more) => <span class="a-banner-detail">{more()}</span>}</Show>
          </Banner>
        )}
      </Show>
    </>
  )
}
