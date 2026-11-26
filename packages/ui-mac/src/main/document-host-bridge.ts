import {
  documentRecord,
  isDocumentCheckAdmission,
  parseDocumentHostRequest,
  sameDocumentVerifyRef,
  type DocumentHost,
  type DocumentRuntimeVerifyReceipt,
  type DocumentRuntimeVerifyTask,
  type DocumentCheckAdmission,
  type DeferredDocumentCheck,
} from "../../../util/src/codepuppy-document"
import { parseDocumentRuntimeMessage } from "./codepuppy-sidecar-messages"
import type { createDocumentRuntime } from "./document-runtime"

/** Attached to the existing sidecar receive/attach lane, with its real generation. */
export function createDocumentMainBridge(
  host: DocumentHost,
  runtime: Pick<ReturnType<typeof createDocumentRuntime>, "subscribe" | "subscribeRuntimeVerify" | "invalidatePythonEnvironment">,
  sidecarGeneration: number,
  cancelChromium: (request: Parameters<DocumentHost["chromiumRender"]>[0]) => void,
) {
  const renders = new Map<number, Parameters<DocumentHost["chromiumRender"]>[0]>()
  const registrations = new Map<string, { id: string; location: Parameters<DocumentHost["pythonEnvironment"]>[0]; cleanup: () => Promise<void> }>()
  const ready = new Map<string, () => void>()
  const attempts = new Map<
    string,
    { task: DocumentRuntimeVerifyTask; settle: (receipt: DocumentRuntimeVerifyReceipt) => void }
  >()
  const admissions = new Map<
    string,
    { check: DeferredDocumentCheck; settle: (admission: DocumentCheckAdmission) => void }
  >()
  let stopped = false
  let post: ((value: unknown) => void) | undefined
  const key = (location: { directory: string; workspaceID?: string }) =>
    JSON.stringify([location.directory, location.workspaceID ?? null])
  let latest: unknown
  const send = (sender: (value: unknown) => void, value: unknown) => {
    try {
      sender(value)
    } catch {
      /* A stopped sidecar cannot consume a reply; its generation cleanup cancels pending work. */
    }
  }
  const unsubscribe = runtime.subscribe((state, sequence) => {
    latest = { type: "codepuppy.document.runtime.changed", sidecarGeneration, sequence, state }
    if (post) send(post, latest)
  })
  return {
    attach(sender: (value: unknown) => void) {
      post = sender
      if (latest) send(sender, latest)
      return () => {
        post = undefined
      }
    },
    receive(value: unknown, sender: (value: unknown) => void) {
      if (stopped || !documentRecord(value)) return false
      if (value.type === "codepuppy.document.host.cancel") {
        if (value.sidecarGeneration === sidecarGeneration && typeof value.id === "number") {
          const request = renders.get(value.id)
          if (request) cancelChromium(request)
          renders.delete(value.id)
        }
        return true
      }
      const runtimeMessage = parseDocumentRuntimeMessage(value)
      if (runtimeMessage?.type === "codepuppy.document.runtime.verify.receipt") {
        const pending = attempts.get(runtimeMessage.receipt.taskId)
        if (pending && sameDocumentVerifyRef(pending.task, runtimeMessage.receipt)) {
          attempts.delete(pending.task.taskId)
          pending.settle(runtimeMessage.receipt)
        }
        return true
      }
      if (value.type === "codepuppy.document.check-admission") {
        if (
          value.sidecarGeneration !== sidecarGeneration ||
          !documentRecord(value.location) ||
          !isDocumentCheckAdmission(value.admission)
        )
          return true
        const pendingKey = key(value.location as { directory: string }) + String(value.admission.checkId)
        const pending = admissions.get(pendingKey)
        if (
          !pending ||
          (value.admission.status === "admitted" && value.admission.notificationID !== pending.check.notificationID)
        )
          return true
        admissions.delete(pendingKey)
        pending.settle(value.admission as DocumentCheckAdmission)
        return true
      }
      const message = parseDocumentHostRequest(value)
      if (!message || message.sidecarGeneration !== sidecarGeneration) return false
      post = sender
      const operation = async () => {
        const request = message.request
        if (request.operation === "python-environment") return host.pythonEnvironment(request.location)
        if (request.operation === "environment") return host.environment(request.caller)
        if (request.operation === "chromiumRender") {
          renders.set(message.id, request.input)
          try {
            return await host.chromiumRender(request.input)
          } finally {
            renders.delete(message.id)
          }
        }
        if (request.operation === "defer") return host.defer(request.input)
        if (request.operation === "recordCheck") return host.recordCheck(request.input)
        const identity = key(request.location)
        if (request.operation === "verify-register") {
          const existing = registrations.get(identity)
          if (existing?.id === request.registrationId) return null
          if (existing) {
            registrations.delete(identity)
            await existing.cleanup()
          }
          registrations.set(identity, {
            id: request.registrationId,
            location: request.location,
            cleanup: runtime.subscribeRuntimeVerify(
              request.location,
              (task, signal) =>
                new Promise((settle) => {
                  const cancel = () => send(sender, { type: "codepuppy.document.runtime.verify.cancel", ref: task })
                  signal.addEventListener("abort", cancel, { once: true })
                  const complete = (receipt: DocumentRuntimeVerifyReceipt) => {
                    signal.removeEventListener("abort", cancel)
                    settle(receipt)
                  }
                  attempts.set(task.taskId, { task, settle: complete })
                  send(sender, { type: "codepuppy.document.runtime.verify", task })
                  if (signal.aborted) cancel()
                }),
              request.registrationId,
            ),
          })
          return null
        }
        if (request.operation === "verify-unregister") {
          const existing = registrations.get(identity)
          if (existing?.id === request.registrationId) {
            registrations.delete(identity)
            await existing.cleanup()
          }
          return null
        }
        if (request.operation === "ready-register") {
          if (!ready.has(identity))
            ready.set(
              identity,
              host.subscribeReady(
                request.location,
                (check) =>
                  new Promise((settle) => {
                    admissions.set(identity + check.id, { check, settle })
                    send(sender, { type: "codepuppy.document.check-ready", sidecarGeneration, check })
                  }),
              ),
            )
          return null
        }
        if (request.operation === "ready-unregister") {
          ready.get(identity)?.()
          ready.delete(identity)
          return null
        }
      }
      void operation().then(
        (value) => {
          if (!stopped)
            send(sender, {
              type: "codepuppy.document.host.reply",
              id: message.id,
              sidecarGeneration,
              ok: true,
              value: value ?? null,
            })
        },
        (error) => {
          if (!stopped)
            send(sender, {
              type: "codepuppy.document.host.reply",
              id: message.id,
              sidecarGeneration,
              ok: false,
              detail: error instanceof Error ? error.message : String(error),
            })
        },
      )
      return true
    },
    async dispose() {
      for (const entry of registrations.values()) runtime.invalidatePythonEnvironment(entry.location, entry.id, "sidecar-stopped")
      stopped = true
      unsubscribe()
      post = undefined
      for (const request of renders.values()) cancelChromium(request)
      renders.clear()
      for (const pending of attempts.values())
        pending.settle({ ...pending.task, status: "cancelled", reason: "sidecar-stopped" })
      attempts.clear()
      for (const pending of admissions.values()) pending.settle({ status: "conflict", checkId: pending.check.id })
      admissions.clear()
      await Promise.all([...registrations.values()].map((entry) => entry.cleanup()))
      registrations.clear()
      for (const cleanup of ready.values()) cleanup()
      ready.clear()
    },
  }
}
