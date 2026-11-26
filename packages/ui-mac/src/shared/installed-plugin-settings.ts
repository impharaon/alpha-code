import { createHash } from "node:crypto"
import { isAbsolute } from "node:path"
import type { PluginOption, PluginPackage } from "./host-extension-package-contract/plugin-package"
import { readFileSync } from "node:fs"
import { join } from "node:path"

export type PluginOptionValues = Record<string, string | number | boolean | { secret: string }>
export type InstalledPluginSettingsV1 = { packageId: string; dataHome: string; values: PluginOptionValues; secretRefs: Record<string, string>; versions: Record<string, string> }
export const INSTALLED_PLUGIN_SETTINGS_FILE = "package-settings.json"

export function validInstalledPluginSettings(value: unknown): value is InstalledPluginSettingsV1 {
  if (!object(value) || Object.keys(value).some(key => !["packageId", "dataHome", "values", "secretRefs", "versions"].includes(key)) || typeof value.packageId !== "string" || typeof value.dataHome !== "string" || !object(value.values) || !object(value.secretRefs) || !object(value.versions)) return false
  return Object.values(value.values).every(value => typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || object(value) && Object.keys(value).length === 1 && typeof value.secret === "string") && Object.values(value.secretRefs).every(value => typeof value === "string" && /^\{file:[^}]+\}$/.test(value)) && Object.values(value.versions).every(value => typeof value === "string")
}

/** The main-owned settings image is separate from immutable content/CAS and never contains secret values. */
export function readInstalledPluginSettings(root: string, storeKey: string): InstalledPluginSettingsV1 | undefined {
  if (!/^bundle--[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(storeKey)) return
  try {
    const value: unknown = JSON.parse(readFileSync(join(root, "ext-store", storeKey, INSTALLED_PLUGIN_SETTINGS_FILE), "utf8"))
    return validInstalledPluginSettings(value) ? value : undefined
  } catch { return }
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value) }

export function pluginDataDirectory(home: string, packageId: string): string {
  if (!isAbsolute(home)) throw Error("Plugin data root must be absolute")
  return join(home, "opencode", "plugin-data", createHash("sha256").update(packageId).digest("hex"))
}
export function pluginOptionValue(option: PluginOption, value: PluginOptionValues[string] | undefined) {
  return value === undefined ? option.default : value
}
/** Model-facing text has access to ordinary values only. */
export function publicPluginOption(description: PluginPackage, settings: InstalledPluginSettingsV1 | undefined, key: string) {
  const option = description.options?.[key]
  if (!option || option.sensitive) return
  const value = pluginOptionValue(option, settings?.values[key])
  return typeof value === "object" ? undefined : value
}
