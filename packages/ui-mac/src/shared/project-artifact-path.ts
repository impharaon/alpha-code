import fs from "node:fs"
import path from "node:path"

export function sanitizeArtifactName(name: string | undefined, fallback: string): string {
  const base = (name ?? "")
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
  if (!base || base === "." || base === ".." || base.startsWith(".")) return fallback
  return base.length > 128 ? base.slice(0, 128) : base
}

// #901: macOS default volumes (APFS) are case-insensitive but case-preserving — "Report.pdf" and
// "report.pdf" are the SAME directory entry on disk even though they compare unequal as strings.
// Any code deciding a final artifact file name must compare against this folded key, not the raw
// string, or two artifacts that only differ by case silently clobber each other on final rename.
export function foldedArtifactNameKey(name: string): string {
  return name.normalize("NFC").toLowerCase()
}

/**
 * Reserve a collision-free artifact file name under `artifactsDir`, using a case-folded /
 * NFC-normalized comparison so names that only differ by case are treated as taken. Reads the
 * directory fresh on every call (not an in-memory cache) so the reservation holds across
 * separate, sequential download invocations — not just within one batch. `taken` optionally
 * seeds folded keys already claimed earlier in the *same* batch, before those files exist on
 * disk (e.g. a single `saveCloudRun` pass over several just-listed artifacts).
 *
 * An EXACT on-disk name match is deliberately not treated as a collision (only a case-folded
 * match with a *different* exact string is): re-fetching/refreshing the same artifact under the
 * same name is a legitimate, pre-existing overwrite-in-place path (registerDownloadedArtifact's
 * own idempotent-register contract), and that must keep working. `taken` is checked first and
 * always blocks regardless — it represents names already spoken for earlier in *this* batch, so
 * two distinct, not-yet-downloaded artifacts in one pass never end up racing for the same exact
 * name either (pre-existing dedup-with-id-prefix behavior).
 *
 * `claimedByOther`(#1112):账本视角的占用谓词。「同一个精确名字当前归属**另一个** artifactId」
 * 这件事目录列表里没有、manifest 里有 —— 缺了这一问,精确同名不同件会走进「同一件重下应覆盖」
 * 那条路:字节先被覆盖,register 事后才发现冲突,而 renderer 已经收到成功。谓词命中 = 该名字
 * 让路走 id 前缀消歧,与折叠碰撞同一条出路;返回 false 的名字照旧(含 manifest 不可读的退化态,
 * 该状态下 register 本就整体拒写,预约退回纯磁盘判断)。谓词只对**有限**的账本名字集返回 true,
 * 否则消歧循环不终止。
 */
export function reserveArtifactSavedName(
  artifactsDir: string,
  desiredName: string,
  disambiguator: string,
  taken?: Set<string>,
  claimedByOther?: (candidateName: string) => boolean,
): string {
  const exactNames = new Set<string>()
  const foldedNames = new Set<string>()
  try {
    for (const entry of fs.readdirSync(artifactsDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.endsWith(".part")) continue
      exactNames.add(entry.name)
      foldedNames.add(foldedArtifactNameKey(entry.name))
    }
  } catch {
    // artifacts dir not created yet — nothing on disk to collide with.
  }
  const isFree = (candidate: string) => {
    if (taken?.has(foldedArtifactNameKey(candidate))) return false
    // #1112:账本说这个名字属于别的 artifact ⇒ 占用。不以「文件还在不在盘上」为前提 ——
    // register 对账本占用的名字一律拒写(pathOwner 检查),盘上文件没了也一样;预约必须与它一致,
    // 否则字节落下去、登记被拒,manifest 与盘面就地分叉(#402 格 5 C5.5 的实测形态)。
    if (claimedByOther?.(candidate)) return false
    if (exactNames.has(candidate)) return true
    return !foldedNames.has(foldedArtifactNameKey(candidate))
  }
  let candidate = desiredName
  if (!isFree(candidate)) {
    candidate = `${disambiguator}-${desiredName}`
    let suffix = 2
    while (!isFree(candidate)) candidate = `${disambiguator}-${suffix++}-${desiredName}`
  }
  taken?.add(foldedArtifactNameKey(candidate))
  return candidate
}


export function resolveProjectArtifactPath(projectDir: string, root: string, ...segments: string[]): string | null {
  const target = path.resolve(root, ...segments)
  if (target !== root && !target.startsWith(root + path.sep)) return null
  let probe = target
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  try {
    const real = fs.realpathSync(probe)
    const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : root
    // before .codepuppy exists the nearest ancestor is the project dir itself — that is still in-bounds.
    const realProject = fs.realpathSync(projectDir)
    if (real !== realRoot && !real.startsWith(realRoot + path.sep) && real !== realProject) return null
  } catch {
    return null
  }
  return target
}

