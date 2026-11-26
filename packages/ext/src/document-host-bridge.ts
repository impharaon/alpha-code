import { randomUUID } from "node:crypto"
import {
  isDocumentEnvironment,
  isDocumentPythonEnvironment,
  publishDocumentPythonEnvironment,
  isRenderResult,
  type DocumentHost,
  type DocumentHostRequest,
  type DocumentRuntimeState,
} from "../../util/src/codepuppy-document"
import type { HubBridge } from "./hub-bridge"
import { bindDocumentRuntimeVerification } from "./document-runtime-bridge"

/** Function adapters stay process-local; parentPort carries only the validated data contracts. */
export function createDocumentHostBridge(bridge: HubBridge, sidecarGeneration: number) {
  const projections = new Map<string, () => void>()
  const registrations = new Map<string, Promise<{ ok: true } | { ok: false; error: unknown }>>()
  let latest: { sequence: number; state: DocumentRuntimeState } | undefined
  bridge.onDocumentRuntimeMessage((message) => {
    if (message.type !== "codepuppy.document.runtime.changed") return false
    if (message.sidecarGeneration === sidecarGeneration && (!latest || message.sequence > latest.sequence))
      latest = { sequence: message.sequence, state: message.state }
    return true
  })
  const call = async (request: DocumentHostRequest, signal?: AbortSignal) => {
    const reply = await bridge.documentCall(request, sidecarGeneration, signal)
    if (!reply.ok) throw new Error("detail" in reply ? reply.detail : "document host unavailable")
    return reply.value
  }
  const chromium = async (input: Parameters<DocumentHost["chromiumRender"]>[0], signal?: AbortSignal) => {
    const value = await call({ operation: "chromiumRender", input }, signal)
    if (!isRenderResult(value)) throw Error("invalid document render reply")
    return value
  }
  const host: DocumentHost = {
    async pythonEnvironment(location) {
      const registered = await registrations.get(JSON.stringify(location))
      if (registered && !registered.ok) throw registered.error
      const value = await call({ operation: "python-environment", location })
      if (!isDocumentPythonEnvironment(value)) throw Error("invalid document Python environment reply")
      const key = JSON.stringify(location)
      projections.get(key)?.()
      projections.set(key, publishDocumentPythonEnvironment(location, value))
      return value
    },
    async environment(caller) {
      const registered = await registrations.get(JSON.stringify(caller.location))
      if (registered && !registered.ok) throw registered.error
      const value = await call({ operation: "environment", caller })
      if (!isDocumentEnvironment(value)) throw Error("invalid document environment reply")
      const key = JSON.stringify(caller.location)
      projections.get(key)?.()
      projections.set(key, publishDocumentPythonEnvironment(caller.location, value.pythonEnvironment))
      return { ...value, renderState: latest?.state ?? value.renderState }
    },
    chromiumRender: (input) => chromium(input),
    async defer(input) {
      await call({ operation: "defer", input })
    },
    async recordCheck(input) {
      await call({ operation: "recordCheck", input })
    },
    subscribeRuntimeVerify(location, run) {
      const registrationId = randomUUID()
      const cleanup = bindDocumentRuntimeVerification(bridge, location, sidecarGeneration, registrationId, run)
      const registered = call({ operation: "verify-register", location, registrationId }).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      registrations.set(JSON.stringify(location), registered)
      return async () => {
        try {
          const result = await registered
          if (!result.ok) throw result.error
          // Main invalidates the projection before cancelling the still-listening Location executor.
          await call({ operation: "verify-unregister", location, registrationId })
        } finally {
          await cleanup()
          projections.get(JSON.stringify(location))?.()
          projections.delete(JSON.stringify(location))
          if (registrations.get(JSON.stringify(location)) === registered) registrations.delete(JSON.stringify(location))
        }
      }

    },
    subscribeReady(location, listener) {
      const cleanup = bridge.onDocumentReady((check, generation) => {
        if (
          generation !== sidecarGeneration ||
          check.location.directory !== location.directory ||
          check.location.workspaceID !== location.workspaceID
        )
          return false
        void listener(check)
          .then((admission) => bridge.documentAdmission(check, sidecarGeneration, admission))
          .catch((error) => console.error("[@codepuppy/ext] document admission failed", error))
        return true
      })
      const registered = call({ operation: "ready-register", location }).catch((error) =>
        console.error("[@codepuppy/ext] document ready registration failed", error),
      )
      return () => {
        cleanup()
        void registered.then(() => call({ operation: "ready-unregister", location }))
      }
    },
  }
  return { host, chromium }
}
