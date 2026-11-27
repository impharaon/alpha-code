import type { Opts, Proc } from "../../core/src/pty/pty"
import { projectPackageManagerEnvironment } from "../src/shared/package-manager-environment"

export type { Disp, Exit, Opts, Proc } from "../../core/src/pty/pty"

// Loaded only by the engine's lazy #pty import; the upstream adapter owns the native binding and ABI.
const nativePty = await import("../../core/src/pty/pty.node")

export function spawn(file: string, args: string[], options: Opts): Proc {
  return nativePty.spawn(file, args, { ...options, env: projectPackageManagerEnvironment(options.env) })
}
