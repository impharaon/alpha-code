// ac#1571 —— main 入口里与钥匙串有关的启动顺序闸(判 `src/main/index.ts` 的源码结构)。
//
// 两组判据。第一组(AC3 末句,第 0b 步⑥实测):**拿不到单实例锁时,在任何会触发钥匙串查找的代码之前,
// 用 ready 前的 `app.exit(0)` 退出**。第二组是迁移接线的位置(见下方「迁移接线」一节的抬头)。实测:现行写法 `app.quit()` 退出前 Chromium 仍会按新应用名查钥匙串,
// 查不到就新建一条随机秘密的 `Code Puppy Safe Storage`;之后真正的改名迁移被「目标已存在」永久挡住。
// `app.exit(0)` 一次钥匙串调用都不发生。
//
// 「会触发钥匙串查找的代码」按派发书逐个点名:safeStorage、session、net、BrowserWindow、cookies API、
// initAuthEnv、initByokKeys。判的范围 = 失锁判断之前会执行的全部代码:模块顶层的可执行语句(函数体只在被调用时
// 才跑,不算;立即调用的函数算),加上 main 生成器里排在失锁判断之前的语句(这一段连闭包一起算,宁严勿漏)。
//
// 为什么读源码而不 import:index.ts 在 bun 侧结构上链接不起(见 source-text-anchors.ts 抬头),
// 判据只能走 TypeScript AST。判据自己先过变异副本:换回 `app.quit()`、在失锁判断之前插入一处钥匙串相关调用,
// 都必须报违例 —— 不会红的判据不算证据。
// 诚实边界(所以标题带 ANCHOR):主语是运行期顺序,算子是源码结构。失锁之前调用的某个函数**内部**去碰钥匙串
// (判据不追调用链),或点名清单之外的某个 Electron API 触发了查找,它都不会红。运行面证据是完整包在隔离
// 钥匙串里的启动实测(票面 AC1 / 第 0b 步⑥的同法补跑)。

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

const INDEX_SOURCE = readFileSync(join(import.meta.dir, "index.ts"), "utf8")

const KEYCHAIN_TOUCHING = new Set(["safeStorage", "session", "net", "BrowserWindow", "cookies", "initAuthEnv", "initByokKeys"])

describe("失锁早退先于任何钥匙串查找 (ac#1571 AC3 / 0b⑥)", () => {
  test("ANCHOR (not a gate): 生产 index.ts:失锁分支恰为 app.exit(0); return,且它之前没有钥匙串相关代码", () => {
    expect(lockLossViolations(INDEX_SOURCE)).toEqual([])
  })

  test("变异副本:失锁分支换回 app.quit() ⇒ 报违例", () => {
    const mutated = replaceOnce(
      INDEX_SOURCE,
      "  if (!app.requestSingleInstanceLock()) {\n    app.exit(0)\n",
      "  if (!app.requestSingleInstanceLock()) {\n    app.quit()\n",
    )
    expect(lockLossViolations(mutated).join("\n")).toContain("失锁分支必须恰为 app.exit(0); return")
  })

  test("变异副本:main 里失锁判断之前调用 safeStorage / initAuthEnv ⇒ 报违例", () => {
    const lock = "  if (!app.requestSingleInstanceLock()) {\n"
    const viaSafeStorage = replaceOnce(INDEX_SOURCE, lock, `  safeStorage.isEncryptionAvailable()\n${lock}`)
    expect(lockLossViolations(viaSafeStorage).join("\n")).toContain("safeStorage")
    const viaAuth = replaceOnce(INDEX_SOURCE, lock, `  initAuthEnv(app.getPath("userData"))\n${lock}`)
    expect(lockLossViolations(viaAuth).join("\n")).toContain("initAuthEnv")
  })

  test("变异副本:模块顶层可执行语句引用 session / net ⇒ 报违例;只在函数体里引用不算", () => {
    const anchor = "const main = Effect.gen(function* () {\n"
    const topLevel = replaceOnce(INDEX_SOURCE, anchor, `const proxyProbe = session.defaultSession\n${anchor}`)
    expect(lockLossViolations(topLevel).join("\n")).toContain("session")
    const iife = replaceOnce(INDEX_SOURCE, anchor, `;(() => net.isOnline())()\n${anchor}`)
    expect(lockLossViolations(iife).join("\n")).toContain("net")
    const deferred = replaceOnce(INDEX_SOURCE, anchor, `const later = () => net.isOnline()\n${anchor}`)
    expect(lockLossViolations(deferred)).toEqual([])
  })
})

// ── 迁移接线(方案 §5.3 / AC3 / AC6 / R21-3)──────────────────────────────────────────────
// 判的都是 main 生成器体内的源码位置(连闭包一起算,宁严勿漏):
//   ① 钥匙串改名步在 requestSingleInstanceLock、app.setName、preferAppEnv、runNamingMigrationDbStep 之后,
//      在第一个 yield* 之前;它之前不引用 safeStorage / session / net / BrowserWindow / cookies / initAuthEnv /
//      initByokKeys / getStore(ready 前后 Chromium 就会按新名查钥匙串,改名必须赶在前面,且不能先被谁触发);
//   ② 两个解密自检与收尾(settleNamingMigration)在 whenReady 之后、initAuthEnv 之前;
//   ③ R21-3:收尾之前不引用会打开 Cookie 库的代码(session / BrowserWindow / net / cookies / createMainWindow);
//      自检失败的分支只 app.exit(1) + return(撤销在 settleNamingMigration 里,行为由迁移模块自己的单测判);
//   ④ 完成标记不在 index.ts 里直接写 —— 只由 settleNamingMigration 在自检之后写。
const BEFORE_RENAME_FORBIDDEN = new Set([...KEYCHAIN_TOUCHING, "getStore"])
const COOKIE_LOADERS = new Set(["session", "BrowserWindow", "net", "cookies", "createMainWindow"])

describe("迁移接线顺序 (ac#1571 §5.3 / AC3 / AC6 / R21-3)", () => {
  test("ANCHOR (not a gate): 生产 index.ts:改名步、自检、Cookie 前退出、完成标记的位置全部满足", () => {
    expect(migrationOrderViolations(INDEX_SOURCE)).toEqual([])
  })

  test("变异副本:改名步挪到 whenReady 之后 ⇒ 报违例", () => {
    const moved = replaceOnce(
      replaceOnce(INDEX_SOURCE, "        keychainRenamed = runKeychainRenameStep(", "        keychainRenamed = movedAway("),
      '  markStartupTimeline("main.app.ready")\n',
      '  markStartupTimeline("main.app.ready")\n  runKeychainRenameStep(naming.journal, keychainPort, keychainPlan)\n',
    )
    expect(migrationOrderViolations(moved).join("\n")).toContain("钥匙串改名步必须在第一个 yield* 之前")
  })

  test("变异副本:改名步之前先读 store ⇒ 报违例", () => {
    const early = replaceOnce(INDEX_SOURCE, '  preferAppEnv(app.getPath("userData"))\n', '  getStore()\n  preferAppEnv(app.getPath("userData"))\n')
    expect(migrationOrderViolations(early).join("\n")).toContain("改名步之前引用了 getStore")
  })

  test("变异副本:ready 后先 initAuthEnv / 先开 Cookie 库再自检 ⇒ 报违例", () => {
    const ready = '  markStartupTimeline("main.app.ready")\n'
    const auth = replaceOnce(INDEX_SOURCE, ready, `${ready}  initAuthEnv(app.getPath("userData"))\n`)
    expect(migrationOrderViolations(auth).join("\n")).toContain("必须在 initAuthEnv 之前")
    const cookies = replaceOnce(INDEX_SOURCE, ready, `${ready}  void session.defaultSession.cookies.get({})\n`)
    expect(migrationOrderViolations(cookies).join("\n")).toContain("自检之前引用了会打开 Cookie 库的 session")
    const window = replaceOnce(INDEX_SOURCE, ready, `${ready}  mainWindow = createMainWindow()\n`)
    expect(migrationOrderViolations(window).join("\n")).toContain("自检之前引用了会打开 Cookie 库的 createMainWindow")
  })

  test("变异副本:自检失败分支换成 app.quit() ⇒ 报违例", () => {
    const quit = replaceOnce(
      INDEX_SOURCE,
      '      dialog.showErrorBox("Code Puppy 升级迁移没有完成", settled.message)\n      app.exit(1)\n',
      '      dialog.showErrorBox("Code Puppy 升级迁移没有完成", settled.message)\n      app.quit()\n',
    )
    expect(migrationOrderViolations(quit).join("\n")).toContain("自检失败分支必须 app.exit(1) 并 return")
  })

  test("变异副本:改名步之后直接写完成标记 ⇒ 报违例", () => {
    const anchor = "        keychainRenamed = runKeychainRenameStep(naming.journal, keychainPort, keychainPlan)\n"
    const complete = replaceOnce(INDEX_SOURCE, anchor, `${anchor}        naming.journal.complete()\n`)
    expect(migrationOrderViolations(complete).join("\n")).toContain("完成标记只能由 settleNamingMigration 在自检之后写")
  })
})

function migrationOrderViolations(source: string): string[] {
  const file = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true)
  const mainBody = findMainBody(file)
  if (!mainBody) return ["找不到 `const main = Effect.gen(function* () { … })`"]
  const calls: { text: string; pos: number }[] = []
  const references: { text: string; pos: number }[] = []
  let firstYield = Number.POSITIVE_INFINITY
  const visit = (node: ts.Node) => {
    if (ts.isTypeNode(node)) return
    if (ts.isYieldExpression(node) && node.asteriskToken) firstYield = Math.min(firstYield, node.getStart(file))
    if (ts.isCallExpression(node)) calls.push({ text: node.expression.getText(file), pos: node.getStart(file) })
    if (ts.isIdentifier(node) && isValueReference(node)) references.push({ text: node.text, pos: node.getStart(file) })
    ts.forEachChild(node, visit)
  }
  visit(mainBody)
  const at = (name: string) => calls.find((call) => call.text === name)?.pos ?? -1
  const lineOf = (pos: number) => file.getLineAndCharacterOfPosition(pos).line + 1
  const out: string[] = []
  const required = [
    "app.requestSingleInstanceLock",
    "app.setName",
    "preferAppEnv",
    "runNamingMigrationDbStep",
    "runKeychainRenameStep",
    "app.whenReady",
    "settleNamingMigration",
    "probeStoredAuthDecryption",
    "probeByokVaultDecryption",
    "initAuthEnv",
  ]
  for (const name of required) if (at(name) < 0) out.push(`main 里找不到 ${name}(…) 调用`)
  if (out.length) return out

  // ①
  const rename = at("runKeychainRenameStep")
  for (const before of ["app.requestSingleInstanceLock", "app.setName", "preferAppEnv", "runNamingMigrationDbStep"])
    if (at(before) >= rename) out.push(`钥匙串改名步必须在 ${before} 之后`)
  if (rename >= firstYield) out.push("钥匙串改名步必须在第一个 yield* 之前(ready 前后 Chromium 就会按新名查钥匙串)")
  for (const ref of references.filter((r) => r.pos < rename && BEFORE_RENAME_FORBIDDEN.has(r.text)))
    out.push(`改名步之前引用了 ${ref.text}(index.ts:${lineOf(ref.pos)})`)

  // ②
  const ready = at("app.whenReady")
  const settle = at("settleNamingMigration")
  for (const name of ["settleNamingMigration", "probeStoredAuthDecryption", "probeByokVaultDecryption"]) {
    if (at(name) <= ready) out.push(`${name} 必须在 whenReady 之后`)
    if (at(name) >= at("initAuthEnv")) out.push(`${name} 必须在 initAuthEnv 之前`)
  }

  // ③
  for (const ref of references.filter((r) => r.pos < settle && COOKIE_LOADERS.has(r.text)))
    out.push(`自检之前引用了会打开 Cookie 库的 ${ref.text}(index.ts:${lineOf(ref.pos)})`)
  const failed = findIf(mainBody, (condition) => condition.getText(file) === "!settled.ok")
  const failedCalls = failed ? collectCalls(failed.thenStatement, file) : []
  const failedRefs = failed ? collectReferences(failed.thenStatement) : []
  const returns = failed && ts.isBlock(failed.thenStatement) && failed.thenStatement.statements.some(ts.isReturnStatement)
  if (!failed || !failedCalls.includes("app.exit(1)") || failedCalls.some((c) => c.startsWith("app.quit")) || !returns)
    out.push("自检失败分支必须 app.exit(1) 并 return(不能 app.quit())")
  for (const name of failedRefs.filter((name) => COOKIE_LOADERS.has(name))) out.push(`自检失败分支里引用了 ${name}`)

  // ④
  for (const call of calls.filter((c) => /(^|\.)complete$/.test(c.text)))
    out.push(`完成标记只能由 settleNamingMigration 在自检之后写 —— index.ts:${lineOf(call.pos)} 直接调用了 ${call.text}`)
  return out
}

function findIf(root: ts.Node, match: (condition: ts.Expression) => boolean): ts.IfStatement | undefined {
  let found: ts.IfStatement | undefined
  const visit = (node: ts.Node) => {
    if (found) return
    if (ts.isIfStatement(node) && match(node.expression)) found = node
    else ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

function collectCalls(root: ts.Node, file: ts.SourceFile): string[] {
  const out: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) out.push(node.getText(file))
    ts.forEachChild(node, visit)
  }
  visit(root)
  return out
}

function collectReferences(root: ts.Node): string[] {
  const out: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && isValueReference(node)) out.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return out
}

function replaceOnce(source: string, from: string, to: string): string {
  const parts = source.split(from)
  if (parts.length !== 2) throw new Error(`变异锚点在 index.ts 里出现 ${parts.length - 1} 次(要恰好 1 次):${JSON.stringify(from)}`)
  return parts.join(to)
}

function lockLossViolations(source: string): string[] {
  const file = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true)
  const mainBody = findMainBody(file)
  if (!mainBody) return ["找不到 `const main = Effect.gen(function* () { … })`"]
  const lockIndex = mainBody.statements.findIndex(isLockCheck)
  if (lockIndex < 0) return ["main 里找不到 `if (!app.requestSingleInstanceLock()) { … }`"]
  const lock = mainBody.statements[lockIndex] as ts.IfStatement

  const violations: string[] = []
  const then = lock.thenStatement
  const exact =
    !lock.elseStatement &&
    ts.isBlock(then) &&
    then.statements.length === 2 &&
    isAppExitZero(then.statements[0]!) &&
    ts.isReturnStatement(then.statements[1]!) &&
    !then.statements[1].expression
  if (!exact) violations.push(`失锁分支必须恰为 app.exit(0); return —— 实际:${lock.getText(file)}`)

  const executedBeforeLock = [
    ...file.statements.flatMap((statement) => keychainReferences(statement, file, { skipFunctionBodies: true })),
    ...mainBody.statements
      .slice(0, lockIndex)
      .flatMap((statement) => keychainReferences(statement, file, { skipFunctionBodies: false })),
    ...keychainReferences(lock.expression, file, { skipFunctionBodies: false }),
  ]
  violations.push(...executedBeforeLock.map((hit) => `失锁判断之前执行到钥匙串相关代码:${hit}`))
  return violations
}

function findMainBody(file: ts.SourceFile): ts.Block | undefined {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "main") continue
      const init = declaration.initializer
      if (!init || !ts.isCallExpression(init) || init.expression.getText(file) !== "Effect.gen") continue
      const generator = init.arguments[0]
      if (generator && ts.isFunctionExpression(generator) && generator.body) return generator.body
    }
  }
  return undefined
}

function isLockCheck(statement: ts.Statement): boolean {
  if (!ts.isIfStatement(statement)) return false
  const condition = statement.expression
  return (
    ts.isPrefixUnaryExpression(condition) &&
    condition.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isCallExpression(condition.operand) &&
    condition.operand.expression.getText() === "app.requestSingleInstanceLock"
  )
}

function isAppExitZero(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false
  const call = statement.expression
  return (
    call.expression.getText() === "app.exit" &&
    call.arguments.length === 1 &&
    ts.isNumericLiteral(call.arguments[0]!) &&
    call.arguments[0].text === "0"
  )
}

/**
 * 节点里引用到的钥匙串相关标识符(值位置;类型、import、声明名、对象字面量的键不算)。
 * skipFunctionBodies:模块顶层用 —— 函数体只在被调用时才执行,不在「失锁之前」;但立即调用的函数照算。
 */
function keychainReferences(root: ts.Node, file: ts.SourceFile, options: { skipFunctionBodies: boolean }): string[] {
  const hits: string[] = []
  const visit = (node: ts.Node, immediatelyInvoked: boolean) => {
    if (ts.isImportDeclaration(node) || ts.isTypeNode(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node))
      return
    if (options.skipFunctionBodies && ts.isFunctionLike(node) && !immediatelyInvoked) return
    if (ts.isIdentifier(node) && KEYCHAIN_TOUCHING.has(node.text) && isValueReference(node)) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
      hits.push(`${node.text}(index.ts:${line + 1})`)
    }
    if (ts.isCallExpression(node)) {
      visit(unwrapParentheses(node.expression), true)
      node.arguments.forEach((argument) => visit(argument, false))
      return
    }
    ts.forEachChild(node, (child) => visit(child, false))
  }
  visit(root, false)
  return hits
}

function unwrapParentheses(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? unwrapParentheses(node.expression) : node
}

function isValueReference(node: ts.Identifier): boolean {
  const parent = node.parent
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node)
    return false
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent)) &&
    parent.name === node
  )
    return false
  return true
}
