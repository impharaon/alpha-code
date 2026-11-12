// alpha-code#1569 —— 升级迁移的接线与边界(方案 §9 的 R17、AC8 静态、R8 防漏、§12 映射核对)。
// 这些判据的主语都在本模块之外:index.ts 的启动顺序、迁移模块的 import 闭包与写盘点、导出器与例外登记表。
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import ts from "typescript"
import { VISION_MARKER } from "../../../ext/src/cloud-vision-hooks"
import { TOOL_TEXT } from "../../../ext/src/context-injection"
import { ToolAuthority } from "../../../schema/src/tool-identity"
import { exportCodepuppyNames, exportCodepuppyPersistedValues } from "../../scripts/export-codepuppy-names"
import { PROJECT_HIDDEN_DIR } from "../shared/project-hidden-dir"
import { CODEPUPPY_AGENT_TEXT } from "./codepuppy-agents"
import { defaultCodePuppyBaseRoot } from "./codepuppy-environment"
import { FACTORY_SKILL_IDS } from "./factory-skills"
import { CLOUD_MCP_TOOLS } from "./fixtures/cloud-mcp-tools"
import {
  AGENT_NAMES,
  AUTHORITY_KINDS,
  BUNDLED_PLUGIN_TOOL_NAMES,
  CLOUD_REMOTE_NAMES,
  CLOUD_SERVER_KEY,
  ENV_CONFIG,
  FACTORY_SKILL_NAMES,
  LEGACY_BASE_DIR,
  LEGACY_ENV_CONFIG,
  LEGACY_PROJECT_HIDDEN_DIR,
  LEGACY_USER_DATA,
  OFFICE_SERVER_KEYS,
  PLUGIN_TOOL_NAMES,
  PROVIDER_ID,
  SETTINGS_KEYS,
  VISION_MARKER_KEY,
} from "./naming-migration-map"
import { relativeImportClosure, scanWriteSites } from "./process-fence-write-sites"
import { CLOUD_SCHEDULE_LAST_PULL_KEY, CUSTOM_AGENTS_SEEDED_KEY, NEW_LAYOUT_SEEDED_KEY } from "./store-keys"
import { USER_DATA_LAYOUT } from "./user-data-layout"

const MAIN = import.meta.dir
const REPO = resolve(MAIN, "..", "..", "..", "..")

// ── R17:index.ts 两段接线的位置 ─────────────────────────────────────────────────────────

/** main 生成器体内,按源码顺序给出每个调用 / 首个 yield* 的位置;违例逐条点名。 */
function bootOrderViolations(source: string): string[] {
  const sf = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let body: ts.Node | undefined
  const findMain = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(sf) === "main" && node.initializer) body = node.initializer
    if (!body) ts.forEachChild(node, findMain)
  }
  findMain(sf)
  if (!body) return ["index.ts: const main = Effect.gen(...) not found"]
  const calls: Array<{ text: string; pos: number }> = []
  let firstYield = Number.POSITIVE_INFINITY
  const walk = (node: ts.Node) => {
    if (ts.isYieldExpression(node) && node.asteriskToken) firstYield = Math.min(firstYield, node.getStart(sf))
    if (ts.isCallExpression(node)) calls.push({ text: node.expression.getText(sf), pos: node.getStart(sf) })
    ts.forEachChild(node, walk)
  }
  walk(body)
  const at = (name: string) => calls.find((call) => call.text === name)?.pos ?? -1
  const out: string[] = []
  // #1571 把完成标记挪到 ready 后的解密自检之后(settleNamingMigration;顺序闸在 keychain-boot-order.test.ts),
  // 迁移在 ready 前的最后一步是钥匙串改名 —— 「迁移完成之前不碰端点 / store / 凭据」以它为界。
  const order = [
    "app.requestSingleInstanceLock",
    "runNamingMigrationBoot",
    "preferAppEnv",
    "runNamingMigrationDbStep",
    "runKeychainRenameStep",
    "initCodePuppyEnvironment",
  ]
  for (const name of order) if (at(name) < 0) out.push(`${name} is not called inside main`)
  for (let i = 1; i < order.length; i++)
    if (at(order[i - 1]!) >= at(order[i]!)) out.push(`${order[i - 1]} must come before ${order[i]}`)
  if (at("runNamingMigrationDbStep") >= firstYield) out.push("runNamingMigrationDbStep must run before the first async boundary (yield*)")
  const boot = at("runNamingMigrationBoot")
  for (const call of calls.filter((c) => c.pos < at("runKeychainRenameStep")))
    if (/^(initEndpoints|getStore|safeStorage\.|session\.|initAuthEnv|initByokKeys)/.test(call.text)) out.push(`${call.text} runs before the migration finished`)
  // 失败分支:ready 之前只能 app.exit(1) —— app.quit() 会触发一次钥匙串查找(#1571 第 0b 步)
  // 三个失败分支:A 段失败;会话库一步失败;完成标记失败(完成标记写不下去也要走失败分支,不许让 main 生成器抛出)。
  // #1571 把完成标记挪到 ready 后的解密自检之后:它经 settleNamingMigration(内部调 completeNamingMigration)写,
  // 与自检失败共用 `if (!settled.ok)` 那个分支;index.ts 里不许再出现裸的 journal.complete()。
  const failed = source.indexOf('if (naming.kind === "failed")')
  const dbFailed = source.indexOf("if (!db.ok)")
  const settledFailed = source.indexOf("if (!settled.ok)")
  for (const [label, start] of [["A segment", failed], ["db step", dbFailed], ["self-check / completion", settledFailed]] as const) {
    const block = start < 0 ? "" : source.slice(start, source.indexOf("}", source.indexOf("app.exit(1)", start)) + 1)
    if (!block.includes("dialog.showErrorBox(") || !block.includes("app.exit(1)") || block.includes("app.quit("))
      out.push(`the ${label} failed branch must show dialog.showErrorBox and app.exit(1), never app.quit()`)
  }
  if (!/const settled = settleNamingMigration\(naming\.journal/.test(source) || /journal\.complete\(/.test(source))
    out.push("completion must go through completeNamingMigration (via settleNamingMigration) and share its failed branch")
  if (boot >= 0 && failed >= 0 && failed < boot) out.push("failed branch precedes the boot call")
  return out
}

describe("R17 —— index.ts:A 段在锁之后、preferAppEnv 之前;会话库一步在 preferAppEnv 之后、首个异步边界之前", () => {
  const source = readFileSync(join(MAIN, "index.ts"), "utf8")

  test("真 index.ts 零违例", () => {
    expect(bootOrderViolations(source)).toEqual([])
  })

  test("对照臂:把调用挪到 whenReady 之后、或换成 app.quit() ⇒ 点名", () => {
    const boot = source.indexOf("  const naming = runNamingMigrationBoot(")
    const ready = source.indexOf("  yield* Effect.promise(() => app.whenReady())")
    expect(boot).toBeGreaterThan(0)
    expect(ready).toBeGreaterThan(boot)
    // 会话库一步挪到 whenReady 之后
    const movedDb = source
      .replace("    const db = runNamingMigrationDbStep(", "    const db = movedAway(")
      .replace("  yield* Effect.promise(() => app.whenReady())", "  yield* Effect.promise(() => app.whenReady())\n  runNamingMigrationDbStep(naming.journal, input)")
    expect(movedDb).not.toBe(source)
    expect(bootOrderViolations(movedDb)).toContain("runNamingMigrationDbStep must run before the first async boundary (yield*)")
    const quit = source.replace('    dialog.showErrorBox("Code Puppy 升级迁移没有完成", naming.message)\n    app.exit(1)', '    dialog.showErrorBox("Code Puppy 升级迁移没有完成", naming.message)\n    app.quit()')
    expect(quit).not.toBe(source)
    expect(bootOrderViolations(quit).join("\n")).toContain("never app.quit()")
    // 完成标记绕开失败分支直接写(写不下去时 main 生成器会抛出)
    const bare = source.replace("    const settled = settleNamingMigration(naming.journal", "    naming.journal.complete()\n    const settled = notSettled(naming.journal")
    expect(bare).not.toBe(source)
    expect(bootOrderViolations(bare).join("\n")).toContain("completion must go through completeNamingMigration")
    // 迁移完成之前先读了端点(会碰 userData 里的旧名文件)
    const early = source.replace("  const naming = runNamingMigrationBoot(", "  initEndpoints(\"\", () => {})\n  const naming = runNamingMigrationBoot(")
    expect(bootOrderViolations(early)).toContain("initEndpoints runs before the migration finished")
  })
})

// ── AC8:迁移模块的 import 闭包与写盘点 ───────────────────────────────────────────────────

const MIGRATION_MODULES = [
  "naming-migration.ts",
  "naming-migration-db.ts",
  "naming-migration-journal.ts",
  "naming-migration-map.ts",
  "naming-migration-model-selection.ts",
  "naming-migration-fs.ts",
  "project-hidden-dir-migration.ts",
  "user-data-layout.ts",
]
const CREDENTIAL_MODULES = /\/(codepuppy-auth|codepuppy-byok-keys|codepuppy-secret-files|codepuppy-mcp-secrets|codepuppy-secrets|[^/]*keychain[^/]*)\.ts$/
const DECRYPT = /\b(safeStorage|decryptString|SecItemCopyMatching|getPassword)\b/

function closureProblems(files: string[]): string[] {
  return files.flatMap((file) => {
    const code = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
      .join("\n")
    return [
      ...(/from "electron"|require\("electron"\)/.test(code) ? [`${basename(file)} imports electron`] : []),
      ...(CREDENTIAL_MODULES.test(file) ? [`${basename(file)} is a credential module`] : []),
      ...(DECRYPT.test(code) ? [`${basename(file)} names a decrypt / keychain read API`] : []),
    ]
  })
}

describe("AC8 —— 迁移模块不碰凭据读取、只经白名单端口写盘", () => {
  test("启动迁移与项目目录迁移的 import 闭包:无 electron、无凭据模块、无解密 / 钥匙串读取接口", () => {
    const closure = [...new Set([...relativeImportClosure(join(MAIN, "naming-migration.ts")), ...relativeImportClosure(join(MAIN, "project-hidden-dir-migration.ts"))])]
    for (const name of MIGRATION_MODULES) expect(closure.some((file) => file.endsWith(`/${name}`)), name).toBe(true)
    expect(closureProblems(closure)).toEqual([])
  })

  test("写盘调用只出现在 naming-migration-fs.ts;别的迁移模块也不直接用原子写助手", () => {
    const sites = MIGRATION_MODULES.flatMap((name) => scanWriteSites(name, readFileSync(join(MAIN, name), "utf8")))
    expect(sites.length).toBeGreaterThan(0)
    expect([...new Set(sites.map((site) => site.file))]).toEqual(["naming-migration-fs.ts"])
    for (const name of MIGRATION_MODULES.filter((n) => n !== "naming-migration-fs.ts"))
      expect(readFileSync(join(MAIN, name), "utf8").includes('from "./ext-atomic-fs"'), name).toBe(false)
  })

  test("对照臂:判据认得出 electron、凭据模块与写盘", () => {
    expect(closureProblems([join(MAIN, "index.ts"), join(MAIN, "codepuppy-auth.ts")]).length).toBeGreaterThanOrEqual(2)
    expect(scanWriteSites("x.ts", 'import { writeFileSync } from "node:fs"\nwriteFileSync("a", "b")\n').length).toBe(1)
  })
})

// ── §12:映射表右边 = #1568 / #1570 的权威 ────────────────────────────────────────────────

const right = (pairs: ReadonlyArray<readonly [string, string]>) => pairs.map((pair) => pair[1])

describe("§12 —— 迁移映射的新名逐项等于各自的权威", () => {
  test("userData、全局根、环境配置、设置键、项目隐藏目录", () => {
    expect(Object.keys(LEGACY_USER_DATA).sort()).toEqual(Object.keys(USER_DATA_LAYOUT).sort())
    for (const [item, legacy] of Object.entries(LEGACY_USER_DATA))
      expect(legacy.replace(/^alpha/, "codepuppy"), item).toBe(USER_DATA_LAYOUT[item as keyof typeof USER_DATA_LAYOUT])
    expect([LEGACY_BASE_DIR, basename(defaultCodePuppyBaseRoot("/a"))]).toEqual(["alpha-code-state", "codepuppy-state"])
    expect([LEGACY_ENV_CONFIG, ENV_CONFIG]).toEqual(["alpha.jsonc", "codepuppy.jsonc"])
    expect(right(SETTINGS_KEYS)).toEqual([CLOUD_SCHEDULE_LAST_PULL_KEY, NEW_LAYOUT_SEEDED_KEY, CUSTOM_AGENTS_SEEDED_KEY])
    expect([LEGACY_PROJECT_HIDDEN_DIR, PROJECT_HIDDEN_DIR]).toEqual([".code-puppy", ".codepuppy"])
  })

  test("会话与配置里的名字:供应商、agent、Office 服务器键、来源证明、云端工具、插件工具、技能、识图标记", () => {
    const names = exportCodepuppyNames()
    expect(PROVIDER_ID[1]).toBe(names.providerIds[0]!)
    expect(right(AGENT_NAMES).sort()).toEqual(Object.keys(CODEPUPPY_AGENT_TEXT).sort())
    expect(right(OFFICE_SERVER_KEYS)).toEqual(names.serverKeys.slice(1))
    expect(CLOUD_SERVER_KEY[1]).toBe(names.serverKeys[0]!)
    const kinds = (ToolAuthority.members as ReadonlyArray<{ fields: { kind: { literal: string } } }>).map((m) => m.fields.kind.literal)
    expect(right(AUTHORITY_KINDS)).toEqual(kinds.filter((kind) => kind !== "not-asserted"))
    expect(right(CLOUD_REMOTE_NAMES).slice(0, CLOUD_MCP_TOOLS.length).sort()).toEqual([...CLOUD_MCP_TOOLS].sort())
    for (const name of [...right(PLUGIN_TOOL_NAMES), ...right(BUNDLED_PLUGIN_TOOL_NAMES)]) expect(Object.keys(TOOL_TEXT)).toContain(name)
    for (const name of right(FACTORY_SKILL_NAMES)) expect(FACTORY_SKILL_IDS as readonly string[]).toContain(name)
    expect(VISION_MARKER_KEY[1]).toBe(VISION_MARKER)
  })
})

// ── R8:持久化取值防漏 ───────────────────────────────────────────────────────────────────

const MAPPED = new Set([
  ...[AGENT_NAMES, FACTORY_SKILL_NAMES, OFFICE_SERVER_KEYS, SETTINGS_KEYS, AUTHORITY_KINDS, PLUGIN_TOOL_NAMES, BUNDLED_PLUGIN_TOOL_NAMES].flatMap(right),
  PROVIDER_ID[1],
  VISION_MARKER_KEY[1],
])

/** 例外登记表里登记为「保留旧值」的行(非 pending)的命中词元(I-09 起登记表按「文件 ⇥ 命中词元 ⇥ 处数 ⇥ 类别 ⇥ 理由」)。 */
function keptOldValueTokens(): string[] {
  return readFileSync(join(REPO, "scripts/old-name-exceptions.tsv"), "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("\t"))
    .filter((cols) => cols[3] !== "pending")
    .flatMap((cols) => (cols[1] ?? "").split(" "))
}

/** 带品牌的持久化取值:新名 ⇒ 映射表里必须有它的旧名;旧名 ⇒ 例外登记表里必须登记为保留。不带品牌的中性名不判。 */
function persistedLeaks(values: string[], mapped: ReadonlySet<string>, kept: string[]): string[] {
  return values.flatMap((value) => {
    if (value.includes("codepuppy")) return mapped.has(value) ? [] : [`${value}: new name with no old name in naming-migration-map.ts`]
    if (/alpha|code-puppy/.test(value)) return kept.includes(value) ? [] : [`${value}: old value kept but not registered in old-name-exceptions.tsv`]
    return []
  })
}

describe("R8 —— 导出器「持久化取值」类的每个名字,要么能从旧名迁过来,要么登记为保留旧值", () => {
  const values = exportCodepuppyPersistedValues()
  const kept = keptOldValueTokens()

  test("真树零漏", () => {
    expect(values.length).toBeGreaterThan(5)
    expect(persistedLeaks(values, MAPPED, kept)).toEqual([])
  })

  test("对照臂:映射表缺一项 / 登记表缺一行 ⇒ 点名", () => {
    const missing = new Set([...MAPPED].filter((name) => name !== "codepuppy-ask"))
    expect(persistedLeaks(values, missing, kept)).toEqual(["codepuppy-ask: new name with no old name in naming-migration-map.ts"])
    expect(persistedLeaks(values, MAPPED, [])).toEqual(["alpha-keychain: old value kept but not registered in old-name-exceptions.tsv"])
  })
})
