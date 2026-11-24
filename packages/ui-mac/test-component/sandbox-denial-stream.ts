// The fence hosts' sandbox refusals (engine-config-fence.engine.scenario.test.ts E5, stored-credentials-fence.engine.scenario.test.ts E2 / E5), read live with
// `log stream` while the judged arm runs instead of from the saved log afterwards: the saved log has retention limits, and a machine whose logd
// has stopped keeping kernel messages returns an empty window (measured 2026-11-24: kernel lines visible for about a minute, then gone).
//
// Attached = a refusal this helper provokes itself (a write into its own denied marker directory under sandbox-exec) has come through the
// stream; drained = an end marker provoked after the arm has come through, so every refusal the arm caused before it has been delivered.
// Either one missing within its bound ⇒ throw. The evidence is never «zero» because the stream saw nothing.
// `log stream` admits its own losses with a line of its own (docs/architecture/2026-09-08-derived-process-spawn-paths.md: «Messages dropped
// during live streaming»): any output that is neither a log event nor the «Filtering the log data» header counts as such a loss ⇒ throw —
// a dropped refusal from the engine pid would otherwise read as «zero».
import { spawnSync } from "node:child_process"
import { mkdirSync, realpathSync } from "node:fs"
import { join } from "node:path"

export type StreamedLogEvent = { timestamp: number; message: string }

/** One line of `log stream --style ndjson` output: a log event, the opening header, or anything else — a loss notice or an unknown kind. */
export function classifyStreamLine(line: string): { kind: "event"; event: StreamedLogEvent } | { kind: "header" } | { kind: "loss"; line: string } | { kind: "skip" } {
  if (line === "") return { kind: "skip" }
  if (line.startsWith("Filtering the log data using ")) return { kind: "header" }
  if (!line.startsWith("{")) return { kind: "loss", line }
  const event = JSON.parse(line) as { eventType?: string; timestamp?: string; eventMessage?: string }
  if (event.eventType !== "logEvent") return { kind: "loss", line }
  if (typeof event.eventMessage !== "string" || typeof event.timestamp !== "string") return { kind: "loss", line }
  return { kind: "event", event: { timestamp: epochOf(event.timestamp), message: event.eventMessage } }
}

/** ndjson `timestamp`, e.g. `2026-11-24 02:59:57.303076-0500` → epoch ms. */
function epochOf(stamp: string): number {
  const parts = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2})(\d{2})$/.exec(stamp)
  if (!parts) throw new Error(`log stream: unreadable timestamp ${JSON.stringify(stamp)}`)
  return Date.parse(`${parts[1]}T${parts[2]}${(parts[3] ?? "").slice(0, 4)}${parts[4]}:${parts[5]}`)
}

export async function startSandboxDenialStream(input: { predicate: string; markerRoot: string; attachTimeoutMs?: number; drainTimeoutMs?: number }) {
  mkdirSync(input.markerRoot, { recursive: true })
  const markers = realpathSync(input.markerRoot)
  const profile = `(version 1)(allow default)(deny file-write* (subpath ${JSON.stringify(markers)}))`
  let sequence = 0
  const provoke = (kind: "attach" | "end") => {
    const target = join(markers, `${kind}-${process.pid}-${++sequence}`)
    spawnSync("/usr/bin/sandbox-exec", ["-p", profile, "/bin/sh", "-c", ': > "$1"', "sh", target], { stdio: "ignore" })
    return target
  }
  const events: StreamedLogEvent[] = []
  const losses: string[] = []
  const child = Bun.spawn({ cmd: ["/usr/bin/log", "stream", "--style", "ndjson", "--predicate", input.predicate], stdout: "pipe", stderr: "pipe" })
  const drained = (async () => {
    const decoder = new TextDecoder()
    let pending = ""
    const take = (line: string) => {
      const read = classifyStreamLine(line)
      if (read.kind === "event") events.push(read.event)
      if (read.kind === "loss") losses.push(read.line)
    }
    for await (const chunk of child.stdout) {
      pending += decoder.decode(chunk, { stream: true })
      const lines = pending.split("\n")
      pending = lines.pop()!
      for (const line of lines) take(line.trim())
    }
    if (pending.trim()) take(pending.trim())
  })()
  const stderr = new Response(child.stderr).text()
  const kill = () => {
    if (child.exitCode === null) child.kill("SIGTERM")
  }
  const seen = (targets: readonly string[]) => events.some((event) => targets.some((target) => event.message.includes(target)))
  /** Provoke a marker refusal (again every second, each with a new name) until one comes through the stream. */
  const awaitMarker = async (kind: "attach" | "end", timeoutMs: number) => {
    const targets: string[] = []
    for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; ) {
      targets.push(provoke(kind))
      for (const next = Date.now() + 1_000; Date.now() < next; await Bun.sleep(50)) if (seen(targets)) return
      if (child.exitCode !== null) break
    }
    kill()
    throw new Error(
      `log stream ${kind === "attach" ? "did not attach" : "did not drain"}: none of ${targets.length} marker refusal(s) under ${markers} came through within ${timeoutMs} ms` +
        ` (log stream ${child.exitCode === null ? "still running" : `exited ${child.exitCode}`}; stderr: ${(await Promise.race([stderr, Bun.sleep(1_000).then(() => "")])).trim().slice(0, 500)})`,
    )
  }
  await awaitMarker("attach", input.attachTimeoutMs ?? 30_000)
  return {
    /** End marker through ⇒ stop the stream and read the rest of its output; the arm's refusals (markers excluded). */
    async stop(): Promise<StreamedLogEvent[]> {
      await awaitMarker("end", input.drainTimeoutMs ?? 60_000)
      kill()
      await child.exited
      await drained
      if (losses.length)
        throw new Error(`log stream reported ${losses.length} line(s) that are not log events — messages may have been dropped, the capture is incomplete: ${losses[0]!.slice(0, 300)}`)
      return events.filter((event) => !event.message.includes(markers))
    },
    /** Idempotent: for the error paths that never reach stop(). */
    kill,
  }
}
