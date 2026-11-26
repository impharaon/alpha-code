import { realpathSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { processFenceRulesCover, type ConfigFenceRule, type ProcessFenceWriteRule } from "./process-fence-profile"

type HomebrewNode = { path: string; realPath: string; dev: string; ino: string }
export type HomebrewInstallation = {
  prefix: string
  launcher: HomebrewNode
  repository: HomebrewNode
  library: HomebrewNode
}

/** Main calls this only for its platform discovery prefixes, before installing the fence. */
export function readHomebrewInstallations(prefixes: readonly string[], writable: readonly ProcessFenceWriteRule[]): readonly HomebrewInstallation[] {
  return prefixes.flatMap((prefix) => {
    try {
      const launcher = homebrewNode(join(prefix, "bin", "brew"))
      if (!statSync(launcher.realPath).isFile()) return []
      const repository = homebrewNode(dirname(dirname(launcher.realPath)))
      const library = homebrewNode(join(repository.realPath, "Library", "Homebrew"))
      if (!statSync(library.realPath).isDirectory() || !statSync(join(library.realPath, "brew.sh")).isFile()) return []
      if ([repository, library, launcher].some((node) => processFenceRulesCover({ allow: [...writable], deny: [] }, node.realPath, "file"))) return []
      return [{ prefix: resolve(prefix), launcher, repository, library }]
    } catch { return [] }
  })
}

export function homebrewFenceLocations(installations: readonly HomebrewInstallation[]): readonly Exclude<ConfigFenceRule, { kind: "dat-files" }>[] {
  return installations.flatMap((installation) => [
    { kind: "literal" as const, path: join(installation.prefix, "bin", "brew") },
    ...[installation.launcher, installation.repository].flatMap((node) => [node.path, node.realPath].map((path) => ({ kind: "literal" as const, path }))),
    ...[installation.library.path, installation.library.realPath].map((path) => ({ kind: "subpath" as const, path })),
  ])
}

function homebrewNode(path: string): HomebrewNode {
  const realPath = realpathSync.native(path)
  const stat = statSync(realPath, { bigint: true })
  return { path: resolve(path), realPath, dev: String(stat.dev), ino: String(stat.ino) }
}
