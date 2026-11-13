// `#1697`(I-04 M4,设计 §4.2、§4.10 f、R12):约定、管道、翻译器与 Code Puppy 自己的界面之间的依赖方向,按 §4.2 表里的
// 「不许依赖」逐条机器判:
//   · contract/   不许引 opencode2/、任何引擎包(`@opencode/*`)、冻结界面除冻结 app `utils/session.ts` 之外的源码;
//                 对 v1 SDK 只许类型与 `createOpencodeClient` 这一个运行时绑定,对冻结 app 自带的 1.17.13 客户端只许 `import type`;
//   · index.ts    不许引冻结界面的任何源码;
//   · opencode2/  不许引冻结界面的任何源码、任何 `@opencode-ai/*`(v1 SDK、1.17.13 客户端、冻结的几个包);
//   · renderer/** 不许引 v1 SDK、1.17.13 客户端(v1 类型与 createOpencodeClient 只经 contract/v1)。
// 模块引用用 TypeScript 自己的解析器找全(静态 import / export-from、只为副作用的 import、`import type`、动态 `import()`、
// `require()`、`import x = require()`,注释与空白不影响);判的是**解析后的目标属于哪个包**:相对路径按文件位置解析,包名按
// 仓库里各包的清单名对到目录 —— 经相对路径直进被禁的包与经包名一样算。
// 只扫非测试源码,排除规则与覆盖扫描(routes-coverage.test.ts)同一条:测试、测试宿主与替身照旧直接引 SDK(它们把
// `@opencode-ai/sdk` 整个前缀 alias 到录音替身)。renderer 挂载冻结界面用的 `@opencode-ai/{app,ui,session-ui}` 不在限制里。
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import ts from "typescript"
import * as SDK from "@opencode-ai/sdk/v2/client"
import * as V1 from "./contract/v1"

const PACKAGES = resolve(import.meta.dir, "../../..")
const ADAPTER = "ui-mac/src/engine-adapter"
const SKIP = /\.test\.|test-runtime|\.cases\.ts$|-stub\.ts$|\.stories\./

/** 清单名 → packages/ 下的目录(`@opencode-ai/sdk` → `codepuppy-sdk-v1`,`@opencode/core` → `core` …)。 */
const PACKAGE_DIRS = new Map<string, string>()
for (const dir of readdirSync(PACKAGES)) {
  const manifest = join(PACKAGES, dir, "package.json")
  if (!existsSync(manifest)) continue
  const name = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name
  if (name) PACKAGE_DIRS.set(name, dir)
}
const FROZEN_UI = new Set(["codepuppy-app", "codepuppy-ui", "codepuppy-session-ui", "codepuppy-core-util"])
const V1_SDK = "codepuppy-sdk-v1"
const ENGINE = new Set([...PACKAGE_DIRS].filter(([name]) => name.startsWith("@opencode/")).map(([, dir]) => dir))

/** 一个模块引用:原文、是否只引类型、按值引的具名绑定(`*` = 整个模块)、解析后的「packages/ 下的路径」与所属。 */
type Import = { specifier: string; typeOnly: boolean; values: string[]; target: string; owner: string }

/** 解析后的目标归谁:冻结界面 / v1 SDK / 1.17.13 客户端 / 引擎包 / 本仓别的包 / 外部包。 */
function ownerOf(target: string) {
  const [dir, ...rest] = target.split("/")
  if (dir === "codepuppy-app" && (rest[0] === "vendor" || rest.join("/").startsWith("node_modules/@opencode-ai/client"))) return "legacy-client"
  if (target.startsWith("node_modules/@opencode-ai/client") || target.includes("/node_modules/@opencode-ai/client")) return "legacy-client"
  if (dir && FROZEN_UI.has(dir)) return "frozen-ui"
  if (dir === V1_SDK) return "v1-sdk"
  if (dir && ENGINE.has(dir)) return "engine"
  return dir ?? ""
}

function targetOf(specifier: string, file: string) {
  if (specifier.startsWith(".")) return relative(PACKAGES, resolve(dirname(join(PACKAGES, file)), specifier))
  const parts = specifier.split("/")
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!
  const rest = parts.slice(specifier.startsWith("@") ? 2 : 1).join("/")
  if (name === "@opencode-ai/client") return `node_modules/@opencode-ai/client${rest ? `/${rest}` : ""}`
  const dir = PACKAGE_DIRS.get(name)
  return dir ? `${dir}${rest ? `/${rest}` : ""}` : `node_modules/${specifier}`
}

/** 一份源码里的每个模块引用(TypeScript 解析器的语法树,不靠正则)。 */
export function importsOf(text: string, file: string): Import[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: Import[] = []
  const add = (specifier: string, typeOnly: boolean, values: string[]) => {
    const target = targetOf(specifier, file)
    out.push({ specifier, typeOnly, values, target, owner: ownerOf(target) })
  }
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : undefined
      const values = !clause
        ? ["*"] // 只为副作用的 import:整个模块在运行时求值
        : clause.isTypeOnly
          ? []
          : [
              ...(clause.name ? ["default"] : []),
              ...(clause.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? ["*"] : []),
              ...(named ?? []).filter((item) => !item.isTypeOnly).map((item) => (item.propertyName ?? item.name).text),
            ]
      add(node.moduleSpecifier.text, values.length === 0, values)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const named = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : undefined
      const values = node.isTypeOnly ? [] : named ? named.filter((item) => !item.isTypeOnly).map((item) => (item.propertyName ?? item.name).text) : ["*"]
      add(node.moduleSpecifier.text, values.length === 0, values)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression
      if (ts.isStringLiteral(expression)) add(expression.text, node.isTypeOnly, node.isTypeOnly ? [] : ["*"])
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1 && ts.isStringLiteralLike(node.arguments[0]!)) {
      const callee = node.expression
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require"))
        add((node.arguments[0] as ts.StringLiteralLike).text, false, ["*"])
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      add(node.argument.literal.text, true, [])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return out
}

/** §4.2 表的「不许依赖」:按文件所在的层与引用解析后的目标所属判,交回违例(空 = 守住)。 */
export function violations(file: string, text: string): string[] {
  const out: string[] = []
  const report = (item: Import, rule: string) => out.push(`${file} → ${item.specifier}(${rule})`)
  for (const item of importsOf(text, file)) {
    if (file.startsWith(`${ADAPTER}/contract/`)) {
      if (item.target.startsWith(`${ADAPTER}/opencode2`)) report(item, "contract/ 不引翻译器")
      if (item.owner === "engine") report(item, "contract/ 不引引擎包")
      if (item.owner === "frozen-ui" && item.target !== "codepuppy-app/src/utils/session") report(item, "contract/ 只引冻结 app 的 utils/session.ts")
      if (item.owner === "legacy-client" && !item.typeOnly) report(item, "1.17.13 客户端只许 import type")
      if (item.owner === "v1-sdk" && item.values.some((value) => value !== "createOpencodeClient"))
        report(item, "v1 SDK 只许类型与 createOpencodeClient")
    } else if (file === `${ADAPTER}/index.ts`) {
      if (item.owner === "frozen-ui") report(item, "管道不引冻结界面")
    } else if (file.startsWith(`${ADAPTER}/opencode2/`)) {
      if (item.owner === "frozen-ui") report(item, "翻译器不引冻结界面")
      if (item.owner === "v1-sdk" || item.owner === "legacy-client") report(item, "翻译器不引 @opencode-ai/*")
    } else if (file.startsWith("ui-mac/src/renderer/")) {
      if (item.owner === "v1-sdk" || item.owner === "legacy-client") report(item, "renderer 只经 contract/v1 取 v1 类型与客户端")
    }
  }
  return out
}

function sourceFiles() {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (!["test", "e2e", "node_modules", "fixtures"].includes(name)) walk(path)
        continue
      }
      if (/\.(ts|tsx)$/.test(name) && !SKIP.test(name)) files.push(relative(PACKAGES, path))
    }
  }
  walk(join(PACKAGES, ADAPTER))
  walk(join(PACKAGES, "ui-mac/src/renderer"))
  return files
}

const FILES = sourceFiles()

describe("#1697 约定的依赖方向(设计 §4.10 f)", () => {
  test("自检:扫到了四层的文件", () => {
    expect(FILES).toContain(`${ADAPTER}/index.ts`)
    expect(FILES.filter((file) => file.startsWith(`${ADAPTER}/contract/`)).length).toBeGreaterThanOrEqual(6)
    expect(FILES.filter((file) => file.startsWith(`${ADAPTER}/opencode2/`)).length).toBeGreaterThanOrEqual(6)
    expect(FILES.filter((file) => file.startsWith("ui-mac/src/renderer/")).length).toBeGreaterThan(200)
  })

  test("真树:§4.2 表的「不许依赖」一条都没有", () => {
    expect(FILES.flatMap((file) => violations(file, readFileSync(join(PACKAGES, file), "utf8")))).toEqual([])
  })

  test("自检:解析器在真树上找到了引用,且已知的几条按解析目标归了类", () => {
    const all = FILES.flatMap((file) => importsOf(readFileSync(join(PACKAGES, file), "utf8"), file).map((item) => ({ file, ...item })))
    expect(all.length).toBeGreaterThan(1000)
    expect(all.find((item) => item.file === `${ADAPTER}/contract/session.ts` && item.owner === "frozen-ui")?.target).toBe("codepuppy-app/src/utils/session")
    expect(all.find((item) => item.file === `${ADAPTER}/contract/v1.ts` && !item.typeOnly)).toMatchObject({ owner: "v1-sdk", values: ["createOpencodeClient"] })
    expect(all.find((item) => item.file === `${ADAPTER}/opencode2/index.ts` && item.specifier === "@opencode/client/promise")?.owner).toBe("engine")
  })

  test("已知坏例:§4.2「不许依赖」每一行,经包名与经相对路径各一 —— 各被点名", () => {
    const bad: Array<[file: string, source: string]> = [
      // contract/:不引翻译器、引擎包、冻结界面(utils/session.ts 除外);1.17.13 客户端只许 import type;v1 SDK 只许类型与 createOpencodeClient
      [`${ADAPTER}/contract/x.ts`, 'import { ROUTES } from "../opencode2/routes"'],
      [`${ADAPTER}/contract/x.ts`, 'import type { OpenCodeClient } from "@opencode/client/promise"'],
      [`${ADAPTER}/contract/x.ts`, 'import { evaluate } from "../../../../core/src/permission"'],
      [`${ADAPTER}/contract/x.ts`, 'import { normalizeAgentList } from "../../../../codepuppy-app/src/context/global-sync/utils"'],
      [`${ADAPTER}/contract/x.ts`, 'import { Button } from "@opencode-ai/ui/button"'],
      [`${ADAPTER}/contract/x.ts`, 'import * as Legacy from "@opencode-ai/client/promise"'],
      [`${ADAPTER}/contract/x.ts`, 'import { OpenCode } from "../../../../codepuppy-app/node_modules/@opencode-ai/client/dist/promise/index.js"'],
      [`${ADAPTER}/contract/x.ts`, 'export { OpencodeClient } from "@opencode-ai/sdk/v2/client"'],
      [`${ADAPTER}/contract/x.ts`, 'import { OpencodeClient } from "../../../../codepuppy-sdk-v1/src/v2/client"'],
      // index.ts:不引冻结界面
      [`${ADAPTER}/index.ts`, 'import { x } from "../../../codepuppy-app/src/utils/session"'],
      [`${ADAPTER}/index.ts`, 'import { useServerSync } from "@opencode-ai/app"'],
      // opencode2/:不引冻结界面、任何 @opencode-ai/*
      [`${ADAPTER}/opencode2/x.ts`, 'import { normalizeSessionInfo } from "../../../../codepuppy-app/src/utils/session"'],
      [`${ADAPTER}/opencode2/x.ts`, 'import { Markdown } from "@opencode-ai/session-ui/markdown"'],
      [`${ADAPTER}/opencode2/x.ts`, 'import type { Part } from "@opencode-ai/sdk/v2/client"'],
      [`${ADAPTER}/opencode2/x.ts`, 'import type { Part } from "../../../../codepuppy-sdk-v1/src/v2/gen/types.gen"'],
      [`${ADAPTER}/opencode2/x.ts`, 'import type { SessionInfo } from "@opencode-ai/client/promise"'],
      // renderer:不引 v1 SDK、1.17.13 客户端
      ["ui-mac/src/renderer/x.ts", 'import type { Session } from "@opencode-ai/sdk/v2/client"'],
      ["ui-mac/src/renderer/codepuppy-ui/x.ts", 'import type { Session } from "../../../../codepuppy-sdk-v1/src/v2/client"'],
      ["ui-mac/src/renderer/x.ts", 'import { OpenCode } from "@opencode-ai/client"'],
      ["ui-mac/src/renderer/sidebar/x.ts", 'import type { SessionInfo } from "../../../../codepuppy-app/node_modules/@opencode-ai/client/dist/promise/index.js"'],
    ]
    expect(bad.filter(([file, source]) => violations(file, source).length !== 1).map(([file, source]) => `${file}: ${source}`)).toEqual([])
  })

  test("已知坏例:引用的各种写法都认得出(审查给的两条在内)", () => {
    const opencode2 = `${ADAPTER}/opencode2/x.ts`
    const frozen = "../../../../codepuppy-app/src/utils/session"
    const forms = [
      `/* migration */ import { normalizeSessionInfo } from "${frozen}"`, // 审查坏例 1:注释开头
      `const m = await import ("${frozen}")`, // 审查坏例 1:import 与括号之间有空白
      `import "${frozen}"`, // 只为副作用
      `import type { Session } from "${frozen}"`,
      `export * from "${frozen}"`,
      `export { normalizeSessionInfo as n } from "${frozen}"`,
      `const n = require("${frozen}")`,
      `import n = require("${frozen}")`,
      `type T = typeof import("${frozen}")`,
      `// leading line comment\nimport {\n  normalizeSessionInfo,\n} from '${frozen}'`,
    ]
    expect(forms.filter((source) => violations(opencode2, source).length !== 1)).toEqual([])
  })

  test("对照:允许的那几种不报", () => {
    expect(violations(`${ADAPTER}/contract/x.ts`, 'import { normalizeSessionInfo } from "../../../../codepuppy-app/src/utils/session"')).toEqual([])
    expect(violations(`${ADAPTER}/contract/x.ts`, 'import type * as Legacy from "@opencode-ai/client/promise"')).toEqual([])
    expect(violations(`${ADAPTER}/contract/x.ts`, 'export { createOpencodeClient } from "@opencode-ai/sdk/v2/client"\nexport type { Session } from "@opencode-ai/sdk/v2/client"')).toEqual([])
    expect(violations(`${ADAPTER}/opencode2/x.ts`, 'import { OpenCode } from "@opencode/client/promise"\nimport { stagedAttachmentPart } from "../../../../ext/src/staged-attachment-part"')).toEqual([])
    expect(violations("ui-mac/src/renderer/x.ts", 'import { createOpencodeClient } from "../engine-adapter/contract/v1"\nimport { useServerSync } from "@opencode-ai/app"')).toEqual([])
  })

  test("R12:contract/v1 转出的 createOpencodeClient 就是 v1 SDK 的那一个绑定(运行时不变)", () => {
    expect(V1.createOpencodeClient).toBe(SDK.createOpencodeClient)
  })
})
