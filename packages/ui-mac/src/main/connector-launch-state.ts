import {
  isLaunchIdentity,
  isLaunchSnapshot,
  type ConnectorLaunchApi,
  type LaunchActionResult,
  type LaunchIdentity,
  type LaunchSnapshot,
} from "../../../util/src/codepuppy-connector-launch"
import type { createDocumentRuntime } from "./document-runtime"

/** Current-generation projection only. Core owns phases; actions cannot manufacture recovery. */
export function createConnectorLaunchState(
  sidecarGeneration: string,
  actions: Omit<ConnectorLaunchApi, "list" | "subscribe">,
) {
  const rows = new Map<string, LaunchSnapshot>()
  const retired = new Set<string>()
  const documents = new Map<string, Pick<ReturnType<typeof createDocumentRuntime>, "retry">>()
  const listeners = new Set<(snapshot: LaunchSnapshot) => void>()
  let stopped = false
  const key = (identity: LaunchIdentity) => JSON.stringify([identity.directory, identity.server])
  const attempt = (identity: LaunchIdentity) => JSON.stringify([identity.directory, identity.server, identity.attempt])
  const current = (identity: LaunchIdentity) =>
    !stopped && isLaunchIdentity(identity) && rows.get(key(identity))?.identity.attempt === identity.attempt
  const unavailable = (): Extract<LaunchActionResult, { ok: false }> => ({ ok: false, error: "not-current" })
  const api: ConnectorLaunchApi = {
    async list(directory) {
      return stopped ? [] : [...rows.values()].filter((row) => row.identity.directory === directory)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async retry(identity) {
      if (!current(identity)) return unavailable()
      const runtime = documents.get(attempt(identity))
      if (runtime) {
        runtime.retry()
        return { ok: true }
      }
      return actions.retry(identity)
    },
    async diagnostic(identity) {
      return current(identity) ? actions.diagnostic(identity) : unavailable()
    },
    async openNetworkApproval(identity) {
      return current(identity) ? actions.openNetworkApproval(identity) : unavailable()
    },
    async chooseWorkspace(identity) {
      return current(identity) ? actions.chooseWorkspace(identity) : unavailable()
    },
  }
  return {
    api,
    changed(value: unknown) {
      if (
        stopped ||
        !isLaunchSnapshot(value) ||
        value.sidecarGeneration !== sidecarGeneration ||
        retired.has(attempt(value.identity))
      )
        return false
      const previous = rows.get(key(value.identity))
      if (previous?.identity.attempt === value.identity.attempt && previous.sequence >= value.sequence) return false
      if (previous && previous.identity.attempt !== value.identity.attempt) {
        retired.add(attempt(previous.identity))
        documents.delete(attempt(previous.identity))
      }
      rows.set(key(value.identity), structuredClone(value))
      for (const listener of listeners) listener(value)
      return true
    },
    bindDocumentRuntime(identity: LaunchIdentity, runtime: Pick<ReturnType<typeof createDocumentRuntime>, "retry">) {
      if (!current(identity)) throw Error("document runtime requires a current connector attempt")
      documents.set(attempt(identity), runtime)
      return () => {
        if (documents.get(attempt(identity)) === runtime) documents.delete(attempt(identity))
      }
    },
    dispose() {
      stopped = true
      rows.clear()
      retired.clear()
      documents.clear()
      listeners.clear()
    },
  }
}

let installed: ReturnType<typeof createConnectorLaunchState> | undefined
const subscribers = new Set<(snapshot: LaunchSnapshot) => void>()
const unavailable = async (): Promise<Extract<LaunchActionResult, { ok: false }>> => ({
  ok: false,
  error: "unavailable",
})
/** Process-local composition port; never serialized or exposed as a renderer setter. */
export function installConnectorLaunchState(value: ReturnType<typeof createConnectorLaunchState>) {
  if (installed) throw Error("connector launch state already installed")
  installed = value
  const unsubscribe = value.api.subscribe((snapshot) => {
    for (const listener of subscribers) listener(snapshot)
  })
  return () => {
    unsubscribe()
    value.dispose()
    if (installed === value) installed = undefined
  }
}
export const connectorLaunchApi: ConnectorLaunchApi = {
  list: (directory) => installed?.api.list(directory) ?? Promise.resolve([]),
  subscribe(listener) {
    subscribers.add(listener)
    return () => {
      subscribers.delete(listener)
    }
  },
  retry: (identity) => installed?.api.retry(identity) ?? unavailable(),
  diagnostic: (identity) => installed?.api.diagnostic(identity) ?? unavailable(),
  openNetworkApproval: (identity) => installed?.api.openNetworkApproval(identity) ?? unavailable(),
  chooseWorkspace: (identity) => installed?.api.chooseWorkspace(identity) ?? unavailable(),
}
