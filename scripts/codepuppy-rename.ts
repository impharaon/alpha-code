#!/usr/bin/env bun
// `#1570` —— 旧品牌机械改名:照映射表改第一方文件的内容与路径,可在基线上重放。
//
//   bun scripts/codepuppy-rename.ts           # 代码面(提交③的全部内容)
//   bun scripts/codepuppy-rename.ts --docs    # 现行文档面(提交⑥的起点,其后人工复核)
//
// 依据:alpha-work 已批方案 `docs/design/req236-codepuppy-naming-migration.md` §2.3 / §2.4-A 与命名规范 §3。
// 只改工作树,不 `git add`、不提交;重放 = 在基线的干净副本上跑同一条命令,再与提交③的树逐字节比对。
//
// ── 映射表怎么用(scripts/codepuppy-rename-map.tsv,`旧 ⇥ 新`)───────────────────────────
// 「只按映射表精确替换」(票面 AC2):这里没有任何「看起来像旧名就改」的正则。文本先切成词元,
// 词元**整个**等于表里某一行的旧值才换成新值;表里没有的词元一律原样保留。三种行,按旧值的形状区分:
//   · 词:只含 `[A-Za-z0-9_-]` —— 与文本里切出的词元(`[A-Za-z0-9_-]+` 的最长串,去掉首尾 `-`)整个相等才换。
//     所以 `alpha-code-state` 与 `alpha-code` 是两行、互不牵连;`origin/alpha` 里的 `alpha` 不在表里就不动。
//   · 点分键:形如 `alpha.<段>` —— 与 `alpha.<段>` 形状的最长串(前面不接 `[A-Za-z0-9_.-]`)整个相等才换,
//     i18n 键 `alpha.timeline.x` 由 `alpha.timeline` 一行覆盖。
//   · 字面量:含上面两类以外的字符(如 `@alpha-code/`)—— 逐字子串替换,只用于词元切不出语境的少数几处。
// 顺序:字面量 → 点分键 → 词。路径的每一段按同一套规则改。
//
// ── 范围(哪些文件改内容、哪些文件改路径)──────────────────────────────────────────
// 第一方路径(票面 AC1):alpha 自有包、住在上游包里的自有文件(basename `alpha-*` / `codepuppy-*` 或带 marker)、
// 被接管的上游文件(north-star 守卫 `--print-takeover`,只会碰到引用第一方名字的词元)、ADR-034 的
// 前端两包(之后经补丁重生)、`scripts/`、`.github/` 与仓根的构建配置。
// 不碰:别的仓产物的逐字节副本(`vendor/`、extension-seed、签名目录快照的**内容**、alpha-web 镜像的
// testvectors)、旧名扫描门自己的文件(自检样本必须写旧名)、本脚本与映射表、历史存档。

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..")
const MAP = "scripts/codepuppy-rename-map.tsv"
const docsMode = process.argv.includes("--docs")

const SELF = new Set([
  "scripts/codepuppy-rename.ts",
  MAP,
  "scripts/old-name-exceptions.tsv",
  "packages/ui-mac/src/main/old-name-scan.test.ts",
])
/** 字节副本:内容不改;路径只随所在包目录改名(目录内的段原样保留,它们由锁文件钉住)。 */
const NEVER = [
  /^packages\/[^/]+\/vendor\//,
  /^packages\/ui-mac\/resources\/extension-seed\//,
  /\/testvectors\//,
]
/**
 * 路径照改、内容不改:
 *   · 签名目录快照与其 meta(字节 = 已发布产物);
 *   · 随包 Office 服务器 —— 签名目录里四个 Office 连接器的 artifactDigest 就是它的内容地址
 *     (ext-mcp-policy.ts bundledOfficeServerDigest),换一个字节,已发布目录里的条目就装不上;
 *   · 宿主扩展包合同的发布物(generate-artifact.ts 的 HOST_EXTENSION_PACKAGE_ARTIFACT_FILES 与其清单)——
 *     逐文件 sha256 钉在清单里,alpha-web 的生产方语料照它编译;它定义的名字改不改由两仓一起定。
 */
const HOST_CONTRACT = "packages/ui-mac/src/shared/host-extension-package-contract/"
const KEEP_BYTES = new Set([
  "packages/ui-mac/src/renderer/extensions/alpha-catalog.json",
  "packages/ui-mac/src/renderer/extensions/alpha-catalog.snapshot.json",
  "packages/ui-mac/resources/office-mcp/server.py",
  ...[
    "CONTRACT.md",
    "alpha-package-envelope-v1.schema.json",
    "decoder.ts",
    "generate-artifact.ts",
    "host-extension-package.registry.v1.json",
    "host-extension-package-artifact.v1.json",
    "profiles/agent.v1.schema.json",
    "profiles/cloud.v1.schema.json",
    "profiles/command.v1.schema.json",
    "profiles/mcp-local.v1.schema.json",
    "profiles/mcp-remote.v1.schema.json",
    "profiles/skill.v1.schema.json",
    "registry.ts",
    "synthetic-decoder.ts",
  ].map((file) => HOST_CONTRACT + file),
])
const OWNED_PACKAGES = ["ext", "ui-mac", "alpha-contracts-consumer"]
const ROOT_FILES = new Set([".gitattributes", ".gitignore", ".githooks/pre-push", "bun.lock", "package.json"])
const DOCS = [
  /^docs\/README\.md$/,
  /^docs\/(architecture|contracts|runbooks)\//,
  /^docs\/design\/(README|PAGE-MAP)\.md$/,
  /^docs\/design\/(current|system)\//,
  /^ALPHA\.md$/,
  /^CLAUDE\.md$/,
  /^frontend\/README\.md$/,
]

function sh(args: string[]): string {
  const result = Bun.spawnSync(args, { cwd: ROOT })
  if (result.exitCode !== 0) throw new Error(`${args.join(" ")} failed: ${result.stderr.toString()}`)
  return result.stdout.toString()
}

const takeover = sh(["bash", "scripts/north-star-guard.sh", "--print-takeover"]).split("\n").filter(Boolean)

function inScope(path: string): boolean {
  if (SELF.has(path)) return false
  if (docsMode) return DOCS.some((re) => re.test(path))
  if (path.startsWith("scripts/") || path.startsWith(".github/") || path.startsWith("bin/")) return true
  if (ROOT_FILES.has(path)) return true
  if (path.startsWith("frontend/") && !path.endsWith(".md")) return true
  const pkg = /^packages\/([^/]+)\//.exec(path)?.[1]
  if (!pkg) return false
  if (OWNED_PACKAGES.includes(pkg) || pkg === "app" || pkg === "ui") return true
  if (takeover.some((t) => path === t || path.startsWith(`${t}/`))) return true
  const base = path.slice(path.lastIndexOf("/") + 1)
  if (base.startsWith("alpha-") || base.startsWith("codepuppy-")) return true
  const text = readText(path)
  return text !== undefined && (text.includes("north-star:alpha-owned") || text.includes("north-star:codepuppy-owned"))
}

function readText(path: string): string | undefined {
  const body = readFileSync(join(ROOT, path))
  return body.includes(0) ? undefined : body.toString("utf8")
}

// ── 映射表 ────────────────────────────────────────────────────────────────────────
const words = new Map<string, string>()
const dotted = new Map<string, string>()
const literals: [string, string][] = []
for (const [i, raw] of readFileSync(join(ROOT, MAP), "utf8").split("\n").entries()) {
  if (!raw || raw.startsWith("#")) continue
  const parts = raw.split("\t")
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0] === parts[1]) throw new Error(`${MAP}:${i + 1} 不是「旧 ⇥ 新」两列:${raw}`)
  const [from, to] = parts as [string, string]
  const table = /^[A-Za-z0-9_-]+$/.test(from) ? words : /^alpha\.[A-Za-z][A-Za-z0-9_-]*$/.test(from) ? dotted : undefined
  if (table) {
    if (table.has(from)) throw new Error(`${MAP}:${i + 1} 重复的旧值:${from}`)
    table.set(from, to)
    continue
  }
  if (literals.some(([seen]) => seen === from)) throw new Error(`${MAP}:${i + 1} 重复的旧值:${from}`)
  literals.push([from, to])
}
literals.sort((a, b) => b[0].length - a[0].length)

const DOTTED = /(?<![A-Za-z0-9_.-])alpha\.[A-Za-z][A-Za-z0-9_-]*/g
const WORD = /[A-Za-z0-9_-]+/g

function rename(text: string): string {
  const afterLiterals = literals.reduce((acc, [from, to]) => acc.replaceAll(from, to), text)
  const afterDotted = afterLiterals.replace(DOTTED, (m) => dotted.get(m) ?? m)
  return afterDotted.replace(WORD, (m) => {
    const core = m.replace(/^-+/, "").replace(/-+$/, "")
    const to = words.get(core)
    if (!to) return m
    const lead = m.slice(0, m.length - m.replace(/^-+/, "").length)
    return lead + to + m.slice(lead.length + core.length)
  })
}

// ── 执行:先改内容(原路径),再改路径 ───────────────────────────────────────────────
// 只取普通文件(100644 / 100755):gitlink 与符号链接不是「第一方文本」,也不随本脚本搬家
const files = sh(["git", "ls-files", "-s"])
  .split("\n")
  .filter((line) => /^100(644|755) /.test(line))
  .map((line) => line.slice(line.indexOf("\t") + 1))
  .filter(inScope)
let contentChanged = 0
for (const path of files) {
  if (KEEP_BYTES.has(path) || NEVER.some((re) => re.test(path))) continue
  const text = readText(path)
  if (text === undefined) continue
  const next = rename(text)
  if (next === text) continue
  writeFileSync(join(ROOT, path), next)
  contentChanged++
}

let moved = 0
const vacated = new Set<string>()
for (const path of files) {
  const segments = path.split("/")
  const next = NEVER.some((re) => re.test(path))
    ? [...segments.slice(0, 2).map(rename), ...segments.slice(2)].join("/")
    : segments.map(rename).join("/")
  if (next === path) continue
  if (existsSync(join(ROOT, next))) throw new Error(`改名目标已存在,拒绝覆盖:${path} → ${next}`)
  mkdirSync(dirname(join(ROOT, next)), { recursive: true })
  renameSync(join(ROOT, path), join(ROOT, next))
  vacated.add(dirname(path))
  moved++
}
// 清掉搬空的目录(由深到浅)
for (const dir of [...vacated].sort((a, b) => b.length - a.length)) {
  for (let d = dir; d && d !== "."; d = dirname(d)) {
    const abs = join(ROOT, d)
    if (!existsSync(abs) || readdirSync(abs).length > 0) break
    rmdirSync(abs)
  }
}

console.log(`codepuppy-rename${docsMode ? " --docs" : ""}: ${files.length} files in scope, ${contentChanged} rewritten, ${moved} moved`)
