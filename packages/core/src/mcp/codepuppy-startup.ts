/**
 * Code Puppy's MCP startup rules on OpenCode 2 (#1563, #1572; #1662 L4 ruling item 5). Used by the re-taken
 * `client.ts` (classification at the source), `connection.ts` (start concurrency) and `index.ts` (background
 * reconnect). One definition of each rule; the re-taken files only call it.
 *
 *   · AC2  a start that fails names its cause: workspace_missing / dependency_missing / spawn_failed for a local
 *          server, handshake_timeout, auth, protocol, or the network layer Code Puppy's classifier attributes
 *          (packages/schema/src/codepuppy-net-failure.ts) for a remote one; `transport` when no layer is attributed.
 *   · AC3  a failed remote server reconnects in the background after 30 s, doubling per consecutive failure up to
 *          10 min, reset by a success. Deterministic answers another attempt will not change (auth, policy,
 *          tls-cert, http 4xx, protocol) and every local failure stay failed.
 *   · AC5  at most four servers start (spawn or connect, handshake, tools/list) at once, across every Location.
 */
import { Semaphore } from "effect"
import { PlatformError } from "effect"
import { classifyNetFailure, engineNetFailurePath, type CodepuppyFailureCode } from "@opencode/schema/codepuppy-net-failure"

export const START_CONCURRENCY = 4
/** Shared by every Location in the process, like v1's instance-wide limit. */
export const startPermits = Semaphore.makeUnsafe(START_CONCURRENCY)

export const RECONNECT_BASE_MS = 30_000
export const RECONNECT_CAP_MS = 600_000

/** Delay before the background reconnect that follows the `failures`-th consecutive failure (1-based). */
export const reconnectDelay = (failures: number) =>
  Math.min(RECONNECT_BASE_MS * 2 ** Math.max(0, failures - 1), RECONNECT_CAP_MS)

export interface StartFailure {
  /** A registered code: index.ts prefixes the failed status with it, and the desktop reads it back (#1564). */
  readonly code: CodepuppyFailureCode
  readonly reconnect: boolean
}

const RECONNECT_CODES = new Set([
  "transport",
  "dns",
  "tcp",
  "connect-timeout",
  "tls-silent",
  "tls-failed",
  "timeout",
  "handshake_timeout",
])

/**
 * Names why a connection attempt failed. `hints` carries what only the MCP client module can tell from its own
 * error classes: whether the SDK timed out waiting for the server, and the HTTP status a remote server answered.
 */
export function classifyStartFailure(
  error: unknown,
  config: { readonly type: string; readonly url?: string },
  hints: { readonly timedOut?: boolean; readonly httpStatus?: number } = {},
  env: Record<string, string | undefined> = process.env,
): StartFailure {
  const remote = config.type === "remote"
  if (hints.timedOut) return { code: "handshake_timeout", reconnect: remote }
  if (!remote) {
    if (PlatformError.isPlatformError(error) && error.reason._tag === "NotFound") {
      // The spawner checks the working directory (FileSystem.access) before it spawns the command.
      if (error.reason.module === "FileSystem") return { code: "workspace_missing", reconnect: false }
      if (error.reason.module === "ChildProcess") return { code: "dependency_missing", reconnect: false }
    }
    return { code: "spawn_failed", reconnect: false }
  }
  if (hints.httpStatus === 401 || hints.httpStatus === 403) return { code: "auth", reconnect: false }
  if (hints.httpStatus !== undefined) return { code: "http", reconnect: hints.httpStatus >= 500 }
  const net = classifyNetFailure(error, engineNetFailurePath(config.url, env))
  if (!net) return { code: "transport", reconnect: true }
  return { code: net.layer, reconnect: RECONNECT_CODES.has(net.layer) || (net.layer === "http" && Number(net.code) >= 500) }
}
