// P-15's executable call-site inventory. This is a structural security check, not UI evidence.
import { expect, test } from "bun:test"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import ts from "typescript"

const repo = resolve(import.meta.dir, "../../../..")
const renderer = "packages/ui-mac/src/renderer/"
const roles = [
  { id: "R1", file: `${renderer}sidebar/codepuppy-sidebar.tsx`, fn: "startChat" },
  { id: "R2", file: `${renderer}sidebar/codepuppy-sidebar.tsx`, fn: "openSession" },
  { id: "R3", file: `${renderer}codepuppy-ui/workspace-chip.tsx`, fn: "choose" },
  { id: "R4", file: `${renderer}codepuppy-ui/codepuppy-session-search.tsx`, fn: "go" },
  { id: "R5", file: `${renderer}automations/automation-panel.tsx`, fn: "openSession" },
]
const walk = (dir: string): string[] => readdirSync(join(repo, dir), { withFileTypes: true }).flatMap((entry): string[] => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : /\.[jt]sx?$/.test(entry.name) && !/(?:\.test\.|\.cases\.|test-runtime|test-fixture)/.test(entry.name) ? [`${dir}/${entry.name}`] : [])
const mountedAppContexts = ["context/tabs.tsx", "context/notification.tsx", "pages/directory-layout.tsx", "pages/session.tsx", "components/titlebar.tsx"].map((file) => `packages/codepuppy-app/src/${file}`)
const files = [...walk(renderer.slice(0, -1)), ...mountedAppContexts].sort()
const compact = (node: ts.Node) => node.getText().replace(/\s+/g, " ")
function owner(node: ts.Node): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && parent.name) return parent.name.text
    if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) && ts.isVariableDeclaration(parent.parent)) return compact(parent.parent.name)
    if (ts.isJsxAttribute(parent)) return parent.name.getText()
    if (ts.isMethodDeclaration(parent)) return parent.name.getText()
  }
  return "module"
}
type Site = { key: string; kind: string }
function scan(file: string, source: string): Site[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const sites: Site[] = []
  const duplicates = new Map<string, number>()
  const add = (node: ts.Node, what: string, kind: string) => {
    const text = `${file}\t${owner(node)}\t${what}`
    const ordinal = (duplicates.get(text) ?? 0) + 1
    duplicates.set(text, ordinal)
    sites.push({ key: `${text}\t${ordinal}`, kind })
  }
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = compact(node.expression)
      const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ""
      if (["navigate", "navigateTab", "startChat", "startDraft", "promoteDraft"].includes(name) || /^hrefFor\./.test(callee)) add(node, `${callee}(${node.arguments.map(compact).join(", ")})`, "navigate")
      if (name === "onSelect" && file.endsWith("workspace-chip.tsx")) add(node, `${callee}(${node.arguments.map(compact).join(", ")})`, "navigate")
      if (name === "recordWorkspaceOpen") {
        const role = roles.find((role) => role.file === file && role.fn === owner(node))
        const bridge = file === `${renderer}codepuppy-ui/workspace-writable.ts` && owner(node) === "recordWorkspaceOpen" && !ts.isIdentifier(node.expression)
        add(node, `${callee}(${node.arguments.map(compact).join(", ")})`, role ? `record:${role.id}` : bridge ? "bridge" : "forbidden")
      }
    }
    if (ts.isIdentifier(node)) {
      const role = roles.find((role) => role.file === file && role.fn === node.text)
      if (role) add(node, `reference ${node.text}: ${compact(node.parent)}`, `reference:${role.id}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return sites
}
const actual = files.flatMap((file) => scan(file, readFileSync(join(repo, file), "utf8")))
const ledger = readFileSync(join(repo, "scripts/project-writable-navigation.tsv"), "utf8").split("\n").filter((line) => line && !line.startsWith("#")).map((line) => {
  const fields = line.split("\t")
  return { key: fields.slice(0, 4).join("\t"), kind: fields[4]! }
})
const missing = (sites: Site[], registered: Site[]) => sites.filter((site) => !registered.some((entry) => entry.key === site.key))
// Keep the exact observed AST inventory available for review; never rewrite the checked-in ledger in a test.
const scratch = join(process.env.CODEPUPPY_TEST_REAL_HOME ?? homedir(), ".cache/alpha-orch/2026-11-19/impl-project-writable")
mkdirSync(scratch, { recursive: true })
writeFileSync(join(scratch, "navigation-sites.json"), JSON.stringify(actual, null, 2))

test("P-15: every navigation/selection and record-function reference is classified, with no stale/duplicate rows", () => {
  expect(actual.length).toBeGreaterThan(30)
  expect(missing(actual, ledger)).toEqual([])
  expect(missing(ledger, actual)).toEqual([])
  expect(new Set(ledger.map((site) => site.key)).size).toBe(ledger.length)
  for (const row of ledger) expect(/^(consume:(restore|deep-link|engine|user-consume)|record:R[1-5]|reference:R[1-5]|bridge)$/.test(row.kind), row.key).toBe(true)
})

test("only R1–R5 and the preload bridge call recordWorkspaceOpen", () => {
  expect(actual.filter((site) => site.kind === "forbidden")).toEqual([])
  expect(actual.filter((site) => site.kind.startsWith("record:")).map((site) => site.kind).sort()).toEqual(roles.map((role) => `record:${role.id}`))
  expect(actual.filter((site) => site.kind === "bridge")).toHaveLength(1)
})

test("each record point awaits recording before any other await/navigation/selection", () => {
  for (const role of roles) {
    const source = readFileSync(join(repo, role.file), "utf8")
    const ast = ts.createSourceFile(role.file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const awaits: ts.AwaitExpression[] = []
    const actions: ts.CallExpression[] = []
    const visit = (node: ts.Node) => {
      if (ts.isAwaitExpression(node) && owner(node) === role.fn) awaits.push(node)
      if (ts.isCallExpression(node) && owner(node) === role.fn && /^(navigate|createSession|props\.onSelect|hrefFor\.)/.test(compact(node.expression))) actions.push(node)
      ts.forEachChild(node, visit)
    }
    visit(ast)
    expect(awaits[0] && compact(awaits[0]), role.id).toMatch(/^await recordWorkspaceOpen\(/)
    for (const action of actions) expect(action.pos, `${role.id}: ${compact(action)}`).toBeGreaterThan(awaits[0]!.end)
  }
})

test("known bad: a new unclassified navigation or function reference is rejected", () => {
  const extra = scan(`${renderer}reload-place.ts`, 'function restore() { navigate("/new"); }')
  expect(missing(extra, ledger)).toHaveLength(1)
  const reference = scan(roles[0]!.file, "function restore() { startChat(directory); }")
  expect(missing(reference, ledger).length).toBeGreaterThan(0)
})

test("known bad: recording from a restore site is forbidden even if someone adds its row to the inventory", () => {
  const bad = scan(`${renderer}reload-place.ts`, 'async function restore() { await recordWorkspaceOpen("sidecar", "/X"); }')
  expect(bad.some((site) => site.kind === "forbidden")).toBe(true)
})
