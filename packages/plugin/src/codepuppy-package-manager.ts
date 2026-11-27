/** Desktop prepared-shell delegation. The host owns authorization and the execution plan. */
export type PreparedShellExecution = {
  shellID: string
  sessionID: string
  messageID: string
  callID: string
  command: string
  cwd: string
  shell: string
}

export type ShellPrivateInput = { fd: number; data: Uint8Array }
export type PackageManagerExecutionLease = {
  executionID: string
  nodes: readonly { nodeID: string }[]
  helperService: string
  executionSource: string
  shellPrivateInput: ShellPrivateInput
}
export type PreparedShellDelegate = {
  executionSource: string
  privateInput: ShellPrivateInput
  bindProcess(input: { pid: number }): Promise<void>
  cancel(reason: "cancelled" | "timeout"): Promise<void>
  finish(): Promise<void>
}
