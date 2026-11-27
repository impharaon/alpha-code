import { pluginDataHome, preparePluginData, discardPreparedPluginData } from "./plugin-package-data"
import { suggestPluginVersion } from "./plugin-sources"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { INSTALLED_PLUGIN_SETTINGS_FILE, pluginOptionValue, storedPluginOption, readInstalledPluginSettings, validInstalledPluginSettings, type InstalledPluginSettingsV1 } from "../shared/installed-plugin-settings"
import { INSTALLED_PLUGIN_PACKAGE_FILE, validInstalledPluginPackage } from "../shared/installed-plugin-package"
import type { PluginPackage, TreeNode } from "../shared/host-extension-package-contract/plugin-package"
import type { PackageAuthorizationItemV1 } from "../shared/package-admission"
import { resolveLiveGenerationDir, runExtensionTransaction, type TxPlanItem, type HealthProbe } from "./ext-transaction"
import { pluginPackageStoreKey, type PackageGraphV1 } from "./ext-package-ledger-v3"
import type { PackageAdmissionDeps } from "./package-admission"
import type { PreparedMcpSecretVersionV1 } from "./ext-package-tx-builders"
import { claimMcpSecretVersionDir, mcpSecretVersionedRef, newMcpSecretVersionId, writeMcpSecretVersioned } from "./codepuppy-mcp-secrets"
import { releasePreparedTxResources, releasePreparedMcpSecretVersion } from "./ext-config"
import { readPackageLedgerStateV1 } from "./ext-receipt-v2"

/**
 * BR-11 / DESIGN §4.16: a linked package loads in place, so a printed directory that went away is named by the first managed link
 * whose target is gone. Nothing is uninstalled or copied back; the package works again once the source returns.
 */
export function missingLinkedPluginSource(view: readonly TreeNode[]): string | undefined {
  const target = view.find(node => node.kind === "symlink" && !existsSync(node.target))
  return target?.kind === "symlink" ? "Linked plugin source is missing: " + target.target : undefined
}

/** The missing source of an installed linked package, read from its live generation; copied packages have none. */
export function linkedPluginSourceGap(root: string, graph: PackageGraphV1): string | undefined {
  const view = graph.pluginLink ? installedPluginDescription(root, graph)?.view : undefined
  return view ? missingLinkedPluginSource(view) : undefined
}

export function installedPluginDescription(root: string, graph: PackageGraphV1) {
  const storeKey = pluginPackageStoreKey(graph)
  if (!storeKey) return
  const live = resolveLiveGenerationDir(root, storeKey)
  if (!live) return
  try {
    const value: unknown = JSON.parse(readFileSync(join(live, INSTALLED_PLUGIN_PACKAGE_FILE), "utf8"))
    return validInstalledPluginPackage(value) ? { ...value, pluginRoot: join(live, "tree") } : undefined
  } catch { return }
}

/** Every whole-package source uses this private settings/data preparation, outside immutable content. */
export function preparePluginSettings(input: { root: string; storeKey: string; packageId: string; server: string; description: PluginPackage; userDataPath: string; dataHome?: () => string; privateCredentials?: ReadonlyMap<string, Uint8Array> }) {
  const settings: InstalledPluginSettingsV1 = structuredClone(readInstalledPluginSettings(input.root, input.storeKey) ?? { packageId: input.packageId, dataHome: (input.dataHome ?? pluginDataHome)(), values: {}, secretRefs: {}, versions: {}, mcpVersions: {} })
  const defaults = Object.fromEntries(Object.entries(input.description.options ?? {}).flatMap(([key, option]) => {
    if (typeof option.default !== "object" || settings.secretRefs[option.default.secret]) return []
    const bytes = input.privateCredentials?.get(option.default.secret)
    if (!bytes) return []
    const value = new TextDecoder().decode(bytes)
    return [[key, option.type === "string" ? value : JSON.parse(value) as number | boolean]]
  }))
  const prepared = preparePluginOptionSecrets({ description: input.description, settings, server: input.server, userDataPath: input.userDataPath, values: defaults })
  let data: ReturnType<typeof preparePluginData> | undefined
  return { settings, item: pluginSettingsItem(input.storeKey, settings), prepared,
    populateData: () => { data ??= preparePluginData(settings.dataHome, input.packageId) },
    discardData: () => { if (data?.created) discardPreparedPluginData(data.directory) },
  }
}

export function pluginOptionAuthorization(root: string, graph: PackageGraphV1): PackageAuthorizationItemV1[] {
  const installed = installedPluginDescription(root, graph)
  const settings = pluginPackageStoreKey(graph) && readInstalledPluginSettings(root, pluginPackageStoreKey(graph)!)
  if (!installed || !settings) return []
  return Object.entries(installed.description.options ?? {}).map(([key, option]) => {
    const value = pluginOptionValue(option, storedPluginOption(settings, key))
    const configured = typeof value === "object" ? !!settings.secretRefs[value.secret] && existsSync(settings.secretRefs[value.secret]!.slice(6, -1)) : value !== undefined
    return { kind: "option", componentId: graph.root.componentId!, prerequisiteId: graph.packageId + "#option:" + key, serviceName: graph.root.name, label: option.title,
      key, type: option.type, description: option.description, required: option.required, sensitive: option.sensitive, configured,
      ...(!option.sensitive && value !== undefined && typeof value !== "object" ? { value } : {}),
    }
  })
}

const versionHints = new WeakMap<typeof suggestPluginVersion, Map<string, string | undefined>>()

export async function pluginVersionAuthorization(root: string, graph: PackageGraphV1, suggestion = suggestPluginVersion): Promise<PackageAuthorizationItemV1[]> {
  const installed = installedPluginDescription(root, graph)
  const settings = pluginPackageStoreKey(graph) && readInstalledPluginSettings(root, pluginPackageStoreKey(graph)!)
  if (!installed || !settings) return []
  const hints = versionHints.get(suggestion) ?? new Map<string, string | undefined>()
  versionHints.set(suggestion, hints)
  return installed.description.entries.flatMap(entry => {
    const hostName = installed.hostNames[entry.id]
    const declaration = graph.declarations?.find(item => item.kind === "mcp" && item.hostName === hostName)
    if (entry.kind !== "mcp" || entry.transport !== "stdio" || !entry.floatingVersion || !declaration) return []
    const key = JSON.stringify([root, graph.packageId, graph.installedGraphDigest, entry.id])
    if (settings.mcpVersions[entry.id] === undefined && !hints.has(key)) {
      hints.set(key, undefined)
      // Optional metadata never joins authorization's critical path; a later read sees the settled hint.
      void suggestion(entry).then(value => { if (value === undefined) hints.delete(key); else hints.set(key, value) }, () => hints.delete(key))
    }
    const suggested = settings.mcpVersions[entry.id] === undefined ? hints.get(key) : undefined
    return [{ kind: "mcp-version", componentId: declaration.componentId, prerequisiteId: graph.packageId + "#version:" + entry.id, serviceName: hostName, label: entry.sourceName, key: entry.id,
      token: entry.floatingVersion.token, value: settings.mcpVersions[entry.id] ?? suggested ?? "", ...(suggested ? { suggestion: suggested } : {}),
    }]
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
    input.settings.versions = { ...input.settings.versions, [key]: version }
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

export async function savePluginOptions(graph: PackageGraphV1, options: unknown, deps: PackageAdmissionDeps, mcpVersions?: unknown) {
  const installed = installedPluginDescription(deps.root(), graph)
  const storeKey = pluginPackageStoreKey(graph)
  const before = storeKey && readInstalledPluginSettings(deps.root(), storeKey)
  if (!installed || !before || !options || typeof options !== "object" || Array.isArray(options)) return { ok: false as const, reason: "invalid plugin settings" }
  const settings = structuredClone(before)
  if (mcpVersions !== undefined) {
    if (!mcpVersions || typeof mcpVersions !== "object" || Array.isArray(mcpVersions)) return { ok: false as const, reason: "invalid connector versions" }
    for (const [id, version] of Object.entries(mcpVersions)) {
      const entry = installed.description.entries.find(entry => entry.id === id)
      if (typeof version !== "string" || entry?.kind !== "mcp" || entry.transport !== "stdio" || !entry.floatingVersion) return { ok: false as const, reason: "undeclared connector version" }
      settings.mcpVersions[id] = version
    }
  }
  const sensitive: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(options)) {
    const option = installed.description.options?.[key]
    if (!option || typeof value !== option.type || typeof value === "number" && !Number.isFinite(value)) return { ok: false as const, reason: "invalid plugin option: " + key }
    const scalar = value as string | number | boolean
    if (option.sensitive) {
      const need = installed.description.secrets.find(need => need.componentId === "$package" && need.label === key)
      if (!need) return { ok: false as const, reason: "invalid plugin option declaration" }
      settings.values = { ...settings.values, [key]: { secret: need.id } }
      sensitive[key] = scalar
    } else settings.values = { ...settings.values, [key]: scalar }
  }
  if (!Object.keys(options).length && mcpVersions === undefined) return { ok: true as const }
  const prepared = preparePluginOptionSecrets({ description: installed.description, settings, server: graph.root.name, userDataPath: deps.userDataPath, values: sensitive, version: deps.secretVersionId?.() })
  const result = await (deps.transaction ?? runExtensionTransaction)(deps.root(), {
    items: [pluginSettingsItem(storeKey!, settings)], prepared: prepared ? [prepared.descriptor] : [],
    authorization: { confirmed: { [storeKey! + "--settings"]: [] }, decidedAt: (deps.now?.() ?? new Date()).toISOString() },
  }, {
    populate: () => {}, populatePrepared: () => prepared?.populate(), probePrepared: () => prepared?.probe() ?? { healthy: true },
    releasePrepared: resources => releasePreparedTxResources(deps.userDataPath, resources),
    precondition: () => {
      const current = readPackageLedgerStateV1(deps.root(), { sideEffectFree: true })
      return current.ok && current.packageGraphs.some(item => item.packageId === graph.packageId && item.installedGraphDigest === graph.installedGraphDigest) && JSON.stringify(readInstalledPluginSettings(deps.root(), storeKey!)) === JSON.stringify(before)
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
