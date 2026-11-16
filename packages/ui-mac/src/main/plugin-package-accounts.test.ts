import { expect, test } from "bun:test"
import { parse } from "jsonc-parser"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fixtureFetch } from "../../test-fixtures/plugin-helper/source-fetch"
import { createPluginSources } from "./plugin-sources"
import { createSourceInstaller } from "./install-from-source"
import { readPackageAuthorizationV1, savePackageSecretsV1 } from "./package-admission"
import { readPackageLedgerStateV1 } from "./ext-receipt-v2"
import { collectMcpFileRefPaths } from "./codepuppy-mcp-secrets"
import { readMcpLeafStrict } from "./ext-config"
import { runExtensionTransaction } from "./ext-transaction"

// Real, pinned Registry definitions and their provenance are shared with the source/converter cases.
// The multi-secret query uses the recorded search envelope with its one server replaced by the real
// recorded agentfetch version; no third-party definition is synthesized.
async function withPackage(multiple: boolean, run: (h: Awaited<ReturnType<typeof installPackage>>) => Promise<void>, projectOnly = false) {
  const directory = mkdtempSync(join(tmpdir(), "plugin-accounts-"))
  const previous = process.env.CODEPUPPY_GLOBAL_DIR
  process.env.CODEPUPPY_GLOBAL_DIR = join(directory, "env", "dev")
  try { await run(await installPackage(directory, multiple, projectOnly)) } finally {
    if (previous === undefined) delete process.env.CODEPUPPY_GLOBAL_DIR
    else process.env.CODEPUPPY_GLOBAL_DIR = previous
    rmSync(directory, { recursive: true, force: true })
  }
}
async function installPackage(directory: string, multiple: boolean, projectOnly: boolean) {
  const fixture = join(import.meta.dir, "../../test-fixtures/plugin-helper/registry")
  const record = await Bun.file(join(fixture, multiple ? "pypi-registry-version.json" : "github-registry-version.json")).json()
  const source = record.server.name as string
  const sources = createPluginSources({ catalog: async () => [], fetch: async url => {
    if (url.startsWith("https://registry.modelcontextprotocol.io/v0.1/servers?")) {
      const page = await Bun.file(join(fixture, "github-registry-search.json")).json()
      return Response.json({ ...page, servers: [record] })
    }
    if (url.startsWith("https://registry.modelcontextprotocol.io/v0.1/servers/")) return Response.json(record)
    return fixtureFetch(url)
  } })
  const root = () => process.env.CODEPUPPY_GLOBAL_DIR!
  const deps = {
    root, globalRoot: root, userDataPath: directory, casBaseRoot: () => directory, environment: () => "dev" as const,
    loadVerifiedCatalog: async (): Promise<never> => { throw Error("an installed Registry package must use its own declarations") },
    advisoryGate: () => ({ allowed: true as const }), resolvePackage: async (): Promise<never> => { throw Error("no catalog package") },
  }
  const install = createSourceInstaller({ ...deps, sources, catalogInstall: async () => ({ ok: false, code: "unknown-id", detail: "no catalog" }), activateMcp: async () => {}, reloadSkills: () => {}, removeDeparting: () => {} })
  const candidate = (await sources.searchSources(source)).candidates.find(item => item.source === "mcp-registry")!
  expect(candidate).toBeDefined()
  const project = join(directory, "project")
  if (projectOnly) mkdirSync(project)
  const installed = await install({ requestId: "account_install_01", source: { kind: "candidate", candidateId: candidate.id }, effect: projectOnly ? { kind: "project", directory: project } : { kind: "all-projects" }, via: "chat" })
  expect(installed.ok, JSON.stringify(installed)).toBe(true)
  if (!installed.ok) throw Error(installed.detail)
  const before = readPackageLedgerStateV1(root())
  if (!before.ok) throw Error(before.reason)
  const graph = before.packageGraphs.find(graph => graph.packageId === installed.packageId)!
  const declaration = graph.declarations!.find(item => item.kind === "mcp")!
  const files = () => {
    const leaf = readMcpLeafStrict(declaration.hostName)
    if (!leaf.ok) throw Error(leaf.reason)
    return collectMcpFileRefPaths(leaf.value)
  }
  return { directory, root, deps, graph, declaration, files, packageId: installed.packageId, before }
}

test("BC3 real standalone GitHub MCP reads and saves its own declaration without catalog facts or a second package", () => withPackage(false, async h => {
  const pending = await readPackageAuthorizationV1(h.packageId, h.deps)
  expect(pending).toMatchObject({ ok: true, packageId: h.packageId, items: [{ kind: "secret", componentId: h.declaration.componentId, prerequisiteId: h.declaration.secretNeeds[0]!.needId, saved: false }] })
  const id = h.declaration.secretNeeds[0]!.needId
  const canary = "BC3_PRIVATE_TOKEN_NOT_A_REAL_CREDENTIAL_647a"
  const plans: unknown[] = []
  const saved = await savePackageSecretsV1({ packageId: h.packageId, secrets: { [id]: canary } }, {
    ...h.deps, transaction: (target, plan, hooks) => { plans.push(plan); return runExtensionTransaction(target, plan, hooks) },
  })
  expect(saved).toEqual({ ok: true })
  const view = await readPackageAuthorizationV1(h.packageId, h.deps)
  expect(view).toMatchObject({ ok: true, items: [{ saved: true }] })
  const state = readPackageLedgerStateV1(h.root())
  expect(state.ok && state.packageGraphs).toEqual(h.before.packageGraphs)
  expect(state.ok && state.claims).toEqual(h.before.claims)
  expect(state.ok && state.records.every(record => record.desiredState === "enabled")).toBe(true)
  expect(h.files()).toHaveLength(1)
  expect(readFileSync(h.files()[0]!, "utf8")).toBe(canary) // scanner positive arm
  for (const surface of [view, saved, plans, state]) expect(JSON.stringify(surface)).not.toContain(canary)
  const hits: string[] = []
  const walk = (directory: string) => { for (const item of readdirSync(directory, { withFileTypes: true })) { const path = join(directory, item.name); if (item.isDirectory()) walk(path); else if (readFileSync(path).includes(canary)) hits.push(path) } }
  walk(h.directory)
  expect(hits).toEqual(h.files())
}))

test("BC3 replacing a noncatalog credential retires the old version and a failed transaction keeps the prior live value", () => withPackage(false, async h => {
  const id = h.declaration.secretNeeds[0]!.needId
  expect(await savePackageSecretsV1({ packageId: h.packageId, secrets: { [id]: "bc3-old-invalid-token" } }, h.deps)).toEqual({ ok: true })
  const old = h.files()[0]!
  expect(await savePackageSecretsV1({ packageId: h.packageId, secrets: { [id]: "bc3-current-invalid-token" } }, h.deps)).toEqual({ ok: true })
  const current = h.files()[0]!
  expect(current).not.toBe(old)
  expect(existsSync(old)).toBe(false)
  const ledger = readFileSync(join(h.root(), "installs.json"))
  const failed = await savePackageSecretsV1({ packageId: h.packageId, secrets: { [id]: "bc3-refused-invalid-token" } }, {
    ...h.deps, transaction: (target, plan, hooks) => runExtensionTransaction(target, plan, { ...hooks, commitReceipt: () => { throw Error("injected account ledger failure") } }),
  })
  expect(failed.ok).toBe(false)
  expect(h.files()).toEqual([current])
  expect(readFileSync(current, "utf8")).toBe("bc3-current-invalid-token")
  expect(readFileSync(join(h.root(), "installs.json"))).toEqual(ledger)
  expect(await savePackageSecretsV1({ packageId: h.packageId, secrets: { NOT_DECLARED: "bc3-undeclared" } }, h.deps)).toMatchObject({ ok: false })
  expect(readFileSync(join(h.root(), "installs.json"))).toEqual(ledger)
}))

test("BC3 a real multi-secret MCP accepts partial account updates and preserves every other live credential", () => withPackage(true, async h => {
  expect(h.declaration.secretNeeds).toHaveLength(3)
  const first = h.declaration.secretNeeds[0]!.needId
  const second = h.declaration.secretNeeds[1]!.needId
  expect(await savePackageSecretsV1({ packageId: h.packageId, secrets: { [first]: "bc3-first-invalid-key" } }, h.deps)).toEqual({ ok: true })
  expect(await readPackageAuthorizationV1(h.packageId, h.deps)).toMatchObject({ ok: true, items: [{ saved: true }, { saved: false }, { saved: false }] })
  const retained = h.files().find(file => file.endsWith("/" + first))!
  expect(await savePackageSecretsV1({ packageId: h.packageId, secrets: { [second]: "bc3-second-invalid-key" } }, h.deps)).toEqual({ ok: true })
  expect(await readPackageAuthorizationV1(h.packageId, h.deps)).toMatchObject({ ok: true, items: [{ saved: true }, { saved: true }, { saved: false }] })
  expect(readFileSync(retained, "utf8")).toBe("bc3-first-invalid-key")
  const secondFile = h.files().find(file => file.endsWith("/" + second))!
  expect(readFileSync(secondFile, "utf8")).toBe("bc3-second-invalid-key")
  expect(await savePackageSecretsV1({ packageId: h.packageId, secrets: { [first]: "bc3-first-updated-invalid-key" } }, h.deps)).toEqual({ ok: true })
  expect(existsSync(dirname(retained))).toBe(false)
  expect(readFileSync(secondFile, "utf8")).toBe("bc3-second-invalid-key")
}))


test("BC3 saving credentials preserves a package's existing project-only global disable projection", () => withPackage(false, async h => {
  expect(h.graph.effect?.kind).toBe("project")
  expect(parse(readFileSync(join(h.root(), "codepuppy.jsonc"), "utf8")).mcp[h.declaration.hostName]).toMatchObject({enabled:false})
  const id=h.declaration.secretNeeds[0]!.needId
  expect(await savePackageSecretsV1({packageId:h.packageId,secrets:{[id]:"bc3-project-invalid-token"}},h.deps)).toEqual({ok:true})
  expect(parse(readFileSync(join(h.root(), "codepuppy.jsonc"), "utf8")).mcp[h.declaration.hostName]).toMatchObject({enabled:false})
  const state=readPackageLedgerStateV1(h.root())
  expect(state.ok&&state.packageGraphs).toEqual(h.before.packageGraphs)
  expect(readdirSync(join(h.directory,"project"))).toEqual([])
}, true))
