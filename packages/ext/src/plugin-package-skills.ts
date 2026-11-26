import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { INSTALLED_PLUGIN_PACKAGE_FILE, PLUGIN_TREE_DIRECTORY, validInstalledPluginPackage } from "../../ui-mac/src/shared/installed-plugin-package"

const GENERATION = /^gen-\d{6,}-[a-f0-9]{6,}$/
export const PLUGIN_STORE_KEY = /^bundle--[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** current.json is the generation authority for both standalone skills and package trees. */
export function liveGenerationDir(root: string, key: string): string | undefined {
  try {
    const pointer: unknown = JSON.parse(readFileSync(join(root, "ext-store", key, "current.json"), "utf8"))
    if (
      !pointer ||
      typeof pointer !== "object" ||
      !("generation" in pointer) ||
      typeof pointer.generation !== "string" ||
      !GENERATION.test(pointer.generation)
    )
      return
    const dir = join(root, "ext-store", key, "generations", pointer.generation)
    return statSync(dir).isDirectory() ? dir : undefined
  } catch {
    return
  }
}

export function installedPluginSkills(root: string, key: string) {
  const live = PLUGIN_STORE_KEY.test(key) ? liveGenerationDir(root, key) : undefined
  if (!live) return []
  try {
    const metadata: unknown = JSON.parse(readFileSync(join(live, INSTALLED_PLUGIN_PACKAGE_FILE), "utf8"))
    if (!validInstalledPluginPackage(metadata)) return []
    const pluginRoot = join(live, PLUGIN_TREE_DIRECTORY)
    return metadata.description.entries.flatMap((entry) => {
      const name = metadata.hostNames[entry.id]
      return entry.kind === "skill" && name
        ? [
            {
              entry,
              key: "skill--" + name,
              name,
              path: join(pluginRoot, entry.sourcePath),
              directory: join(pluginRoot, entry.directory),
              pluginRoot,
            },
          ]
        : []
    })
  } catch {
    return []
  }
}

export function installedPluginSkill(path: string, root: string) {
  const parts = relative(join(root, "ext-store"), path).split(sep)
  if (!PLUGIN_STORE_KEY.test(parts[0]!) || parts[1] !== "generations") return
  return installedPluginSkills(root, parts[0]!).find((skill) => skill.path === path)
}

/** Enumerate declared skills, so duplicate source directory names cannot overwrite another package. */
export function allInstalledPluginSkills(root: string) {
  try {
    return readdirSync(join(root, "ext-store"))
      .filter((key) => PLUGIN_STORE_KEY.test(key))
      .flatMap((key) => installedPluginSkills(root, key))
  } catch {
    return []
  }
}
