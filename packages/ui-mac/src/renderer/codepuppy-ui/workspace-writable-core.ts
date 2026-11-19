// A consumer of main's eligibility register. Observing/restoring a directory never records an open.
import type { WorkspaceWritableChanged, WorkspaceWriteProbeRequest, WorkspaceWriteProbeResult } from "../../preload/types"

export type WorkspaceWritableAnswer = "pending" | "writable" | "denied" | "unknown"
export type WorkspaceWritableProbe = (input: WorkspaceWriteProbeRequest) => Promise<WorkspaceWriteProbeResult>
export type WorkspaceWritableObservation = {
  generation: number | undefined
  server: string | undefined
  directory: string | undefined
  sandbox: boolean
}
export type WorkspaceWritableTracker = {
  observe(input: WorkspaceWritableObservation): void
  answer(input: WorkspaceWritableObservation): WorkspaceWritableAnswer
  result(input: WorkspaceWritableObservation): WorkspaceWriteProbeResult | undefined
  readonly(input: WorkspaceWritableObservation): boolean
  invalidate(change: WorkspaceWritableChanged): void
  reset(): void
}

type Entry = { target: WorkspaceWriteProbeRequest; result?: WorkspaceWriteProbeResult }
const keyOf = (input: WorkspaceWritableObservation) => JSON.stringify([input.generation, input.server, input.directory])
const failed: WorkspaceWriteProbeResult = { outcome: "unknown", grant: "failed", reason: "grant-failed" }

function eligible(input: WorkspaceWritableObservation): input is WorkspaceWritableObservation & { generation: number; server: string; directory: string } {
  return input.sandbox && input.generation !== undefined && !!input.server && !!input.directory
}

/** One marker predicate for both UI hooks; an EPERM alone cannot assert a cause. */
export function workspaceIsReadonly(result: WorkspaceWriteProbeResult | undefined): boolean {
  return !!result?.reason && result.outcome !== "writable"
}

export function createWorkspaceWritableTracker(probe: WorkspaceWritableProbe, onChange: () => void = () => {}): WorkspaceWritableTracker {
  const answers = new Map<string, Entry>()
  const settle = (key: string, entry: Entry, result: WorkspaceWriteProbeResult) => {
    // Identity, rather than pending text, rejects replies from an evicted request with the same key.
    if (answers.get(key) !== entry || entry.result) return
    entry.result = result && ["writable", "denied", "unknown"].includes(result.outcome) && ["granted", "failed", "ineligible", "not-local", "no-fence"].includes(result.grant) ? result : failed
    onChange()
  }
  return {
    observe(input) {
      if (!eligible(input)) return
      const key = keyOf(input)
      if (answers.has(key)) return
      const entry: Entry = { target: { server: input.server, directory: input.directory } }
      answers.set(key, entry)
      onChange()
      try {
        probe(entry.target).then((result) => settle(key, entry, result), () => settle(key, entry, failed))
      } catch {
        settle(key, entry, failed)
      }
    },
    answer(input) {
      if (!eligible(input)) return "unknown"
      const entry = answers.get(keyOf(input))
      return entry ? entry.result?.outcome ?? "pending" : "unknown"
    },
    result(input) {
      return eligible(input) ? answers.get(keyOf(input))?.result : undefined
    },
    readonly(input) {
      return workspaceIsReadonly(this.result(input))
    },
    invalidate(change) {
      for (const [key, entry] of answers) {
        if (entry.target.server === change.server && entry.target.directory === change.directory) answers.delete(key)
      }
      onChange()
    },
    reset() {
      answers.clear()
      onChange()
    },
  }
}
