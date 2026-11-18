import type { ParentProps } from "solid-js"
import { SDKProvider } from "@/context/sdk"
import { TerminalProvider } from "@/context/terminal"

// Alpha narrow surface (ADR-027 revision, desktop-ui-refresh BR-05): the home right panel has a
// project but no session, so no session leaf wraps it. This is the same two providers the
// session leaf uses (directory SDK + workspace-scoped PTY state), bound to one directory —
// terminals opened here are the workspace's terminals, shared with that project's sessions.
export function WorkspaceTerminalProvider(props: ParentProps<{ directory: string }>) {
  return (
    <SDKProvider directory={props.directory}>
      <TerminalProvider>{props.children}</TerminalProvider>
    </SDKProvider>
  )
}
