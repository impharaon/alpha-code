import type { QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { CodePuppyTerminalEngineChannel } from "../session-rail/terminal/terminal-rail-core"
import type { TimelineTurnWait } from "../session-timeline/timeline-model"
import type { WorkspaceWriteProbeResult } from "../../../preload/types"
import { setRightPanelOpen } from "./right-panel-state"
import { SessionQuestionCard } from "./session-question-card"
import { sameSessionIdentity, type CodePuppySessionLiveSnapshot } from "./session-workspace-core"
import {
  SessionWorkspaceShell,
  WorkspaceRightPanel,
  type CodePuppySessionLiveContext,
  type SessionRailPanelRenderers,
} from "./session-workspace-shell"

const initial: CodePuppySessionLiveSnapshot = {
  identity: {
    serverKey: "sidecar",
    directory: "/tmp/workspace",
    sessionID: "ses_idle",
  },
  project: "workspace",
  title: "整理架构说明",
  activity: "idle",
}

const [snapshot, setSnapshot] = createSignal<CodePuppySessionLiveSnapshot | undefined>(initial)
const [reviewCount, setReviewCount] = createSignal<number | undefined>(undefined)
const [terminalRunning, setTerminalRunning] = createSignal(false)
// `#1322`:只读状态(生产由 workspace-writable 投影:只有被围栏的引擎明确回报 denied 才为 true)。
const [workspaceReadonly, setWorkspaceReadonly] = createSignal(false)
/** 生产的原因联合(main 的 workspace-write-probe.ts 经 preload 转出),测试运行时不另抄一份。 */
type ReadonlyReason = NonNullable<WorkspaceWriteProbeResult["reason"]>
const [workspaceReadonlyReason, setWorkspaceReadonlyReason] = createSignal<ReadonlyReason>("not-opened-by-you")
// `#1588` AC4:时间线同一个等待信号(生产由 dock 发布、workspace 持信号)。
const [turnWait, setTurnWait] = createSignal<TimelineTurnWait | undefined>(undefined)

export { render }

function liveContext(): CodePuppySessionLiveContext {
  return {
    current: snapshot,
    accepts: (identity) => sameSessionIdentity(identity, snapshot()?.identity),
  }
}

// #554 焦点交接的 shell 半场取证:假 channel 只记录调用(身份 = 初始快照,过 I8 闸)。
export const terminalChannelCalls: string[] = []

const terminalChannel: CodePuppyTerminalEngineChannel = {
  identity: initial.identity,
  ready: () => true,
  instances: () => [{ id: "pty_1", title: "终端 1", running: false }],
  activeID: () => "pty_1",
  open: (id) => void terminalChannelCalls.push(`open:${id}`),
  close: (id) => void terminalChannelCalls.push(`close:${id}`),
  create: () => void terminalChannelCalls.push("create"),
  requestFocus: (id) => void terminalChannelCalls.push(`requestFocus:${id ?? "active"}`),
  cancelFocus: () => void terminalChannelCalls.push("cancelFocus"),
  footStatus: () => ({ running: false }),
  EngineOutput: (props) => <div data-codepuppy-terminal-engine-output={props.instanceID} />,
}

/** All four lanes present as placeholders: exercises switching, memory, badge, dot, handoff. */
export function SessionWorkspaceHarness() {
  const panels: SessionRailPanelRenderers = {
    review: () => <div data-harness-panel="review" />,
    files: () => <div data-harness-panel="files" />,
    terminal: () => <div data-harness-panel="terminal" />,
    artifacts: () => <div data-harness-panel="artifacts" />,
  }
  return (
    <SessionWorkspaceShell
      live={liveContext()}
      // C7:composer 停靠位走与生产同一条直挂通道(props 传入);harness 用标记桩替代真实
      // SessionComposerDock(后者依赖 ServerSDK/ServerSync 上下文),直挂结构本身被真实断言。
      composer={() => <div data-codepuppy-session-composer-stub />}
      panels={panels}
      railMeta={{ reviewCount, terminalRunning }}
      terminalChannel={() => terminalChannel}
      workspaceReadonly={workspaceReadonly}
      workspaceReadonlyReason={workspaceReadonlyReason}
      turnWait={turnWait}
    />
  )
}

// C21 AC2 的提问卡取证:两道选项标签完全相同的单选题(读屏进第二组必须能听出在答哪道)
// 加一道多选题。提交通道故意缺席(client 返回 undefined)—— 这里要的是键盘与 ARIA 事实。
const option = (label: string) => ({ label, description: "" })
const questionRequest = {
  id: "que_harness",
  sessionID: initial.identity.sessionID,
  questions: [
    { header: "发布", question: "现在就发布吗?", options: [option("是"), option("否")] },
    { header: "回滚", question: "失败时自动回滚吗?", options: [option("是"), option("否")] },
    { header: "范围", question: "包含哪些包?", multiple: true, options: [option("界面"), option("内核")] },
  ],
} as unknown as QuestionRequest

export function SessionQuestionHarness() {
  return (
    <SessionQuestionCard
      request={questionRequest}
      identity={() => initial.identity}
      accepts={() => true}
      client={() => undefined}
    />
  )
}

/**
 * 首页右栏(`WorkspaceRightPanel`):四个页面的渲染器都给齐 —— 只有「文件」「终端」两页能出现,
 * 是右栏自己的页集合在限定,不是靠没给渲染器。
 */
export function WorkspaceRightPanelHarness() {
  return (
    <WorkspaceRightPanel
      live={liveContext()}
      panels={{
        review: () => <div data-harness-panel="review" />,
        files: () => <div data-harness-panel="files" />,
        artifacts: () => <div data-harness-panel="artifacts" />,
      }}
      terminalChannel={() => terminalChannel}
    />
  )
}

/** Mid-state harness: only the given lanes have landed — the rest must fail closed. */
export function SessionWorkspacePartialHarness(props: { panels: SessionRailPanelRenderers }) {
  return <SessionWorkspaceShell live={liveContext()} panels={props.panels} />
}

export function setSessionWorkspaceSnapshot(next: CodePuppySessionLiveSnapshot | undefined) {
  setSnapshot(next)
}

export function setSessionWorkspaceReviewCount(next: number | undefined) {
  setReviewCount(next)
}

export function setSessionWorkspaceTerminalRunning(next: boolean) {
  setTerminalRunning(next)
}

export function setSessionWorkspaceReadonly(next: boolean, reason: ReadonlyReason = "not-opened-by-you") {
  setWorkspaceReadonlyReason(reason)
  setWorkspaceReadonly(next)
}

export function setSessionWorkspaceTurnWait(next: TimelineTurnWait | undefined) {
  setTurnWait(next)
}

export function resetSessionWorkspaceSnapshot() {
  // 右栏默认收起(生产默认);这批用例的前提是「右栏已展开」,个别用例自己验收起/展开。
  setRightPanelOpen(true)
  setSnapshot(initial)
  setTurnWait(undefined)
  setReviewCount(undefined)
  setTerminalRunning(false)
  setWorkspaceReadonly(false)
  terminalChannelCalls.splice(0)
}
