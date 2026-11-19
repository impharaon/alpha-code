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
  whenSettled(input: WorkspaceWritableObservation): Promise<void>
  invalidate(change: WorkspaceWritableChanged): void
  reset(): void
}

type Entry = { target: WorkspaceWriteProbeRequest; result?: WorkspaceWriteProbeResult; done: Promise<void>; finish: () => void }
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
    entry.finish()
    onChange()
  }
  return {
    observe(input) {
      if (!eligible(input)) return
      const key = keyOf(input)
      if (answers.has(key)) return
      const pending = Promise.withResolvers<void>()
      const entry: Entry = { target: { server: input.server, directory: input.directory }, done: pending.promise, finish: pending.resolve }
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
    async whenSettled(input) {
      if (!eligible(input)) return
      const deadline = performance.now() + 1000
      this.observe(input)
      while (true) {
        const entry = answers.get(keyOf(input))
        if (!entry || entry.result) return
        const remaining = deadline - performance.now()
        if (remaining <= 0) return
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([entry.done, new Promise<void>((resolve) => { timer = setTimeout(resolve, remaining) })]).finally(() => clearTimeout(timer))
        if (performance.now() >= deadline || answers.get(keyOf(input)) === entry) return
        // A notification/reset replaced the entry while work was waiting. Follow the new
        // request within the original deadline; an old reply must never release first work.
        this.observe(input)
      }
    },
    invalidate(change) {
      for (const [key, entry] of answers) {
        if (entry.target.server === change.server && entry.target.directory === change.directory) {
          answers.delete(key)
          entry.finish()
        }
      }
      onChange()
    },
    reset() {
      for (const entry of answers.values()) entry.finish()
      answers.clear()
      onChange()
    },
  }
}
