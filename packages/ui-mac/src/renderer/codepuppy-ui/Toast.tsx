import { createSignal, For, untrack, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { t } from "../i18n"
import {
  backgroundProblem,
  forgetProblem,
  heldProblems,
  leavePageProblems,
  putProblem,
  setBackgroundProblem,
  type ProblemAction,
} from "./problems"
import "./toast.css"

/**
 * codepuppy-ui Toast — a tiny singleton store + viewport for feedback.
 * Mount <ToastViewport/> once near the app root; call pushToast(...) from anywhere.
 * Consumes only --a-* tokens. No external deps; ids come from a counter (no Math.random).
 *
 * 去留规则(SPEC-error-message-lifetime v1,`#1687`;`#1476` 的悬停暂停沿用),全在这一个文件里:
 * - 普通通知(info / success)默认 4 秒自动消失;鼠标停在上面(或键盘焦点在里面)时**暂停**,
 *   离开后按剩余时间继续 —— 用户正在读的那条不会在眼皮底下消失。
 * - 用户操作类报错(`pushToast({ kind: "error" })`,以及 `duration <= 0` 的那些)留到用户按 ×
 *   或离开当前页面(BR-05;离开页面由 `toast-route-follower.tsx` 调 `dismissPageToasts`)。
 *   用 `role="alert"` + `aria-live="assertive"` 立即朗读。
 * - 后台状态类问题(`reportProblem`)显示 8 秒后收起,悬停/聚焦同样暂停;× 与到时都是「收起」,
 *   问题没恢复就仍记为未恢复,同因再报不再弹出;`resolveProblem` = 恢复,提示立即消失(BR-01/02)。
 * - 同一键同一时间只显示一条:再次推送只原地更新文字,不新增、不重新计时(BR-03)。
 * - 收起而未恢复的后台问题进入「未恢复问题」入口(`problems.ts`),已收起的同因再报只更新那一条。
 * - 启动静默(BR-04,`beginStartupQuiet` 由 index.tsx 在启动时调用一次):窗口内后台问题只暂存不弹,
 *   窗口结束仍未恢复的才弹;窗口内的报错与常驻提示(需要用户处理)不弹,直接进入口;确认类照常。
 */
export type ToastKind = "info" | "success" | "error"
/** `persistent` = 这条不自己消失,只能由用户关掉(或离开页面)。它**不是**独立开关:与
 *  「有没有装拆除定时器」由同一个值派生,所以 DOM 上的 `data-persistent` 与真实存活行为
 *  不可能各说各话。`background` = 后台状态类问题的提示(收起不等于问题消失)。 */
export type ToastItem = {
  id: number
  key: string
  kind: ToastKind
  title: string
  detail?: string
  persistent: boolean
  background: boolean
}

/** 普通通知的默认停留时长。 */
export const TOAST_DEFAULT_MS = 4000
/** 后台状态类问题的提示停留时长(BR-02)。 */
export const TOAST_BACKGROUND_MS = 8000
/** 启动静默窗口(BR-04;可回退的默认值)。 */
export const STARTUP_QUIET_MS = 10_000

const [items, setItems] = createSignal<ToastItem[]>([])
let seq = 0
/** 存取函数里读当前列表不订阅:来源常在 effect 里调用 reportProblem / resolveProblem,读列表若被跟踪,
 *  那个 effect 会随每次提示变化重跑。 */
const current = () => untrack(items)

let quiet = false
let quietEnd: Promise<void> = Promise.resolve()

type Timer = { remaining: number; startedAt: number; handle: ReturnType<typeof setTimeout> | undefined }
const timers = new Map<number, Timer>()

function arm(id: number) {
  const timer = timers.get(id)
  if (!timer || timer.handle !== undefined) return
  timer.startedAt = Date.now()
  timer.handle = setTimeout(() => dismissToast(id), timer.remaining)
}

/** 同键已在显示 ⇒ 只更新文字(不新增、不重新计时);否则新增一条,非常驻的装定时器。 */
function show(next: Omit<ToastItem, "id">, ms: number): number {
  const shown = current().find((x) => x.key === next.key)
  if (shown) {
    setItems((xs) => xs.map((x) => (x.id === shown.id ? { ...x, title: next.title, detail: next.detail } : x)))
    return shown.id
  }
  const id = ++seq
  setItems((xs) => [...xs, { ...next, id }])
  if (!next.persistent) {
    timers.set(id, { remaining: ms, startedAt: 0, handle: undefined })
    arm(id)
  }
  return id
}

function remove(id: number) {
  const timer = timers.get(id)
  if (timer?.handle !== undefined) clearTimeout(timer.handle)
  timers.delete(id)
  setItems((xs) => xs.filter((x) => x.id !== id))
}

/**
 * 用户操作的结果与确认。是否常驻只由一个值决定:`error` 一律常驻;其余 `duration <= 0` 常驻,否则按
 * `duration`(缺省 4 秒)自走。同一种类、同一文字的通知同一时间只有一条。
 */
export function pushToast(t: {
  kind?: ToastKind
  title: string
  detail?: string
  duration?: number
  /** 静默窗口内进入口时,条目上的操作(该问题现有的处理入口)。提示本身不显示它。 */
  action?: ProblemAction
}): number {
  const kind = t.kind ?? "info"
  const ms = t.duration ?? TOAST_DEFAULT_MS
  const persistent = kind === "error" || ms <= 0
  const key = `toast\0${kind}\0${t.title}\0${t.detail ?? ""}`
  if (quiet && persistent) {
    putProblem({ key, title: t.title, detail: t.detail, action: t.action, attention: true })
    return 0
  }
  return show({ key, kind, title: t.title, detail: t.detail, persistent, background: false }, ms)
}

/**
 * 后台状态引起的问题(来源 + 原因 = `key`)。第一次报告弹出 8 秒;正在显示时再报只更新文字;
 * 提示已收起而问题未恢复时再报不弹出。
 */
export function reportProblem(p: {
  key: string
  kind?: ToastKind
  title: string
  detail?: string
  /** 入口条目上的操作(该问题现有的处理入口,如「重试」)。 */
  action?: ProblemAction
}): void {
  const text = { title: p.title, detail: p.detail, action: p.action }
  const kind = p.kind ?? "error"
  const known = backgroundProblem(p.key)
  if (known?.phase === "folded") {
    setBackgroundProblem(p.key, { ...known, text })
    putProblem({ key: p.key, ...text, attention: false })
    return
  }
  setBackgroundProblem(p.key, { phase: quiet && known?.phase !== "shown" ? "held" : "shown", kind, text })
  if (quiet && known?.phase !== "shown") return
  showBackground(p.key, kind, text)
}

function showBackground(key: string, kind: ToastKind, text: { title: string; detail?: string }) {
  show({ key, kind, title: text.title, detail: text.detail, persistent: false, background: true }, TOAST_BACKGROUND_MS)
}

/** 问题恢复:正在显示的提示立即消失,入口里的那条随之移除。 */
export function resolveProblem(key: string): void {
  forgetProblem(key)
  const shown = current().find((x) => x.background && x.key === key)
  if (shown) remove(shown.id)
}

/** 启动静默窗口开始(index.tsx 启动时调用一次)。窗口结束时仍未恢复的暂存问题各弹一条。 */
export function beginStartupQuiet(): void {
  quiet = true
  quietEnd = new Promise((resolve) =>
    setTimeout(() => {
      quiet = false
      for (const [key, held] of heldProblems()) {
        setBackgroundProblem(key, { ...held, phase: "shown" })
        showBackground(key, held.kind, held.text)
      }
      resolve()
    }, STARTUP_QUIET_MS),
  )
}

/** 静默窗口结束(没开过窗口则立即)。来源据此把启动期的读取推迟到窗口之后(工具服务连接,`#1687` v2)。 */
export function startupQuietEnded(): Promise<void> {
  return quietEnd
}

/** 暂停自动消失(悬停 / 焦点进入)。常驻通知没有定时器,调用是空操作。 */
export function pauseToast(id: number): void {
  const timer = timers.get(id)
  if (!timer || timer.handle === undefined) return
  clearTimeout(timer.handle)
  timer.handle = undefined
  timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt))
}

/** 按剩余时间继续(悬停 / 焦点离开)。 */
export function resumeToast(id: number): void {
  arm(id)
}

/** 关闭一条(× 或到时)。后台问题的提示关闭 = 收起:问题没恢复就进入「未恢复问题」入口。 */
export function dismissToast(id: number): void {
  const item = current().find((x) => x.id === id)
  remove(id)
  const problem = item?.background ? backgroundProblem(item.key) : undefined
  if (!item || !problem) return
  setBackgroundProblem(item.key, { ...problem, phase: "folded" })
  putProblem({ key: item.key, ...problem.text, attention: false })
}

/** 离开当前页面:用户操作类的常驻提示随之关闭(BR-05),入口里没有操作可做的需要用户处理项同样离开。
 *  后台问题与自走的确认不受影响。 */
export function dismissPageToasts(): void {
  for (const item of current()) if (item.persistent && !item.background) remove(item.id)
  leavePageProblems()
}

export function ToastViewport(): JSX.Element {
  return (
    <Portal>
      <div class="a-toast-viewport a-ui">
        <For each={items()}>
          {(toast) => (
            <div
              class="a-toast"
              data-kind={toast.kind}
              data-persistent={toast.persistent ? "true" : undefined}
              role={toast.kind === "error" ? "alert" : "status"}
              aria-live={toast.kind === "error" ? "assertive" : "polite"}
              onMouseEnter={() => pauseToast(toast.id)}
              onMouseLeave={() => resumeToast(toast.id)}
              onFocusIn={() => pauseToast(toast.id)}
              onFocusOut={() => resumeToast(toast.id)}
            >
              <span class="a-toast-ico" aria-hidden="true" />
              <div class="a-toast-body">
                <b>{toast.title}</b>
                {toast.detail ? <small>{toast.detail}</small> : null}
              </div>
              <button class="a-toast-x" aria-label={t("codepuppy.common.close")} onClick={() => dismissToast(toast.id)}>
                ×
              </button>
            </div>
          )}
        </For>
      </div>
    </Portal>
  )
}
