// 首页右栏(desktop-ui-refresh BR-05,冻结稿 #home-right-panel;owner U-02)。
//
// 首页还没有对话,右栏只给当前项目(未选时就是默认工作区)的「文件」「终端」两页;「审查」「产物」
// 进了对话才出现。页签条、文件视图、终端视图全部是会话页右栏的同一套 —— 本文件只做首页的接线:
// 项目身份(sessionID 为空)、目录绑定的终端 provider、文件面板的无会话变体。
// 开合读 session-workspace/right-panel-state 的全应用唯一信号(顶栏右侧开关读写它)。
import { createMemo, Show } from "solid-js"
import { sandboxApplied } from "./sandbox-state"
import { HomeRailFiles } from "./session-rail/files/session-rail-files"
import {
  useCodePuppyTerminalEngineChannel,
  WorkspaceTerminalScope,
} from "./session-rail/terminal/terminal-engine-adapter"
import { rightPanelOpen } from "./session-workspace/right-panel-state"
import {
  sameSessionIdentity,
  type CodePuppySessionIdentity,
  type CodePuppySessionLiveSnapshot,
} from "./session-workspace/session-workspace-core"
import { WorkspaceRightPanel, type CodePuppySessionLiveContext } from "./session-workspace/session-workspace-shell"
import "./session-workspace/session-workspace.css"

export function HomeRightPanel(props: { directory: () => string | undefined; serverKey: () => string | undefined }) {
  // 身份只在项目或服务器真的换了才换:快照抖动不重挂文件树 / 终端。
  const identity = createMemo<CodePuppySessionIdentity | undefined>(
    () => {
      const directory = props.directory()
      const serverKey = props.serverKey()
      return directory && serverKey ? { serverKey, directory, sessionID: "" } : undefined
    },
    undefined,
    { equals: (left, right) => (left && right ? sameSessionIdentity(left, right) : left === right) },
  )
  return (
    <Show when={rightPanelOpen() ? identity() : undefined} keyed>
      {(current) => (
        <WorkspaceTerminalScope directory={current.directory}>
          <HomeRail identity={current} />
        </WorkspaceTerminalScope>
      )}
    </Show>
  )
}

function HomeRail(props: { identity: CodePuppySessionIdentity }) {
  const snapshot: CodePuppySessionLiveSnapshot = {
    identity: props.identity,
    project: props.identity.directory,
    title: "",
    activity: "idle",
  }
  const live: CodePuppySessionLiveContext = {
    current: () => snapshot,
    accepts: (candidate) => sameSessionIdentity(candidate, props.identity),
  }
  const terminalChannel = useCodePuppyTerminalEngineChannel(live.current)
  return (
    <WorkspaceRightPanel
      live={live}
      panels={{
        files: (rail) => (
          <HomeRailFiles
            directory={props.identity.directory}
            stillCurrent={() => live.accepts(props.identity)}
            rail={rail}
          />
        ),
      }}
      terminalChannel={terminalChannel}
      sandbox={sandboxApplied}
    />
  )
}
