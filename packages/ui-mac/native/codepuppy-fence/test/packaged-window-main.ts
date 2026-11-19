// V4/V5/V6: production renderer/preload, main registry/IPC/listener and signed utilityProcess.
// Account/background-service boundaries use inert fixtures; no real account is loaded.
import { app, BrowserWindow, ipcMain, utilityProcess } from "electron"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { createServer } from "node:net"
import { execFileSync } from "node:child_process"
import { spawnLocalServer } from "../../../src/main/server"
import { registerIpcHandlers } from "../../../src/main/ipc"
import { initCodePuppyEnvironment } from "../../../src/main/codepuppy-environment"
import {
  bootFenceWorkspaceTruth,
  readWorkspaceTruthOrThrow,
  writeWorkspaceTruth,
} from "../../../src/main/process-fence-workspaces"
import { renderProcessFenceProfile, resolveEngineRoots } from "../../../src/main/process-fence-profile"
import { creditDanglingSweepForSpawn } from "../../../src/main/dangling-sweep-latch"
import { engineAuthorization } from "../../../src/main/engine-authorization"
import { initLogging } from "../../../src/main/logging"
import { getStore } from "../../../src/main/store"
import { engineModelConfig } from "../../../src/main/codepuppy-models"
import { getEffectiveCatalog } from "../../../src/main/codepuppy-platform-models"
import { createSettingsAdapter } from "../../../src/main/settings-adapters"
import {
  getAutomation,
  listAutomations,
  readAutomationState,
  saveAutomation,
} from "../../../src/main/codepuppy-automations"
import { getPlannedFireAt, isAutomationRunning, startAutomationScheduler } from "../../../src/main/automation-scheduler"
import { AUTOMATION_PROFILES } from "@opencode/schema/codepuppy-unattended"
import { createDeepLinkQueue, trackRendererLifecycle } from "../../../src/main/deep-link-queue"
import { unattendedRuns } from "../../../src/main/codepuppy-unattended"
import { parseUnattendedAck } from "../../../src/main/codepuppy-sidecar-messages"
import type { FenceAddon } from "../../../src/main/process-fence-apply"
import { dict } from "../../../src/renderer/i18n/zh"
const root = process.env.CODEPUPPY_WINDOW_RUN!
const report: Record<string, unknown> = { mainPid: process.pid, arms: [], events: [], console: [] }
const events = report.events as Array<Record<string, unknown>>
const record = (event: string, data: Record<string, unknown> = {}) => {
  events.push({ event, ms: performance.now(), ...data })
  writeFileSync(join(root, "window-events.json"), JSON.stringify(events, null, 2))
}
const home = process.env.HOME!
const userData = join(root, "user-data"),
  engineData = join(root, "engine-data"),
  A = join(root, "A")
const directories = Object.fromEntries(
  ["M1", "R1", "R2", "R3", "R4", "R5", "slow", "rewritten", "failed", "timeout"].map((name) => [
    name,
    join(root, name),
  ]),
)
for (const directory of [home, userData, engineData, A]) mkdirSync(directory, { recursive: true })
app.setPath("userData", userData)
app.setAppLogsPath(join(root, "logs"))
app.dock?.hide()
process.env.CODEPUPPY_USER_WORKSPACE_DIR = A
process.env.OPENCODE_DB = join(engineData, "engine.db")
process.env.CODEPUPPY_MODELS_DISABLE = "1"
process.env.OPENCODE_ENABLE_FILEWATCH = "0"
const env = initCodePuppyEnvironment({
  isPackaged: true,
  channel: "dev",
  appDataDir: join(root, "app-data"),
  baseRoot: join(root, "state"),
  homeDir: home,
})
const truthPath = join(userData, "workspace-truth.json")
writeWorkspaceTruth(truthPath, [A], { mkdirSync, writeFileSync, renameSync, rmSync })
const tracker = bootFenceWorkspaceTruth({
  truthPath,
  store: { tabs: [], recent: undefined, info: undefined },
  fs: { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync },
  eligibility: {
    homeDir: home,
    appStateRoot: env.casBaseRoot,
    realpath: realpathSync.native,
    isDirectory: (path) => {
      try {
        return statSync(path).isDirectory()
      } catch {
        return false
      }
    },
  },
  log: (line) => record("truth", { line }),
  onWritableChanged: (change) => {
    record("writable-changed", change)
    BrowserWindow.getAllWindows().forEach((win) => win.webContents.send("workspace-writable-changed", change))
  },
})
let win: BrowserWindow | undefined
let listener: Awaited<ReturnType<typeof spawnLocalServer>>["listener"] | undefined
let engine: ReturnType<typeof utilityProcess.fork> | undefined
let url = "",
  loads = 0,
  finishing = false
const password = "window-fixture-only"
const generation = { status: "ready" as const, generation: 1, reason: "boot" as const, fence: "applied" as const }
const links = createDeepLinkQueue({
  consumeAuth: () => false,
  deliver: (id, batch) => {
    if (!win || win.isDestroyed() || win.webContents.id !== id) return false
    record("link-delivered", { id, batch })
    win.webContents.send("deep-link", batch)
    return true
  },
  schedule: (delay, expire) => {
    setTimeout(expire, delay).unref()
  },
})
const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
let grantFault: "native" | "timeout" | undefined
const nativeDlopen = process.dlopen
process.dlopen = (module, filename, flags) => {
  nativeDlopen(module, filename, flags)
  if (!String(filename).endsWith("/codepuppy_fence.node")) return
  const holder = module as { exports: FenceAddon },
    raw = holder.exports
  const wrapped = Object.create(raw)
  Object.defineProperty(wrapped, "issueFileExtensionToProcess", {
    value: (kind: string, directory: string, pid: number) => {
      const result = raw.issueFileExtensionToProcess(
        kind,
        directory,
        grantFault && directory === directories.failed ? 2147483647 : pid,
      )
      if (directory === directories.failed && result.token === null)
        record("native-failure", { step: result.step, errno: result.errno })
      return result
    },
  })
  holder.exports = wrapped
}
function assert(ok: unknown, why: string): asserts ok {
  if (!ok) throw new Error(why)
}
async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      authorization: engineAuthorization(password),
      "content-type": "application/json",
      "x-opencode-directory": encodeURIComponent(A),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  assert(response.ok, `${method} ${path}: ${response.status} ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : undefined
}
async function createSession(directory: string) {
  return (
    await api("POST", "/api/session", {
      location: { directory },
      agent: "build",
      model: { id: "m", providerID: "fixture" },
    })
  ).data.id as string
}
async function modelWrite(directory: string, name: string) {
  const id = await createSession(directory)
  await api("POST", `/api/session/${id}/prompt`, {
    text: `CP-CALL ${JSON.stringify({ name: "write", args: { path: name, content: "window" } })}`,
  })
  await api("POST", `/api/experimental/session/${id}/wait`)
  return existsSync(join(directory, name))
}
async function modelShell(directory: string, command: string) {
  const id = await createSession(directory)
  await api("POST", `/api/session/${id}/prompt`, {
    text: `CP-CALL ${JSON.stringify({ name: "shell", args: { command } })}`,
  })
  let done = false
  const completed = api("POST", `/api/experimental/session/${id}/wait`).finally(() => {
    done = true
  })
  while (!done) {
    const pending = await api("GET", `/api/session/${id}/permission`)
    for (const request of pending.data)
      await api("POST", `/api/session/${id}/permission/${request.id}/reply`, { decision: "once" })
    if (!done) await new Promise((resolve) => setTimeout(resolve, 20))
  }
  await completed
}
const waitFor = async (condition: () => boolean | Promise<boolean>, why: string, timeout = 30_000) => {
  const end = Date.now() + timeout
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`window timeout: ${why}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
async function evaluate<T = unknown>(expression: string): Promise<T> {
  const reply = await win!.webContents.debugger.sendCommand("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails))
  return reply.result.value as T
}
async function click(expression: string) {
  await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
  const target = await win!.webContents.debugger.sendCommand("Runtime.evaluate", { expression })
  if (target.result.objectId)
    await win!.webContents.debugger.sendCommand("DOM.scrollIntoViewIfNeeded", { objectId: target.result.objectId })
  const rect = await evaluate<{ x: number; y: number } | null>(
    `(()=>{const el=(${expression});if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  )
  if (!rect) throw new Error(`missing click target: ${expression}`)
  await win!.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", ...rect })
  await win!.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...rect,
    button: "left",
    clickCount: 1,
  })
  await win!.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...rect,
    button: "left",
    clickCount: 1,
  })
}

async function pick(directory: string) {
  const before = events.length
  process.env.CODEPUPPY_OPEN_DIR = directory
  await click("document.querySelector('button[title=\"打开项目\"]')")
  await waitFor(() => events.slice(before).some((event) => event.event === "picker-reply"), "picker IPC completion")
  delete process.env.CODEPUPPY_OPEN_DIR
}
async function inspectResidualSentence(reason: "home-or-app-state" | "not-opened-by-you" | "grant-failed") {
  const expected =
    dict[
      reason === "home-or-app-state"
        ? "codepuppy.workspace.readonlyHome"
        : reason === "not-opened-by-you"
          ? "codepuppy.workspace.readonlyNotOpenedByYou"
          : "codepuppy.workspace.readonlyGrantFailed"
    ]
  await waitFor(
    () =>
      evaluate<boolean>(
        "!!document.querySelector('[data-codepuppy-workspace-readonly],[data-codepuppy-workspace-chip-readonly]')",
      ),
    `${reason} DOM marker`,
  )
  const pill = await evaluate<boolean>("!!document.querySelector('[data-codepuppy-workspace-readonly]')")
  if (pill) await click("document.querySelector('[data-codepuppy-workspace-readonly]')")
  await waitFor(
    () =>
      evaluate<boolean>(
        `document.querySelector('[data-codepuppy-workspace-readonly-pop]')?.textContent.trim()===${JSON.stringify(expected)} || document.querySelector('[data-codepuppy-workspace-chip-readonly]')?.getAttribute('title')===${JSON.stringify(expected)}`,
      ),
    `${reason} exact residual sentence`,
  )
  assert(
    await evaluate<boolean>(
      "!document.querySelector('[data-codepuppy-workspace-readonly-pop] button') && ![...document.querySelectorAll('button')].some(el=>/重新启动 Code Puppy|Restart Code Puppy/.test(el.textContent))",
    ),
    `${reason} restart button present`,
  )
  return { sentence: expected, source: pill ? "popover.textContent" : "chip.title" }
}
async function finish(error?: unknown) {
  if (finishing) return
  finishing = true
  if (error) {
    report.error = error instanceof Error ? error.stack : String(error)
    if (win && !win.isDestroyed()) {
      report.dom = await evaluate("document.body.innerText").catch(() => "unavailable")
      await win.webContents.debugger
        .sendCommand("Page.captureScreenshot")
        .then((shot) => writeFileSync(join(root, "failure.png"), Buffer.from(shot.data, "base64")))
        .catch(() => {})
    }
  }
  report.pendingDeepLinks =
    win && !win.isDestroyed() ? await evaluate("window.__codepuppyDeepLinks").catch(() => []) : []
  report.loads = loads
  report.windowVisible = win?.isVisible()
  report.enginePid = engine?.pid
  if (win && !win.isDestroyed()) {
    report.inputs = await evaluate("window.__cpInputs").catch(() => [])
  }
  await listener?.stop()
  process.dlopen = nativeDlopen
  writeFileSync(join(root, "window-result.json"), JSON.stringify(report, null, 2))
  app.exit(error ? 1 : 0)
}
async function run() {
  initLogging()
  getStore("opencode.global.dat").set("language", "zh")
  for (const [name, directory] of Object.entries(directories)) {
    mkdirSync(directory, { recursive: true })
    execFileSync("/usr/bin/git", ["init", "-q", directory])
    execFileSync("/usr/bin/git", [
      "-C",
      directory,
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@invalid",
      "commit",
      "--allow-empty",
      "-qm",
      name,
    ])
  }
  const configDirectory = join(engineData, "config")
  mkdirSync(configDirectory, { recursive: true })
  process.env.OPENCODE_CONFIG_DIR = configDirectory
  assert(
    process.env.CODEPUPPY_WINDOW_MODEL_URL?.startsWith("http://127.0.0.1:"),
    "scripted loopback model endpoint required",
  )
  const modelPort = Number(new URL(process.env.CODEPUPPY_WINDOW_MODEL_URL).port)
  // Same native projection used by codepuppy-engine.ts; only the model endpoint is scripted.
  writeFileSync(
    join(configDirectory, "opencode.json"),
    JSON.stringify(
      engineModelConfig({
        provider: {
          fixture: {
            name: "fixture",
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: process.env.CODEPUPPY_WINDOW_MODEL_URL!, apiKey: "fixture" },
            models: { m: { name: "m" } },
          },
        },
        enabled_providers: ["fixture"],
        model: "fixture/m",
      }),
    ),
  )
  const socket = createServer()
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve))
  const port = (socket.address() as { port: number }).port
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  creditDanglingSweepForSpawn()
  const started = await spawnLocalServer("127.0.0.1", port, password, {
    userDataPath: engineData,
    codepuppySidecar: {
      attach: (post) => unattendedRuns.attach(post),
      receive: (message) => {
        const ack = parseUnattendedAck(message)
        if (!ack) return false
        unattendedRuns.acknowledge(ack)
        return true
      },
    },
    egressProxy: async () => ({ port: modelPort }),
    planFence: () => ({
      addonPath: join(process.resourcesPath, "codepuppy-fence/codepuppy_fence.node"),
      profile: renderProcessFenceProfile({
        workspaces: [A, ...readWorkspaceTruthOrThrow(truthPath, { readFileSync })],
        codepuppyGlobalRoot: env.mutableRoot,
        userDataPath: engineData,
        stateHome: process.env.XDG_STATE_HOME!,
        roots: resolveEngineRoots(process.env, home),
        egressProxyPort: modelPort,
      }),
    }),
    fork: (file, args, options) => {
      engine = utilityProcess.fork(file, args, options)
      const post = engine.postMessage.bind(engine)
      engine.postMessage = (message, ports) => {
        if (grantFault === "timeout" && message?.type === "grant-write") {
          record("grant-dropped", { id: message.id })
          return
        }
        post(message, ports)
      }
      engine.on("exit", (code) => record("engine-exit", { code }))
      return engine
    },
    onStdout: (line) => appendFileSync(join(root, "engine.log"), line + "\n"),
    onStderr: (line) => appendFileSync(join(root, "engine-stderr.log"), line + "\n"),
  })
  listener = started.listener
  await started.health.wait
  url = `http://127.0.0.1:${port}`
  record("engine-ready", { pid: engine!.pid })
  const seeds: Record<string, string> = {}
  for (const [name, directory] of Object.entries(directories))
    if (name !== "rewritten") {
      seeds[name] = await createSession(directory)
      await api("PATCH", `/api/session/${seeds[name]}`, { title: `Window ${name}` })
    }
  report.seeds = seeds
  // Real timer/runner creates the history row; loading it is not an open action (V4).
  const task = {
    id: "auto-window",
    name: "Window history",
    nlText: "",
    schedule: { kind: "once" as const, at: new Date(Date.now() + 2000).toISOString() },
    target: {
      projectDir: directories.R5!,
      agent: Object.entries(AUTOMATION_PROFILES).find(([, profile]) => profile === "standard")![0],
      model: "fixture/m",
    },
    prompt: `CP-CALL ${JSON.stringify({ name: "write", args: { path: "auto-before.txt", content: "must not land" } })}`,
    execution: "local" as const,
    permissionProfile: "standard" as const,
    budget: { maxDurationMin: 1 },
    overlapPolicy: "skip" as const,
    catchUpPolicy: "skip" as const,
    notify: { system: false },
    enabled: true,
    createdAt: new Date().toISOString(),
  }
  assert(saveAutomation(task).ok, "automation fixture must validate")
  startAutomationScheduler({ awaitServer: async () => ({ url, username: "opencode", password }) })
  const originalHandle = ipcMain.handle.bind(ipcMain),
    registered = new Set<string>()
  ipcMain.handle = (channel, handler) => {
    registered.add(channel)
    originalHandle(channel, async (event, ...args) => {
      if (channel === "workspace-open-record") record("record-ipc", { input: args[0] })
      const reply = await handler(event, ...args)
      if (channel === "workspace-write-probe") record("probe-reply", { input: args[0], reply })
      if (channel === "open-directory-picker") record("picker-reply", { reply })
      return reply
    })
  }
  registerIpcHandlers({
    killSidecar: () => listener!.stop(),
    sidecarGenerationState: () => generation,
    probeWorkspaceWrite: (input) => tracker.probeWrite(input, listener),
    grantWorkspaceWrite: async (input) => {
      await tracker.grantWrite(input, listener)
    },
    fenceWorkspaces: tracker,
    relaunch: () => {
      throw new Error("unexpected relaunch")
    },
    awaitInitialization: async () => ({ url }),
    consumeInitialDeepLinks: (id) => links.consumeInitial(id),
    acknowledgeDeepLinks: (id, batch) => links.acknowledge(id, batch),
    getDefaultServerUrl: () => null,
    setDefaultServerUrl: () => {},
    getDisplayBackend: async () => null,
    setDisplayBackend: () => {},
    parseMarkdown: (value) => value,
    checkAppExists: () => false,
    resolveAppPath: async () => null,
    updater: {
      subscribe: () => () => {},
      getState: () => ({ status: "disabled" }),
      check: async () => {},
      install: async () => {},
    } as never,
    showUpdater: () => {},
    setBackgroundColor: () => {},
    exportDebugLogs: async () => "",
    recordFatalRendererError: (value) => record("renderer-fatal", { value }),
    auth: {
      getState: () => ({ status: "logged-out", mode: "byok" }),
      start: async () => {
        throw new Error("unexpected login")
      },
      logout: async () => {
        throw new Error("unexpected logout")
      },
      setMode: async () => {
        throw new Error("unexpected account switch")
      },
      enableProxy: () => {},
    },
  })
  const settings = createSettingsAdapter(join(userData, "window-settings"))
  const support: Record<string, () => unknown> = {
    "codepuppy-contract-health": () => null,
    "models-catalog": () => getEffectiveCatalog(engineData),
    "codepuppy-catalog-health": () => ({ platform: null, byok: null }),
    "providers-key-status": () => ({}),
    "account-summary": () => ({ error: "not logged in" }),
    "settings-read": () => settings.read(),
    "codepuppy-endpoints": () => ({}),
    "ext-factory-skill-ids": () => [],
    "ext-config-health": () => ({ broken: false }),
    "app-version": () => app.getVersion(),
    "build-identity": () => ({
      version: app.getVersion(),
      channel: "dev",
      commit: "fixture",
      origin: "local",
      date: "",
    }),
    "automations-list": () => ({
      tasks: listAutomations().map((value) => ({
        ...value,
        nextFireAt: getPlannedFireAt(value.id),
        running: isAutomationRunning(value.id),
      })),
      state: readAutomationState(),
      loginItem: false,
    }),
    "automations-cloud-sync": () => ({ schedules: [], pulled: [] }),
    "ext-cloud-withheld": () => true,
  }
  for (const [channel, value] of Object.entries(support)) if (!registered.has(channel)) ipcMain.handle(channel, value)
  win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      preload: join(app.getAppPath(), "out/preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      backgroundThrottling: false,
    },
  })
  trackRendererLifecycle(win.webContents, links)
  win.webContents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) loads++
  })
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) (report.console as unknown[]).push(message)
  })
  win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) =>
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        ...(details.url.startsWith(url) ? { Authorization: engineAuthorization(password) } : {}),
      },
    }),
  )
  await win.loadURL("about:blank")
  win.webContents.debugger.attach("1.3")
  await win.webContents.debugger.sendCommand("Page.enable")
  await win.webContents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem('codepuppy.onboarding.done','1');window.__cpInputs=JSON.parse(sessionStorage.getItem('window-fixture-inputs')||'[]');for(const kind of ['click','keydown'])document.addEventListener(kind,e=>{window.__cpInputs.push({type:kind,trusted:e.isTrusted,text:e.target.textContent?.slice(0,80),key:e.key});sessionStorage.setItem('window-fixture-inputs',JSON.stringify(window.__cpInputs))},true)`,
  })
  await win.loadFile(join(app.getAppPath(), "out/renderer/index.html"))
  await waitFor(() => evaluate<boolean>("!!document.querySelector('[data-codepuppy-home]')"), "production home mount")
  const project = (name: string) =>
    `document.querySelector(${JSON.stringify(`.codepuppy-project-name[title="${directories[name]}"]`)})`
  await waitFor(() => evaluate<boolean>(`!!${project("R1")}`), "seeded project sidebar")
  const baseline = { loads, pid: engine!.pid }
  const normal = async (name: string, directory: string) => {
    await waitFor(() => tracker.userOpened.has("sidecar", directory), `${name} recorded`)
    await waitFor(
      () =>
        events.some(
          (event) =>
            event.event === "probe-reply" &&
            (event.input as { directory?: string }).directory === directory &&
            (event.reply as { outcome?: string }).outcome === "writable",
        ),
      `${name} renderer probe writable`,
    )
    await waitFor(
      () =>
        evaluate<boolean>(
          "!document.querySelector('[data-codepuppy-workspace-readonly],[data-codepuppy-workspace-chip-readonly]')",
        ),
      `${name} no readonly hooks`,
    )
    assert(await modelWrite(directory, `window-${name}.txt`), `${name}: actual model did not write`)
    assert(readFileSync(join(directory, `window-${name}.txt`), "utf8") === "window", `${name}: wrong file body`)
    assert(loads === baseline.loads && engine!.pid === baseline.pid, `${name}: engine/window changed`)
    ;(report.arms as unknown[]).push({
      name,
      directory,
      loads,
      enginePid: engine!.pid,
      files: readdirSync(directory).filter((file) => file.startsWith("window-")),
    })
    record("arm-passed", { name })
  }
  assert(
    (await tracker.probeWrite({ server: "sidecar", directory: directories.M1 }, listener)).outcome === "denied",
    "M1 calibration must deny",
  )
  assert(!(await modelWrite(directories.M1, "before.txt")), "unopened calibration model wrote")
  await pick(directories.M1)
  await normal("M1", directories.M1)
  await click(`${project("R1")}.closest('.codepuppy-project').querySelector('button[title="在此项目新对话"]')`)
  await normal("R1", directories.R1)
  await click(project("R2"))
  await click(`document.querySelector(${JSON.stringify(`a[href$="/session/${seeds.R2}"]`)})`)
  await normal("R2", directories.R2)
  await click("document.querySelector('button[title=\"首页\"]')")
  await waitFor(() => evaluate<boolean>("!!document.querySelector('.a-ws-chip')"), "home chip")
  await click("document.querySelector('.a-ws-chip')")
  await waitFor(
    () => evaluate<boolean>("[...document.querySelectorAll('.a-pop-item')].some(el=>el.textContent.includes('R3'))"),
    "chip choices",
  )
  await click("[...document.querySelectorAll('.a-pop-item')].find(el=>el.textContent.includes('R3'))")
  await normal("R3", directories.R3)
  await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "k",
    code: "KeyK",
    windowsVirtualKeyCode: 75,
    modifiers: 4,
  })
  await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "k",
    code: "KeyK",
    windowsVirtualKeyCode: 75,
    modifiers: 4,
  })
  await waitFor(
    () => evaluate<boolean>("!!document.querySelector('[data-codepuppy-session-search-input]')"),
    "search open",
  )
  await click("document.querySelector('[data-codepuppy-session-search-input]')")
  await win.webContents.debugger.sendCommand("Input.insertText", { text: "Window R4" })
  await waitFor(
    () => evaluate<boolean>(`!!document.querySelector('[data-codepuppy-session-search-result="${seeds.R4}"]')`),
    "search result",
  )
  await click(`document.querySelector('[data-codepuppy-session-search-result="${seeds.R4}"]')`)
  await normal("R4", directories.R4)
  await waitFor(() => !!getAutomation(task.id)?.history?.[0]?.sessionID, "real automatic run history")
  assert(!tracker.userOpened.has("sidecar", directories.R5), "automatic run must not register")
  assert(!existsSync(join(directories.R5, "auto-before.txt")), "automatic run must not write arbitrary target")
  report.automaticRun = getAutomation(task.id)?.history?.[0]
  await click('document.querySelector(\'button[title="自动化"],button[aria-label="自动化"]\')')
  await waitFor(() => evaluate<boolean>("!!document.querySelector('.codepuppy-auto-row')"), "automation history list")
  await click("document.querySelector('.codepuppy-auto-row')")
  await waitFor(
    () => evaluate<boolean>("!!document.querySelector('.codepuppy-auto-hist .codepuppy-ext-link')"),
    "automation history loaded",
  )
  assert(!tracker.userOpened.has("sidecar", directories.R5), "history load must not register")
  await click("document.querySelector('.codepuppy-auto-hist .codepuppy-ext-link')")
  await normal("R5", directories.R5)
  // Delay genuine response bytes over CDP, including the new session's directory lookup.
  const delays: Array<{ kind: string; elapsedMs: number }> = []
  let delayedSession = ""
  let reloadSession = ""
  let reloadPaused = false
  let directoryGate: Promise<void> | undefined
  const paused = new Set<string>()
  win.webContents.debugger.on("message", (_event, method, params) => {
    if (method !== "Fetch.requestPaused") return
    paused.add(params.requestId)
    void (async () => {
      const pathname = new URL(params.request.url).pathname
      const kind =
        reloadSession && params.request.method === "GET" && pathname === `/api/session/${reloadSession}`
          ? "reload"
          : params.request.method === "POST" && pathname === "/api/session"
            ? "creation"
            : params.request.method === "GET" && pathname === `/api/session/${delayedSession}`
              ? "directory"
              : undefined
      if (kind) {
        if (kind === "creation") {
          const response = await win!.webContents.debugger.sendCommand("Fetch.getResponseBody", {
            requestId: params.requestId,
          })
          delayedSession = JSON.parse(
            response.base64Encoded ? Buffer.from(response.body, "base64").toString() : response.body,
          ).data.id
        }
        if (kind === "reload") reloadPaused = true
        const start = performance.now()
        if (kind === "creation") await new Promise((resolve) => setTimeout(resolve, 8200))
        if (kind !== "creation") {
          directoryGate ??= new Promise((resolve) => setTimeout(resolve, 8200))
          await directoryGate
        }
        delays.push({ kind, elapsedMs: performance.now() - start })
        record("response-delay", delays.at(-1)!)
      }
      await win!.webContents.debugger.sendCommand("Fetch.continueResponse", { requestId: params.requestId })
    })()
      .catch(finish)
      .finally(() => paused.delete(params.requestId))
  })
  await win.webContents.debugger.sendCommand("Fetch.enable", {
    patterns: [{ urlPattern: `${url}/api/session*`, requestStage: "Response" }],
  })
  await click(`${project("slow")}.closest('.codepuppy-project').querySelector('button[title="在此项目新对话"]')`)
  await normal("slow-open", directories.slow)
  assert(
    delays.some((value) => value.kind === "creation" && value.elapsedMs > 8000),
    "creation reply was not delayed beyond 8s",
  )
  assert(
    delays.some((value) => value.kind === "directory" && value.elapsedMs > 8000),
    "directory resolution was not delayed beyond 8s",
  )
  const released = events.find((event) => event.event === "response-delay" && event.kind === "directory")
  const observed = events.find(
    (event) => event.event === "probe-reply" && (event.input as { directory?: string }).directory === directories.slow,
  )
  assert(Number(observed?.ms) >= Number(released?.ms), "slow directory was observed before its delayed response")
  await waitFor(() => paused.size === 0, "slow response delivery")
  await win.webContents.debugger.sendCommand("Fetch.disable")
  report.delays = delays
  // The SQL and shell request shapes are the actual attack used by project-writable.engine.cases.ts.
  const place = await evaluate<{ route: string }>("JSON.parse(sessionStorage.getItem('codepuppy.place.v1'))")
  const selected = /\/session\/([^/?]+)/.exec(place.route)?.[1]
  assert(selected, "slow open did not navigate to a real session")
  const rewrite = async (session: string, directory: string) => {
    const sql = `UPDATE session_v2 SET directory='${directory.replace(/'/g, "''")}' WHERE id='${session}';`
    await modelShell(directories.R1, `/usr/bin/sqlite3 ${shellQuote(join(engineData, "engine.db"))} ${shellQuote(sql)}`)
    assert(
      (await api("GET", `/api/session/${session}`)).data.location.directory === directory,
      "model SQL did not rewrite the real session",
    )
  }
  const recordCount = () => events.filter((event) => event.event === "record-ipc").length
  const unchangedRecords = recordCount()
  await rewrite(selected, directories.rewritten)
  reloadSession = selected
  directoryGate = undefined
  await win.webContents.debugger.sendCommand("Fetch.enable", {
    patterns: [{ urlPattern: `${url}/api/session/${selected}*`, requestStage: "Response" }],
  })
  win.webContents.reload()
  await waitFor(() => reloadPaused, "forced reload directory lookup paused")
  await click("document.querySelector('.codepuppy-sidebar-section > span:first-child')")
  assert(
    !tracker.userOpened.has("sidecar", directories.rewritten),
    "unrelated trusted click registered rewritten target",
  )
  await waitFor(
    () =>
      events.some(
        (event) =>
          event.event === "probe-reply" && (event.input as { directory?: string }).directory === directories.rewritten,
      ),
    "rewritten target reached the real host",
  )
  await waitFor(() => paused.size === 0, "reload response delivery")
  await win.webContents.debugger.sendCommand("Fetch.disable")
  assert(!(await modelWrite(directories.rewritten, "rewritten.txt")), "rewritten directory became writable")
  const rewrittenCopy = await inspectResidualSentence("not-opened-by-you")
  assert(recordCount() === unchangedRecords, "restore/reload recorded an open")
  assert(
    !readWorkspaceTruthOrThrow(truthPath, { readFileSync }).includes(directories.rewritten),
    "truth accepted model directory",
  )
  ;(report.arms as unknown[]).push({
    name: "rewritten-reload",
    reason: "not-opened-by-you",
    ...rewrittenCopy,
    loads,
    enginePid: engine!.pid,
    files: readdirSync(directories.rewritten).filter((file) => file !== ".git"),
    recorded: false,
  })
  await rewrite(selected, directories.slow)
  reloadSession = ""
  const beforeHonest = loads
  win.webContents.reload()
  await waitFor(() => loads > beforeHonest, "honest document reload")
  await waitFor(
    () =>
      evaluate<boolean>(
        "!!document.querySelector('[data-codepuppy-session-workspace]') && !document.querySelector('[data-codepuppy-workspace-readonly],[data-codepuppy-workspace-chip-readonly]')",
      ),
    "honest reload writable DOM",
  )
  assert(recordCount() === unchangedRecords, "honest reload added eligibility")
  assert(await modelWrite(directories.slow, "honest.txt"), "honest reload lost writable project")
  assert(engine!.pid === baseline.pid, "reload changed engine generation")
  ;(report.arms as unknown[]).push({ name: "honest-reload", loads, enginePid: engine!.pid, recorded: false })
  baseline.loads = loads

  const residual = async (
    name: string,
    directory: string,
    reason: "home-or-app-state" | "not-opened-by-you" | "grant-failed",
  ) => {
    await waitFor(
      () =>
        events.some(
          (event) =>
            event.event === "probe-reply" &&
            (event.input as { directory?: string }).directory === directory &&
            (event.reply as { reason?: string }).reason === reason,
        ),
      `${name} reason from main`,
    )
    const copy = await inspectResidualSentence(reason)
    assert(!(await modelWrite(directory, `${name}.txt`)), `${name} model unexpectedly wrote`)
    assert(engine!.pid === baseline.pid, `${name} changed engine generation`)
    ;(report.arms as unknown[]).push({
      name,
      directory,
      reason,
      ...copy,
      loads,
      enginePid: engine!.pid,
    })
  }
  await pick(home)
  await residual("home-or-app-state", home, "home-or-app-state")
  grantFault = "native"
  await pick(directories.failed)
  await residual("grant-failed-native", directories.failed, "grant-failed")
  assert(
    events.some((event) => event.event === "native-failure" && event.step === "task_name_for_pid"),
    "native arm did not hit real task_name_for_pid failure",
  )
  grantFault = "timeout"
  await pick(directories.timeout)
  await residual("grant-failed-timeout", directories.timeout, "grant-failed")
  assert(
    events.some((event) => event.event === "grant-dropped"),
    "timeout arm did not drop a real grant message",
  )
  grantFault = undefined
  // Spec v3: a rewritten session restored by the current layout is a reachable,
  // unregistered directory. Reload is setup; the subsequent picker must not reload again.
  const currentPlace = await evaluate<{ route: string }>("JSON.parse(sessionStorage.getItem('codepuppy.place.v1'))")
  const restoredSession = /\/session\/([^/?]+)/.exec(currentPlace.route)?.[1]
  assert(restoredSession, "residual session route missing")
  await rewrite(restoredSession, directories.rewritten)
  const beforeRestore = loads
  win.webContents.reload()
  await waitFor(() => loads > beforeRestore, "AC-08 rewritten session restored")
  await residual("restored-before", directories.rewritten, "not-opened-by-you")
  const before = {
    enginePid: engine!.pid,
    rendererPid: win.webContents.getOSProcessId(),
    loads,
    registered: tracker.userOpened.has("sidecar", directories.rewritten),
    files: readdirSync(directories.rewritten).filter((file) => file !== ".git"),
  }
  assert(!before.registered && before.files.length === 0, "restored target was granted before the picker")
  assert(
    !readWorkspaceTruthOrThrow(truthPath, { readFileSync }).includes(directories.rewritten),
    "restored target entered truth before the picker",
  )
  baseline.loads = loads
  await pick(directories.rewritten)
  await normal("restored-after", directories.rewritten)
  report.restoredOpen = {
    directory: directories.rewritten,
    before,
    after: {
      enginePid: engine!.pid,
      rendererPid: win.webContents.getOSProcessId(),
      loads,
      registered: tracker.userOpened.has("sidecar", directories.rewritten),
      files: readdirSync(directories.rewritten).filter((file) => file !== ".git"),
    },
  }
  report.passed = true
  report.dom = await evaluate("document.body.innerText")
  await finish()
}
void app.whenReady().then(run).catch(finish)
setTimeout(() => void finish(new Error("window harness deadline")), 180_000).unref()
