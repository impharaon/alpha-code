import { execFile, spawnSync } from "node:child_process"
import { userInfo } from "node:os"
import { basename, delimiter, isAbsolute, join } from "node:path"
import type { EngineRoots } from "./process-fence-profile"

export type ShellProbeFenceContext = {
  profile: string
  env: Readonly<Record<string, string>>
  roots: EngineRoots & { stateHome: string; engineConfigDirectory: string }
}

const ROOT_KEYS = ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG", "OPENCODE_DB"] as const

/** Every probe/cache merge restores this same trusted snapshot, including absent optional roots. */
export function applyTrustedShellEnvironment(target: NodeJS.ProcessEnv, source: Record<string, string>, context: ShellProbeFenceContext) {
  Object.assign(target, source)
  for (const key of ROOT_KEYS) {
    const value = context.env[key]
    if (value === undefined) delete target[key]
    else target[key] = value
  }
}

const TIMEOUT = 5_000

type Probe = { type: "Loaded"; value: Record<string, string> } | { type: "Timeout" } | { type: "Unavailable" }
type ShellEnvLogger = {
  log: (message: string) => void
}

export type GoInstallTarget = { directory: string; configured: boolean }

/** Native configuration resolution, inside the same tested fence and original command environment. */
export async function queryGoInstallTarget(context: ShellProbeFenceContext, cwd: string, log: (reason: string) => void, signal?: AbortSignal): Promise<GoInstallTarget | null> {
  const query = (args: string[]) => new Promise<string>((resolve, reject) => {
    execFile("/usr/bin/sandbox-exec", ["-p", context.profile, "/bin/sh", "-c", 'exec go "$@"', "go", ...args], {
      cwd, env: { ...context.env, GOTOOLCHAIN: "local", GOTELEMETRY: "off" }, timeout: TIMEOUT, signal, windowsHide: true,
    }, (error, output) => error ? reject(error) : resolve(output))
  })
  try {
    const native: unknown = JSON.parse(await query(["env", "-json", "GOPATH"]))
    const changed: unknown = JSON.parse(await query(["env", "-changed", "-json", "GOBIN"]))
    if (!native || typeof native !== "object" || !("GOPATH" in native) || typeof native.GOPATH !== "string" || !changed || typeof changed !== "object" || Array.isArray(changed)) throw new Error("invalid result")
    const configured = "GOBIN" in changed
    const directory = configured ? changed.GOBIN : join(native.GOPATH.split(delimiter)[0] || "", "bin")
    if (typeof directory !== "string" || !isAbsolute(directory) || (!configured && !isAbsolute(native.GOPATH.split(delimiter)[0] || ""))) throw new Error("invalid directory")
    return { directory, configured }
  } catch {
    log("Go install directory query unavailable")
    return null
  }
}

export function resolveUserShell(envShell: string | undefined, loginShell: string | null | undefined) {
  const resolvedLoginShell = loginShell && loginShell !== "unknown" ? loginShell : undefined
  return envShell || resolvedLoginShell || "/bin/sh"
}

export function getUserShell() {
  try {
    return resolveUserShell(process.env.SHELL, userInfo().shell)
  } catch {
    return resolveUserShell(process.env.SHELL, undefined)
  }
}

export function parseShellEnv(out: Buffer) {
  const env: Record<string, string> = {}
  for (const line of out.toString("utf8").split("\0")) {
    if (!line) continue
    const ix = line.indexOf("=")
    if (ix <= 0) continue
    env[line.slice(0, ix)] = line.slice(ix + 1)
  }
  return env
}

// REQ-047:探测子 shell 只给最小干净 env —— 裸继承 app 自身 env 时,登录 shell 会把继承值随
// `env -0` 原样回吐,被当成「用户 shell 导出的环境」写进缓存并在此后每次启动(含 Finder)套用;
// 批测/终端启动带的会话级隔离与调试变量(CODEPUPPY_ENV_BASE_DIR / CODEPUPPY_GLOBAL_DIR /
// OPENCODE_CONFIG_DIR / CODEPUPPY_CDP…)
// 就此永久腌入,且异步刷新同样继承 → 毒化自续、永不自愈。最小集使缓存语义回归
// 「登录 shell 自己导出什么」;PATH 给系统底座,登录 shell 自会经 /etc/paths + rc 重建。
export function minimalProbeEnv(source: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }
  for (const key of ["HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TERM", "TMPDIR"]) {
    const v = source[key]
    if (typeof v === "string" && v) env[key] = v
  }
  return env
}

function probe(shell: string, mode: "-il" | "-l", context: ShellProbeFenceContext): Probe {
  const fenced = process.platform === "darwin"
  const out = spawnSync(fenced ? "/usr/bin/sandbox-exec" : shell, fenced ? ["-p", context.profile, shell, mode, "-c", "env -0"] : [mode, "-c", "env -0"], {
    stdio: ["ignore", "pipe", "ignore"],
    timeout: TIMEOUT,
    windowsHide: true,
    env: context.env,
    cwd: context.roots.home,
  })

  const err = out.error as NodeJS.ErrnoException | undefined
  if (err) {
    if (err.code === "ETIMEDOUT") return { type: "Timeout" }
    console.log(`[server] Shell env probe failed for ${shell} ${mode}: ${err.message}`)
    return { type: "Unavailable" }
  }

  if (out.status !== 0) {
    console.log(`[server] Shell env probe exited with non-zero status for ${shell} ${mode}`)
    return { type: "Unavailable" }
  }

  const env = parseShellEnv(out.stdout)
  if (Object.keys(env).length === 0) {
    console.log(`[server] Shell env probe returned empty env for ${shell} ${mode}`)
    return { type: "Unavailable" }
  }

  return { type: "Loaded", value: env }
}

export function isNushell(shell: string) {
  const name = basename(shell).toLowerCase()
  const raw = shell.toLowerCase()
  return name === "nu" || name === "nu.exe" || raw.endsWith("\\nu.exe")
}

export function loadShellEnv(shell: string, logger: ShellEnvLogger, context: ShellProbeFenceContext) {
  if (isNushell(shell)) {
    logger.log(`[server] Skipping shell env probe for nushell: ${shell}`)
    return null
  }

  const interactive = probe(shell, "-il", context)
  if (interactive.type === "Loaded") {
    logger.log(`[server] Loaded shell environment with -il (${Object.keys(interactive.value).length} vars)`)
    return interactive.value
  }
  if (interactive.type === "Timeout") {
    logger.log(`[server] Interactive shell env probe timed out: ${shell}`)
    return null
  }

  const login = probe(shell, "-l", context)
  if (login.type === "Loaded") {
    logger.log(`[server] Loaded shell environment with -l (${Object.keys(login.value).length} vars)`)
    return login.value
  }

  logger.log(`[server] Falling back to app environment: ${shell}`)
  return null
}

export function mergeShellEnv(shell: Record<string, string> | null, env: Record<string, string>) {
  return {
    ...shell,
    ...env,
  }
}
