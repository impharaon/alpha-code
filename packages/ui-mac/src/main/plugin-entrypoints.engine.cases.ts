// Real main/sidecar/ext/engine; pinned third-party bytes are only parsed, never executed.
// GitHub's authenticated transport uses the repository's echo MCP fixture, not a real account.
import { afterAll, beforeAll, expect, mock, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { engineSandbox, assertEngineSandboxed } from "../../test-component/engine-sandbox"
import { entrypointsFetch, provenance, verifyEntrySamples } from "../../test-fixtures/plugin-helper/entrypoints/fixture"
import type { Running } from "../../test-component/codepuppy-engine"
import type { InstallOutcomeV1 } from "../shared/plugin-install"
import type { PackageAuthorizationResultV1 } from "../shared/package-admission"
import type { SourceSearchResultV1, PreparePluginSourceResultV1 } from "./plugin-sources"

const sandbox = engineSandbox()
const nativeFetch = globalThis.fetch
const previousCwd = process.cwd()
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const listeners = new Set<(event: { data: unknown }) => void>()
const wire: unknown[] = []
const logs: unknown[] = []
const consoleOriginal = { log: console.log, warn: console.warn, error: console.error }
for (const method of ["log", "warn", "error"] as const) console[method] = (...args: unknown[]) => { logs.push(args) }
const TOKEN = "invalid-bc5-local-transport-canary"
let selectedDirectory = ""
let root = ""
let running: Running | undefined
let model: Awaited<ReturnType<(typeof import("../../test-component/codepuppy-engine"))["scriptedModel"]>>
let host: ReturnType<(typeof import("../../test-component/codepuppy-engine"))["codepuppyEngine"]>
let main: ReturnType<(typeof import("./ext-ipc"))["registerExtIpcHandlers"]>
let echo: ReturnType<(typeof import("../../../core/test/fixture/mcp-echo"))["echoMcpHandler"]>
let nativeLoads = 0
let toolCalls = 0
const projectFiles = { "opencode.json": "{\"mcp\":{}}\n", "AGENTS.md": "BC5 project byte sentinel\n" }
const invoke = async <T>(channel: string, ...args: unknown[]) => {
  const handler = handlers.get(channel)
  if (!handler) throw Error("Missing desktop IPC " + channel)
  return await handler({ sender: { id: 1, on() {}, once() {} } }, ...args) as T
}
async function until(check: () => Promise<boolean>, label: string) {
  for (const deadline = Date.now() + 15_000; ; await Bun.sleep(25)) {
    if (await check()) return
    if (Date.now() >= deadline) throw Error("Did not settle: " + label)
  }
}
const send = (method: string, route: string, body?: unknown) => running!.send(method, route, body)
const skills = async () => (await send("GET", "/api/skill")).json.data as Array<{ name: string; content: string }>
async function ledger() {
  const { readPackageLedgerStateV1 } = await import("./ext-receipt-v2")
  const state = readPackageLedgerStateV1(root)
  if (!state.ok) throw Error("Unreadable package ledger")
  return state
}
const ctx = () => ({ sessionID: "ses_bc5_entry", messageID: "msg_bc5_entry", agent: "build", id: "call_bc5_entry", signal: new AbortController().signal, progress: async () => {} })
async function chatTools() {
  const { createHubBridge } = await import("../../../ext/src/hub-bridge")
  const { createHubTools } = await import("../../../ext/src/hub-tools")
  const replies = new Set<(event: { data: unknown }) => void>()
  const bridge = createHubBridge({
    postMessage: message => {
      wire.push(message)
      main.codepuppySidecar.receive(message, reply => {
        wire.push(reply)
        for (const listener of replies) listener({ data: reply })
      })
    },
    on: (_event, listener) => { replies.add(listener) },
  }, { log: () => {} })
  return createHubTools(bridge, { location: { directory: host.projectDirectory } } as never)
}
async function chatSearch(query: string) {
  const tool = (await chatTools()).find(tool => tool.name === "codepuppy_hub_search")!
  const result = await tool.execute({ query }, ctx() as never)
  return JSON.parse(result.content as string) as SourceSearchResultV1
}
async function chatInstall(id: string) {
  const tool = (await chatTools()).find(tool => tool.name === "codepuppy_hub_install")!
  const result = await tool.execute({ id }, ctx() as never)
  expect(result).toMatchObject({ metadata: { stage: "committed" } })
  return (result.metadata as { packageId: string }).packageId
}
async function sourceInstall(candidateId: string) {
  const outcome = await invoke<InstallOutcomeV1>("ext-install-from-source", {
    requestId: "bc5_" + crypto.randomUUID(), source: { kind: "candidate", candidateId }, effect: { kind: "all-projects" }, via: "hub",
  })
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true)
  if (!outcome.ok) throw Error(outcome.detail)
  return outcome.packageId
}
function unchangedProject() {
  for (const [file, content] of Object.entries(projectFiles)) expect(readFileSync(join(host.projectDirectory, file), "utf8")).toBe(content)
  expect(readdirSync(host.projectDirectory).sort()).toEqual(Object.keys(projectFiles).sort())
}

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  await verifyEntrySamples()
  const { echoMcpHandler } = await import("../../../core/test/fixture/mcp-echo")
  echo = echoMcpHandler()
  globalThis.fetch = (async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return nativeFetch(request)
    if (url.hostname === "api.githubcopilot.com") {
      if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) return new Response(null, { status: 401, headers: { "www-authenticate": "Bearer" } })
      if (request.method === "POST" && (await request.clone().json() as { method?: string }).method === "tools/call") toolCalls++
      return echo.fetch(request)
    }
    if (url.hostname === "mcp.figma.com") return new Response(null, { status: 401, headers: { "www-authenticate": "Bearer" } })
    return entrypointsFetch(request.url)
  }) as typeof fetch
  mock.module("electron", () => ({
    ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, handler) },
    BrowserWindow: class { static fromWebContents() { return undefined } },
    dialog: { showOpenDialog: async () => ({ canceled: !selectedDirectory, filePaths: selectedDirectory ? [selectedDirectory] : [] }), showMessageBox: async () => { throw Error("Install must not ask for confirmation") } },
  }))
  mock.module("./logging", () => ({ getLogger: () => ({ log: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(args), error: (...args: unknown[]) => logs.push(args) }) }))
  mock.module("./ipc", () => ({ pickedFiles: { read: async () => { throw Error("Unexpected picked-file read") } } }))
  const advisory = await import("./ext-advisory-gate")
  mock.module("./ext-advisory-gate", () => ({ ...advisory, makeAdvisoryGate: () => () => ({ allowed: true }) }))
  const remote = await import("./remote-catalog")
  mock.module("./remote-catalog", () => ({ ...remote, readCachedCatalog: () => null, refreshRemoteCatalog: async () => remote.evaluateRemoteCatalogPackages({ source: "remote", catalog: { version: "bc5", entries: [], packages: [] }, version: "bc5", fetchedAt: provenance.fetchedAt, via: "channel-dev", channel: "dev", snapshotDigest: "b".repeat(64) }) }))
  const processPort = process as unknown as { parentPort: unknown }
  processPort.parentPort = {
    on: (_event: string, listener: (event: { data: unknown }) => void) => listeners.add(listener),
    off: (_event: string, listener: (event: { data: unknown }) => void) => listeners.delete(listener),
    postMessage: (message: Parameters<typeof main.codepuppySidecar.receive>[0]) => { wire.push(message); main?.codepuppySidecar.receive(message, () => {}) },
  }
  const { codepuppyEngine, scriptedModel } = await import("../../test-component/codepuppy-engine")
  model = scriptedModel()
  host = codepuppyEngine({ sandbox, name: "plugin-entrypoints", modelBaseURL: model.baseURL, projectFiles })
  process.chdir(host.projectDirectory)
  const { codepuppyBootstrap } = await import("@opencode/util/codepuppy-bootstrap")
  root = codepuppyBootstrap().paths.globalRoot
  const { initCodePuppyEnvironment, environmentFromMutableRoot } = await import("./codepuppy-environment")
  delete process.env.CODEPUPPY_GLOBAL_DIR
  initCodePuppyEnvironment({ isPackaged: false, channel: "dev", appDataDir: sandbox.root, baseRoot: environmentFromMutableRoot(root)!.casBaseRoot, homeDir: sandbox.home })
  const { publishInProcessEngine } = await import("./in-process-engine")
  publishInProcessEngine(request => running!.fetch(request))
  const { registerExtIpcHandlers } = await import("./ext-ipc")
  main = registerExtIpcHandlers(host.userData, "dev", async () => ({ url: running!.url, username: "opencode", password: "cp-plugin-entrypoints" }), sandbox.home, undefined, async () => undefined)
  main.codepuppySidecar.attach(message => { wire.push(message); for (const listener of listeners) listener({ data: message }) })
  await main.ledgerReady
  running = await host.start()
  // Intercept every matching import before any module code can execute. The positive control
  // proves this monitor sees the actual pinned native entry, then installs must yield zero hits.
  Bun.plugin({ name: "bc5-native-entry-monitor", setup(builder) { builder.onLoad({ filter: /\/dist\/index\.js$/ }, async args => {
    nativeLoads++
    expect(createHash("sha256").update(await Bun.file(args.path).bytes()).digest("hex")).toBe(nativeEntryDigest)
    return { contents: "export default {}", loader: "js" }
  }) } })
}, 60_000)

let nativeEntryDigest = ""
afterAll(async () => {
  await running?.close()
  model?.stop()
  await echo?.close()
  globalThis.fetch = nativeFetch
  process.chdir(previousCwd)
  Object.assign(console, consoleOriginal)
})

async function verifyOpenCodeLifecycle(packageId: string, nativeReason: "native-js-plugin" | "missing-entry") {
  const state = await ledger()
  expect(state.packageGraphs).toHaveLength(1)
  const graph = state.packageGraphs[0]!
  expect(graph.packageId).toBe(packageId)
  expect(graph.notRunning).toContainEqual({ kind: "plugin", sourceName: provenance.opencode.name, reason: nativeReason })
  const names = state.records.filter(record => record.kind === "skill").map(record => record.name).sort()
  expect(names.length).toBeGreaterThan(30)
  const inventory = async () => (await skills()).filter(skill => names.includes(skill.name))
  try {
    await until(async () => (await inventory()).length === names.length, "all installed OpenCode skills available")
  } catch (error) {
    throw Error(String(error) + JSON.stringify({ expected: names, actual: (await skills()).map(skill => skill.name), logs, listeners: listeners.size, reloads: wire.filter(message => (message as { type?: string }).type?.includes("reload")), plugin: (await send("GET", "/api/plugin")).json.data }))
  }
  expect((await inventory()).map(skill => skill.name).sort()).toEqual(names)
  expect((await inventory()).every(skill => skill.content.length > 20)).toBe(true)
  expect(state.records.every(record => record.desiredState === "enabled")).toBe(true)
  expect(nativeLoads).toBe(0)
  const exclusivePaths = state.records.flatMap(record => record.files ?? [])
  expect(exclusivePaths.length).toBeGreaterThan(0)
  expect(await invoke("ext-set-package-state", { packageId, state: "disabled" })).toMatchObject({ ok: true })
  await until(async () => (await inventory()).length === 0, "OpenCode skills off")
  expect(await inventory()).toEqual([])
  expect(await invoke("ext-set-package-state", { packageId, state: "enabled" })).toMatchObject({ ok: true })
  await until(async () => (await inventory()).length === names.length, "OpenCode skills back on")
  expect(await invoke("ext-uninstall-package", packageId)).toMatchObject({ ok: true })
  expect(await invoke("ext-reload-request", { scope: "global", items: [], reason: "BC5 package removed" })).toMatchObject({ ok: true })
  await until(async () => (await inventory()).length === 0, "OpenCode skills removed")
  expect((await ledger()).packageGraphs).toEqual([])
  expect((await ledger()).records).toEqual([])
  for (const path of exclusivePaths) expect(existsSync(path)).toBe(false)
  expect(nativeLoads).toBe(0)
  unchangedProject()
}

test("BC5 chat installs pinned OpenCode skills, native JS is not loaded, off/on/remove reaches the engine", async () => {
  const found = await chatSearch(provenance.opencode.name)
  const candidate = found.candidates.find(candidate => candidate.source === "opencode-npm")!
  const capture = await main.pluginSources.captureCandidate(candidate.id)
  if (!capture.ok) throw Error(capture.detail)
  const directory = join(sandbox.root, "real-npm-folder")
  for (const node of capture.capture.nodes.filter(node => node.kind === "file")) {
    const file = join(directory, node.path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, await capture.capture.readFile(node.path))
  }
  nativeEntryDigest = createHash("sha256").update(readFileSync(join(directory, "dist/index.js"))).digest("hex")
  await import(join(directory, "dist/index.js"))
  expect(nativeLoads).toBe(1)
  nativeLoads = 0
  selectedDirectory = directory
  const packageId = await chatInstall(candidate.id)
  expect((await ledger()).packageGraphs[0]!.source).toMatchObject({ kind: "npm", ecosystem: "opencode", name: provenance.opencode.name, version: "3.0.6" })
  await verifyOpenCodeLifecycle(packageId, "native-js-plugin")
}, 90_000)

test("BC5 the main folder picker installs the same real OpenCode package as one managed graph", async () => {
  expect(selectedDirectory).not.toBe("")
  const prepared = await invoke<PreparePluginSourceResultV1>("ext-prepare-plugin-source", { kind: "folder" })
  if (!prepared.ok || prepared.prepared.kind !== "package") throw Error(JSON.stringify(prepared))
  const packageId = await sourceInstall(prepared.prepared.candidateId)
  expect((await ledger()).packageGraphs[0]!.source).toEqual({ kind: "local-folder" })
  await verifyOpenCodeLifecycle(packageId, "native-js-plugin")
}, 90_000)

test("BC5 the Git address pins the same OpenCode version and installs whole-package skills", async () => {
  const prepared = await invoke<PreparePluginSourceResultV1>("ext-prepare-plugin-source", { kind: "git", url: provenance.opencode.repository + "/tree/" + provenance.opencode.commit })
  if (!prepared.ok || prepared.prepared.kind !== "package") throw Error(JSON.stringify(prepared))
  const converted = await main.pluginSources.convertCandidate(prepared.prepared.candidateId)
  expect(converted.ok && converted.package.version).toBe("3.0.6")
  expect(converted.ok && converted.capture.source.commit).toBe(provenance.opencode.commit)
  await verifyOpenCodeLifecycle(await sourceInstall(prepared.prepared.candidateId), "missing-entry")
}, 90_000)

test("BC5 standalone official Registry GitHub uses main-owned credentials, runtime tools, off and removal", async () => {
  const found = await chatSearch("io.github.github/github-mcp-server")
  const candidate = found.candidates.find(candidate => candidate.source === "mcp-registry")!
  expect(candidate.publisher).toEqual({ kind: "github", account: "github" })
  const packageId = await chatInstall(candidate.id)
  expect(packageId).toBe("mcpreg:github-mcp-server")
  expect((await ledger()).packageGraphs).toMatchObject([{ source: { kind: "mcp-registry", serverName: candidate.name, version: "2.1.0" } }])
  const account = await invoke<PackageAuthorizationResultV1>("ext-package-authorization", packageId)
  if (!account.ok) throw Error(account.reason)
  expect(account.items).toMatchObject([{ kind: "secret", saved: false }])
  expect(await invoke("ext-save-package-secrets", { packageId, secrets: { [account.items[0]!.prerequisiteId]: TOKEN } })).toMatchObject({ ok: true })
  const { probe } = await import("../../test-component/codepuppy-engine")
  const tools = async () => (await probe().ctx.tool.list()).filter((tool: { options?: { namespace?: string } }) => tool.options?.namespace === "github-mcp-server")
  await until(async () => (await tools()).length === 1, "Registry GitHub protocol fixture tool")
  const session = await send("POST", "/api/session", { agent: "build", permissions: [{ action: "*", resource: "*", effect: "allow" }] })
  expect(session.status).toBe(200)
  const called = await (await tools())[0]!.execute({}, { ...ctx(), sessionID: session.json.data.id })
  expect(called.content).toBeDefined()
  expect(toolCalls).toBe(1)
  expect(await invoke("ext-set-package-state", { packageId, state: "disabled" })).toMatchObject({ ok: true })
  await until(async () => (await tools()).length === 0, "Registry tool off")
  expect(await invoke("ext-uninstall-package", packageId)).toMatchObject({ ok: true })
  expect(await tools()).toEqual([])
  expect((await ledger()).packageGraphs).toEqual([])
  for (const surface of [wire, logs, await invoke("ext-installed-packages"), await ledger(), readFileSync(join(root, "codepuppy.jsonc"), "utf8")]) expect(JSON.stringify(surface)).not.toContain(TOKEN)
  unchangedProject()
}, 90_000)

test("BC5 Figma plugin and explicitly official MCP requests install only their verified recorded target", async () => {
  const plugin = await chatSearch(provenance.figma.queries[0]!)
  expect(plugin.candidates[0]).toMatchObject({ source: "claude-marketplace", name: "figma" })
  const pluginId = await chatInstall(plugin.candidates[0]!.id)
  expect(pluginId).toBe("claude:figma")
  const state = await ledger()
  expect(state.packageGraphs).toHaveLength(1)
  expect(state.packageGraphs[0]!.source).toMatchObject({ kind: "marketplace", ecosystem: "claude", commit: provenance.figma.pluginCommit })
  expect(await invoke("ext-uninstall-package", pluginId)).toMatchObject({ ok: true })
  const official = await invoke<SourceSearchResultV1>("ext-sources-search", provenance.figma.queries[1]!)
  expect(official.candidates).toHaveLength(1)
  expect(official.candidates[0]).toMatchObject({ source: "mcp-registry", name: "com.figma.mcp/mcp" })
  const packageId = await sourceInstall(official.candidates[0]!.id)
  expect((await ledger()).packageGraphs).toMatchObject([{ packageId, source: { kind: "mcp-registry", serverName: "com.figma.mcp/mcp", version: "1.0.3" } }])
  const { readMcpLeafStrict } = await import("./ext-config")
  const graph = (await ledger()).packageGraphs[0]!
  expect(readMcpLeafStrict(graph.root.name)).toMatchObject({ ok: true, value: { url: "https://mcp.figma.com/mcp" } })
  const account = await invoke<PackageAuthorizationResultV1>("ext-package-authorization", packageId)
  expect(account.ok && account.items.some(item => item.kind === "mcp-oauth" && !item.authenticated)).toBe(true)
  expect(await invoke("ext-uninstall-package", packageId)).toMatchObject({ ok: true })
  expect((await ledger()).packageGraphs).toEqual([])
  unchangedProject()
}, 90_000)
