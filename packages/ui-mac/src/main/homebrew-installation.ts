import { accessSync, constants, realpathSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { processFenceRulesCover, type ConfigFenceRule, type ProcessFenceWriteRule } from "./process-fence-profile"

type HomebrewNode = { path: string; realPath: string; dev: string; ino: string }
export type HomebrewInstallation = {
  prefix: string
  prefixIdentity: HomebrewNode
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
      return [{ prefix: resolve(prefix), prefixIdentity: homebrewNode(prefix), launcher, repository, library }]
    } catch { return [] }
  })
}

export function homebrewFenceLocations(installations: readonly HomebrewInstallation[]): readonly Exclude<ConfigFenceRule, { kind: "dat-files" }>[] {
  return installations.flatMap((installation) => [
    { kind: "literal" as const, path: join(installation.prefix, "bin", "brew") },
    ...[installation.prefixIdentity, installation.launcher, installation.repository].flatMap((node) => [node.path, node.realPath].map((path) => ({ kind: "literal" as const, path }))),
    ...[installation.library.path, installation.library.realPath].map((path) => ({ kind: "subpath" as const, path })),
  ])
}

function homebrewNode(path: string): HomebrewNode {
  const realPath = realpathSync.native(path)
  const stat = statSync(realPath, { bigint: true })
  return { path: resolve(path), realPath, dev: String(stat.dev), ino: String(stat.ino) }
}

/** Refresh metadata only beneath this generation's protected installation anchors. */
export function resolveHomebrewExecutable(input: { program: string; cwd: string; env: Readonly<Record<string, string>>; installations: readonly HomebrewInstallation[] }): { executable: string; installation: HomebrewInstallation } | undefined {
  const candidates = input.program.includes("/") ? [resolve(input.cwd, input.program)] : (input.env.PATH ?? "").split(":").map((entry) => resolve(input.cwd, entry, input.program))
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK)
      if (!statSync(candidate).isFile()) continue
      const node = homebrewNode(candidate)
      // PATH selects the first executable, even if it is an untrusted shadow.
      for (const installation of input.installations) {
        const current = readHomebrewInstallations([installation.prefix], [])[0]
        if (!current) continue
        const anchors = ["prefixIdentity", "repository", "library"] as const
        if (!anchors.every((key) => current[key].realPath === installation[key].realPath && current[key].dev === installation[key].dev && current[key].ino === installation[key].ino)) continue
        if (node.realPath === current.launcher.realPath && node.dev === current.launcher.dev && node.ino === current.launcher.ino) return { executable: current.launcher.realPath, installation: current }
      }
      return
    } catch { /* Missing PATH candidates do not become installations. */ }
  }
}
