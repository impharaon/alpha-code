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

import { basename, dirname, join } from "node:path"
import { resolveFenceAddonPath, type FenceAddonResolveInput } from "./process-fence-apply"
import {
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
}

/**
 * DESIGN-engine-config-fence §4.3:受保护配置集落到真实路径。目录位置先预建;每个位置写成「真实上级目录 + 名字」,位置已存在且解析到
 * 别处(软链)时再加真实目标(同一种规则)。realpath 报 ENOENT = 位置不在盘上(literal / subpath 对尚不存在的路径同样挡住新建);
 * 别的错误照常抛 ⇒ 计划失败 ⇒ 拒 fork。返回渲染用的规则与其中的目录位置(资格判定用)。手渲染 profile 的测试夹具也走这里。
 */
export function planConfigFence(
  input: { userDataPath: string; appStateRoot: string; codepuppyGlobalRoot: string; engineConfigDirectory: string; roots: EngineRoots },
  deps: Pick<PlanProcessFenceDeps, "realpath" | "mkdirp">,
): { configFence: ConfigFenceRule[]; configFenceRoots: string[] } {
  const locations = configFenceLocations({ ...input, configHome: input.roots.configHome, home: input.roots.home })
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
  for (const location of locations) {
    if (location.kind === "dat-files") {
      add({ kind: "dat-files", dir: deps.realpath(location.dir) })
      continue
    }
    const placed = join(deps.realpath(dirname(location.path)), basename(location.path))
    add({ kind: location.kind, path: placed })
    const real = target(location.path)
    if (real !== undefined && real !== placed) add({ kind: location.kind, path: real })
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
    { userDataPath: input.userDataPath, appStateRoot, codepuppyGlobalRoot, engineConfigDirectory: input.engineConfigDirectory, roots },
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
