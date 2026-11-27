// `#1665`(编排器 2026-11-09):ext 不得残留对 v1 包作用域 `@opencode-ai/` 的引用。
// 为什么必须是一道测试:lane worktree 住在主检出目录里面,模块解析会一路往上找到主检出的 node_modules,那里还装着 v1 的
// `@opencode-ai/plugin|sdk|script` —— 于是 typecheck 与测试会把 v1 的包当真,绿是假的(`bun check --traceResolution` 实测:
// `@opencode-ai/plugin/alpha-cloud-authority` 解析到 `/Users/tide/app/alpha-code/node_modules/@opencode-ai/plugin`)。
// 2.x 的作用域是 `@opencode/`;ext 的生产代码与测试都只能用它。
//
// `#1804`:ext 的生产代码不得以运行期相对路径 import 一个会载入 `packages/schema/src/tool.ts` 的 schema 模块(直接,或经 schema
// 里的相对 import,如 session-message.ts 的 `./tool.js`)。引擎的插件源码装载器会把这条相对路径载成**第二份** tool 模块:
// 它的 Tool.Error 不是 Core 的那个类,只读档的拒绝存成 type "unknown"、丢了 codepuppyUnattendedDenial,无人值守运行记成 ok。
// 同形缺陷三次漏过 PR 门、都在夜间才发现:#1783 network-egress、#1758 secret-mask/mutations/read(#1812 修)、#1776
// plugin-package-invocation(7744bf7e52 修)。照常可用:`import type`、包名 `@opencode/schema/...`、不经 tool.ts 的相对 import
// (codepuppy-protected-files 等)。运行期与否用 Bun 自己的转译器判(`scanImports` 丢掉只作类型用的 import,与引擎装载时一致)。
import { expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, extname, join, resolve, sep } from "node:path"

const V1_SCOPE = "@opencode" + "-ai/"
const SRC = import.meta.dir
const SCHEMA_SRC = resolve(SRC, "../../schema/src")
const ENGINE_TOOL = join(SCHEMA_SRC, "tool.ts")
const isTestFile = (file: string) => /\.(test|cases)\.tsx?$/.test(file)

function runtimeRelativeImports(file: string, source = readFileSync(file, "utf8")) {
  const loader = extname(file) === ".tsx" ? "tsx" : extname(file) === ".ts" ? "ts" : "js"
  return new Bun.Transpiler({ loader })
    .scanImports(source)
    .map((entry) => entry.path)
    .filter((spec) => spec.startsWith("."))
    .map((spec) => {
      const stem = resolve(dirname(file), spec).replace(/\.m?js$/, "")
      const target = [stem + ".ts", stem + ".tsx", join(stem, "index.ts"), stem].find((path) => existsSync(path) && statSync(path).isFile())
      return { spec, target }
    })
}

function loadsEngineTool(file: string, seen = new Set<string>()): boolean {
  if (file === ENGINE_TOOL) return true
  if (seen.has(file)) return false
  seen.add(file)
  return runtimeRelativeImports(file).some(({ target }) => target?.startsWith(SCHEMA_SRC + sep) && loadsEngineTool(target, seen))
}

/** 这个 ext 文件里会让引擎载入第二份 schema tool 模块的相对 import(说明符原样)。 */
function secondEngineToolImports(file: string, source?: string) {
  return runtimeRelativeImports(file, source)
    .filter(({ target }) => target?.startsWith(SCHEMA_SRC + sep) && loadsEngineTool(target))
    .map(({ spec }) => spec)
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : []
  })
}

test("探针先测出已知的坏:一段带 v1 作用域的 import 被认出来", () => {
  expect(`import { tool } from "${V1_SCOPE}plugin"`.includes(V1_SCOPE)).toBe(true)
  expect(sourceFiles(SRC).length).toBeGreaterThan(20)
})

test("packages/ext/src 里没有任何文件引用 @opencode-ai/(v1 作用域)", () => {
  const offenders = sourceFiles(SRC)
    .filter((file) => file !== import.meta.path)
    .filter((file) => readFileSync(file, "utf8").includes(V1_SCOPE))
    .map((file) => file.slice(SRC.length + 1))
  expect(offenders).toEqual([])
})

test.each([
  { form: "#1812 修之前的 secret-mask:运行期 import schema 的 tool", source: `import { Tool } from "../../schema/src/tool"\nexport const fail = (message: string) => new Tool.Error({ message })`, offenders: ["../../schema/src/tool"] },
  { form: "7744bf7e52 修之前的包调用模块:session-message 经 ./tool.js 载入 tool", source: `import { SessionMessage } from "../../schema/src/session-message"\nexport const part = SessionMessage`, offenders: ["../../schema/src/session-message"] },
  { form: "动态 import 同样在运行期载入", source: `export const load = () => import("../../schema/src/tool")`, offenders: ["../../schema/src/tool"] },
  { form: "import type 只作类型用,运行期不载入", source: `import type { Tool } from "../../schema/src/tool"\nexport const id = (error: Tool.Error) => error`, offenders: [] },
  { form: "包名说明符走引擎那一份", source: `import { SessionMessage } from "@opencode/schema/session-message"\nexport const part = SessionMessage`, offenders: [] },
  { form: "不经 tool.ts 的 schema 模块照常相对 import", source: `import { ProtectedFiles } from "../../schema/src/codepuppy-protected-files"\nexport const rules = ProtectedFiles`, offenders: [] },
])("探针:$form", ({ source, offenders }) => {
  expect(secondEngineToolImports(join(SRC, "secret-mask.ts"), source)).toEqual(offenders)
})

test("packages/ext/src 的生产代码没有会在引擎里载入第二份 schema tool 模块的相对 import(#1804)", () => {
  const production = sourceFiles(SRC).filter((file) => !isTestFile(file))
  expect(production.length).toBeGreaterThan(20)
  const offenders = production.flatMap((file) => secondEngineToolImports(file).map((spec) => `${file.slice(SRC.length + 1)}: ${spec}`))
  expect(offenders).toEqual([])
})
