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
// mkdir 四个根(data/config/state/tmp/log/bin/repos)。所以 main 在这里把 W4/W5/W7 建好;W3 由 main 的 boot 序早已建好;
// `~/code-puppy` 走 ensureUserWorkspaceDir(唯一的 lazy 供给点)。受保护配置集里的目录(状态根、环境根、引擎配置目录、连接记录、
// 两个引擎全局配置目录 —— 后者就是原来的 W6)由 planConfigFence 预建:它们与每一级上级目录节点都被末尾的拒写块冻结,引擎与子进程在
// 其中只能得到 EEXIST(SPEC-engine-config-fence I4)。
// **刻意不建** W16(`~/.opencode`:engine-config-truth 对它有 junk-only 判定,凭空建一个会改行为)、
// W17/W18(dev-only)。

import { basename, dirname, join, resolve } from "node:path"
import { resolveFenceAddonPath, type FenceAddonResolveInput } from "./process-fence-apply"
import {
  assertSeatbeltSafePath,
  configFenceLocations,
  resolveEngineRoots,
  selectWorkspaceUnion,
  trimUntilCompiles,
  type ConfigFenceRule,
  type EngineRoots,
  type TrialCompile,
  type WorkspaceExclusion,
  type WorkspaceDirectoryInput,
} from "./process-fence-profile"

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
}

export type PlanProcessFenceInput = {
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
}

/**
 * DESIGN-engine-config-fence §4.3:受保护配置集落到真实路径。目录位置先预建;每个位置写成「真实上级目录 + 名字」,位置已存在且解析到
 * 别处(软链)时再加真实目标(同一种规则)。realpath 报 ENOENT = 位置不在盘上(literal / subpath 对尚不存在的路径同样挡住新建);
 * 别的错误照常抛 ⇒ 计划失败 ⇒ 拒 fork。返回渲染用的规则与其中的目录位置(资格判定用)。手渲染 profile 的测试夹具也走这里。
 */
export function planConfigFence(
  input: { userDataPath: string; appStateRoot: string; codepuppyGlobalRoot: string; engineConfigDirectory: string; roots: EngineRoots; envFile?: string },
  deps: Pick<PlanProcessFenceDeps, "realpath" | "mkdirp">,
): { configFence: ConfigFenceRule[]; configFenceRoots: string[] } {
  const locations = configFenceLocations({ ...input, configHome: input.roots.configHome, home: input.roots.home })
  const envFile = input.envFile ? resolve(input.envFile) : undefined
  for (const location of locations) if (location.kind === "subpath") deps.mkdirp(location.path)
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
  /** 一个目录的真实路径;不在盘上 = 最深一级已存在祖先的真实路径接上余下部分。 */
  const within = (directory: string): string => {
    try {
      return deps.realpath(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT" || dirname(directory) === directory) throw error
      return join(within(dirname(directory)), basename(directory))
    }
  }
  /**
   * 一个节点在真实上级目录之下的身份:已存在且不是软链 ⇒ 它的真实写法(大小写、firmlink 按身份归一);软链(或尚不存在)⇒ 链节点自己的名字。
   */
  const node = (path: string) => {
    const spelled = join(within(dirname(path)), basename(path))
    const real = target(path)
    return real !== undefined && real.toLowerCase() === spelled.toLowerCase() ? real : spelled
  }
  /**
   * 实现期修订 2 B:位置的配置路径(未解析)上、不在这几条规则真实路径上的目录节点,按身份去重,挂在这个位置的第一条规则上。终审第 3 条:
   * 每个配置路径节点所在的真实位置的上级链也算进来(两跳软链时,中间那一跳的真实目录既不在配置路径上、也不在最终真实路径上)。
   */
  const withVia = (location: ConfigFenceRule, rules: ConfigFenceRule[]) => {
    if (!rules.length) return rules
    const real = new Set(rules.flatMap((rule) => chain(anchorOf(rule))))
    const nodes = chain(anchorOf(location)).map(node)
    const via = [...new Set(nodes.flatMap((n) => [n, ...chain(n)]))].filter((n) => !real.has(n))
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
      // 终审第 2 条:落在 /dev 下的(常见的 /dev/null 表示「没有文件」)不出这一行 —— 读它是空,写它不改变主进程读到的任何东西,
      // 而拒写 /dev/null 会让引擎与子进程的 >/dev/null、忽略的 stdio 全部 EPERM。软链指到 /dev 下同样不出。
      const underDev = (path: string) => path === "/dev" || path.startsWith("/dev/")
      if ([envFile, ...rules.map((rule) => (rule.kind === "dat-files" ? rule.dir : rule.path))].some(underDev)) continue
      for (const rule of rules) {
        try {
          for (const path of [rule.kind === "dat-files" ? rule.dir : rule.path, ...(rule.via ?? [])]) assertSeatbeltSafePath(path, "CODEPUPPY_ENV_FILE")
          add(rule)
        } catch {}
      }
      continue
    }
    const placed = join(deps.realpath(dirname(location.path)), basename(location.path))
    const real = target(location.path)
    const rules: ConfigFenceRule[] = [{ kind: location.kind, path: placed }, ...(real !== undefined && real !== placed ? [{ kind: location.kind, path: real }] : [])]
    for (const rule of withVia(location, rules)) add(rule)
  }
  return { configFence, configFenceRoots: configFence.flatMap((rule) => (rule.kind === "subpath" ? [rule.path] : [])) }
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
    join(home, ".npm"),
    ...(stateHome === input.userDataPath ? [] : [join(stateHome, "opencode")]),
  ]) {
    deps.mkdirp(dir)
  }
  const appStateRoot = deps.appStateRoot()
  const fenceSet = planConfigFence(
    { userDataPath: input.userDataPath, appStateRoot, codepuppyGlobalRoot, engineConfigDirectory: input.engineConfigDirectory, roots, ...(input.envFile ? { envFile: input.envFile } : {}) },
    deps,
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

  const trimmed = trimUntilCompiles(
    { workspaces: union.selected, codepuppyGlobalRoot, userDataPath: input.userDataPath, roots, stateHome, egressProxyPort: input.egressProxyPort, configFence: fenceSet.configFence },
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
  }
  deps.log(
    `process fence planned: workspaces=${plan.workspaces.length} (candidates=${union.candidates}, excluded=${plan.excluded.length}, dropped=${plan.dropped.length}), egressProxyPort=${input.egressProxyPort}, configFence=${fenceSet.configFence.length} rules, profile=${plan.profileBytes}B, compile attempts=${plan.attempts}` +
      (plan.dropped.length ? ` — dropped (oldest first): ${[...plan.dropped].reverse().join(", ")}; last compiler error: ${trimmed.lastFailure}` : "") +
      (plan.excluded.length ? ` — excluded: ${plan.excluded.map((e) => `${e.directory} (${e.reason})`).join("; ")}` : ""),
  )
  return plan
}
