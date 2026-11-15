// `#1709` —— 项目扩展信任记录(REQ-060 信任门)的**读端**。只有 main 写(project-trust-truth-write.ts),
// main 与 sidecar 里的 @codepuppy/ext 都从这里读。
//
// ── 为什么搬家 ───────────────────────────────────────────────────────────────────
// 记录原先住在项目自己的 `.codepuppy/prefs.json`(`extensionsConsent`),ext 只看里面写没写 `granted: true` —— 仓库自带一份,
// 打开就被当成用户同意过:项目插件在引擎进程里执行、项目 MCP 启动、项目 agent 改写审批规则,确认框都不出现。
// 现在记录在 `<appData>/codepuppy-state/project-trust/<env>.json`:与 `env/`、`cas/`、`fence-workspaces/`、`custom-providers/`
// 同级,父目录是 codepuppy-environment.ts 的 `casBaseRoot`;引擎进程的围栏可写根 W2 只放行 `env/<env>`、W3 是 `<userData>`,
// 都罩不到这里(project-trust-truth-fence.test.ts 交给真 sandbox-exec 裁)。项目目录里的任何文件都不再被读来判信任,
// 旧的 `extensionsConsent` 不迁移、不删除,也没人再读。
//
// ── 形状 ─────────────────────────────────────────────────────────────────────
// `{ "v": 1, "projects": { "<规范项目目录>": { "ino": "<目录 inode,十进制>", "version": <告知版本>, "granted": bool, "decidedAt": "<ISO>" } } }`。
// 身份 = 规范目录(main resolveProjectCodePuppyRoot 与 ext projectDirectoryIdentity 各自算出的同一个 realpath)+ 目录 inode:
// 改名 / 移动 / 复制 / 第二个检出 / 删掉后在原路径重建或重新克隆 ⇒ 查不到 ⇒ 未同意。`version` 与 granted / denied 的语义在
// codepuppy-ext-trust.ts(一处定义,main 与 ext 共用)。
//
// 读:**严格** —— 缺失 = 没有任何决定(正常,不出声);解析失败 / 形状不对 / 记录文件或它的目录是符号链接 ⇒ 「没问出来」,
// 一个项目都不信任,并出一行原因。不猜、不修、不改写。
//
// 本文件零写盘(只用 node:fs 的读 API);写端不得进 sidecar / ext 的 import 闭包(project-trust-truth.test.ts 实测)。electron-free。

import { lstatSync, readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, normalize, resolve } from "node:path"
import { resolveCodePuppyStateBase, type AppEnvironment } from "./codepuppy-environment"

export const PROJECT_TRUST_DIRNAME = "project-trust"
export const PROJECT_TRUST_TRUTH_VERSION = 1

/** 一个项目目录的身份:规范绝对路径 + 目录 inode(十进制字符串,不丢精度)。 */
export type ProjectTrustIdentity = { directory: string; ino: string }
export type ProjectTrustEntry = { ino: string; version: number; granted: boolean; decidedAt: string }
export type ProjectTrustProjects = Record<string, ProjectTrustEntry>
/** `malformed`:文件读出来了但形状不对(只有这种情况写端才从空开始);读不出来 / 是符号链接 ⇒ false。 */
export type ProjectTrustRead =
  | { ok: true; absent: boolean; projects: ProjectTrustProjects }
  | { ok: false; reason: string; malformed: boolean }

const TOP_KEYS = ["v", "projects"]
const ENTRY_KEYS = ["ino", "version", "granted", "decidedAt"]

/** `<casBaseRoot>/project-trust/<env>.json`(见文件头)。 */
export function projectTrustTruthPath(casBaseRoot: string, environment: AppEnvironment): string {
  return resolve(casBaseRoot, PROJECT_TRUST_DIRNAME, `${environment}.json`)
}

/** 本进程的记录位置:main 走冻结快照,sidecar 走启动文档 `paths.globalRoot` 的逆映射;形状不对 ⇒ ok:false,不猜。 */
export function locateProjectTrustTruth(): { ok: true; path: string } | { ok: false; reason: string } {
  const base = resolveCodePuppyStateBase("project trust record")
  if (!base.ok) return base
  return { ok: true, path: projectTrustTruthPath(base.casBaseRoot, base.environment) }
}

/** 调用方传入已核过身份的规范项目目录;inode 拿不到 ⇒ undefined。 */
export function projectTrustIdentity(directory: string): ProjectTrustIdentity | undefined {
  try {
    return { directory, ino: statSync(directory, { bigint: true }).ino.toString() }
  } catch {
    return undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const sameKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
const errorCode = (error: unknown) => (error && typeof error === "object" && "code" in error ? (error as { code: unknown }).code : undefined)

/** 整份记录的结构判据:合法 ⇒ 全部条目,否则一句点名哪里不对的原因。写端落盘前过的也是这一份。 */
export function parseProjectTrustTruth(text: string): { ok: true; projects: ProjectTrustProjects } | { ok: false; reason: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, reason: `not JSON (${errorMessage(error)})` }
  }
  if (!isRecord(parsed) || !sameKeys(parsed, TOP_KEYS)) return { ok: false, reason: "top level is not exactly { v, projects }" }
  if (parsed.v !== PROJECT_TRUST_TRUTH_VERSION) return { ok: false, reason: `unknown version ${JSON.stringify(parsed.v)}` }
  if (!isRecord(parsed.projects)) return { ok: false, reason: "`projects` is not an object" }
  const projects: ProjectTrustProjects = {}
  for (const [directory, entry] of Object.entries(parsed.projects)) {
    const label = JSON.stringify(directory)
    if (!isAbsolute(directory) || normalize(directory) !== directory) return { ok: false, reason: `${label} is not a normalized absolute directory` }
    if (!isRecord(entry) || !sameKeys(entry, ENTRY_KEYS)) return { ok: false, reason: `${label} is not exactly { ino, version, granted, decidedAt }` }
    if (typeof entry.ino !== "string" || !/^\d+$/.test(entry.ino)) return { ok: false, reason: `${label}.ino is not a decimal string` }
    if (typeof entry.version !== "number" || !Number.isInteger(entry.version) || entry.version < 1)
      return { ok: false, reason: `${label}.version is not a positive integer` }
    if (typeof entry.granted !== "boolean") return { ok: false, reason: `${label}.granted is not a boolean` }
    if (typeof entry.decidedAt !== "string" || entry.decidedAt.length === 0) return { ok: false, reason: `${label}.decidedAt is not a non-empty string` }
    projects[directory] = { ino: entry.ino, version: entry.version, granted: entry.granted, decidedAt: entry.decidedAt }
  }
  return { ok: true, projects }
}

/** 读一份记录文件(见文件头的读法)。记录目录或文件是符号链接 ⇒ 拒,不跟过去。 */
export function readProjectTrustTruth(path: string): ProjectTrustRead {
  for (const endpoint of [dirname(path), path]) {
    try {
      if (lstatSync(endpoint).isSymbolicLink()) return { ok: false, reason: `${endpoint} is a symbolic link`, malformed: false }
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { ok: true, absent: true, projects: {} }
      return { ok: false, reason: `${endpoint} cannot be inspected (${errorMessage(error)})`, malformed: false }
    }
  }
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { ok: true, absent: true, projects: {} }
    return { ok: false, reason: `${path} cannot be read (${errorMessage(error)})`, malformed: false }
  }
  const parsed = parseProjectTrustTruth(text)
  return parsed.ok ? { ok: true, absent: false, projects: parsed.projects } : { ok: false, reason: parsed.reason, malformed: true }
}

/** 这个项目登记过的条目:规范目录逐字相等且 inode 相等才算;没有 ⇒ undefined。告知版本由 codepuppy-ext-trust.ts 判。 */
export function projectTrustEntry(projects: ProjectTrustProjects, identity: ProjectTrustIdentity): ProjectTrustEntry | undefined {
  const entry = Object.hasOwn(projects, identity.directory) ? projects[identity.directory] : undefined
  return entry && entry.ino === identity.ino ? entry : undefined
}

/** 生产读取:定位 + 读 + 查这一个项目。任何「没问出来」都当作没有决定,并出一行原因;缺失不出声。 */
export function readProjectTrustEntry(identity: ProjectTrustIdentity, log: (line: string) => void = defaultLog): ProjectTrustEntry | undefined {
  const location = locateProjectTrustTruth()
  if (!location.ok) {
    log(`project trust: record location unresolved — ${location.reason}; no project is trusted`)
    return undefined
  }
  const read = readProjectTrustTruth(location.path)
  if (!read.ok) {
    log(`project trust: ${location.path} refused — ${read.reason}; no project is trusted`)
    return undefined
  }
  return projectTrustEntry(read.projects, identity)
}

/** sidecar 里没有 electron-log:console.warn 走 utilityProcess 的 stderr,由 main 收进 sidecar 日志;main 侧调用方传自己的 logger。 */
function defaultLog(line: string): void {
  console.warn(line)
}
