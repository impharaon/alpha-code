// `#1376` —— sync-upstream 的「预期冲突」过滤表 与 north-star 守卫的清单 之间的**关系闸**。
//
// 这道门守的是什么(大白话):每天的上游同步任务遇到合并冲突时,会先把「我们预料到的冲突」
// 过滤掉(`.github/workflows/sync-upstream.yml` 里那行 `unexpected=…grep -v…`),剩下的才算
// 意外、才让同步中止。而「哪些文件算我们的」另有一份清单住在 `scripts/north-star-guard.sh`。
// 两份各自手写,仓里没有任何东西断言它们的关系 —— 哪天对不上,同步任务与检查脚本就会对同一个
// 文件给出相反的结论,而排查的人会以为是自己改错了。
//
// ── 勘破(2026-10-10,`origin/alpha`;`#1668` 起改写)—— 两份清单的关系 ─────────────────────
// 2026-10-10 时过滤表有 `packages/app/` `packages/ui/` 两条,与守卫的 carve-out ROUNDTRIP_PACKAGES="app ui"
// 是同一个事实的两份副本(冻结前端由 pin + SOT 补丁投影,冲突由合并后整体重写解决)。`#1668` 把冻结前端搬到
// Code Puppy 自有落点 `packages/codepuppy-{app,ui}`(上游没有这两条路径,进了 CODEPUPPY_OWNED_PACKAGES),
// 上游 `packages/{app,ui}` 回到普通上游路径:守卫撤掉 ROUNDTRIP_PACKAGES,sync 撤掉那两条过滤、删掉合并后
// 的重写。于是今天:
//   · 过滤表(2 条):`bun.lock`(整行)、`CHANGELOG.md`(整行,`#1664`)—— 都在守卫辖区(`packages`)之外,
//     守卫不判它们,两边不会对同一个文件给出相反结论;
//   · 上游 `packages/{app,ui}` 上的冲突**不是**预期冲突:alpha 不改它们,冲突即未登记的偏离,同步中止;
//   · CODEPUPPY_OWNED_PACKAGES 不在过滤表里 —— 上游没有这些包,合并不可能在它们上冲突;
//   · 收编白名单 UPSTREAM_EXCLUDES **全部不在**过滤表里 —— 有意的:收编文件是 alpha 改过的上游文件,上游一改
//     就是真冲突,过滤掉等于让 sync 自动选一边、静默丢掉一侧的改动。
// ⇒ 正确关系是三条,本文件逐条断言:
//   ① 过滤表里没有守卫辖区内(`packages/` 下)的条目 —— 任何一条都会把一个上游包(或 Code Puppy 自有包)上的
//     冲突当成预期冲突静默解决,`#1668` 之前的 `packages/{app,ui}/` 放行表就是这一形状;
//   ② 过滤表的每一条都落在守卫辖区外(守卫不判它 ⇒ 两边不会给出相反结论),辖区取自守卫本体的打印;
//   ③ 过滤表与收编白名单**不相交**:任何一条收编路径都不得被过滤表吞掉。
//
// 为什么选「加判据」而不是「让一份派生自另一份」:过滤表那行在 workflow 的冲突分支里,该分支
// 由 sync-upstream-merge-order.test.ts 以真 git 仓 + `bash -e` 跑本体判行为;让它在运行期去调
// 守卫脚本取清单,会给那条每天只在 GitHub 上、只在有冲突时才走到的路径多一个运行期依赖,而换来
// 的只是本文件这三条静态关系。
//
// 判据的取法:UPSTREAM_PATHS / CODEPUPPY_OWNED_PACKAGES 从**生产守卫的 `--print-jurisdiction`** 取
// (它就是为「别人不许再抄一份」而开的只读模式,`#1288`),收编白名单从守卫源码的那张数组解析
// (它没有打印模式;local-gate-parity.test.ts 用同一种解析)。每条正向断言都带变异臂:先证明
// 这个手段测得出已知的坏,再用它判今天的好。解析不到东西时抛「测量作废」,不空对空地绿。

import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, test } from "bun:test"

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..")
const SYNC_WORKFLOW_REL = ".github/workflows/sync-upstream.yml"
const GUARD_REL = "scripts/north-star-guard.sh"
const SYNC_WORKFLOW = readFileSync(resolve(REPO_ROOT, SYNC_WORKFLOW_REL), "utf8")
const GUARD_SOURCE = readFileSync(resolve(REPO_ROOT, GUARD_REL), "utf8")

type FilterEntry = { path: string; exact: boolean }
type Jurisdiction = { upstreamPaths: string[]; owned: string[] }

/** 过滤表那一行:`unexpected="$(echo "$conflicts" | grep -v '^X' | … || true)"`。必须恰好一行。 */
function parseFilter(workflow: string): FilterEntry[] {
  const lines = workflow.split("\n").filter((l) => /^\s*unexpected="\$\(/.test(l))
  if (lines.length !== 1) throw new Error(`测量作废:${SYNC_WORKFLOW_REL} 里 unexpected= 赋值有 ${lines.length} 行(应恰好 1 行)`)
  const entries = [...lines[0].matchAll(/grep -v '\^([^']+)'/g)].map((m) => {
    const raw = m[1]
    const exact = raw.endsWith("$")
    return { path: exact ? raw.slice(0, -1) : raw, exact }
  })
  if (entries.length === 0) throw new Error("测量作废:过滤表里一条 grep -v 都没解析到")
  return entries
}

function printJurisdiction(guardPath: string): Jurisdiction {
  const r = Bun.spawnSync(["bash", guardPath, "--print-jurisdiction"], { cwd: REPO_ROOT })
  if (r.exitCode !== 0) throw new Error(`测量作废:--print-jurisdiction 退出码 ${r.exitCode}:${r.stderr.toString()}`)
  const kv = new Map(
    r.stdout
      .toString()
      .trim()
      .split("\n")
      .map((l) => l.split("\t") as [string, string]),
  )
  const split = (k: string) => {
    const v = kv.get(k)?.trim()
    if (!v) throw new Error(`测量作废:--print-jurisdiction 没给出 ${k}`)
    return v.split(/\s+/)
  }
  return { upstreamPaths: split("UPSTREAM_PATHS"), owned: split("CODEPUPPY_OWNED_PACKAGES") }
}

function parseExcludes(guard: string): string[] {
  const block = /^UPSTREAM_EXCLUDES=\(\n([\s\S]*?)^\)/m.exec(guard)?.[1]
  if (!block) throw new Error("测量作废:守卫里没解析到 UPSTREAM_EXCLUDES 数组")
  const items = [...block.matchAll(/^\s*':\(exclude\)([^']+)'/gm)].map((m) => m[1])
  // `#1662`:最终清单可以很短(F10 允许为空),不再用条数下限防解析退化,改用两种独立读法互相核对。
  const lines = block.split("\n").filter((line) => /^\s+':\(exclude\)/.test(line)).length
  if (items.length !== lines) throw new Error(`测量作废:收编白名单解析到 ${items.length} 条,逐行数到 ${lines} 条`)
  return items
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)

/** 三条关系;返回违例清单(空 = 绿)。 */
function relationViolations(filter: FilterEntry[], j: Jurisdiction, excludes: string[]): string[] {
  const out: string[] = []
  const inJurisdiction = (p: string) => j.upstreamPaths.some((u) => under(p, u))
  // ① + ②:辖区内的条目会把一个包上的冲突静默解决;辖区外的条目守卫不判,两边不会给出相反结论。
  for (const e of filter) {
    if (!inJurisdiction(e.path)) continue
    const pkg = /^packages\/([^/]+)/.exec(e.path)?.[1]
    const whose = pkg && j.owned.includes(pkg) ? "Code Puppy 自有包" : "上游包"
    out.push(`①② 过滤表条目落在守卫辖区内(${whose}):${e.path} —— 这里的冲突会被当成预期冲突静默解决,而它应当作为未登记的偏离让同步中止`)
  }
  // ③
  for (const x of excludes) {
    for (const e of filter) {
      const hit = e.exact ? under(e.path, x) || e.path === x : under(x, e.path.replace(/\/$/, "")) || under(e.path, x)
      if (hit) out.push(`③ 收编路径 ${x} 被过滤表条目 ${e.path} 吞掉 —— 它的冲突会被当成预期冲突静默解决`)
    }
  }
  return out
}

function mutateFilter(workflow: string, edit: (line: string) => string): string {
  const next = workflow.replace(/^(\s*unexpected="\$\(.*)$/m, (l) => edit(l))
  if (next === workflow) throw new Error("测量作废:变异没改到过滤表那一行")
  return next
}

function guardCopy(edit: (src: string) => string): string {
  const dir = mkdtempSync(join(tmpdir(), "ns-guard-"))
  const path = join(dir, "north-star-guard.sh")
  copyFileSync(resolve(REPO_ROOT, GUARD_REL), path)
  const next = edit(GUARD_SOURCE)
  if (next === GUARD_SOURCE) throw new Error("测量作废:变异没改到守卫源码")
  writeFileSync(path, next)
  return path
}

const PROD_GUARD = resolve(REPO_ROOT, GUARD_REL)

describe("#1376 sync-upstream 过滤表 与 north-star 守卫清单 的关系", () => {
  test("解析自检:三份输入都解析得到,且过滤表今天就是 bun.lock 与 `#1664` 的 CHANGELOG.md 两条", () => {
    // `#1664`(编排器裁决,#1664 评论 6734550342):根 CHANGELOG.md 登记为第二个预期冲突(取我方)。
    // `#1668`:`packages/{app,ui}/` 两条已撤 —— 上游前端回到普通上游路径,冲突即未登记的偏离。
    expect(parseFilter(SYNC_WORKFLOW)).toEqual([
      { path: "bun.lock", exact: true },
      { path: "CHANGELOG.md", exact: true },
    ])
    const j = printJurisdiction(PROD_GUARD)
    expect(j.upstreamPaths).toEqual(["packages"])
    // 冻结前端的落点是 Code Puppy 自有包(`#1668`);上游的 app/ui 不在自有清单里。
    expect(j.owned).toEqual(expect.arrayContaining(["codepuppy-app", "codepuppy-ui"]))
    expect(j.owned).not.toContain("app")
    expect(j.owned).not.toContain("ui")
    // parseExcludes 自己核对两种读法一致。
    expect(parseExcludes(GUARD_SOURCE)).toContain("packages/core/src/oauth/page.ts")
  })

  test("今天的生产文件满足三条关系", () => {
    expect(relationViolations(parseFilter(SYNC_WORKFLOW), printJurisdiction(PROD_GUARD), parseExcludes(GUARD_SOURCE))).toEqual([])
  })

  test("变异臂 ①:过滤表放回 `#1668` 之前的 packages/app/ + packages/ui/ 放行 ⇒ 红,两条都点名", () => {
    const wf = mutateFilter(SYNC_WORKFLOW, (l) => l.replace(" | grep -v '^CHANGELOG.md$'", () => " | grep -v '^packages/app/' | grep -v '^packages/ui/' | grep -v '^CHANGELOG.md$'"))
    const v = relationViolations(parseFilter(wf), printJurisdiction(PROD_GUARD), parseExcludes(GUARD_SOURCE)).join("\n")
    expect(v).toContain("(上游包):packages/app/")
    expect(v).toContain("(上游包):packages/ui/")
  })

  test("变异臂 ①:过滤表放行一个 Code Puppy 自有包 ⇒ 红,并认出它是自有包(读的是守卫本体的打印)", () => {
    const wf = mutateFilter(SYNC_WORKFLOW, (l) => l.replace(" | grep -v '^CHANGELOG.md$'", () => " | grep -v '^packages/codepuppy-app/' | grep -v '^CHANGELOG.md$'"))
    const v = relationViolations(parseFilter(wf), printJurisdiction(PROD_GUARD), parseExcludes(GUARD_SOURCE)).join("\n")
    expect(v).toContain("(Code Puppy 自有包):packages/codepuppy-app/")
  })

  test("变异臂 ②:守卫辖区扩到过滤表的条目上(CHANGELOG.md)⇒ 红,且读的是守卫本体的打印", () => {
    const copy = guardCopy((s) => s.replace(/^UPSTREAM_PATHS="packages"$/m, 'UPSTREAM_PATHS="packages CHANGELOG.md"'))
    const j = printJurisdiction(copy)
    expect(j.upstreamPaths).toEqual(["packages", "CHANGELOG.md"])
    const v = relationViolations(parseFilter(SYNC_WORKFLOW), j, parseExcludes(GUARD_SOURCE)).join("\n")
    expect(v).toContain("落在守卫辖区内(上游包):CHANGELOG.md")
  })

  test("变异臂 ③:过滤表吞掉一条收编文件 ⇒ 红且点名", () => {
    const wf = mutateFilter(SYNC_WORKFLOW, (l) => l.replace("grep -v '^bun.lock$'", () => "grep -v '^bun.lock$' | grep -v '^packages/core/src/oauth/page.ts$'"))
    const v = relationViolations(parseFilter(wf), printJurisdiction(PROD_GUARD), parseExcludes(GUARD_SOURCE))
    expect(v.join("\n")).toContain("③ 收编路径 packages/core/src/oauth/page.ts")
  })

  test("变异臂 ③:守卫新增一条收编、恰好落在过滤表条目上 ⇒ 红", () => {
    const excludes = parseExcludes(guardCopyText((s) => s.replace("UPSTREAM_EXCLUDES=(\n", "UPSTREAM_EXCLUDES=(\n  ':(exclude)CHANGELOG.md'\n")))
    const v = relationViolations(parseFilter(SYNC_WORKFLOW), printJurisdiction(PROD_GUARD), excludes)
    expect(v.join("\n")).toContain("③ 收编路径 CHANGELOG.md")
  })
})

function guardCopyText(edit: (src: string) => string): string {
  const next = edit(GUARD_SOURCE)
  if (next === GUARD_SOURCE) throw new Error("测量作废:变异没改到守卫源码")
  return next
}
