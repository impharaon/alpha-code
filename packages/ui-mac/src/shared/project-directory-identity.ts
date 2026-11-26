import { lstatSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, normalize, relative } from "node:path"
import { LEGACY_PROJECT_HIDDEN_DIR, PROJECT_HIDDEN_DIR } from "./project-hidden-dir"

export type ProjectDirectoryIdentity =
  | { status: "project"; directory: string; root: string }
  | { status: "retired-home"; reason: string }
  | { status: "unknown"; reason: string }

/** 已验证的项目根(`projectDirectoryIdentity` 的 project 分支)。 */
export type ProjectRoot = Extract<ProjectDirectoryIdentity, { status: "project" }>

/** home 项目边界三态：project 分支携带唯一可供消费者使用的已验证 `.codepuppy` root。 */
export function projectDirectoryIdentity(directory: string, homeDir: string = homedir()): ProjectDirectoryIdentity {
  if (!isAbsolute(directory)) return { status: "unknown", reason: "project directory must be absolute" }
  let candidate: string
  let home: string
  try {
    candidate = normalize(realpathSync(directory))
    home = normalize(realpathSync(homeDir))
  } catch {
    return { status: "unknown", reason: "project directory identity cannot be confirmed" }
  }
  if (candidate === home) return { status: "retired-home", reason: "real home and its aliases are not projects" }

  const retiredLexical = normalize(join(home, ".alpha"))
  const retired = (() => {
    try {
      return { ok: true as const, path: normalize(realpathSync(retiredLexical)) }
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT")
        return { ok: false as const }
      return { ok: true as const, path: retiredLexical }
    }
  })()
  if (!retired.ok) return { status: "unknown", reason: "retired global root identity cannot be confirmed" }
  const root = join(candidate, PROJECT_HIDDEN_DIR)
  if (isRealDirectory(join(candidate, LEGACY_PROJECT_HIDDEN_DIR)))
    return { status: "unknown", reason: "project still has the legacy hidden directory; the app migrates it when it opens the project" }
  if (sameOrInside(candidate, retired.path) || related(root, retiredLexical) || related(root, retired.path))
    return { status: "retired-home", reason: "project alpha root is related to the retired global root" }

  try {
    const stat = lstatSync(root)
    if (stat.isSymbolicLink() || !stat.isDirectory())
      return { status: "unknown", reason: "project alpha endpoint is not a real directory" }
    const canonical = normalize(realpathSync(root))
    if (canonical !== root) return { status: "unknown", reason: "project alpha endpoint is a canonical alias" }
    if (related(canonical, retired.path))
      return { status: "retired-home", reason: "project alpha root resolves to the retired global root" }
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT")
      return { status: "unknown", reason: "project alpha root identity cannot be confirmed" }
  }
  return { status: "project", directory: candidate, root }
}

export function withProjectDirectoryIdentity<T>(
  expected: Extract<ProjectDirectoryIdentity, { status: "project" }>,
  operation: (root: string) => T,
  homeDir: string = homedir(),
): { ok: true; value: T } | { ok: false; reason: string } {
  const current = projectDirectoryIdentity(expected.directory, homeDir)
  if (current.status !== "project" || current.directory !== expected.directory || current.root !== expected.root)
    return { ok: false, reason: "project alpha root identity drifted" }
  // 与 main/CAS 同一 threat model：分类器重验与紧随的一次 I/O 之间仍有微秒级窗口；不引入 openat。
  return { ok: true, value: operation(current.root) }
}


export function related(left: string, right: string): boolean {
  return sameOrInside(left, right) || sameOrInside(right, left)
}

export function sameOrInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}


function isRealDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory()
  } catch {
    return false
  }
}
