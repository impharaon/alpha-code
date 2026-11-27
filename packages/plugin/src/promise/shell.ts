import type { Hooks } from "./registration.js"
import type { Shell } from "@opencode/schema/shell"

export interface ShellCapture {
  readonly id: Shell.ID
  readonly phase: "start" | "chunk" | "end"
  readonly file: string
  readonly withheld: boolean
  readonly bytes: Uint8Array
  readonly publish: (chunk: Uint8Array) => Promise<void>
  disposition: "hold" | "withhold" | "replace"
  replacement?: { file: string; size: number; newlines: number }
}

export interface ShellCreateBefore {
  command: string
  cwd: string
  timeout: number
  shell: string
  env: Record<string, string | undefined>
}

export interface ShellHooks {
  readonly "create.before": ShellCreateBefore
  readonly capture: ShellCapture
}

export interface ShellDomain {
  readonly hook: Hooks<ShellHooks>
}
