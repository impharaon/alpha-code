// `#889` —— north-star 守卫的**行为闸**。
//
// 这道门守的是什么(大白话):本仓是 opencode 的 fork,上游包只读 —— 改了它们,下一次
// fork-sync 就冲突。守卫是这条铁律唯一的机械判据,同时也是 alpha 分支保护上的一个必需
// context(`north-star guard (zero upstream edits)`)。
//
// 为什么判据必须长这样:
//   · **不断言脚本源码文本。** 「grep 到脚本里写着 origin/alpha」在本仓是点名过的**假闸门**
//     形态 —— 守卫被整段注释掉时它照样绿。这里起**真的 git 仓**、造**真的上游改动**、跑
//     **生产的那份脚本**(scripts/north-star-guard.sh,CI 与本地 codepuppy-check.sh 调用的
//     就是它),断言它**真的点名了那个文件**、真的以非零退出。
//   · **不只断言「改上游就红」。** 一个「永远红」的错误实现能满足那一条,所以另有两条反向:
//     只改 alpha 自有文件必须绿、exclude 表里的收编文件必须不被点名。
//   · **基准那一条自带控制组。** 只断言「守卫没点名 upstream-drift.ts」是不够的 —— 一个
//     夹具如果根本没造出 dev/alpha 的分叉,那条断言会空对空地绿。所以同一条用例里把生产
//     脚本复制一份、只把基准换成 origin/dev 跑一遍,先证明**这个夹具测得出已知的坏**,
//     再用它判未知的好(CLAUDE.md「观测手段自己有盲区」)。
//
// `#889` 修的缺陷:守卫的比较基准两处写死 `origin/dev`(上游纯镜像分支),而这道门要回答的
// 是「**这个 PR 自己**改了上游文件吗」,基准只能是它的目标分支 alpha。实测(2026-08-10):
// 两条 ref 的 merge-base 停在 `347510a73`(2026-07-23),alpha 领先 289 个提交、dev 领先 261
// 个且仍在动 ⇒ `origin/dev...HEAD` 的窗口是 550 commits / 2467 文件。今天两种基准结论相同
// (都是 0),**只是因为**那 44 条 ADR-033 收编白名单恰好吸收了窗口里点名的 47 个上游文件 ——
// 任何一次不在白名单里的合法上游改动,都会让这道门在每个 PR 上恒红(`#754` 那一类:
// 门还在跑、还给结论,而人人 --no-verify)。
//
// 删掉本文件会失去什么:守卫退回「没有任何行为判据」的状态 —— 基准改错、excludes 数组传错、
// diff-filter 写错、脚本被换成 `exit 0`,都不会有任何东西变红。它因此登记在
// scripts/gate-files.tsv 里,拿精确条数。
//
// `#913` 在文件末尾补了第二个 describe:守卫**降级**那一档(fetch 失败 ⇒ 用本地上一次拿到的
// `origin/alpha`)必须自报基准的身份与年龄,否则「今天绿」的含义取决于一个没人看得见的量。
// 那三条的理由写在那个 describe 头上。

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, test } from "bun:test"

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..")
const GUARD = resolve(REPO_ROOT, "scripts/north-star-guard.sh")

/**
 * 完全隔离的 git 环境(与 ci-diff-scope.test.ts 同源的理由):
 *  ① 开发机的 ~/.gitconfig(core.hooksPath、templateDir、别名…)不许影响判据;
 *  ② 反过来 —— 本测试**结构上不可能**写到本仓的 .git/config 或当前分支(`ac#815` 那一类:
 *     跑门的过程往共享树里写东西,只有 reflog 分辨得出)。身份走 env,不走 `git config`。
 */
const GIT_ENV = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "alpha ci fixture",
  GIT_AUTHOR_EMAIL: "fixture@alpha.invalid",
  GIT_COMMITTER_NAME: "alpha ci fixture",
  GIT_COMMITTER_EMAIL: "fixture@alpha.invalid",
} as const

function git(cwd: string, args: string[], extraEnv: Record<string, string> = {}): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: { ...GIT_ENV, ...extraEnv } })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} 失败:${result.stderr.toString()}`)
  return result.stdout.toString().trim()
}

function write(repo: string, files: Record<string, string>) {
  for (const [path, body] of Object.entries(files)) {
    Bun.spawnSync(["mkdir", "-p", join(repo, path, "..")], { env: { ...GIT_ENV } })
    writeFileSync(join(repo, path), body)
  }
}

function commit(repo: string, message: string, files: Record<string, string>, extraEnv: Record<string, string> = {}): string {
  write(repo, files)
  git(repo, ["add", "-A"], extraEnv)
  git(repo, ["commit", "-q", "-m", message], extraEnv)
  return git(repo, ["rev-parse", "HEAD"])
}

/** 把一次提交钉在某一天(UTC 正午,避开时区把日期翻到隔壁天)。 */
function onDay(day: string): Record<string, string> {
  return { GIT_AUTHOR_DATE: `${day}T12:00:00+00:00`, GIT_COMMITTER_DATE: `${day}T12:00:00+00:00` }
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

/** 上游包(真实 UPSTREAM_PATHS 之一)下的一个普通文件 —— 不在 ADR-033 白名单里。 */
const UPSTREAM_FILE = "packages/core/src/upstream-leaf.ts"
/** 接管清单里的被接管文件(`#1662` 最终清单:ADR-042 的 OAuth 回调页)—— 改它是**有意的收编**,守卫必须放行。 */
const TAKEN_OVER_FILE = "packages/core/src/oauth/page.ts"
/** alpha 自有包 —— 守卫的范围之外。 */
const CODEPUPPY_FILE = "packages/ui-mac/src/main/codepuppy-owned.ts"
/**
 * **只落在 dev 窗口、不落在 alpha 窗口**的那个上游文件:它在 alpha 自己的历史里被改过
 * (真实世界里 = 三周 289 个提交里的任何一次收编/同步),而当前分支一个字没碰它。
 */
const CODEPUPPY_SIDE_DRIFT = "packages/core/src/upstream-drift.ts"

// ── `#1085` 的夹具:UPSTREAM_PATHS 里住着的 alpha 自有文件 ────────────────────────
// 谓词 = ①路径不在上游镜像 origin/dev 里 ∧ ②自报家门(alpha-* 命名 或 文件里写着 marker)。
// 下面五个常量各钉谓词的一格,**两个因子各自的反例都在里面** —— 只有这样才杀得掉
// 「只看 dev 出身」与「只看命名」这两个各自都能让上面全部用例变绿的错误实现。
/** alpha 自有 + alpha-* 命名:落进 origin/alpha 之后改它必须绿(这张票要修的那个形状)。 */
const CODEPUPPY_OWNED_NAMED = "packages/core/test/codepuppy-owned-leaf.test.ts"
/** alpha 自有 + 名字不合约定,靠文件里的 marker 自报家门(migration / tool-identity.ts 那一类)。 */
const CODEPUPPY_OWNED_MARKED = "packages/core/src/marked-codepuppy-leaf.ts"
/** alpha 自有,但**没有**自报家门:因子②不成立 ⇒ 必须红(杀「只看 dev 出身」)。 */
const CODEPUPPY_OWNED_BARE = "packages/core/src/bare-codepuppy-leaf.ts"
/** **真上游**文件,名字却是 alpha-*:因子①不成立 ⇒ 必须红(杀「只看命名」)。 */
const UPSTREAM_CODEPUPPY_NAMED = "packages/core/src/codepuppy-upstream-trap.ts"
/** 守卫认的 marker token —— 与 scripts/north-star-guard.sh 的 CODEPUPPY_OWNED_MARKER 同字面。 */
const OWNED_MARKER = "north-star:codepuppy-owned"

/**
 * 夹具形状 —— 真实世界的缩比:
 *
 *   seed ──► dev    (上游镜像继续前进)
 *      └──► alpha   (alpha 自己改过 CODEPUPPY_SIDE_DRIFT)
 *              └──► feature   (本次 PR 的分支,从 alpha 切出)
 *
 * `origin/alpha...HEAD` 只看得见 feature 自己的改动;`origin/dev...HEAD` 的分叉点退到 seed,
 * 于是把 alpha 侧的 CODEPUPPY_SIDE_DRIFT 一起算进来。
 */
function forkFixture() {
  const origin = mkdtempSync(join(tmpdir(), "codepuppy-north-star-origin-"))
  git(origin, ["init", "-q", "-b", "alpha"])
  commit(origin, "seed", {
    [UPSTREAM_FILE]: "export const leaf = 1\n",
    [TAKEN_OVER_FILE]: "export const permission = 1\n",
    [CODEPUPPY_SIDE_DRIFT]: "export const drift = 1\n",
    // seed 在分叉之前 ⇒ 这一条**也在 dev 里**,于是它是货真价实的上游文件,名字只是碰巧
    // 长得像 alpha 自有的。谓词的因子①必须据此否掉它。
    [UPSTREAM_CODEPUPPY_NAMED]: "export const trap = 1\n",
  })
  git(origin, ["checkout", "-q", "-b", "dev"])
  commit(origin, "upstream mirror moves on", { "packages/core/src/dev-only.ts": "export const devOnly = 1\n" })
  git(origin, ["checkout", "-q", "alpha"])
  commit(origin, "alpha takes over an upstream leaf (ADR-style)", {
    [CODEPUPPY_SIDE_DRIFT]: "export const drift = 2\n",
    // `#1247`:CODEPUPPY_FILE 住在 alpha 自有包 packages/ui-mac 下,它必须**只**落在 alpha 侧 ——
    // 原来它在 seed 里,于是夹具的 dev 分支也有 `packages/ui-mac/`,而真实世界里 origin/dev
    // 根本没有这条路径(2026-09-06 实测)。守卫新增的 CODEPUPPY_OWNED_PACKAGES 自检正是拿镜像
    // 验这一点,夹具不修就会在一个**现实中不存在**的状态上恒红。
    [CODEPUPPY_FILE]: "export const codepuppyOwned = 1\n",
    // 这三条只落在 alpha 上 ⇒ origin/dev 里查不到它们(= 因子①成立)。它们已经在基准里,
    // 所以 feature 分支再碰一下就是 `M` —— 正是 `#971` 说的「落地那一次绿、以后每一次红」。
    [CODEPUPPY_OWNED_NAMED]: "export const ownedByName = 1\n",
    [CODEPUPPY_OWNED_MARKED]: `// ${OWNED_MARKER}\nexport const ownedByMarker = 1\n`,
    [CODEPUPPY_OWNED_BARE]: "export const bare = 1\n",
  })

  const work = mkdtempSync(join(tmpdir(), "codepuppy-north-star-work-"))
  const result = Bun.spawnSync(["git", "clone", "-q", origin, work], { env: { ...GIT_ENV } })
  if (result.exitCode !== 0) throw new Error(`git clone 失败:${result.stderr.toString()}`)
  git(work, ["checkout", "-q", "-b", "feature", "origin/alpha"])
  return { origin, work }
}

/** `#913`:降级夹具里那个「上一次成功 fetch」的基准提交有多旧。 */
const STALE_DAYS = 45

/**
 * `#913` 降级夹具:**fetch 一定失败**(remote 指到一个不存在的路径),而本地 last-known
 * `origin/alpha` 停在 HEAD 之前 `staleDepth` 个提交 —— 这就是「上一次 fetch 成功之后 alpha
 * 又走了几步」在本地留下的样子(remote-tracking ref 本来就只是一个 ref,陈旧态与它逐字节
 * 相同,所以这里用 `update-ref` 把它回拨,而不是伪造别的东西)。
 *
 *   origin/alpha:  seed(STALE_DAYS 天前) ── m1 ── m2 ── m3(m* 只碰 alpha 自有文件)
 *   work:          HEAD = m3;refs/remotes/origin/alpha 回拨到 m3 往前第 staleDepth 个提交
 *
 * ⇒ 基准的身份与比较窗口宽度都由**夹具的构造**决定(baselineSha / window = staleDepth),
 * 不是从守卫自己的输出反推出来的 —— 后者是自指等价链,一起改错就一起自洽。
 * 每个提交的日期都显式钉死(UTC 正午):`--date=short` 按提交自带的时区渲染,不钉的话
 * 「今天」在 +08:00 的机器上会和 UTC 的今天差一天,断言随机翻红。
 */
function degradedFixture(staleDepth: number) {
  const staleDay = daysAgo(STALE_DAYS)
  const recentDay = daysAgo(1)
  const origin = mkdtempSync(join(tmpdir(), "codepuppy-north-star-stale-origin-"))
  git(origin, ["init", "-q", "-b", "alpha"])
  const seed = commit(
    origin,
    "seed",
    {
      [UPSTREAM_FILE]: "export const leaf = 1\n",
      [TAKEN_OVER_FILE]: "export const permission = 1\n",
      [CODEPUPPY_FILE]: "export const codepuppyOwned = 1\n",
    },
    onDay(staleDay),
  )
  const moves = [1, 2, 3].map((n) =>
    commit(
      origin,
      `alpha moves on (${n})`,
      { [`packages/ui-mac/src/main/codepuppy-move-${n}.ts`]: `export const move = ${n}\n` },
      onDay(recentDay),
    ),
  )
  const history = [seed, ...moves]
  const days = [staleDay, recentDay, recentDay, recentDay]
  const at = history.length - 1 - staleDepth

  const work = mkdtempSync(join(tmpdir(), "codepuppy-north-star-stale-work-"))
  const cloned = Bun.spawnSync(["git", "clone", "-q", origin, work], { env: { ...GIT_ENV } })
  if (cloned.exitCode !== 0) throw new Error(`git clone 失败:${cloned.stderr.toString()}`)
  git(work, ["checkout", "-q", "-b", "feature", "origin/alpha"])
  // last-known 陈旧:remote-tracking ref 回拨。
  git(work, ["update-ref", "refs/remotes/origin/alpha", history[at]!])
  // fetch 一定失败:origin 指到一个不存在的路径(本地路径 ⇒ 立即 fatal,不碰网络、不会挂住)。
  git(work, ["remote", "set-url", "origin", `${origin}-vanished`])

  return { work, baselineSha: history[at]!, baselineDay: days[at]!, headSha: history[history.length - 1]!, staleDay }
}

/**
 * 从守卫输出里**读出**降级基准的比较窗口宽度。读不出就抛「本次测量作废」,而不是给一个
 * 数字 —— 观测手段自己有盲区时,沉默地返回 0 会把「一个字都没报」读成「窗口是 0」。
 */
function reportedWindow(output: string): number {
  const found = /window origin\/alpha\.\.HEAD = (\d+) commits/.exec(output)
  if (!found) throw new Error(`守卫的降级输出里读不出比较窗口宽度 —— 本次测量作废:\n${output}`)
  return Number(found[1])
}

type GuardRun = { exitCode: number; output: string }

/** 跑**生产脚本本体**。`script` 只在基准控制组里换成一份改过基准的复制品。 */
function runGuard(repo: string, script: string = GUARD): GuardRun {
  const result = Bun.spawnSync(["bash", script], { cwd: repo, env: { ...GIT_ENV } })
  const exitCode = result.exitCode
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  // 测不到就抛。守卫无论红绿都必须说话 —— 一个什么都不打印的运行不是「通过」。
  if (output.trim().length === 0) throw new Error("守卫一个字都没输出 —— 本次测量作废(不是通过)")
  return { exitCode, output }
}

describe("#889 north-star 守卫的行为", () => {
  test("改一个不在收编白名单里的上游文件 ⇒ 红,且点名那个文件", () => {
    const { work } = forkFixture()
    commit(work, "touch an upstream file", { [UPSTREAM_FILE]: "export const leaf = 999\n" })
    const run = runGuard(work)
    expect(run.exitCode, `守卫放行了一次真实的上游改动:\n${run.output}`).not.toBe(0)
    // 只断退出码不够:一个「永远红」的实现也满足它。必须**点名**,否则人拿不到可操作的信息。
    expect(run.output, `守卫红了但没点名被改的文件:\n${run.output}`).toContain(UPSTREAM_FILE)
  })

  test("上游改动只在工作树里(未提交)也必须红 —— 本地档比 CI 多验的那一半", () => {
    const { work } = forkFixture()
    write(work, { [UPSTREAM_FILE]: "export const leaf = 777\n" })
    const run = runGuard(work)
    // CI_STEPS 把这一步登记成 `SUPERSET:committed delta ∪ 未提交工作树改动`。那句登记是散文,
    // 这条用例是它的判据 —— 只留 committed 那一半时当场红。
    expect(run.exitCode, `未提交的上游改动被放行了(SUPERSET 那半边没了):\n${run.output}`).not.toBe(0)
    expect(run.output).toContain(UPSTREAM_FILE)
  })

  test("只改 alpha 自有文件 ⇒ 绿(否则「守卫恒红」这个错误实现也能满足上面两条)", () => {
    const { work } = forkFixture()
    commit(work, "codepuppy-owned change", { [CODEPUPPY_FILE]: "export const codepuppyOwned = 2\n" })
    write(work, { [CODEPUPPY_FILE]: "export const codepuppyOwned = 3\n" })
    const run = runGuard(work)
    expect(run.exitCode, `一次纯 alpha 改动被判成破北极星 —— 恒红的门等于没有门:\n${run.output}`).toBe(0)
  })

  test("ADR-033 白名单里的被接管文件被改 ⇒ 绿且不点名(excludes 真的传进去了)", () => {
    const { work } = forkFixture()
    commit(work, "edit a sanctioned takeover surface", { [TAKEN_OVER_FILE]: "export const permission = 2\n" })
    const run = runGuard(work)
    // 数组展开写错(比如漏了引号、或 pathspec 被当成一个整串)时,这一条是唯一会红的 ——
    // 那种错误会让 44 条收编集体失效,干净分支上恒假红。
    expect(run.exitCode, `收编白名单没生效,有意的接管被判成破北极星:\n${run.output}`).toBe(0)
    expect(run.output).not.toContain(TAKEN_OVER_FILE)
  })

  test("基准是 origin/alpha:只落在 dev 窗口里的上游改动不许被点名(还原成 origin/dev 即红)", () => {
    const { work } = forkFixture()
    commit(work, "an ordinary codepuppy-side change", { [CODEPUPPY_FILE]: "export const codepuppyOwned = 2\n" })

    // ── 控制组:先证明这个夹具**测得出已知的坏** ────────────────────────────────
    // 只跑生产脚本、只断言「没点名」是不够的:夹具若根本没造出 dev/alpha 分叉,那条断言会
    // 空对空地绿。所以把生产脚本原样复制一份、只把基准换成 origin/dev 跑一遍。
    const mutated = join(mkdtempSync(join(tmpdir(), "codepuppy-north-star-ctl-")), "guard-on-dev.sh")
    writeFileSync(mutated, readFileSync(GUARD, "utf8").replaceAll("origin/alpha", "origin/dev"))
    const onDev = runGuard(work, mutated)
    expect(onDev.exitCode, `控制组没红 —— 夹具没造出 dev/alpha 的分叉,本条判据测不到目标:\n${onDev.output}`).not.toBe(0)
    expect(onDev.output, `控制组红了但没点名 alpha 侧的上游改动 —— 本次测量作废:\n${onDev.output}`).toContain(
      CODEPUPPY_SIDE_DRIFT,
    )

    // ── 生产:同一棵树、同一个分支,基准换成目标分支后必须干净 ──────────────────
    const run = runGuard(work)
    expect(run.exitCode, `守卫把 alpha 自己历史里的上游改动算成了本分支的:\n${run.output}`).toBe(0)
    expect(run.output, `守卫点名了一个本分支没碰过的文件(基准退回 origin/dev 了):\n${run.output}`).not.toContain(
      CODEPUPPY_SIDE_DRIFT,
    )
  })

  test("基准 ref 取不到时 fail-closed:非零 + 说「作废」,不是静默放行", () => {
    const solo = mkdtempSync(join(tmpdir(), "codepuppy-north-star-solo-"))
    git(solo, ["init", "-q", "-b", "feature"])
    commit(solo, "no remote at all", { [UPSTREAM_FILE]: "export const leaf = 1\n" })
    const run = runGuard(solo)
    // 改之前这里是 `git diff … 2>/dev/null || true`:ref 不存在 ⇒ git 报错被吞 ⇒ 空串 ⇒
    // 「已提交改动」那半边守卫**静默消失**而这一步报 ✓。测不到必须说测不到。
    expect(run.exitCode, `基准取不到时守卫竟然放行了 —— 那是假绿:\n${run.output}`).not.toBe(0)
    expect(run.output).toContain("origin/alpha")
  })

  test("上游路径下**新增**文件不被点名 —— `--diff-filter=DMR` 的明写边界,不是漏网", () => {
    const { work } = forkFixture()
    commit(work, "add a new file under an upstream package", {
      "packages/core/src/brand-new-codepuppy-leaf.ts": "export const added = 1\n",
    })
    const run = runGuard(work)
    // 这是**刻意**的:fork-sync 冲突来自 M/D/R,新增文件不冲突;ADR-035 与 ADR-038 都明写
    // 依赖它(「新增闸门文件落 alpha 自有的 alpha-*.test.ts,新增文件不触发 --diff-filter=DMR,
    // 无需 exclude」)。本条把那句散文变成判据:有人顺手加上 `A`,那两条 ADR 的前提当场失效,
    // 这里会红并逼他去读它们。`#889` 不改这个行为。
    expect(run.exitCode, `新增文件被守卫点名了 —— ADR-035/038 的「无需 exclude」前提已失效:\n${run.output}`).toBe(0)
  })
})

// ── `#1085`:UPSTREAM_PATHS 里住着的 alpha 自有文件 ─────────────────────────────────
//
// 缺陷(`#971` 实测):我们自己写的一批文件住在上游包目录里(闸门测试、`tool-identity.ts` 本体、
// ADR-033 的两条迁移…)。落地那一次是 `A`,DMR 不点名;进了 `origin/alpha` 之后**任何**修改都是
// `M` ⇒ 守卫当场红。于是「给自己写的判据补一条用例」要先走一轮 owner 级 ADR 修订,而门红时最省事
// 的反应是 `--no-verify`,那会把所有门一起关掉。owner 裁决(`#1079` CHOICE=2)= 结构性谓词。
//
// 判据为什么长这样:谓词是两个因子的**合取**,所以两个因子各自都要有一条**反例**用例 ——
// 「只看 dev 出身」和「只看命名」这两个错误实现,各自都能让正向那两条绿。反例在这里:
// CODEPUPPY_OWNED_BARE(dev 里没有、但没自报家门 ⇒ 红)与 UPSTREAM_CODEPUPPY_NAMED(名字是 alpha-*、
// 但 dev 里有 ⇒ 红)。另外两条守的是这道门最容易被绕开的两个形状:把 marker 抄进真上游文件、
// 以及把上游文件**改名**成 alpha-*(后者带控制组,证明夹具测得出已知的坏)。
describe("#1085 alpha 自有文件的结构性谓词", () => {
  test("alpha-* 命名的自有文件被改 ⇒ 绿,且输出把它点成 alpha 自有(豁免不许是静默的)", () => {
    const { work } = forkFixture()
    commit(work, "extend an codepuppy-owned gate that lives under an upstream package", {
      [CODEPUPPY_OWNED_NAMED]: "export const ownedByName = 2\n",
    })
    const run = runGuard(work)
    expect(run.exitCode, `alpha 自有闸门被判成破北极星 —— 这正是 #971 的缺陷:\n${run.output}`).toBe(0)
    // 一次静默的放行与一次没跑的门在输出上长得一模一样。豁免必须说出来,否则「今天绿」没有确定含义。
    expect(run.output, `豁免了却一个字都没说 —— 静默放行:\n${run.output}`).toContain(CODEPUPPY_OWNED_NAMED)
  })

  test("名字不合约定、靠文件里的 marker 自报家门 ⇒ 绿(migration / tool-identity.ts 那一类)", () => {
    const { work } = forkFixture()
    commit(work, "edit an codepuppy-owned file that cannot follow the alpha-* naming", {
      [CODEPUPPY_OWNED_MARKED]: `// ${OWNED_MARKER}\nexport const ownedByMarker = 2\n`,
    })
    const run = runGuard(work)
    expect(run.exitCode, `带 marker 的 alpha 自有文件被判成破北极星:\n${run.output}`).toBe(0)
    expect(run.output).toContain(CODEPUPPY_OWNED_MARKED)
  })

  test("dev 里没有、但没自报家门 ⇒ 红(杀掉「只看 origin/dev 出身」的实现)", () => {
    const { work } = forkFixture()
    commit(work, "edit an unmarked file that upstream never had", { [CODEPUPPY_OWNED_BARE]: "export const bare = 2\n" })
    const run = runGuard(work)
    // 因子①单独成立不够:origin/dev 是个会陈旧的 ref,fetch 失败的窗口里上游新增又被 sync 合进
    // alpha 的文件,在本地 dev 里同样「查不到」。只认出身的实现会把那种**真上游**文件放行。
    expect(run.exitCode, `只凭「dev 里没有」就放行了 —— 陈旧镜像会让真上游文件走同一条路:\n${run.output}`).not.toBe(0)
    expect(run.output).toContain(CODEPUPPY_OWNED_BARE)
    expect(run.output, `红了却没告诉人怎么办(命名 / marker):\n${run.output}`).toContain(OWNED_MARKER)
  })

  test("真上游文件、名字却叫 alpha-* ⇒ 红(杀掉「只看命名」的实现)", () => {
    const { work } = forkFixture()
    commit(work, "touch an upstream file that happens to be codepuppy-named", {
      [UPSTREAM_CODEPUPPY_NAMED]: "export const trap = 999\n",
    })
    const run = runGuard(work)
    expect(run.exitCode, `一个 dev 里就有的文件靠名字拿到了豁免:\n${run.output}`).not.toBe(0)
    expect(run.output).toContain(UPSTREAM_CODEPUPPY_NAMED)
  })

  test("把 marker 抄进一个真上游文件 ⇒ 仍然红(自报家门不是可伪造的通行证)", () => {
    const { work } = forkFixture()
    commit(work, "forge the ownership marker inside a genuine upstream file", {
      [UPSTREAM_FILE]: `// ${OWNED_MARKER}\nexport const leaf = 999\n`,
    })
    const run = runGuard(work)
    // 因子②取的是**改动后**的内容(被删掉的文件在工作树里没有内容,得往回退一层取)。这不是
    // 漏洞,因为因子①对真上游文件不成立 —— 本条就是那句话的判据。
    expect(run.exitCode, `伪造 marker 就能把上游改动洗白:\n${run.output}`).not.toBe(0)
    expect(run.output).toContain(UPSTREAM_FILE)
  })

  test("把上游文件改名成 alpha-* ⇒ 红且点名**旧**路径(--no-renames;去掉它即漏)", () => {
    const { work } = forkFixture()
    const renamed = "packages/core/src/codepuppy-renamed-leaf.ts"
    git(work, ["mv", UPSTREAM_FILE, renamed])
    git(work, ["commit", "-q", "-m", "rename an upstream file into the alpha naming convention"])

    // ── 控制组:先证明这个形状**真的**能绕过 ──────────────────────────────────────
    // 默认开着的改名检测把这次改动压成一条 `R`,而 `--name-only` 对 `R` 只印目的路径 ——
    // 目的路径在 dev 里没有、又叫 alpha-*,两个因子全中 ⇒ 被当成 alpha 自有放行,而上游那条
    // 路径其实已经消失。把 `--no-renames` 拿掉的复制品必须绿,否则本条测的不是它要测的东西。
    const mutated = join(mkdtempSync(join(tmpdir(), "codepuppy-north-star-rename-ctl-")), "guard-with-renames.sh")
    writeFileSync(mutated, readFileSync(GUARD, "utf8").replaceAll("--no-renames ", ""))
    const withRenames = runGuard(work, mutated)
    expect(withRenames.exitCode, `控制组没绿 —— 这个夹具测不到 --no-renames 要防的那个形状:\n${withRenames.output}`).toBe(0)

    // ── 生产:同一棵树必须红,且点名的是**消失的那条上游路径**,不是新名字 ────────────
    const run = runGuard(work)
    expect(run.exitCode, `把上游文件改名成 alpha-* 就绕过了守卫:\n${run.output}`).not.toBe(0)
    expect(run.output, `红了但点的是新名字 —— 真正受害的是旧路径:\n${run.output}`).toContain(UPSTREAM_FILE)
  })

  test("marker 在一个**大**文件里也读得出来(管道 + pipefail 会把命中读成 141)", () => {
    const { work } = forkFixture()
    // 这不是凑一条用例。守卫开着 `pipefail`,而 `grep -q` 命中即退出、写端拿到 SIGPIPE ⇒
    // `cat 文件 | grep -qF marker` 的退出码是 **141**,于是「找到了」被读成「没找到」。
    // 实测:`bash -c 'set -uo pipefail; cat big.txt | grep -qF token; echo $?'` → 141。
    // 方向是 fail-closed(假红,不是放行),但它取决于文件多大、marker 在第几行 —— 属于
    // 「今天绿明天红」的不可复现门,而恰恰是本 ADR 要消灭的那种。小夹具测不到它,所以这里
    // 的文件必须真的大到会触发 SIGPIPE。
    const big = `// ${OWNED_MARKER}\n${"// ".repeat(4) + "x".repeat(60) + "\n"}`.padEnd(4_000_000, "// filler\n")
    commit(work, "edit a large codepuppy-owned file whose marker sits at the top", { [CODEPUPPY_OWNED_MARKED]: big })
    const run = runGuard(work)
    expect(run.exitCode, `大文件里的 marker 没被读出来(多半是管道 + pipefail 吃了 SIGPIPE):\n${run.output}`).toBe(0)
    expect(run.output).toContain(CODEPUPPY_OWNED_MARKED)
  })

  test("上游镜像 ref 取不到 ⇒ 豁免整体停用(fail-closed),且自报这一跑量的是什么", () => {
    const { work } = forkFixture()
    commit(work, "extend an codepuppy-owned gate", { [CODEPUPPY_OWNED_NAMED]: "export const ownedByName = 3\n" })
    // 镜像没了:remote-tracking ref 删掉 + fetch 一定失败(本地路径 ⇒ 立即 fatal,不碰网络)。
    git(work, ["update-ref", "-d", "refs/remotes/origin/dev"])
    git(work, ["remote", "set-url", "origin", `${work}-vanished`])
    const run = runGuard(work)
    // 反方向(「查不到镜像就当 alpha 自有」)会把每一次上游改动都放行,是这道门能犯的最贵的错。
    expect(run.exitCode, `镜像取不到时守卫仍然发豁免 —— 那一刻它对上游改动全盲:\n${run.output}`).not.toBe(0)
    expect(run.output, `停用了豁免却没说,人读不出这一跑为什么红:\n${run.output}`).toContain("origin/dev")
  })
})

// ── `#913`:降级时「我量的是什么」必须出现在输出里 ──────────────────────────────────
//
// 守卫开跑前的 `git fetch` **间歇失败**(实测:`#889` 实现方约 3 次 1 次,主 session 复验 3 次
// 撞到 1 次)。失败时它降级到本地上一次拿到的 `origin/alpha` 继续跑 —— **方向是安全的**:
// 陈旧基准只把比较窗口撑得更宽 ⇒ 过报,不漏报,这不是假绿。
// 坏的是可见性:那行 warn 混在一整屏门输出里极易被略过,而「落后 1 个提交」与「落后 3 周」
// 原来长得**一模一样** ⇒「守卫今天绿」这句话的含义,取决于一个没人看得见的量。
//
// 判据为什么长这样:
//   · **不断言脚本源码文本**(grep 到脚本里写着 `commits behind`)—— 本仓点名过的假闸门形态。
//   · 断言落在**值**上:基准 sha 与陈旧程度必须是这棵树的真实值,而不是一句写死的话 ——
//     所以同一条用例跑两棵陈旧程度不同的树,报出来的数必须跟着变。
//   · 另有反向一条:fetch 正常时这一段**不许出现**。缺了它,「无条件永远打印一句年龄」这个
//     错误实现能满足上面全部断言。
//   · 还有一条守住既有行为:降级**不是**放弃 —— 它仍要跑完并给出正确结论。
// ── `#1570` 过渡期结束:旧前缀 / 旧 marker / 旧包目录不再被认作自有 ─────────────────────
// 改名 PR 合入后,守卫只认 codepuppy 形态。三条各造一个**只靠旧值**认领的路径,断言它被判成上游
// 改动并点名;各带一个控制组(把那一格旧值写回生产脚本 ⇒ 绿),证明红是「旧值已删」挣来的 ——
// 有人把旧值加回守卫,本节当场红。
const LEGACY_MARKER = "north-star:alpha-owned"

/** forkFixture 再往 origin/alpha 上补几条只在 alpha 侧的文件,feature 重新对齐它。 */
function legacyFixture(files: Record<string, string>) {
  const { origin, work } = forkFixture()
  commit(origin, "alpha-side files that only the old values would claim", files)
  git(work, ["fetch", "-q", "origin", "alpha"])
  git(work, ["reset", "-q", "--hard", "origin/alpha"])
  return work
}

describe("#1570 过渡期结束:旧前缀、旧 marker、旧包目录不再被认作自有", () => {
  test("只靠旧前缀 alpha-* 认领的文件被改 ⇒ 红且点名(控制组:写回旧前缀即绿)", () => {
    const legacy = "packages/core/test/alpha-legacy-leaf.test.ts"
    const work = legacyFixture({ [legacy]: "export const legacy = 1\n" })
    commit(work, "edit a file claimed only by the old prefix", { [legacy]: "export const legacy = 2\n" })

    const run = runGuard(work)
    expect(run.exitCode, `旧前缀仍被认作自有:\n${run.output}`).not.toBe(0)
    expect(run.output).toContain(legacy)

    const restored = runGuard(work, mutatedGuard("legacy-prefix", (src) => src.replace("in codepuppy-*)", "in codepuppy-* | alpha-*)")))
    expect(restored.exitCode, `写回旧前缀之后仍是红 —— 上面那条红不是「旧前缀已删」挣来的:\n${restored.output}`).toBe(0)
  })

  test("只靠旧 marker 认领的文件被改 ⇒ 红且点名(控制组:写回旧 marker 即绿)", () => {
    const marked = "packages/core/src/legacy-marked-leaf.ts"
    const work = legacyFixture({ [marked]: `// ${LEGACY_MARKER}\nexport const marked = 1\n` })
    commit(work, "edit a file that only carries the old marker", { [marked]: `// ${LEGACY_MARKER}\nexport const marked = 2\n` })

    const run = runGuard(work)
    expect(run.exitCode, `旧 marker 仍被认作自有:\n${run.output}`).not.toBe(0)
    expect(run.output).toContain(marked)

    const restored = runGuard(
      work,
      mutatedGuard("legacy-marker", (src) =>
        src.replace('*"$CODEPUPPY_OWNED_MARKER"*)', `*"$CODEPUPPY_OWNED_MARKER"* | *"${LEGACY_MARKER}"*)`),
      ),
    )
    expect(restored.exitCode, `写回旧 marker 之后仍是红:\n${restored.output}`).toBe(0)
  })

  test("旧包目录 alpha-contracts-consumer 下的文件被改 ⇒ 红且点名(控制组:写回旧目录名即绿)", () => {
    const old = "packages/alpha-contracts-consumer/src/decode.ts"
    const work = legacyFixture({ [old]: "export const decode = 1\n" })
    commit(work, "edit a file under the old package directory", { [old]: "export const decode = 2\n" })

    const run = runGuard(work)
    expect(run.exitCode, `旧包目录仍被整包豁免:\n${run.output}`).not.toBe(0)
    expect(run.output).toContain(old)

    const restored = runGuard(
      work,
      mutatedGuard("legacy-package", (src) =>
        src.replace(/^(CODEPUPPY_OWNED_PACKAGES="[^"]*)"/m, '$1 alpha-contracts-consumer"'),
      ),
    )
    expect(restored.exitCode, `写回旧目录名之后仍是红:\n${restored.output}`).toBe(0)
  })
})

describe("#913 fetch 失败降级时,基准的身份与年龄必须可读", () => {
  test("fetch 拿不到 + last-known 陈旧 ⇒ 基准 sha 与陈旧程度都读得出,且跟着真实状态变", () => {
    const stale = degradedFixture(3)
    const run = runGuard(stale.work)

    // 降级不改变结论:这个窗口里只有 alpha 自有改动 ⇒ 仍然绿。
    expect(run.exitCode, `降级路径把一次干净的运行判红了:\n${run.output}`).toBe(0)

    // ① 身份 —— 报的必须是**基准**那个提交,不是 HEAD(报 HEAD 等于什么都没说)。
    expect(run.output, `降级输出里没有基准的身份:\n${run.output}`).toContain(stale.baselineSha.slice(0, 7))
    expect(run.output, `降级输出报的是 HEAD 而不是基准:\n${run.output}`).not.toContain(stale.headSha.slice(0, 7))

    // ② 陈旧程度 —— 基准提交自己的日期,以及比较窗口因此有多宽(过报的量)。
    expect(run.output, `基准有多旧没出现在输出里:\n${run.output}`).toContain(stale.baselineDay)
    expect(reportedWindow(run.output), `报出来的窗口宽度不是这棵树的真实值:\n${run.output}`).toBe(3)

    // ── 控制组:同一形状、只把陈旧程度换掉,报出来的数必须跟着变 ────────────────────
    // 上面三条,一个「印一句写死的年龄」的实现也能满足(只要那句话碰巧写着这棵树的数)。
    const barely = degradedFixture(1)
    const run2 = runGuard(barely.work)
    expect(run2.output, `控制组里报的仍是另一棵树的基准 sha —— 这个值是写死的:\n${run2.output}`).toContain(
      barely.baselineSha.slice(0, 7),
    )
    expect(reportedWindow(run2.output), `窗口宽度不随树变 —— 它是个常量:\n${run2.output}`).toBe(1)
    expect(run2.output, `基准日期不随树变 —— 它是个常量:\n${run2.output}`).not.toContain(barely.staleDay)
    expect(run2.output, `控制组里读不到它自己那个基准的日期:\n${run2.output}`).toContain(barely.baselineDay)
  })

  test("fetch 正常 ⇒ 不出现降级上报(否则「无条件永远打印一句年龄」也能满足上一条)", () => {
    const { work } = forkFixture() // origin 是一个真路径 ⇒ 守卫的 fetch 会成功
    const run = runGuard(work)
    expect(run.exitCode, `干净分支被判红了:\n${run.output}`).toBe(0)
    const baseline = git(work, ["rev-parse", "origin/alpha"])
    expect(run.output, `fetch 明明成功,守卫却报告自己在用 last-known 基准:\n${run.output}`).not.toContain(
      baseline.slice(0, 7),
    )
    expect(() => reportedWindow(run.output), `fetch 成功的一跑里出现了降级基准上报:\n${run.output}`).toThrow()
  })

  test("降级仍然是一道**在跑**的门:陈旧基准下改上游文件依然红且点名", () => {
    const stale = degradedFixture(3)
    commit(stale.work, "touch an upstream file", { [UPSTREAM_FILE]: "export const leaf = 999\n" })
    const run = runGuard(stale.work)
    // 既有行为,`#913` 不许改:fetch 失败是降级、不是弃权。把降级改成直接 exit 1,这一条不会
    // 红(它本来就期望非零),红的是上面那条「干净运行仍然绿」—— 两条一起才钉住这个档位。
    expect(run.exitCode, `降级之后守卫放行了一次真实的上游改动:\n${run.output}`).not.toBe(0)
    expect(run.output, `降级之后守卫红了,却没点名被改的文件:\n${run.output}`).toContain(UPSTREAM_FILE)
    // 且必须**确实**走了降级路径,否则这一条测的是另一条路。
    expect(run.output, `这一跑没走降级路径,本条用例测的不是它要测的东西:\n${run.output}`).toContain(
      stale.baselineSha.slice(0, 7),
    )
  })
})

// ── `#1247`:辖区 = `packages/` 全树,不是一张会漂的 8 个包的枚举 ────────────────────
//
// 缺陷(2026-09-06 实测):`UPSTREAM_PATHS` 原本是
// `packages/{opencode,core,server,tui,sdk,protocol,schema,client}` —— **8 个包**,而上游镜像
// `origin/dev` 当天有 **32** 个(`git ls-tree --name-only origin/dev packages/ | wc -l`)。
// 24 个包在辖区外,其中 `app`/`ui` 当时由 ADR-034 的 pin+补丁 roundtrip 门盖住,其余 **22 个零机制**:
// 往 `packages/plugin/src/index.ts`(**Hooks 契约本体**)与 `packages/llm/src/index.ts` 各写一行,
// 守卫报 `✓ zero upstream package edits` 且 `exit 0`。这不是少拦一个坏输入 —— 是这道门(alpha
// 分支保护上的必需 context)对一大半地盘根本没在看,而下一次 fork-sync 照样冲突。
//
// 根因是**数据模型**,不是某一行写错:辖区是一张枚举,枚举对**新成员默认放行** —— 上游每加
// 一个包就多一个盲区,而没有任何东西会变红。ADR-043(`#1079` owner CHOICE=2)在**文件**这一层
// 已经因为同一条理由否掉过逐文件 exclude 清单。所以辖区改成「`packages/` 全树 − 显式
// carve-out」:例外默认拒,新成员默认覆盖。
//
// 判据为什么长这样:
//   · **每条正向断言都带控制组** —— 把生产脚本复制一份、只把被测的那一格改回缺陷态(辖区换回
//     8 包 / 抹掉 alpha 自有包 carve-out / 放回 `#1668` 撤掉的 roundtrip carve-out),先证明这个夹具**测得出
//     已知的坏**,再用它判未知的好。没有控制组的「它红了」可能只是夹具在别处红。
//   · 夹具的上游镜像里放一个守卫**从没听说过**的包(`brand-new-upstream-pkg`)。它钉的正是
//     「上游明天加一个包,谁会变红」—— 枚举式辖区对它默认放行。
//   · **`#1668`:`app`/`ui` 回到辖区**。冻结前端(pin + SOT 补丁)搬到 Code Puppy 自有落点
//     `packages/codepuppy-{app,ui}` 之后,`packages/{app,ui}` 是上游 2.x 原样、Code Puppy 不用,原来的
//     roundtrip carve-out(②)撤掉,改它们就是改上游。落点整包豁免(在自有清单里),落点的投影判据由
//     `scripts/assert-frontend-patch-roundtrip.sh` 用 **tree sha 逐字节**判;落点都在自有清单里由
//     packages/ui-mac/src/main/local-gate-parity.test.ts 判(空档即红)。
//   · **把一个真上游包写进 alpha 自有清单**是绕开整道门最便宜的一步:一行配置换一整个包的
//     豁免,而上面每一条断言照样绿。所以守卫自己拿上游镜像验那张清单,这里钉住它真的会红。

/** `#1668` 之前由 roundtrip carve-out(②)豁免、现已回到辖区的上游前端包。 */
const FORMER_ROUNDTRIP_PACKAGES = ["app", "ui"]
/**
 * alpha 自有的 workspace 包 —— `origin/dev` 里根本没有这些路径(2026-09-06 实测前三个;
 * `#1668` 加冻结前端的五个落点)。
 */
const CODEPUPPY_OWNED_PACKAGES = [
  "ext",
  "ui-mac",
  "codepuppy-contracts-consumer",
  "codepuppy-app",
  "codepuppy-ui",
  "codepuppy-session-ui",
  "codepuppy-sdk-v1",
  "codepuppy-core-util",
]
/** `#1247` 之前的辖区,控制组用 —— 逐字来自被本票替换掉的那一行。 */
const PRE_1247_JURISDICTION =
  "packages/opencode packages/core packages/server packages/tui packages/sdk packages/protocol packages/schema packages/client"
/**
 * 夹具里上游镜像 `dev` 拥有的包:`core` 是 `#1247` 之前就在辖区里的对照,中间五个是实测盲区
 * (`plugin` = Hooks 契约本体),`brand-new-upstream-pkg` 是「上游明天新加的那个包」,
 * 最后两个是 `#1668` 撤掉 carve-out 之后回到辖区的上游前端包。
 */
const BLIND_SPOT_PACKAGES = ["plugin", "llm", "desktop", "session-ui", "web", "brand-new-upstream-pkg"]
const MIRROR_PACKAGES = ["core", ...BLIND_SPOT_PACKAGES, ...FORMER_ROUNDTRIP_PACKAGES]

const leafOf = (pkg: string) => `packages/${pkg}/src/leaf.ts`

/**
 * 每个上游包一个叶子,全部落在 `dev` 与 `alpha` 的共同祖先里;alpha 自有包只在 alpha 侧存在
 * (⇒ ADR-043 因子① 对它们成立,而它们的叶子既不叫 `alpha-*` 也不带 marker ⇒ 因子② 不成立 ——
 * 这正是「整包 carve-out」这一层必须存在的理由,逐文件谓词接不住它们)。
 */
function allPackagesFixture() {
  const origin = mkdtempSync(join(tmpdir(), "codepuppy-north-star-pkgs-origin-"))
  git(origin, ["init", "-q", "-b", "alpha"])
  const seeded: Record<string, string> = {}
  for (const pkg of MIRROR_PACKAGES) seeded[leafOf(pkg)] = "export const leaf = 1\n"
  commit(origin, "seed: the upstream mirror owns one leaf per package", seeded)
  git(origin, ["checkout", "-q", "-b", "dev"])
  commit(origin, "upstream mirror moves on", { "packages/core/src/dev-only.ts": "export const devOnly = 1\n" })
  git(origin, ["checkout", "-q", "alpha"])
  const codepuppyOnly: Record<string, string> = {}
  for (const pkg of CODEPUPPY_OWNED_PACKAGES) codepuppyOnly[leafOf(pkg)] = "export const leaf = 1\n"
  commit(origin, "alpha adds its own workspace packages", codepuppyOnly)

  const work = mkdtempSync(join(tmpdir(), "codepuppy-north-star-pkgs-work-"))
  const cloned = Bun.spawnSync(["git", "clone", "-q", origin, work], { env: { ...GIT_ENV } })
  if (cloned.exitCode !== 0) throw new Error(`git clone 失败:${cloned.stderr.toString()}`)
  git(work, ["checkout", "-q", "-b", "feature", "origin/alpha"])
  return { origin, work }
}

/**
 * 生产脚本的复制品,只把某一格改回缺陷态 —— **控制组专用**,不要拿它做正向判据。
 * 改动为空即抛:一个什么都没改的「控制组」会和生产跑出一样的结果,然后空对空地绿。
 */
function mutatedGuard(tag: string, edit: (src: string) => string): string {
  const path = join(mkdtempSync(join(tmpdir(), `codepuppy-north-star-${tag}-`)), "guard.sh")
  const before = readFileSync(GUARD, "utf8")
  const after = edit(before)
  if (after === before) throw new Error(`控制组没能改动生产脚本(${tag})—— 本次测量作废`)
  writeFileSync(path, after)
  return path
}

describe("#1247 辖区覆盖上游镜像里的每一个包", () => {
  test("每个上游包各改一行 ⇒ 逐个被点名(控制组:旧的 8 包辖区放行其中六个)", () => {
    const { work } = allPackagesFixture()
    const edits: Record<string, string> = {}
    for (const pkg of MIRROR_PACKAGES) edits[leafOf(pkg)] = "export const leaf = 999\n"
    commit(work, "touch one file in every upstream package", edits)

    // ── 控制组:辖区换回 `#1247` 之前那 8 个包 —— 六个盲区包一个都不许被点名 ────────
    const old = runGuard(
      work,
      mutatedGuard("pre1247", (s) => s.replace(/^UPSTREAM_PATHS="[^"]*"$/m, `UPSTREAM_PATHS="${PRE_1247_JURISDICTION}"`)),
    )
    expect(old.output, `控制组连 packages/core 都没点名 —— 夹具坏了,本条测量作废:\n${old.output}`).toContain(leafOf("core"))
    for (const pkg of BLIND_SPOT_PACKAGES) {
      expect(old.output, `控制组点名了 ${pkg},那它就不是 #1247 要修的那个缺陷态:\n${old.output}`).not.toContain(leafOf(pkg))
    }

    // ── 生产:同一棵树,每一个上游包都必须被点名 ────────────────────────────────
    const run = runGuard(work)
    expect(run.exitCode, `改了每一个上游包,守卫却放行:\n${run.output}`).not.toBe(0)
    for (const pkg of MIRROR_PACKAGES) {
      expect(run.output, `packages/${pkg} 仍在辖区外 —— 改它没有任何东西变红:\n${run.output}`).toContain(leafOf(pkg))
    }
  })

  test("上游明天新增的包默认在辖区内 —— 不需要任何人记得去登记它", () => {
    const { work } = allPackagesFixture()
    commit(work, "touch a package the guard has never heard of", {
      [leafOf("brand-new-upstream-pkg")]: "export const leaf = 999\n",
    })
    const run = runGuard(work)
    // 这一条杀的是「换一张更长的枚举」这个修法:枚举再长,对**下一个**新成员仍然默认放行。
    // 「恒红实现也能满足它」由下面两条绿向用例杀掉。
    expect(run.exitCode, `上游新增的包默认在辖区外 —— 枚举式辖区的缺陷原样还在:\n${run.output}`).not.toBe(0)
    expect(run.output, `红了但没点名那个新包:\n${run.output}`).toContain(leafOf("brand-new-upstream-pkg"))
  })

  test("alpha 自有包整包豁免 ⇒ 绿(控制组:抹掉 carve-out 即红且点名)", () => {
    const { work } = allPackagesFixture()
    const edits: Record<string, string> = {}
    for (const pkg of CODEPUPPY_OWNED_PACKAGES) edits[leafOf(pkg)] = "export const leaf = 2\n"
    commit(work, "edit the codepuppy-owned workspace packages", edits)

    const run = runGuard(work)
    expect(run.exitCode, `改 alpha 自有包被判成破北极星 —— 恒红的门等于没有门:\n${run.output}`).toBe(0)

    // 控制组:抹掉整包 carve-out 之后同一棵树必须红。那些叶子既不叫 `alpha-*` 也没写 marker,
    // ADR-043 的逐文件谓词接不住 —— 所以「整包豁免」这一层不是冗余。
    const without = runGuard(
      work,
      // 换成一个不存在的包名而不是清空:清空后 pathspec 数组为空,bash 3.2 的 `set -u` 会在展开处
      // 直接崩(那是控制组自己坏了,不是「carve-out 没了」)。
      mutatedGuard("no-codepuppy-pkgs", (s) =>
        s.replace(/^CODEPUPPY_OWNED_PACKAGES="[^"]*"$/m, 'CODEPUPPY_OWNED_PACKAGES="no-such-package"'),
      ),
    )
    expect(without.exitCode, `抹掉 carve-out 之后还是绿 —— 上面那条绿不是 carve-out 挣来的:\n${without.output}`).not.toBe(0)
    for (const pkg of CODEPUPPY_OWNED_PACKAGES) {
      expect(without.output, `控制组没点名 packages/${pkg}:\n${without.output}`).toContain(leafOf(pkg))
    }
  })

  test("#1668:roundtrip carve-out 已撤 —— 改上游 packages/{app,ui} ⇒ 红且点名(控制组:放回 carve-out 即绿)", () => {
    const { work } = allPackagesFixture()
    const edits: Record<string, string> = {}
    for (const pkg of FORMER_ROUNDTRIP_PACKAGES) edits[leafOf(pkg)] = "export const leaf = 3\n"
    commit(work, "edit the upstream frontend packages in place", edits)

    const run = runGuard(work)
    expect(run.exitCode, `改上游 packages/{app,ui} 被放行 —— 撤掉 carve-out 没生效:\n${run.output}`).not.toBe(0)
    for (const pkg of FORMER_ROUNDTRIP_PACKAGES) {
      expect(run.output, `packages/${pkg} 仍在辖区外:\n${run.output}`).toContain(leafOf(pkg))
    }

    // 控制组:把 `#1668` 之前的 carve-out ②(`app ui` 进 pathspec 排除)放回去,同一棵树必须绿 ——
    // 证明上面那条红是撤掉 carve-out 挣来的,不是夹具在别处红。
    const restored = runGuard(
      work,
      mutatedGuard("restore-roundtrip", (s) =>
        s.replace("for pkg in $CODEPUPPY_OWNED_PACKAGES; do\n  CARVEOUT_PATHSPECS", "for pkg in $CODEPUPPY_OWNED_PACKAGES app ui; do\n  CARVEOUT_PATHSPECS"),
      ),
    )
    expect(restored.exitCode, `放回 carve-out 之后仍是红 —— 夹具在别处红,本条测量作废:\n${restored.output}`).toBe(0)
  })

  test("把真上游包写进 alpha 自有清单 ⇒ 守卫自己红并点名那条声明,不是发一整个包的豁免", () => {
    const { work } = allPackagesFixture()
    commit(work, "touch the hooks contract", { [leafOf("plugin")]: "export const leaf = 999\n" })
    // 先证明这棵树本来就该红,否则下面那条红可能来自别处。
    expect(runGuard(work).exitCode, "夹具本身没红 —— 本条测量作废").not.toBe(0)

    const forged = runGuard(
      work,
      mutatedGuard("forged-owner", (s) => s.replace(/^CODEPUPPY_OWNED_PACKAGES="([^"]*)"$/m, 'CODEPUPPY_OWNED_PACKAGES="$1 plugin"')),
    )
    expect(forged.exitCode, `一行配置就把整个上游包移出了辖区:\n${forged.output}`).not.toBe(0)
    expect(forged.output, `红了,但没说清问题出在那条声明上:\n${forged.output}`).toContain("CODEPUPPY_OWNED_PACKAGES")
    expect(forged.output, `红了,但没点名是哪个包被冒领了:\n${forged.output}`).toContain("packages/plugin")
  })
})

// `#1566`:只读模式 `--print-takeover` —— 每日上游同步的接管清单只有本脚本这一份。
// 同步工作流从合并前的可信树取本脚本跑这个模式(行为闸在 sync-upstream-takeover-isolation.test.ts);
// 这里钉两件事:①输出与 UPSTREAM_EXCLUDES 同源(删一条即变,杀掉「印一份写死的表」);
// ②工作流文件里没有任何字面接管路径(有人往 workflow 里手抄一份 ⇒ 红)。
const SYNC_WORKFLOW = resolve(REPO_ROOT, ".github/workflows/sync-upstream.yml")

function printTakeover(script: string = GUARD): string[] {
  const r = Bun.spawnSync(["bash", script, "--print-takeover"], { cwd: REPO_ROOT, env: GIT_ENV })
  if (r.exitCode !== 0) throw new Error(`--print-takeover 退出码 ${r.exitCode}:${r.stderr.toString()} —— 本次测量作废`)
  return r.stdout
    .toString()
    .split("\n")
    .filter((l) => l.length > 0)
}

function excludesFromSource(source: string): string[] {
  const block = /^UPSTREAM_EXCLUDES=\(\n([\s\S]*?)^\)$/m.exec(source)
  if (!block) throw new Error("守卫脚本里找不到 UPSTREAM_EXCLUDES=( … ) —— 本次测量作废")
  return [...block[1].matchAll(/^\s+':\(exclude\)([^']+)'/gm)].map((m) => m[1])
}

function literalTakeoverPaths(workflowText: string, takeover: string[]): string[] {
  return takeover.filter((p) => workflowText.includes(p))
}

describe("#1566 --print-takeover:接管清单只有守卫这一份", () => {
  test("逐行打印 UPSTREAM_EXCLUDES 的路径(去掉 :(exclude) 前缀),与数组逐条相同", () => {
    const printed = printTakeover()
    const expected = excludesFromSource(readFileSync(GUARD, "utf8"))
    // `#1662` 最终清单可以很短、将来甚至为空(F10),所以不再用条数下限防解析退化,改用两种独立读法互相核对:
    // 数组块的正则解析,与逐行数 `  ':(exclude)` 开头的行。
    const lines = readFileSync(GUARD, "utf8").split("\n").filter((line) => /^\s+':\(exclude\)/.test(line)).length
    expect(expected.length, "白名单解析退化 —— 本次测量作废").toBe(lines)
    expect(printed).toEqual(expected)
    expect(printed.filter((p) => p.startsWith(":(")), "输出里残留 pathspec 前缀").toEqual([])
  })

  test("控制组:守卫复制品删掉一条白名单 ⇒ 打印的清单跟着少那一条", () => {
    const full = printTakeover()
    const victim = "packages/core/src/oauth/page.ts"
    expect(full, "前提:那条接管路径在生产清单里").toContain(victim)
    const trimmed = printTakeover(mutatedGuard("takeover-minus-one", (s) => s.replace(`  ':(exclude)${victim}'\n`, "")))
    expect(trimmed).toEqual(full.filter((p) => p !== victim))
  })

  test("sync-upstream.yml 里没有任何字面接管路径(控制组:手抄一条进去即被点名)", () => {
    const takeover = printTakeover()
    const text = readFileSync(SYNC_WORKFLOW, "utf8")
    expect(literalTakeoverPaths(text, takeover)).toEqual([])
    const copied = `${text}\n# paths: ${takeover[0]}\n`
    expect(literalTakeoverPaths(copied, takeover)).toContain(takeover[0])
  })
})

// ── `#1664`:含受审上游合并的分支 —— packages/ 以那个合并的上游父为基准(#1662 裁决书 F3)────────
//
// 换代整合分支上有一个真合并提交 M0(第二父 = OpenCode 2 的上游提交),树按规则构造:上游路径取上游原样。
// 守卫若仍拿 origin/alpha 当基准,M0 带来的上千个上游 D/M 会全部被点名(本分支实测 3502 行),并行的 lane
// 只剩 `--no-verify`。所以这种分支上守卫判「packages/ 相对上游父有没有未登记的偏离」(基线 §2.3 第 4 步)。
// 两臂:M0 原样带来的上游改动 ⇒ 绿;M0 之后再改一个上游文件 ⇒ 红。识别「上游合并」靠「另一个父的树里没有
// 任何 Code Puppy 自有包」,不靠上游镜像 —— 镜像会陈旧(2026-11-09 的 origin/dev 仍是 1.x 的 055d95bb),
// 夹具照这个样子把 dev 留在分叉点。
const V1_ONLY = "packages/core/src/v1-only.ts"
const V2_ONLY = "packages/core/src/v2-only.ts"
/** 住在上游包里的 Code Puppy 文件 —— M0 按规则移出(基线 §2.3:alpha 加在上游包里的 80 个文件)。 */
const CODEPUPPY_UNDER_UPSTREAM = "packages/core/src/codepuppy-moved-out.ts"

/**
 *   seed ──► dev        (上游镜像停在分叉点,不含上游父 —— 与真实的 origin/dev 同形)
 *     ├──► upstream     (下一代:改 UPSTREAM_FILE、删 V1_ONLY、加 V2_ONLY;树里没有任何 Code Puppy 包)
 *     └──► alpha        (Code Puppy 自有包 + 一个住在上游包里的 codepuppy-* 文件)
 *              └──► feature = M0:`git merge --no-ff --no-commit origin/upstream`,上游路径取上游原样,
 *                   住在上游包里的那个 Code Puppy 文件移出,然后提交 —— 夹具里的合并是测试数据。
 */
function upstreamMergeFixture() {
  const origin = mkdtempSync(join(tmpdir(), "codepuppy-north-star-m0-origin-"))
  git(origin, ["init", "-q", "-b", "alpha"])
  commit(origin, "seed: the last commit alpha and upstream share", {
    [UPSTREAM_FILE]: "export const leaf = 1\n",
    [TAKEN_OVER_FILE]: "export const permission = 1\n",
    [V1_ONLY]: "export const v1 = 1\n",
  })
  git(origin, ["branch", "dev"])
  git(origin, ["checkout", "-q", "-b", "upstream"])
  git(origin, ["rm", "-q", V1_ONLY])
  const upstream = commit(origin, "upstream: the next generation", {
    [UPSTREAM_FILE]: "export const leaf = 2 // next generation\n",
    [V2_ONLY]: "export const v2 = 1\n",
  })
  git(origin, ["checkout", "-q", "alpha"])
  commit(origin, "alpha: its own package, plus one codepuppy file under an upstream package", {
    [CODEPUPPY_FILE]: "export const codepuppyOwned = 1\n",
    [CODEPUPPY_UNDER_UPSTREAM]: "export const movedOut = 1\n",
  })

  const work = mkdtempSync(join(tmpdir(), "codepuppy-north-star-m0-work-"))
  const cloned = Bun.spawnSync(["git", "clone", "-q", origin, work], { env: { ...GIT_ENV } })
  if (cloned.exitCode !== 0) throw new Error(`git clone 失败:${cloned.stderr.toString()}`)
  git(work, ["checkout", "-q", "-b", "feature", "origin/alpha"])
  git(work, ["merge", "-q", "--no-ff", "--no-commit", "origin/upstream"])
  git(work, ["rm", "-q", CODEPUPPY_UNDER_UPSTREAM])
  git(work, ["commit", "-q", "-m", "M0: merge upstream, tree built by the rules"])
  return { work, upstream }
}

describe("#1664 含受审上游合并的分支:packages/ 以那个合并的上游父为基准", () => {
  test("M0 原样带来的上游改动 ⇒ 绿,并说出基准是上游父(控制组:关掉识别 ⇒ 红,点名 M0 带来的上游改动)", () => {
    const { work, upstream } = upstreamMergeFixture()
    const stale = Bun.spawnSync(["git", "merge-base", "--is-ancestor", upstream, "origin/dev"], { cwd: work, env: { ...GIT_ENV } })
    expect(stale.exitCode, "前提:上游镜像不含上游父(真实的 origin/dev 就是这样)—— 夹具没造出来").toBe(1)

    const run = runGuard(work)
    expect(run.exitCode, `M0 原样带来的上游改动被点名了 —— 整合分支上这道门恒红:\n${run.output}`).toBe(0)
    expect(run.output, `没说出这一跑以上游父为基准:\n${run.output}`).toContain(`上游父 ${upstream.slice(0, 7)}`)

    // 控制组:识别关掉(候选范围变空)= 本票之前的守卫,同一棵树必须红,而且红在 M0 带来的上游改动上。
    const legacy = runGuard(work, mutatedGuard("no-upstream-merge", (s) => s.replace("--merges origin/alpha..HEAD", "--merges HEAD..HEAD")))
    expect(legacy.exitCode, `控制组没红 —— 夹具没造出「M0 让守卫恒红」的形状:\n${legacy.output}`).not.toBe(0)
    expect(legacy.output).toContain(UPSTREAM_FILE)
    expect(legacy.output).toContain(V1_ONLY)
  })

  test("M0 之后再改一个上游文件 ⇒ 红,且点名它", () => {
    const { work } = upstreamMergeFixture()
    commit(work, "touch an upstream file after M0", { [UPSTREAM_FILE]: "export const leaf = 999\n" })
    const run = runGuard(work)
    expect(run.exitCode, `M0 之后改上游文件被放行了:\n${run.output}`).not.toBe(0)
    expect(run.output).toContain(UPSTREAM_FILE)
  })

  test("新增进上游包的文件:codepuppy-* ⇒ 绿且点名豁免;不自报家门 ⇒ 红(控制组:这一档加回 DMR ⇒ 漏掉)", () => {
    const { work } = upstreamMergeFixture()
    const owned = "packages/core/src/codepuppy-addition.ts"
    commit(work, "add an owned file under an upstream package", { [owned]: "export const owned = 1\n" })
    const ok = runGuard(work)
    expect(ok.exitCode, `自报家门的新增文件被判成偏离:\n${ok.output}`).toBe(0)
    expect(ok.output, `豁免了却没说:\n${ok.output}`).toContain(owned)

    const bare = "packages/core/src/bare-addition.ts"
    commit(work, "add an unmarked file under an upstream package", { [bare]: "export const bare = 1\n" })
    const run = runGuard(work)
    expect(run.exitCode, `不自报家门的新增文件被放行了 —— §2.3 第 4 步「多出任何一行」没生效:\n${run.output}`).not.toBe(0)
    expect(run.output).toContain(bare)

    const dmr = runGuard(
      work,
      mutatedGuard("upstream-merge-dmr", (s) =>
        s.replace('--no-renames --name-only "$upstream_parent" HEAD', '--no-renames --diff-filter=DMR --name-only "$upstream_parent" HEAD'),
      ),
    )
    expect(dmr.exitCode, `控制组没绿 —— 上面那条红不是「新增也算」挣来的:\n${dmr.output}`).toBe(0)
  })

  test("往 2.x 新增的上游文件里写 marker ⇒ 仍然红(因子①问上游父,不问陈旧的镜像;控制组:去掉那一行 ⇒ 被放行)", () => {
    const { work } = upstreamMergeFixture()
    // V2_ONLY 在上游父里有、在陈旧镜像(origin/dev = 分叉点)里没有 —— 只看镜像的因子①会把它当成「上游从没有过」。
    commit(work, "forge the ownership marker inside a file upstream added in the next generation", {
      [V2_ONLY]: `// ${OWNED_MARKER}\nexport const v2 = 999\n`,
    })
    const run = runGuard(work)
    expect(run.exitCode, `往上游父里就有的文件写 marker 就被放行了:\n${run.output}`).not.toBe(0)
    expect(run.output).toContain(V2_ONLY)

    const lenient = runGuard(
      work,
      mutatedGuard("upstream-parent-factor-one", (s) =>
        s.replace(`    git cat-file -e "\${upstream_parent}:$1" 2>/dev/null && return 1\n`, ""),
      ),
    )
    expect(lenient.exitCode, `控制组没绿 —— 上面那条红不是「因子①问上游父」挣来的:\n${lenient.output}`).toBe(0)
  })

  test("过渡接管清单里的文件在 M0 之后被改 ⇒ 绿且不点名", () => {
    const { work } = upstreamMergeFixture()
    commit(work, "re-take-over a file on the transitional list", { [TAKEN_OVER_FILE]: "export const permission = 2\n" })
    const run = runGuard(work)
    expect(run.exitCode, `过渡清单没生效:\n${run.output}`).toBe(0)
    expect(run.output).not.toContain(TAKEN_OVER_FILE)
  })

  test("lane 合进整合分支的合并(另一个父带着 Code Puppy 包)不被认成上游合并", () => {
    const { work, upstream } = upstreamMergeFixture()
    git(work, ["checkout", "-q", "-b", "lane"])
    commit(work, "lane edits an upstream file", { [UPSTREAM_FILE]: "export const leaf = 3 // lane\n" })
    git(work, ["checkout", "-q", "feature"])
    git(work, ["merge", "-q", "--no-ff", "lane", "-m", "integrate the lane"])
    const run = runGuard(work)
    // 把 lane 头错认成上游父的话,lane 那次改动就成了基准的一部分,这一跑会绿。
    expect(run.exitCode, `lane 带进来的上游改动被放行了 —— 识别把 lane 头当成了上游父:\n${run.output}`).not.toBe(0)
    expect(run.output).toContain(UPSTREAM_FILE)
    expect(run.output).toContain(`上游父 ${upstream.slice(0, 7)}`)
  })
})

// ── `#1664`:scripts/assert-upstream-ancestor.sh —— 上游祖先不能被 squash / rebase 弄丢(裁决书 F2)────
// 本仓 PR 默认 squash。squash 或 rebase 会把 M0 压成普通提交:树一字不差,上游祖先没了,merge-base 不前移。
// 只比树的判据(上面的守卫、§2.3 第 4 步的树判据)看不出这件事,所以单列一条祖先判据,并在一个 squash 重放的
// 夹具上证明它会红。夹具里的合并与 squash 都是测试数据。
const ANCESTOR = resolve(REPO_ROOT, "scripts/assert-upstream-ancestor.sh")

function runAncestor(repo: string, args: string[]): GuardRun {
  const result = Bun.spawnSync(["bash", ANCESTOR, ...args], { cwd: repo, env: { ...GIT_ENV } })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (output.trim().length === 0) throw new Error("祖先检查一个字都没输出 —— 本次测量作废(不是通过)")
  return { exitCode: result.exitCode, output }
}

describe("#1664 assert-upstream-ancestor.sh:上游合并必须留在历史里", () => {
  test("真合并的分支 ⇒ 0;同一分支 squash 重放到 alpha 的临时副本上 ⇒ 1(树一字不差,祖先没了)", () => {
    const { work, upstream } = upstreamMergeFixture()
    commit(work, "a lane commit after M0", { [CODEPUPPY_FILE]: "export const codepuppyOwned = 2\n" })
    const merged = runAncestor(work, [upstream])
    expect(merged.exitCode, `真合并的分支被判成丢了祖先:\n${merged.output}`).toBe(0)

    git(work, ["checkout", "-q", "-b", "alpha-copy", "origin/alpha"])
    git(work, ["merge", "-q", "--squash", "feature"])
    git(work, ["commit", "-q", "-m", "squash-merge the integration branch (the repo's default PR merge)"])
    expect(git(work, ["rev-parse", "alpha-copy^{tree}"]), "squash 重放的树与原分支不同 —— 变异没构造对").toBe(
      git(work, ["rev-parse", "feature^{tree}"]),
    )
    const squashed = runAncestor(work, [upstream])
    expect(squashed.exitCode, `squash 重放之后祖先检查没红:\n${squashed.output}`).toBe(1)
    expect(squashed.output).toContain("squash")

    // 第二个参数是「合入后对 origin/alpha 再跑一次」那一跑的形状。
    expect(runAncestor(work, [upstream, "feature"]).exitCode).toBe(0)
  })

  test("SHA 或 ref 解析不出、参数不对 ⇒ 2(测不到,不是通过)", () => {
    const { work } = upstreamMergeFixture()
    expect(runAncestor(work, ["0123456789abcdef0123456789abcdef01234567"]).exitCode).toBe(2)
    expect(runAncestor(work, ["HEAD", "no-such-ref"]).exitCode).toBe(2)
    expect(runAncestor(work, []).exitCode).toBe(2)
  })
})
