// I-09 一次性换算:scripts/old-name-exceptions.tsv 从「文件 ⇥ 行号 ⇥ 类别 ⇥ 理由」换成
// 「文件 ⇥ 命中词元 ⇥ 处数 ⇥ 类别 ⇥ 理由」。用完即删(换算提交里保留,供复现)。
//
// 每一行登记先在工作树上按行号取那一行;那一行不是旧名命中(行号漂移),就用 git blame 找到写下这行登记
// 的提交 C,取 C 上那个文件的同一行 —— 登记者当时对着的就是那一行。两处都不命中 ⇒ 整体失败并列出,不猜。
//
// 用法:bun scripts/old-name-exceptions-convert.ts            (写回登记表并打印对账报告)
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { FILE_NAME_HIT, OLD_NAME, hitTokens } from "../packages/ui-mac/src/main/old-name-scan"

const ROOT = resolve(import.meta.dir, "..")
const REGISTRY = "scripts/old-name-exceptions.tsv"

function git(args: string[]): string | undefined {
  const r = Bun.spawnSync(["git", ...args], { cwd: ROOT })
  return r.exitCode === 0 ? r.stdout.toString() : undefined
}

const raw = readFileSync(join(ROOT, REGISTRY), "utf8").split("\n")
const blameOut = git(["blame", "--line-porcelain", "HEAD", "--", REGISTRY])
if (!blameOut) throw new Error("git blame 失败")
const commitOf: string[] = []
for (const line of blameOut.split("\n")) {
  const m = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line)
  if (m) commitOf[Number(m[2])] = m[1]!
}

const fileCache = new Map<string, string[] | undefined>()
function linesAt(rev: string | undefined, path: string): string[] | undefined {
  const key = `${rev ?? "WORKTREE"}:${path}`
  if (!fileCache.has(key)) {
    let text: string | undefined
    if (rev) text = git(["show", `${rev}:${path}`])
    else {
      try {
        text = readFileSync(join(ROOT, path), "utf8")
      } catch {
        text = undefined
      }
    }
    fileCache.set(key, text?.split("\n"))
  }
  return fileCache.get(key)
}

type Out = { path: string; tokens: string; category: string; reason: string; count: number }
const out = new Map<string, Out>()
const failures: string[] = []
let atWorktree = 0
let viaBlame = 0
let rows = 0

raw.forEach((line, i) => {
  if (!line || line.startsWith("#")) return
  rows++
  const [path, lineNo, category, reason] = line.split("\t") as [string, string, string, string]
  const n = Number(lineNo)
  let tokens: string | undefined
  if (n === 0) {
    tokens = FILE_NAME_HIT
    atWorktree++
  } else {
    const here = linesAt(undefined, path)?.[n - 1]
    if (here !== undefined && OLD_NAME.test(here)) {
      tokens = hitTokens(here)
      atWorktree++
    } else {
      const commit = commitOf[i + 1]
      const then = commit ? linesAt(commit, path)?.[n - 1] : undefined
      if (then !== undefined && OLD_NAME.test(then)) {
        tokens = hitTokens(then)
        viaBlame++
      }
    }
  }
  if (!tokens) {
    failures.push(`${REGISTRY}:${i + 1} ${path}:${n}(工作树与登记提交 ${commitOf[i + 1]?.slice(0, 10)} 上都不是旧名命中)`)
    return
  }
  const key = [path, tokens, category, reason].join("\t")
  const entry = out.get(key)
  if (entry) entry.count++
  else out.set(key, { path, tokens, category, reason, count: 1 })
})

if (failures.length) {
  console.error(`换算失败:${failures.length} 行解析不出来,一行都不写回:\n${failures.join("\n")}`)
  process.exit(1)
}

const header = raw.slice(0, raw.findIndex((l) => l && !l.startsWith("#")))
const body = [...out.values()].map((e) => [e.path, e.tokens, String(e.count), e.category, e.reason].join("\t"))
writeFileSync(join(ROOT, REGISTRY), [...header, ...body, ""].join("\n"))
const total = [...out.values()].reduce((s, e) => s + e.count, 0)
console.log(
  `换算完成:旧表 ${rows} 行,工作树直接解析 ${atWorktree} 行,经 blame 解析 ${viaBlame} 行,失败 0 行;` +
    `新表 ${out.size} 行,处数合计 ${total}(= 旧表行数:${total === rows})`,
)
