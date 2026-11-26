import { validPluginPackage, type PluginPackage } from "./host-extension-package-contract/plugin-package"

/** Generation-local install metadata; content remains in the sibling tree directory. */
export type InstalledPluginPackageV1 = { description: PluginPackage; hostNames: Record<string, string> }
export const INSTALLED_PLUGIN_PACKAGE_FILE = "plugin-package.json"
export const PLUGIN_TREE_DIRECTORY = "tree"

export function validInstalledPluginPackage(value: unknown): value is InstalledPluginPackageV1 {
  if (
    !object(value) ||
    !keys(value, ["description", "hostNames"]) ||
    !validPluginPackage(value.description) ||
    !object(value.hostNames)
  )
    return false
  const description = value.description
  const hostNames = value.hostNames
  if (!description.entries.filter(entry => entry.kind === "skill").every(entry => entry.id in hostNames)) return false
  return Object.entries(hostNames).every(([id, name]) => description.entries.some(entry => entry.id === id) && typeof name === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}
