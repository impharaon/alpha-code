// REQ-159 (`#1321`) —— main 侧:在 fork sidecar 之前把这一代的围栏**计划**做出来。
//
// 计划 = { profile(已试编译通过的全文), addonPath(原生模块绝对路径), 并集/丢弃/排除的账 }。
// 它经 StartCommand 交给 sidecar,sidecar 在 import 引擎之前原样 apply(process-fence-apply.ts)。
// 为什么在 main 做而不在 sidecar 做:并集来源是 main 独占的东西 —— `#1394` 起是围栏写不到的真源文件
// (process-fence-workspaces.ts;此前是 main 自己的 electron store,U2 §2.3 —— 那份在 W3 之下、被围栏的引擎写得了,
// `#1390` / `#1394` 关掉了这条);试编译失败要在 fork **之前** fail-closed(拒绝这一代,原因可读),而不是让 sidecar 起来再死。
//
// electron-free:清单读取、根解析、fs 都由 server.ts 注入,
// 于是本模块可以在 bun 里对着假清单 / 假 fs / 假编译器跑判据(process-fence-plan.test.ts),
// 而真编译器与真 profile 的判据各自在 process-fence-compile.test.ts / process-fence-profile.test.ts。
//
// ── 父目录必须由未被围栏的一方预先建好(勘破 §6.3.1 第 3 条)────────────────────────
// `(subpath "<X>/.local/share/opencode")` 放行的是该目录**之下**;`<X>/.local/share` 不存在时,
// 被围栏的引擎 `mkdir -p` 会在父层 EPERM —— 而 packages/core/src/global.ts 在**模块装载时**就
// mkdir 四个根(data/config/state/tmp/log/bin/repos)。所以 main 在这里把 W4/W5 建好;W3 由 main 的 boot 序早已建好;
// `~/code-puppy` 走 ensureUserWorkspaceDir(唯一的 lazy 供给点)。受保护配置集里的目录(状态根、环境根、引擎配置目录、连接记录、
// 两个引擎全局配置目录 —— 后者就是原来的 W6 —— 与工具策略目录 CF-11)由 planConfigFence 预建:它们与每一级上级目录节点都被末尾的拒写块冻结,引擎与子进程在
// 其中只能得到 EEXIST(SPEC-engine-config-fence I4)。
// **刻意不建** `~/.opencode`:它整个是受保护配置位置 CF-9,任何进程都不建它(BR-07;W16 已删,计划目录在引擎数据目录下,
// 这里本来就预建数据目录,`plan` 由写文件工具懒建)。

import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { resolveFenceAddonPath, type FenceAddonResolveInput } from "./process-fence-apply"
import {
  assertSeatbeltSafePath,
  configFenceLocations,
  checkWorkspaceDirectory,
  PACKAGE_MANAGERS_DIRNAME,
  resolvePackageManagerLocations,
  userConfigurationLocations,
  processFenceRulesCover,
  type ProcessFenceWriteRule,
  resolveEngineRoots,
  selectWorkspaceUnion,
  trimUntilCompiles,
  type ConfigFenceRule,
  type CredentialStoreRule,
  type EngineRoots,
  type PackageManagerLocationInput,
  type TrialCompile,
  type WorkspaceExclusion,
  type WorkspaceDirectoryInput,
} from "./process-fence-profile"
import { readWritableLocationTruth, writeWritableLocationTruth, type WritableLocationTruth } from "./process-fence-workspaces"

/** Static install/config candidates share R7 with caches; no user file is written here. */
export function planUserWritableLocations(input: PackageManagerLocationInput & { truthPath: string; eligibility: WorkspaceDirectoryInput }) {
  const template = (rule: ProcessFenceWriteRule) => {
    // Only the fixed resolver's path templates enter here. Split before the first pattern segment.
    const match = /^\^((?:\\.|[^\\[(*+?{$])+)(.*)$/.exec(rule.value)!
    const prefix = match[1]!.replace(/\\(.)/g, "$1")
    const root = prefix.endsWith("/") ? prefix.slice(0, -1) : dirname(prefix)
    return { root, suffix: (prefix.endsWith("/") ? "" : basename(prefix)) + match[2]! }
  }
  const present = (path: string) => { try { lstatSync(path); return true } catch { return false } }
  const rules: ProcessFenceWriteRule[] = [
    // A version manager's location is bound only where it already exists; nothing is created for an absent manager.
    ...resolvePackageManagerLocations(input).writable.filter((entry) => entry.purpose === "global-install" &&
      (!entry.onlyIfExisting || present(entry.rule.kind === "regex" ? template(entry.rule).root : entry.rule.value))).map((entry) => entry.rule),
    ...userConfigurationLocations(input).flatMap((rule) => rule.kind === "dat-files" ? [] : [{ kind: rule.kind, value: rule.path }]),
  ]
  const patterns = rules.filter((rule) => rule.kind === "regex").map(template)
  const base = planWritableLocations({ ...input, candidates: [
    ...rules.filter((rule) => rule.kind !== "regex").map((rule) => ({ sourcePath: rule.value, kind: rule.kind === "literal" ? "file" as const : "directory" as const })),
    ...patterns.map((pattern) => ({ sourcePath: pattern.root, kind: "directory" as const })),
  ] })
  const targets = new Map(base.locations.map((entry) => [entry.sourcePath, entry.targetPath]))
  const writable: ProcessFenceWriteRule[] = rules.flatMap((rule) => rule.kind !== "regex" && targets.has(rule.value) ? [{ ...rule, value: targets.get(rule.value)! }] : [])
  const excluded = [...base.excluded]
  for (const pattern of patterns) {
    const root = targets.get(pattern.root)
    if (!root) continue
    // Version-manager templates enumerate concrete versions before binding bin/package roots.
    const version = /^\[\^\/\]\+\/\((.*)\)\(\/\.\*\)\?\$$/.exec(pattern.suffix)
    if (version) {
      const versions = readdirSync(root).map((name) => join(pattern.root, name))
      const bound = planWritableLocations({ ...input, candidates: versions.map((sourcePath) => ({ sourcePath, kind: "directory" })) })
      const installs = planWritableLocations({ ...input, candidates: bound.locations.flatMap((entry) => version[1]!.split("|").map((suffix) => ({ sourcePath: join(entry.sourcePath, suffix), kind: "directory" as const }))) })
      writable.push(...installs.locations.map((entry) => ({ kind: "subpath" as const, value: entry.targetPath })))
      excluded.push(...bound.excluded, ...installs.excluded)
      continue
    }
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    writable.push({ kind: "regex", value: `^${escaped}/${pattern.suffix}` })
  }
  return { rules: [...new Map(writable.map((rule) => [JSON.stringify(rule), rule])).values()], excluded: [...new Set(excluded)] }
}

export function planPackageManagerCaches(input: PackageManagerLocationInput & { truthPath: string; eligibility: WorkspaceDirectoryInput }) {
  const anchor = checkWorkspaceDirectory(input.eligibility, input.userDataPath)
  if (!anchor.eligible) throw new Error("package manager cache: invalid application data anchor")
  const resolved = resolvePackageManagerLocations(input)
  const caches = resolved.writable.filter((entry) => entry.purpose === "cache")
  const cachePaths = new Set(caches.map((entry) => entry.rule.value))
  const cargoHome = join(input.home, ".cargo")
  const cargoInstalls = resolved.writable.filter((entry) => entry.manager === "cargo" && entry.purpose === "global-install").map((entry) => entry.rule)
  // One bad entry excludes only itself. A reserved Cargo path that cannot be resolved leaves Cargo overlap unprovable.
  let reservedUnresolved = false
  const reserved = [cargoHome, ...cargoInstalls.map((rule) => rule.value),
    ...userConfigurationLocations(input).flatMap((rule) => rule.kind !== "dat-files" && dirname(rule.path) === cargoHome ? [rule.path] : []),
    ...["credentials", "credentials.toml", "env"].map((name) => join(cargoHome, name)),
  ].flatMap((path) => {
    try { return [path, plannedWritableTarget(path, input.eligibility.realpath).target] } catch { reservedUnresolved = true; return [path] }
  })
  const appRoot = join(input.userDataPath, PACKAGE_MANAGERS_DIRNAME)
  const candidates = [{ sourcePath: appRoot, kind: "directory" as const },
    ...caches.map((entry) => ({ sourcePath: entry.rule.value, kind: entry.rule.kind === "literal" ? "file" as const : "directory" as const })),
  ]
  const excluded = new Set<string>()
  for (const candidate of candidates) {
    // App-owned caches: a node replaced by a symlink is removed (never followed) and recreated at the same path.
    if (candidate.sourcePath === appRoot || insideLexically(appRoot, candidate.sourcePath)) unlinkSymlinkedNodes(input.userDataPath, candidate.sourcePath)
    let target: string
    try { target = plannedWritableTarget(candidate.sourcePath, input.eligibility.realpath).target } catch { excluded.add(candidate.sourcePath); continue }
    const cache = caches.find((entry) => entry.rule.value === candidate.sourcePath)
    if (cache?.manager === "cargo") {
      const rule = { ...cache.rule, value: target }
      try {
        if (reservedUnresolved || reserved.some((path) => processFenceRulesCover({ allow: [rule], deny: [] }, path)) ||
          cargoInstalls.filter((entry) => entry.kind === "subpath").some((entry) =>
            [entry.value, plannedWritableTarget(entry.value, input.eligibility.realpath).target].some((value) => processFenceRulesCover({ allow: [{ ...entry, value }], deny: [] }, target))))
          excluded.add(candidate.sourcePath)
      } catch { excluded.add(candidate.sourcePath) }
      continue
    }
    const inside = relative(anchor.directory, target)
    if (inside === "" || inside === ".." || inside.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(inside)) excluded.add(candidate.sourcePath)
  }
  const plan = planWritableLocations({ candidates: candidates.filter((candidate) => !excluded.has(candidate.sourcePath)), truthPath: input.truthPath, eligibility: input.eligibility })
  for (const path of plan.excluded) excluded.add(path)
  const targets = new Map(plan.locations.map((entry) => [entry.sourcePath, entry.targetPath]))
  // An excluded location never reaches the environment, so no tool is pointed at an unplanned path.
  const projected = Object.entries(resolved.env).filter(([, value]) => !excluded.has(value))
  const env = Object.fromEntries(projected.map(([key, value]) => [key, targets.get(value) ?? value]))
  const cacheEnv = Object.fromEntries(projected.filter(([key, value]) => (cachePaths.has(value) || key === "GOBIN" || key === "BUN_INSTALL")).map(([key, value]) => [key, targets.get(value) ?? value]))
  const rules: ProcessFenceWriteRule[] = caches.filter((entry) => targets.has(entry.rule.value)).map((entry) => ({ ...entry.rule, value: targets.get(entry.rule.value)! }))
  return { env, cacheEnv, rules, locations: plan.locations, excluded: [...excluded] }
}

function insideLexically(root: string, path: string) {
  const inside = relative(root, path)
  return inside !== "" && inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)
}

/** Walk from below `anchor` to `path`; a symlinked node is unlinked so the planner recreates a real directory there. */
function unlinkSymlinkedNodes(anchor: string, path: string) {
  let node = anchor
  for (const part of relative(anchor, path).split(sep)) {
    node = join(node, part)
    try {
      if (lstatSync(node).isSymbolicLink()) unlinkSync(node)
      else continue
    } catch { /* missing below here: the planner creates it */ }
    return
  }
}

/** Main-only identity planning. New locations are usable only after the truth is committed. */
export function planWritableLocations(input: {
  candidates: readonly { sourcePath: string; kind: "directory" | "file" }[]
  truthPath: string
  eligibility: WorkspaceDirectoryInput
}): { locations: WritableLocationTruth["entries"]; excluded: readonly string[] } {
  if (!isAbsolute(input.truthPath)) throw new Error("writable location truth: expected an absolute truthPath")
  for (const candidate of input.candidates)
    if (!isAbsolute(candidate.sourcePath) || (candidate.kind !== "directory" && candidate.kind !== "file")) throw new Error("writable location truth: invalid candidate")
  const fs = { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync }
  const read = readWritableLocationTruth(input.truthPath, fs)
  if (!read.ok && !read.absent) throw new Error(`writable location truth: ${read.reason}`)
  const candidates = [...new Map(input.candidates.map((candidate) => [JSON.stringify([candidate.sourcePath, candidate.kind]), candidate])).values()]
  const entries = read.ok ? [...read.entries] : []
  const locations: WritableLocationTruth["entries"][number][] = []
  const excluded: string[] = []
  for (const candidate of candidates) {
    const known = entries.find((entry) => entry.sourcePath === candidate.sourcePath && entry.kind === candidate.kind)
    try {
      const planned = plannedWritableTarget(candidate.sourcePath, input.eligibility.realpath)
      if (!planned.missing.has(planned.target) && input.eligibility.isDirectory(planned.target) !== (candidate.kind === "directory")) {
        excluded.push(candidate.sourcePath)
        continue
      }
      const check = checkWritableTarget(input.eligibility, planned)
      if (!check.eligible || (known && known.targetPath !== check.directory)) {
        excluded.push(candidate.sourcePath)
        continue
      }
      // Create the canonical target, never a wider ancestor grant or an unverified source symlink.
      mkdirSync(candidate.kind === "directory" ? check.directory : dirname(check.directory), { recursive: true })
      const prepared = checkWritableTarget(input.eligibility, plannedWritableTarget(candidate.sourcePath, input.eligibility.realpath))
      if (!prepared.eligible || prepared.directory !== check.directory) {
        excluded.push(candidate.sourcePath)
        continue
      }
      const entry = { ...candidate, targetPath: prepared.directory }
      if (!known) entries.push(entry)
      locations.push(entry)
    } catch {
      excluded.push(candidate.sourcePath)
    }
  }
  if (!read.ok || JSON.stringify(read.entries) !== JSON.stringify(entries)) writeWritableLocationTruth(input.truthPath, { v: 1, entries }, fs)
  return { locations, excluded }
}

/** Resolve through the deepest existing parent; an unresolved symlink is not a missing directory. */
export function plannedWritableTarget(source: string, realpath: WorkspaceDirectoryInput["realpath"]): { target: string; missing: Set<string> } {
  try {
    return { target: resolve(realpath(source)), missing: new Set() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT" || dirname(source) === source) throw error
    try {
      lstatSync(source)
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException)?.code !== "ENOENT") throw missing
      const parent = plannedWritableTarget(dirname(source), realpath)
      const target = join(parent.target, basename(source))
      parent.missing.add(target)
      return { target, missing: parent.missing }
    }
    throw new Error("writable location target is an unresolved symlink")
  }
}

export function checkWritableTarget(input: WorkspaceDirectoryInput, planned: { target: string; missing: Set<string> }) {
  const stat = input.stat ?? ((path: string) => statSync(path, { bigint: true }))
  // Preview only the not-yet-created nodes through the existing identity predicate. Existing ancestors
  // keep their real device/inode; a file is checked as one node, without granting its parent directory.
  return checkWorkspaceDirectory({
    ...input,
    realpath: (path) => planned.missing.has(resolve(path)) ? resolve(path) : input.realpath(path),
    stat: (path) => planned.missing.has(resolve(path)) ? { dev: "planned", ino: resolve(path) } : stat(path),
    isDirectory: (path) => path === planned.target || input.isDirectory(path),
  }, planned.target)
}

export type ProcessFencePlan = {
  profile: string
  addonPath: string
  workspaces: string[]
  dropped: string[]
  excluded: WorkspaceExclusion[]
  attempts: number
  profileBytes: number
  roots: EngineRoots & { codepuppyGlobalRoot: string; userDataPath: string; stateHome: string }
  /** 受保护配置集里的目录位置(含真实目标),与渲染进 profile 的同一份;资格判定的 configFenceRoots 用它(server.ts)。 */
  configFenceRoots: string[]
  /** 渲染进 profile 的同一组受保护配置规则;市场命令来源的查找子进程复用它(DESIGN-local-plugin-install §4.16)。 */
  configFence: ConfigFenceRule[]
}

export type PlanProcessFenceInput = {
  homebrewFence: readonly Exclude<ConfigFenceRule, { kind: "dat-files" }>[]
  userWritableLocations?: readonly ProcessFenceWriteRule[]
  packageManagerCaches?: readonly ProcessFenceWriteRule[]
  userDataPath: string
  /** createSidecarEnv() 的输出 —— XDG_* / HOME 从**这一份**取,它才是引擎将看到的 env。 */
  sidecarEnv: Record<string, string | undefined>
  addon: FenceAddonResolveInput
  /**
   * REQ-137 `#1337`:main 进程内策略代理**已经在听**的 loopback 端口(server.ts 在调用本函数之前起好)。
   * 渲染进 profile 的 N4 行;没有它就没有计划(fail-closed)。
   */
  egressProxyPort: number
  /**
   * INT-safety R3: canonical directories fenced code could already write in an earlier generation of this app run
   * because the user opened them (main's run-lifetime set, process-fence-workspaces.ts). Appended after the truth
   * entries and validated the same way (`stored`: an entry that no longer resolves to itself is excluded). Never
   * persisted: an app restart starts from the truth file alone.
   */
  carriedWorkspaces: readonly string[]
  /** SPEC-engine-config-fence CF-8:server.ts 交给启动文档的同一个值(engineGlobalConfigDirectory(exported.env, exported.home))。 */
  engineConfigDirectory: string
  /** CF-4 的另一份(实现期修订 2 A):主进程启动时读的 `$CODEPUPPY_ENV_FILE`(codepuppy-secrets.ts userEnvFile);没设为空。 */
  envFile?: string
  /** DESIGN-stored-credentials-fence §4.5:Code Puppy 的凭据存放点(codepuppy-secret-files.ts credentialStores(),未解析);计划器落成 C1。 */
  credentialStores: readonly { path: string; kind: "dir" | "file" }[]
}

/**
 * DESIGN-engine-config-fence §4.3:受保护配置集落到真实路径。目录位置先预建;每个位置写成「真实上级目录 + 名字」,位置已存在且解析到
 * 别处(软链)时再加真实目标(同一种规则)。realpath 报 ENOENT = 位置不在盘上(literal / subpath 对尚不存在的路径同样挡住新建);
 * 别的错误照常抛 ⇒ 计划失败 ⇒ 拒 fork。返回渲染用的规则与其中的目录位置(资格判定用)。手渲染 profile 的测试夹具也走这里。
 */
export function planConfigFence(
  input: { userDataPath: string; appStateRoot: string; codepuppyGlobalRoot: string; engineConfigDirectory: string; roots: EngineRoots; envFile?: string },
  deps: Pick<PlanProcessFenceDeps, "realpath" | "mkdirp" | "lstat">,
): { configFence: ConfigFenceRule[]; configFenceRoots: string[]; unexpressed: string[] } {
  /** 残留 R11:写不进 profile(引号、反斜杠、控制字符)因而不被冻结 / 保护的路径,计划器记一行点名。 */
  const locations = configFenceLocations({ ...input, configHome: input.roots.configHome, home: input.roots.home, dataHome: input.roots.dataHome })
  const envFile = input.envFile ? resolve(input.envFile) : undefined
  // CF-9 那一条不预建(BR-07:应用从不建 `~/.opencode`;不存在时 subpath 规则照样挡住任何形式的新建)。按这一条跳过,不按路径串:
  // 用户把同一个目录指定为引擎全局配置目录(CF-8)时照常预建(审查 R1)
  for (const location of locations) if (location.kind === "subpath" && !location.neverCreate) deps.mkdirp(location.path)
  return planProtectedLocations(locations, envFile, deps)
}

/** 一个路径的真实路径;不在盘上 = 最深一级已存在祖先的真实路径接上余下部分。 */
function realPathWithin(path: string, realpath: (p: string) => string): string {
  try {
    return realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT" || dirname(path) === path) throw error
    return join(realPathWithin(dirname(path), realpath), basename(path))
  }
}

/** The same canonical/alias-node protection for CF and Homebrew installation identities. */
export function planProtectedLocations(
  locations: readonly ConfigFenceRule[],
  envFile: string | undefined,
  deps: Pick<PlanProcessFenceDeps, "realpath" | "lstat">,
): { configFence: ConfigFenceRule[]; configFenceRoots: string[]; unexpressed: string[] } {
  const unexpressed: string[] = []
  const target = (path: string) => {
    try {
      return deps.realpath(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined
      throw error
    }
  }
  const configFence: ConfigFenceRule[] = []
  const add = (rule: ConfigFenceRule) => {
    if (!configFence.some((known) => JSON.stringify(known) === JSON.stringify(rule))) configFence.push(rule)
  }
  const anchorOf = (rule: ConfigFenceRule) => (rule.kind === "dat-files" ? join(rule.dir, "x") : rule.path)
  const chain = (anchor: string) => {
    const nodes: string[] = []
    for (let node = dirname(anchor); node !== dirname(node); node = dirname(node)) nodes.push(node)
    return nodes
  }
  const within = (directory: string) => realPathWithin(directory, deps.realpath)
  const lstat = deps.lstat ?? ((path: string) => lstatSync(path, { bigint: true }))
  /** 节点本身(不跟软链)的 device + inode;拿不到为空。 */
  const identity = (path: string) => {
    try {
      const meta = lstat(path)
      return `${meta.dev}:${meta.ino}`
    } catch {
      return undefined
    }
  }
  /**
   * 一个节点在真实上级目录之下的身份:与它的真实路径是同一对象(device + inode;大小写、firmlink 按身份归一)⇒ 真实写法;软链或尚不存在
   * ⇒ 链节点自己的名字(终审第 6a 条:不按小写字符串判,区分大小写的卷上指向只差大小写的兄弟的链节点照样留下)。
   */
  const node = (path: string) => {
    const spelled = join(within(dirname(path)), basename(path))
    const real = target(path)
    if (real === undefined || real === spelled) return real ?? spelled
    const self = identity(spelled)
    return self !== undefined && self === identity(real) ? real : spelled
  }
  /**
   * 实现期修订 2 B:位置的配置路径(未解析)上、不在这几条规则真实路径上的目录节点,按身份去重,挂在这个位置的第一条规则上。终审第 3 条:
   * 每个配置路径节点所在的真实位置的上级链也算进来(两跳软链时,中间那一跳的真实目录既不在配置路径上、也不在最终真实路径上)。
   */
  const withVia = (location: ConfigFenceRule, rules: ConfigFenceRule[]) => {
    if (!rules.length) return rules
    const real = new Set(rules.flatMap((rule) => chain(anchorOf(rule))))
    const nodes = chain(anchorOf(location)).map(node)
    // 终审第 4 条:写不进 profile 的节点(引号、反斜杠、换行)只丢它自己 —— 规则本身与其余节点照留,计划不因它失败
    const writable = (n: string) => {
      try {
        assertSeatbeltSafePath(n, "via")
        return true
      } catch {
        if (!unexpressed.includes(n)) unexpressed.push(n)
        return false
      }
    }
    const via = [...new Set(nodes.flatMap((n) => [n, ...chain(n)]))].filter((n) => !real.has(n) && writable(n))
    return via.length ? [{ ...rules[0]!, via }, ...rules.slice(1)] : rules
  }
  for (const location of locations) {
    if (location.kind === "dat-files") {
      for (const rule of withVia(location, [{ kind: "dat-files", dir: deps.realpath(location.dir) }])) add(rule)
      continue
    }
    if (location.path === envFile && location.kind === "literal") {
      // 实现期修订 2 A:这一项从不让计划失败 —— 上级目录不在盘上照样成规则(literal 挡住新建,上级目录块挡住建出中间目录);解析出错就按
      // 设置的路径写;写不进 profile 的路径(引号、反斜杠、换行)不写。
      let rules: ConfigFenceRule[] = []
      try {
        const placed = join(within(dirname(envFile)), basename(envFile))
        rules.push({ kind: "literal", path: placed })
        const real = target(envFile)
        if (real !== undefined && real !== placed) rules.push({ kind: "literal", path: real })
        rules = withVia(location, rules)
      } catch {
        rules = [{ kind: "literal", path: envFile }]
      }
      // 终审第 2 条:落在 /dev 下的规则(常见的 /dev/null 表示「没有文件」)不出 —— 读它是空,写它不改变主进程读到的任何东西,而拒写
      // /dev/null 会让引擎与子进程的 >/dev/null、忽略的 stdio 全部 EPERM。确认审查 R2 第 1 条:只丢 /dev 下的那条;env 文件是指到 /dev 下的
      // 软链时,链节点自己的 literal 与它的路径节点照留(经链写入按解析后的目标判,照样到 /dev/null;删链、换链被拒)。
      const underDev = (path: string) => path === "/dev" || path.startsWith("/dev/")
      const ruleBase = (rule: ConfigFenceRule) => (rule.kind === "dat-files" ? rule.dir : rule.path)
      if (underDev(envFile) || (rules[0] && underDev(ruleBase(rules[0])))) continue
      rules = rules.filter((rule) => !underDev(ruleBase(rule)))
      for (const rule of rules) {
        try {
          assertSeatbeltSafePath(rule.kind === "dat-files" ? rule.dir : rule.path, "CODEPUPPY_ENV_FILE")
          add(rule)
        } catch {
          unexpressed.push(rule.kind === "dat-files" ? rule.dir : rule.path)
        }
      }
      continue
    }
    const placed = join(deps.realpath(dirname(location.path)), basename(location.path))
    const real = target(location.path)
    const rules: ConfigFenceRule[] = [{ kind: location.kind, path: placed }, ...(real !== undefined && real !== placed ? [{ kind: location.kind, path: real }] : [])]
    for (const rule of withVia(location, rules)) add(rule)
  }
  return { configFence, configFenceRoots: configFence.flatMap((rule) => (rule.kind === "subpath" ? [rule.path] : [])), unexpressed }
}

export type PlanProcessFenceDeps = {
  homeDir: () => string
  codepuppyGlobalRoot: () => string
  /** `#1390`:应用状态根 `<appData>/codepuppy-state`(冻结环境快照的 casBaseRoot);来自 store 的候选与它相关即排除。 */
  appStateRoot: () => string
  /** `#1390`:路径归一,生产必须是 `fs.realpathSync.native`(理由见 process-fence-profile.ts WorkspaceUnionInput.realpath)。 */
  realpath: (p: string) => string
  /** `~/code-puppy`,已 ensure(ensureUserWorkspaceDir 返回 null 时给 codepuppyUserWorkspaceDir 让并集判它不存在)。 */
  defaultWorkspace: () => string
  /**
   * `#1394`:工作区清单(绝对路径,顺序即优先级),来自围栏写不到的真源(process-fence-workspaces.ts),不再是 electron store。
   * 拿不到(缺失 / 解析失败)就抛,原因可读;planner 捕获后退到只有默认工作区并出声 —— 拿不到清单 ≠ 什么都可写。
   */
  readWorkspaces: () => readonly string[]
  isDirectory: (p: string) => boolean
  stat?: WorkspaceDirectoryInput["stat"]
  /** The node itself, not followed (受保护集配置路径节点的身份,终审第 6a 条); production uses lstatSync with bigint identities. */
  lstat?: (p: string) => { dev: number | bigint | string; ino: number | bigint | string }
  mkdirp: (p: string) => void
  compile: TrialCompile
  log: (line: string) => void
}

export function planProcessFence(input: PlanProcessFenceInput, deps: PlanProcessFenceDeps): ProcessFencePlan {
  if (process.platform !== "darwin") throw new Error("process fence plan is darwin-only")
  const home = deps.homeDir()
  const roots = resolveEngineRoots(input.sidecarEnv, home)
  // sidecar.ts:prepareSidecarEnv 把 XDG_STATE_HOME 设成 `process.env.XDG_STATE_HOME ?? userDataPath`。
  // 这里消费同一个决定:用户显式导出的 state 根跟着走,否则 locks 就在 W3 之下。
  const stateHome = input.sidecarEnv.XDG_STATE_HOME && input.sidecarEnv.XDG_STATE_HOME.length > 0 ? input.sidecarEnv.XDG_STATE_HOME : input.userDataPath
  const codepuppyGlobalRoot = deps.codepuppyGlobalRoot()

  // 父目录预建(见文件头)。
  for (const dir of [
    join(roots.dataHome, "opencode"),
    join(roots.cacheHome, "opencode"),
    ...(stateHome === input.userDataPath ? [] : [join(stateHome, "opencode")]),
  ]) {
    deps.mkdirp(dir)
  }
  const appStateRoot = deps.appStateRoot()
  const fenceSet = planConfigFence(
    { userDataPath: input.userDataPath, appStateRoot, codepuppyGlobalRoot, engineConfigDirectory: input.engineConfigDirectory, roots, ...(input.envFile ? { envFile: input.envFile } : {}) },
    deps,
  )

  if (fenceSet.unexpressed.length)
    deps.log(
      `process fence: protected configuration — ${fenceSet.unexpressed.length} path(s) cannot be written into the profile (quote, backslash or control character) and are not protected: ${fenceSet.unexpressed.map((path) => JSON.stringify(path)).join(", ")}`,
    )

  let candidates: readonly string[]
  try {
    candidates = deps.readWorkspaces()
  } catch (error) {
    // 真源缺失 / 坏了不许炸 boot;并集退到只有 `~/code-puppy`(收紧方向,fail-closed),但必须出声。
    deps.log(`process fence: workspace truth unavailable — workspace union falls back to the default workspace only: ${error instanceof Error ? error.message : String(error)}`)
    candidates = []
  }
  const union = selectWorkspaceUnion({
    candidates: [...candidates, ...input.carriedWorkspaces],
    defaultWorkspace: deps.defaultWorkspace(),
    homeDir: home,
    appStateRoot,
    configFenceRoots: () => fenceSet.configFenceRoots,
    realpath: deps.realpath,
    isDirectory: deps.isDirectory,
    stat: deps.stat,
  })
  if (union.selected.length === 0)
    throw new Error("process fence: the default workspace is not a directory on disk — refusing to fork an engine that could not write anywhere a user expects")

  // DESIGN-stored-credentials-fence §4.5:存放点落到真实路径(userData 的真实路径求不出 ⇒ 抛 ⇒ 拒 fork)
  const credentialRules = planCredentialStores(input.credentialStores, deps)
  // `#1761` N5(DESIGN-document-output-quality §4.11):LibreOffice 的单实例管道;用户自己 LibreOffice 的默认 profile 是发布版 bootstraprc 的
  // `$SYSUSERCONFIG/LibreOffice/4`,home 与引擎根同一个。LibreOffice 推算管道名前先解析软链,所以这里给已存在部分的真实路径 + 尚未创建的后缀
  // (代码审查 R1-1)。不看 LO 是否已就绪:profile 只在 sidecar 启动时渲染一次。
  const userInstallation = realPathWithin(join(home, "Library", "Application Support", "LibreOffice", "4"), deps.realpath)
  const unixListen = [{ kind: "libreoffice-single-instance" as const, uid: process.getuid!(), userInstallations: [userInstallation] }]
  const trimmed = trimUntilCompiles(
    { workspaces: union.selected, homebrewFence: input.homebrewFence, userWritableLocations: input.userWritableLocations, packageManagerCaches: input.packageManagerCaches, codepuppyGlobalRoot, userDataPath: input.userDataPath, roots, stateHome, egressProxyPort: input.egressProxyPort, configFence: fenceSet.configFence, credentialStores: credentialRules, unixListen },
    deps.compile,
  )
  const addonPath = resolveFenceAddonPath(input.addon)
  const plan: ProcessFencePlan = {
    profile: trimmed.profile,
    addonPath,
    workspaces: trimmed.workspaces,
    dropped: trimmed.dropped,
    excluded: union.excluded,
    attempts: trimmed.attempts,
    profileBytes: Buffer.byteLength(trimmed.profile),
    roots: { ...roots, codepuppyGlobalRoot, userDataPath: input.userDataPath, stateHome },
    configFenceRoots: fenceSet.configFenceRoots,
    configFence: fenceSet.configFence,
  }
  deps.log(
    `process fence planned: workspaces=${plan.workspaces.length} (candidates=${union.candidates}, excluded=${plan.excluded.length}, dropped=${plan.dropped.length}), egressProxyPort=${input.egressProxyPort}, configFence=${fenceSet.configFence.length} rules, credentialStores=${credentialRules.length} rules, profile=${plan.profileBytes}B, compile attempts=${plan.attempts}` +
      (plan.dropped.length ? ` — dropped (oldest first): ${[...plan.dropped].reverse().join(", ")}; last compiler error: ${trimmed.lastFailure}` : "") +
      (plan.excluded.length ? ` — excluded: ${plan.excluded.map((e) => `${e.directory} (${e.reason})`).join("; ")}` : ""),
  )
  return plan
}

// ── DESIGN-stored-credentials-fence §4.5:凭据存放点的真实目标清单 ────────────────────────────────────────────────
// 围栏 C1 与主进程的别名判断(package-mcp-activation.ts 的 isStoreTarget,设计 §4.1)用同一份清单。

export type { CredentialStoreRule }

/**
 * 每个存放点写成「真实上级目录 + 名字」;位置已存在且解析到别处(软链)时再加它的真实目标。上级目录求不出真实路径 ⇒ 抛(调用方拒绝 fork /
 * 这次应用失败);位置本身不在盘上(ENOENT)只给第一条。
 */
export function planCredentialStores(
  stores: readonly { path: string; kind: "dir" | "file" }[],
  deps: { realpath: (p: string) => string },
): CredentialStoreRule[] {
  const rules: CredentialStoreRule[] = []
  const add = (rule: CredentialStoreRule) => {
    if (!rules.some((known) => known.kind === rule.kind && known.path === rule.path)) rules.push(rule)
  }
  for (const store of stores) {
    const kind = store.kind === "dir" ? "subpath" : "literal"
    const placed = join(deps.realpath(dirname(store.path)), basename(store.path))
    add({ kind, path: placed })
    let real: string | undefined
    try {
      real = deps.realpath(store.path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error
    }
    if (real !== undefined && real !== placed) add({ kind, path: real })
  }
  return rules
}

/**
 * 主进程直接应用连接器时的引用判断与读法(设计 §4.1 isStoreTarget、P-22;片 ① 审查 R1 第 1、4 条),由真实目标清单与存放点里普通文件的身份得出:
 *   · isStoreTarget(p):把 p 求成真实路径(求不出 ⇒ 当作指向存放点);它自己的 device + inode 是某个存放点或存放点里的某个文件、或它的任一上级目录是
 *     某个存放点 ⇒ true。按身份比,不按路径前缀比:firmlink 写法的真实路径不同、inode 相同;指向存放点里某个文件的硬链、`/.vol/<dev>/<ino>` 写法同理。
 *     判为 false 时记下这次判定的真实路径与身份;
 *   · readFile(p):只读判定过的那一个 —— 按记下的真实路径、最后一级不跟随软链打开,描述符的身份必须等于判定时的身份且不是存放点里的任何一项,
 *     才从描述符读出;判定与读取之间被换掉(换成指向存放点的软链、换掉上级目录)、没判过 ⇒ 空串并记一行(不含值)。
 */
export function credentialReferenceGuard(
  rules: readonly CredentialStoreRule[],
  fileIdentities: ReadonlySet<string>,
  deps: {
    realpath: (p: string) => string
    stat: (p: string) => { dev: number | bigint; ino: number | bigint }
    readRegular: (p: string) => { value: string; identity: string } | undefined
    log?: (line: string) => void
  },
): { isStoreTarget: (path: string) => boolean; readFile: (path: string) => string } {
  const identity = (p: string) => {
    try {
      const meta = deps.stat(p)
      return `${meta.dev}:${meta.ino}`
    } catch {
      return undefined
    }
  }
  const stores = new Set([...rules.map((rule) => identity(rule.path)).filter((id): id is string => id !== undefined), ...fileIdentities])
  const judged = new Map<string, { real: string; id: string }>()
  return {
    isStoreTarget: (path) => {
      let real: string
      try {
        real = deps.realpath(resolve(path))
      } catch {
        return true
      }
      const id = identity(real)
      if (id === undefined) return true
      for (let node = real; ; node = dirname(node)) {
        const nodeId = node === real ? id : identity(node)
        if (nodeId !== undefined && stores.has(nodeId)) return true
        if (dirname(node) === node) break
      }
      judged.set(path, { real, id })
      return false
    },
    readFile: (path) => {
      const was = judged.get(path)
      let read: { value: string; identity: string } | undefined
      try {
        read = was ? deps.readRegular(was.real) : undefined
      } catch {
        read = undefined
      }
      if (!was || !read || read.identity !== was.id || stores.has(read.identity)) {
        deps.log?.("connector credential reference: the referenced file changed after it was checked (or could not be opened as that file) — not read")
        return ""
      }
      return read.value
    },
  }
}
