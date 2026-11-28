// SPEC child-process-write-fence v7 AC-13 (design v6 §6 evidence 1–4, 7) on the real chain: a scripted model sends a real
// assistant `shell` call (`CP-CALL`), the agent loop runs it through Tool.execute, the ext wrapper and the original gate,
// under the production-rendered fence and real native module; the production main listener answers R6 and grants
// through the real tracker and R4 (`createDirectoryWriteApproval`). The card is answered here as the renderer does:
// R4 describe + approve, then the engine's reply. Electron transport is substituted (Node IPC, as in
// project-writable.engine.cases.ts). Run only through directory-write-approval.engine.scenario.test.ts.
// SPEC v8 AC-14 (design v7 §6 evidence 1–12) on the same chain: main's HOME is the test HOME (inside the worktree cache, not
// under /tmp or the system temp roots the profile writes); a new path directly in it is asked for, granted and carried.
import { afterAll, beforeAll, expect, mock, test } from "bun:test"
import { execFileSync, fork } from "node:child_process"
import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildFenceAddon } from "../../scripts/build-fence-addon"
import { mockElectron } from "../../test-component/electron-mock"
import { scriptedModel, textOf } from "../../test-component/codepuppy-engine"
import { LOCAL_SIDECAR_SERVER_KEY, renderProcessFenceProfile, resolveEngineRoots } from "./process-fence-profile"
import { planConfigFence, planCredentialStores, planProcessFence } from "./process-fence-plan"
import { trialCompileProfile } from "./process-fence-compile"
import { credentialStores } from "./codepuppy-secret-files"
import { toV1PermissionRequest } from "../engine-adapter/opencode2/v1-shapes"
import { permissionV1Fingerprint } from "../../../codepuppy-app/src/context/permission-v1-adapter"
import { WRITE_APPROVED_RETRY_NOTE, WRITE_REFUSED_NOTE } from "../../../ext/src/context-injection"

const run = process.env.CODEPUPPY_APPROVAL_TEST_ROOT!
// The project the user opened (W1), the engine's install (W3), and main's HOME / app state root: real directories,
// none of them under another's writable root, so every refusal below is the fence's own.
const P = join(run, "project"), install = join(run, "engine-install"), home = join(run, "home"), stateRoot = join(run, "state"), userData = join(run, "main-user-data")
const userConfig = join(run, "user-config", "opencode")
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
const log: string[] = []
const appEvents = new EventEmitter()
mockElectron(() => ({
  app: { isPackaged: false, getPath: () => userData, getVersion: () => "0.2.5-test", on: appEvents.on.bind(appEvents), off: appEvents.off.bind(appEvents), once: appEvents.once.bind(appEvents) },
  ipcMain: { handle: () => {}, on: () => {} },
  BrowserWindow: class {}, utilityProcess: { fork: () => { throw new Error("unexpected fork") } }, dialog: {},
}))
mock.module("./windows", () => ({ createMainWindow: () => {}, getPinchZoomEnabled: () => false, setPinchZoomEnabled: () => {}, setTitlebar: () => {}, updateTitlebar: () => {} }))
mock.module("./logging", () => ({ getLogger: () => ({ log: (line: unknown) => { log.push(String(line)) }, warn: (line: unknown) => { log.push(String(line)) }, error: (line: unknown) => { log.push(String(line)) } }), write: () => {}, rotateServerLogs: () => {} }))
mock.module("./store", () => ({ getStore: () => ({ get: () => null, set: () => {}, delete: () => {}, clear: () => {} }) }))
mock.module("./codepuppy-keychain-backend", () => ({ keychainBackend: () => ({ isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() }) }))
const { spawnLocalServer } = await import("./server")
const { bootFenceWorkspaceTruth, readWorkspaceTruthOrThrow, writeWorkspaceTruth } = await import("./process-fence-workspaces")
const { createDirectoryWriteApproval } = await import("./directory-write-approval")
const { createCodePuppySidecarHost } = await import("./hub-view")
const { creditDanglingSweepForSpawn, resetDanglingSweepLatchForTests } = await import("./dangling-sweep-latch")

// The model reads the retry instruction and re-runs only the failed part: the prompt's `CP-RETRY` line is that part. The
// real scripted model emits it once the tool result carries the instruction (as an injected call); otherwise unchanged.
const model = scriptedModel()
const modelProxy = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const body = await request.json() as { messages?: Array<{ role: string; content?: unknown }> }
  const messages = body.messages ?? []
  const last = messages.at(-1)
  const retry = textOf(messages.filter((message) => message.role === "user").at(-1)?.content).match(/CP-RETRY (\{.*\})/)?.[1]
  if (last?.role === "tool" && retry && textOf(last.content).includes(WRITE_APPROVED_RETRY_NOTE)) {
    const injected = `\nCP-INJECTED-CALL ${retry}`
    last.content = typeof last.content === "string" ? last.content + injected : [...(last.content as unknown[]), { type: "text", text: injected }]
  }
  return fetch(`${model.baseURL}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
} })

let connection: { url: string; authorization: string; pid: number } | undefined
let child: ReturnType<typeof fork>
let listener: Awaited<ReturnType<typeof spawnLocalServer>>["listener"]
const childLogs: string[] = []
const eligibility = { homeDir: home, appStateRoot: stateRoot, configFenceRoots: () => fenceSet.configFenceRoots, realpath: realpathSync.native, isDirectory: (path: string) => statSync(path).isDirectory() }
let fenceSet: ReturnType<typeof planConfigFence>
let tracker: ReturnType<typeof bootFenceWorkspaceTruth>
let directoryWrites: ReturnType<typeof createDirectoryWriteApproval>
/** R4's view of the current engine; one arm substitutes a wrapper around the same listener (design v7 §6 evidence 7). */
let sidecarOverride: typeof listener | undefined
/** The generation arm plans its next engine with the production planner (carried folders and new paths from the tracker). */
let useProductionPlanner = false
let preparedPlan: ReturnType<typeof planProcessFence> | undefined
let addon = ""
const truthPath = join(run, "truth.json")

async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(new URL(route, connection!.url), { method, headers: { authorization: connection!.authorization, "content-type": "application/json", "x-opencode-directory": encodeURIComponent(P) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${text.slice(0, 1000)}`)
  return (text ? JSON.parse(text) : undefined) as T
}
type Request = { id: string; action: string; resources: string[]; metadata?: { directoryAccess?: { access: "write"; targets: { absolute: string; directory: string }[] } }; source?: { id: string } }
type Card = Request & { approval?: unknown; realDirectory?: string }
const session = async (agent: "build" | "codepuppy-ask") => (await api<{ data: { id: string } }>("POST", "/api/session", { location: { directory: P }, agent, model: { id: "m", providerID: "codepuppy" } })).data.id
const requests = async (sessionID: string) => (await api<{ data: Request[] }>("GET", `/api/session/${sessionID}/permission`)).data

/** The user's click on the folder card: R4 describe + approve (the grant), then the engine's reply, as the renderer does. */
async function approveFolder(sessionID: string, request: Request): Promise<Card> {
  const input = { server: LOCAL_SIDECAR_SERVER_KEY, sessionID, requestID: request.id, requestFingerprint: permissionV1Fingerprint(request.id) }
  const description = await directoryWrites.describeDirectoryAccess({ ...input, targets: request.metadata!.directoryAccess!.targets }, 1)
  const approval = await directoryWrites.approveDirectoryWrite({ ...input, decisionID: randomUUID(), decision: "once", snapshotID: description.snapshotID }, 1)
  // As the renderer: allow only after main granted it; a refused approval leaves the user only the rejection.
  await api("POST", `/api/session/${sessionID}/permission/${request.id}/reply`, { decision: approval.outcome === "granted" || approval.outcome === "no-fence" ? "once" : "reject" })
  return { ...request, approval, realDirectory: description.targets[0]?.realDirectory }
}

/** One user turn: answers every card as `answer` says until the session is idle; returns the cards in order and the tool texts the model read. */
async function turn(sessionID: string, text: string, answer: (request: Request) => "folder" | "once" | "reject") {
  const before = model.requests.length
  const cards: Card[] = []
  await api("POST", `/api/session/${sessionID}/prompt`, { text })
  const settled = api("POST", `/api/experimental/session/${sessionID}/wait`)
  let done = false
  void settled.then(() => { done = true }, () => { done = true })
  const seen = new Set<string>()
  while (!done) {
    for (const request of await requests(sessionID)) {
      if (seen.has(request.id)) continue
      seen.add(request.id)
      const decision = answer(request)
      if (decision === "folder") cards.push(await approveFolder(sessionID, request))
      else {
        cards.push(request)
        await api("POST", `/api/session/${sessionID}/permission/${request.id}/reply`, { decision })
      }
    }
    await Bun.sleep(25)
  }
  await settled
  const sent = model.requests.slice(before)
  return { cards, sent, tools: sent.flatMap((request) => request.messages.filter((message) => message.role === "tool").map((message) => textOf(message.content))) }
}
const call = (command: string, retry?: string) => `CP-CALL ${JSON.stringify({ name: "shell", args: { command } })}${retry ? `\nCP-RETRY ${JSON.stringify({ name: "shell", args: { command: retry } })}` : ""}`
const write = (path: string, content: string) => `CP-CALL ${JSON.stringify({ name: "write", args: { path, content } })}`
const folderOnly = (request: Request) => (request.action === "external_directory" ? "folder" : "once")
const outside = (name: string) => { const directory = join(run, name); mkdirSync(directory, { recursive: true }); return directory }

beforeAll(async () => {
  for (const directory of [P, install, home, stateRoot, userData, join(install, "home"), join(run, "self-check-outside"), join(stateRoot, "env/dev")]) mkdirSync(directory, { recursive: true })
  // AC-14: an entry that already exists directly in the test HOME (v8: not a new path).
  writeFileSync(join(home, "existing.txt"), "keep\n")
  // The run root sits inside this repository's worktree. The project is its own repository, as a user's project is, so the
  // engine's project root is P and the test HOME is outside it: the write tool asks before writing there (BR-08).
  execFileSync("git", ["init", "-q"], { cwd: P })
  process.env.CODEPUPPY_GLOBAL_DIR = join(stateRoot, "env/dev")
  writeWorkspaceTruth(truthPath, [P], { mkdirSync, writeFileSync, renameSync, rmSync })
  tracker = bootFenceWorkspaceTruth({ truthPath, store: { tabs: [{ type: "draft", draftID: "p", server: "sidecar", directory: P }], recent: undefined, info: undefined }, fs: { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync }, log: (line) => { log.push(line) }, eligibility, onWritableChanged: () => {} })
  directoryWrites = createDirectoryWriteApproval({
    eligibility, tracker, sidecar: () => sidecarOverride ?? listener,
    // The renderer's request read, against the engine this scenario started (main's own reader targets its fixed port).
    current: async (sessionID, requestID) => {
      const response = await fetch(new URL(`/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}`, connection!.url), { headers: { authorization: connection!.authorization } })
      return response.status === 404 ? undefined : toV1PermissionRequest((await response.json()).data)
    },
  })
  addon = buildFenceAddon({ out: join(run, "codepuppy-fence/codepuppy_fence.node"), buildId: `refused-write-${Date.now()}` }).out
  const roots = resolveEngineRoots({}, home)
  fenceSet = planConfigFence({ userDataPath: install, appStateRoot: stateRoot, codepuppyGlobalRoot: join(install, "state/env/dev"), engineConfigDirectory: userConfig, roots }, { realpath: (path) => realpathSync.native(path), mkdirp: (path) => { mkdirSync(path, { recursive: true }) } })
  const profile = renderProcessFenceProfile({ workspaces: [P], codepuppyGlobalRoot: join(install, "state/env/dev"), userDataPath: install, stateHome: join(install, "state"), roots, egressProxyPort: modelProxy.port!, configFence: fenceSet.configFence, homebrewFence: [], credentialStores: planCredentialStores(credentialStores({ userDataPath: install }), { realpath: (path) => realpathSync.native(path) }) })
  // The production sidecar host routes the ext's messages (R6 here); hub routes are not exercised in this scenario.
  const codepuppySidecar = createCodePuppySidecarHost({
    view: undefined as never, requests: undefined as never, installName: () => undefined,
    packageAuthorization: async () => ({ ok: false, reason: "not in this scenario" }), searchSources: async () => { throw new Error("not in this scenario") }, install: async () => { throw new Error("not in this scenario") },
    reloads: { attach: () => () => {}, locationReady: () => {}, receiveReport: () => {} } as never, log: (line) => { log.push(line) },
  })
  codepuppySidecarHost = codepuppySidecar
  fixedProfile = profile
  await boot()
}, 120_000)

let codepuppySidecarHost: ReturnType<typeof createCodePuppySidecarHost>
let fixedProfile = ""
async function boot() {
  connection = undefined
  preparedPlan = undefined
  resetDanglingSweepLatchForTests(); creditDanglingSweepForSpawn()
  const result = await spawnLocalServer("127.0.0.1", 43211, "test-only", {
    userDataPath: userData, egressProxy: async () => ({ port: modelProxy.port! }), healthCheck: async () => !!connection, fenceRun: tracker, codepuppySidecar: codepuppySidecarHost,
    // The production planner takes main's carried run sets from the spawn input, as production does (generation arm).
    planFence: (input) => {
      if (!useProductionPlanner) return { addonPath: addon, workspaces: [P], configFenceRoots: fenceSet.configFenceRoots, profile: fixedProfile, eligibility }
      preparedPlan = planProcessFence({ userDataPath: install, sidecarEnv: { XDG_STATE_HOME: join(install, "state") }, egressProxyPort: modelProxy.port!, addon: { packaged: true, resourcesPath: run, moduleDir: run, exists: existsSync }, carriedWorkspaces: input.carriedWorkspaces, carriedNewPaths: input.carriedNewPaths, engineConfigDirectory: userConfig, homebrewFence: [], credentialStores: credentialStores({ userDataPath: install }) }, {
        homeDir: () => home, appStateRoot: () => stateRoot, codepuppyGlobalRoot: () => join(install, "state/env/dev"), defaultWorkspace: () => P,
        readWorkspaces: () => readWorkspaceTruthOrThrow(truthPath, { readFileSync }), realpath: realpathSync.native, isDirectory: (path) => { try { return statSync(path).isDirectory() } catch { return false } },
        mkdirp: (path) => { mkdirSync(path, { recursive: true }) }, compile: trialCompileProfile, log: (line) => { log.push(line) },
      })
      return { ...preparedPlan, eligibility }
    },
    fork: ((_file: string, _args: string[], options: { env: Record<string, string> }) => {
      const peer = new EventEmitter() as EventEmitter & { pid: number; stdout: unknown; stderr: unknown; postMessage: (message: unknown) => void; kill: () => void }
      child = fork(join(import.meta.dir, "../../native/codepuppy-fence/test/project-writable-engine.fixture.ts"), [], { execPath: process.execPath, env: { ...options.env, HOME: join(install, "home"), TMPDIR: install, CODEPUPPY_WRITABLE_ENGINE_ROOT: install, CODEPUPPY_WRITABLE_A: P, CODEPUPPY_WRITABLE_OUTSIDE: join(run, "self-check-outside"), CODEPUPPY_WRITABLE_MODEL_URL: `http://127.0.0.1:${modelProxy.port}/v1`, CODEPUPPY_WRITABLE_PARENT_PORT: "1", CODEPUPPY_WRITABLE_DIRECTORY_ACCESS: "1" }, stdio: ["ignore", "pipe", "pipe", "ipc"] })
      peer.pid = child.pid!
      peer.stdout = child.stdout; peer.stderr = child.stderr
      child.stdout?.on("data", (chunk) => { childLogs.push(String(chunk)) })
      child.stderr?.on("data", (chunk) => { childLogs.push(String(chunk)) })
      child.on("message", (message: Record<string, unknown>) => {
        if (message.type === "fixture.ready") connection = message as unknown as typeof connection
        peer.emit("message", message)
      })
      child.on("exit", (code) => peer.emit("exit", code ?? -1))
      child.on("error", (error) => peer.emit("error", error))
      peer.postMessage = (message) => { child.send(message as never) }
      peer.kill = () => { child.kill("SIGKILL") }
      return peer
    }) as never,
  })
  listener = result.listener
  await result.health.wait
}

afterAll(async () => {
  if (listener) await listener.stop()
  if (child && child.exitCode === null && child.signalCode === null) { const stopped = new Promise<void>((resolve) => child.once("exit", () => resolve())); child.kill("SIGKILL"); await stopped }
  model.stop(); modelProxy.stop(true)
  writeFileSync(join(run, "main.log"), log.join("\n"))
  writeFileSync(join(run, "engine.log"), childLogs.join(""))
  writeFileSync(join(run, "model-requests.json"), JSON.stringify(model.requests, null, 2))
  console.log(`refused-write approval evidence=${run}`)
})

for (const agent of ["build", "codepuppy-ask"] as const) test(`${agent === "build" ? "全部批准" : "请求审批"}: a command refused halfway asks for the folder after it ends; approval grants it in place and the model re-runs only the failed part`, async () => {
  const folder = outside(`outside-${agent}`), real = realpathSync.native(folder)
  const first = join(P, `first-${agent}.txt`), target = join(folder, "b.txt")
  const pid = connection!.pid
  const result = await turn(await session(agent), call(`echo a >> ${quote(first)} && touch ${quote(target)}`, `touch ${quote(target)}`), folderOnly)
  const folders = result.cards.filter((card) => card.action === "external_directory")
  expect(folders.map((card) => [card.resources, card.realDirectory, card.approval])).toEqual([[[`${real}/*`], real, { outcome: "granted" }]])
  // 请求审批: the command card, then the folder card after the command, then the re-run's own command card.
  expect(result.cards.map((card) => card.action === "external_directory" ? "folder" : "command")).toEqual(agent === "build" ? ["folder"] : ["command", "folder", "command"])
  expect(result.tools[0]).toContain("Operation not permitted")
  expect(result.tools[0]).toContain(WRITE_APPROVED_RETRY_NOTE)
  expect(result.tools[0]).not.toContain(WRITE_REFUSED_NOTE)
  expect(readdirSync(folder)).toEqual(["b.txt"])
  // The part before the refusal ran once: the re-run did not append again.
  expect(readFileSync(first, "utf8")).toBe("a\n")
  expect(connection!.pid).toBe(pid)
  expect(child.exitCode).toBeNull()
}, 120_000)

test("Node's error form brings up the same card; the re-run lands", async () => {
  const folder = outside("outside-node"), target = join(folder, "n.txt")
  const node = Bun.which("node")!
  const write = `${quote(node)} -e ${quote(`require("fs").writeFileSync(${JSON.stringify(target)}, "x")`)}`
  const result = await turn(await session("build"), call(write, write), folderOnly)
  expect(result.tools[0]).toContain("EPERM: operation not permitted, open")
  expect(result.cards.map((card) => [card.action, card.approval])).toEqual([["external_directory", { outcome: "granted" }]])
  expect(readFileSync(target, "utf8")).toBe("x")
}, 120_000)

test("a declined folder card leaves the folder empty and ends the step", async () => {
  const folder = outside("outside-declined"), target = join(folder, "b.txt")
  const result = await turn(await session("build"), call(`touch ${quote(target)}`, `touch ${quote(target)}`), (request) => (request.action === "external_directory" ? "reject" : "once"))
  expect(result.cards.map((card) => card.action)).toEqual(["external_directory"])
  expect(readdirSync(folder)).toEqual([])
  // The decline ends the step as BR-08's does: the agent loop asks the model once (the call) and never with its result
  // (the other request of a first turn is the engine's title request, which carries no tools).
  expect(result.tools).toEqual([])
  expect(result.sent.filter((request) => request.tools.length > 0)).toHaveLength(1)
}, 120_000)

// v8 (design v7 §6 evidence 10): HOME's arm rewrites an entry that already exists there — a new path directly in HOME now
// asks for itself (AC-14 arms below).
test("no card where approval cannot help: a relative path after cd, an existing entry in main's HOME, a protected location — the stop instruction and nothing written", async () => {
  const relative = outside("outside-relative")
  mkdirSync(join(P, "sub"), { recursive: true })
  mkdirSync(userConfig, { recursive: true })
  for (const [command, written] of [
    [`cd ${quote(join(P, "sub"))} && touch ../../outside-relative/b.txt`, join(relative, "b.txt")],
    [`echo y >> ${quote(join(home, "existing.txt"))}`, join(home, "existing.txt")],
    [`touch ${quote(join(userConfig, "i55.json"))}`, join(userConfig, "i55.json")],
  ] as const) {
    const result = await turn(await session("build"), call(command), () => "once")
    expect({ command, cards: result.cards.map((card) => card.action) }).toEqual({ command, cards: [] })
    expect(result.tools[0]?.toLowerCase()).toContain("operation not permitted")
    expect(result.tools[0]).toContain(WRITE_REFUSED_NOTE)
    expect(result.tools[0]).not.toContain(WRITE_APPROVED_RETRY_NOTE)
    if (written === join(home, "existing.txt")) expect(readFileSync(written, "utf8")).toBe("keep\n")
    else expect(existsSync(written)).toBe(false)
  }
}, 180_000)

test("`P/link/../b`: the card names the link target's parent on disk, and approving it lets the write land there", async () => {
  const folder = outside("outside-link"), real = realpathSync.native(folder)
  mkdirSync(join(folder, "sub"), { recursive: true })
  symlinkSync(join(folder, "sub"), join(P, "link"))
  const raw = `${P}/link/../b.txt`
  const result = await turn(await session("build"), call(`touch ${quote(raw)}`, `touch ${quote(raw)}`), folderOnly)
  expect(result.cards.map((card) => [card.resources, card.realDirectory, card.approval])).toEqual([[[`${real}/*`], real, { outcome: "granted" }]])
  expect(existsSync(join(folder, "b.txt"))).toBe(true)
  expect(existsSync(join(P, "b.txt"))).toBe(false)
}, 120_000)

test("a background command asks nothing while it runs; its result asks when it reaches the model, and the note follows it", async () => {
  const folder = outside("outside-background"), target = join(folder, "bg.txt")
  const sessionID = await session("build")
  const started = await turn(sessionID, `CP-CALL ${JSON.stringify({ name: "shell", args: { command: `sleep 2; touch ${quote(target)}`, background: true } })}`, folderOnly)
  expect(started.cards).toEqual([])
  expect(started.tools[0]).toContain("moved to the background")
  // The engine's completion notice wakes the session; the context hook asks before that request reaches the model.
  let card: Request | undefined
  for (let i = 0; i < 600 && !card; i++) { card = (await requests(sessionID)).find((request) => request.action === "external_directory"); if (!card) await Bun.sleep(50) }
  expect(card?.resources).toEqual([`${realpathSync.native(folder)}/*`])
  const approved = await approveFolder(sessionID, card!)
  expect(approved.approval).toEqual({ outcome: "granted" })
  let read: string | undefined
  for (let i = 0; i < 600 && !read; i++) { read = model.requests.flatMap((request) => request.messages).map((message) => textOf(message.content)).find((text) => text.startsWith("<shell id=") && text.includes(WRITE_APPROVED_RETRY_NOTE)); if (!read) await Bun.sleep(50) }
  expect(read).toContain("Operation not permitted")
  await api("POST", `/api/experimental/session/${sessionID}/wait`)
}, 120_000)

// ── SPEC v8 AC-14 (design v7 §6 evidence 1–12): a new folder or file directly in main's HOME ──────────────────────────────
const stopOnFolderCard = (request: Request) => (request.action === "external_directory" ? "reject" : "once")

for (const agent of ["build", "codepuppy-ask"] as const) test(`${agent === "build" ? "全部批准" : "请求审批"}: mkdir and a redirect directly in HOME ask for that one new path; approval grants it in place and the re-run lands`, async () => {
  const folder = join(home, `newfolder-${agent}`), file = join(home, `note-${agent}.txt`)
  const pid = connection!.pid
  const sessionID = await session(agent)
  const made = await turn(sessionID, call(`mkdir ${quote(folder)}`, `mkdir ${quote(folder)} && mkdir -p ${quote(join(folder, "a"))} && echo x > ${quote(join(folder, "a", "b"))}`), folderOnly)
  const noted = await turn(sessionID, call(`echo hi > ${quote(file)}`, `echo hi > ${quote(file)}`), folderOnly)
  for (const [result, path] of [[made, folder], [noted, file]] as const) {
    expect(result.cards.filter((card) => card.action === "external_directory").map((card) => [card.resources, card.metadata?.directoryAccess?.targets, card.realDirectory, card.approval]))
      .toEqual([[[`${path}/*`], [{ absolute: path, directory: home }], path, { outcome: "granted" }]])
    // 请求审批: the command card, the card for the new path after the command, then the re-run's own command card.
    expect(result.cards.map((card) => card.action === "external_directory" ? "folder" : "command")).toEqual(agent === "build" ? ["folder"] : ["command", "folder", "command"])
    expect(result.tools[0]?.toLowerCase()).toContain("operation not permitted")
    expect(result.tools[0]).toContain(WRITE_APPROVED_RETRY_NOTE)
    expect(result.tools[0]).not.toContain(WRITE_REFUSED_NOTE)
  }
  expect(readFileSync(join(folder, "a", "b"), "utf8")).toBe("x\n")
  expect(readFileSync(file, "utf8")).toBe("hi\n")
  expect(tracker.userOpened.has(LOCAL_SIDECAR_SERVER_KEY, folder)).toBe(false)
  expect(connection!.pid).toBe(pid)
  expect(child.exitCode).toBeNull()
}, 180_000)

test("the write tool's card for a new file directly in HOME names that file, not HOME; approval lands the write", async () => {
  const file = join(home, "written.txt")
  const result = await turn(await session("build"), write(file, "w"), folderOnly)
  // The engine's request lists HOME; main's description (the card's real-path and resources rows) is the file itself.
  expect(result.cards.map((card) => [card.action, card.resources, card.realDirectory, card.approval])).toEqual([["external_directory", [`${home}/*`], file, { outcome: "granted" }]])
  expect(readFileSync(file, "utf8")).toBe("w")
}, 120_000)

test("after a new path is granted its sibling is still refused and gets its own card; rejecting it writes nothing; an existing entry gets no card", async () => {
  const granted = join(home, "sib-granted.txt"), sibling = join(home, "sibling.txt")
  const sessionID = await session("build")
  const first = await turn(sessionID, call(`echo a > ${quote(granted)}`, `echo a > ${quote(granted)}`), folderOnly)
  expect(first.cards.map((card) => card.approval)).toEqual([{ outcome: "granted" }])
  // A fresh session: `turn` reads every tool message of the requests it sends, history included.
  const second = await turn(await session("build"), call(`echo s > ${quote(sibling)}`, `echo s > ${quote(sibling)}`), stopOnFolderCard)
  expect(second.cards.map((card) => [card.action, card.resources, card.metadata?.directoryAccess?.targets])).toEqual([["external_directory", [`${sibling}/*`], [{ absolute: sibling, directory: home }]]])
  expect(second.tools).toEqual([])
  expect(existsSync(sibling)).toBe(false)
  expect(readFileSync(granted, "utf8")).toBe("a\n")
  // The write tool rewriting an entry already in HOME: no card, the stop instruction, the content unchanged (AC-08).
  const existing = await turn(await session("build"), write(join(home, "existing.txt"), "overwritten"), () => "once")
  expect(existing.cards).toEqual([])
  expect(existing.tools[0]).toContain(WRITE_REFUSED_NOTE)
  expect(readFileSync(join(home, "existing.txt"), "utf8")).toBe("keep\n")
}, 180_000)

// design v7 §6 evidence 12 (R1-F1): the path appears (made by an unfenced process) after main read it as new and before the
// card is described. The card carries { P, HOME }; approval ends at HOME's refusal and the fenced engine still cannot write in P.
test("a new path someone else creates before the card is described is not granted as a folder: HOME's refusal, P stays unwritable", async () => {
  const raced = join(home, "raced")
  const result = await turn(await session("build"), call(`mkdir ${quote(raced)}`), (request) => {
    if (request.action !== "external_directory") return "once"
    mkdirSync(raced)
    return "folder"
  })
  expect(result.cards.map((card) => [card.metadata?.directoryAccess?.targets, card.realDirectory, card.approval])).toEqual([[[{ absolute: raced, directory: home }], home, { outcome: "failed", reason: "home-or-app-state" }]])
  expect((await listener.probeWrite(raced)).outcome).toBe("denied")
  expect(tracker.userOpened.has(LOCAL_SIDECAR_SERVER_KEY, raced)).toBe(false)
  expect(readdirSync(raced)).toEqual([])
}, 120_000)

// design v7 §6 evidence 7: after main re-judged the path and before it issues, an unfenced process puts a link to a folder
// outside at P and leaves it there. The issue-time assertion refuses; nothing outside becomes writable.
test("a link planted at a new path just before the issue is refused there: no grant, the link's target stays unwritable", async () => {
  const planted = join(home, "planted"), target = outside("outside-planted")
  const original = listener
  sidecarOverride = { ...original, grantWrite: async (path, kind) => { if (path === planted) symlinkSync(target, planted); return original.grantWrite(path, kind) } }
  try {
    const result = await turn(await session("build"), call(`mkdir ${quote(planted)}`), folderOnly)
    expect(result.cards.map((card) => [card.realDirectory, card.approval])).toEqual([[planted, { outcome: "failed", reason: "grant-failed" }]])
  } finally {
    sidecarOverride = undefined
  }
  expect(lstatSync(planted).isSymbolicLink()).toBe(true)
  expect((await listener.probeWrite(target)).outcome).toBe("denied")
  expect(readdirSync(target)).toEqual([])
  expect(log.some((line) => line.includes(`grant failed directory=${JSON.stringify(planted)} step=realpath`))).toBe(true)
}, 120_000)

// design v7 §6 evidence 6 and 8: approved new paths are carried into the next engine generation by the production planner;
// one the fenced code replaced by a link is excluded with one log line, and the link's target stays unwritable. Last: it
// replaces the engine.
test("the next generation keeps approved new paths writable without a card; one replaced by a link is excluded", async () => {
  const file = join(home, "carry.txt"), folder = join(home, "carry-dir"), target = outside("outside-swap")
  const sessionID = await session("build")
  await turn(sessionID, call(`echo one > ${quote(file)}`, `echo one > ${quote(file)}`), folderOnly)
  await turn(sessionID, call(`mkdir ${quote(folder)}`, `mkdir ${quote(folder)}`), folderOnly)
  expect([readFileSync(file, "utf8"), statSync(folder).isDirectory()]).toEqual(["one\n", true])
  // Inside the fence: replace the granted folder by a link to a folder outside, then write through it.
  const swap = await turn(sessionID, call(`rm -r ${quote(folder)} && ln -s ${quote(target)} ${quote(folder)} && echo z > ${quote(join(folder, "esc"))}`), stopOnFolderCard)
  writeFileSync(join(run, "swap-output.txt"), JSON.stringify({ tools: swap.tools, cards: swap.cards.map((card) => card.resources), link: lstatSync(folder).isSymbolicLink() }, null, 2))
  expect(lstatSync(folder).isSymbolicLink()).toBe(true)
  expect(readdirSync(target)).toEqual([])
  const previous = connection!.pid
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  child.kill("SIGKILL")
  await exited
  useProductionPlanner = true
  try {
    await boot()
  } finally {
    useProductionPlanner = false
  }
  expect(connection!.pid).not.toBe(previous)
  const again = await turn(await session("build"), call(`echo two >> ${quote(file)}`), stopOnFolderCard)
  expect(again.cards).toEqual([])
  expect(readFileSync(file, "utf8")).toBe("one\ntwo\n")
  expect(preparedPlan!.newPaths).toContain(file)
  expect(preparedPlan!.newPaths).not.toContain(folder)
  expect(log).toContain(`process fence: approved new path ${folder} excluded — no longer that new path directly in HOME (a link, re-pointed, or HOME changed)`)
  expect((await listener.probeWrite(target)).outcome).toBe("denied")
  expect(readdirSync(target)).toEqual([])
}, 300_000)
