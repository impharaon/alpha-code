// 升级迁移模块唯一的写盘出口(alpha-code#1569 AC8)。
// 迁移代码(naming-migration*.ts、project-hidden-dir-migration.ts)不直接调用任何 fs 写原语,一律经这里;
// 每次写之前判目标在不在白名单里 —— userData、新旧全局根、引擎库及其旁件、被打开项目的隐藏目录 —— 不在 ⇒ 抛,
// 一个字节都不落。读接口不设限。electron-free。
import * as fs from "node:fs"
import * as path from "node:path"
import { writeFileAtomicSync } from "./ext-atomic-fs"

export type MigrationFs = {
  /** lstat 判在场:悬空链接也算在场(改名目标被占就是被占)。 */
  exists(p: string): boolean
  isDirectory(p: string): boolean
  isSymlink(p: string): boolean
  readText(p: string): string
  readdir(p: string): string[]
  mtimeMs(p: string): number
  rename(from: string, to: string): void
  copy(from: string, to: string): void
  writeAtomic(p: string, data: string): void
  append(p: string, data: string): void
  mkdir(p: string): void
  remove(p: string): void
}

/** 白名单:`trees` 下任意深度;`files` 逐个精确;`prefixes` 按绝对路径字符串前缀(库的 `.corrupt-<ts>` 旁件)。 */
export type WriteAllowList = { trees: readonly string[]; files?: readonly string[]; prefixes?: readonly string[] }

export function createMigrationFs(allow: WriteAllowList): MigrationFs {
  const guard = (target: string) => {
    const p = path.resolve(target)
    const ok =
      allow.trees.some((root) => p === root || p.startsWith(root + path.sep)) ||
      (allow.files ?? []).includes(p) ||
      (allow.prefixes ?? []).some((prefix) => p.startsWith(prefix))
    if (!ok) throw new Error(`naming migration refused to write outside its allow-list: ${p}`)
    return p
  }
  const lstat = (p: string) => {
    try {
      return fs.lstatSync(p)
    } catch {
      return undefined
    }
  }
  return {
    exists: (p) => lstat(p) !== undefined,
    isDirectory: (p) => lstat(p)?.isDirectory() === true,
    isSymlink: (p) => lstat(p)?.isSymbolicLink() === true,
    readText: (p) => fs.readFileSync(p, "utf8"),
    readdir: (p) => fs.readdirSync(p),
    mtimeMs: (p) => fs.statSync(p).mtimeMs,
    rename: (from, to) => {
      guard(from)
      fs.renameSync(from, guard(to))
    },
    copy: (from, to) => fs.copyFileSync(from, guard(to)),
    writeAtomic: (p, data) => writeFileAtomicSync(guard(p), data, { mode: 0o600 }),
    append: (p, data) => fs.appendFileSync(guard(p), data, { mode: 0o600 }),
    mkdir: (p) => void fs.mkdirSync(guard(p), { recursive: true, mode: 0o700 }),
    remove: (p) => fs.rmSync(guard(p), { force: true }),
  }
}
