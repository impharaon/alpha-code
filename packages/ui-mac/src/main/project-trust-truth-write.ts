// `#1709` —— 项目扩展信任记录的**写端**。只有 main 进程会 import 本文件(ext-ipc.ts 的 `ext-trust-check`,在用户于原生确认框里
// 做出决定之后);它**不得**进 sidecar / ext 的 import 闭包(project-trust-truth.test.ts 对着 process-fence-write-sites.ts 的
// relativeImportClosure 实测)。读法、形状与位置见 project-trust-truth.ts 文件头。
//
// 写:读出现有记录 → 改这一条 → 过读端同一份判据 → 临时文件 + 同目录 rename(原子:写到一半失败 ⇒ 盘上仍是旧内容)。
// 现有记录坏了(引擎写不到这里,不是攻击可达的状态)⇒ 出一行原因后从空开始:坏掉的那份里谁的决定都读不出来,保留它只会让
// 用户永远落不下新决定。记录目录是符号链接 ⇒ 拒写(读端也不跟它),由调用方走现有的「未能保存」提示。

import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { EXTENSIONS_CONSENT_VERSION } from "./codepuppy-ext-trust"
import {
  PROJECT_TRUST_TRUTH_VERSION,
  locateProjectTrustTruth,
  parseProjectTrustTruth,
  readProjectTrustTruth,
  type ProjectTrustIdentity,
  type ProjectTrustProjects,
} from "./project-trust-truth"

let tmpSeq = 0

/** 记下用户对这个项目(规范目录 + inode)的决定;granted 与 denied 都记。iso 由调用方注入(单测确定性)。 */
export function recordProjectTrustDecision(
  identity: ProjectTrustIdentity,
  granted: boolean,
  iso: string,
  log: (line: string) => void,
): { ok: true } | { ok: false; reason: string } {
  const location = locateProjectTrustTruth()
  if (!location.ok) return { ok: false, reason: `project trust record location unresolved — ${location.reason}` }
  const path = location.path
  try {
    if (lstatSync(dirname(path)).isSymbolicLink()) return { ok: false, reason: `${dirname(path)} is a symbolic link` }
  } catch {
    // 目录还不存在:下面建
  }
  const current = readProjectTrustTruth(path)
  if (!current.ok) log(`project trust: ${path} refused — ${current.reason}; rewriting it with this decision only`)
  const projects: ProjectTrustProjects = {
    ...(current.ok ? current.projects : {}),
    [identity.directory]: { ino: identity.ino, version: EXTENSIONS_CONSENT_VERSION, granted, decidedAt: iso },
  }
  const text = JSON.stringify({ v: PROJECT_TRUST_TRUTH_VERSION, projects }) + "\n"
  const check = parseProjectTrustTruth(text)
  if (!check.ok) return { ok: false, reason: `refusing to write ${path} — ${check.reason}` }
  const tmp = `${path}.${process.pid}.${++tmpSeq}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(tmp, text)
    renameSync(tmp, path)
    return { ok: true }
  } catch (error) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // 临时文件留着无害(读端只认 <env>.json);真正要报的是下面那个错
    }
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
