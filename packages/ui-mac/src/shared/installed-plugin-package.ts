import { validPluginPackage, validPluginTree, type PluginPackage, type TreeNode } from "./host-extension-package-contract/plugin-package"

/** Main's local receipt of one located command source (DESIGN-local-plugin-install §4.16); it never enters a catalog payload. */
export type CommandSourceBinding = { command: string; resolvedRoot: string; mode: "copy" | "link"; identity: string }

/**
 * Generation-local install metadata; content remains in the sibling tree directory. A linked package records its managed view
 * (top-level links into the located directory plus redacted overlays) and main's local receipt of the command that located it.
 */
export type InstalledPluginPackageV1 = {
  description: PluginPackage
  hostNames: Record<string, string>
  view?: TreeNode[]
  commandSource?: CommandSourceBinding
}
export const INSTALLED_PLUGIN_PACKAGE_FILE = "plugin-package.json"
export const PLUGIN_TREE_DIRECTORY = "tree"

export function validInstalledPluginPackage(value: unknown): value is InstalledPluginPackageV1 {
  if (
    !object(value) ||
    !keys(value, ["description", "hostNames", "view", "commandSource"]) ||
    !validPluginPackage(value.description) ||
    !object(value.hostNames)
  )
    return false
  const description = value.description
  const hostNames = value.hostNames
  if ((description.materialization === "link") !== (value.view !== undefined) || (value.view !== undefined && !validPluginTree(value.view))) return false
  if (value.commandSource !== undefined && !(object(value.commandSource) && keys(value.commandSource, ["command", "resolvedRoot", "mode", "identity"]) && typeof value.commandSource.command === "string" && typeof value.commandSource.resolvedRoot === "string" && (value.commandSource.mode === "copy" || value.commandSource.mode === "link") && typeof value.commandSource.identity === "string")) return false
  if (!description.entries.filter(entry => entry.kind === "skill").every(entry => entry.id in hostNames)) return false
  return Object.entries(hostNames).every(([id, name]) => description.entries.some(entry => entry.id === id) && typeof name === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}
