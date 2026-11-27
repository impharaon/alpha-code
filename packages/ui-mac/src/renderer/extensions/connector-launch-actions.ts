import type { LaunchIdentity, LaunchSnapshot } from "../../../../util/src/codepuppy-connector-launch"
import { installedRowKey, openExtHubAt, openPackageManagement } from "./ext-hub-state"
import type { ConnectorLaunchAction } from "./connector-launch-presentation"

let assistant: ((identity: LaunchIdentity) => Promise<void>) | undefined
export function installConnectorAssistantHandoff(value: (identity: LaunchIdentity) => Promise<void>) {
  assistant = value
  return () => {
    if (assistant === value) assistant = undefined
  }
}
export async function runConnectorLaunchAction(
  snapshot: LaunchSnapshot,
  kind: ConnectorLaunchAction,
  authenticate: (server: string) => Promise<unknown>,
) {
  const identity = snapshot.identity
  if (kind === "secret") {
    const failure = snapshot.state.phase === "failed" ? snapshot.state.failure : undefined
    if (failure?.kind === "secret" && failure.packageId) {
      openPackageManagement(failure.packageId)
      return
    }
    openExtHubAt("connectors", installedRowKey("mcp", identity.server))
    return
  }
  if (kind === "auth") {
    await authenticate(identity.server)
    return
  }
  if (kind === "assistant") {
    if (!assistant) throw Error("connector assistant unavailable")
    await assistant(identity)
    return
  }
  const api = window.api.connectorLaunch
  const result =
    kind === "retry"
      ? await api.retry(identity)
      : kind === "network"
        ? await api.openNetworkApproval(identity)
        : await api.chooseWorkspace(identity)
  if (!result.ok && result.error !== "cancelled") throw Error(result.detail ?? result.error)
}
