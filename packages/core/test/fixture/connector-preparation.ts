// Isolated Host for module integration. npm normalization/capture/binding and Location
// IO are real; controlled processes replace only application-owned CLI dispatch and Python probes.
import path from "node:path"
import { strict as assert } from "node:assert"
import { mkdirSync, writeFileSync, readdirSync, existsSync, symlinkSync, rmSync } from "node:fs"
import { Deferred, Effect, Fiber, Layer, PlatformError, References, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Environment } from "@opencode/core/environment/index"
import { prepareConnectorLaunch } from "@opencode/core/mcp/codepuppy-connector-launch"
import { ConnectorPreparationProgress, observeConnectorLaunch } from "@opencode/core/mcp/codepuppy-connector-diagnostic"
import { publishConnectorLaunchHost } from "@opencode/util/codepuppy-connector-launch"
import type { ConnectorLaunchHost, LauncherEnvironment, PreparationProgress } from "@opencode/util/codepuppy-connector-launch"
import { canonicalJsonDigest } from "@opencode/util/codepuppy-hash"
import { hostEnvironmentLayer } from "./environment"

const input = JSON.parse(process.argv[2]!) as { root: string; scenario: string; launchers: LauncherEnvironment; version: string; source: string }
const root = input.root
const launchers = { ...input.launchers, packageManagerEnv: { UV_PYTHON_INSTALL_DIR: path.join(root, "managed") }, environment: { ...input.launchers.environment, TMPDIR: path.join(root, "tmp"), XDG_CACHE_HOME: path.join(root, "cache") } }
const python = path.join(launchers.packageManagerEnv.UV_PYTHON_INSTALL_DIR, "bin/python3.12")
mkdirSync(path.dirname(python), { recursive: true })
const receipt = path.join(root, "python", canonicalJsonDigest({ pinSet: launchers.pinSet, id: launchers.pythonFileId }).slice(7) + ".json")
if (!input.scenario.startsWith("download")) {
  mkdirSync(path.dirname(receipt), { recursive: true })
  writeFileSync(receipt, JSON.stringify({ schema: 1, pinSet: launchers.pinSet, id: launchers.pythonFileId, path: python }))
  writeFileSync(path.join(root, "installed"), "uv skips an already-installed directory")
  if (input.scenario !== "damaged-python") symlinkSync(process.execPath, python)
}
if (input.scenario === "damaged-stdlib") writeFileSync(path.join(root, "broken-stdlib"), "controlled health failure")
writeFileSync(path.join(path.dirname(path.dirname(launchers.npmCli)), "lib/cli.js"), String.raw`
module.exports = async process => {
 const fs=require('node:fs'),path=require('node:path'),root=process.env.OWN_ROOT
 if(process.env.OWN_BLOCK==='true'&&!fs.existsSync(path.join(root,'release'))){
  await new Promise(resolve=>{const watcher=fs.watch(root,()=>{if(fs.existsSync(path.join(root,'release'))){watcher.close();resolve()}});process.stderr.write('Owned installer activity\n')})
 }
 process.stderr.write('Owned installer resumed\n')
 const prefix=process.argv[process.argv.indexOf('--prefix')+1]
 fs.mkdirSync(path.join(prefix,'node_modules/.bin'),{recursive:true})
 fs.cpSync(process.env.OWN_SOURCE,path.join(prefix,'node_modules/semver'),{recursive:true})
 fs.copyFileSync(process.env.OWN_MANIFEST,path.join(prefix,'package.json'))
 fs.copyFileSync(process.env.OWN_LOCK,path.join(prefix,'package-lock.json'))
 fs.symlinkSync('../semver/bin/semver.js',path.join(prefix,'node_modules/.bin/semver'))
}
`)
const identity = (attempt: string) => ({ directory: root, server: "owned", attempt })
const progress: Record<string, { stage: string; value: PreparationProgress }[]> = {}
const begun: string[] = [], ended: string[] = []
const installs: ChildProcess.StandardCommand["args"][] = []
let downloads = 0, pythonInstalls = 0, installCount = 0, aborted = 0
let recovering = false
let late: ((received: number, total: number) => void) | undefined
let resolveLate: (() => void) | undefined
const downloaded = Deferred.makeUnsafe<void>(), started = Deferred.makeUnsafe<void>(), joined = Deferred.makeUnsafe<void>()
const live: Effect.Effect<boolean, PlatformError.PlatformError>[] = []
const host: ConnectorLaunchHost = {
  resolveAssets: () => input.scenario === "resolve-cancel" ? new Promise(resolve => { resolveLate = () => resolve(launchers); Effect.runSync(Deferred.succeed(downloaded, undefined)) }) : Promise.resolve(launchers),
  ensureFile: async (_id, signal, report) => {
    downloads++; report(5, 10)
    if (input.scenario === "download-cancel") {
      late = report; Effect.runSync(Deferred.succeed(downloaded, undefined))
      return new Promise(resolve => signal.addEventListener("abort", () => { aborted++; resolve({ result: { ok: false, error: "cancelled" } }) }, { once: true }))
    }
    if (input.scenario === "download-recover" && downloads === 1) return { result: { ok: false, error: "network" }, failure: { kind: "connect", detail: "owned refused download" } }
    if (input.scenario === "download-deterministic") return { result: { ok: false, error: "network" }, failure: { kind: "http", status: 404, detail: "owned missing original" } }
    return { result: { ok: true, path: path.join(root, "verified-archive"), via: "cache" } }
  },
  beginEgress: async value => { begun.push(value.attempt); return { proxyEnvironment: { OWN_EGRESS_ATTEMPT: value.attempt } } },
  endEgress: value => { ended.push(value.attempt) },
  egressEvidence: async value => input.scenario.startsWith("egress") ? [{ identity: input.scenario === "egress-other-attempt" ? identity("other") : { ...value, ...(input.scenario === "egress-other-directory" ? { directory: "/other" } : {}), ...(input.scenario === "egress-other-server" ? { server: "other" } : {}) }, host: input.scenario === "egress-other-host" ? "other.invalid" : "registry.invalid", port: input.scenario === "egress-other-port" ? 8443 : 443, outcome: "refused" }] : [],
  changed() {}, runtimeDependencies: async () => ({ runtimeDep: [], executables: {}, missing: [] }), prepareFiles: async () => ({ ok: false, error: "unknown-file" }),
}
publishConnectorLaunchHost(host)
const layer = Layer.effect(Environment.Service, Effect.gen(function* () {
  const current = yield* Environment.Service
  return Environment.Service.of({ ...current, spawner: ChildProcessSpawner.make(command => Effect.gen(function* () {
    if (command._tag !== "StandardCommand") return yield* current.spawner.spawn(command)
    if (command.command === "/usr/bin/xcode-select") return yield* current.spawner.spawn(ChildProcess.make(process.execPath, ["-e", "process.exitCode=1"], command.options))
    if (command.command === python) return yield* current.spawner.spawn(ChildProcess.make(process.execPath, ["-e", "if(require('node:fs').existsSync(process.argv[1]))process.exitCode=1;else process.stdout.write('3.12.16\\n')", path.join(root, "broken-stdlib")], command.options))
    if (command.command === launchers.uv) {
      installs.push([...command.args])
      if (command.args[0] === "python" && command.args[1] === "install") {
        pythonInstalls++
        const script = "const fs=require('node:fs'),path=require('node:path');const root=process.argv[1],python=process.argv[2];if(!fs.existsSync(path.join(root,'installed'))||process.argv.includes('--reinstall')){fs.mkdirSync(path.dirname(python),{recursive:true});if(!fs.existsSync(python))fs.symlinkSync(process.execPath,python);fs.rmSync(path.join(root,'broken-stdlib'),{force:true});fs.writeFileSync(path.join(root,'installed'),'ready')}"
        return yield* current.spawner.spawn(ChildProcess.make(process.execPath, ["-e", script, root, python, ...command.args], command.options))
      }
      return yield* current.spawner.spawn(ChildProcess.make(process.execPath, ["-e", "process.stdout.write(process.argv[1]+'\\n')", python], command.options))
    }
    let options = command.options
    let installing = false
    if (command.command === launchers.node && options.stdin && typeof options.stdin === "object" && "stream" in options.stdin) {
      const bytes = yield* Stream.mkUint8Array((options.stdin as { stream: Stream.Stream<Uint8Array, PlatformError.PlatformError> }).stream)
      const operation = (JSON.parse(new TextDecoder().decode(bytes)) as { operation?: { kind: string } }).operation
      options = { ...options, stdin: { ...options.stdin, stream: Stream.succeed(bytes) } }
      if (operation?.kind === "install") {
        installCount++; installing = true
        const detail = input.scenario === "deterministic" ? "Requirement source HTTP 404 https://registry.invalid" : "Requirement source HTTP 503 https://registry.invalid"
        const fail = input.scenario === "recover" ? installCount === 1 : ["failed", "failure-restart", "deterministic"].includes(input.scenario) && !recovering || input.scenario.startsWith("egress")
        if (fail) return yield* current.spawner.spawn(ChildProcess.make(process.execPath, ["-e", "process.stderr.write(process.argv[1]);process.exitCode=1", detail], options))
      }
    }
    const handle = yield* current.spawner.spawn(ChildProcess.make(command.command, command.args, options))
    if (!installing) return handle
    live.push(handle.isRunning)
    return { ...handle, stderr: handle.stderr.pipe(Stream.tap(() => Deferred.succeed(started, undefined))) }
  })) })
})).pipe(Layer.provide(hostEnvironmentLayer))
const prepare = (attempt: string) => prepareConnectorLaunch({ runner: "npm-exec", identity: identity(attempt), command: ["npx", "--package=semver@" + input.version, "semver", "1.2.3"], cwd: root, environment: {
  HOME: path.join(root, "home"), PATH: process.env.PATH!, OWN_ROOT: root, OWN_SOURCE: input.source,
  OWN_MANIFEST: new URL("./npm-launch/installed-package.json", import.meta.url).pathname,
  OWN_LOCK: new URL("./npm-launch/installed-package-lock.json", import.meta.url).pathname,
  OWN_BLOCK: ["merge", "cancel-waiter", "cancel-owner", "cancel-owner-peer"].includes(input.scenario) ? "true" : "false",
}, runtimeDep: { runtimeDep: [], executables: {}, missing: [] } }).pipe(Effect.provideService(ConnectorPreparationProgress, (stage, value) => {
  ;(progress[attempt] ??= []).push({ stage, value })
  if (attempt === "second" && stage === "packages" && value.unit === "activity" && value.detail === "Preparing connector packages") Effect.runSync(Deferred.succeed(joined, undefined))
}))
// As connection.ts runs it: inside the attempt's masking observer. The configured registry is itself a masked value.
const observedPrepare = (attempt: string) => Effect.gen(function* () {
  const observed = yield* observeConnectorLaunch({ identity: identity(attempt), requestedCommand: ["npx"], cwd: root, runtimeRoot: root, secrets: ["https://registry.invalid"] })
  return yield* prepare(attempt).pipe(Effect.provideService(Environment.Service, observed.environment))
})
const readyFiles = () => existsSync(path.join(root, "prepared")) ? readdirSync(path.join(root, "prepared")).filter(name => name !== "c".repeat(64) && existsSync(path.join(root, "prepared", name, "ready.json"))) : []
const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  if (["resolve-cancel", "download-cancel"].includes(input.scenario)) {
    const fiber = yield* Effect.forkScoped(Effect.scoped(prepare("first")))
    yield* Deferred.await(downloaded); yield* Fiber.interrupt(fiber)
    const count = progress.first?.length
    late?.(9, 10); resolveLate?.(); yield* Effect.yieldNow
    assert.equal(progress.first?.length, count); assert.equal(installCount, 0); assert.equal(pythonInstalls, 0); assert.equal(readyFiles().length, 0)
    if (input.scenario === "download-cancel") { assert.equal(aborted, 1); assert.ok(progress.first!.some(item => item.value.unit === "bytes" && item.value.completed === 5 && item.value.total === 10)) }
    return { cancelled: true }
  }
  if (["merge", "cancel-waiter", "cancel-owner", "cancel-owner-peer"].includes(input.scenario)) {
    const first = yield* Effect.forkScoped(Effect.scoped(prepare("first")))
    yield* Deferred.await(started)
    if (input.scenario === "cancel-owner") {
      yield* Fiber.interrupt(first)
      assert.ok((yield* Effect.all(live)).every(value => !value)); assert.equal(readyFiles().length, 0)
      const count = progress.first!.length
      writeFileSync(path.join(root, "release"), "continue")
      const value = yield* Effect.scoped(prepare("second"))
      assert.equal(progress.first!.length, count); assert.equal(installCount, 2)
      return { key: value.key, cancelled: true, recovered: true }
    }
    const second = yield* Effect.forkScoped(Effect.scoped(prepare("second")))
    yield* Deferred.await(joined)
    assert.ok(progress.first!.filter(item => item.value.unit === "activity" && item.value.detail === "Preparing connector packages").length >= 2)
    const count = progress.second!.length
    if (input.scenario === "cancel-owner-peer") {
      yield* Fiber.interrupt(first)
      assert.equal(yield* live[0]!, false)
      const previous = progress.first!.length
      writeFileSync(path.join(root, "release"), "continue")
      const value = yield* Fiber.join(second)
      assert.equal(installCount, 2); assert.equal(progress.first!.length, previous)
      return { key: value.key, cancelled: true, recovered: true }
    }
    if (input.scenario === "cancel-waiter") yield* Fiber.interrupt(second)
    assert.equal(installCount, 1)
    writeFileSync(path.join(root, "release"), "continue")
    const a = yield* Fiber.join(first)
    if (input.scenario === "merge") {
      assert.equal((yield* Fiber.join(second)).key, a.key)
      assert.ok(progress.second!.filter(item => item.value.unit === "activity" && item.value.detail === "Preparing connector packages").length >= 2)
    }
    if (input.scenario === "cancel-waiter") assert.equal(progress.second!.length, count)
    assert.equal(installCount, 1)
    return { key: a.key, merged: true }
  }
  const outcome = yield* Effect.scoped(input.scenario === "egress-masked" ? observedPrepare("first") : prepare("first")).pipe(Effect.result)
  if (["failed", "failure-restart", "deterministic", "egress", "egress-masked", "egress-other-attempt", "egress-other-host", "egress-other-port", "egress-other-directory", "egress-other-server", "download-deterministic"].includes(input.scenario)) {
    assert.equal(outcome._tag, "Failure")
    if (outcome._tag !== "Failure") throw Error("expected controlled failure")
    assert.equal(readyFiles().length, 0)
    const kind = ["egress", "egress-masked"].includes(input.scenario) ? "egress" : ["deterministic", "download-deterministic"].includes(input.scenario) ? "unknown" : "download"
    assert.equal(outcome.failure.kind, kind)
    assert.equal(installCount, input.scenario === "download-deterministic" ? 0 : ["egress", "egress-masked", "deterministic"].includes(input.scenario) ? 1 : 2)
    if (input.scenario === "download-deterministic") assert.equal(downloads, 1)
    if (input.scenario === "failure-restart") {
      recovering = true
      yield* Effect.scoped(prepare("second"))
      assert.equal(installCount, 3); assert.equal(readyFiles().length, 1)
      return { failure: outcome.failure, recovered: true }
    }
    return { failure: outcome.failure }
  }
  assert.equal(outcome._tag, "Success", outcome._tag === "Failure" ? JSON.stringify(outcome.failure) : "")
  if (outcome._tag !== "Success") throw Error("expected preparation")
  assert.equal(readyFiles().length, 1)
  if (input.scenario === "recover") assert.equal(installCount, 2)
  if (input.scenario === "download-recover") { assert.equal(downloads, 2); assert.ok(progress.first!.some(item => item.value.unit === "bytes" && item.value.completed === 5 && item.value.total === 10)) }
  if (input.scenario.startsWith("damaged")) { assert.equal(pythonInstalls, 1); assert.ok(installs.some(args => args.includes("--reinstall"))) }
  if (["missing-entry", "invalid-receipt"].includes(input.scenario)) {
    const prefix = path.join(root, "prepared", outcome.success.key)
    if (input.scenario === "missing-entry") rmSync(path.join(prefix, "node_modules/semver/bin/semver.js"))
    if (input.scenario === "invalid-receipt") writeFileSync(path.join(prefix, "ready.json"), "{interrupted write")
    const repaired = yield* Effect.scoped(prepare("repair"))
    assert.equal(repaired.key, outcome.success.key); assert.equal(installCount, 2)
  }
  const before = { downloads, pythonInstalls, installCount }
  const next = yield* Effect.scoped(prepare("second"))
  assert.equal(next.key, outcome.success.key); assert.deepEqual({ downloads, pythonInstalls, installCount }, before)
  return { key: next.key, cached: true }
})).pipe(Effect.provide(layer), Effect.provideService(References.MinimumLogLevel, "None")))
assert.deepEqual([...begun].sort(), [...ended].sort())
assert.ok(!existsSync(path.join(root, "tmp")) || readdirSync(path.join(root, "tmp")).length === 0)
console.log(JSON.stringify({ ...result, installCount, pythonInstalls, downloads, progress: Object.fromEntries(Object.entries(progress).map(([key, value]) => [key, value.length])), begun, ended }))
