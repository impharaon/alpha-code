import { existsSync } from "node:fs"
import path from "node:path"
import { collectMcpFileRefPaths, resolveMcpRefPath } from "./codepuppy-mcp-secrets"
import { codepuppyGlobalRoot } from "./codepuppy-installs"
import { mcpPluginTargetPath, readMcpLeafStrict } from "./ext-config"
import { managedMcpNamesOf } from "./package-mcp-activation"
import { readPackageLedgerStateV1 } from "./ext-receipt-v2"

/**
 * §4.5 "needs a key": the installed definition references a secret file that is not saved. Only the definition's own environment
 * references count (each names the key the user fills in); the owning package, when there is one, is where "去填写" opens.
 */
export function connectorSecretNeed(server: string): { fields: string[]; packageId?: string } | undefined {
  const leaf = readMcpLeafStrict(server)
  if (!leaf.ok || !leaf.value) return undefined
  const environment = leaf.value.environment
  if (!environment || typeof environment !== "object") return undefined
  const configDir = path.dirname(mcpPluginTargetPath())
  const fields = Object.entries(environment as Record<string, unknown>).flatMap(([name, value]) =>
    collectMcpFileRefPaths(value).some((file) => !existsSync(resolveMcpRefPath(file, configDir))) ? [name] : [],
  )
  if (!fields.length) return undefined
  const root = codepuppyGlobalRoot()
  const ledger = readPackageLedgerStateV1(root, { sideEffectFree: true })
  const packageId = ledger.ok ? ledger.packageGraphs.find((graph) => managedMcpNamesOf(root, graph.packageId).includes(server))?.packageId : undefined
  return { fields, ...(packageId ? { packageId } : {}) }
}
