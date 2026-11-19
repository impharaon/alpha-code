// G0 main harness. It replaces only a generated main entry before packaging/signing.
// All sidecars below execute the packaged production sidecar.js, not a test engine substitute.
import { app, utilityProcess } from "electron"
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { buildCodePuppyBootstrap } from "../../../src/main/codepuppy-bootstrap-build"
import { engineAuthorization } from "../../../src/main/engine-authorization"
import { loadFenceAddon } from "../../../src/main/process-fence-apply"
import { renderProcessFenceProfile, resolveEngineRoots, WORKSPACE_WRITE_EXTENSION_CLASS } from "../../../src/main/process-fence-profile"
import { buildWriteProbeCommand, createWriteGrantRequester, parseWriteProbeReply } from "../../../src/main/workspace-write-probe"

const run = process.env.CODEPUPPY_G0_RUN!
const reportPath = process.env.CODEPUPPY_G0_REPORT!
app.setPath("userData", process.env.CODEPUPPY_G0_USER_DATA!)
app.setAppLogsPath(join(run, "app-logs"))
app.dock?.hide()
const report: Record<string, unknown> = { mainPid: process.pid, runtime: process.versions, arms: {} }
const arms = report.arms as Record<string, unknown>
const children: ReturnType<typeof utilityProcess.fork>[] = []
const events: Array<Record<string, unknown>> = []
const record = (event: string, data: Record<string, unknown> = {}) => events.push({ event, ms: performance.now(), ...data })
function assert(ok: unknown, why: string): asserts ok { if (!ok) throw new Error(why) }
const waitFor = async (condition: () => boolean, why: string, timeout = 30_000) => {
  const deadline = Date.now() + timeout
  while (!condition()) {
    assert(Date.now() < deadline, `G0 timeout: ${why}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
const quote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`
const addonPath = join(process.resourcesPath, "codepuppy-fence/codepuppy_fence.node")
const helper = join(app.getAppPath(), "out/main/chunks/assets/g0-issue-probe").replace("app.asar/", "app.asar.unpacked/")
const password = "g0-isolated-test"

async function boot(name: string, variant = "production") {
  const root = join(run, name)
  const A = join(root, "A")
  const B = join(root, "B")
  const C = join(root, "C")
  const home = join(root, "home")
  const userData = join(root, "user-data")
  const globalRoot = join(root, "codepuppy-state/env/dev")
  for (const dir of [A, B, C, home, userData, globalRoot]) mkdirSync(dir, { recursive: true })
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: join(userData, "tmp"),
    XDG_DATA_HOME: join(home, "data"), XDG_CACHE_HOME: join(home, "cache"), XDG_CONFIG_HOME: join(home, "config"), XDG_STATE_HOME: join(home, "state"),
    NO_COLOR: "1",
  }
  // These parents are outside the opencode-only write roots. Prepare the isolated
  // installation layout before the production sidecar installs its fence.
  for (const directory of [env.XDG_DATA_HOME, env.XDG_CACHE_HOME, env.XDG_CONFIG_HOME, env.XDG_STATE_HOME]) {
    mkdirSync(join(directory, "opencode"), { recursive: true })
  }
  mkdirSync(env.TMPDIR, { recursive: true })
  let profile = renderProcessFenceProfile({ workspaces: [A], codepuppyGlobalRoot: globalRoot, userDataPath: userData, stateHome: env.XDG_STATE_HOME, roots: resolveEngineRoots(env, home), egressProxyPort: 59999 })
  if (variant === "file-only") profile = profile.replace(/\(deny file-issue-extension[\s\S]*?\(extension-class "[^"]+"\)\)/, `(deny file-issue-extension (extension-class "${WORKSPACE_WRITE_EXTENSION_CLASS}"))`)
  if (variant === "no-deny") profile = profile.replace(/\(deny file-issue-extension[\s\S]*?\(extension-class "[^"]+"\)\)/, "")
  // Keep the test helper outside asar: it is an independently executed Mach-O signed with the package.
  const child = utilityProcess.fork(join(app.getAppPath(), "out/main/sidecar.js"), [], { cwd: A, env, stdio: "pipe" })
  children.push(child)
  const log: string[] = []
  child.stdout?.on("data", (chunk) => log.push(String(chunk)))
  child.stderr?.on("data", (chunk) => log.push(String(chunk)))
  let ready = false
  let failure = ""
  let exited: number | undefined
  let pid: number | undefined
  child.once("spawn", () => { pid = child.pid; record("engine-spawn", { name, pid }) })
  const grants = createWriteGrantRequester((command) => child.postMessage(command))
  const probes = new Map<number, (outcome: string) => void>()
  let seq = 100_000
  child.on("message", (message) => {
    if (grants.receive(message)) return
    const probe = parseWriteProbeReply(message)
    if (probe) { probes.get(probe.id)?.(probe.outcome); probes.delete(probe.id); return }
    if (message?.type === "ready") { ready = true; record("engine-ready", { name, pid: child.pid }) }
    if (message?.type === "error") failure = message.error.message
  })
  child.on("exit", (code) => { exited = code; grants.close(`exit ${code}`); record("engine-exit", { name, pid, code }) })
  const port = 40000 + Math.floor(Math.random() * 10000)
  child.postMessage({
    type: "start", hostname: "127.0.0.1", port, password, fence: { profile, addonPath },
    bootstrap: buildCodePuppyBootstrap({
      userDataPath: userData, globalRoot, userConfig: join(globalRoot, "codepuppy.jsonc"), initialDirectory: A,
      databasePath: join(userData, "engine.db"), engineConfigDirectory: join(userData, "engine-config"),
      extPluginPath: join(process.resourcesPath, "codepuppy-ext"), officeMcpManifest: join(root, "office-tools.json"),
      factorySkillDirs: [], env: { CODEPUPPY_JSONC_TRUTH_DISABLE: "1", CODEPUPPY_MODELS_DISABLE: "1", OPENCODE_ENABLE_FILEWATCH: "0" }, log: (line) => log.push(line),
    }),
  })
  await waitFor(() => ready || !!failure || exited !== undefined, `${name} engine ready`, 90_000)
  assert(ready, `${name}: ${failure || `exit ${exited}`}\n${log.join("").slice(-5000)}`)
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { authorization: engineAuthorization(password), "content-type": "application/json", "x-opencode-directory": encodeURIComponent(A) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    assert(response.ok, `${name}: ${method} ${path} ${response.status} ${text.slice(0, 500)}`)
    return text ? JSON.parse(text) : undefined
  }
  const shell = async (command: string) => {
    const session = await api("POST", "/api/session", { location: { directory: A } })
    await api("POST", `/api/session/${session.data.id}/shell`, { command })
    return session.data.id as string
  }
  const probe = (directory: string) => new Promise<string>((resolve) => {
    const id = ++seq
    probes.set(id, resolve)
    child.postMessage(buildWriteProbeCommand(id, directory))
    setTimeout(() => { if (!probes.has(id)) return; probes.delete(id); resolve("timeout") }, 5000).unref()
  })
  const stop = async () => {
    child.postMessage({ type: "stop" })
    await waitFor(() => exited !== undefined, `${name} stop`, 10_000)
    assert(exited === 0, `${name}: stop exited ${exited}`)
    writeFileSync(join(root, "sidecar.log"), log.join(""))
  }
  return { child, A, B, C, root, grants, shell, probe, stop, files: () => ({ B: readdirSync(B).sort(), C: readdirSync(C).sort() }) }
}

async function runGate() {
  const addon = loadFenceAddon(addonPath)
  report.addon = { path: addonPath, buildId: addon.buildId }
  const startExisting = async (engine: Awaited<ReturnType<typeof boot>>) => {
    const command = `echo $$ > ${quote(join(engine.A, "child.pid"))}; echo ready > ${quote(join(engine.A, "ready"))}; n=0; while [ ! -f ${quote(join(engine.A, "go"))} ] && [ $n -lt 500 ]; do sleep 0.02; n=$((n+1)); done; echo x > ${quote(join(engine.B, "existing.txt"))}; echo x > ${quote(join(engine.C, "existing.txt"))}; echo $? > ${quote(join(engine.A, "child.exit"))}`
    let failed: unknown
    // The production shell endpoint waits for completion. Keep the HTTP call in flight
    // while observing the child's ready marker, then join it only after releasing go.
    const pending = engine.shell(command).catch((error) => { failed = error })
    await waitFor(() => !!failed || existsSync(join(engine.A, "ready")), "exec child ready")
    if (failed) throw failed
    const pid = Number(readFileSync(join(engine.A, "child.pid"), "utf8"))
    process.kill(pid, 0)
    record("child-ready", { pid, enginePid: engine.child.pid })
    return { pid, pending }
  }
  const finishWrites = async (engine: Awaited<ReturnType<typeof boot>>, existing: Awaited<ReturnType<typeof startExisting>>) => {
    writeFileSync(join(engine.A, "go"), "go")
    await existing.pending
    await waitFor(() => existsSync(join(engine.A, "child.exit")), "existing child write")
    record("existing-write", { pid: Number(readFileSync(join(engine.A, "child.pid"), "utf8")), exit: Number(readFileSync(join(engine.A, "child.exit"), "utf8")) })
    await engine.shell(`echo $$ > ${quote(join(engine.A, "new.pid"))}; echo x > ${quote(join(engine.B, "new.txt"))}; echo $? > ${quote(join(engine.A, "new.exit"))}`)
    await waitFor(() => existsSync(join(engine.A, "new.exit")), "new child write")
    record("new-write", { pid: Number(readFileSync(join(engine.A, "new.pid"), "utf8")), exit: Number(readFileSync(join(engine.A, "new.exit"), "utf8")) })
  }
  const engine = await boot("granted")
  assert(await engine.probe(engine.B) === "denied", "B must be denied before grant")
  assert(await engine.probe(engine.C) === "denied", "C must be denied before grant")
  const existing = await startExisting(engine)
  record("issue-start", { pid: engine.child.pid })
  const issued = addon.issueFileExtensionToProcess(WORKSPACE_WRITE_EXTENSION_CLASS, engine.B, engine.child.pid!)
  if (issued.token === null) throw new Error(`G0 issue failed: step=${issued.step} errno=${issued.errno}`)
  const token = issued.token
  const before = performance.now()
  const granted = await engine.grants.request(token)
  record("consume", { pid: engine.child.pid, outcome: granted.outcome, roundTripMs: performance.now() - before })
  assert(granted.outcome === "granted", `G0 consume failed: ${granted.detail}`)
  const mainReplay = addon.consumeExtension(token)
  assert(mainReplay.handle === -1, "unfenced main must not consume the bound token")
  await finishWrites(engine, existing)
  assert(await engine.probe(engine.B) === "writable", "B must be writable after consume")
  assert(await engine.probe(engine.C) === "denied", "C must remain denied")
  arms.granted = { pid: engine.child.pid, existingPid: existing.pid, files: engine.files(), grant: granted, mainReplay }
  await engine.stop()

  const replay = await boot("replay")
  const replayResult = await replay.grants.request(token)
  assert(replayResult.outcome === "failed", "new generation must not consume the previous token")
  assert(await replay.probe(engine.B) === "denied", "previous B must remain denied in new generation")
  arms.replay = { pid: replay.child.pid, result: replayResult, files: replay.files(), originalFiles: engine.files() }
  await replay.stop()

  const control = await boot("control")
  const controlChild = await startExisting(control)
  record("no-consume", { pid: control.child.pid })
  await finishWrites(control, controlChild)
  arms.control = { pid: control.child.pid, existingPid: controlChild.pid, files: control.files() }
  const forged = await control.grants.request("G0-forged-not-a-token")
  assert(forged.outcome === "failed", "forged token must fail")
  assert(await control.probe(control.B) === "denied", "forged token must not make B writable")
  await control.stop()

  for (const [name, variant, kind] of [["selfIssue", "production", "all"], ["badFileOnly", "file-only", "generic"], ["badNoDeny", "no-deny", "file"]]) {
    const attack = await boot(name!, variant)
    const output = join(attack.A, "attack.jsonl")
    await attack.shell(`${quote(helper)} ${quote(WORKSPACE_WRITE_EXTENSION_CLASS)} ${quote(attack.C)} ${quote(kind!)} > ${quote(output)}; echo $? > ${quote(join(attack.A, "attack.exit"))}`)
    await waitFor(() => existsSync(join(attack.A, "attack.exit")), `${name} attack`)
    const results = readFileSync(output, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    assert(results.length > 0, `${name}: attack did not execute`)
    if (kind === "all") {
      assert(results.length === 50, `self-issue matrix expected 50 arms, got ${results.length}`)
      for (const result of results) {
        assert(result.writeErrno === 1, `${name}: ${JSON.stringify(result)}`)
        const allowedToken = ["legacy-file", "legacy-mach", "bit0"].includes(result.kind)
        assert(result.issued === allowedToken, `${name}: unexpected issue result ${JSON.stringify(result)}`)
        if (result.kind === "bit0") assert(result.handle === 0, "flags=0x1 consumes handle 0 without granting writes")
      }
    }
    arms[name!] = { pid: attack.child.pid, exit: Number(readFileSync(join(attack.A, "attack.exit"), "utf8")), results, files: attack.files() }
    await attack.stop()
  }
  report.events = events
  report.passed = true
}

function finish(error?: unknown) {
  if (error) report.error = error instanceof Error ? error.message : String(error)
  report.events = events
  for (const child of children) child.kill()
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  app.exit(report.error ? 1 : 0)
}

// Finish loading the harness entry before starting its ready callback.
const readyDeadline = setTimeout(() => finish(new Error("G0 harness did not reach app.ready")), 15_000)
void app.whenReady().then(async () => {
  clearTimeout(readyDeadline)
  record("main-ready", { pid: process.pid })
  await runGate()
}).then(() => finish(), finish)
