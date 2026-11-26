import type { Location } from "../../schema/src/location"
import { sameDocumentVerifyRef, type DocumentRuntimeVerifyTask, type DocumentRuntimeVerifyReceipt } from "../../util/src/codepuppy-document"
import type { HubBridge } from "./hub-bridge"

/** One Location registration on the existing parentPort listener; never uses hub query timeouts. */
export function bindDocumentRuntimeVerification(bridge: HubBridge, location: Location.Ref, sidecarGeneration: number, registrationId: string, run: (task: DocumentRuntimeVerifyTask, signal: AbortSignal) => Promise<DocumentRuntimeVerifyReceipt>) {
  const attempts = new Map<string, { task: DocumentRuntimeVerifyTask; abort: AbortController; result: Promise<DocumentRuntimeVerifyReceipt>; cancelled: boolean; reason: "requested" | "location-disposed" }>()
  const unsubscribe = bridge.onDocumentRuntimeMessage((message) => {
    if (message.type === "codepuppy.document.runtime.verify.cancel") {
      const attempt = attempts.get(message.ref.taskId)
      if (attempt && sameDocumentVerifyRef(attempt.task, message.ref)) { attempt.cancelled = true; attempt.abort.abort() }
      return !!attempt && sameDocumentVerifyRef(attempt.task, message.ref)
    }
    if (message.type !== "codepuppy.document.runtime.verify") return false
    const task = message.task
    if (task.sidecarGeneration !== sidecarGeneration || task.location.directory !== location.directory || task.location.workspaceID !== location.workspaceID) return false
    if (task.registrationId !== registrationId) return true
    const existing = attempts.get(task.taskId)
    if (existing) {
      if (sameDocumentVerifyRef(existing.task, task)) void existing.result.then((receipt) => bridge.documentRuntimeReceipt({ type: "codepuppy.document.runtime.verify.receipt", receipt }))
      return true
    }
    const attempt = { task, abort: new AbortController(), result: Promise.resolve<DocumentRuntimeVerifyReceipt>({ ...task, status: "cancelled", reason: "requested" }), cancelled: false, reason: "requested" as "requested" | "location-disposed" }
    attempts.set(task.taskId, attempt)
    attempt.result = (async () => run(task, attempt.abort.signal))().then(
      (receipt): DocumentRuntimeVerifyReceipt => attempt.cancelled ? { ...task, status: "cancelled", reason: attempt.reason } : receipt,
      (error): DocumentRuntimeVerifyReceipt => attempt.cancelled ? { ...task, status: "cancelled", reason: attempt.reason } : { ...task, status: "failed", reason: "spawn", detail: String(error), exitCode: null, stderr: "" },
    )
    void attempt.result.then((receipt) => bridge.documentRuntimeReceipt({ type: "codepuppy.document.runtime.verify.receipt", receipt }))
    return true
  })
  return async () => {
    unsubscribe()
    for (const attempt of attempts.values()) { attempt.cancelled = true; attempt.reason = "location-disposed"; attempt.abort.abort() }
    await Promise.all([...attempts.values()].map((attempt) => attempt.result))
  }
}
