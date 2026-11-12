// 未恢复问题仓(SPEC-error-message-lifetime v1 BR-02/BR-04,`#1687`)。
//
// 两份记录:
// - `background`:后台状态类问题的去留阶段(静默窗口内暂存 / 提示正在显示 / 已收进入口)与最新文字。
//   只由 Toast.tsx 的 `reportProblem` / `resolveProblem` / 提示关闭驱动 —— 来源只调那两个公开入口。
// - 入口列表(信号):侧栏底部「N 个问题未恢复」与它的弹层读这一份。后台问题收起时进来、恢复时离开;
//   需要用户处理的项(静默窗口内产生的报错与扩展警告)直接进来,用户做了它的操作即离开,
//   没有操作的随离开当前页面离开(BR-05)。**没有删除接口**:条目不能手动删掉。
import { createSignal } from "solid-js"

/** 条目上的操作:`label` 是已翻译的按钮文字,`run` 是该问题现有的处理入口。 */
export type ProblemAction = { label: string; run: () => void }
export type ProblemText = { title: string; detail?: string; action?: ProblemAction }
/** `attention` = 需要用户处理的项(做了操作即离开);否则是后台问题(恢复才离开)。 */
export type Problem = ProblemText & { key: string; attention: boolean }

type Phase = "held" | "shown" | "folded"
export type BackgroundProblem = { phase: Phase; kind: "info" | "success" | "error"; text: ProblemText }

const background = new Map<string, BackgroundProblem>()
const [entry, setEntry] = createSignal<Problem[]>([])

/** 入口里的未恢复问题(按进入先后)。 */
export function unresolvedProblems(): Problem[] {
  return entry()
}

export function backgroundProblem(key: string): BackgroundProblem | undefined {
  return background.get(key)
}

export function setBackgroundProblem(key: string, value: BackgroundProblem): void {
  background.set(key, value)
}

/** 静默窗口结束时还在暂存的后台问题。 */
export function heldProblems(): Array<[string, BackgroundProblem]> {
  return [...background].filter(([, value]) => value.phase === "held")
}

/** 加入或原地更新入口里的一条(同键只计 1)。 */
export function putProblem(problem: Problem): void {
  setEntry((xs) => (xs.some((x) => x.key === problem.key) ? xs.map((x) => (x.key === problem.key ? problem : x)) : [...xs, problem]))
}

/** 问题恢复:两份记录都清掉。 */
export function forgetProblem(key: string): void {
  background.delete(key)
  setEntry((xs) => xs.filter((x) => x.key !== key))
}

/** 入口条目上的操作被点:跑它的处理入口;需要用户处理的项随之离开,后台问题等恢复。 */
export function takeProblemAction(key: string): void {
  const problem = entry().find((x) => x.key === key)
  if (!problem?.action) return
  problem.action.run()
  if (problem.attention) setEntry((xs) => xs.filter((x) => x.key !== key))
}

/** 离开当前页面:没有操作可做的需要用户处理项离开入口(与它们本该显示的提示同一去留,BR-05)。 */
export function leavePageProblems(): void {
  setEntry((xs) => xs.filter((x) => !x.attention || x.action))
}
