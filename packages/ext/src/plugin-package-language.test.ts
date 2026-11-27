import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { captureStandardFixture } from "../../ui-mac/test-fixtures/plugin-helper/fixture"
import { convertPluginTree } from "../../ui-mac/src/shared/host-extension-package-contract/plugin-conversion.mjs"
import { createPackageLanguageServices, type LanguageServerStatus } from "./plugin-package-language"

const server = join(import.meta.dir, "plugin-package-language.server.ts")
const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const until = async (condition: () => boolean) => { for (let waited = 0; waited < 5000 && !condition(); waited += 20) await Bun.sleep(20); return condition() }

/** Installs the pinned pyright-lsp package, with a controlled variant of its server declaration. */
async function languagePackage(override: (pyright: Record<string, unknown>) => Record<string, unknown>, options: { alias?: boolean } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "package-language-"))
  const root = join(scratch, "root")
  const real = join(scratch, "project")
  mkdirSync(real, { recursive: true })
  // A Location may be opened through an alias of the project; receipts and previews carry its real path.
  const project = options.alias ? join(scratch, "project-alias") : real
  if (options.alias) symlinkSync(real, project)
  const projectRoot = realpathSync(real)
  const record = join(scratch, "server.jsonl")
  const original = await captureStandardFixture("claude:pyright-lsp")
  const manifest = JSON.parse(new TextDecoder().decode(await original.readFile(".claude-plugin/plugin.json")))
  manifest.lspServers.pyright = override({ ...manifest.lspServers.pyright, env: { LSP_FIXTURE_RECORD: record } })
  const capture = await captureStandardFixture("claude:pyright-lsp", { ".claude-plugin/plugin.json": JSON.stringify(manifest) })
  const converted = await convertPluginTree(capture)
  const key = "bundle--pyright-lsp"
  const live = join(root, "ext-store", key, "generations", "gen-000001-abcdef")
  for (const node of capture.nodes) if (node.kind === "file") {
    mkdirSync(dirname(join(live, "tree", node.path)), { recursive: true })
    writeFileSync(join(live, "tree", node.path), await capture.readFile(node.path))
  }
  writeFileSync(join(live, "plugin-package.json"), JSON.stringify({ description: converted.package, hostNames: {} }))
  writeFileSync(join(root, "ext-store", key, "current.json"), JSON.stringify({ v: 1, generation: "gen-000001-abcdef", txId: "language-fixture", switchedAt: "2026-11-27T00:00:00Z" }))
  writeFileSync(join(root, "ext-store", key, "package-settings.json"), JSON.stringify({ packageId: "claude:pyright-lsp", dataHome: join(scratch, "data"), values: {}, secretRefs: {}, versions: {}, mcpVersions: {} }))
  const enable = (on: boolean) => writeFileSync(join(root, "skills-enabled.json"), JSON.stringify(options.alias
    ? { v: 3, keys: [], scoped: on ? [{ kind: "bundle", name: key.slice("bundle--".length), projectPath: projectRoot }] : [], mcp: [] }
    : { v: 3, keys: on ? [key] : [], scoped: [], mcp: [] }))
  enable(true)
  const statuses: LanguageServerStatus[] = []
  const logs: string[] = []
  const services = createPackageLanguageServices({ root, directory: project, projectRoot: () => projectRoot, report: status => statuses.push(status), log: line => logs.push(line) })
  cleanups.push(async () => { await services.dispose(); rmSync(scratch, { recursive: true, force: true }) })
  const events = () => existsSync(record) ? readFileSync(record, "utf8").trim().split("\n").map(line => JSON.parse(line) as { pid: number; event: string; [key: string]: unknown }) : []
  return { services, project, projectRoot, statuses, logs, events, enable, entryId: "lsp:.claude-plugin/plugin.json#pyright" }
}
const fixtureServer = (pyright: Record<string, unknown>) => ({ ...pyright, command: process.execPath, args: [server] })

test("diagnostics for the edited version reach the caller; non-matching files do not start the server", async () => {
  const sample = await languagePackage(pyright => ({ ...fixtureServer(pyright), settings: { python: { analysis: { typeCheckingMode: "strict" } } } }))
  writeFileSync(join(sample.project, "notes.md"), 'count: int = "not a number"\n')
  expect(await sample.services.sync("notes.md")).toEqual([])
  expect(sample.events()).toEqual([])
  writeFileSync(join(sample.project, "typed.py"), 'import os\ncount: int = "not a number"\n')
  const first = await sample.services.sync(join(sample.project, "typed.py"))
  expect(first).toEqual([{ status: expect.objectContaining({ state: "diagnostics-ready", sourceName: "pyright" }), file: "typed.py", diagnostics: [
    { line: 2, character: 1, severity: "error", message: 'Type "str" is not assignable to declared type "int"', source: "fixture", code: "reportAssignmentType" },
  ] }])
  writeFileSync(join(sample.project, "typed.py"), "import os\ncount: int = 1\n")
  expect((await sample.services.sync("typed.py"))[0]?.diagnostics).toEqual([])
  const events = sample.events()
  expect(events.filter(event => event.event === "start")).toHaveLength(1)
  expect(events.filter(event => event.event === "didOpen" || event.event === "didChange").map(event => [event.event, event.version, event.languageId])).toEqual([["didOpen", 1, "python"], ["didChange", 2, undefined]])
  expect(events.find(event => event.event === "initialize")).toMatchObject({ rootUri: pathToFileURL(sample.project).href })
  expect(events.find(event => event.event === "configuration")).toMatchObject({ result: [{ analysis: { typeCheckingMode: "strict" } }] })
  expect(sample.statuses.map(status => status.state)).toEqual(["enabled", "diagnostics-ready"])
})

test("a missing program names the declared command and starts nothing", async () => {
  // The real pinned declaration, resolved on an empty PATH given to the spawning environment.
  const empty = mkdtempSync(join(tmpdir(), "package-language-path-"))
  cleanups.push(() => rmSync(empty, { recursive: true, force: true }))
  const sample = await languagePackage(pyright => ({ ...pyright, env: { ...pyright.env as object, PATH: empty } }))
  expect(sample.statuses).toEqual([{ packageId: "claude:pyright-lsp", entryId: sample.entryId, sourceName: "pyright", treeDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), state: "dependency-missing", detail: "pyright-langserver" }])
  writeFileSync(join(sample.project, "typed.py"), 'count: int = "x"\n')
  expect(await sample.services.sync("typed.py")).toEqual([{ status: expect.objectContaining({ state: "dependency-missing", detail: "pyright-langserver" }), file: "typed.py" }])
  expect(sample.events()).toEqual([])
})

test("late or unversioned diagnostics never replace a newer version", async () => {
  const sample = await languagePackage(fixtureServer)
  writeFileSync(join(sample.project, "stale.py"), '# fixture: stale\ncount: int = "x"\n')
  const [first] = await sample.services.sync("stale.py")
  expect(first?.diagnostics?.map(item => item.message)).toEqual(['Type "str" is not assignable to declared type "int"'])
  // The stale notifications precede this round trip on the same stdout, so they have been processed.
  writeFileSync(join(sample.project, "other.py"), "value = 1\n")
  await sample.services.sync("other.py")
  const cached = await sample.services.diagnostics({ packageId: "claude:pyright-lsp", entryId: sample.entryId, projectRoot: sample.projectRoot, fileUri: pathToFileURL(join(sample.projectRoot, "stale.py")).href, documentVersion: 1 })
  expect(cached?.map(item => item.message)).toEqual(['Type "str" is not assignable to declared type "int"'])
})

test("package off stops its server and a crash restarts only within maxRestarts", async () => {
  // No source shutdownTimeout: a server that never answers shutdown must not hold the process for the request timeout.
  const sample = await languagePackage(pyright => ({ ...fixtureServer(pyright), env: { ...pyright.env as object, LSP_FIXTURE_MODE: "hang-on-shutdown" } }))
  writeFileSync(join(sample.project, "typed.py"), "value = 1\n")
  await sample.services.sync("typed.py")
  const [started] = sample.events().filter(event => event.event === "start")
  expect(alive(started!.pid)).toBe(true)
  sample.enable(false)
  expect(await until(() => !alive(started!.pid))).toBe(true)
  expect(await sample.services.sync("typed.py")).toEqual([])

  const limited = await languagePackage(pyright => ({ ...fixtureServer(pyright), maxRestarts: 0 }))
  writeFileSync(join(limited.project, "typed.py"), "value = 1\n")
  await limited.services.sync("typed.py")
  const [crashed] = limited.events().filter(event => event.event === "start")
  process.kill(crashed!.pid, "SIGKILL")
  expect(await until(() => limited.statuses.at(-1)?.state === "start-error")).toBe(true)
  expect(await limited.services.sync("typed.py")).toEqual([{ status: expect.objectContaining({ state: "start-error" }), file: "typed.py" }])
  expect(limited.events().filter(event => event.event === "start")).toHaveLength(1)

  const restarting = await languagePackage(fixtureServer)
  writeFileSync(join(restarting.project, "typed.py"), 'count: int = "x"\n')
  await restarting.services.sync("typed.py")
  process.kill(restarting.events()[0]!.pid, "SIGKILL")
  expect(await until(() => restarting.statuses.at(-1)?.state === "start-error")).toBe(true)
  expect((await restarting.services.sync("typed.py"))[0]?.diagnostics).toHaveLength(1)
  expect(restarting.events().filter(event => event.event === "start")).toHaveLength(2)
})

test("Location disposal stops every server", async () => {
  // The source shutdownTimeout grants the server time to handle shutdown and exit before termination.
  const sample = await languagePackage(pyright => ({ ...fixtureServer(pyright), shutdownTimeout: 2000 }))
  writeFileSync(join(sample.project, "typed.py"), "value = 1\n")
  await sample.services.sync("typed.py")
  const [started] = sample.events().filter(event => event.event === "start")
  await sample.services.dispose()
  expect(alive(started!.pid)).toBe(false)
  expect(sample.events().map(event => event.event)).toEqual(expect.arrayContaining(["shutdown", "exit"]))
})

test("an aliased project root opens one document per real file and matches its project scope", async () => {
  const sample = await languagePackage(fixtureServer, { alias: true })
  writeFileSync(join(sample.projectRoot, "typed.py"), 'count: int = "x"\n')
  const results = [await sample.services.sync("typed.py"), await sample.services.sync(join(sample.project, "typed.py")), await sample.services.sync(join(sample.projectRoot, "typed.py"))]
  expect(results.map(result => result.map(item => [item.file, item.diagnostics?.length]))).toEqual([[["typed.py", 1]], [["typed.py", 1]], [["typed.py", 1]]])
  expect(sample.events().filter(event => event.event === "didOpen").map(event => event.uri)).toEqual([pathToFileURL(join(sample.projectRoot, "typed.py")).href])
  expect(sample.events().find(event => event.event === "initialize")).toMatchObject({ rootUri: pathToFileURL(sample.projectRoot).href })
})

test("a reopened document never takes a pre-close version's late diagnostics", async () => {
  const sample = await languagePackage(fixtureServer)
  const file = join(sample.project, "reopen.py")
  writeFileSync(file, "value = 1\n")
  await sample.services.sync("reopen.py")
  // The last pre-close version answers late; the reopened text answers later still and has its error on line 3.
  writeFileSync(file, '# fixture: delay=300\ncount: int = "old"\n')
  await sample.services.refresh(file)
  unlinkSync(file)
  await sample.services.refresh(file)
  writeFileSync(file, '# fixture: delay=600\n\ncount: int = "new"\n')
  const [reopened] = await sample.services.sync("reopen.py")
  expect(reopened?.diagnostics?.map(item => item.line)).toEqual([3])
  const versions = sample.events().filter(event => ["didOpen", "didChange"].includes(event.event)).map(event => event.version as number)
  expect(versions).toEqual([...versions].sort((left, right) => left - right))
  expect(new Set(versions).size).toBe(versions.length)
})

test("a socket declaration runs over stdio and a server that never initializes names its transport", async () => {
  // Design §4.11: the official host accepts transport "socket" but still runs the server over stdio.
  const working = await languagePackage(pyright => ({ ...fixtureServer(pyright), transport: "socket" }))
  writeFileSync(join(working.project, "typed.py"), 'count: int = "x"\n')
  expect((await working.services.sync("typed.py"))[0]?.diagnostics).toHaveLength(1)
  const silent = await languagePackage(pyright => ({ ...fixtureServer(pyright), transport: "socket", startupTimeout: 300, env: { ...pyright.env as object, LSP_FIXTURE_MODE: "silent" } }))
  writeFileSync(join(silent.project, "typed.py"), 'count: int = "x"\n')
  const [result] = await silent.services.sync("typed.py")
  expect(result?.status).toMatchObject({ state: "protocol-error", detail: expect.stringContaining("socket") })
})
