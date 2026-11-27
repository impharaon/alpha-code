// Windowless measurement host for the paid real-engine document acceptance runs (#1761, plan 切片八「AC-01..03 实测」).
//
// Runs as an Electron MAIN process from an LSUIElement copy of the dev Electron.app (prepared by ../document-quality-run.ts):
// no BrowserWindow, no URL scheme, no Dock icon. It calls the product's own startup functions for the document chain in
// index.ts order, then the product's `spawnLocalServer` (real utilityProcess sidecar, process fence, egress proxy,
// `openDocumentGeneration`, launcher Node, pinned-file entry) and drives sessions over the engine's HTTP API. Two stated
// differences from the desktop app (plan): the index.ts boot steps that do not take part in document output (DB preflight,
// extension ledger, desktop IPC) are not run, and the service-only test key enters the credential-file channel directly
// instead of through the auth module (same gateway, same account, same billing).
//
// Input: the JSON file named by DOCUMENT_QUALITY_INPUT (HostInput). The test key is read in-process from `keyFile` and never
// printed or written to the evidence. Exit codes: 0 done, 2 failure (the dry run must end here), 3 stopped by the projection,
// 4 stopped by the spending cap.
import { app } from "electron"
import { execFile } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { basename, dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { DOCUMENT_WORK_DIR } from "../../../util/src/codepuppy-document"
import { runBootDanglingSweep } from "../../src/main/boot-dangling-sweep"
import { catalogRegistryChannel, initCodePuppyEnvironment } from "../../src/main/codepuppy-environment"
import { endpointRouteRef, initEndpoints, preferredEndpoints } from "../../src/main/codepuppy-endpoints"
import platformModels from "../../src/main/codepuppy-models.json"
import { CHANNEL } from "../../src/main/constants"
import { creditDanglingSweepForSpawn } from "../../src/main/dangling-sweep-latch"
import { engineDataDir } from "../../src/main/data-clear"
import { documentBootstrap } from "../../src/main/document-resources"
import type { EngineConnection } from "../../src/main/engine-authorization"
import { engineClient, type EngineClient } from "../../src/main/engine-client"
import { reconcileEngineConfigTruth } from "../../src/main/engine-config-truth-boot"
import { ensureEngineScratchCwd } from "../../src/main/engine-scratch-cwd"
import { registerExtIpcHandlers } from "../../src/main/ext-ipc"
import { resourcesRoot } from "../../src/main/ext-fs-installer"
import { factorySkillSources, reconcileFactorySkills, setFactorySkillDirsForFork } from "../../src/main/factory-skills"
import { readCatalogSnapshot } from "../../src/main/codepuppy-live-allowlist"
import { syncLiveAllowlist } from "../../src/main/codepuppy-platform-models"
import { initLogging } from "../../src/main/logging"
import { readPinnedFiles } from "../../src/main/pinned-files"
import { preferAppEnv, spawnLocalServer, startupShellProbeFence } from "../../src/main/server"
import { USER_DATA_LAYOUT } from "../../src/main/user-data-layout"
import { CODEPUPPY_PATHS } from "../../src/shared/codepuppy-config"
import { prepareDocumentProfile } from "../../src/shared/document-runtime-fonts"

export type HostInput = {
  /** Absolute evidence root; every data root of this host lives below it. */
  evidence: string
  /** Absolute path of the service-only test key; read here only. */
  keyFile: string
  /** Task texts, assets and scorers (this directory in the repository). */
  materials: string
  /** Run ids in order; the first letter is the task key in materials/tasks.json. */
  runs: string[]
  /** Run after which the nine-run projection is checked before continuing. */
  sample?: string
  capFen: number
  /** Highest per-run cost already observed for these tasks (pilot), used until this host has seen a higher one. */
  priorMaxRunFen: number
  runTimeoutMinutes: number
  /** The desktop's discovered endpoints (non-secret); what a login persists. */
  endpoints: { schema_version: 1; web: string; platform: string; account: string; cloud: string; mcp: string }
  dryRun: boolean
}

type Task = { assets: string[]; assets_note: string; user: string }
type RunRecord = Record<string, unknown> & { run: string; costFen?: number }

// An uncaught main-process error would raise Electron's error dialog on the owner's screen: log and exit instead.
process.on("uncaughtException", (error) => finish(error))
process.on("unhandledRejection", (error) => finish(error))
const input = JSON.parse(readFileSync(process.env.DOCUMENT_QUALITY_INPUT!, "utf8")) as HostInput
const E = input.evidence
const userData = join(E, "userData")
for (const dir of ["appData", "userData", "session", "electron-logs", "runs"]) mkdirSync(join(E, dir), { recursive: true })
app.setName("Code Puppy document quality host")
app.setPath("appData", join(E, "appData"))
app.setPath("userData", userData)
app.setPath("sessionData", join(E, "session"))
app.setPath("logs", join(E, "electron-logs"))
app.dock?.hide()

const hostLog = join(E, "host.log")
const log = (line: string) => {
  const stamped = `${new Date().toISOString()} ${line}`
  console.log(stamped)
  appendFileSync(hostLog, stamped + "\n")
}
const execute = promisify(execFile)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")
const writeJson = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 1))
/** The model route the product published for the engine: "preferred" (HK entry) or "direct"; none when no relay is configured. */
const route = () => {
  const ref = endpointRouteRef()
  return ref && existsSync(ref.slice(6, -1)) ? readFileSync(ref.slice(6, -1), "utf8") : "preferred (no relay route)"
}

class Stop extends Error {
  constructor(readonly code: number, message: string) {
    super(message)
  }
}

// ── account reads (free) ─────────────────────────────────────────────────────────────────────────────
let key = ""
async function account(path: string) {
  let last: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(input.endpoints.account + path, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(60_000) })
      if (!response.ok) throw new Stop(2, `account read ${path.split("?")[0]} failed: HTTP ${response.status}`)
      return (await response.json()) as Record<string, unknown>
    } catch (error) {
      if (error instanceof Stop) throw error
      last = error
      await sleep(3000 * (attempt + 1))
    }
  }
  throw new Stop(2, `account read ${path.split("?")[0]} unreachable: ${String(last)}`)
}
async function balance(): Promise<number> {
  const summary = await account("/v1/account/summary")
  const value = summary.balanceFen ?? (summary.wallet as { balanceFen?: unknown } | undefined)?.balanceFen
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Stop(2, "account summary has no integer balanceFen")
  return value
}
type Fact = { seq: number; kind: string; amount: number; created_at: number; action_id?: string; reservation_id?: string }
/** Ledger facts with seq > after, oldest first. */
async function facts(after: number): Promise<Fact[]> {
  const collected: Fact[] = []
  let before: number | undefined
  for (;;) {
    const page = await account(`/v1/billing/transactions?limit=500${before ? `&before=${before}` : ""}`)
    const items = (page.transactions as Fact[] | undefined) ?? []
    collected.push(...items.filter((item) => item.seq > after))
    if (!items.length || items.length < 500 || Math.min(...items.map((item) => item.seq)) <= after) break
    before = Math.min(...items.map((item) => item.seq))
  }
  return collected.sort((a, b) => a.seq - b.seq)
}
/** Balance once the account stops moving (holds released): two equal reads 20 s apart, at most ~3 minutes. */
async function settledBalance() {
  let previous = await balance()
  for (let attempt = 0; attempt < 9; attempt++) {
    await sleep(20_000)
    const current = await balance()
    if (current === previous) return current
    previous = current
  }
  return previous
}

// ── boot: the product's own functions, index.ts order (no window, no desktop IPC, no extension ledger) ──────────
async function boot() {
  process.chdir(ensureEngineScratchCwd(userData))
  const logger = initLogging()
  initCodePuppyEnvironment({ isPackaged: false, channel: CHANNEL, appDataDir: app.getPath("appData"), baseRoot: join(E, "codepuppy-state") })
  // What a login persists: the endpoints alpha-web discovered for the desktop (non-secret, copied by the launcher).
  writeJson(join(userData, USER_DATA_LAYOUT.discoveredEndpoints), input.endpoints)
  initEndpoints(userData, (error) => log(`endpoint contract failure: ${String(error)}`), (line) => log(`[endpoints] ${line}`))
  preferAppEnv(userData, await startupShellProbeFence())
  for (const name of ["HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "CODEPUPPY_USER_WORKSPACE_DIR"])
    if (!process.env[name]?.startsWith(E)) throw new Stop(2, `${name} left the evidence root after the shell environment merge`)
  await app.whenReady()
  // The platform model catalog a first launch downloads before the engine lists platform models (catalog-refresher's round). The
  // gateway narrows it by the bearer's edition; this host has no auth-module token, so it gets the unauthenticated list, whose
  // edition (cn) is the test tenant's own.
  await syncLiveAllowlist(userData)
  const catalog = readCatalogSnapshot(userData)
  if (!catalog) throw new Stop(2, "platform model catalog could not be downloaded")
  log(`platform catalog fetched ${catalog.fetchedAt}`)
  if (input.dryRun) {
    // The product's endpoint overrides point the model proxy and cloud MCP at a closed loopback port. An override also turns off
    // the relay/direct fallback (codepuppy-endpoints.ts relayConfigured), so no model request can reach a paid gateway.
    process.env.CODEPUPPY_PLATFORM_URL = "http://127.0.0.1:9"
    process.env.CODEPUPPY_CLOUD_URL = "http://127.0.0.1:9"
    process.env.CODEPUPPY_MCP_URL = "http://127.0.0.1:9/mcp"
  }
  // In place of initAuthEnv (the service-only key is not a purpose token): the same variables applyAuthEnv derives.
  const endpoints = preferredEndpoints()
  process.env.CODEPUPPY_BASE_URL = `${endpoints.platform}${CODEPUPPY_PATHS.modelProxy}`
  process.env.CODEPUPPY_CLOUD_MCP_URL = endpoints.mcp ?? `${endpoints.cloud}${CODEPUPPY_PATHS.mcpGateway}`
  process.env.CODEPUPPY_API_KEY = key
  process.env.CODEPUPPY_CLOUD_TOKEN = key
  process.env.CODEPUPPY_MCP_TOKEN = key
  log(`model proxy ${process.env.CODEPUPPY_BASE_URL} · cloud mcp ${process.env.CODEPUPPY_CLOUD_MCP_URL}`)
  const factory = reconcileFactorySkills(factorySkillSources({ packaged: false, resourcesPath: process.resourcesPath, moduleDir: dirname(fileURLToPath(import.meta.url)) }))
  setFactorySkillDirsForFork(factory.paths)
  log(`factory skills: ${factory.paths.length} dirs; skipped ${JSON.stringify(factory.skipped)}`)
  const truth = reconcileEngineConfigTruth(logger, { factorySkillDirs: [] })
  if (!truth.skipped && truth.bailedOut) throw new Stop(2, `engine config reconcile bailed out: ${truth.bailedOut}`)
  const dangling = runBootDanglingSweep({ userDataPath: userData, engineDataPath: engineDataDir(process.env, homedir()), log: logger })
  if (dangling.enforcementGap.length) throw new Stop(2, `dangling sweep gap: ${dangling.enforcementGap.join("; ")}`)
  creditDanglingSweepForSpawn()
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))))
    })
  })
  const password = randomBytes(24).toString("hex")
  // ext answers its hub requests (native source sync, plugin inventory) only through main's sidecar host; index.ts gets it
  // here. Its IPC handlers stay unused without a window; the official-runtime callbacks have no respawn queue to reach.
  const serverReady = Promise.withResolvers<EngineConnection>()
  let listener: Awaited<ReturnType<typeof spawnLocalServer>>["listener"] | undefined
  const ext = registerExtIpcHandlers(userData, catalogRegistryChannel(), () => serverReady.promise, homedir(), { stop: async () => {}, refresh: async () => false }, (directory) => listener?.projectConfigView(directory) ?? Promise.resolve(undefined))
  await ext.ledgerReady
  const sidecarLog = join(E, "sidecar.log")
  const spawned = await spawnLocalServer("127.0.0.1", port, password, {
    userDataPath: userData,
    generation: 1,
    timelineContext: "boot",
    codepuppySidecar: ext.codepuppySidecar,
    connectorCatalogs: ext.connectorCatalogs,
    connectorWorkspace: ext.connectorWorkspace,
    onStdout: (line) => appendFileSync(sidecarLog, line + "\n"),
    onStderr: (line) => appendFileSync(sidecarLog, line + "\n"),
    onExit: (code) => log(`sidecar exited with code ${code}`),
  })
  listener = spawned.listener
  await spawned.health.wait
  serverReady.resolve({ url: `http://127.0.0.1:${port}`, username: null, password })
  if (spawned.injectionFailure) throw new Stop(2, `config injection failed: ${spawned.injectionFailure.message}`)
  log(`engine ready on 127.0.0.1:${port} · fence ${spawned.fence ?? "none"}`)
  const documents = documentBootstrap({ userData, resourcesRoot: resourcesRoot(), packaged: false, platform: process.platform, manifest: readPinnedFiles() })
  return { client: engineClient({ url: `http://127.0.0.1:${port}`, username: null, password }), listener: spawned.listener, documents }
}

// ── one session: send the task text, answer engine asks like a user who approves, wait for the end ───────────────
async function converse(client: EngineClient, directory: string, text: string, record: RunRecord, guard: () => Promise<void>) {
  const model = (await client.model.default({ location: { directory } })).data
  if (!model || model.providerID !== "codepuppy" || model.id !== platformModels.defaultPlatformModel)
    throw new Stop(2, `default model is ${model ? `${model.providerID}/${model.id}` : "none"}, expected codepuppy/${platformModels.defaultPlatformModel}`)
  const session = await client.session.create({ location: { directory }, model: { id: model.id, providerID: model.providerID } })
  record.sessionID = session.id
  record.model = `${model.providerID}/${model.id}`
  const asks: unknown[] = []
  record.asks = asks
  const events = new AbortController()
  const connected = Promise.withResolvers<void>()
  // A long run outlives one event stream; resubscribe until the run ends so no ask is left unanswered.
  const reader = (async () => {
    while (!events.signal.aborted) {
      try {
        for await (const event of client.event.subscribe({ types: ["permission.asked", "form.created"], signal: events.signal })) {
          if (event.type === "server.connected") connected.resolve()
          if (event.type === "permission.asked" && event.data.sessionID === session.id) {
            asks.push({ kind: "permission", action: event.data.action, resources: event.data.resources })
            await client.permission.reply({ sessionID: session.id, requestID: event.data.id, decision: "once" })
          }
          if (event.type === "form.created" && event.data.form.sessionID === session.id) {
            asks.push({ kind: "form", title: event.data.form.title })
            await client.session.form.cancel({ sessionID: session.id, formID: event.data.form.id, message: "按你的判断继续，不用再问我。" })
          }
        }
      } catch (error) {
        if (events.signal.aborted) break
        log(`${record.run}: event stream ended (${String(error)}); resubscribing`)
        await sleep(2000)
      }
    }
  })()
  await Promise.race([connected.promise, sleep(30_000).then(() => Promise.reject(new Stop(2, "engine event stream did not connect within 30 s")))])
  const started = Date.now()
  record.startedAt = new Date(started).toISOString()
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), input.runTimeoutMinutes * 60_000)
  let stopped: Stop | undefined
  const watch = setInterval(() => {
    void guard().catch((error) => {
      if (error instanceof Stop && !stopped) {
        stopped = error
        log(`${record.run}: ${error.message} — interrupting`)
        deadline.abort()
      }
    })
  }, 60_000)
  try {
    await client.session.prompt({ sessionID: session.id, text })
    // One wait request does not outlive the HTTP client's header timeout on a long run, and idle can be observed before the
    // delivered prompt starts executing: wait again until an assistant turn exists, the deadline passes or the cap stops it.
    for (;;) {
      try {
        await client.experimental.session.wait({ sessionID: session.id }, { signal: deadline.signal })
      } catch (error) {
        if (deadline.signal.aborted) {
          record.timedOut = !stopped
          await client.session.interrupt({ sessionID: session.id })
          break
        }
        log(`${record.run}: wait returned without idle (${String(error)}); waiting again`)
        await sleep(5000)
        continue
      }
      const latest = await client.message.list({ sessionID: session.id, order: "desc", limit: 20 })
      if (latest.data.some((message) => message.type === "assistant")) break
      await sleep(5000)
    }
  } finally {
    clearTimeout(timer)
    clearInterval(watch)
    record.minutes = Math.round((Date.now() - started) / 600) / 100
    events.abort()
    await reader
  }
  const messages: unknown[] = []
  for (let cursor: string | undefined; ; ) {
    // The engine's cursor carries the order; the two are not accepted together.
    const page = await client.message.list(cursor ? { sessionID: session.id, cursor, limit: 200 } : { sessionID: session.id, order: "asc", limit: 200 })
    messages.push(...page.data)
    cursor = page.cursor.next ?? undefined
    if (!cursor || !page.data.length) break
  }
  record.transcript = summarize(messages)
  if (stopped) throw stopped
  return messages
}

function summarize(messages: unknown[]) {
  const tools: Record<string, number> = {}
  const documentActions: Record<string, number> = {}
  const errors: string[] = []
  let assistantTurns = 0
  let finalText = ""
  let inputTokens = 0
  let outputTokens = 0
  for (const message of messages as Array<Record<string, any>>) {
    if (message.type !== "assistant") continue
    assistantTurns++
    if (message.error) errors.push(JSON.stringify(message.error).slice(0, 400))
    inputTokens += message.tokens?.input ?? 0
    outputTokens += message.tokens?.output ?? 0
    const text = (message.content as Array<Record<string, any>>).filter((part) => part.type === "text").map((part) => part.text).join("")
    if (text.trim()) finalText = text
    for (const part of message.content as Array<Record<string, any>>) {
      if (part.type !== "tool") continue
      tools[part.name] = (tools[part.name] ?? 0) + 1
      if (part.state?.status === "error") errors.push(`${part.name}: ${JSON.stringify(part.state.error ?? part.state).slice(0, 300)}`)
      if (part.name === "codepuppy_document") {
        const action = String(part.state?.input?.action ?? "?")
        documentActions[action] = (documentActions[action] ?? 0) + 1
      }
    }
  }
  return { assistantTurns, tools, documentActions, errors, inputTokens, outputTokens, finalText: finalText.slice(-1500) }
}

// ── scoring: product LO render (page count, page images), product OfficeExcel.recalculate, the committed scorers ─────
async function python(documents: ReturnType<typeof documentBootstrap>, args: string[], env: Record<string, string> = {}) {
  const { stdout, stderr } = await execute(documents.python, ["-I", "-B", ...args], { env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 600_000 })
  return { stdout, stderr }
}
/** The live projection file of an active document Location registration; the run's own one first. */
function projection(documents: ReturnType<typeof documentBootstrap>, directory: string) {
  const root = join(documents.documentRuntimeRoot, "python-host")
  const candidates: Array<{ path: string; value: Record<string, any> }> = []
  for (const generation of existsSync(root) ? readdirSync(root) : [])
    for (const registration of readdirSync(join(root, generation))) {
      const path = join(root, generation, registration, "host.json")
      if (!existsSync(path)) continue
      const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>
      if (value.status === "active") candidates.push({ path, value })
    }
  return candidates.find((entry) => entry.value.location?.directory === directory) ?? candidates[0]
}
async function render(documents: ReturnType<typeof documentBootstrap>, source: string, kind: string, out: string, runtime: { executable: string; version: string }) {
  const job = join(out, `render-${kind}`)
  const profileRoot = join(out, `render-profile-${kind}`)
  mkdirSync(job, { recursive: true })
  prepareDocumentProfile({ assets: documents.assets, jobRoot: profileRoot, platform: "darwin", home: homedir() })
  writeJson(join(job, "render.json"), { kind, source, sourceSha256: sha256(source), dpi: 96, profileRoot, executable: runtime.executable, version: runtime.version })
  const result = JSON.parse((await python(documents, [documents.render, job])).stdout) as Record<string, any>
  if (result.status !== "rendered") throw new Error(`render failed: ${result.code}: ${result.detail}`)
  return result as { pageCount: number; pages: Array<{ path: string }>; rendererVersion: string }
}
function deliverable(task: Task, directory: string) {
  const named = /保存为\s*([\w.-]+\.(docx|pptx|xlsx))/.exec(task.user)
  if (!named) throw new Stop(2, "task text names no Office deliverable")
  const extension = named[2]
  if (existsSync(join(directory, named[1]!))) return { file: join(directory, named[1]!), named: true }
  const found = readdirSync(directory)
    .filter((name) => extname(name) === `.${extension}` && !name.startsWith("~$"))
    .map((name) => join(directory, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return found[0] ? { file: found[0], named: false } : undefined
}
async function score(documents: ReturnType<typeof documentBootstrap>, task: Task, directory: string, out: string, record: RunRecord) {
  const found = deliverable(task, directory)
  if (!found) {
    record.score = { deliverable: null }
    return
  }
  mkdirSync(out, { recursive: true })
  const kind = extname(found.file).slice(1)
  const copy = join(out, basename(found.file))
  copyFileSync(found.file, copy)
  const live = projection(documents, directory)
  if (!live || live.value.runtime?.phase !== "ready") throw new Stop(2, `no ready document runtime projection to score with (${live?.value.runtime?.phase ?? "none"})`)
  const runtime = live.value.runtime as { executable: string; version: string }
  const rendered = await render(documents, copy, kind, out, runtime)
  const result: Record<string, unknown> = { deliverable: found.file, expectedName: found.named, sha256: sha256(copy), pages: rendered.pageCount, pageImages: rendered.pages.map((page) => page.path), renderer: rendered.rendererVersion }
  if (kind === "docx") {
    const checklist = JSON.parse((await python(documents, [join(input.materials, "score_docx.py"), copy, String(rendered.pageCount)])).stdout)
    writeJson(join(out, "checklist.json"), checklist)
    Object.assign(result, { score: checklist._score, of: 10, items: items(checklist) })
  }
  if (kind === "pptx") {
    const checklist = JSON.parse((await python(documents, [join(input.materials, "score_pptx.py"), copy])).stdout)
    writeJson(join(out, "checklist.json"), checklist)
    Object.assign(result, { score: checklist._score, of: 11, items: items(checklist) })
  }
  if (kind === "xlsx") {
    const recalculated = join(out, `recalculated-${basename(found.file)}`)
    copyFileSync(found.file, recalculated)
    const receipt = JSON.parse((await python(documents, [documents.recalculate, recalculated], { CODEPUPPY_DOCUMENT_HOST: live.path })).stdout) as Record<string, unknown>
    writeJson(join(out, "recalculate-receipt.json"), receipt)
    const printed = await python(documents, [join(input.materials, "check_xlsx.py"), copy, recalculated, join(out, "recalculate-receipt.json"), out])
    writeFileSync(join(out, "check.txt"), printed.stdout)
    const check = JSON.parse(readFileSync(join(out, "check.json"), "utf8")) as Record<string, any>
    Object.assign(result, { score: check._score, of: 12, items: items(check.checklist), recalc: receipt.status, formulaCount: receipt.formulaCount, formulaErrors: check.formula_errors, summaryMatch: check.summary_match, values: { region: `${check.values.region_ok}/${check.values.region_n}`, month: `${check.values.month_ok}/${check.values.month_n}`, growth: `${check.values.growth_ok}/${check.values.growth_n}` } })
  }
  record.score = result
}
function items(checklist: Record<string, any>) {
  return Object.fromEntries(Object.entries(checklist).filter(([name]) => !name.startsWith("_")).map(([name, value]) => [name, value.status]))
}

// ── LibreOffice readiness before the first measured run (the product's own ensure path, started by one cheap turn) ──
async function waitForRuntime(documents: ReturnType<typeof documentBootstrap>, directory: string) {
  for (let minute = 0; minute < 60; minute++) {
    const live = projection(documents, directory)
    const phase = live?.value.runtime?.phase
    if (phase === "ready") return live!.value.runtime
    if (phase === "failed") throw new Stop(2, `LibreOffice preparation failed: ${JSON.stringify(live!.value.runtime.failure)}`)
    if (!live && minute >= 3) throw new Stop(2, "LibreOffice preparation never started: the warm-up turn did not ask for the document environment")
    log(`LibreOffice: ${phase ?? "not started"} ${live?.value.runtime?.stage ?? ""}`)
    await sleep(60_000)
  }
  throw new Stop(2, "LibreOffice did not become ready within 60 minutes")
}

async function main() {
  key = readFileSync(input.keyFile, "utf8").trim()
  if (!key) throw new Stop(2, "test key file is empty")
  const { client, listener, documents } = await boot()
  const tasks = JSON.parse(readFileSync(join(input.materials, "tasks.json"), "utf8")) as Record<string, Task>
  const start = await balance()
  const startFacts = await facts(0)
  const startSeq = startFacts.length ? startFacts[startFacts.length - 1]!.seq : 0
  log(`balance at start ${start} fen · ledger seq ${startSeq} · cap ${input.capFen} fen`)
  const records: RunRecord[] = []
  const spent = async () => start - (await balance())
  const guard = async () => {
    const value = await spent()
    if (value >= input.capFen) throw new Stop(4, `cumulative spend ${value} fen reached the cap ${input.capFen} fen`)
  }
  const workspace = process.env.CODEPUPPY_USER_WORKSPACE_DIR!
  try {
    if (!input.dryRun) {
      const directory = join(workspace, "runtime-warmup")
      mkdirSync(directory, { recursive: true })
      const record: RunRecord = { run: "runtime-warmup" }
      const before = await balance()
      await converse(client, directory, "请只调用一次 codepuppy_document 工具（action 为 environment），然后回复“好了”。不要读取、创建或修改任何文件。", record, guard)
      record.runtime = await waitForRuntime(documents, directory)
      record.costFen = before - (await settledBalance())
      writeJson(join(E, "runs", "runtime-warmup.json"), record)
      log(`runtime warm-up: LibreOffice ${JSON.stringify(record.runtime)} · ${record.costFen} fen`)
    }
    for (const run of input.runs) {
      const task = tasks[run[0]!]
      if (!task) throw new Stop(2, `no task ${run[0]} in tasks.json`)
      const maxSeen = Math.max(input.priorMaxRunFen, ...records.map((entry) => entry.costFen ?? 0))
      const already = await spent()
      if (already + maxSeen > input.capFen) throw new Stop(4, `not starting ${run}: spent ${already} + highest run ${maxSeen} > cap ${input.capFen} fen`)
      const directory = join(workspace, run)
      mkdirSync(directory, { recursive: true })
      for (const asset of task.assets) copyFileSync(join(input.materials, basename(asset)), join(directory, basename(asset)))
      const record: RunRecord = { run }
      records.push(record)
      const before = await balance()
      record.balanceBefore = before
      const windowStart = Date.now()
      record.routeAtStart = route()
      log(`${run}: start · balance ${before} fen · route ${record.routeAtStart}`)
      try {
        await converse(client, directory, task.user, record, guard)
      } finally {
        record.routeAtEnd = route()
        record.balanceAfter = await settledBalance()
        record.costFen = before - (record.balanceAfter as number)
        const ledger = (await facts(startSeq)).filter((fact) => fact.created_at >= windowStart - 5_000)
        record.ledger = {
          settledFen: -ledger.filter((fact) => fact.kind === "usage_settled").reduce((sum, fact) => sum + fact.amount, 0),
          requests: ledger.filter((fact) => fact.kind === "reservation_created").reduce<Record<string, number>>((count, fact) => ({ ...count, [fact.action_id ?? "?"]: (count[fact.action_id ?? "?"] ?? 0) + 1 }), {}),
        }
        writeJson(join(E, "runs", `${run}.json`), record)
      }
      const transcript = record.transcript as ReturnType<typeof summarize>
      if (input.dryRun || transcript.errors.length && !deliverable(task, directory)) {
        writeJson(join(E, "runs", `${run}.json`), record)
        throw new Stop(2, `${run}: the session ended with errors and no deliverable: ${transcript.errors.slice(0, 3).join(" | ")}`)
      }
      // A scoring failure must not cost the remaining paid runs: the deliverable, the recalculated copy and the receipt stay in
      // the evidence for an offline rerun of the committed scorer.
      await score(documents, task, directory, join(E, "runs", run, "score"), record).catch((error) => {
        if (error instanceof Stop) throw error
        record.scoreError = error instanceof Error ? error.message : String(error)
        log(`${run}: scoring failed: ${record.scoreError}`)
      })
      writeJson(join(E, "runs", `${run}.json`), record)
      log(`${run}: ${JSON.stringify({ cost: record.costFen, minutes: record.minutes, score: (record.score as any)?.score, of: (record.score as any)?.of, pages: (record.score as any)?.pages })}`)
      if (run === input.sample) {
        const used = await spent()
        const remaining = input.runs.length - input.runs.indexOf(run) - 1
        const projected = used + remaining * Math.max(record.costFen ?? 0, input.priorMaxRunFen)
        writeJson(join(E, "projection.json"), { after: run, spentFen: used, sampleFen: record.costFen, remainingRuns: remaining, perRunFen: Math.max(record.costFen ?? 0, input.priorMaxRunFen), projectedFen: projected, capFen: input.capFen })
        log(`projection after ${run}: spent ${used} + ${remaining} × ${Math.max(record.costFen ?? 0, input.priorMaxRunFen)} = ${projected} fen (cap ${input.capFen})`)
        if (projected > input.capFen) throw new Stop(3, `projected ${projected} fen exceeds the cap ${input.capFen} fen`)
      }
    }
    return 0
  } finally {
    writeJson(join(E, "summary.json"), { balanceStart: start, balanceEnd: await balance().catch(() => null), runs: records.map((entry) => ({ run: entry.run, costFen: entry.costFen, minutes: entry.minutes, score: entry.score })) })
    await listener.stop().catch(() => {})
  }
}

let finished = false
function finish(outcome: number | unknown) {
  if (finished) return
  finished = true
  const exitCode = typeof outcome === "number" ? outcome : outcome instanceof Stop ? outcome.code : 2
  try {
    if (typeof outcome !== "number") log(`STOP ${exitCode}: ${outcome instanceof Error ? outcome.stack ?? outcome.message : String(outcome)}`)
    // The product writes the credentials into userData/codepuppy-secrets for the sidecar; they do not stay in the evidence.
    rmSync(join(userData, "codepuppy-secrets"), { recursive: true, force: true })
    log(`exit ${exitCode}`)
  } catch (error) {
    console.error(`host cleanup failed: ${String(error)}`)
  } finally {
    // app.exit has been seen to leave this windowless process parked in Electron's shutdown; the launcher reads the code
    // from this file and ends the process if it is still there after a grace period.
    writeFileSync(join(E, "host-exit.json"), JSON.stringify({ code: exitCode }))
    app.exit(exitCode)
  }
}
main().then(finish, finish)
