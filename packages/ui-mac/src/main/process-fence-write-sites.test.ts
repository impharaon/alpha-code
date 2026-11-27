// REQ-159 (`#1321`) · AC3 —— 可写集单一权威:alpha 在 sidecar 进程里的每一处写盘调用点都登记在
// scripts/process-fence-write-sites.tsv,并点名它落在 process-fence-profile.ts 的哪一行之下。
// 新增一处写盘不登记 ⇒ 红;登记了源码里没有的 ⇒ 红;根写歪 ⇒ 红。
//
// 手段先自证(四条控制臂,合成源码):未登记的 appendFileSync 必抓;`writeFileSync as sneaky` 改名必抓;
// `import * as fs` + `fs.promises.writeFile` 必抓;多行 import 必抓(勘破 §7.3 正则扫描漏掉的那一形);
// 不是 fs 的同名方法(`store.write(...)`)不算。集合本身也自证:闭包里必须有 sidecar 真 import 的模块,
// 不得有 index.ts(main 进程)或任何测试文件。

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import ts from "typescript"
import {
  FS_WRITE_APIS,
  diffLedger,
  isValidRoot,
  parseLedger,
  scanRepository,
  scanWriteSites,
  sidecarSourceFiles,
  signatureOf,
} from "./process-fence-write-sites"

const repoRoot = resolve(import.meta.dir, "../../../..")
const ledgerPath = resolve(repoRoot, "scripts", "process-fence-write-sites.tsv")

/** 登记为 `main-only` 的写盘点,逐条钉住(文件 · fs API · 归一化的第一个实参)。 */
const MAIN_ONLY_SITES = [
  ["codepuppy-environment.ts", "mkdirSync", "directory"],
  ["codepuppy-environment.ts", "rmdirSync", "directory"],
  ["codepuppy-secret-files.ts", "openSync", "file"],
  // SPEC-stored-credentials-fence §4.5:凭据存放点在 C1 之下,围栏内写不到;这些写者只由 main 调用(syncSecretFiles / writeSecretFileAtomic /
  // applyPlatformCredentialsHot,闭包判据见下方 I2)
  ["codepuppy-secret-files.ts", "chmodSync", "dir"],
  ["codepuppy-secret-files.ts", "chmodSync", "temp"],
  ["codepuppy-secret-files.ts", "mkdirSync", "dir"],
  ["codepuppy-secret-files.ts", "openSync", "temp"],
  ["codepuppy-secret-files.ts", "renameSync", "temp"],
  ["codepuppy-secret-files.ts", "rmSync", "file"],
  ["codepuppy-secret-files.ts", "rmSync", "path.join(dir, leftover)"],
  ["codepuppy-secret-files.ts", "rmSync", "temp"],
  ["codepuppy-secret-files.ts", "writeFileSync", "fd"],
  ["codepuppy-installs.ts", "mkdirSync", "root"],
  ["codepuppy-installs.ts", "renameSync", "file"],
  ["engine-explicit-config.ts", "chmodSync", "engineConfigDirectory"],
  ["engine-explicit-config.ts", "mkdirSync", "dir"],
  ["engine-explicit-config.ts", "mkdirSync", "path.dirname(file)"],
  ["engine-explicit-config.ts", "mkdirSync", "path.dirname(input.userConfig)"],
  ["engine-explicit-config.ts", "mkdirSync", "engineConfigDirectory"],
  ["engine-explicit-config.ts", "renameSync", "temporary"],
  ["engine-explicit-config.ts", "rmSync", "engineModelsPath(input.userDataPath)"],
  ["engine-explicit-config.ts", "rmSync", "modelsPath"],
  ["engine-explicit-config.ts", "writeFileSync", "input.userConfig"],
  ["engine-explicit-config.ts", "writeFileSync", "modelsPath"],
  ["engine-explicit-config.ts", "writeFileSync", "temporary"],
  ["ext-receipt-v2.ts", "mkdirSync", "root"],
  ["ext-receipt-v2.ts", "renameSync", "file"],
  ["ext-receipt-v2.ts", "unlinkSync", "file"],
  ["ext-receipt-v2.ts", "writeFileSync", "evidence"],
]
  .map(([file, api, firstArg]) => signatureOf({ file: `packages/ui-mac/src/main/${file}`, api: api!, firstArg: firstArg! }))
  .concat(
    // SPEC-engine-config-fence BR-03 / 片 ③(DESIGN §4.5):工具策略文档的两个写者 —— 在应用里只由 main 经窄消息调用(server.ts → receiveToolPolicyWrite)
    [
      ["packages/ext/src/policy/store.ts", "mkdirSync", "path.dirname(file)"],
      ["packages/ext/src/policy/store.ts", "renameSync", "file"],
      ["packages/ext/src/policy/store.ts", "renameSync", "tmp"],
      ["packages/ext/src/policy/store.ts", "writeFileSync", "tmp"],
    ].map(([file, api, firstArg]) => signatureOf({ file: file!, api: api!, firstArg: firstArg! })),
  )

/** 一个源文件从某个模块拿到的值绑定(静态 import 与 `await import()` 的解构;整块拿 = "*";type-only 不算)。 */
function valueImports(rel: string, module: RegExp): { names: string[]; source: ts.SourceFile } {
  const source = ts.createSourceFile(rel, readFileSync(join(repoRoot, rel), "utf8"), ts.ScriptTarget.Latest, true)
  const names: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && module.test(node.moduleSpecifier.text) && !node.importClause?.isTypeOnly) {
      const bindings = node.importClause?.namedBindings
      if (node.importClause?.name) names.push("default")
      if (bindings && ts.isNamespaceImport(bindings)) names.push("*")
      if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) if (!element.isTypeOnly) names.push((element.propertyName ?? element.name).text)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && module.test(node.arguments[0].text)) {
      const holder = ts.isAwaitExpression(node.parent) ? node.parent.parent : node.parent
      if (ts.isVariableDeclaration(holder) && ts.isObjectBindingPattern(holder.name))
        for (const element of holder.name.elements) names.push(((element.propertyName ?? element.name) as ts.Identifier).text)
      else names.push("*")
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { names, source }
}

// SPEC-engine-config-fence BR-03 / I2(片 ② 单元 A 审查第 3 条):登记簿只记「写盘点在哪」;「这些写盘点在 sidecar 里有没有调用方」由结构判据守 ——
// 用扫描器算出的同一个 sidecar 闭包。
describe("I2:main-only 写者在 sidecar 闭包里没有调用方", () => {
  const closure = sidecarSourceFiles(repoRoot)
  test("闭包里没有文件拿到读写凭据存放点的函数(readCredentialTable / readRegularFileNoFollow / syncSecretFiles / writeSecretFileAtomic / applyPlatformCredentialsHot;凭据存放点只由 main 读写,SPEC-stored-credentials-fence I3;readRegularFileNoFollow 的 openSync 是只读打开)", () => {
    const readers = new Set(["readCredentialTable", "readRegularFileNoFollow", "syncSecretFiles", "writeSecretFileAtomic", "applyPlatformCredentialsHot", "*", "default"])
    const importers: string[] = []
    const offenders: string[] = []
    for (const rel of closure) {
      if (rel.endsWith("/codepuppy-secret-files.ts")) continue
      const { names } = valueImports(rel, /(^|\/)codepuppy-secret-files(\.ts)?$/)
      if (names.length) importers.push(rel)
      for (const name of names) if (readers.has(name)) offenders.push(`${rel}: ${name}`)
    }
    expect(offenders).toEqual([])
    // 手段是活的:模型投影确实从那里拿凭据路径函数(拿到的只有路径与在场判断)
    expect(importers).toContain("packages/ui-mac/src/main/codepuppy-models.ts")
  })

  test("闭包里除 engine-explicit-config.ts 自己,没有文件拿到 writeExplicitConfig / watchExplicitSources / syncExplicitConfig / writeEngineConfigFiles / writeEngineConfigForFork / materializeGovernedModelsBase(也不整块 import 那个模块)", () => {
    const writers = new Set(["writeExplicitConfig", "watchExplicitSources", "syncExplicitConfig", "writeEngineConfigFiles", "writeEngineConfigForFork", "materializeGovernedModelsBase", "*", "default"])
    const importers: string[] = []
    const offenders: string[] = []
    for (const rel of closure) {
      if (rel.endsWith("/engine-explicit-config.ts")) continue
      const { names } = valueImports(rel, /(^|\/)engine-explicit-config(\.ts)?$/)
      if (names.length) importers.push(rel)
      for (const name of names) if (writers.has(name)) offenders.push(`${rel}: ${name}`)
    }
    expect(offenders).toEqual([])
    // 手段是活的:注入模块确实从那里拿路径函数(拿到的只有读的)
    expect(importers).toContain("packages/ui-mac/src/main/codepuppy-config-injection.ts")
  })

  // 片 ③(DESIGN §4.5、§4.7;措辞经编排器接受):§4.5 冻结的缺省写者(CLI 与单测用)就在 resolver.ts 里直接调这两个写者,而 resolver.ts 在闭包里 ——
  // 所以判据是「闭包里拿到它们的只有 resolver.ts」;生产里 registerPolicy 在有 parentPort 时传 main 的写者(插件宿主与 RPC 用例判)。
  test("闭包里拿到工具策略写者 savePolicyDocument / resetPolicyDocument 的只有 resolver.ts(缺省写者);没有文件拿到 main 侧的接收函数 receiveToolPolicyWrite,也没有文件整块 import store.ts", () => {
    const writers = new Set(["savePolicyDocument", "resetPolicyDocument"])
    const holders: string[] = []
    const importers: string[] = []
    const offenders: string[] = []
    for (const rel of closure) {
      if (rel.endsWith("/ext/src/policy/store.ts")) continue
      const { names } = valueImports(rel, rel.startsWith("packages/ext/src/policy/") ? /^\.\/store(\.ts)?$/ : /(^|\/)policy\/store(\.ts)?$/)
      if (names.length) importers.push(rel)
      if (names.some((name) => writers.has(name))) holders.push(rel)
      for (const name of names) if (name === "receiveToolPolicyWrite" || name === "*" || name === "default") offenders.push(`${rel}: ${name}`)
    }
    expect(offenders).toEqual([])
    expect(holders).toEqual(["packages/ext/src/policy/resolver.ts"])
    // 手段是活的:闭包里确实有别的文件从 store.ts 拿值(只拿摘要函数)
    expect(importers).toContain("packages/ext/src/policy/identity.ts")
  })

  test("闭包里对安装账本的读只有三处,都带 sideEffectFree: true(不写证据文件);闭包里没有文件拿到账本模块别的值", () => {
    const reads = new Set(["readPackageLedgerStateV1", "readLedgerV2"])
    const calls: string[] = []
    const offenders: string[] = []
    for (const rel of closure) {
      if (rel.endsWith("/ext-receipt-v2.ts")) continue
      const { names, source } = valueImports(rel, /(^|\/)ext-receipt-v2(\.ts)?$/)
      for (const name of names) if (!reads.has(name)) offenders.push(`${rel}: imports ${name}`)
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && reads.has(node.expression.text) && names.includes(node.expression.text)) {
          const safe = node.arguments.some((argument) => ts.isObjectLiteralExpression(argument) && argument.properties.some((property) =>
            ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "sideEffectFree" && property.initializer.kind === ts.SyntaxKind.TrueKeyword))
          calls.push(`${rel}: ${node.expression.text}`)
          if (!safe) offenders.push(`${rel}: ${node.expression.text} without sideEffectFree: true`)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(offenders).toEqual([])
    // #1776 AC-13/14(cab63d0820):注入模块按账本把插件包的 MCP 定义中和成模板,直到 main 收敛时才绑定;同样只读、sideEffectFree。
    expect(calls.sort()).toEqual(["packages/ui-mac/src/main/codepuppy-config-injection.ts: readPackageLedgerStateV1", "packages/ui-mac/src/main/engine-explicit-config.ts: readPackageLedgerStateV1", "packages/ui-mac/src/main/ext-disabled-injection.ts: readLedgerV2"])
  })
})

describe("AC3 登记簿 == 扫描(生产源码)", () => {
  const sites = scanRepository(repoRoot)
  const ledger = parseLedger(readFileSync(ledgerPath, "utf8"))
  const diff = diffLedger(sites, ledger)

  test("扫描到的写盘调用点数与登记簿都非空(扫到 0 个 = 扫描器瞎了,不是「没有写盘」)", () => {
    expect(sites.length).toBeGreaterThan(40)
    expect(ledger.length).toBeGreaterThan(40)
  })

  test("未登记的写盘调用点 = 0(新增一处写盘必须登记并点名可写集的行)", () => {
    expect(
      diff.unregistered.map((s) => `${signatureOf(s)}  (line ${s.line})`),
      "有写盘调用点没登记 —— 跑 `bun packages/ui-mac/scripts/process-fence-write-sites.ts --write` 生成签名,再把 TODO 改成它落在可写集的哪一行(W-id)。点不出根 = 新的写入根 = 要么给可写集加行(带实测),要么改代码。",
    ).toEqual([])
  })

  test("登记簿里没有源码里已不存在的行,没有重复行", () => {
    expect(diff.stale.map(signatureOf), "登记了源码里没有的写盘点 —— 删掉那一行").toEqual([])
    expect(diff.duplicates).toEqual([])
  })

  test("每一行的根都合法,且没有 TODO", () => {
    expect(diff.invalidRoot.map((r) => `${signatureOf(r)}\t${r.root}`)).toEqual([])
    expect(ledger.filter((r) => r.root === "TODO").map(signatureOf)).toEqual([])
    // `main-only` 按完整签名钉住(见 isValidRoot 的说明):同一个模块里新出现的写盘点不能顺手登记成 main-only,要先在这里写明它为什么
    // 只在 main 执行。DESIGN-engine-config-fence §4.7:引擎配置文件与安装账本的写者只在 main(SPEC-engine-config-fence BR-03);
    // 「sidecar 里没有它们的调用方」由下面的结构判据守。
    expect(ledger.filter((r) => r.root === "main-only").map(signatureOf).sort()).toEqual([...MAIN_ONLY_SITES].sort())
  })

  test("集合自证:闭包含 sidecar 真 import 的模块与 ext 全部源码;不含 main 进程入口与测试文件", () => {
    const files = sidecarSourceFiles(repoRoot)
    expect(files).toContain("packages/ui-mac/src/main/sidecar.ts")
    expect(files).toContain("packages/ui-mac/src/main/codepuppy-config-injection.ts")
    expect(files).toContain("packages/ui-mac/src/main/process-fence-apply.ts")
    expect(files).toContain("packages/ext/src/plugin.ts")
    expect(files).not.toContain("packages/ui-mac/src/main/index.ts")
    expect(files).not.toContain("packages/ui-mac/src/main/server.ts")
    expect(files.filter((f) => f.endsWith(".test.ts") || f.endsWith(".cases.ts"))).toEqual([])
  })
})

describe("控制臂:扫描器测得出已知的坏", () => {
  test("未登记的 appendFileSync 必抓,签名带归一化的第一个实参", () => {
    const src = `import { appendFileSync } from "node:fs"\nexport function f(root: string) {\n  appendFileSync(\n    join(root,   "x.log"), "hi")\n}\n`
    const sites = scanWriteSites("synthetic/a.ts", src)
    expect(sites.map(signatureOf)).toEqual(['synthetic/a.ts\tappendFileSync\tjoin(root, "x.log")'])
    expect(diffLedger(sites, []).unregistered.length).toBe(1)
  })

  test("改名 import(writeFileSync as sneaky)按真名登记 —— 朴素 grep 抓不到,这里抓得到", () => {
    const src = `import { writeFileSync as sneaky } from "fs"\nsneaky("/tmp/x", "y")\n`
    expect(scanWriteSites("synthetic/b.ts", src).map((s) => `${s.api}|${s.firstArg}`)).toEqual(['writeFileSync|"/tmp/x"'])
  })

  test("namespace import 与 promises:fs.promises.writeFile / fsp.mkdir / 默认导入 都抓", () => {
    const src = [
      `import * as fs from "node:fs"`,
      `import fsp from "node:fs/promises"`,
      `import { promises as P } from "node:fs"`,
      `await fs.promises.writeFile(a, "1")`,
      `await fsp.mkdir(b, { recursive: true })`,
      `await P.rm(c)`,
      `fs.readFileSync(d)`, // 读不算
    ].join("\n")
    expect(scanWriteSites("synthetic/c.ts", src).map((s) => `${s.api}|${s.firstArg}`)).toEqual(["writeFile|a", "mkdir|b", "rm|c"])
  })

  test("多行 import(勘破 §7.3 正则漏掉的那一形)照抓", () => {
    const src = `import {\n  existsSync,\n  writeFileSync,\n} from "node:fs"\nwriteFileSync(target, data)\n`
    expect(scanWriteSites("synthetic/d.ts", src).map(signatureOf)).toEqual(["synthetic/d.ts\twriteFileSync\ttarget"])
  })

  test("不是 fs 的同名方法不算(store.write / ws.mkdir);type-only import 不算", () => {
    const src = `import type { WriteStream } from "node:fs"\nconst store = { write: (p: string) => p }\nstore.write("/x")\nws.mkdir("/y")\n`
    expect(scanWriteSites("synthetic/e.ts", src)).toEqual([])
  })

  test("根列合法性:W-id / W-id+W-id / arg / main-only 合法;W9(不存在)/ W2、W6、W10、W16、W19(已删)/ TODO / 空 非法", () => {
    for (const ok of ["W1", "W3+W4+W1", "arg", "main-only", "W15", "W20", "X1", "W1+X1"]) expect(isValidRoot(ok), ok).toBe(true)
    for (const bad of ["W9", "W2", "W6", "W2+W1", "W10", "W16", "W19", "TODO", "", "W1+W9", "home"]) expect(isValidRoot(bad), bad).toBe(false)
  })

  test("写 API 集合含两套(sync / promises)的核心成员", () => {
    for (const api of ["writeFileSync", "writeFile", "mkdirSync", "mkdir", "renameSync", "rename", "rmSync", "rm", "symlinkSync", "copyFileSync", "createWriteStream"])
      expect(FS_WRITE_APIS.has(api), api).toBe(true)
    expect(FS_WRITE_APIS.has("readFileSync")).toBe(false)
  })
})
