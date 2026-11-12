// `#1566` —— 每日上游同步(`.github/workflows/sync-upstream.yml`)遵守接管清单的**行为闸**。
//
// 这道门守的是什么(大白话):我们有一批上游文件已经改成了自己的版本(接管清单 =
// `scripts/north-star-guard.sh` 的 `UPSTREAM_EXCLUDES`)。从前同步只看 git 冲突:上游改动与我们的
// 改动不在同一处时 git 干净合并,上游的改动就**悄悄混进**我们的版本(实例:`003f6f764` 给
// `session/llm/request.ts` +2 行、`57646831b` 改了 `test/provider/transform.test.ts`)。现在:
//   · `Takeover intake check` 在合并前从可信树取清单,上游候选碰到清单 ⇒ 不合并、不出推送包,
//     以「需要升级审查」失败,并把路径、上游提交、双方差异写进运行摘要与产物;
//   · `Takeover paths unchanged by merge` 在合并后再核对一次;
//   · 剩余冲突以「未登记的偏离:按 ADR-029 登记或还原」具名报错;
//   · 人工移植以**真合并提交**合入后,下一次同步不再命中同一批路径(squash 则会再次命中)。
//
// 为什么判据长这样:
//   · **不断言 YAML 源码文本。** 用 `Bun.YAML` 从生产 workflow 里取出这几步的 `run` 体,在真 git
//     仓上按顺序用 `bash -e` 跑(Actions 对不写 `shell:` 的 `run:` 用的就是 `bash -e {0}`),
//     一步失败即停 —— 与 Actions 的默认 `success()` 语义一致,于是「不出推送包」由真的
//     `Build sync bundle artifact` 那一步有没有产出 `sync-artifact/` 来判。
//   · **清单来自生产守卫本体**:夹具 alpha 树里放的是本仓 `scripts/north-star-guard.sh` 的原样副本,
//     接管文件取清单里的真条目 `packages/core/src/oauth/page.ts`(`#1662` 最终清单的两条之一;上面那次
//     静默混入的 `session/llm/request.ts` 随 v1 引擎删除,已出清单)。
//   · **先证明手段测得出已知的坏**:删掉 intake 步 ⇒ 无冲突那例被合并步静默合入;移植改用 squash ⇒
//     下一次同步再次命中同一批路径;intake 改成执行工作树里的守卫 ⇒ 上游树里的脚本被执行。
//
// ⚠️ 诚实边界:这里不跑 Prompt/锚点 tripwire、Engine smoke(要真 bun 与真引擎)与两个 upload 步;
// 它们与本票的判定无关,且都排在 intake 之后或只在失败时运行。
//
// 删掉本文件会失去什么:这条每天只在 GitHub 上跑的同步链回到零行为判据 —— intake 被删、清单改成
// 工作流里手抄、合并后核对被删、报错文案退回「only-add discipline was broken」,都不会有东西变红。
// 它因此登记在 scripts/gate-files.tsv 里,拿精确条数。

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { describe, expect, test } from "bun:test"

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..")
const WORKFLOW = resolve(REPO_ROOT, ".github/workflows/sync-upstream.yml")
const GUARD = resolve(REPO_ROOT, "scripts/north-star-guard.sh")

const INTAKE = "Takeover intake check"
const MERGE = "Merge `dev` into `alpha`"
const POST = "Takeover paths unchanged by merge"
const BUNDLE = "Build sync bundle artifact"
const JUDGE = "Authority registry judge"
const PROOFS = "Authority proofs pass"
const FULL = [INTAKE, MERGE, POST, BUNDLE]

const REVIEW_TITLE = "::error title=takeover upgrade review required::"
const UNREGISTERED = "未登记的偏离:按 ADR-029 登记或还原"

/** 接管清单里的真条目(`#1662` 最终清单:ADR-042 的 OAuth 回调页)。 */
const TAKEOVER = "packages/core/src/oauth/page.ts"
const ENGINE = "packages/opencode/src/engine.ts"

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "alpha ci fixture",
  GIT_AUTHOR_EMAIL: "fixture@alpha.invalid",
  GIT_COMMITTER_NAME: "alpha ci fixture",
  GIT_COMMITTER_EMAIL: "fixture@alpha.invalid",
} as const
const BASE_PATH = process.env.PATH ?? "/usr/bin:/bin"

// ── 生产 workflow 的步骤体 ──────────────────────────────────────────────────────

function candidateSteps(): any[] {
  const doc = Bun.YAML.parse(readFileSync(WORKFLOW, "utf8")) as any
  const steps = doc?.jobs?.candidate?.steps
  if (!Array.isArray(steps)) throw new Error("sync-upstream.yml 里读不出 jobs.candidate.steps —— 本次测量作废,不是通过")
  return steps
}

function stepBody(name: string): string {
  const step = candidateSteps().find((s: any) => typeof s?.name === "string" && s.name.startsWith(name))
  if (!step || typeof step.run !== "string" || step.run.trim().length === 0)
    throw new Error(`sync-upstream.yml 里找不到「${name}」那一步的 run 体 —— 本次测量作废,不是通过`)
  if (typeof step.shell === "string") throw new Error(`「${name}」声明了 shell: ${step.shell} —— 本夹具按 bash -e 跑,语义已漂`)
  return step.run
}

// ── 夹具 ────────────────────────────────────────────────────────────────────────

function git(cwd: string, args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: { PATH: BASE_PATH, ...GIT_ENV } })
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} 失败:${r.stderr.toString()}${r.stdout.toString()}`)
  return r.stdout.toString().trim()
}

function tryGit(cwd: string, args: string[]): number {
  return Bun.spawnSync(["git", ...args], { cwd, env: { PATH: BASE_PATH, ...GIT_ENV } }).exitCode ?? -1
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

function showFile(repo: string, rev: string, path: string): string | null {
  const r = Bun.spawnSync(["git", "show", `${rev}:${path}`], { cwd: repo, env: { PATH: BASE_PATH, ...GIT_ENV } })
  return r.exitCode === 0 ? r.stdout.toString() : null
}

/** 12 行的接管文件;`edits` 按行号(1 起)覆盖。两处改动隔开足够远,git 才会干净合并。 */
function takeoverBody(edits: Record<number, string> = {}): string {
  return Array.from({ length: 12 }, (_, i) => edits[i + 1] ?? `export const l${i + 1} = ${i + 1}`).join("\n") + "\n"
}
const CODEPUPPY_EDIT = { 1: 'export const l1 = "alpha" // alpha takeover' }
const UPSTREAM_FAR = { 12: 'export const l12 = "upstream" // upstream change' }
const UPSTREAM_SAME = { 1: 'export const l1 = "upstream" // upstream change' }

const VENDOR_TGZ = "vendor/opencode-ai-client-1.17.13.tgz"
const TGZ_BYTES = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xff])

type Shape =
  /** 上游只改非接管文件 */
  | "plain"
  /** 上游改接管文件,与我方改动不冲突 */
  | "takeover-clean"
  /** 上游改接管文件,与我方改动冲突 */
  | "takeover-conflict"
  /** 上游与我方都改了一个不在清单里的上游文件 */
  | "unregistered"

type Fixture = { repo: string; work: string; oldDev: string; newDev: string; oldAlpha: string }

/**
 * 真实世界的缩比:dev = 上游(含 ADR-034 的 pin 前端),alpha = 前端 SOT 补丁 + 生产守卫副本 +
 * 改过的接管文件;dev 前进一步。结束时工作树停在 dev —— 与生产里 intake 运行时一致
 * (上一步 `Fast-forward dev` 刚 checkout 了它)。
 */
function fixture(
  shape: Shape,
  opts: { evilGuardInDev?: boolean; guard?: (source: string) => string; alphaFiles?: Record<string, string> } = {},
): Fixture {
  const work = mkdtempSync(join(tmpdir(), "codepuppy-sync-takeover-"))
  const repo = join(work, "repo")
  mkdirSync(repo, { recursive: true })

  git(repo, ["init", "-q", "-b", "dev"])
  write(repo, "packages/app/src/app.tsx", "export function App() {\n  return null // upstream\n}\n")
  write(repo, "packages/app/package.json", `${JSON.stringify({ name: "app" }, null, 2)}\n`)
  write(repo, "packages/ui/src/button.tsx", "export const button = 1\n")
  write(
    repo,
    "packages/session-ui/package.json",
    `${JSON.stringify({ name: "session-ui", dependencies: { "@opencode-ai/client": `file:../app/${VENDOR_TGZ}` } }, null, 2)}\n`,
  )
  write(repo, ENGINE, "export const engine = 1\n")
  write(repo, TAKEOVER, takeoverBody())
  write(repo, "bun.lock", '{\n  "lockfileVersion": 1\n}\n')
  const pin = commitAll(repo, "upstream pin")

  git(repo, ["checkout", "-q", "-b", "alpha"])
  write(repo, "packages/app/src/app.tsx", "export function App() {\n  return AppSurfaces() // alpha seam\n}\n")
  write(
    repo,
    "packages/app/package.json",
    `${JSON.stringify({ name: "app", exports: { "./surface/session": "./src/pages/session.tsx" } }, null, 2)}\n`,
  )
  write(repo, `packages/app/${VENDOR_TGZ}`, TGZ_BYTES)
  commitAll(repo, "alpha frontend delta")
  const patch = Bun.spawnSync(["git", "diff", "--binary", pin, "--", "packages/app", "packages/ui"], {
    cwd: repo,
    env: { PATH: BASE_PATH, ...GIT_ENV },
  })
  if (patch.exitCode !== 0) throw new Error(`夹具生成 SOT 补丁失败:${patch.stderr.toString()}`)
  write(repo, "frontend/frontend-pin.lock", `pin=${pin} # fixture\n`)
  write(repo, "frontend/codepuppy-patches/codepuppy-frontend.patch", patch.stdout.toString())
  // 生产守卫的原样副本 —— 接管清单只有它一份。
  mkdirSync(join(repo, "scripts"), { recursive: true })
  copyFileSync(GUARD, join(repo, "scripts/north-star-guard.sh"))
  if (opts.guard) write(repo, "scripts/north-star-guard.sh", opts.guard(readFileSync(GUARD, "utf8")))
  write(repo, TAKEOVER, takeoverBody(CODEPUPPY_EDIT))
  if (shape === "unregistered") write(repo, ENGINE, "export const engine = 2 // alpha\n")
  for (const [path, body] of Object.entries(opts.alphaFiles ?? {})) write(repo, path, body)
  const oldAlpha = commitAll(repo, "alpha: SOT + takeover")

  git(repo, ["checkout", "-q", "dev"])
  if (shape === "plain") write(repo, ENGINE, "export const engine = 9 // upstream only\n")
  if (shape === "takeover-clean") write(repo, TAKEOVER, takeoverBody(UPSTREAM_FAR))
  if (shape === "takeover-conflict") write(repo, TAKEOVER, takeoverBody(UPSTREAM_SAME))
  if (shape === "unregistered") write(repo, ENGINE, "export const engine = 3 // upstream\n")
  if (opts.evilGuardInDev) {
    // 上游树里冒出一个同名脚本:被执行就留下 canary。intake 运行时工作树正是这棵树。
    write(
      repo,
      "scripts/north-star-guard.sh",
      `#!/usr/bin/env bash\ntouch "${join(work, "CANARY-upstream-script-executed")}"\necho packages/does-not-exist\n`,
    )
  }
  const newDev = commitAll(repo, `upstream advances (${shape})`)
  return { repo, work, oldDev: pin, newDev, oldAlpha }
}

/** 上游再前进一步(只改非接管文件),工作树停在 dev。 */
function upstreamAdvancesAgain(fx: Fixture): Fixture {
  git(fx.repo, ["checkout", "-q", "dev"])
  write(fx.repo, ENGINE, "export const engine = 42 // next upstream\n")
  const next = commitAll(fx.repo, "upstream advances again")
  return { ...fx, oldDev: fx.newDev, newDev: next, oldAlpha: git(fx.repo, ["rev-parse", "alpha"]) }
}

type Run = { failedAt: string | null; output: string; summary: string; ghOutput: string; runnerTemp: string }

/** 按顺序跑生产步骤体,一步失败即停(Actions 默认 `success()`)。`bodies` 可替换某一步的 body(变异臂)。 */
function runSteps(fx: Fixture, names: string[], bodies: Record<string, string> = {}): Run {
  const runId = Math.random().toString(36).slice(2)
  const runnerTemp = join(fx.work, `runner-temp-${runId}`)
  mkdirSync(runnerTemp, { recursive: true })
  const summaryFile = join(fx.work, `summary-${runId}.md`)
  const outputFile = join(fx.work, `output-${runId}.txt`)
  writeFileSync(summaryFile, "")
  writeFileSync(outputFile, "")
  let output = ""
  let failedAt: string | null = null
  for (const name of names) {
    const script = join(fx.work, `step-${runId}.sh`)
    writeFileSync(script, bodies[name] ?? stepBody(name))
    const r = Bun.spawnSync(["bash", "-e", script], {
      cwd: fx.repo,
      env: {
        PATH: BASE_PATH,
        ...GIT_ENV,
        OLD_ALPHA: fx.oldAlpha,
        OLD_DEV: fx.oldDev,
        NEW_DEV: fx.newDev,
        RUNNER_TEMP: runnerTemp,
        GITHUB_STEP_SUMMARY: summaryFile,
        GITHUB_OUTPUT: outputFile,
      },
    })
    output += `\n── ${name} (exit ${r.exitCode}) ──\n${r.stdout.toString()}${r.stderr.toString()}`
    if (r.exitCode !== 0) {
      failedAt = name
      break
    }
  }
  return {
    failedAt,
    output,
    summary: readFileSync(summaryFile, "utf8"),
    ghOutput: readFileSync(outputFile, "utf8"),
    runnerTemp,
  }
}

const bundleProduced = (fx: Fixture) => existsSync(join(fx.repo, "sync-artifact/sync.bundle"))

function expectReviewFailure(fx: Fixture, run: Run, codepuppyBefore: string, takeoverBefore: string | null) {
  expect(run.failedAt, `应在 intake 步以升级审查失败:\n${run.output}`).toBe(INTAKE)
  expect(run.output, `失败标题不是「需要升级审查」:\n${run.output}`).toContain(REVIEW_TITLE)
  expect(run.output).toContain("需要升级审查")
  expect(run.output, `没点名接管路径:\n${run.output}`).toContain(TAKEOVER)
  expect(bundleProduced(fx), "intake 失败了却产出了推送包").toBe(false)
  expect(git(fx.repo, ["rev-parse", "alpha"]), "intake 失败了 alpha 却前进了(发生了合并)").toBe(codepuppyBefore)
  expect(showFile(fx.repo, "alpha", TAKEOVER), "我方接管文件被改了").toBe(takeoverBefore)
}

// ── AC2 ─────────────────────────────────────────────────────────────────────────

describe("#1566 AC2 上游候选触及接管路径 ⇒ 不合并、不出推送包、以「需要升级审查」失败", () => {
  test("无冲突地改了接管文件 ⇒ 审查标题失败,我方文件逐字节不变;摘要与产物列出路径、上游提交与双方差异", () => {
    const fx = fixture("takeover-clean")
    const before = showFile(fx.repo, "alpha", TAKEOVER)
    const run = runSteps(fx, FULL)
    expectReviewFailure(fx, run, fx.oldAlpha, before)

    const report = join(run.runnerTemp, "takeover-review/report.md")
    expect(existsSync(report), "产物目录里没有审查报告").toBe(true)
    for (const [where, text] of [
      ["运行摘要", run.summary],
      ["产物", readFileSync(report, "utf8")],
    ] as const) {
      expect(text, `${where}没列出路径`).toContain(`### \`${TAKEOVER}\``)
      expect(text, `${where}没列出相关上游提交`).toContain("upstream advances (takeover-clean)")
      expect(text, `${where}没列出上游差异`).toContain('+export const l12 = "upstream" // upstream change')
      expect(text, `${where}没列出我方差异`).toContain('+export const l1 = "alpha" // alpha takeover')
      expect(text, `${where}没写出本次审查的上游 SHA`).toContain(fx.newDev)
    }
    expect(run.ghOutput, "没把 review=true 交给产物上传步").toContain("review=true")
  })

  test("冲突地改了接管文件 ⇒ 同样以审查标题失败,我方文件逐字节不变", () => {
    const fx = fixture("takeover-conflict")
    const before = showFile(fx.repo, "alpha", TAKEOVER)
    const run = runSteps(fx, FULL)
    expectReviewFailure(fx, run, fx.oldAlpha, before)
    expect(run.summary).toContain('+export const l1 = "upstream" // upstream change')
  })

  test("产物上传步只在 intake 判出审查时运行", () => {
    const step = candidateSteps().find((s: any) => s?.name === "Upload takeover review report")
    expect(step, "找不到审查报告的上传步").toBeDefined()
    expect(String(step.if)).toContain("failure()")
    expect(String(step.if)).toContain("steps.takeover.outputs.review == 'true'")
    expect(String(step.uses)).toStartWith("actions/upload-artifact@")
  })
})

// ── AC3 ─────────────────────────────────────────────────────────────────────────

describe("#1566 AC3 未触及接管路径照常合并;合并后接管路径不变;剩余冲突具名报错", () => {
  test("非接管改动 ⇒ 照常合并、出推送包,接管文件与合并前逐字节相同", () => {
    const fx = fixture("plain")
    const before = showFile(fx.repo, "alpha", TAKEOVER)
    const run = runSteps(fx, FULL)
    expect(run.failedAt, `干净的非接管同步被拦了:\n${run.output}`).toBeNull()
    expect(bundleProduced(fx), "照常合并却没产出推送包").toBe(true)
    expect(showFile(fx.repo, "alpha", ENGINE), "上游改动没进 alpha").toContain("upstream only")
    expect(showFile(fx.repo, "alpha", TAKEOVER)).toBe(before)
  })

  test("变异臂:删掉 intake 步 ⇒ 合并步把无冲突的接管改动静默合入;合并后核对当场失败", () => {
    const fx = fixture("takeover-clean")
    const before = showFile(fx.repo, "alpha", TAKEOVER)
    const silent = runSteps(fx, [MERGE])
    expect(silent.failedAt, `没有 intake 时合并步应当静默成功 —— 夹具没造出「无冲突混入」:\n${silent.output}`).toBeNull()
    const merged = showFile(fx.repo, "alpha", TAKEOVER)
    expect(merged, "没有 intake 时接管文件居然没变 —— 夹具测不出要测的坏").not.toBe(before)
    expect(merged).toContain('"upstream" // upstream change')

    const post = runSteps(fx, [POST])
    expect(post.failedAt, `合并后核对没拦住被改写的接管文件:\n${post.output}`).toBe(POST)
    expect(post.output).toContain("::error title=takeover changed by merge::")
    expect(post.output).toContain(TAKEOVER)
  })

  test("剩余冲突在清单外 ⇒ 以「未登记的偏离:按 ADR-029 登记或还原」点名、abort、不出推送包", () => {
    const fx = fixture("unregistered")
    const run = runSteps(fx, FULL)
    expect(run.failedAt, `清单外冲突没在合并步拦住:\n${run.output}`).toBe(MERGE)
    expect(run.output).toContain(UNREGISTERED)
    expect(run.output).not.toContain("only-add discipline was broken")
    expect(run.output, "没点名冲突路径").toContain(ENGINE)
    expect(bundleProduced(fx)).toBe(false)
    expect(tryGit(fx.repo, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]), "merge 没有被 abort").not.toBe(0)
  })
})

// ── AC4 ─────────────────────────────────────────────────────────────────────────

/** 人工移植:在 alpha 上把本次审查的上游 SHA 并进来,接管文件写成「我方 + 上游」的移植版。 */
function portByHand(fx: Fixture, how: "merge-commit" | "squash"): string {
  git(fx.repo, ["checkout", "-q", "alpha"])
  if (how === "merge-commit") git(fx.repo, ["merge", "--no-ff", "--no-commit", fx.newDev])
  else git(fx.repo, ["merge", "--squash", fx.newDev])
  const ported = takeoverBody({ ...CODEPUPPY_EDIT, ...UPSTREAM_FAR })
  write(fx.repo, TAKEOVER, ported)
  git(fx.repo, ["add", "-A"])
  git(fx.repo, ["commit", "-q", "--no-edit", "-m", `port upstream ${fx.newDev} into takeover (${how})`])
  return ported
}

describe("#1566 AC4 受审集成以合并提交合入后,下一次同步不再命中同一批路径", () => {
  test("合并提交移植(第二父 = 审查的上游 SHA)⇒ 下一次运行不再命中、照常合并、移植内容不变", () => {
    const fx = fixture("takeover-clean")
    expect(runSteps(fx, FULL).failedAt, "前置:第一次运行应命中升级审查").toBe(INTAKE)

    const ported = portByHand(fx, "merge-commit")
    expect(git(fx.repo, ["rev-parse", "alpha^2"]), "移植提交的第二父不是本次审查的上游 SHA").toBe(fx.newDev)

    const next = upstreamAdvancesAgain(fx)
    const run = runSteps(next, FULL)
    expect(run.failedAt, `合并提交移植之后下一次同步仍被拦:\n${run.output}`).toBeNull()
    expect(run.output).not.toContain(REVIEW_TITLE)
    expect(bundleProduced(next)).toBe(true)
    expect(showFile(next.repo, "alpha", TAKEOVER), "照常合并改写了移植好的接管文件").toBe(ported)
    expect(showFile(next.repo, "alpha", ENGINE)).toContain("next upstream")
  })

  test("变异臂:移植改用 squash ⇒ 下一次运行再次命中同一批路径", () => {
    const fx = fixture("takeover-clean")
    expect(runSteps(fx, FULL).failedAt, "前置:第一次运行应命中升级审查").toBe(INTAKE)

    portByHand(fx, "squash")
    expect(tryGit(fx.repo, ["rev-parse", "-q", "--verify", "alpha^2"]), "squash 不该有第二父 —— 变异没构造出来").not.toBe(0)

    const next = upstreamAdvancesAgain(fx)
    const before = showFile(next.repo, "alpha", TAKEOVER)
    const run = runSteps(next, FULL)
    expectReviewFailure(next, run, next.oldAlpha, before)
  })
})

// ── AC5 ─────────────────────────────────────────────────────────────────────────

describe("#1566 AC5 候选 job 不持有推送凭据;新步骤只执行 alpha 树里的脚本", () => {
  test("候选 workflow:contents: read、无写权限、无 secrets 引用、每个 checkout 都 persist-credentials: false(沿用 `#899` 判据)", () => {
    const doc = Bun.YAML.parse(readFileSync(WORKFLOW, "utf8")) as any
    expect(doc?.permissions).toEqual({ contents: "read" })
    expect(doc?.jobs?.candidate?.permissions, "候选 job 自己声明了权限").toBeUndefined()
    // 判解析后的文档(丢掉注释),不判源码文本 —— 抬头注释逐字写着 `secrets.SYNC_TOKEN`。
    expect(JSON.stringify(doc)).not.toContain("secrets.")
    const checkouts = candidateSteps().filter((s: any) => String(s?.uses ?? "").startsWith("actions/checkout@"))
    expect(checkouts.length, "一个 checkout 步都没解析到 —— 本次测量作废").toBeGreaterThan(0)
    for (const s of checkouts) expect(s?.with?.["persist-credentials"], `${s.name} 持有凭据`).toBe(false)
  })

  test("intake 与合并后核对只执行 $OLD_ALPHA 里的守卫;上游树里的同名脚本不被执行(变异臂:改读工作树 ⇒ 被执行)", () => {
    const canary = (fx: Fixture) => existsSync(join(fx.work, "CANARY-upstream-script-executed"))

    const fx = fixture("takeover-clean", { evilGuardInDev: true })
    const run = runSteps(fx, [INTAKE])
    expect(canary(fx), `intake 执行了上游树里的脚本:\n${run.output}`).toBe(false)
    expect(run.output, "清单没从可信树取到 —— 接管改动没被拦").toContain(REVIEW_TITLE)

    // 合并后核对单独跑在同一棵上游工作树上(合并会把同名脚本判成清单外冲突,走不到这一步)。
    const fx2 = fixture("plain", { evilGuardInDev: true })
    const ok = runSteps(fx2, [POST])
    expect(ok.failedAt, ok.output).toBeNull()
    expect(canary(fx2), `合并后核对执行了工作树里的脚本:\n${ok.output}`).toBe(false)

    const src = stepBody(INTAKE)
    const fromTree = 'git show "$OLD_ALPHA:scripts/north-star-guard.sh"'
    expect(src, "变异构造不出来 —— intake 取守卫的写法变了").toContain(fromTree)
    const fx3 = fixture("takeover-clean", { evilGuardInDev: true })
    runSteps(fx3, [INTAKE], { [INTAKE]: src.replace(fromTree, "cat scripts/north-star-guard.sh") })
    expect(canary(fx3), "变异臂没执行到工作树脚本 —— 这条判据测不出已知的坏").toBe(true)
  })
})

// ── `#1662` F10:最终清单可以为空;空清单与「守卫没给出结果」必须分得开 ─────────────────────────────

/** 守卫复制品:接管数组清空(合法的空清单)。 */
const emptyList = (source: string) => {
  const start = source.indexOf("UPSTREAM_EXCLUDES=(\n")
  const end = source.indexOf("\n)\n", start) + 3
  if (start < 0 || end < 3) throw new Error("守卫里找不到 UPSTREAM_EXCLUDES 数组 —— 本次测量作废")
  return `${source.slice(0, start)}UPSTREAM_EXCLUDES=(\n)\n${source.slice(end)}`
}

describe("#1662 F10 空接管清单照常同步;守卫读不出条数才中止", () => {
  test("清单为空(UPSTREAM_EXCLUDES_COUNT=0)⇒ intake 与合并后核对都放行,照常合并、出推送包", () => {
    const fx = fixture("plain", { guard: emptyList })
    const run = runSteps(fx, FULL)
    expect(run.failedAt, `空清单不该让同步失败:\n${run.output}`).toBeNull()
    expect(run.output).toContain("Takeover list is empty (UPSTREAM_EXCLUDES_COUNT=0)")
    expect(bundleProduced(fx)).toBe(true)
  })

  test("变异臂:intake 退回旧写法(空输出即 exit 1)⇒ 同一个空清单让同步失败", () => {
    const fx = fixture("plain", { guard: emptyList })
    const legacy = stepBody(INTAKE).replace(
      /# #1662 F10[\s\S]*?MB="\$\(git merge-base/,
      'takeover="$(bash "$guard" --print-takeover)"\nif [ -z "$takeover" ]; then echo "::error::接管清单为空"; exit 1; fi\npaths=()\nwhile IFS= read -r p; do paths+=("$p"); done <<< "$takeover"\nMB="$(git merge-base',
    )
    expect(legacy, "变异没落上 —— 本次测量作废").not.toBe(stepBody(INTAKE))
    const run = runSteps(fx, FULL, { [INTAKE]: legacy })
    expect(run.failedAt).toBe(INTAKE)
  })

  test("守卫不报条数(没跑出结果)⇒ intake 以「没有给出接管清单条数」中止,不出推送包", () => {
    const fx = fixture("plain", {
      guard: (source) => source.replace(/^\s*printf 'UPSTREAM_EXCLUDES_COUNT\\t%s\\n'.*$/m, "  :"),
    })
    const run = runSteps(fx, FULL)
    expect(run.failedAt).toBe(INTAKE)
    expect(run.output).toContain("守卫没有给出接管清单条数")
    expect(bundleProduced(fx)).toBe(false)
  })
})

// ── `#1662`:合并后的树上权威登记册判官不绿 ⇒ 不出推送包 ─────────────────────────────────────
// 生产判官(packages/ext/src/policy/authority-registry.test.ts)要读真仓历史与锚点修订,在缩比夹具里跑不起来;
// 这里换成同一路径上的合成判官(两条用例),跑的是生产的那一步 body 与 scripts/bun-test-floor.sh 原样副本,
// 条数来自夹具里的 scripts/gate-files.tsv 登记行 —— 被测的是「这一步怎么消费判官的结局」,判官自身的
// 判据由它自己的文件证明(每条规则先在合成登记册上判红)。

const JUDGE_FILE = "packages/ext/src/policy/authority-registry.test.ts"
const judgeSource = (cases: string[]) => `import { test, expect } from "bun:test"\n${cases.join("\n")}\n`
const GREEN = ['test("held a", () => expect(1).toBe(1))', 'test("held b", () => expect(1).toBe(1))']
const RED = ['test("held a", () => expect(1).toBe(1))', 'test("blocked b", () => expect(["b: blocked"]).toEqual([]))']
const ONE_SHORT = ['test("held a", () => expect(1).toBe(1))', 'test.skip("held b", () => expect(1).toBe(1))']
const gateRow = (count: string) => `${count}\tpackages/ext\tsrc/policy/authority-registry.test.ts\t-\tfixture\n`

function judgeFixture(cases: string[], row: string = gateRow("2")): Fixture {
  return fixture("plain", {
    alphaFiles: {
      [JUDGE_FILE]: judgeSource(cases),
      "scripts/gate-files.tsv": row,
      "scripts/bun-test-floor.sh": readFileSync(resolve(REPO_ROOT, "scripts/bun-test-floor.sh"), "utf8"),
    },
  })
}
const WITH_JUDGE = [INTAKE, MERGE, POST, JUDGE, BUNDLE]

describe("#1662 合并后的树上有权威没握住 ⇒ 判官步或证明步中止,不出推送包", () => {
  test("判官全绿 ⇒ 照常出推送包;判官有一条红 ⇒ 在判官步中止、具名报错、不出推送包", () => {
    const ok = judgeFixture(GREEN)
    const passed = runSteps(ok, WITH_JUDGE)
    expect(passed.failedAt, `判官全绿不该让同步失败:\n${passed.output}`).toBeNull()
    expect(bundleProduced(ok)).toBe(true)

    const bad = judgeFixture(RED)
    const failed = runSteps(bad, WITH_JUDGE)
    expect(failed.failedAt, failed.output).toBe(JUDGE)
    expect(failed.output).toContain("::error title=authority not held::")
    expect(failed.output, "没把判官的逐条原因带进日志").toContain("b: blocked")
    expect(bundleProduced(bad), "判官红了却产出了推送包").toBe(false)
  })

  test("判官少跑一条(被 skip / 删掉)⇒ 同样中止;变异臂:退回裸 `bun test` ⇒ 同一夹具放行", () => {
    const fx = judgeFixture(ONE_SHORT)
    const run = runSteps(fx, WITH_JUDGE)
    expect(run.failedAt, run.output).toBe(JUDGE)
    expect(run.output).toContain("实际 1 条 < 登记 2 条")
    expect(bundleProduced(fx)).toBe(false)

    const bare = 'cd packages/ext && bun test src/policy/authority-registry.test.ts\n'
    const fx2 = judgeFixture(ONE_SHORT)
    const mutated = runSteps(fx2, WITH_JUDGE, { [JUDGE]: bare })
    expect(mutated.failedAt, `裸 bun test 应当放过少一条的判官 —— 否则这条变异臂证明不了条数核对有用:\n${mutated.output}`).toBeNull()
  })

  test("gate-files.tsv 里读不出判官的登记条数 ⇒ 测量作废,中止", () => {
    for (const row of ["", gateRow(">=2"), "2\tpackages/ext\tsrc/policy/other.test.ts\t-\tfixture\n"]) {
      const fx = judgeFixture(GREEN, row)
      const run = runSteps(fx, WITH_JUDGE)
      expect(run.failedAt, `登记行「${row.trim()}」:\n${run.output}`).toBe(JUDGE)
      expect(run.output).toContain("读不出")
      expect(bundleProduced(fx)).toBe(false)
    }
  })

  test("生产 workflow 里判官步排在合并之后、推送包之前,且没有让它被跳过或失败被吞的开关", () => {
    const steps = candidateSteps()
    const at = (name: string) => steps.findIndex((s: any) => typeof s?.name === "string" && s.name.startsWith(name))
    const judge = at(JUDGE)
    expect(judge, "sync-upstream.yml 里找不到判官步").toBeGreaterThanOrEqual(0)
    expect(judge, "判官步排在合并之前 —— 它判的不是合并后的树").toBeGreaterThan(at(MERGE))
    expect(judge, "判官步排在推送包之后 —— 红了推送包也已经出了").toBeLessThan(at(BUNDLE))
    expect(at(MERGE)).toBeGreaterThanOrEqual(0)
    expect(steps[judge].if, "判官步带了 if: —— 默认 success() 之外的条件会让它被跳过").toBeUndefined()
    expect(steps[judge]["continue-on-error"], "判官步带了 continue-on-error —— 红了也照样出推送包").toBeUndefined()
    expect(stepBody(JUDGE)).toContain("src/policy/authority-registry.test.ts")
    expect(existsSync(resolve(REPO_ROOT, JUDGE_FILE)), "判官步点名的生产判官文件不在仓里").toBe(true)
    // 证明步:判官之后、推送包之前,同样没有跳过/吞失败的开关,跑的是仓里那份脚本。
    const proofs = at(PROOFS)
    expect(proofs, "sync-upstream.yml 里找不到证明步").toBeGreaterThan(judge)
    expect(proofs, "证明步排在推送包之后 —— 红了推送包也已经出了").toBeLessThan(at(BUNDLE))
    expect(steps[proofs].if, "证明步带了 if:").toBeUndefined()
    expect(steps[proofs]["continue-on-error"], "证明步带了 continue-on-error").toBeUndefined()
    expect(stepBody(PROOFS)).toContain("scripts/assert-authority-proofs.sh")
  })
})

// ── `#1662` I-02:权威失去通过的证明 ⇒ 证明步中止 ─────────────────────────────────────────────
// 夹具里放合成登记册与合成证明文件,外加生产的 scripts/assert-authority-proofs.sh 与 bun-test-floor.sh 原样副本;
// 证明文件清单只来自登记册 JSON,条数只来自夹具的 gate-files.tsv —— 改登记册即改判决,证明清单没有第二份。

const PROOF_A = "packages/ext/src/policy/proof-a.test.ts"
const PROOF_B = "packages/core/test/proof-b.test.ts"
const PROOF_RETIRED = "packages/ext/src/policy/proof-retired.test.ts"
const passing = (name: string) => judgeSource([`test("${name}", () => expect(1).toBe(1))`])
const failing = (name: string) => judgeSource([`test("${name}", () => expect("proof broke").toBe("held"))`])

function proofFixture(opts: { b?: string | null; registerB?: boolean; extraEntries?: object[] } = {}): Fixture {
  const entries = [
    { id: "auth-a", decision: "a", tests: [{ file: PROOF_A, name: "holds a" }] },
    { id: "auth-b", decision: "b", tests: [{ file: PROOF_B, name: "holds b" }] },
    // 已由 owner 退役的项:它的证明不再握住同步 —— 夹具里故意放一个红的,跑了就会把绿那例判红。
    { id: "auth-retired", decision: "r", tests: [{ file: PROOF_RETIRED, name: "gone" }], retired: { quote: "不要了", date: "2026-11-09", by: "owner" } },
    ...(opts.extraEntries ?? []),
  ]
  const rows = [gateRow("2"), `1\tpackages/ext\tsrc/policy/proof-a.test.ts\t-\tfixture\n`]
  if (opts.registerB !== false) rows.push(`1\tpackages/core\ttest/proof-b.test.ts\t-\tfixture\n`)
  const files: Record<string, string> = {
    [JUDGE_FILE]: judgeSource(GREEN),
    "scripts/gate-files.tsv": rows.join(""),
    "scripts/bun-test-floor.sh": readFileSync(resolve(REPO_ROOT, "scripts/bun-test-floor.sh"), "utf8"),
    "scripts/assert-authority-proofs.sh": readFileSync(resolve(REPO_ROOT, "scripts/assert-authority-proofs.sh"), "utf8"),
    "docs/architecture/codepuppy-authority-registry.json": `${JSON.stringify({ anchor: { takeoverListRevision: "x" }, entries }, null, 2)}\n`,
    [PROOF_A]: passing("holds a"),
    [PROOF_RETIRED]: failing("gone"),
  }
  if (opts.b !== null) files[PROOF_B] = opts.b ?? passing("holds b")
  return fixture("plain", { alphaFiles: files })
}
const WITH_PROOFS = [INTAKE, MERGE, POST, JUDGE, PROOFS, BUNDLE]

describe("#1662 I-02 权威失去通过的证明 ⇒ 证明步中止,点名权威,不出推送包", () => {
  test("证明全绿 ⇒ 出推送包(退役项的证明不跑);一个证明红 ⇒ 在证明步中止、点名那项权威;变异臂:没有证明步 ⇒ 同一夹具出包", () => {
    const ok = proofFixture()
    const passed = runSteps(ok, WITH_PROOFS)
    expect(passed.failedAt, `证明全绿不该让同步失败:\n${passed.output}`).toBeNull()
    expect(passed.output, "退役项的证明被执行了").not.toContain("proof-retired")
    expect(bundleProduced(ok)).toBe(true)

    const bad = proofFixture({ b: failing("holds b") })
    const failed = runSteps(bad, WITH_PROOFS)
    expect(failed.failedAt, failed.output).toBe(PROOFS)
    expect(failed.output).toContain(`::error title=authority proof failed::auth-b —— 证明测试没通过(或没跑满 1 条):${PROOF_B}`)
    expect(failed.output, "绿的那项被误点名").not.toContain("authority proof failed::auth-a")
    expect(bundleProduced(bad), "证明红了却产出了推送包").toBe(false)

    // 已知的坏:判官只核对在位 —— 去掉证明步,同一个红证明一路放行到推送包。
    const judgeOnly = proofFixture({ b: failing("holds b") })
    const through = runSteps(judgeOnly, [INTAKE, MERGE, POST, JUDGE, BUNDLE])
    expect(through.failedAt, through.output).toBeNull()
    expect(bundleProduced(judgeOnly)).toBe(true)
  })

  test("证明文件不存在 ⇒ 中止并点名;登记册新增一项指向它 ⇒ 判决跟着变(清单来自登记册)", () => {
    const missing = proofFixture({ b: null })
    const run = runSteps(missing, WITH_PROOFS)
    expect(run.failedAt, run.output).toBe(PROOFS)
    expect(run.output).toContain(`::error title=authority proof missing::auth-b —— 证明文件不存在:${PROOF_B}`)
    expect(bundleProduced(missing)).toBe(false)

    const added = proofFixture({ extraEntries: [{ id: "auth-new", decision: "n", tests: [{ file: "packages/ext/src/policy/proof-new.test.ts", name: "n" }] }] })
    const run2 = runSteps(added, WITH_PROOFS)
    expect(run2.failedAt, run2.output).toBe(PROOFS)
    expect(run2.output).toContain("authority proof missing::auth-new")
  })

  test("证明文件没在 gate-files.tsv 登记、或少跑了一条 ⇒ 中止并点名(条数无从核对 / 被 skip 掉)", () => {
    const unregistered = proofFixture({ registerB: false })
    const run = runSteps(unregistered, WITH_PROOFS)
    expect(run.failedAt, run.output).toBe(PROOFS)
    expect(run.output).toContain("::error title=authority proof unregistered::auth-b")

    const skipped = proofFixture({ b: judgeSource(['test.skip("holds b", () => expect(1).toBe(1))']) })
    const run2 = runSteps(skipped, WITH_PROOFS)
    expect(run2.failedAt, run2.output).toBe(PROOFS)
    expect(run2.output).toContain("实际 0 条 < 登记 1 条")
    expect(run2.output).toContain("authority proof failed::auth-b")
  })
})
