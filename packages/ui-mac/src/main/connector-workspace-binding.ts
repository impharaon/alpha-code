import { readMcpLeafStrict } from "./ext-config"
import { persistMcpWithPolicy } from "./ext-mcp-policy"
import type { ReloadRequestInput } from "./reload-coordinator"

export type ConnectorWorkspaceBinding = { kind: "cwd" } | { kind: "location" } | { kind: "failed"; detail: string }

/**
 * R8 "换文件夹": a declaration with an explicitly configured cwd gets the chosen folder through
 * its source's existing writer, keeping every other command/business field; the existing reload
 * re-reads it and restarts the connector. `{workspace}` or no cwd follows the chosen Location.
 */
export function bindConnectorWorkspace(input: { server: string; folder: string }, reload: (request: ReloadRequestInput) => unknown): ConnectorWorkspaceBinding {
  const leaf = readMcpLeafStrict(input.server)
  if (!leaf.ok) return { kind: "failed", detail: leaf.reason }
  const cwd = leaf.value?.type === "remote" ? undefined : leaf.value?.cwd
  if (!leaf.value || typeof cwd !== "string" || cwd.includes("{workspace}")) return { kind: "location" }
  const written = persistMcpWithPolicy(input.server, { ...leaf.value, cwd: input.folder })
  if (!written.ok) return { kind: "failed", detail: written.reason }
  reload({ scope: "global", items: [{ id: `mcp:${input.server}`, scope: "global" }], reason: `connector ${input.server} working directory changed` })
  return { kind: "cwd" }
}
