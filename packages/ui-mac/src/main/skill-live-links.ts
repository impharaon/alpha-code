// `#1667`(#1662 L5,编排器裁决 alpha-code#1666 → 1667 评论 6738814516 第 3 条):技能生成目录的稳定挂点。
//
// 技能每装一代就是一个新目录(`<当前环境根>/ext-store/skill--<name>/generations/<genId>`,`current.json` 指向 live 那一代,
// ext-transaction.ts)。如果把这些目录本身写进引擎配置的 `skills`,翻代后列表里还是旧路径,新一代要等 sidecar 重启才看得见
// (沙箱真引擎实测)。现在 main 在 `<当前环境根>/skills-live/` 下给每个已启用的技能键维护一个**固定路径的软链**,原子改指向
// (同目录下建临时链再 rename 盖上,临时名以 `.` 开头 —— 引擎扫技能时忽略点开头的项);配置的 `skills` 只列 `skills-live`
// 这一个目录。OpenCode 2 对技能源目录挂文件监听,并跟随其中的软链(`packages/core/src/config/plugin/skill.ts` 的
// `watchDirectory` / `SkillScan.scan`):翻代、新装、停用都在不重启的情况下生效(真引擎实测,injection-engine cases)。
//
// 哪些键、指向哪一代,全部取自 ext 的 `skillGenerationLiveDirs`(过账本 enabled 门、`current.json` 指针)—— 唯一来源,
// 这里只把它的结果挂成软链。不在其中的键(停用、卸载、账本读不出 ⇒ fail-closed 一个都不挂)其软链被撤掉;
// `skills-live` 里不是软链、或名字不是技能键形状的项一律不碰。
// 谁调用:sidecar 每次注入配置时(codepuppy-config-injection.ts),以及 main 每次请求引擎重载之前(reload-coordinator 的
// beforeRequest,ext-ipc.ts 接线)—— 安装、启用、停用、卸载、「现在重载」都经过那里。两个进程同时做也安全:各自从同一组
// 文件算出同一份结果,改指向是原子的 rename。
import * as fs from "node:fs"
import * as path from "node:path"
import { skillGenerationLiveDirs } from "../../../ext/src/gen-skill-paths"

export const SKILLS_LIVE_DIR = "skills-live"
const SKILL_KEY = /^skill--[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/

export type SkillLiveLinksResult = { dir: string; links: Record<string, string>; errors: string[] }

/** 让 `<root>/skills-live/<key>` 恰好是「每个已启用技能键 → 它的 live 生成目录」;返回目录与逐项错误(不抛)。 */
export function syncSkillLiveLinks(root: string): SkillLiveLinksResult {
  const dir = path.join(root, SKILLS_LIVE_DIR)
  const errors: string[] = []
  const links: Record<string, string> = {}
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (error) {
    return { dir, links, errors: [`cannot create ${dir}: ${describe(error)}`] }
  }
  for (const live of skillGenerationLiveDirs(root)) links[path.basename(path.dirname(path.dirname(live)))] = live

  let entries: string[] = []
  try {
    entries = fs.readdirSync(dir)
  } catch (error) {
    errors.push(`cannot list ${dir}: ${describe(error)}`)
  }
  for (const name of entries) {
    if (!SKILL_KEY.test(name) || name in links) continue
    const entry = path.join(dir, name)
    try {
      if (fs.lstatSync(entry).isSymbolicLink()) fs.unlinkSync(entry)
    } catch (error) {
      errors.push(`cannot remove stale link ${entry}: ${describe(error)}`)
    }
  }
  for (const [key, target] of Object.entries(links)) {
    const link = path.join(dir, key)
    try {
      if (readLink(link) === target) continue
      const temporary = path.join(dir, `.${key}.${process.pid}.tmp`)
      fs.rmSync(temporary, { force: true })
      fs.symlinkSync(target, temporary, "dir")
      fs.renameSync(temporary, link)
    } catch (error) {
      errors.push(`cannot point ${link} at ${target}: ${describe(error)}`)
    }
  }
  return { dir, links, errors }
}

function readLink(file: string): string | undefined {
  try {
    return fs.readlinkSync(file)
  } catch {
    return undefined
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
