// `#1697`(I-04 M5a,设计 §4.10 e):采样夹具的引擎源码身份 —— 采样器写进每个夹具,一致性检查按同一规则从当前树重算。
//
// 身份 = 采样所跑入口(`packages/cli` 的 `serve`)按清单的 `workspace:` 运行时依赖(dependencies / peer / optional)求出的
// 包闭包里,每个包目录在 HEAD 上的 git tree id。不用引擎版本号(从源码运行时恒为 `local`),也不用 HEAD 提交(任何无关提交
// 都会改它)。采样配置不加载插件包,所以闭包之外没有别的引擎代码参与采样。这些路径有未提交改动时采样器拒绝运行。
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

export type EngineIdentity = { entry: string; packages: Record<string, string> }

export const ENGINE_ENTRY = "packages/cli"

/** 入口的 workspace 运行时依赖闭包(packages/ 下的目录,如 `packages/core`),排好序。 */
export function engineClosure(repo: string, entry = ENGINE_ENTRY): string[] {
  const byName = new Map<string, string>()
  for (const dir of readdirSync(join(repo, "packages"))) {
    const manifest = join(repo, "packages", dir, "package.json")
    if (!existsSync(manifest)) continue
    const name = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name
    if (name) byName.set(name, `packages/${dir}`)
  }
  const seen = new Set<string>()
  const visit = (dir: string) => {
    if (seen.has(dir)) return
    seen.add(dir)
    const manifest = JSON.parse(readFileSync(join(repo, dir, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>
    for (const section of ["dependencies", "peerDependencies", "optionalDependencies"])
      for (const [name, version] of Object.entries(manifest[section] ?? {}))
        if (version.startsWith("workspace:") && byName.has(name)) visit(byName.get(name)!)
  }
  visit(entry)
  return [...seen].sort()
}

const git = (repo: string, args: string[]) => {
  const result = Bun.spawnSync(["git", "-C", repo, ...args])
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString().trim()}`)
  return result.stdout.toString().trim()
}

export function engineIdentity(repo: string): EngineIdentity {
  return {
    entry: ENGINE_ENTRY,
    packages: Object.fromEntries(engineClosure(repo).map((dir) => [dir, git(repo, ["rev-parse", `HEAD:${dir}`])])),
  }
}

/** 闭包里有未提交改动的路径(采样器据此拒绝运行:那样采到的样本对不上任何一个提交)。 */
export function dirtyEnginePaths(repo: string) {
  return git(repo, ["status", "--porcelain", "--", ...engineClosure(repo)]).split("\n").filter(Boolean)
}

/** 引擎身份与当前树不等的夹具,逐个点名差在哪个包(没有身份的也算)。 */
export function staleFixtures(fixtures: Record<string, { _engine?: EngineIdentity }>, current: EngineIdentity) {
  const out: string[] = []
  for (const [name, fixture] of Object.entries(fixtures)) {
    const recorded = fixture._engine
    if (!recorded) {
      out.push(`${name}: 没有引擎身份`)
      continue
    }
    const dirs = [...new Set([...Object.keys(recorded.packages), ...Object.keys(current.packages)])].sort()
    const changed = dirs.filter((dir) => recorded.packages[dir] !== current.packages[dir])
    if (recorded.entry !== current.entry || changed.length)
      out.push(`${name}: ${changed.map((dir) => `${dir} ${recorded.packages[dir]?.slice(0, 10) ?? "—"} → ${current.packages[dir]?.slice(0, 10) ?? "—"}`).join(", ")}`)
  }
  return out
}
