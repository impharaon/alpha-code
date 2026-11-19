// Shared consumer for the three workspace hosts. Only recordWorkspaceOpen, called at R1–R5,
// records an open; route resolution, restore, reload, SSE and probe observation never do.
import { createEffect, createSignal, type Accessor } from "solid-js"
import type { WorkspaceWriteProbeRequest, WorkspaceWriteProbeResult } from "../../preload/types"
import { sandboxApplied, sandboxGeneration } from "./sandbox-state"
import { createWorkspaceWritableTracker, type WorkspaceWritableProbe, type WorkspaceWritableTracker } from "./workspace-writable-core"

const [version, setVersion] = createSignal(0)
function bridgeProbe(input: WorkspaceWriteProbeRequest): Promise<WorkspaceWriteProbeResult> {
  const probe = typeof window !== "undefined" ? window.api?.workspaceWriteProbe : undefined
  if (typeof probe !== "function") return Promise.resolve({ outcome: "unknown", grant: "no-fence", detail: "preload bridge absent" })
  return probe(input)
}
let tracker: WorkspaceWritableTracker = createWorkspaceWritableTracker(bridgeProbe, () => setVersion((v) => v + 1))
let unsubscribe: (() => void) | undefined
function subscribe() {
  if (unsubscribe || typeof window === "undefined" || typeof window.api?.onWorkspaceWritableChanged !== "function") return
  unsubscribe = window.api.onWorkspaceWritableChanged((change) => tracker.invalidate(change))
}
const observationOf = (server: string | undefined, directory: string | undefined) => ({ generation: sandboxGeneration(), server, directory, sandbox: sandboxApplied() })

export async function recordWorkspaceOpen(server: string, directory: string): Promise<void> {
  subscribe()
  // Navigation remains usable if the bridge fails. The subsequent probe owns the residual status.
  try { await window.api?.recordWorkspaceOpen?.({ server, directory }) } catch {}
}

export function useWorkspaceWritable(server: Accessor<string | undefined>, directory: Accessor<string | undefined>) {
  subscribe()
  createEffect(() => { version(); tracker.observe(observationOf(server(), directory())) })
  return {
    readonly: () => { version(); return tracker.readonly(observationOf(server(), directory())) },
    reason: () => { version(); return tracker.result(observationOf(server(), directory()))?.reason },
  }
}

export function whenSettled(server: string | undefined, directory: string | undefined): Promise<void> {
  subscribe()
  return tracker.whenSettled(observationOf(server, directory))
}

export function resetWorkspaceWritableForTests(probe?: WorkspaceWritableProbe) {
  unsubscribe?.()
  unsubscribe = undefined
  tracker = createWorkspaceWritableTracker(probe ?? bridgeProbe, () => setVersion((v) => v + 1))
  setVersion((v) => v + 1)
}
