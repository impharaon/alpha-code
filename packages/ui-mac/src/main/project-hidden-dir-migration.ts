// 打开项目时把旧隐藏目录 `.code-puppy/` 改成 `.codepuppy/`(alpha-code#1569 AC7;方案 §6、R4、R19、R20-9)。
//
// 只在 prod / beta 渠道写(index.ts 在升级迁移就绪后调一次 configure);未配置(dev、测试、Windows)时只判不写。
// 每次解析项目都检查并补完子步骤 —— 不以「新目录已在」当作迁完(R19):
//   ① 旧目录在(真目录、非链接)且新目录不在 ⇒ 改名;两个都在 ⇒ 冲突,不合并、不读旧目录;
//   ② 新目录下 `alpha.jsonc` 在而 `codepuppy.jsonc` 不在 ⇒ 改名;两个都在 ⇒ 冲突;
//   ③ `codepuppy.jsonc` 里指向旧目录的路径串、项目 `installs.json` 的 `files[]` 前缀 ⇒ 改写(R4)。
// 本次有任何改动 ⇒ 向迁移目录的 `projects.log` 追加一行,供手工回退。
//
// 写盘只经 naming-migration-fs 的白名单端口,而且这个端口由 index.ts 在 configure 时**注入**、本模块不 import 它:
// 本模块经 codepuppy-workdir.ts 进了 sidecar 的 import 闭包,围栏写入点登记簿(process-fence-write-sites)
// 不许那里出现只有 main 才执行的写入点;sidecar 从不 configure,于是在那边只判不写。读用 node:fs 的读接口。
import { lstatSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { applyEdits, parseTree, type Edit, type JSONPath, type Node, type ParseError } from "jsonc-parser"
import { PROJECT_HIDDEN_DIR } from "../shared/project-hidden-dir"
import type { MigrationFs, WriteAllowList } from "./naming-migration-fs"
import { ENV_CONFIG, LEGACY_ENV_CONFIG, LEGACY_PROJECT_HIDDEN_DIR } from "./naming-migration-map"

export type ProjectHiddenDirAdoption = { kind: "none" | "migrated" } | { kind: "conflict" | "pending"; reason: string }

let writer: { logPath: string; fs: (allow: WriteAllowList) => MigrationFs } | undefined
/** 已核验过内容的文件 → 当时的 mtime;mtime 没变就不再全文扫描(存在性检查每次都做)。 */
const verified = new Map<string, number>()

export function configureProjectHiddenDirMigration(input: { logPath: string; fs: (allow: WriteAllowList) => MigrationFs } | undefined): void {
  writer = input
  verified.clear()
}

export function adoptLegacyProjectHiddenDir(project: string, now: () => Date = () => new Date()): ProjectHiddenDirAdoption {
  const legacy = join(project, LEGACY_PROJECT_HIDDEN_DIR)
  const current = join(project, PROJECT_HIDDEN_DIR)
  const log = writer?.logPath
  const fs = writer?.fs({ trees: [legacy, current, ...(log ? [dirname(log)] : [])] })
  const legacyIsDir = lstat(legacy)?.isDirectory() === true
  if (legacyIsDir && lstat(current)) return conflict(`项目里 ${legacy} 和 ${current} 同时存在,不会合并,也不会读旧目录。请保留其中一个后重新打开项目。`)

  const done: string[] = []
  if (legacyIsDir) {
    if (!fs || !log) return pending(`项目里还是旧目录 ${legacy},这个版本不迁移它`)
    renameUnlessDone(fs, legacy, current)
    done.push("rename-dir")
  }
  if (lstat(current)?.isDirectory()) {
    const oldConfig = join(current, LEGACY_ENV_CONFIG)
    const config = join(current, ENV_CONFIG)
    if (lstat(oldConfig)) {
      if (lstat(config)) return conflict(`${oldConfig} 和 ${config} 同时存在,不知道该用哪一份。请保留其中一个后重新打开项目。`)
      if (!fs || !log) return pending(`${oldConfig} 还没改名,这个版本不迁移它`)
      renameUnlessDone(fs, oldConfig, config)
      done.push("rename-config")
    }
    const rewritePath = (value: string) => {
      for (const prefix of [`./${LEGACY_PROJECT_HIDDEN_DIR}/`, `${LEGACY_PROJECT_HIDDEN_DIR}/`, `${legacy}/`])
        if (value.startsWith(prefix)) return `${prefix.slice(0, -LEGACY_PROJECT_HIDDEN_DIR.length - 1)}${PROJECT_HIDDEN_DIR}/${value.slice(prefix.length)}`
      return undefined
    }
    for (const [file, step] of [
      [config, "rewrite-config"],
      [join(current, "installs.json"), "rewrite-installs"],
    ] as const) {
      if (!lstat(file) || verified.get(file) === statSync(file).mtimeMs) continue
      const text = readFileSync(file, "utf8")
      const next = editJsonText(text, { value: (path, value) => (step === "rewrite-config" || path.includes("files") ? rewritePath(value) : undefined) })
      if (next !== text) {
        if (!fs || !log) return pending(`${file} 里还有指向旧目录的路径,这个版本不迁移它`)
        fs.writeAtomic(file, next)
        done.push(step)
      }
      verified.set(file, statSync(file).mtimeMs)
    }
  }
  if (done.length === 0 || !fs || !log) return { kind: "none" }
  fs.mkdir(dirname(log))
  fs.append(log, `${now().toISOString()}\t${project}\t${done.join(",")}\n`)
  return { kind: "migrated" }
}

function lstat(p: string) {
  try {
    return lstatSync(p)
  } catch {
    return undefined
  }
}

/** 并发:别处(另一个窗口的同一次解析)已经改完 ⇒ 视为已迁。 */
function renameUnlessDone(fs: MigrationFs, from: string, to: string) {
  try {
    fs.rename(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && fs.exists(to)) return
    throw error
  }
}

const conflict = (reason: string): ProjectHiddenDirAdoption => ({ kind: "conflict", reason })
const pending = (reason: string): ProjectHiddenDirAdoption => ({ kind: "pending", reason })

/** JSON(C) 精确改写:只替换命中的键 / 字符串值的那几个字节,注释与格式原样(启动迁移与项目目录迁移共用)。 */

export function editJsonText(
  text: string,
  edits: { key?: (path: JSONPath, key: string) => string | undefined; value?: (path: JSONPath, value: string) => string | undefined },
): string {
  const errors: ParseError[] = []
  const root = parseTree(text, errors, { allowTrailingComma: true })
  if (!root || errors.length > 0) throw new Error("file is not parseable JSON")
  const out: Edit[] = []
  const walk = (node: Node, path: JSONPath) => {
    if (node.type === "object")
      for (const property of node.children ?? []) {
        const [keyNode, valueNode] = property.children ?? []
        if (!keyNode) continue
        const key = String(keyNode.value)
        const renamed = edits.key?.(path, key)
        if (renamed !== undefined && renamed !== key) out.push({ offset: keyNode.offset, length: keyNode.length, content: JSON.stringify(renamed) })
        if (valueNode) walk(valueNode, [...path, key])
      }
    if (node.type === "array") (node.children ?? []).forEach((child, index) => walk(child, [...path, index]))
    if (node.type === "string") {
      const next = edits.value?.(path, String(node.value))
      if (next !== undefined && next !== node.value) out.push({ offset: node.offset, length: node.length, content: JSON.stringify(next) })
    }
  }
  walk(root, [])
  return applyEdits(text, out)
}
