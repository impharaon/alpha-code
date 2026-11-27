// `#1394`(REQ-159 `#1390` 第二步)—— 围栏可写集的**工作区清单**:真源在围栏写不到的地方,只有 main 写。
//
// ── 为什么要搬 ────────────────────────────────────────────────────────────────────
// 围栏在每次 fork 前按「用户最近打开过哪些项目」算 W1(process-fence-profile.ts selectWorkspaceUnion)。
// 那份清单此前直接来自 `<userData>/opencode.global.dat`(electron-store,无 schema)的三个 tab 键 —— 而 `<userData>`
// 整棵是可写根 W3,**被围栏的引擎树自己写得了**。往里塞一条 `{type:"draft", server:"sidecar", directory:"~/Library/LaunchAgents"}`,
// 下次启动那个目录就可写(放个 plist 进去 = 开机自启)。`#1390` 第一步只把「与应用状态根相关」的候选排除掉,护住了我们自己的目录;
// 主目录下别的目录仍能被同一手法点名。本文件关掉这条:**围栏的输入不再是围栏可写的文件**。
//
// ── 真源在哪、长什么样 ──────────────────────────────────────────────────────────
// `<appData>/codepuppy-state/fence-workspaces/<env>.json`。父目录 `<appData>/codepuppy-state` 是 codepuppy-environment.ts 冻结快照的
// `casBaseRoot`,三个 env 根与 `cas/` 的父目录:W2 只放行它之下的 `env/<env>`,W3 是 `<userData>`(另一棵树),其余 17 行都不覆盖它
// (`#1383` 基线 §1.1/§1.2 逐行核过;W1 那一行由 `#1390` 的规则 5b 兜住:与状态根相关的候选一律不进可写集)。`cas/` 已经是
// 「main 写、引擎只读」的先例,这里是同一形状。按 env 分文件:prod / beta / dev 的 tab store 本来就各在各的 `<userData>`。
// 内容:`{ "v": 1, "workspaces": ["<绝对路径>", …] }`,顺序 = recent → tab 栏 → info(与 workspaceCandidatesFromStore 同序,试编译撞墙从尾丢)。
// 写:先写临时文件再 rename(原子)。读:**严格** —— 不是这个形状(版本不对 / 不是数组 / 有相对路径 / 非字符串)整份拒,不猜、不修;
// planner 拿不到清单退到只有 `~/code-puppy`(process-fence-plan.ts 既有的 fail-closed 语义),并出声。
//
// ── 谁写、什么时候写 ───────────────────────────────────────────────────────────────
// ① 首次启动(文件不存在):从 electron store 播种一次 —— 那一刻的可写集与今天(`#1390` 之后)逐字等价,不引入新风险;日志一行可见。
// ② 之后:只经 renderer → `store-set` / `store-delete` / `store-clear` IPC → main(ipc.ts → 本文件的 tracker)。围栏内的进程到不了 IPC;
//    新增目录还必须已由具体打开动作登记;恢复/SSE/深链只能消费登记表(server.ts 的 planner 只读本真源)。
//
// ── 检疫:为什么不能只做「IPC 来什么写什么」 ────────────────────────────────────────
// renderer 启动时从 store 恢复 tab(app/src/utils/persist.ts),伪造的那条也会被恢复成一个 tab;用户随后开/关任何 tab,renderer 把
// **整个** `tabs` 数组经 IPC 写回 —— 伪造条目就顺着合法通路进了真源,洞只是晚一次重启。所以 boot 时把「store 里有、真源里没有」的目录
// 记成本会话的**检疫名单**:它们永远不进真源,哪怕 renderer 原样写回;真源只按 renderer 报上来的状态增减**检疫名单之外**的目录。
// 检疫仍是本次运行真源重播的第二道闸;具体打开动作可以为该目录登记运行期资格,当场放行。日志点名检疫项。
//
// ── 真源解析失败(不是缺失)怎么办 ───────────────────────────────────────────────────
// 不改写、不重新播种,记一行原因;这一代 planner 退到默认工作区(fail-closed);renderer 下一次 tab 变更按当时状态把它重写好(检疫名单为空)。
// 理由:围栏内的进程写不到这个文件,「坏掉」不是攻击可达的状态,从 renderer 状态重建与首次播种同一信任;而永远锁在默认工作区会让用户
// 手动删文件才能恢复。新目录仍须具体打开登记,不能仅凭恢复的 renderer 数据重建资格。
//
// electron-free:fs / 日志由 index.ts 与 server.ts 注入;本文件不 import electron,也不进 sidecar 的 import 闭包
// (process-fence-write-sites.test.ts 的集合自证会点名)。

import { dirname, isAbsolute, resolve } from "node:path"
import type { AppEnvironment } from "./codepuppy-environment"
import { checkWorkspaceDirectory, LOCAL_SIDECAR_SERVER_KEY, processFenceRulesCover, workspaceCandidatesFromStore, type WorkspaceDirectoryCheck, type WorkspaceDirectoryInput, type WorkspaceUnionSources } from "./process-fence-profile"
import { codepuppyUserWorkspaceDir } from "./codepuppy-user-workspace"
import { planWriteApproval, type WriteApprovalKind } from "./process-fence-plan"
import type { SidecarListener } from "./server"
import type { WorkspaceWritableChanged, WorkspaceWriteProbeFact, WorkspaceWriteProbeRequest, WorkspaceWriteProbeResult } from "./workspace-write-probe"
import { GLOBAL_RENDERER_STORE, TABS_INFO_KEY, TABS_KEY, TABS_RECENT_KEY } from "./tabs-preclean"

export const FENCE_WORKSPACES_DIRNAME = "fence-workspaces"
export const FENCE_WORKSPACE_TRUTH_VERSION = 1

/** `<casBaseRoot>/fence-workspaces/<env>.json` —— 与 `env/`、`cas/` 同级(见文件头)。 */
export function fenceWorkspaceTruthPath(casBaseRoot: string, environment: AppEnvironment): string {
  return resolve(casBaseRoot, FENCE_WORKSPACES_DIRNAME, `${environment}.json`)
}

export type WritableLocationTruth = {
  v: 1
  entries: readonly { sourcePath: string; targetPath: string; kind: "directory" | "file" }[]
}

export function writableLocationTruthPath(casBaseRoot: string, environment: AppEnvironment): string {
  return resolve(casBaseRoot, FENCE_WORKSPACES_DIRNAME, `${environment}-write-locations.json`)
}

export type WorkspaceTruthReadFs = { readFileSync: (path: string, encoding: "utf8") => string }
export type WorkspaceTruthWriteFs = {
  mkdirSync: (path: string, options: { recursive: true }) => unknown
  writeFileSync: (path: string, data: string) => void
  renameSync: (from: string, to: string) => void
  rmSync: (path: string, options: { force: true }) => void
}

export type WorkspaceTruthRead = { ok: true; workspaces: string[] } | { ok: false; absent: boolean; reason: string }
export type WritableLocationTruthRead = { ok: true; entries: WritableLocationTruth["entries"] } | { ok: false; absent: boolean; reason: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): unknown {
  return error && typeof error === "object" && "code" in error ? (error as { code: unknown }).code : undefined
}

/** 严格读:形状不对整份拒(原因可读),缺失单独标出来(播种只对缺失做)。 */
export function readWorkspaceTruth(path: string, fs: WorkspaceTruthReadFs): WorkspaceTruthRead {
  let text: string
  try {
    text = fs.readFileSync(path, "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { ok: false, absent: true, reason: `absent: ${path}` }
    return { ok: false, absent: false, reason: `read failed: ${errorMessage(error)}` }
  }
  const unreadable = (reason: string): WorkspaceTruthRead => ({ ok: false, absent: false, reason: `${path}: ${reason}` })
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return unreadable(`not JSON (${errorMessage(error)})`)
  }
  if (!isRecord(parsed)) return unreadable("not a JSON object")
  if (parsed.v !== FENCE_WORKSPACE_TRUTH_VERSION) return unreadable(`unsupported version ${JSON.stringify(parsed.v)} (expected ${FENCE_WORKSPACE_TRUTH_VERSION})`)
  if (!Array.isArray(parsed.workspaces)) return unreadable("`workspaces` is not an array")
  const workspaces: string[] = []
  for (const [i, entry] of parsed.workspaces.entries()) {
    if (typeof entry !== "string" || !isAbsolute(entry)) return unreadable(`workspaces[${i}] is not an absolute path: ${JSON.stringify(entry)}`)
    workspaces.push(entry)
  }
  return { ok: true, workspaces }
}

/** planner 的依赖形态(process-fence-plan.ts readWorkspaces):拿不到就抛,planner 捕获后退到默认工作区并把原因写进日志。 */
export function readWorkspaceTruthOrThrow(path: string, fs: WorkspaceTruthReadFs): string[] {
  const read = readWorkspaceTruth(path, fs)
  if (!read.ok) throw new Error(`workspace truth ${read.reason}`)
  return read.workspaces
}

export function readWritableLocationTruth(path: string, fs: WorkspaceTruthReadFs): WritableLocationTruthRead {
  let text: string
  try {
    text = fs.readFileSync(path, "utf8")
  } catch (error) {
    return { ok: false, absent: errorCode(error) === "ENOENT", reason: `${path}: ${errorMessage(error)}` }
  }
  const invalid = (reason: string): WritableLocationTruthRead => ({ ok: false, absent: false, reason: `${path}: ${reason}` })
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return invalid("not JSON")
  }
  if (!isRecord(parsed) || parsed.v !== 1 || !Array.isArray(parsed.entries)) return invalid("expected v:1 and entries array")
  const entries: WritableLocationTruth["entries"][number][] = []
  const keys = new Set<string>()
  for (const [index, entry] of parsed.entries.entries()) {
    if (!isRecord(entry) || typeof entry.sourcePath !== "string" || !isAbsolute(entry.sourcePath) || typeof entry.targetPath !== "string" || !isAbsolute(entry.targetPath) || (entry.kind !== "directory" && entry.kind !== "file"))
      return invalid(`entries[${index}] must contain absolute sourcePath/targetPath and directory/file kind`)
    const key = JSON.stringify([entry.sourcePath, entry.kind])
    if (keys.has(key)) return invalid(`entries[${index}] duplicates sourcePath and kind`)
    keys.add(key)
    entries.push({ sourcePath: entry.sourcePath, targetPath: entry.targetPath, kind: entry.kind })
  }
  return { ok: true, entries }
}

let tmpSeq = 0

/** 原子写:临时文件 + rename;父目录不在就建(`fence-workspaces/` 本身不在 codepuppy-environment 的拓扑预检里)。 */
export function writeWorkspaceTruth(path: string, workspaces: readonly string[], fs: WorkspaceTruthWriteFs): void {
  writeTruth(path, { v: FENCE_WORKSPACE_TRUTH_VERSION, workspaces: [...workspaces] }, fs)
}

export function writeWritableLocationTruth(path: string, truth: WritableLocationTruth, fs: WorkspaceTruthWriteFs): void {
  writeTruth(path, truth, fs)
}

function writeTruth(path: string, value: unknown, fs: WorkspaceTruthWriteFs): void {
  fs.mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${++tmpSeq}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(value) + "\n")
    fs.renameSync(tmp, path)
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // 临时文件留着无害;真正要报的是下面那个错
    }
    throw error
  }
}

/** renderer tab 状态 → 清单:与 planner 此前直接吃 store 时同一顺序(recent → tab 栏 → info),只留绝对路径,resolve 后去重。 */
export function workspacesFromRendererTabs(sources: WorkspaceUnionSources): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of workspaceCandidatesFromStore(sources)) {
    if (typeof raw !== "string" || !isAbsolute(raw)) continue
    const dir = resolve(raw)
    if (seen.has(dir)) continue
    seen.add(dir)
    out.push(dir)
  }
  return out
}

export type FenceWorkspaceTracker = {
  readonly truthPath: string
  readonly userOpened: UserOpenedRegistry
  /** Consumers only: this path never records an open, including on failure/retry. */
  grantWrite(input: WorkspaceWriteProbeRequest, sidecar: SidecarListener | null): Promise<Pick<WorkspaceWriteProbeResult, "grant" | "reason">>
  probeWrite(input: WorkspaceWriteProbeRequest, sidecar: SidecarListener | null): Promise<WorkspaceWriteProbeResult>
  /** 本会话的检疫名单(见文件头):store 里有、boot 时真源里没有的目录。 */
  readonly quarantined: readonly string[]
  /** ipc.ts `store-set`:写完 electron store 之后调用;不是 opencode.global.dat 的三个 tab 键一律忽略。 */
  noteRendererStoreSet(name: string, key: string, value: unknown): void
  /** ipc.ts `store-delete`。 */
  noteRendererStoreDelete(name: string, key: string): void
  /** ipc.ts `store-clear`。 */
  noteRendererStoreClear(name: string): void
  /**
   * Only R4, after the user clicked the card naming this path (SPEC v8 BR-08): makes writable the one new path directly in
   * HOME that planWriteApproval judged (`kind: "new-path"`). Nothing is created or registered as opened.
   */
  grantNewPath(input: { server: string; path: string }, sidecar: SidecarListener | null): Promise<Pick<WorkspaceWriteProbeResult, "grant" | "reason">>
  /** Planner input (server.ts): every directory this run's fenced code could write because the user opened it. */
  carriedWorkspaces(): string[]
  /** Planner input (server.ts): every new path in HOME the user approved during this run (design v7 NP5). */
  carriedNewPaths(): string[]
  /** server.ts, once per generation: the W1 members and the new paths its applied profile renders. */
  noteGeneration(generation: SidecarListener, workspaces: readonly string[], newPaths: readonly string[]): void
}

/** What spawnLocalServer needs from the tracker to carry this run's writable history into the next generation. */
export type FenceRunWritable = Pick<FenceWorkspaceTracker, "carriedWorkspaces" | "carriedNewPaths" | "noteGeneration">

export type WorkspaceEligibility =
  | { eligible: true; server: typeof LOCAL_SIDECAR_SERVER_KEY; directory: string }
  | { eligible: false; reason: "not-local" | "home-or-app-state" | "protected-config" | "not-a-directory" }

/**
 * The residual sentence a refused directory gets: HOME / the app-state root and a protected configuration location
 * (SPEC-engine-config-fence BR-05) each have their own; anything else that is not registered reads "not opened by you".
 */
function ineligibleReason(reason: Exclude<WorkspaceDirectoryCheck, { eligible: true }>["reason"]): "home-or-app-state" | "protected-config" | "not-opened-by-you" {
  return reason === "home-or-app-state" || reason === "protected-config" ? reason : "not-opened-by-you"
}

export type UserOpenedRegistry = {
  register(input: { server: string; directory: string }): WorkspaceEligibility
  has(server: string, directory: string): boolean
}

export type BootFenceWorkspaceTruthInput = {
  truthPath: string
  /** electron store 里的三个 tab 键,由 index.ts 在 tier-1 预清之后读一次(之后本模块不再碰 store —— 它在 W3 之下)。 */
  store: WorkspaceUnionSources
  fs: WorkspaceTruthReadFs & WorkspaceTruthWriteFs
  log: (line: string) => void
  eligibility: WorkspaceDirectoryInput
  onWritableChanged: (change: WorkspaceWritableChanged) => void
}

const TAB_KEYS: Record<string, keyof WorkspaceUnionSources> = { [TABS_KEY]: "tabs", [TABS_RECENT_KEY]: "recent", [TABS_INFO_KEY]: "info" }

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * boot 一次:缺失 ⇒ 播种(日志一行);在 ⇒ 装载 + 算检疫名单;坏 ⇒ 不动它、出声。返回的 tracker 交给 ipc.ts。
 * 不抛:真源写不出去只影响下一代的可写集(planner fail-closed),不许炸 boot。
 */
export function bootFenceWorkspaceTruth(input: BootFenceWorkspaceTruthInput): FenceWorkspaceTracker {
  const { truthPath, fs, log } = input
  const state: WorkspaceUnionSources = { tabs: input.store.tabs, recent: input.store.recent, info: input.store.info }
  const fromStore = workspacesFromRendererTabs(state)
  const existing = readWorkspaceTruth(truthPath, fs)
  // Every consumer goes through checkWorkspaceDirectory (process-fence-profile.ts), the one identity rule.
  // `seen` caches a literal tab / probe path's identity at first sight (R8): unchanged tabs and repeated
  // probes resolve nothing. Only eligible results are cached (R3): a path that is missing or refused now is
  // asked again. An explicit open and `has` refresh it. The security decisions never trust it:
  // start-time seeding, the planner and the grant re-resolve through stillSelf.
  const seen = new Map<string, WorkspaceDirectoryCheck>()
  const identity = (literal: string, fresh = false): WorkspaceDirectoryCheck => {
    const known = fresh ? undefined : seen.get(literal)
    if (known) return known
    const result = checkWorkspaceDirectory(input.eligibility, literal)
    if (result.eligible) {
      seen.set(literal, result)
      seen.set(result.directory, result)
    } else seen.delete(literal)
    return result
  }
  // The entry a literal stands for: its identity, or — while it cannot be resolved (an unmounted volume) — its
  // lexical form, which only ever matches an entry the user already opened; a missing path is never added.
  const member = (literal: string, fresh = false): string | undefined => {
    const candidate = identity(literal, fresh)
    return candidate.eligible ? candidate.directory : candidate.missing ? resolve(literal) : undefined
  }
  const stillSelf = (entry: string): WorkspaceDirectoryCheck => {
    const result = checkWorkspaceDirectory(input.eligibility, entry, "stored")
    if (!result.eligible) log(`process fence: workspace ${entry} ${result.missing ? "kept, not on disk now" : `excluded — ${result.detail}`}`)
    return result
  }
  // Run-lifetime carry (R3): canonical directories fenced code could write in some generation of this app run
  // because the user opened them — each generation's W1 and every issue attempt — with the generations that had
  // them. A survivor of an earlier generation keeps that sandbox, so such a directory is never issued again later
  // in this run; the planner puts it back into W1 instead. Nothing here outlives the app process. An approved new path in
  // HOME (SPEC v8 BR-08) is carried the same way, as its own kind: the planner renders it beside W1, never as a workspace.
  const carried = new Map<string, { kind: WriteApprovalKind; generations: Set<SidecarListener> }>()
  const carry = (path: string, generation: SidecarListener, kind: WriteApprovalKind = "directory") => {
    const entry = carried.get(path) ?? { kind, generations: new Set<SidecarListener>() }
    entry.generations.add(generation)
    carried.set(path, entry)
  }
  const carriedFromOtherGenerations = (directory: string, generation: SidecarListener) =>
    processFenceRulesCover({ allow: [...carried].filter(([, entry]) => [...entry.generations].some((other) => other !== generation)).map(([value]) => ({ kind: "subpath" as const, value })), deny: [] }, directory)
  const carriedOf = (kind: WriteApprovalKind) => [...carried].flatMap(([path, entry]) => (entry.kind === kind ? [path] : []))
  let current: string[]
  let quarantined: string[] = []
  if (existing.ok) {
    // Seeding: a stored identity that now resolves elsewhere (or into a protected place) is excluded, never
    // re-pointed; one that merely is not on disk now stays registered (design §4: truth entries count as opened).
    current = existing.workspaces.filter((entry) => {
      const result = stillSelf(entry)
      return result.eligible || !!result.missing
    })
    quarantined = fromStore.filter((literal) => {
      const entry = member(literal)
      return entry === undefined || !current.includes(entry)
    })
    log(`process fence: workspace truth loaded — ${current.length} workspace(s) from ${truthPath}`)
    if (quarantined.length)
      log(
        `process fence: ${quarantined.length} workspace(s) are in the renderer tab store but not in the workspace truth — quarantined for this session, they never enter the truth even if the renderer persists them back (#1394): ${quarantined.join(", ")}`,
      )
  } else if (existing.absent) {
    try {
      current = [...new Set(fromStore.flatMap((literal) => {
        const entry = member(literal)
        return entry === undefined ? [] : [entry]
      }))]
      writeWorkspaceTruth(truthPath, current, fs)
      log(
        `process fence: workspace truth seeded from the renderer tab store (first launch with #1394) — ${current.length} workspace(s) written to ${truthPath}` +
          (current.length ? `: ${current.join(", ")}` : ""),
      )
    } catch (error) {
      current = []
      log(`process fence: FAILED to seed the workspace truth at ${truthPath} — the planner falls back to the default workspace only until the renderer's next tab change writes it: ${errorMessage(error)}`)
    }
  } else {
    current = []
    log(
      `process fence: workspace truth is unreadable — ${existing.reason}; leaving it untouched, the planner falls back to the default workspace only until the renderer's next tab change rewrites it`,
    )
  }
  // Quarantine compares identities: an honest project reached through a symlink, `/tmp` or another
  // letter case is the truth entry it names, not a stranger.
  const quarantine = new Set(quarantined.flatMap((literal) => {
    const entry = member(literal)
    return entry === undefined ? [] : [entry]
  }))
  const defaultWorkspace = checkWorkspaceDirectory(input.eligibility, codepuppyUserWorkspaceDir(process.env, input.eligibility.homeDir))
  const opened = new Set([...current, ...(defaultWorkspace.eligible ? [defaultWorkspace.directory] : [])])
  const failed = new WeakMap<SidecarListener, Set<string>>()

  const recompute = () => {
    const next = [...new Set(workspacesFromRendererTabs(state).flatMap((literal) => {
      const entry = member(literal)
      return entry !== undefined && opened.has(entry) && !quarantine.has(entry) ? [entry] : []
    }))]
    if (sameList(next, current)) return
    const added = next.filter((d) => !current.includes(d))
    const removed = current.filter((d) => !next.includes(d))
    try {
      writeWorkspaceTruth(truthPath, next, fs)
      current = next
      log(
        `process fence: workspace truth updated from the renderer tab store — ${next.length} workspace(s)` +
          (added.length ? `; added: ${added.join(", ")}` : "") +
          (removed.length ? `; removed: ${removed.join(", ")}` : "") +
          " (takes effect at the next engine generation)",
      )
    } catch (error) {
      log(`process fence: FAILED to write the workspace truth at ${truthPath} — the next engine generation keeps the previous list: ${errorMessage(error)}`)
    }
  }

  const tabKey = (name: string, key: string): keyof WorkspaceUnionSources | undefined =>
    name === GLOBAL_RENDERER_STORE ? TAB_KEYS[key] : undefined

  const userOpened: UserOpenedRegistry = {
    register(target) {
      if (target.server !== LOCAL_SIDECAR_SERVER_KEY) return { eligible: false, reason: "not-local" }
      // The stored identity is the canonical directory at the moment of the open.
      const candidate = identity(target.directory, true)
      if (!candidate.eligible) return { eligible: false, reason: candidate.reason }
      const change = { server: LOCAL_SIDECAR_SERVER_KEY, directory: candidate.directory }
      const added = !opened.has(candidate.directory)
      opened.add(candidate.directory)
      recompute()
      if (added) input.onWritableChanged(change)
      return { eligible: true, server: LOCAL_SIDECAR_SERVER_KEY, directory: candidate.directory }
    },
    has(server, directory) {
      if (server !== LOCAL_SIDECAR_SERVER_KEY) return false
      const entry = member(directory, true)
      return entry !== undefined && opened.has(entry)
    },
  }

  const noteFailed = (sidecar: SidecarListener, directory: string) => {
    const failures = failed.get(sidecar) ?? new Set<string>()
    failures.add(directory)
    failed.set(sidecar, failures)
  }
  const settle = async (target: WorkspaceWriteProbeRequest, sidecar: SidecarListener | null, answerProbe: boolean): Promise<WorkspaceWriteProbeResult> => {
    if (sidecar ? !sidecar.fenced : process.platform !== "darwin") return { outcome: "unknown", grant: "no-fence" }
    if (target.server !== LOCAL_SIDECAR_SERVER_KEY) return { outcome: "unknown", grant: "not-local" }
    const candidate = identity(target.directory)
    if (!candidate.eligible && candidate.missing && opened.has(resolve(target.directory))) {
      // Opened, but not on disk right now: nothing to grant, no sentence (unknown is not read-only); asked again later.
      if (sidecar) noteFailed(sidecar, resolve(target.directory))
      return { ...(sidecar && answerProbe ? await sidecar.probeWrite(target.directory) : { outcome: "unknown" as const }), grant: "failed" }
    }
    if (!candidate.eligible || !opened.has(candidate.directory)) {
      const reason = candidate.eligible ? "not-opened-by-you" : ineligibleReason(candidate.reason)
      return { ...(sidecar && answerProbe ? await sidecar.probeWrite(target.directory) : { outcome: "unknown" as const }), grant: "ineligible", reason }
    }
    if (!sidecar) return { outcome: "unknown", grant: "failed", reason: "grant-failed" }
    const directory = candidate.directory
    const probe = async (): Promise<WorkspaceWriteProbeFact> => answerProbe ? await sidecar.probeWrite(target.directory) : { outcome: "unknown" }
    // Does it need a grant? Decided from main's own knowledge, never from the fenced probe (R9). Inside a root this
    // generation already writes (its rendered profile, or a grant of this generation), or one an earlier generation
    // of this run could write (a survivor keeps that sandbox, R3) ⇒ never issue: fenced code may be able to rename
    // that path's components, so a probe there proves nothing about what an issue would resolve. If the W1 cap
    // dropped such a carried directory, this answers grant-failed; there is no further mechanism for that case.
    // The probe only reports writability. Not writable ⇒ no token exists; stillSelf only names the reason (a rebound
    // path keeps its precise sentence), otherwise grant-failed.
    if (sidecar.generationWrites(directory) || carriedFromOtherGenerations(directory, sidecar)) {
      if (!answerProbe) return { outcome: "unknown", grant: "granted" }
      const fact = await probe()
      if (fact.outcome === "writable") {
        if (failed.get(sidecar)?.delete(directory)) input.onWritableChanged({ server: target.server, directory })
        return { ...fact, grant: "granted" }
      }
      const self = stillSelf(directory)
      if (!self.eligible) return { ...fact, grant: "ineligible", reason: ineligibleReason(self.reason) }
      noteFailed(sidecar, directory)
      return { ...fact, grant: "failed", reason: "grant-failed" }
    }
    // Outside every such root, none of its ancestors can be created, removed or renamed by fenced code (an ancestor
    // whose parent were writable would put the directory itself inside that root), so stillSelf followed by the issue
    // cannot be raced. server.ts's post-issue realpath comparison stays as an assertion only.
    const valid = stillSelf(directory)
    if (!valid.eligible) return { ...await probe(), grant: "ineligible", reason: ineligibleReason(valid.reason) }
    carry(directory, sidecar) // an attempt may already have produced a consumed token in this generation
    const result = await sidecar.grantWrite(directory)
    const fact = await probe()
    if (result.outcome === "failed") {
      noteFailed(sidecar, directory)
      return { ...fact, grant: "failed", reason: "grant-failed" }
    }
    if (failed.get(sidecar)?.delete(directory)) input.onWritableChanged({ server: target.server, directory })
    return { ...fact, grant: "granted" }
  }

  return {
    truthPath,
    quarantined,
    userOpened,
    async grantWrite(target, sidecar) {
      const { grant, reason } = await settle(target, sidecar, false)
      return { grant, ...(reason ? { reason } : {}) }
    },
    probeWrite: (target, sidecar) => settle(target, sidecar, true),
    async grantNewPath(target, sidecar) {
      if (sidecar ? !sidecar.fenced : process.platform !== "darwin") return { grant: "no-fence" }
      if (target.server !== LOCAL_SIDECAR_SERVER_KEY) return { grant: "not-local" }
      // Judged again now: created meanwhile (only by an unfenced process), a link, or a parent that is no longer HOME ends
      // at HOME's sentence — never at P as a folder (design v7 NP1 rule 5, R1-F1).
      const scope = planWriteApproval(input.eligibility, { absolute: target.path, directory: dirname(target.path) })
      if (!scope.eligible || scope.kind !== "new-path" || scope.root !== target.path)
        return { grant: "ineligible", reason: scope.eligible ? "not-opened-by-you" : ineligibleReason(scope.reason) }
      if (!sidecar) return { grant: "failed", reason: "grant-failed" }
      // The same issue rule as settle: what this generation writes, or another generation of this run could, is never issued.
      if (sidecar.generationWrites(target.path) || carriedFromOtherGenerations(target.path, sidecar)) return { grant: "granted" }
      carry(target.path, sidecar, "new-path") // an attempt may already have produced a consumed token in this generation
      const result = await sidecar.grantWrite(target.path, "new-path")
      return result.outcome === "failed" ? { grant: "failed", reason: "grant-failed" } : { grant: "granted" }
    },
    carriedWorkspaces: () => carriedOf("directory"),
    carriedNewPaths: () => carriedOf("new-path"),
    noteGeneration(generation, workspaces, newPaths) {
      for (const directory of workspaces) carry(directory, generation)
      for (const path of newPaths) carry(path, generation, "new-path")
    },
    noteRendererStoreSet(name, key, value) {
      const field = tabKey(name, key)
      if (!field) return
      state[field] = value
      recompute()
    },
    noteRendererStoreDelete(name, key) {
      const field = tabKey(name, key)
      if (!field) return
      state[field] = undefined
      recompute()
    },
    noteRendererStoreClear(name) {
      if (name !== GLOBAL_RENDERER_STORE) return
      state.tabs = undefined
      state.recent = undefined
      state.info = undefined
      recompute()
    },
  }
}
