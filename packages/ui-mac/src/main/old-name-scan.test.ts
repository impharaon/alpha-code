// `#1570` —— 旧名扫描门:第一方路径上的旧品牌命中与例外登记表**互为子集**。
//
// 取代 `#1206` 的 `.alpha` 路径残留门(那道门只管 `.alpha` 一种写法、只扫 `packages/**/src/**`)。
// 判据来自已批方案 alpha-work `docs/design/req236-codepuppy-naming-migration.md` §1.3 / §1.7 与
// 命名规范 `governance/codepuppy-naming-standard.md` §5 / §6:
//   · 扫描面 = 第一方路径:north-star 守卫认定的 alpha 自有包、守卫谓词认定的「住在上游包里的
//     自有文件」、`scripts/`、`.github/`、现行文档;排除测试代码文件(`*.test.ts` 等);
//   · 命中 ⊆ 登记表(新写进来的旧名当场红),登记表 ⊆ 命中(旧名清掉而登记没删,同样红);
//   · 例外类别只取规范 §5 的固定枚举;
//   · 扫描器先跑正反样本自检,自检不过 ⇒ 本次测量作废(两个方向一起判红,不给出「通过」)。
//
// ── 为什么判据里一个 `\b` 都没有(方案 §1.7)─────────────────────────────────────────
// 本机 `git grep -E '\balpha[-_][a-z]'` 对 packages/opencode/src 返回 0 行,而显式边界类
// `(^|[^A-Za-z0-9])alpha[-_][a-z]` 返回 58 行 —— 「`\b` 后接方括号」在那套 ERE 里静默失效。
// JS 的 `\b` 本身没坏,但判据要与方案里那条 shell 命令同形、可互相复核,所以一律写显式边界类,
// 并在自检里放只有 `\b` 写法才会漏的正样本(`x alpha_cloud_access`)。
//
// ── 范围排除(全部写在这里,不散落在登记表里)──────────────────────────────────────
//   · 测试代码文件:`*.test.ts(x)` / `*.cases.ts(x)` / `*.spec.ts(x)` / `*.live-cases.ts` —— 它们
//     常常**必须**写旧名(断言旧 ID 被拒、迁移源样本)。测试夹具(fixtures、testvectors 以外的 JSON)
//     仍在扫描面里,命中按 user-content 等类别登记。
//   · 别的仓产物的逐字节副本:`vendor/`(带锁校验)、`resources/extension-seed/`(seed 锁)、
//     随包签名目录快照 `codepuppy-catalog.json` 及其 meta、各处 `testvectors/`(契约测试向量,由生产方生成,
//     例如 `src/main/testvectors/` 是 alpha-web 只读镜像,见该目录 SOURCE.md)。改它们的字节 = 破坏锁或签名;旧名由各自的生产方改。
//   · 改名工具自己的输入:映射表、本登记表、改名脚本(按定义写满旧名)。
//   · 历史存档不在「现行文档」里:`docs/verification`、`docs/audits`、`docs/evidence`、
//     `docs/archive`、`docs/retrospectives`、`docs/design/` 下带日期的历史稿、ADR、CHANGELOG。
//
// ── 文件名这一层(#1570 审计 F1)────────────────────────────────────────────────────
// 第一方路径的 basename 也用同一个判据判一次,命中记为第 0 行。这一层**不排除**测试文件与字节副本:
// 它们的内容可以合法地写旧名或由别人生产,名字却是我们放进仓里的。
//
// 登记表:scripts/old-name-exceptions.tsv(`文件 ⇥ 行号 ⇥ 类别 ⇥ 理由`;文件名命中写行号 0)。行号随上方增删行漂移时,
// 先确认那一处今天仍然该留着,再改行号 —— 不要只把数字改对。

import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, test } from "bun:test"
import { isCodePuppyOwned } from "./wall-clock-assertions"

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..")
const REGISTRY = "scripts/old-name-exceptions.tsv"

/**
 * 旧名判据。前九支逐字取自方案 §1.3 的 P(`sk-alpha-` 与 `code-puppy` 两支随 owner 裁决 D4 / F5 加入);
 * 第十支 `.alpha` 承接被取代的 `#1206` 门 —— 不收它,`~/.alpha` / `<proj>/.alpha` 这类退役根写法就从此无人拦;
 * 它要求 `.alpha` 前面不是标识符字符,否则 CSS 里表示透明度的 `.chip.alpha` 这类类名也会被判成旧名。
 * 独立 `Alpha` 分支拦住用户与模型可见的退役品牌词(#1635),包括英文所有格。
 */
const OLD_NAME = new RegExp(
  [
    "cloud_cloud_",
    "(^|[^A-Za-z0-9])alpha[-_][a-z]",
    "(^|[^A-Za-z0-9_])ALPHA_[A-Z0-9]",
    "(^|[^A-Za-z0-9])alphacode([^A-Za-z0-9]|$)",
    "@alpha-code/",
    "vnd\\.alpha\\.",
    '"alpha\\.[a-z]',
    "sk-alpha-",
    "code-puppy",
    "(^|[^A-Za-z0-9_])\\.alpha([^-A-Za-z0-9_]|$)",
    "(^|[^A-Za-z0-9])Alpha([^A-Za-z0-9]|$)",
  ].join("|"),
)

/** 规范 §5 的固定枚举,外加编排器裁决的 `pending`(在途票接手改名的旧名;理由里必须写接手票号)。 */
const CATEGORIES = new Set([
  "historical",
  "third-party",
  "user-content",
  "upstream",
  "migration-source",
  "retired-guard",
  "external-anchor",
  "pending",
])

/** 正样本:每一支至少一个;`x alpha_cloud_access` 是只有 `\b` 写法才会漏的那一个(方案 §1.7)。 */
const KNOWN_OLD = [
  "with Alpha's", // office-docs/SKILL.md 的真实品牌所有格(AC1)。
  "x alpha_cloud_access",
  'const key = "sk-alpha-0123456789"',
  "codepuppy://auth vs code-puppy://auth/callback",
  "tool cloud_cloud_dispatch",
  'join(userData, "alpha-auth.json")',
  "process.env.ALPHA_GLOBAL_DIR",
  "${ALPHA_API_KEY}",
  "com.tide.alphacode",
  'import { x } from "@alpha-code/ext"',
  "application/vnd.alpha.remote-asset",
  't("alpha.timeline.cloud.dispatch")',
  'join(home, ".alpha")',
  "// 写 <proj>/.alpha/runs/<runId>/",
]

/** 反样本:普通英文词、颜色透明度、语义化版本、新名字本身、分支名 —— 一条都不许命中。 */
const ORDINARY = [
  "withAlpha(",
  "AlphaBlend",
  "alphanumeric",
  "alphabetical order",
  "color.withAlpha(0.5)",
  "1.0.0-alpha.3",
  "if (ch.isalpha()) return",
  "const alpha = 0.5",
  "git fetch origin alpha && git diff origin/alpha...HEAD",
  'join(userData, "codepuppy-auth.json")',
  "process.env.CODEPUPPY_GLOBAL_DIR",
  't("codepuppy.timeline.cloud.dispatch")',
  "codepuppy_access",
  ".swatch .chip.alpha { opacity: 0.4 }",
]

function selfTestFailures(): string[] {
  return [
    ...KNOWN_OLD.filter((s) => !OLD_NAME.test(s)).map((s) => `应命中却没命中:${s}`),
    ...ORDINARY.filter((s) => OLD_NAME.test(s)).map((s) => `不该命中却命中了:${s}`),
  ]
}

const SELF_TEST = selfTestFailures()

/** 枚举交给 git,不手写 walker;枚举失败不得静默放行。 */
function gitLines(args: string[]): string[] {
  const result = Bun.spawnSync(args, { cwd: REPO_ROOT })
  if (result.exitCode !== 0)
    throw new Error(`${args.join(" ")} 失败(exit ${result.exitCode}):${result.stderr.toString()} —— 闸门不得在枚举失败时静默放行`)
  return result.stdout.toString().split("\n").filter(Boolean)
}

/** 自有包清单消费 north-star 守卫的 `--print-jurisdiction`,不在这里另抄一份。 */
const OWNED_PACKAGES = (() => {
  const row = gitLines(["bash", "scripts/north-star-guard.sh", "--print-jurisdiction"]).find((line) =>
    line.startsWith("CODEPUPPY_OWNED_PACKAGES\t"),
  )
  if (!row) throw new Error("north-star-guard.sh --print-jurisdiction 没有给出 CODEPUPPY_OWNED_PACKAGES —— 扫描面无从确定")
  return row.split("\t")[1]!.split(" ").filter(Boolean)
})()

const IS_TEST_CODE = /\.(test|cases|spec|live-cases)\.(ts|tsx)$/
const BYTE_COPIES = [
  /^packages\/[^/]+\/vendor\//,
  /^packages\/ui-mac\/resources\/extension-seed\//,
  /^packages\/ui-mac\/src\/renderer\/extensions\/codepuppy-catalog(\.snapshot)?\.json$/,
  /\/testvectors\//,
]
const CURRENT_DOCS = [
  /^docs\/README\.md$/,
  /^docs\/(architecture|contracts|runbooks)\//,
  /^docs\/design\/(README|PAGE-MAP)\.md$/,
  /^docs\/design\/(current|system)\//,
  /^ALPHA\.md$/,
  /^CLAUDE\.md$/,
]

const ALL_LISTED = [...new Set(gitLines(["git", "ls-files", "--cached", "--others", "--exclude-standard"]))]

function readText(path: string): string | undefined {
  try {
    const body = readFileSync(join(REPO_ROOT, path))
    return body.includes(0) ? undefined : body.toString("utf8")
  } catch {
    return undefined // 目录项 / 竞态删除:枚举可信度由上面的 exitCode 与下面的规模断言罩着
  }
}

/** 改名工具自己的输入:映射表与登记表按定义满纸旧名,改名脚本的说明也一样 —— 逐行登记它们不增加任何信息。 */
const RENAME_TOOLING = new Set(["scripts/codepuppy-rename-map.tsv", "scripts/codepuppy-rename.ts", REGISTRY])

function inScope(path: string): boolean {
  if (IS_TEST_CODE.test(path) || RENAME_TOOLING.has(path)) return false
  if (BYTE_COPIES.some((re) => re.test(path))) return false
  return isFirstParty(path)
}

/**
 * 第一方路径(不看是不是测试文件、是不是字节副本)。内容扫描在它上面再排除测试代码与字节副本;
 * 文件名扫描不排除 —— 一个叫 `alpha-x.test.ts` 的文件内容可以合法地写旧名,名字本身却仍是旧名,
 * 删旧前缀之后守卫会把它当成上游文件(#1570 审计 F1:两个 opencode 测试文件就这样漏过了改名)。
 */
function isFirstParty(path: string): boolean {
  if (RENAME_TOOLING.has(path)) return false
  if (path.startsWith("scripts/") || path.startsWith(".github/")) return true
  if (CURRENT_DOCS.some((re) => re.test(path))) return true
  const pkg = /^packages\/([^/]+)\//.exec(path)?.[1]
  if (!pkg) return false
  if (OWNED_PACKAGES.includes(pkg)) return true
  // ADR-034 roundtrip 包(app / ui)由补丁回环门管,不是第一方文件
  if (pkg === "app" || pkg === "ui") return false
  // 住在上游包里的自有文件:north-star 谓词的「自报家门」因子(前缀或 marker),消费 wall-clock-assertions.ts
  // 已有的那一份 —— 不在这里再写一份。因子①(origin/dev 里查不到)刻意不查:对扫描而言多扫只会过报。
  return isCodePuppyOwned(path, readText(path) ?? "")
}

const SCANNED = ALL_LISTED.filter(inScope)
const NAME_SCANNED = ALL_LISTED.filter(isFirstParty)

type Hit = { path: string; line: number; text: string }

function scan(): Hit[] {
  const contentHits = SCANNED.flatMap((path) => {
    const text = readText(path)
    if (text === undefined) return []
    return text.split("\n").flatMap((line, i) => (OLD_NAME.test(line) ? [{ path, line: i + 1, text: line }] : []))
  })
  return [...contentHits, ...nameHits(NAME_SCANNED)]
}

/** 文件名这一层:basename 用同一个判据判一次,命中记为第 0 行(登记表里写 `路径 ⇥ 0`)。 */
function nameHits(paths: string[]): Hit[] {
  return paths.flatMap((path) => {
    const base = path.slice(path.lastIndexOf("/") + 1)
    return OLD_NAME.test(base) ? [{ path, line: 0, text: base }] : []
  })
}

// 自检不过就不测量:一个退化成恒不命中的判据会让两个方向一起「通过」。
const HITS = SELF_TEST.length === 0 ? scan() : []
const HIT_KEYS = new Set(HITS.map((h) => `${h.path}:${h.line}`))

type Row = { path: string; line: number; category: string; reason: string; n: number }

function registry(): Row[] {
  return readFileSync(join(REPO_ROOT, REGISTRY), "utf8")
    .split("\n")
    .flatMap((raw, i) => {
      if (!raw || raw.startsWith("#")) return []
      const parts = raw.split("\t")
      if (parts.length !== 4) throw new Error(`${REGISTRY}:${i + 1} 不是四列(文件⇥行号⇥类别⇥理由):${raw}`)
      if (!/^[0-9]+$/.test(parts[1]!)) throw new Error(`${REGISTRY}:${i + 1} 行号不是数字:${raw}`)
      return [{ path: parts[0]!, line: Number(parts[1]), category: parts[2]!, reason: parts[3]!, n: i + 1 }]
    })
}

const ROWS = registry()
const ROW_KEYS = new Set(ROWS.map((r) => `${r.path}:${r.line}`))

describe("旧名扫描门 (#1570)", () => {
  test("自检:已知旧名全部命中、普通词零命中(不过 ⇒ 本次测量作废)", () => {
    expect(SELF_TEST, "旧名判据退化了 —— 下面两个方向的结论一律作废").toEqual([])
  })

  test("扫描面来自 git 与 north-star 守卫,且规模合理(近乎空集不得静默放行)", () => {
    expect(ALL_LISTED.length).toBeGreaterThan(5_000)
    // 2026-11-02 实测 1046 个(ui-mac 约 780 + 现行文档 + scripts / .github + 住在上游包里的自有文件)
    expect(SCANNED.length).toBeGreaterThan(900)
    expect(SCANNED.some((path) => IS_TEST_CODE.test(path))).toBe(false)
    expect(OWNED_PACKAGES).toContain("codepuppy-contracts-consumer")
    for (const prefix of [
      "packages/ext/src/",
      "packages/ui-mac/src/main/",
      "packages/codepuppy-contracts-consumer/src/",
      "packages/ext/src/policy/",
      "packages/schema/src/",
      "scripts/",
      ".github/workflows/",
      "docs/runbooks/",
    ])
      expect(SCANNED.filter((path) => path.startsWith(prefix)).length, `${prefix} 一个文件都没扫到`).toBeGreaterThan(0)
    // 字节副本与历史存档确实不在面里
    expect(SCANNED.some((path) => path.includes("/vendor/"))).toBe(false)
    expect(SCANNED.some((path) => path.startsWith("docs/verification/"))).toBe(false)
  })

  test("扫描真的读到了内容(登记在册的锚点确实命中)", () => {
    expect(SELF_TEST).toEqual([])
    expect(HITS.length).toBeGreaterThan(0)
    // 两个独立来源各取一个锚:迁移源常量(代码),仓库名(CI 配置)
    expect(HITS.some((h) => h.path === "packages/ui-mac/src/main/engine-config-truth.ts" && h.text.includes('"alpha-keychain"'))).toBe(true)
    expect(HITS.some((h) => h.path.startsWith(".github/workflows/") && h.text.includes("alpha-code"))).toBe(true)
  })

  test("文件名层:内容干净的 alpha-x.ts 照样被点名,且不在登记表里 ⇒ 方向 A 会红", () => {
    const clean = "packages/ext/src/alpha-x.ts"
    expect(isFirstParty(clean)).toBe(true)
    expect(nameHits([clean])).toEqual([{ path: clean, line: 0, text: "alpha-x.ts" }])
    expect(ROW_KEYS.has(`${clean}:0`)).toBe(false)
    // 控制组:新名字不命中;扫描面真的包含测试文件的名字(F1 漏网的正是两个测试文件)
    expect(nameHits(["packages/ext/src/codepuppy-x.ts"])).toEqual([])
    expect(NAME_SCANNED.some((path) => IS_TEST_CODE.test(path))).toBe(true)
    expect(HITS.some((h) => h.line === 0)).toBe(true)
  })

  test("登记表合形:类别取自固定枚举、理由非空、pending 写明接手票、无重复行", () => {
    expect(ROWS.length).toBeGreaterThan(0)
    for (const row of ROWS) {
      expect(CATEGORIES.has(row.category), `${REGISTRY}:${row.n} 类别 "${row.category}" 不在固定枚举里`).toBe(true)
      expect(row.reason.trim().length, `${REGISTRY}:${row.n} 理由为空或过短`).toBeGreaterThan(5)
      if (row.category === "pending") {
        expect(/#[0-9]+/.test(row.reason), `${REGISTRY}:${row.n} pending 必须写接手票号`).toBe(true)
        // pending 指向的必须是**别的**在途票:本票(#1570)自己没改完的旧名不是「有人接手」,是没做完。
        expect(/(^|[^A-Za-z0-9-])#1570(?![0-9])/.test(row.reason), `${REGISTRY}:${row.n} pending 不许指向本票 #1570`).toBe(false)
      }
    }
    expect(ROW_KEYS.size, "登记表里有重复的 文件:行号").toBe(ROWS.length)
  })

  test("方向 A —— 每一处扫描命中都登记在册(新写进来的旧名会被拦住)", () => {
    expect(SELF_TEST, "自检未过,本次测量作废").toEqual([])
    const unregistered = HITS.filter((h) => !ROW_KEYS.has(`${h.path}:${h.line}`)).map(
      // 行文只取前 120 个字符:bun 会把超长字符串从中间截断,连坐标一起截掉。
      (h) => `${h.path}:${h.line}: ${h.text.trim().slice(0, 120)}`,
    )
    expect(
      unregistered,
      [
        `这些位置写着旧名,但不在 ${REGISTRY} 里。`,
        "先问:它是 Code Puppy 自己的名字吗?是 ⇒ 按命名规范 §3 改成 codepuppy 形式。",
        "不是 ⇒ 登记进表,类别取自规范 §5(historical / third-party / user-content / upstream /",
        "migration-source / retired-guard / external-anchor)或 pending(写接手票号),并写清为什么它必须保留。",
      ].join("\n"),
    ).toEqual([])
  })

  test("方向 B —— 每一条登记都对应一处真实命中(表项失效后不会变成僵尸)", () => {
    expect(SELF_TEST, "自检未过,本次测量作废").toEqual([])
    const stale = ROWS.filter((r) => !HIT_KEYS.has(`${r.path}:${r.line}`)).map(
      (r) => `${REGISTRY}:${r.n} → ${r.path}:${r.line} [${r.category}]`,
    )
    expect(
      stale,
      [
        "这些登记项在源码里扫不到对应的旧名。",
        "常见成因:那一处已被改名(⇒ 删掉这一行),或该文件上方增删了行导致行号漂移",
        "(⇒ 先确认那一处今天仍然该留着,再改行号 —— 不要只把数字改对)。",
      ].join("\n"),
    ).toEqual([])
  })
})
