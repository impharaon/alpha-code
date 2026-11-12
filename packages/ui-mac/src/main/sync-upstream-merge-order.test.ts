// `#1272` —— `.github/workflows/sync-upstream.yml` 里「Merge `dev` into `alpha`」那一步的**行为闸**。
//
// 这道门守的是什么(大白话):每天 06:00 UTC 那条上游同步流水线,在**遇到冲突**时会走一条与
// 平时完全不同的分支 —— 它只在 GitHub 上、只在有冲突时才走到,改坏了不会有任何东西变红。
//
// `#1668` 改了这一步的形状:冻结前端搬到 Code Puppy 自有落点 `packages/codepuppy-{app,ui}`(上游没有
// 这两条路径),上游 2.x 的 `packages/{app,ui}` 原样留着、Code Puppy 不用。原来每次合并后把
// `packages/{app,ui}` 还原成「pin + SOT 补丁」的 `apply_codepuppy_frontend_delta` 随之删除,`#1272` 当初
// 钉的「补丁必须先于 install」不再有对象。剩下要钉的行为:
//   · 干净合并 ⇒ exit 0、这一步**不跑** install(它在后面的 Engine smoke 步),上游 `packages/app` 原样合进来,
//     冻结前端落点一个字节不动;
//   · 预期冲突(`bun.lock`、根 `CHANGELOG.md`)⇒ 结束合并后**才** install,并把重生的 lockfile 落进提交;
//   · `packages/{app,ui}` 上的冲突**不再是预期冲突**:alpha 不改它们,冲突即未登记的偏离 ⇒ 点名、abort、
//     exit 1、不跑 install(控制组:放回旧的 app/ui 放行表 ⇒ 冲突标记被原样提交、exit 0);
//   · 其余意外冲突照旧 abort。
//
// 为什么判据长这样:
//   · **不断言 YAML 源码文本。** 用 `Bun.YAML` 从**生产 workflow 里解析出那一步的 `run` 体**,在真 git 仓上用
//     `bash -e` 跑它本体(Actions 对不写 `shell:` 的 `run:` 用的就是 `bash -e {0}`),断言**行为**。
//   · **先证明这个手段能测出已知的坏。** 每条「拒绝」都带控制组:把生产 body 改回已知的坏形状,同一夹具
//     必须走出另一种结局;变异没改到字节时抛「测量作废」。
//
// 删掉本文件会失去什么:那一步退回零行为判据 —— install 被删、干净分支被改成也跑 install、
// app/ui 冲突被重新放行,都不会有任何东西变红。它因此登记在 scripts/gate-files.tsv 里,拿精确条数。

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname } from "node:path"
import { describe, expect, test } from "bun:test"

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..")
const WORKFLOW = resolve(REPO_ROOT, ".github/workflows/sync-upstream.yml")
/** 生产那一步的名字前缀(整名带反引号,前缀足够唯一)。 */
const MERGE_STEP = "Merge `dev` into `alpha`"

/**
 * 完全隔离的 git 环境(与 frontend-patch-roundtrip.test.ts 同源的理由):
 *  ① 开发机的 ~/.gitconfig 不许影响判据;
 *  ② 反过来 —— 本测试**结构上不可能**写到本仓的 .git/config 或当前分支。
 */
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "alpha ci fixture",
  GIT_AUTHOR_EMAIL: "fixture@alpha.invalid",
  GIT_COMMITTER_NAME: "alpha ci fixture",
  GIT_COMMITTER_EMAIL: "fixture@alpha.invalid",
} as const

/** 冻结前端落点里的一个文件(alpha 自有;上游没有这条路径)。 */
const FROZEN_APP = "packages/codepuppy-app/src/app.tsx"
const FROZEN_BODY = "export function App() {\n  return AppSurfaces() // frozen 0.1.26 frontend\n}\n"
/** Code Puppy 自己的发布历史(根 CHANGELOG.md 的我方版本)。 */
const CODEPUPPY_CHANGELOG = "# Changelog\n\n> 只记用户可见变化。\n\n## [0.1.26] - 2026-11-05\n"

// ── 生产 body 的取出 ────────────────────────────────────────────────────────────

function mergeStepBody(): string {
  const doc = Bun.YAML.parse(readFileSync(WORKFLOW, "utf8")) as any
  const steps = doc?.jobs?.candidate?.steps
  if (!Array.isArray(steps)) throw new Error("sync-upstream.yml 里读不出 jobs.candidate.steps —— 本次测量作废,不是通过")
  const step = steps.find((s: any) => typeof s?.name === "string" && s.name.startsWith(MERGE_STEP))
  if (!step || typeof step.run !== "string" || step.run.trim().length === 0)
    throw new Error(`sync-upstream.yml 里找不到「${MERGE_STEP} …」那一步的 run 体 —— 本次测量作废,不是通过`)
  if (typeof step.shell === "string")
    throw new Error(`那一步声明了 shell: ${step.shell} —— 本夹具按 Actions 默认的 \`bash -e {0}\` 跑,语义已漂,本次测量作废`)
  return step.run
}

/** 把 `#1668` 之前的 app/ui 冲突放行表放回去 —— 「已知的坏」(冻结前端搬走之后,那两个目录不该再有冲突)。 */
function withLegacyAppUiAllowance(body: string): string {
  const anchor = " | grep -v '^CHANGELOG.md$'"
  if (body.split(anchor).length !== 2) throw new Error("生产 body 里找不到唯一的 CHANGELOG.md 过滤 —— 控制组构造不出来,本次测量作废")
  // 函数式替换:锚点里有 `$'`,字符串替换会把它当成特殊模式。
  return body.replace(anchor, () => ` | grep -v '^packages/app/' | grep -v '^packages/ui/'${anchor}`)
}

// ── 夹具 ────────────────────────────────────────────────────────────────────────

type Fixture = { repo: string; work: string; bin: string; log: string }
type Shape = {
  /**
   * 冲突形态:lock = 只有 bun.lock 冲突;none = 干净合并;app = alpha 改过上游 packages/app、上游也改了同一处;
   * unexpected = 冲突落在引擎文件上
   */
  conflict: "lock" | "none" | "app" | "unexpected"
  /** alpha 与上游都改了根 CHANGELOG.md(两份不相干的文档)—— 冲突必然发生 */
  changelog?: boolean
}

function git(cwd: string, args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...GIT_ENV } })
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} 失败:${r.stderr.toString()}${r.stdout.toString()}`)
  return r.stdout.toString().trim()
}

function write(repo: string, path: string, body: string | Uint8Array) {
  mkdirSync(dirname(join(repo, path)), { recursive: true })
  writeFileSync(join(repo, path), body)
}

function commitAll(repo: string, message: string): string {
  git(repo, ["add", "-A"])
  git(repo, ["commit", "-q", "-m", message])
  return git(repo, ["rev-parse", "HEAD"])
}

/** 假 `bun`:只实现 install —— 记下这次调用,并像真 install 一样重写 lockfile。 */
const BUN_STUB = `#!/usr/bin/env bash
set -u
log="\${BUN_STUB_LOG:?}"
if [ "\${1:-}" != "install" ]; then
  echo "other|\$*" >> "\$log"
  echo "stub bun: 只实现了 install,收到:\$*" >&2
  exit 2
fi
echo "install" >> "\$log"
printf '  "//": "regenerated-by-install"\\n' >> bun.lock
exit 0
`

/**
 * 夹具形状 —— 真实世界的缩比:
 *
 *   dev           上游:packages/{app,ui}、引擎文件、bun.lock
 *   alpha         + 冻结前端落点 packages/codepuppy-app(上游没有)+ frontend/ + alpha 侧 bun.lock
 *   dev 前进      按 Shape 造出各种冲突 / 干净合并
 */
function fixture(shape: Shape): Fixture {
  const work = mkdtempSync(join(tmpdir(), "codepuppy-sync-order-"))
  const repo = join(work, "repo")
  const bin = join(work, "bin")
  const log = join(work, "bun-calls.log")
  mkdirSync(repo, { recursive: true })
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, "bun"), BUN_STUB)
  chmodSync(join(bin, "bun"), 0o755)

  git(repo, ["init", "-q", "-b", "dev"])
  write(repo, "packages/app/src/app.tsx", "export function App() {\n  return null // upstream\n}\n")
  write(repo, "packages/ui/src/button.tsx", "export const button = 1\n")
  write(repo, "packages/opencode/src/engine.ts", "export const engine = 1\n")
  if (shape.changelog) write(repo, "CHANGELOG.md", "# Changelog\n\nRelease notes for OpenCode V2, newest first.\n")
  write(repo, "bun.lock", '{\n  "lockfileVersion": 1,\n  "upstream": true\n}\n')
  const pin = commitAll(repo, "upstream")

  git(repo, ["checkout", "-q", "-b", "alpha"])
  write(repo, FROZEN_APP, FROZEN_BODY)
  write(repo, "frontend/frontend-pin.lock", `pin=${pin} # fixture\n`)
  write(repo, "bun.lock", '{\n  "lockfileVersion": 1,\n  "codepuppy-workspaces": true\n}\n')
  if (shape.conflict === "app") write(repo, "packages/app/src/app.tsx", "export function App() {\n  return null // alpha edit\n}\n")
  if (shape.conflict === "unexpected") write(repo, "packages/opencode/src/engine.ts", "export const engine = 2 // alpha\n")
  if (shape.changelog) write(repo, "CHANGELOG.md", CODEPUPPY_CHANGELOG)
  commitAll(repo, "alpha")

  git(repo, ["checkout", "-q", "dev"])
  if (shape.conflict === "lock" || shape.conflict === "app")
    write(repo, "bun.lock", '{\n  "lockfileVersion": 1,\n  "upstream": "v2"\n}\n')
  if (shape.conflict === "app" || shape.conflict === "none")
    write(repo, "packages/app/src/app.tsx", "export function App() {\n  return null // upstream v2\n}\n")
  if (shape.conflict === "unexpected") write(repo, "packages/opencode/src/engine.ts", "export const engine = 3 // upstream\n")
  if (shape.conflict === "none") write(repo, "packages/opencode/src/engine.ts", "export const engine = 9 // upstream only\n")
  if (shape.changelog) write(repo, "CHANGELOG.md", "# Changelog\n\nRelease notes for OpenCode V2, newest first.\n\n## v2.2.7\n")
  commitAll(repo, "upstream advances")

  return { repo, work, bin, log }
}

type Run = { exitCode: number; output: string; calls: string[] }

/**
 * 跑**生产那一步的 body 本体**,用 `bash -e` —— Actions 对不写 `shell:` 的 `run:` 用的就是 `bash -e {0}`。
 * ⚠️ **诚实边界**:这里只跑这**一步**,不跑它前后的步骤,也不建模 Actions 的表达式/env 层
 * (这一步的 body 不用任何 `${{ }}` 与 `$GITHUB_*`,已随 body 一起从 YAML 里解析出来核对)。
 */
function runStep(fx: Fixture, body: string): Run {
  const script = join(fx.work, "merge-step.sh")
  writeFileSync(script, body)
  const r = Bun.spawnSync(["bash", "-e", script], {
    cwd: fx.repo,
    env: { PATH: `${fx.bin}:${process.env.PATH ?? "/usr/bin:/bin"}`, BUN_STUB_LOG: fx.log, ...GIT_ENV },
  })
  const output = `${r.stdout.toString()}${r.stderr.toString()}`
  const calls = existsSync(fx.log)
    ? readFileSync(fx.log, "utf8")
        .split("\n")
        .filter((l) => l.trim().length > 0)
    : []
  return { exitCode: r.exitCode ?? -1, output, calls }
}

function showFile(repo: string, rev: string, path: string): string | null {
  const r = Bun.spawnSync(["git", "show", `${rev}:${path}`], {
    cwd: repo,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...GIT_ENV },
  })
  return r.exitCode === 0 ? r.stdout.toString() : null
}

function midMerge(repo: string): boolean {
  const merging = Bun.spawnSync(["git", "rev-parse", "-q", "--verify", "MERGE_HEAD"], {
    cwd: repo,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...GIT_ENV },
  })
  return merging.exitCode === 0
}

describe("#1272 / #1668 sync-upstream 合并步", () => {
  test("干净合并 ⇒ exit 0、不跑 install、上游 packages/app 原样合进来、冻结前端落点不动", () => {
    const fx = fixture({ conflict: "none" })
    const run = runStep(fx, mergeStepBody())
    expect(run.exitCode, `干净合并的那条路径被改坏了:\n${run.output}`).toBe(0)
    expect(run.calls, `no-conflict 分支跑了 install(它在后面的 Engine smoke 步):\n${run.output}`).toHaveLength(0)
    expect(showFile(fx.repo, "alpha", "packages/app/src/app.tsx"), "上游 packages/app 没有原样合进来 —— 合并后还有东西在改写它").toContain(
      "upstream v2",
    )
    expect(showFile(fx.repo, "alpha", FROZEN_APP), "冻结前端落点被合并步改动了").toBe(FROZEN_BODY)
    expect(showFile(fx.repo, "alpha", "packages/opencode/src/engine.ts"), "上游的其它改动没合进来").toContain("upstream only")
  })

  test("bun.lock 冲突 ⇒ 结束合并后才 install,且重生的 lockfile 落进提交(不是 alpha 旧的那份)", () => {
    const fx = fixture({ conflict: "lock" })
    const run = runStep(fx, mergeStepBody())
    expect(run.exitCode, `冲突分支跑不到底:\n${run.output}`).toBe(0)
    // 假 bun 一次都没被调用 = PATH 没生效 / install 被删掉,两种都让下面的断言变成空话。
    expect(run.calls, `\`bun install\` 没有恰好跑一次(PATH 没生效?install 被删了?):\n${run.output}`).toEqual(["install"])
    expect(midMerge(fx.repo), "install 之后树仍停在半合并状态 —— 合并没有先结束").toBe(false)
    const lock = showFile(fx.repo, "alpha", "bun.lock")
    // 「把 install 删掉」是最省事的错误修法;那样这一条会红。
    expect(lock, `alpha 的 bun.lock 没有被 install 重生过:\n${lock}`).toContain("regenerated-by-install")
    // 且它确实是从上游那份(--theirs)重生的,不是 alpha 旧的那份原样留着。
    expect(lock, `bun.lock 不是上游那份 —— \`git checkout --theirs\` 那一格没生效:\n${lock}`).toContain('"upstream": "v2"')
    expect(showFile(fx.repo, "alpha", FROZEN_APP), "冻结前端落点被合并步改动了").toBe(FROZEN_BODY)
  })

  test("packages/app 冲突不再是预期冲突 ⇒ 点名、abort、exit 1、不跑 install(控制组:放回旧放行表 ⇒ 冲突标记被提交)", () => {
    const fx = fixture({ conflict: "app" })
    const run = runStep(fx, mergeStepBody())
    expect(run.exitCode, `alpha 改了上游 packages/app 却被当成预期冲突放行:\n${run.output}`).toBe(1)
    expect(run.output, `没说清是未登记的偏离:\n${run.output}`).toContain("未登记的偏离:按 ADR-029 登记或还原")
    expect(run.output, `没点名到冲突文件:\n${run.output}`).toContain("packages/app/src/app.tsx")
    expect(run.calls, `拒绝合并时还去跑了 install:\n${run.output}`).toHaveLength(0)
    expect(midMerge(fx.repo), "merge 没有被 abort,树停在半合并状态").toBe(false)

    // 控制组:`#1668` 之前的放行表(app/ui 冲突算预期)放回去 —— 还原步已经不在了,于是冲突标记被原样提交。
    const legacy = fixture({ conflict: "app" })
    const allowed = runStep(legacy, withLegacyAppUiAllowance(mergeStepBody()))
    expect(allowed.exitCode, `控制组也中止了 —— 上面那条拒绝不是放行表改动挣来的:\n${allowed.output}`).toBe(0)
    expect(showFile(legacy.repo, "alpha", "packages/app/src/app.tsx"), "控制组没把冲突标记提交上去 —— 夹具没造出那个冲突").toContain(
      "<<<<<<<",
    )
  })

  test("意外冲突(引擎文件)⇒ 点名、abort、exit 1,且 install 一次都不跑", () => {
    const fx = fixture({ conflict: "unexpected" })
    const run = runStep(fx, mergeStepBody())
    expect(run.exitCode, `only-add 纪律被破坏时没有拦住:\n${run.output}`).toBe(1)
    // `#1566`:报错为具名的「未登记的偏离」(intake 已排除接管清单,剩余冲突都在清单外)。
    expect(run.output, `没说清是未登记的偏离:\n${run.output}`).toContain("未登记的偏离:按 ADR-029 登记或还原")
    expect(run.output, `没点名到冲突文件:\n${run.output}`).toContain("packages/opencode/src/engine.ts")
    expect(run.calls, `意外冲突时还去跑了 install:\n${run.output}`).toHaveLength(0)
    expect(midMerge(fx.repo), "merge 没有被 abort,树停在半合并状态").toBe(false)
  })

  test("`#1664` 根 CHANGELOG.md 冲突 ⇒ 取我方(Code Puppy 发布历史)、照常合并;控制组:去掉这条登记 ⇒ 以「未登记的偏离」中止并点名它", () => {
    const fx = fixture({ conflict: "none", changelog: true })
    const run = runStep(fx, mergeStepBody())
    expect(run.exitCode, `CHANGELOG.md 冲突没被当成预期冲突:\n${run.output}`).toBe(0)
    expect(showFile(fx.repo, "alpha", "CHANGELOG.md"), "合并后的 CHANGELOG.md 不是我方那份").toBe(CODEPUPPY_CHANGELOG)
    expect(showFile(fx.repo, "alpha", "packages/opencode/src/engine.ts"), "上游的其它改动没合进来").toContain("upstream only")

    const unregistered = fixture({ conflict: "none", changelog: true })
    const body = mergeStepBody()
    const mutated = body.replace(" | grep -v '^CHANGELOG.md$'", "")
    if (mutated === body) throw new Error("变异没改到过滤表 —— 本次测量作废,不是通过")
    const legacy = runStep(unregistered, mutated)
    expect(legacy.exitCode, `控制组没中止 —— 夹具没造出 CHANGELOG.md 冲突:\n${legacy.output}`).toBe(1)
    expect(legacy.output).toContain("未登记的偏离:按 ADR-029 登记或还原")
    expect(legacy.output).toContain("CHANGELOG.md")
  })
})

// ── 减速带(不是闸门)────────────────────────────────────────────────────────────
//
// ⚠️ **诚实边界**:上面几条只跑「Merge `dev` into `alpha`」**这一步**。「有人在**更靠前**的某一步里加了
// `bun install`」—— 那时合并还没发生,lockfile 照的不是最终这棵树 —— 行为闸罩不到(要跑整条 workflow)。
// 这一条比的是 YAML 的**文本**,按本仓定义是减速带:有人把 install 写成 `bun i` 时它照样绿。
describe("#1272 减速带:merge 步之前的任何一步都不许 install", () => {
  test("`Merge dev into alpha` 之前没有任何一步跑 `bun install`", () => {
    const doc = Bun.YAML.parse(readFileSync(WORKFLOW, "utf8")) as any
    const steps = doc?.jobs?.candidate?.steps
    expect(Array.isArray(steps), "读不出 jobs.candidate.steps —— 本条测量作废(不是通过)").toBe(true)
    const idx = steps.findIndex((s: any) => typeof s?.name === "string" && s.name.startsWith(MERGE_STEP))
    expect(idx, `找不到「${MERGE_STEP} …」这一步 —— 本条测量作废(不是通过)`).toBeGreaterThan(-1)
    const early = steps
      .slice(0, idx)
      .filter((s: any) => typeof s?.run === "string" && /(^|\s)bun\s+install(\s|$)/m.test(s.run))
      .map((s: any) => s.name)
    expect(early, `这些步骤排在合并步之前却跑了 bun install:${early.join(", ")} —— lockfile 不是照最终这棵树生成的。`).toEqual([])
  })
})
