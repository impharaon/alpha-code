// DESIGN-local-plugin-install §4.16 (BR-27): a marketplace `source: command` entry is located by running its declared command once,
// when the user chose that entry. This is source location, not package code: main starts one locator process that is fenced before any
// lookup code runs (`sandbox-exec` with the same CF/C1 rules and N1/N4 egress as the engine fence) and gets an environment built from
// nothing. No confirmation, rerun, ASCII/size/location rule is added here: the official extras are not authorised by the spec (§10).

import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute } from "node:path"
import type { CommandPluginSource } from "../shared/host-extension-package-contract/plugin-package"
import { sourceCommandFailure } from "../shared/plugin-install"
import { sanitizeTransportError } from "./codepuppy-artifact-download"
import { commandSourceFence, locatedFiles } from "./plugin-command-fence"
import { sidecarEgressProxyEnv } from "./sidecar-env"

export { configureCommandSourceFence } from "./plugin-command-fence"

const SANDBOX_EXEC = "/usr/bin/sandbox-exec"
// Robustness bound on captured output, not a protocol limit: a locator prints one path.
const OUTPUT_MAX_BYTES = 1024 * 1024
// setTimeout's largest delay; a longer declared timeout would otherwise fire at once.
const TIMER_MAX_MS = 2 ** 31 - 1

/**
 * Run the declared command once (until then nothing runs: server.ts configures the fence after planning) and return the real path
 * of the plugin directory it printed. A rejection's message is the user-facing source error: the sanitized command and what happened.
 */
export async function locateCommandSource(source: CommandPluginSource): Promise<string> {
  const fail = (reason: string) => new Error(sourceCommandFailure(sanitizeTransportError(source.command), reason))
  const fence = commandSourceFence()
  if (process.platform !== "darwin" || !fence) throw fail("could not run: the process fence for source commands is not ready")
  const home = homedir()
  const env: Record<string, string> = {
    ...Object.fromEntries((["PATH", "LANG", "TMPDIR"] as const).flatMap(name => process.env[name] ? [[name, process.env[name]!]] : [])),
    HOME: home,
    ...Object.fromEntries(Object.entries(sidecarEgressProxyEnv(fence.egressProxyPort)).filter(([name]) => /^(?:http|https|all)_proxy$/i.test(name))),
  }
  const run = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean; error?: Error }>((resolve) => {
    const child = spawn(SANDBOX_EXEC, ["-p", fence.profile, "/bin/sh", "-c", source.command], { cwd: home, env, stdio: ["ignore", "pipe", "pipe"], detached: true })
    const output = { stdout: [] as Buffer[], stderr: [] as Buffer[] }
    const collect = (name: "stdout" | "stderr") => (chunk: Buffer) => {
      if (output[name].reduce((size, part) => size + part.length, 0) < OUTPUT_MAX_BYTES) output[name].push(chunk)
    }
    child.stdout.on("data", collect("stdout"))
    child.stderr.on("data", collect("stderr"))
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      // The shell may have started its own children; the whole locator group goes.
      try { process.kill(-child.pid!, "SIGKILL") } catch { child.kill("SIGKILL") }
    }, Math.min(source.timeoutSeconds * 1000, TIMER_MAX_MS))
    const text = (parts: Buffer[]) => Buffer.concat(parts).toString("utf8")
    child.once("error", (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout: "", stderr: "", timedOut, error }) })
    child.once("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout: text(output.stdout), stderr: text(output.stderr), timedOut }) })
  })
  const stderr = run.stderr.trim() ? ": " + sanitizeTransportError(run.stderr.trim()) : ""
  if (run.error) throw fail("could not start: " + sanitizeTransportError(run.error.message))
  if (run.timedOut) throw fail(`did not finish within ${source.timeoutSeconds} seconds` + stderr)
  if (run.code !== 0) throw fail(`exited with ${run.code ?? run.signal}` + stderr)
  // Official protocol: exactly one line on stdout, one trailing newline allowed; nothing is guessed from other lines or stderr.
  const printed = run.stdout.endsWith("\n") ? run.stdout.slice(0, -1) : run.stdout
  if (!printed || printed.includes("\n")) throw fail("did not print exactly one line with the plugin directory")
  if (!isAbsolute(printed)) throw fail(`printed "${sanitizeTransportError(printed)}", which is not an absolute path`)
  const resolved = await realpath(printed).catch(() => undefined)
  const directory = resolved && (await stat(resolved).catch(() => undefined))?.isDirectory() ? resolved : undefined
  if (!directory) throw fail(`printed "${sanitizeTransportError(printed)}", which is not a directory`)
  if (!(await access(directory, constants.R_OK | constants.X_OK).then(() => true, () => false))) throw fail(`printed "${sanitizeTransportError(printed)}", which is not readable`)
  if (!locatedFiles().listable(directory)) throw fail(`printed "${sanitizeTransportError(printed)}", which is a credential store`)
  return directory
}
