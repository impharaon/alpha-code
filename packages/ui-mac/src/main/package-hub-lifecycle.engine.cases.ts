import { ClientApi } from "../../../protocol/src/client"
// Real desktop main IPC, ext scheduler and engine in an isolated HOME/XDG/database.
// Package bytes: hub-package.fixture (unmodified alpha-web 0bb739ce). MCP transport:
// core/test/fixture/mcp-echo.ts, not a claimed GitHub/Supabase service acceptance.
import { afterAll, beforeAll, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { mixedBundleFixture } from "../../test-component/package-mixed-bundle.fixture"
import type { CodePuppyPackageEnvelopeV1 } from "../shared/host-extension-package-contract/decoder"
import { canonicalArtifactJsonBytesV1, HOST_EXTENSION_PACKAGE_CORPUS } from "../shared/host-extension-package-contract/generate-artifact"
import { engineSandbox, assertEngineSandboxed } from "../../test-component/engine-sandbox"
import { hubPackageFixture } from "../../test-component/hub-package.fixture"
import type { Running } from "../../test-component/codepuppy-engine"
import type { ReloadRequestMessage, ReloadReportMessage } from "./codepuppy-sidecar-messages"
import type { PackageAuthorizationResultV1 } from "../shared/package-admission"

const reloadEndpoint = ClientApi.groups["server.location"].endpoints["location.reload"]
const sandbox = engineSandbox()
const sample = hubPackageFixture()
const nativeFetch = globalThis.fetch
const previousCwd = process.cwd()
const TOKEN = "invalid-local-fixture-token-r2"
const NEXT_TOKEN = "invalid-local-fixture-token-r2-replacement"
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const listeners = new Set<(event: { data: unknown }) => void>()
const consoleLines: unknown[] = []
const consoleOriginal = { log: console.log, warn: console.warn, error: console.error }
for (const method of ["log", "warn", "error"] as const)
  console[method] = (...args: unknown[]) => {
    consoleLines.push(args)
  }
let stopWatching: (() => void) | undefined
// The sidecar link to main's reload coordinator. Production (server.ts) detaches it when a sidecar exits and attaches it again
// when the next one is ready, which re-sends every reload generation still in flight.
let detachSidecar: ((reason: string) => void) | undefined
let running: Running | undefined
let model: Awaited<ReturnType<(typeof import("../../test-component/codepuppy-engine"))["scriptedModel"]>>
let host: Awaited<ReturnType<(typeof import("../../test-component/codepuppy-engine"))["codepuppyEngine"]>>
let main: ReturnType<(typeof import("./ext-ipc"))["registerExtIpcHandlers"]>
let refreshFailure = ""
let refreshes = 0
let refreshEngine: () => Promise<boolean> = async () => false
let locationReloads = 0
const reloadRequests: ReloadRequestMessage[] = []
const reloadReports: ReloadReportMessage[] = []
let toolCalls = 0
let runtimeInitializes = 0
let cloudEndpoint: ReturnType<typeof Bun.serve> | undefined
let root = ""
let initialPolicy = ""
let echo: ReturnType<(typeof import("../../../core/test/fixture/mcp-echo"))["echoMcpHandler"]>
const invoke = async (channel: string, ...args: unknown[]) => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`missing desktop IPC ${channel}`)
  return handler({ sender: { id: 1, on() {}, once() {} } }, ...args)
}
async function until(check: () => Promise<boolean> | boolean, label: string) {
  for (const deadline = Date.now() + 15_000; ; await Bun.sleep(25)) {
    try {
      if (await check()) return
    } catch {
      /* A connector refresh replaces the engine. */
    }
    if (Date.now() >= deadline) throw new Error(`did not settle: ${label}`)
  }
}
const send = (method: string, route: string, body?: unknown) => running!.send(method, route, body)
const mcpStatus = async (name: string) =>
  ((await send("GET", "/api/mcp")).json.data as Array<{ name: string; status: { status: string } }>).find(
    (entry) => entry.name === name,
  )?.status.status
async function action(channel: string, ...args: unknown[]) {
  const before = refreshes
  const requested = reloadRequests.length
  expect(await invoke(channel, ...args)).toMatchObject({ ok: true })
  if (channel === "ext-install-package" && args[0] === "package:supabase") {
    // A preceding connector refresh can have detached the wire; main queues and replays on attach.
    await until(() => reloadRequests.slice(requested).some(request => request.scope === "global" && request.force !== true), "installed package reload delivered")
    expect(reloadRequests.slice(requested).some(request => request.scope === "global" && request.force !== true)).toBe(true)
  }
  const pending = reloadRequests.slice(requested)
  if (pending.length)
    await until(() => pending.every(request => reloadReports.some(report => report.generation === request.generation && report.outcome === "reloaded")), channel)
  if (pending.length) await until(async () => {
    const plugins = (await send("GET", "/api/plugin")).json.data as Array<{ id: string; state: { status: string } }>
    return ["codepuppy.ext", "codepuppy.test.engine-probe"].every(id => plugins.some(plugin => plugin.id === id && plugin.state.status === "active"))
  }, "reloaded plugins ready")
  if (!pending.length) expect(refreshes).toBe(before)
  if (refreshFailure) throw new Error(refreshFailure)
}

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  await sample.verify()
  const { echoMcpHandler } = await import("../../../core/test/fixture/mcp-echo")
  echo = echoMcpHandler()
  // Existing host decoder corpus + producer-derived mixed bundle (with real markdown assets).
  const corpus = await Bun.file(resolve(import.meta.dir, "../shared/host-extension-package-contract", HOST_EXTENSION_PACKAGE_CORPUS)).json() as { cases: Array<{ name: string; envelope: CodePuppyPackageEnvelopeV1; components: Array<{ payload: unknown }> }> }
  const cloud = corpus.cases.find((entry) => entry.name === "cloud-v1")!
  const bundle = mixedBundleFixture()
  const payloads = new Map([...bundle.payloadByDigest, [cloud.envelope.components[0]!.payloadRef.sha256, canonicalArtifactJsonBytesV1(cloud.components[0]!.payload)] as const])
  sample.packages.push(cloud.envelope, bundle.envelope)
  const bytes = new Map<string, Uint8Array>()
  const urls: string[] = []
  for (const component of sample.packages.flatMap((entry) => entry.components)) {
    const payload = payloads.get(component.payloadRef.sha256) ?? await sample.fetchBytes(component.payloadRef)
    bytes.set(component.payloadRef.url, payload)
    const decoded = JSON.parse(new TextDecoder().decode(payload)) as {
      behavior: { url?: string; asset?: { url: string; bytes: number; sha256: string }; template?: { url: string; bytes: number; sha256: string }; files?: Array<{ url: string; bytes: number; sha256: string }> }
    }
    if (decoded.behavior.url) urls.push(decoded.behavior.url)
    for (const ref of [decoded.behavior.asset, decoded.behavior.template, ...decoded.behavior.files ?? []])
      if (ref) bytes.set(ref.url, bundle.assetByDigest.get(ref.sha256) ?? await sample.fetchBytes(ref))
  }
  globalThis.fetch = (async (input, init) => {
    const request = new Request(input, init)
    const payload = bytes.get(request.url)
    if (payload) return new Response(payload)
    if (urls.some((url) => new URL(url).origin === new URL(request.url).origin)) {
      if (!request.url.includes("githubcopilot"))
        return new Response(null, { status: 401, headers: { "www-authenticate": "Bearer" } })
      if (![TOKEN, NEXT_TOKEN].some((value) => request.headers.get("authorization") === `Bearer ${value}`))
        return new Response(null, { status: 401, headers: { "www-authenticate": "Bearer" } })
      if (request.method === "POST") {
        const body = (await request.clone().json()) as { method?: string }
        if (body.method === "initialize") runtimeInitializes++
        if (body.method === "tools/call") toolCalls++
      }
      return echo.fetch(request)
    }
    const url = new URL(request.url)
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return nativeFetch(request)
    throw new Error(`unrecorded outbound request to ${url.origin}`)
  }) as typeof fetch
  mock.module("electron", () => ({
    ipcMain: {
      handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    },
    BrowserWindow: class {
      static fromWebContents() {
        return undefined
      }
    },
    dialog: {
      showMessageBox: async () => ({ response: 1 }),
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
  }))
  mock.module("./logging", () => ({ getLogger: () => ({ log() {}, warn() {}, error() {} }) }))
  mock.module("./ipc", () => ({
    pickedFiles: {
      read: async () => {
        throw new Error("file picker is outside this runtime proof")
      },
    },
  }))
  const advisory = await import("./ext-advisory-gate")
  mock.module("./ext-advisory-gate", () => ({ ...advisory, makeAdvisoryGate: () => () => ({ allowed: true }) }))
  const remote = await import("./remote-catalog")
  const evaluate = remote.evaluateRemoteCatalogPackages
  mock.module("./remote-catalog", () => ({
    ...remote,
    readCachedCatalog: () => null,
    refreshRemoteCatalog: async () =>
      evaluate({
        source: "remote",
        catalog: sample.catalog,
        version: "hub-real",
        fetchedAt: "2026-11-16T00:00:00.000Z",
        via: "channel-dev",
        channel: "dev",
        snapshotDigest: "a".repeat(64),
      }),
  }))
  const processPort = process as unknown as { parentPort: unknown }
  processPort.parentPort = {
    on: (_event: string, listener: (event: { data: unknown }) => void) => listeners.add(listener),
    off: (_event: string, listener: (event: { data: unknown }) => void) => listeners.delete(listener),
    postMessage: (message: Parameters<typeof main.codepuppySidecar.receive>[0]) => {
      if (message.type === "codepuppy.reload.report") reloadReports.push(message)
      main?.codepuppySidecar.receive(message, () => {})
    },
  }
  const { codepuppyEngine, scriptedModel } = await import("../../test-component/codepuppy-engine")
  model = scriptedModel()
  cloudEndpoint = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => echo.fetch(request) })
  const { testCloudMcp } = await import("../../test-component/codepuppy-bootstrap-fixture")
  const { secretFilePath } = await import("./codepuppy-secret-files")
  host = codepuppyEngine({ sandbox, name: "hub-lifecycle", modelBaseURL: model.baseURL, killSwitch: true, filewatcher: true,
    cloudMcp: testCloudMcp(`http://127.0.0.1:${cloudEndpoint.port}/mcp`, secretFilePath(join(sandbox.root, "hub-lifecycle-userdata"), "CODEPUPPY_MCP_TOKEN"), "hub-cloud"),
  })
  process.chdir(host.projectDirectory)
  const { codepuppyBootstrap } = await import("@opencode/util/codepuppy-bootstrap")
  root = codepuppyBootstrap().paths.globalRoot
  const { initCodePuppyEnvironment, environmentFromMutableRoot } = await import("./codepuppy-environment")
  delete process.env.CODEPUPPY_GLOBAL_DIR
  initCodePuppyEnvironment({
    isPackaged: false,
    channel: "dev",
    appDataDir: sandbox.root,
    baseRoot: environmentFromMutableRoot(root)!.casBaseRoot,
    homeDir: sandbox.home,
  })
  const { injectCodePuppyConfig } = await import("./codepuppy-config-injection")
  const { publishInProcessEngine } = await import("./in-process-engine")
  publishInProcessEngine((request) => {
    if (request.method === reloadEndpoint.method && new URL(request.url).pathname === reloadEndpoint.path) locationReloads++
    return running!.fetch(request)
  })
  const { registerExtIpcHandlers } = await import("./ext-ipc")
  const postToSidecar = (message: Parameters<Parameters<typeof main.codepuppySidecar.attach>[0]>[0]) => {
    if (message.type === "codepuppy.reload.request") reloadRequests.push(message)
    for (const listener of listeners) listener({ data: message })
  }
  // The sidecar's connector refresh: a fresh engine with a freshly injected launch config.
  refreshEngine = async () => {
    try {
      // As in production: the old sidecar's link goes away with it, so a reload posted while the engine is being replaced is
      // re-sent to the new one instead of failing against the closing engine and waiting for a session event that never comes.
      detachSidecar?.("connector refresh")
      await running?.close()
      // 与生产换代同序(SPEC-engine-config-fence BR-03):main 先按同一份启动文档写显式文件与模型底表,sidecar 再注入
      const { writeEngineConfigForFork } = await import("./engine-explicit-config")
      writeEngineConfigForFork(codepuppyBootstrap())
      const injection = injectCodePuppyConfig(
        host.userData,
        join(sandbox.root, "hub-lifecycle-ext"),
        "stable",
        codepuppyBootstrap().paths.userConfig ?? null,
      )
      const next = JSON.parse(injection.config.content) as typeof host.content
      next.providers.codepuppy!.models = host.content.providers.codepuppy!.models
      next.plugins = [...next.plugins, ...host.content.plugins.filter((entry) => entry.endsWith("-probe"))]
      // A sidecar refresh replaces its launch config; absent keys must not survive the old fork.
      for (const key of Object.keys(host.content)) Reflect.deleteProperty(host.content, key)
      Object.assign(host.content, next)
      running = await host.start()
      detachSidecar = main.codepuppySidecar.attach(postToSidecar)
      refreshes++
      return true
    } catch (error) {
      refreshFailure = error instanceof Error ? error.message : String(error)
      throw error
    }
  }
  main = registerExtIpcHandlers(
    host.userData,
    "dev",
    async () => ({ url: running!.url, username: "opencode", password: "cp-hub-lifecycle" }),
    sandbox.home,
    {
      stop: async () => {
        await running?.close()
      },
      refresh: () => refreshEngine(),
    },
    async () => undefined,
  )
  detachSidecar = main.codepuppySidecar.attach(postToSidecar)
  await main.ledgerReady
  // main (server.ts) starts this watcher right after writing the explicit file, before the fork. The old connector refresh
  // happened to re-inject paths; runtime MCP activation must exercise the real in-process path too.
  const { watchExplicitSources } = await import("./engine-explicit-config")
  stopWatching = watchExplicitSources({ ...host.explicit, log: line => consoleLines.push(line) })
  running = await host.start()
  const { policyStore } = await import("../../test-component/codepuppy-engine")
  initialPolicy = JSON.stringify((await (await policyStore()).snapshot()).user)
}, 60_000)

afterAll(async () => {
  stopWatching?.()
  await running?.close()
  model?.stop()
  await echo?.close()
  cloudEndpoint?.stop(true)
  globalThis.fetch = nativeFetch
  process.chdir(previousCwd)
  Object.assign(console, consoleOriginal)
})

async function askedTurn() {
  const created = await send("POST", "/api/session", {
    location: { directory: host.projectDirectory },
    agent: "codepuppy-ask",
    model: { id: "m", providerID: "codepuppy" },
  })
  expect(created.status).toBe(200)
  const sessionID = created.json.data.id as string
  expect(
    (
      await send("POST", `/api/session/${sessionID}/prompt`, {
        text: `CP-CALL ${JSON.stringify({ name: "execute", args: { code: "return await tools.github.echo({})" } })}`,
      })
    ).status,
  ).toBe(200)
  let requestID = ""
  await until(async () => {
    const pending = (await send("GET", `/api/session/${sessionID}/permission`)).json?.data as Array<{
      id: string
      action: string
    }>
    requestID = pending?.[0]?.id ?? ""
    if (requestID) expect(pending[0]!.action).toBe("mcp:github:echo")
    return !!requestID
  }, "real Session tool approval")
  return { sessionID, requestID }
}

test("real Supabase package exposes both enabled generation skills", async () => {
  const beforeReloads = locationReloads
  const beforeRefreshes = refreshes
  await action("ext-install-package", "package:supabase")
  await until(
    async () =>
      (await send("GET", "/api/plugin")).json.data.some(
        (plugin: { id: string; state: { status: string } }) =>
          plugin.id === "opencode.config.skill" && plugin.state.status === "active",
      ),
    "skill configuration readiness",
  )
  await until(async () => {
    const names = (await send("GET", "/api/skill")).json.data.map((skill: { name: string }) => skill.name)
    return ["supabase", "supabase-postgres-best-practices"].every(name => names.includes(name))
  }, "installed Supabase skill read-back")
  expect(locationReloads).toBeGreaterThan(beforeReloads)
  expect(refreshes).toBe(beforeRefreshes)
  const { readPackageLedgerStateV1 } = await import("./ext-receipt-v2")
  const installed = readPackageLedgerStateV1(root)
  expect(
    installed.ok &&
      installed.records
        .filter((record) => record.kind === "skill")
        .map((record) => ({ name: record.name, state: record.desiredState }))
        .sort((a, b) => a.name.localeCompare(b.name)),
  ).toEqual([
    { name: "supabase", state: "enabled" },
    { name: "supabase-postgres-best-practices", state: "enabled" },
  ])
  const skills = (await send("GET", "/api/skill")).json.data as Array<{ id: string; name: string; content: string }>
  expect(
    skills
      .filter((skill) => ["supabase", "supabase-postgres-best-practices"].includes(skill.name))
      .map((skill) => skill.name)
      .sort(),
  ).toEqual(["supabase", "supabase-postgres-best-practices"])
})

test("real desktop package lifecycle asks twice, applies a busy switch, and removes runtime entries", async () => {
  const { readPackageLedgerStateV1 } = await import("./ext-receipt-v2")
  const { policyStore, probe } = await import("../../test-component/codepuppy-engine")
  const githubTools = async () =>
    (await probe().ctx.tool.list()).filter(
      (tool: { options?: { namespace?: string } }) => tool.options?.namespace === "github",
    )
  const policyBefore = initialPolicy
  const ledgerBefore = readPackageLedgerStateV1(root)
  if (!ledgerBefore.ok || !ledgerBefore.packageGraphs.some((graph) => graph.packageId === "package:supabase"))
    await action("ext-install-package", "package:supabase")
  const skills = (await send("GET", "/api/skill")).json.data as Array<{ name: string; content: string }>
  expect(skills.find((skill) => skill.name === "supabase")!.content.length).toBeGreaterThan(20)
  expect(await mcpStatus("supabase")).not.toBe("connected")
  await action("ext-install-package", "package:github")
  const authorization = (await invoke("ext-package-authorization", "package:github")) as PackageAuthorizationResultV1
  expect(authorization).toMatchObject({ ok: true, items: [{ kind: "secret", saved: false }] })
  if (!authorization.ok) throw new Error("package authorization is unavailable")
  const prerequisiteId = authorization.items[0]!.prerequisiteId
  const beforeTokenReloads = locationReloads
  await action("ext-save-package-secrets", { packageId: "package:github", secrets: { [prerequisiteId]: TOKEN } })
  await until(async () => (await mcpStatus("github")) === "connected", "GitHub fixture connection")
  expect(runtimeInitializes).toBeGreaterThan(0)
  expect(locationReloads).toBe(beforeTokenReloads)
  await until(async () => (await githubTools()).length === 1, "connected tool registry")
  expect(await githubTools()).toHaveLength(1)
  for (const count of [1, 2]) {
    const { sessionID, requestID } = await askedTurn()
    expect(toolCalls).toBe(count - 1)
    expect(
      (await send("POST", `/api/session/${sessionID}/permission/${requestID}/reply`, { decision: "once" })).status,
    ).toBe(204)
    expect((await send("POST", `/api/experimental/session/${sessionID}/wait`)).status).toBe(204)
    expect(toolCalls).toBe(count)
  }
  expect(JSON.stringify((await (await policyStore()).snapshot()).user)).toBe(policyBefore)
  await action("ext-set-package-state", { packageId: "package:github", state: "disabled" })
  expect(await mcpStatus("github")).toBe("disabled")
  await until(async () => (await githubTools()).length === 0, "disabled GitHub tool inventory")
  expect(await githubTools()).toEqual([])
  const disabledInitializes = runtimeInitializes
  const beforeDisabledTokenReloads = locationReloads
  await action("ext-save-package-secrets", { packageId: "package:github", secrets: { [prerequisiteId]: NEXT_TOKEN } })
  expect(await mcpStatus("github")).toBe("disabled")
  await until(async () => (await githubTools()).length === 0, "disabled GitHub tool inventory")
  expect(await githubTools()).toEqual([])
  expect(runtimeInitializes).toBe(disabledInitializes)
  expect(locationReloads).toBe(beforeDisabledTokenReloads)
  await action("ext-set-package-state", { packageId: "package:github", state: "enabled" })
  await until(async () => (await mcpStatus("github")) === "connected", "reenabled connector")
  const held = await askedTurn()
  expect((await send("GET", "/api/session/active")).json.data[held.sessionID]).toBeDefined()
  const beforeHotDisableReloads = locationReloads
  await action("ext-set-package-state", { packageId: "package:github", state: "disabled" })
  await until(async () => (await send("GET", `/api/session/${held.sessionID}/permission`)).json.data.length === 0 && !(await send("GET", "/api/session/active")).json.data[held.sessionID], "disabled connector releases its pending round")
  expect(locationReloads).toBe(beforeHotDisableReloads)
  expect((await send("GET", `/api/session/${held.sessionID}/permission`)).json.data).toEqual([])
  expect((await send("GET", "/api/session/active")).json.data[held.sessionID]).toBeUndefined()
  expect(toolCalls).toBe(2)
  await until(async () => (await githubTools()).length === 0, "disabled GitHub tool inventory")
  expect(await githubTools()).toEqual([])
  const messages = (await send("GET", `/api/session/${held.sessionID}/message`)).json.data as Array<{
    type: string
    error?: { type: string }
    time?: { completed?: number }
  }>
  expect(messages.find((message) => message.type === "assistant")?.time?.completed).toBeNumber()
  await action("ext-set-package-state", { packageId: "package:github", state: "enabled" })
  await until(async () => (await mcpStatus("github")) === "connected", "final connector reenable")
  const refreshBeforeRemove = refreshes
  expect(await invoke("ext-uninstall-package", "package:github")).toMatchObject({ ok: true })
  expect(
    await invoke("ext-reload-request", { scope: "global", items: [], reason: "uninstalled package package:github" }),
  ).toMatchObject({ ok: true })
  await until(async () => !(await mcpStatus("github")), "removed runtime connector")
  await until(async () => (await githubTools()).length === 0, "disabled GitHub tool inventory")
  expect(await githubTools()).toEqual([])
  const ledger = readPackageLedgerStateV1(root)
  expect(ledger.ok && ledger.packageGraphs.some((graph) => graph.packageId === "package:github")).toBe(false)
  expect(ledger.ok && ledger.packageGraphs.some((graph) => graph.packageId === "package:supabase")).toBe(true)
  expect(
    ledger.ok &&
      ledger.records.filter((record) => record.kind === "skill").every((record) => record.desiredState === "enabled"),
  ).toBe(true)
  expect(readFileSync(join(root, "codepuppy.jsonc"), "utf8").includes(TOKEN)).toBe(false)
  expect(JSON.stringify(await invoke("ext-installed-packages")).includes(TOKEN)).toBe(false)
  expect(JSON.stringify(consoleLines).includes(TOKEN)).toBe(false)
  expect(refreshes).toBeGreaterThanOrEqual(refreshBeforeRemove)
}, 180_000)

test("all package skills leave and return to the callable inventory and disappear on removal", async () => {
  const { readPackageLedgerStateV1 } = await import("./ext-receipt-v2")
  const before = readPackageLedgerStateV1(root)
  if (!before.ok || !before.packageGraphs.some((graph) => graph.packageId === "package:supabase"))
    await action("ext-install-package", "package:supabase")
  const names = ["supabase", "supabase-postgres-best-practices"]
  const packageSkills = async () => ((await send("GET", "/api/skill")).json.data as Array<{ name: string; content: string }>).filter((skill) => names.includes(skill.name))
  await until(async () => (await packageSkills()).length > 0, "installed skill inventory")
  expect((await packageSkills()).map((skill) => skill.name).sort()).toEqual(names)
  expect((await packageSkills()).every((skill) => skill.content.length > 20)).toBe(true)
  await action("ext-set-package-state", { packageId: "package:supabase", state: "disabled" })
  await until(async () => (await packageSkills()).length === 0, "all package skills disabled")
  expect(await packageSkills()).toEqual([])
  await until(async () => await mcpStatus("supabase") === "disabled", "disabled Supabase MCP read-back")
  expect(await mcpStatus("supabase")).toBe("disabled")
  await action("ext-set-package-state", { packageId: "package:supabase", state: "enabled" })
  await until(async () => (await packageSkills()).length === names.length, "all package skills reenabled")
  expect((await packageSkills()).map((skill) => skill.name).sort()).toEqual(names)
  expect((await packageSkills()).every((skill) => skill.content.length > 20)).toBe(true)
  expect(await invoke("ext-uninstall-package", "package:supabase")).toMatchObject({ ok: true })
  expect(await invoke("ext-reload-request", { scope: "global", items: [], reason: "uninstalled package package:supabase" })).toMatchObject({ ok: true })
  await until(async () => (await packageSkills()).length === 0 && !(await mcpStatus("supabase")), "all package runtime entries removed")
  expect(await packageSkills()).toEqual([])
  const after = readPackageLedgerStateV1(root)
  expect(after.ok && after.packageGraphs).toEqual([])
  expect(after.ok && after.records).toEqual([])
}, 60_000)

// `#1724`(签名 0.2.1 实测 19/20/21/28):远程连接器一旦进了引擎的启动配置(任何一次连接器刷新之后),整包移除只做
// 运行时 remove + 进程内重载 —— 重载按启动配置把它原样拉回,定制中心留下 `mcp:supabase` 卡片 16 分钟以上。
// 移除完成后引擎里不得再有它:不论重载还是换代,都不能把它带回来。
test("removing a package whose remote connector is in the engine launch config leaves no live connector", async () => {
  await action("ext-install-package", "package:supabase")
  expect(await refreshEngine()).toBe(true)
  await until(async () => !!(await mcpStatus("supabase")), "remote connector carried by the launch config")
  const requested = reloadRequests.length
  expect(await invoke("ext-uninstall-package", "package:supabase")).toMatchObject({ ok: true })
  expect(await invoke("ext-reload-request", { scope: "global", items: [], reason: "uninstalled package package:supabase" })).toMatchObject({ ok: true })
  await until(() => reloadRequests.length > requested, "removal reload requested")
  const pending = reloadRequests.slice(requested)
  await until(() => pending.every((request) => reloadReports.some((report) => report.generation === request.generation && report.outcome === "reloaded")), "removal reload reported")
  await until(async () => {
    const plugins = (await send("GET", "/api/plugin")).json.data as Array<{ id: string; state: { status: string } }>
    return plugins.some((plugin) => plugin.id === "codepuppy.ext" && plugin.state.status === "active")
  }, "engine ready after removal")
  await until(async () => !(await mcpStatus("supabase")), "removed remote connector stays gone")
  await Bun.sleep(500)
  expect(await mcpStatus("supabase")).toBeUndefined()
  if (refreshFailure) throw new Error(refreshFailure)
}, 60_000)

test("cloud-only package switch withdraws and restores real engine tools", async () => {
  const { syncSecretFiles } = await import("./codepuppy-secret-files")
  const { probe } = await import("../../test-component/codepuppy-engine")
  syncSecretFiles(host.userData, { CODEPUPPY_MCP_TOKEN: "invalid-local-cloud-r4", CODEPUPPY_API_KEY: "invalid-local-model-r4" })
  const tools = async () => (await probe().ctx.tool.list()).filter((tool: { options?: { namespace?: string } }) => tool.options?.namespace === "hub-cloud")
  await action("ext-install-package", "package:cloud-v1")
  await until(async () => await mcpStatus("hub-cloud") === "connected", "enabled cloud package connected")
  await until(async () => (await tools()).length > 0, "cloud tool inventory")
  expect((await tools()).length).toBeGreaterThan(0)
  await action("ext-set-package-state", { packageId: "package:cloud-v1", state: "disabled" })
  await until(async () => !(await mcpStatus("hub-cloud")) && (await tools()).length === 0, "disabled cloud runtime read-back")
  expect(await mcpStatus("hub-cloud")).toBeUndefined()
  expect(await tools()).toEqual([])
  await action("ext-set-package-state", { packageId: "package:cloud-v1", state: "enabled" })
  await until(async () => await mcpStatus("hub-cloud") === "connected", "cloud package re-enabled")
  await until(async () => (await tools()).length > 0, "cloud tool inventory")
  expect((await tools()).length).toBeGreaterThan(0)
})

test("package command switch withdraws and restores the real engine declaration", async () => {
  const commands = async () => (await send("GET", "/api/command")).json.data.map((command: { name?: string; id: string }) => command.name ?? command.id) as string[]
  await action("ext-install-package", "package:generic-bundle")
  await until(async () => (await commands()).includes("generic-bundle-command"), "enabled package command")
  expect(await commands()).toContain("generic-bundle-command")
  await action("ext-set-package-state", { packageId: "package:generic-bundle", state: "disabled" })
  expect(await commands()).not.toContain("generic-bundle-command")
  await action("ext-set-package-state", { packageId: "package:generic-bundle", state: "enabled" })
  await until(async () => (await commands()).includes("generic-bundle-command"), "re-enabled package command read-back")
  expect(await commands()).toContain("generic-bundle-command")
})

// Codex R1 #2(I-11,design v9 §5 第 3 步 / G-29):开启的持久写已发布「开」、窗口里建了一个 Location、随后配置写失败
// 回滚 —— 经生产 IPC,失败结果同样请求收敛,那个 Location 最终为关。进程内引擎无法在 main 的同步写窗口里建 Location,
// 所以窗口留下的状态由窗口自己会做的同一组生产账本写造出来(发布「开」→ 建 Location → 发布回滚,中间不收敛)。
test("I-11 R1 #2: a Location built while a failed enable had published 'on' ends off once the production IPC failure converges", async () => {
  const fs = await import("node:fs")
  const { spyOn } = await import("bun:test")
  const { findRecordV2, setDesiredStateV2, upsertRecordV2 } = await import("./ext-receipt-v2")
  const { restoreMcpLeaf } = await import("./ext-config")
  const { MCP_FIXTURE } = await import("../../test-component/codepuppy-engine")
  const name = "window-probe"
  expect(restoreMcpLeaf(name, { type: "local", command: [process.execPath, MCP_FIXTURE], enabled: false }).ok).toBe(true)
  expect(upsertRecordV2(root, {
    id: `user:${name}`, name, kind: "mcp", environment: "dev", scope: { kind: "global" },
    desiredState: "disabled", origin: "created", configKey: `mcp.${name}`, installedAt: "2026-11-18T00:00:00.000Z",
  }).ok).toBe(true)
  const later = join(sandbox.root, "window-location")
  fs.mkdirSync(later, { recursive: true })
  const at = (method: string, route: string, body?: unknown) => running!.fetch(new Request(`http://codepuppy-sidecar.invalid${route}`, {
    method, headers: { "x-opencode-directory": encodeURIComponent(later), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  const statusInLater = async () => ((await (await at("GET", "/api/mcp")).json()).data as Array<{ name: string; status: { status: string } }>)
    .find((entry) => entry.name === name)?.status.status
  expect(setDesiredStateV2(root, "mcp", name, "enabled").ok).toBe(true)
  await at("POST", "/api/session", { location: { directory: later }, model: { id: "m", providerID: "codepuppy" } })
  await until(async () => (await statusInLater()) === "connected", "Location built inside the window connects")
  expect(setDesiredStateV2(root, "mcp", name, "disabled").ok).toBe(true)
  await Bun.sleep(500)
  expect(await statusInLater()).toBe("connected")
  // Production IPC: enable → ledger and allow-set publish "on" → the config write fails → ledger rolled back to off.
  const rename = fs.renameSync
  let failed = 0
  const failing = spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (String(to) === join(root, "codepuppy.jsonc") && failed++ === 0) throw new Error("injected config write failure")
    return rename(from, to)
  })
  let result: unknown
  try {
    result = await invoke("ext-set-install-state", { type: "mcp", name, scope: "global", state: "enabled" })
  } finally {
    failing.mockRestore()
  }
  expect(failed).toBe(1)
  expect(result).toMatchObject({ ok: false })
  expect(findRecordV2(root, "mcp", name)?.desiredState).toBe("disabled")
  await until(async () => (await statusInLater()) === "disabled", "the window's Location converged off after the failed write")
}, 120_000)
