// `#1698`(DESIGN-upgrade-bootstrap-config §4.5、§9):迁进启动文档的键,在生产源码里没有剩下的读者。
//
// 两张表,按键组提交逐组加名字(§9:每个键组一个提交边界,这一组的全部读方在同一个提交里改读文档):
//   ① 迁完即无写方的键 —— 全部生产源码(ui-mac、引擎入口、ext、core、plugin、schema、util)里一处都不许出现:写方随键删除,
//      读方改读文档,常量也不留;
//   ② main 仍持有的键(main 自己的环境、运维开关只在构建器读)—— sidecar 进程里跑的 Code Puppy 代码(生产的 sidecarSourceFiles():
//      sidecar.ts 的相对 import 闭包 + ext 全部非测试源码;加上 core / plugin / schema / util 的源码)不许出现,只许落在下面逐条登记的
//      「文件 × 键」例外上,例外本身也必须仍然成立(不留僵尸)。
// 判据用 TypeScript 的 AST:字符串字面量与属性名逐字等于键名才算(`process.env.X`、`env["X"]`、`const K = "X"`、`{ X: … }`);注释与
// 长句里提到这个名字不算。第一条用例先证明扫描器认得出这几种读法、也不把注释当读法。
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import ts from "typescript"
import { sidecarSourceFiles } from "./process-fence-write-sites"

const REPO = resolve(import.meta.dir, "../../../..")

/** ① G1:路径的两个清单,写方(server.ts)与读方(ext、core)都已改走文档。 */
const RETIRED = ["CODEPUPPY_EXT_BUNDLED_MANIFEST", "CODEPUPPY_OFFICE_MCP_MANIFEST"]
/** ② G1:全局根与 REQ-059 两个逃生阀 —— main 仍读(冻结快照的派生、ext-config 等),sidecar 进程里改读文档。 */
const MAIN_ONLY = ["CODEPUPPY_GLOBAL_DIR", "CODEPUPPY_JSONC_TRUTH_DISABLE", "CODEPUPPY_LEGACY_INSTALL_ROOT"]
/** ② 的逐条例外。 */
const EXCEPTIONS = [
  {
    file: "packages/ui-mac/src/main/codepuppy-environment.ts",
    name: "CODEPUPPY_GLOBAL_DIR",
    why: "main 与 sidecar 共用的根解析:快照 → 已发布文档 → 环境,环境这一支只服务没有快照的单元测试,生产启动里到不了(design §10 R31;bootstrap-launch-parity.engine.cases.ts 断言)。同文件里另有 main 启动时写自己的环境(initCodePuppyEnvironment)。",
  },
]

const PRODUCTION = /\.tsx?$/
const NOT_PRODUCTION = /\.(test|cases)\.tsx?$|\.d\.ts$/

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : walk(path)
    return PRODUCTION.test(entry) && !NOT_PRODUCTION.test(entry) ? [relative(REPO, path)] : []
  })
}

/** 一份源码里逐字出现的被追踪键名(字符串字面量、属性访问名、对象字面量的键)。 */
function trackedNamesIn(file: string, source: string, names: readonly string[]): string[] {
  const wanted = new Set(names)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && wanted.has(node.text)) found.push(node.text)
    if (ts.isPropertyAccessExpression(node) && wanted.has(node.name.text)) found.push(node.name.text)
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ts.isIdentifier(node.name) && wanted.has(node.name.text)) found.push(node.name.text)
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS))
  return found
}

function offenders(files: readonly string[], names: readonly string[]) {
  return files.flatMap((file) => [...new Set(trackedNamesIn(file, readFileSync(join(REPO, file), "utf8"), names))].map((name) => ({ file, name })))
}

const allProduction = () =>
  ["packages/ui-mac/src", "packages/ui-mac/engine", "packages/ext/src", "packages/core/src", "packages/plugin/src", "packages/schema/src", "packages/util/src"].flatMap((dir) =>
    walk(join(REPO, dir)),
  )
const sidecarProcess = () => [
  ...new Set([...sidecarSourceFiles(REPO), ...["packages/core/src", "packages/plugin/src", "packages/schema/src", "packages/util/src"].flatMap((dir) => walk(join(REPO, dir)))]),
]

describe("#1698 迁进启动文档的键没有剩下的读者", () => {
  test("扫描器认得出四种读法,不把注释与长句当读法(判据能红)", () => {
    const source = [
      "// CODEPUPPY_X in a comment is not a reader",
      'const message = "CODEPUPPY_X is mentioned in a sentence"',
      "const a = process.env.CODEPUPPY_X",
      'const b = env["CODEPUPPY_X"]',
      'export const NAME = "CODEPUPPY_X"',
      "const c = { CODEPUPPY_X: 1 }",
    ].join("\n")
    expect(trackedNamesIn("probe.ts", source, ["CODEPUPPY_X"])).toEqual(["CODEPUPPY_X", "CODEPUPPY_X", "CODEPUPPY_X", "CODEPUPPY_X"])
  })

  test("① 已无写方的键:全部生产源码里一处都没有", () => {
    const files = allProduction()
    expect(files.length).toBeGreaterThan(500)
    expect(offenders(files, RETIRED)).toEqual([])
  })

  test("② main 仍持有的键:sidecar 进程里的 Code Puppy 代码只在登记的例外上出现,例外都还成立", () => {
    const files = sidecarProcess()
    expect(files).toContain("packages/ui-mac/src/main/codepuppy-config-injection.ts")
    expect(files).toContain("packages/ext/src/plugin.ts")
    const found = offenders(files, MAIN_ONLY)
    const excepted = (hit: { file: string; name: string }) => EXCEPTIONS.some((entry) => entry.file === hit.file && entry.name === hit.name)
    expect(found.filter((hit) => !excepted(hit))).toEqual([])
    for (const entry of EXCEPTIONS) expect(found, `${entry.file} × ${entry.name} 已不再需要,删掉这条例外`).toContainEqual({ file: entry.file, name: entry.name })
  })
})
