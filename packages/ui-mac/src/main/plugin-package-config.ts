import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { INSTALLED_PLUGIN_SETTINGS_FILE, pluginOptionValue, readInstalledPluginSettings, validInstalledPluginSettings, type InstalledPluginSettingsV1 } from "../shared/installed-plugin-settings"
import { INSTALLED_PLUGIN_PACKAGE_FILE, validInstalledPluginPackage } from "../shared/installed-plugin-package"
import type { PluginPackage } from "../shared/host-extension-package-contract/plugin-package"
import type { PackageAuthorizationItemV1 } from "../shared/package-admission"
import { resolveLiveGenerationDir, runExtensionTransaction, type TxPlanItem, type HealthProbe } from "./ext-transaction"
import type { PackageGraphV1 } from "./ext-package-ledger-v3"
import type { PackageAdmissionDeps } from "./package-admission"
import type { PreparedMcpSecretVersionV1 } from "./ext-package-tx-builders"
import { claimMcpSecretVersionDir, mcpSecretVersionedRef, newMcpSecretVersionId, writeMcpSecretVersioned } from "./codepuppy-mcp-secrets"
import { releasePreparedTxResources, releasePreparedMcpSecretVersion } from "./ext-config"
import { readPackageLedgerStateV1 } from "./ext-receipt-v2"

export function installedPluginDescription(root: string, graph: PackageGraphV1) {
  if (!graph.pluginTree) return
  const live = resolveLiveGenerationDir(root, graph.pluginTree.storeKey)
  if (!live) return
  try {
    const value: unknown = JSON.parse(readFileSync(join(live, INSTALLED_PLUGIN_PACKAGE_FILE), "utf8"))
    return validInstalledPluginPackage(value) ? { ...value, pluginRoot: join(live, "tree") } : undefined
  } catch { return }
}

export function pluginOptionAuthorization(root: string, graph: PackageGraphV1): PackageAuthorizationItemV1[] {
  const installed = installedPluginDescription(root, graph)
  const settings = graph.pluginTree && readInstalledPluginSettings(root, graph.pluginTree.storeKey)
  if (!installed || !settings) return []
  return Object.entries(installed.description.options ?? {}).map(([key, option]) => {
    const value = pluginOptionValue(option, settings.values[key])
    const configured = typeof value === "object" ? !!settings.secretRefs[value.secret] && existsSync(settings.secretRefs[value.secret]!.slice(6, -1)) : value !== undefined
    return { kind: "option", componentId: graph.root.componentId!, prerequisiteId: graph.packageId + "#option:" + key, serviceName: graph.root.name, label: option.title,
      key, type: option.type, description: option.description, required: option.required, sensitive: option.sensitive, configured,
      ...(!option.sensitive && value !== undefined && typeof value !== "object" ? { value } : {}),
    }
  })
}

/** Uses the same D5 versioned resource/store as connector secrets, owned once by the bundle. */
export function preparePluginOptionSecrets(input: { description: PluginPackage; settings: InstalledPluginSettingsV1; server: string; userDataPath: string; values: Record<string, string | number | boolean>; version?: string }): PreparedMcpSecretVersionV1 | undefined {
  if (!Object.keys(input.values).length) return
  const version = input.version ?? newMcpSecretVersionId()
  const secrets = Object.entries(input.values).map(([key, value]) => {
    const need = input.description.secrets.find(need => need.componentId === "$package" && need.label === key)
    if (!need) throw Error("Undeclared sensitive plugin option")
    const ref = mcpSecretVersionedRef(input.userDataPath, input.server, version, need.id)
    input.settings.secretRefs[need.id] = ref
    input.settings.versions[key] = version
    return { id: need.id, value: JSON.stringify(value), file: ref.slice(6, -1) }
  })
  return { descriptor: { kind: "mcp-secret-version", store: "codepuppy-mcp-secrets", server: input.server, version }, files: secrets.map(secret => secret.file),
    populate: () => {
      const claimed = claimMcpSecretVersionDir(input.userDataPath, input.server, version)
      if (!claimed.ok) throw Error(claimed.reason)
      for (const secret of secrets) {
        const written = writeMcpSecretVersioned(input.userDataPath, input.server, version, secret.id, secret.value)
        if (!written.ok) throw Error(written.reason)
      }
    },
    probe: () => ({ healthy: secrets.every(secret => { try { return lstatSync(secret.file).isFile() } catch { return false } }), reason: "Plugin option secret is unavailable" }),
  }
}

export async function savePluginOptions(graph: PackageGraphV1, options: unknown, deps: PackageAdmissionDeps) {
  const installed = installedPluginDescription(deps.root(), graph)
  const before = graph.pluginTree && readInstalledPluginSettings(deps.root(), graph.pluginTree.storeKey)
  if (!installed || !before || !options || typeof options !== "object" || Array.isArray(options)) return { ok: false as const, reason: "invalid plugin settings" }
  const settings = structuredClone(before)
  const sensitive: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(options)) {
    const option = installed.description.options?.[key]
    if (!option || typeof value !== option.type || typeof value === "number" && !Number.isFinite(value)) return { ok: false as const, reason: "invalid plugin option: " + key }
    const scalar = value as string | number | boolean
    if (option.sensitive) {
      const need = installed.description.secrets.find(need => need.componentId === "$package" && need.label === key)
      if (!need) return { ok: false as const, reason: "invalid plugin option declaration" }
      settings.values[key] = { secret: need.id }
      sensitive[key] = scalar
    } else settings.values[key] = scalar
  }
  if (!Object.keys(options).length) return { ok: true as const }
  const prepared = preparePluginOptionSecrets({ description: installed.description, settings, server: graph.root.name, userDataPath: deps.userDataPath, values: sensitive, version: deps.secretVersionId?.() })
  const result = await (deps.transaction ?? runExtensionTransaction)(deps.root(), {
    items: [pluginSettingsItem(graph.pluginTree!.storeKey, settings)], prepared: prepared ? [prepared.descriptor] : [],
    authorization: { confirmed: { [graph.pluginTree!.storeKey + "--settings"]: [] }, decidedAt: (deps.now?.() ?? new Date()).toISOString() },
  }, {
    populate: () => {}, populatePrepared: () => prepared?.populate(), probePrepared: () => prepared?.probe() ?? { healthy: true },
    releasePrepared: resources => releasePreparedTxResources(deps.userDataPath, resources),
    precondition: () => {
      const current = readPackageLedgerStateV1(deps.root(), { sideEffectFree: true })
      return current.ok && current.packageGraphs.some(item => item.packageId === graph.packageId && item.installedGraphDigest === graph.installedGraphDigest) && JSON.stringify(readInstalledPluginSettings(deps.root(), graph.pluginTree!.storeKey)) === JSON.stringify(before)
        ? { ok: true } : { ok: false, reason: "Package changed while saving settings" }
    }, probe: pluginSettingsProbe,
  })
  if (!result.ok) return { ok: false as const, reason: "Plugin settings could not be saved" }
  for (const version of new Set(Object.values(before.versions))) if (!Object.values(settings.versions).includes(version)) {
    const released = releasePreparedMcpSecretVersion(deps.userDataPath, graph.root.name, version)
    if (!released.ok) return { ok: true as const, warning: "Superseded plugin secret cleanup is pending" }
  }
  return { ok: true as const }
}

export function pluginSettingsItem(storeKey: string, settings: InstalledPluginSettingsV1): TxPlanItem {
  return { key: storeKey + "--settings", action: "file", file: { relTarget: "ext-store/" + storeKey + "/" + INSTALLED_PLUGIN_SETTINGS_FILE, next: Buffer.from(JSON.stringify(settings)) }, capabilities: [] }
}
export const pluginSettingsProbe: HealthProbe = input => {
  if (input.action !== "file" || !/^bundle--[a-zA-Z0-9][a-zA-Z0-9._-]*--settings$/.test(input.key)) return { healthy: false, reason: "Not a plugin settings image" }
  try {
    const bytes = readFileSync((input.phase === "pre-switch" ? input.stagedFile : input.fileTarget)!)
    if (input.fileDigest && createHash("sha256").update(bytes).digest("hex") !== input.fileDigest) return { healthy: false, reason: "Plugin settings digest mismatch" }
    return validInstalledPluginSettings(JSON.parse(bytes.toString())) ? { healthy: true } : { healthy: false, reason: "Plugin settings image is invalid" }
  } catch { return { healthy: false, reason: "Plugin settings image cannot be read" } }
}
