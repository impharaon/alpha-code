import path from "node:path"
import { randomUUID } from "node:crypto"
import { Effect, Option, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process"
import type { Scope } from "effect"
import type {
  LauncherEnvironment,
  ConnectorLaunchFailure,
  PackageRunner,
  PreparedLaunch,
  LaunchIdentity,
  RuntimeDependencyFacts,
} from "@opencode/util/codepuppy-connector-launch"
import { connectorLaunchHost, isConnectorLaunchFailure } from "@opencode/util/codepuppy-connector-launch"
import { commandHeadBase } from "@opencode/util/codepuppy-command-head"
import { canonicalJsonDigest } from "@opencode/util/codepuppy-hash"
import { Environment } from "../environment/index.js"
import { connectorNpmDefaults, readNpmLaunchDeclaration, readNpmLaunchEnvironment, normalizeNpmLaunchDeclaration, installNpmConnector } from "./codepuppy-npm-launch.js"
import { parseUvToolSettings, readUvLaunchEnvironment, uvEditableInstallArguments, readUvLaunchDeclaration, normalizeUvLaunchDeclaration, normalizeUvLaunchSnapshotFirst, checkUvPinnedPythonRequest, installUvConnector, uvPythonRequest } from "./codepuppy-uv-launch.js"
import { connectorPreparationKey } from "./codepuppy-connector-key.js"
import { ConnectorPreparationProgress, connectorStderrTargets, connectorUrlTargets } from "./codepuppy-connector-diagnostic.js"
import { classifyStartFailure } from "./codepuppy-startup.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"

const preparationLocks = KeyedMutex.makeUnsafe<string>()
const preparationListeners = new Map<string, Set<typeof ConnectorPreparationProgress.Service>>()
const PreparedPython = Schema.Struct({ schema: Schema.Literal(1), pinSet: Schema.String, id: Schema.String, path: Schema.String })

/** Prepare on this Location before admission to the handshake permits; the caller's Scope owns egress and bindings. */
export function prepareConnectorLaunch(input: {
  runner: PackageRunner
  identity: LaunchIdentity
  command: readonly [string, ...string[]]
  cwd: string
  environment: Record<string, string>
  runtimeDep: RuntimeDependencyFacts
}): Effect.Effect<PreparedLaunch, ConnectorLaunchFailure, Environment.Service | Scope.Scope> {
  return Effect.gen(function* () {
    if (input.runtimeDep.missing[0]) return yield* Effect.fail({ kind: "dependency", program: input.runtimeDep.missing[0] } as const)
    const location = yield* Environment.Service
    const cwd = yield* Environment.typeFollowing(location.files, input.cwd).pipe(Effect.catchTag("Environment.NotFound", () => Effect.succeed(undefined)))
    if (cwd !== "directory") return yield* Effect.fail({ kind: "workspace", reason: "missing" } as const)
    const host = yield* Effect.try({ try: connectorLaunchHost, catch: launchFailure })
    const progress = yield* ConnectorPreparationProgress
    let active = true
    let stage: "launcher" | "python" | "packages" = "launcher"
    let shared: string | undefined
    const report: typeof progress = (next, value) => { if (active) { stage = next; progress(next, value) } }
    const activity = () => {
      const value = { unit: "activity" as const, detail: stage === "python" ? "Preparing pinned Python" : "Preparing connector packages" }
      if (shared) { for (const listener of preparationListeners.get(shared) ?? []) listener(stage, value); return }
      report(stage, value)
    }
    const spawner = ChildProcessSpawner.make(command => location.spawner.spawn(command).pipe(Effect.map(handle => ({ ...handle, stderr: handle.stderr.pipe(Stream.tap(() => Effect.sync(activity))) }))))
    const run = (command: ChildProcess.Command) => Effect.gen(function* () {
      const handle = yield* spawner.spawn(command)
      const [code, stdout, stderr] = yield* Effect.all([handle.exitCode, Stream.mkUint8Array(handle.stdout), Stream.mkUint8Array(handle.stderr)], { concurrency: "unbounded" })
      return { exitCode: Number(code), stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr) }
    })
    const failed = (detail: string) => Effect.gen(function* () {
      const evidence = yield* Effect.tryPromise({ try: () => host.egressEvidence(input.identity), catch: () => undefined }).pipe(Effect.catch(() => Effect.succeed([])))
      // The displayed detail is masked; the attempt's raw stderr keeps the de-credentialed host and port for attribution.
      const targets = [...connectorUrlTargets(detail), ...connectorStderrTargets(input.identity.attempt)]
      const refused = evidence.find(value => value.outcome === "refused" && value.identity.directory === input.identity.directory && value.identity.server === input.identity.server && value.identity.attempt === input.identity.attempt && targets.some(target => target.host === value.host && target.port === value.port))
      if (refused) return { kind: "egress", host: refused.host, port: refused.port } as const
      return classifyStartFailure(undefined, { type: "local" }, { preparation: { stderr: detail } }).failure!
    })
    const retry = <A>(effect: Effect.Effect<A, ConnectorLaunchFailure, Environment.Service | Scope.Scope>) => effect.pipe(Effect.catch(error => Effect.gen(function* () {
      const failure = error.kind === "unknown" ? yield* failed(error.detail) : error
      if (failure.kind !== "download") return yield* Effect.fail(failure)
      return yield* effect.pipe(Effect.mapError(error => error)).pipe(Effect.catch(error => error.kind === "unknown" ? failed(error.detail).pipe(Effect.flatMap(Effect.fail)) : Effect.fail(error)))
    })))
    return yield* Effect.gen(function* () {
      report("launcher", { unit: "activity", detail: "Verifying bundled launchers" })
      const launchers = yield* Effect.tryPromise({ try: () => host.resolveAssets(), catch: launchFailure })
      const platform = launchers.platform === "win32-x64" ? "win32" : "darwin"
      const head = commandHeadBase(input.command[0], platform)
      const name = platform === "win32" ? head.toLowerCase() : head
      if (input.runner === "uv-tool" ? name !== "uv" && name !== "uvx" : name !== "npm" && name !== "npx")
        return yield* Effect.fail({ kind: "unknown", detail: "Package runner does not match the declared command" } as const)
      yield* location.files.mkdir(launchers.runtimeRoot)
      for (const directory of new Set(["TMPDIR", "TMP", "TEMP", "XDG_CACHE_HOME", "XDG_DATA_HOME", "UV_PYTHON_BIN_DIR"].flatMap(key => launchers.environment[key] ? [launchers.environment[key]!] : []))) yield* location.files.mkdir(directory)
      const egress = yield* Effect.acquireRelease(Effect.tryPromise({ try: () => host.beginEgress(input.identity), catch: launchFailure }), () => Effect.sync(() => host.endEgress(input.identity)))
      const inherited = yield* run(ChildProcess.make(launchers.node, ["--input-type=commonjs", "-e", "process.stdout.write(JSON.stringify(process.env))"], { cwd: input.cwd, env: { ...launchers.environment, NODE_OPTIONS: "", PYTHONHOME: "", PYTHONPATH: "", VIRTUAL_ENV: "" }, extendEnv: true }))
      if (inherited.exitCode !== 0) return yield* Effect.fail({ kind: "unknown", detail: inherited.stderr } as const)
      const base = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)))(inherited.stdout).pipe(Effect.mapError((): ConnectorLaunchFailure => ({ kind: "unknown", detail: "Could not read the Location environment" })))
      const environment = (key: string, python?: string) => connectorRunnerEnvironment({ runner: input.runner, launchers, key, python, inherited: base, declared: { ...input.environment, ...egress.proxyEnvironment }, packageBins: [] })
      const initial = environment("0".repeat(64))
      if (input.runtimeDep.runtimeDep.includes("git")) {
        const git = input.runtimeDep.executables.git
        if (!git) return yield* Effect.fail({ kind: "dependency", program: "git" } as const)
        const result = yield* run(ChildProcess.make(git, ["-C", input.cwd, "rev-parse", "--is-inside-work-tree"], { cwd: input.cwd, env: { ...initial, LC_ALL: "C" }, extendEnv: false }))
        if (result.exitCode !== 0) return yield* Effect.fail(/not a git repository/i.test(result.stderr) ? { kind: "workspace", reason: "not-git" } as const : { kind: "unknown", detail: result.stderr } as const)
      }
      report("python", { unit: "activity", detail: "Preparing pinned Python" })
      const pythonReceipt = path.join(launchers.runtimeRoot, "python", canonicalJsonDigest({ pinSet: launchers.pinSet, id: launchers.pythonFileId }).slice("sha256:".length) + ".json")
      const healthyPython = (target: string) => run(ChildProcess.make(target, ["-I", "-S", "-c", "import sys;print(sys.version.split()[0])"], { cwd: input.cwd, env: initial, extendEnv: false })).pipe(
        Effect.map(result => result.exitCode === 0 && result.stdout.trim() === launchers.environment.UV_PYTHON),
        Effect.catch(() => Effect.succeed(false)),
      )
      const readPython = () => Effect.gen(function* () {
        const source = yield* location.files.read(pythonReceipt).pipe(Effect.catchTag("Environment.NotFound", () => Effect.succeed(undefined)))
        if (!source) return
        const value = Schema.decodeUnknownOption(Schema.fromJsonString(PreparedPython))(new TextDecoder().decode(source.bytes))
        if (Option.isNone(value) || value.value.pinSet !== launchers.pinSet || value.value.id !== launchers.pythonFileId) return
        const root = launchers.packageManagerEnv.UV_PYTHON_INSTALL_DIR
        if (!root || !path.isAbsolute(value.value.path)) return
        const relative = path.relative(root, value.value.path)
        if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return
        const kind = yield* Environment.typeFollowing(location.files, value.value.path).pipe(Effect.catchTag("Environment.NotFound", () => Effect.succeed(undefined)))
        return kind === "file" && (yield* healthyPython(value.value.path)) ? value.value.path : undefined
      })
      const cachedPython = yield* readPython()
      const python = cachedPython ?? (yield* Effect.gen(function* () {
        const ensure = Effect.tryPromise({ try: signal => host.ensureFile(launchers.pythonFileId, signal, (completed, total) => report("python", { unit: "bytes", completed, ...(total > 0 ? { total } : {}) })), catch: launchFailure }).pipe(Effect.flatMap(delivery => {
          if (delivery.result.ok) return Effect.succeed(delivery.result.path)
          if (delivery.result.error === "cancelled") return Effect.interrupt
          return Effect.fail(classifyStartFailure(undefined, { type: "local" }, { download: delivery }).failure!)
        }))
        yield* retry(ensure)
        return yield* Effect.gen(function* () {
          const cached = yield* readPython()
          if (cached) return cached
          const result = yield* installConnectorPython({ launchers, cwd: input.cwd, environment: initial })
          if (result.exitCode !== 0) return yield* Effect.fail(yield* failed(result.stderr || result.stdout))
          const found = yield* run(ChildProcess.make(launchers.uv, ["python", "find", launchers.environment.UV_PYTHON!, "--offline"], { cwd: input.cwd, env: initial, extendEnv: false }))
          if (found.exitCode !== 0) return yield* Effect.fail(yield* failed(found.stderr))
          const target = found.stdout.trim()
          const root = launchers.packageManagerEnv.UV_PYTHON_INSTALL_DIR
          const relative = root && path.isAbsolute(target) ? path.relative(root, target) : undefined
          if (relative === undefined || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
            return yield* Effect.fail({ kind: "unknown", detail: "Managed Python resolved outside its bound installation root" } as const)
          if ((yield* Environment.typeFollowing(location.files, target)) !== "file") return yield* Effect.fail({ kind: "unknown", detail: "Managed Python is missing" } as const)
          if (!(yield* healthyPython(target))) return yield* Effect.fail({ kind: "unknown", detail: "Managed Python did not pass its startup check" } as const)
          yield* location.files.mkdir(path.dirname(pythonReceipt))
          const temporary = pythonReceipt + "." + randomUUID() + ".part"
          yield* location.files.write(temporary, new TextEncoder().encode(JSON.stringify({ schema: 1, pinSet: launchers.pinSet, id: launchers.pythonFileId, path: target }))).pipe(Effect.andThen(location.files.move(temporary, pythonReceipt)), Effect.ensuring(location.files.remove(temporary).pipe(Effect.ignore)))
          return target
        }).pipe(Effect.scoped, preparationLocks.withLock(pythonReceipt))
      }))
      report("packages", { unit: "activity", detail: "Reading connector requirements" })
      const temporary = path.join(launchers.runtimeRoot, "tmp", randomUUID())
      yield* location.files.mkdir(temporary)
      yield* Effect.addFinalizer(() => location.files.remove(temporary).pipe(Effect.ignore))
      const args = input.command.slice(1)
      const source = input.runner === "npm-exec"
        ? { runner: "npm-exec" as const, syntax: name === "npx" ? "npx" as const : "npm-exec" as const, arguments: args }
        : { runner: "uv-tool" as const, syntax: name === "uvx" ? "uvx" as const : "uv" as const, arguments: args }
      const readInput = { launchers, python, temporary, cwd: input.cwd, environment: environment("0".repeat(64)) }
      const keyOf = (value: { runner: "npm-exec"; value: Awaited<Effect.Success<ReturnType<typeof normalizeNpmLaunchDeclaration>>> } | { runner: "uv-tool"; value: Effect.Success<ReturnType<typeof normalizeUvLaunchDeclaration>> }) =>
        connectorPreparationKey({ runner: input.runner, launchers, requirements: value.value.requirements, options: value.runner === "npm-exec" ? value.value.resolutionOptions : value.value.options, configuration: value.value.configuration })
      const normalized = source.runner === "npm-exec"
        ? { runner: "npm-exec" as const, value: yield* retry(normalizeNpmLaunchDeclaration({ ...readInput, ...source })) }
        : { runner: "uv-tool" as const, value: yield* retry(Effect.gen(function* () {
          const declaration = yield* readUvLaunchDeclaration({ ...readInput, ...source })
          return yield* normalizeUvLaunchSnapshotFirst({ ...readInput, ...source, declaration }, (value) =>
            readConnectorPreparation({ runtimeRoot: launchers.runtimeRoot, key: keyOf({ runner: "uv-tool", value }), runner: input.runner }).pipe(Effect.map(Boolean)))
        })) }
      const key = keyOf(normalized)
      const current = { ...readInput, environment: environment(key, python) }
      const declaration = normalized.runner === "npm-exec" ? { runner: "npm-exec" as const, syntax: name === "npx" ? "npx" as const : "npm-exec" as const, arguments: args, declaration: normalized.value } : { runner: "uv-tool" as const, syntax: name === "uvx" ? "uvx" as const : "uv" as const, arguments: args, declaration: normalized.value.declaration }
      if (normalized.runner === "uv-tool") {
        const selector = uvPythonRequest(normalized.value.declaration)
        if (selector !== null && /[/\\]/.test(selector) && path.resolve(normalized.value.cwd, selector) !== python)
          return yield* Effect.fail({ kind: "unknown", detail: "The requested interpreter does not match the pinned Python" } as const)
        if (normalized.value.runtimeRequest !== null || selector !== null)
          yield* checkUvPinnedPythonRequest({ ...current, cwd: normalized.value.cwd, request: { tool: normalized.value.runtimeRequest ?? "python", python: selector } })
      }
      const prefix = path.join(launchers.runtimeRoot, "prepared", key)
      const prepared = yield* Effect.acquireUseRelease(Effect.sync(() => {
        const listeners = preparationListeners.get(prefix) ?? new Set<typeof progress>(); listeners.add(report); preparationListeners.set(prefix, listeners)
        report("packages", { unit: "activity", detail: "Preparing connector packages" })
      }), () => Effect.gen(function* () {
        const cached = yield* readConnectorPreparation({ runtimeRoot: launchers.runtimeRoot, key, runner: input.runner })
        if (cached) return cached
        shared = prefix
        report("packages", { unit: "activity", detail: "Installing connector packages" })
        yield* location.files.remove(path.join(prefix, "ready.json")).pipe(Effect.ignore)
        yield* location.files.remove(path.join(prefix, input.runner === "npm-exec" ? "node_modules" : "uv")).pipe(Effect.ignore)
        const install = Effect.gen(function* () {
          const result = normalized.runner === "npm-exec"
            ? yield* installNpmConnector({ ...current, syntax: name === "npx" ? "npx" : "npm-exec", arguments: args, key, installSpecs: normalized.value.installSpecs })
            : yield* installUvConnector({ ...current, installArguments: normalized.value.installArguments })
          if (result.exitCode !== 0) return yield* Effect.fail(yield* failed(result.stderr || result.stdout || "Package installer exited " + result.exitCode))
        })
        yield* retry(Effect.scoped(install))
        const value = input.runner === "npm-exec" ? yield* captureNpmConnectorPreparation({ ...current, key }) : yield* captureUvConnectorPreparation({ ...current, key })
        yield* bindConnectorLaunch({ ...current, preparation: value, source: declaration })
        yield* publishConnectorPreparation({ runtimeRoot: launchers.runtimeRoot, preparation: value })
        return value
      }).pipe(Effect.scoped, preparationLocks.withLock(prefix)), () => Effect.sync(() => { shared = undefined; const listeners = preparationListeners.get(prefix); listeners?.delete(report); if (!listeners?.size) preparationListeners.delete(prefix) }))
      const binding = normalized.runner === "uv-tool" ? yield* bindUvConnectorSources({ ...current, preparation: prepared, sources: normalized.value.sourceBindings, installArguments: normalized.value.installArguments }) : prepared
      return yield* bindConnectorLaunch({ ...current, preparation: binding, source: declaration }).pipe(Effect.ensuring(location.files.remove(temporary).pipe(Effect.ignore)))
    }).pipe(Effect.provideService(Environment.Service, { ...location, spawner }), Effect.ensuring(Effect.sync(() => { active = false })))
  }).pipe(Effect.mapError(launchFailure))
}


export const ConnectorPreparation = Schema.Struct({
  schema: Schema.Literal(1),
  ready: Schema.Literal(true),
  key: Schema.String,
  runner: Schema.Literals(["uv-tool", "npm-exec"]),
  packages: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
  entries: Schema.Record(Schema.String, Schema.String),
  required: Schema.Array(Schema.String),
})

export type ConnectorPreparation = Omit<typeof ConnectorPreparation.Type, "schema" | "ready">

/** The original runner role survives preparation. Native commands never enter this projection. */
export function connectorRunnerEnvironment(input: {
  runner: PackageRunner
  launchers: LauncherEnvironment
  key: string
  inherited: Readonly<Record<string, string>>
  declared: Readonly<Record<string, string>>
  packageBins: readonly string[]
  python?: string
}) {
  if (!/^[a-f0-9]{64}$/.test(input.key)) throw new Error("Invalid connector preparation key")
  const windows = input.launchers.platform === "win32-x64"
  const paths = windows ? path.win32 : path.posix
  const delimiter = windows ? ";" : ":"
  const keyOf = (key: string) => (windows ? key.toLowerCase() : key)
  const inheritedControls = new Set(["NODE_OPTIONS", "PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV"].map(keyOf))
  const npm =
    input.runner === "npm-exec"
      ? Object.fromEntries(
          Object.entries(connectorNpmDefaults).map(([key, value]) => ["npm_config_" + key.replaceAll("-", "_"), value]),
        )
      : {}
  const prefix = paths.join(input.launchers.runtimeRoot, "prepared", input.key)
  const entries = new Map(
    [
      ...Object.entries(input.inherited).filter(([key]) => !inheritedControls.has(keyOf(key))),
      ...Object.entries(input.declared),
    ]
      .filter(([key]) => !Object.keys(npm).includes(key!.toLowerCase()))
      .map(([key, value]) => [keyOf(key!), [key!, value!] as const]),
  )
  const pathValue = (environment: Readonly<Record<string, string>>) => {
    const value = Object.entries(environment).findLast(([key]) => keyOf(key) === keyOf("PATH"))?.[1]
    return value === undefined ? [] : value.split(delimiter)
  }
  const ordered = [
    ...input.packageBins,
    paths.dirname(input.launchers.uv),
    paths.dirname(input.launchers.node),
    ...(input.python ? [paths.dirname(input.python)] : []),
    ...pathValue(input.declared),
    ...pathValue(input.inherited),
  ]
  const bins = new Map<string, string>()
  for (const bin of ordered) {
    const key = windows ? bin.replaceAll("/", "\\").toLowerCase() : bin
    if (!bins.has(key)) bins.set(key, bin)
  }
  for (const [key, value] of Object.entries({
    ...input.launchers.environment,
    ...npm,
    ...(input.runner === "uv-tool"
      ? { UV_TOOL_DIR: paths.join(prefix, "uv", "tools"), UV_TOOL_BIN_DIR: paths.join(prefix, "uv", "bin") }
      : {}),
    PATH: [...bins.values()].join(delimiter),
  }))
    entries.set(keyOf(key), [key, value])
  // R1 cache locations are not copied here. R2 projects the bound authority at the actual spawn.
  return Object.fromEntries(entries.values())
}

/** Only package facts survive restart. Invocation argv, cwd and credentials are rebound by preparation. */
export function publishConnectorPreparation(input: { runtimeRoot: string; preparation: ConnectorPreparation }) {
  return Effect.gen(function* () {
    const environment = yield* Environment.Service
    if (!(yield* preparationExists(environment.files, input.runtimeRoot, input.preparation)))
      return yield* Effect.fail({ kind: "unknown", detail: "Prepared connector files are missing or invalid" } as const)
    const file = path.join(input.runtimeRoot, "prepared", input.preparation.key, "ready.json")
    const temporary = `${file}.${randomUUID()}.part`
    const value = {
      schema: 1,
      ready: true,
      key: input.preparation.key,
      runner: input.preparation.runner,
      packages: input.preparation.packages,
      entries: input.preparation.entries,
      required: input.preparation.required,
    }
    yield* environment.files
      .write(temporary, new TextEncoder().encode(JSON.stringify(value)))
      .pipe(
        Effect.andThen(environment.files.move(temporary, file)),
        Effect.ensuring(environment.files.remove(temporary).pipe(Effect.ignore)),
      )
  }).pipe(Effect.mapError(launchFailure))
}

/** A valid receipt performs only Location file reads, with no resolver, refresh or expiry. */
export function readConnectorPreparation(input: {
  runtimeRoot: string
  key: string
  runner: ConnectorPreparation["runner"]
}) {
  return Effect.gen(function* () {
    if (!path.isAbsolute(input.runtimeRoot) || !/^[a-f0-9]{64}$/.test(input.key)) return
    const environment = yield* Environment.Service
    const source = yield* environment.files
      .read(path.join(input.runtimeRoot, "prepared", input.key, "ready.json"))
      .pipe(
        Effect.map((result) => new TextDecoder().decode(result.bytes)),
        Effect.catchTag("Environment.NotFound", () => Effect.succeed(undefined)),
        Effect.catchTag("Environment.WrongKind", () => Effect.succeed(undefined)),
      )
    if (source === undefined) return
    const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(ConnectorPreparation))(source)
    if (Option.isNone(decoded)) return
    const value = decoded.value
    if (value.key !== input.key || value.runner !== input.runner) return
    if (!(yield* preparationExists(environment.files, input.runtimeRoot, value))) return
    return {
      key: value.key,
      runner: value.runner,
      packages: value.packages,
      entries: value.entries,
      required: value.required,
    }
  }).pipe(Effect.mapError(launchFailure))
}

function preparationExists(files: Environment.Files, runtimeRoot: string, value: ConnectorPreparation) {
  return Effect.gen(function* () {
    if (!path.isAbsolute(runtimeRoot) || !/^[a-f0-9]{64}$/.test(value.key)) return false
    const prefix = path.join(runtimeRoot, "prepared", value.key)
    const required = [...new Set([...value.required, ...Object.values(value.entries)])]
    for (const file of required) {
      const relative = path.relative(prefix, file)
      if (
        !path.isAbsolute(file) ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        return false
      const kind = yield* Environment.typeFollowing(files, file).pipe(
        Effect.catchTag("Environment.NotFound", () => Effect.succeed(undefined)),
      )
      if (kind !== "file" && kind !== "directory") return false
      if (Object.values(value.entries).includes(file) && kind !== "file") return false
    }
    return true
  })
}

function launchFailure(error: unknown): ConnectorLaunchFailure {
  if (isConnectorLaunchFailure(error)) return error
  return { kind: "unknown", detail: error instanceof Error ? error.message : String(error) }
}

/** Preparation processes use the same Location execution plane as the eventual connector. */
export function installConnectorPython(input: {
  launchers: LauncherEnvironment
  cwd: string
  environment: Record<string, string>
}): Effect.Effect<
  { exitCode: number; stdout: string; stderr: string },
  ConnectorLaunchFailure,
  Environment.Service | Scope.Scope
> {
  return Effect.gen(function* () {
    const environment = yield* Environment.Service
    const developerTools =
      input.launchers.platform !== "darwin-arm64" ||
      (yield* Effect.gen(function* () {
        const probe = yield* environment.spawner.spawn(
          ChildProcess.make("/usr/bin/xcode-select", ["-p"], {
            cwd: input.cwd,
            env: input.environment,
            extendEnv: false,
          }),
        )
        const [code, bytes] = yield* Effect.all(
          [probe.exitCode, Stream.mkUint8Array(probe.stdout), Stream.runDrain(probe.stderr)],
          { concurrency: "unbounded" },
        )
        const directory = new TextDecoder().decode(bytes).trim()
        if (code !== 0 || !path.isAbsolute(directory)) return false
        return (yield* Environment.typeFollowing(environment.files, directory)) === "directory"
      }).pipe(Effect.catch(() => Effect.succeed(false))))
    // Only Python installation excludes inherited tools when CLT is unavailable. The
    // caller's environment and the later package/service PATH remain untouched.
    const childEnvironment = developerTools
      ? input.environment
      : {
          ...input.environment,
          PATH: [...new Set([path.dirname(input.launchers.uv), path.dirname(input.launchers.node)])].join(":"),
        }
    const command = ChildProcess.make(
      input.launchers.uv,
      [
        "python",
        "install",
        input.launchers.environment.UV_PYTHON!,
        "--reinstall",
        "--no-bin",
        "--mirror",
        input.launchers.environment.UV_PYTHON_INSTALL_MIRROR!,
      ],
      { cwd: input.cwd, env: childEnvironment, extendEnv: false },
    )
    const handle = yield* environment.spawner.spawn(command)
    const [exitCode, stdout, stderr] = yield* Effect.all(
      [handle.exitCode, Stream.mkUint8Array(handle.stdout), Stream.mkUint8Array(handle.stderr)],
      { concurrency: "unbounded" },
    )
    return { exitCode, stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr) }
  }).pipe(Effect.mapError(launchFailure))
}

const npmEntryPrefixes = { package: "package:", bin: "bin:" } as const

/** A moved editable source gets an attempt-owned environment; the shared ready tree never changes. */
export function bindUvConnectorSources(input: {
  launchers: LauncherEnvironment
  python: string
  cwd: string
  environment: Record<string, string>
  preparation: ConnectorPreparation
  sources: readonly { path: string; editable: boolean }[]
  installArguments: readonly string[]
}) {
  const sources = input.sources.filter(source => source.editable).map(source => source.path)
  if (!sources.length) return Effect.succeed(input.preparation)
  return Effect.gen(function* () {
    const environment = yield* Environment.Service
    const prefix = path.join(input.launchers.runtimeRoot, "prepared", input.preparation.key)
    const binding = path.join(prefix, "bindings", randomUUID())
    yield* Effect.addFinalizer(() => environment.files.remove(binding).pipe(Effect.ignore))
    const handle = yield* environment.spawner.spawn(ChildProcess.make(input.launchers.node, ["--input-type=commonjs", "-e", uvSourceBindingProgram], {
      cwd: input.cwd, env: input.environment, extendEnv: false,
      stdin: { stream: Stream.succeed(new TextEncoder().encode(JSON.stringify({
        prefix, binding, sources, preparation: input.preparation, python: input.python, uv: input.launchers.uv,
        installArguments: input.installArguments, argumentsProgram: uvEditableInstallArguments.toString(), metadataProgram: uvBindingMetadataProgram,
      }))), endOnDone: true },
    }))
    const [code, stdout, stderr] = yield* Effect.all([handle.exitCode, Stream.mkUint8Array(handle.stdout), Stream.mkUint8Array(handle.stderr)], { concurrency: "unbounded" })
    if (code !== 0) return yield* Effect.fail({ kind: "unknown", detail: new TextDecoder().decode(stderr) } as const)
    const value = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ConnectorPreparation))(new TextDecoder().decode(stdout))
    if (!(yield* preparationExists(environment.files, input.launchers.runtimeRoot, value)))
      return yield* Effect.fail({ kind: "unknown", detail: "Bound editable environment is incomplete" } as const)
    return value
  }).pipe(Effect.mapError(launchFailure))
}

const uvSourceBindingProgram = String.raw`
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
;(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  const run = (command, args, data) => new Promise((resolve,reject) => {
    const child = spawn(command,args,{env:process.env,stdio:['pipe','pipe','pipe']})
    const output = []
    child.stdout.on('data',chunk=>output.push(chunk));child.stderr.on('data',chunk=>process.stderr.write(chunk))
    child.once('error',reject);child.once('close',(code,signal)=>code===0?resolve(Buffer.concat(output).toString()):reject(Error('Editable binding command exited '+code+(signal?' ('+signal+')':''))))
    child.stdin.end(data===undefined?undefined:JSON.stringify(data))
  })
  const metadata = data => run(input.python,['-I','-S','-c',input.metadataProgram],data).then(JSON.parse)
  const existing = await metadata({ operation:'sources',prefix:input.prefix })
  const normalize = file => process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file)
  const current = new Set(input.sources.map(normalize))
  const previous = new Set(existing.map(normalize))
  if (current.size===previous.size && [...current].every(file=>previous.has(file))) { process.stdout.write(JSON.stringify({schema:1,ready:true,...input.preparation}));return }
  fs.mkdirSync(input.binding,{recursive:true,mode:0o700})
  fs.cpSync(path.join(input.prefix,'uv'),path.join(input.binding,'uv'),{recursive:true,verbatimSymlinks:true})
  const args = require('node:vm').runInThisContext('('+input.argumentsProgram+')')
  const tools = path.join(input.binding,'uv','tools')
  for (const name of fs.readdirSync(tools)) {
    const tool=path.join(tools,name)
    if (!fs.existsSync(path.join(tool,'pyvenv.cfg'))) continue
    const python=path.join(tool,process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python')
    await run(input.uv,args({installArguments:input.installArguments,python,sources:input.sources}))
  }
  await metadata({operation:'scripts',prefix:input.binding,original:input.prefix})
  const rebase = file => input.binding+file.slice(input.prefix.length)
  process.stdout.write(JSON.stringify({schema:1,ready:true,...input.preparation,entries:Object.fromEntries(Object.entries(input.preparation.entries).map(([name,file])=>[name,rebase(file)])),required:input.preparation.required.map(rebase)}))
})().catch(error=>{process.stderr.write(String(error.message)+'\n');process.exitCode=1})
`

const uvBindingMetadataProgram = String.raw`
import base64,csv,hashlib,importlib.metadata,json,os,pathlib,sys,tomllib
data=json.load(sys.stdin)
base=pathlib.Path(sys.base_prefix)
wheel=next(iter(list(base.glob('lib/python*/ensurepip/_bundled/pip-*.whl'))+list(base.glob('Lib/ensurepip/_bundled/pip-*.whl'))))
sys.path.insert(0,str(wheel))
from pip._internal.utils.urls import url_to_path
root=pathlib.Path(data['prefix'])
sources=[]
for receipt in (root/'uv'/'tools').glob('*/uv-receipt.toml'):
    tool=receipt.parent
    sites=list(tool.glob('lib/python*/site-packages'))
    if (tool/'Lib'/'site-packages').is_dir(): sites.append(tool/'Lib'/'site-packages')
    distributions=[distribution for site in sites for distribution in importlib.metadata.distributions(path=[str(site)])]
    if data['operation']=='sources':
        for distribution in distributions:
            direct=distribution.read_text('direct_url.json')
            if direct:
                value=json.loads(direct)
                if value.get('dir_info',{}).get('editable'):
                    sources.append(url_to_path(value['url']))
        continue
    scripts=tool/('Scripts' if os.name=='nt' else 'bin')
    changed=set()
    before={}
    if os.name=='nt':
        # Pinned uv0.13.10's own trampolines keep the interpreter in RT_RCDATA.
        # Update that resource, preserving native EXEs and the original script ZIP.
        import ctypes
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        pointer=ctypes.c_void_p
        def api(name,args,result):
            value=getattr(kernel,name);value.argtypes=args;value.restype=result;return value
        load=api('LoadLibraryExW',[ctypes.c_wchar_p,pointer,ctypes.c_uint32],pointer)
        find=api('FindResourceW',[pointer,ctypes.c_wchar_p,pointer],pointer)
        size=api('SizeofResource',[pointer,pointer],ctypes.c_uint32)
        resource=api('LoadResource',[pointer,pointer],pointer)
        lock=api('LockResource',[pointer],pointer)
        free=api('FreeLibrary',[pointer],ctypes.c_int)
        begin=api('BeginUpdateResourceW',[ctypes.c_wchar_p,ctypes.c_int],pointer)
        update=api('UpdateResourceW',[pointer,pointer,ctypes.c_wchar_p,ctypes.c_uint16,pointer,ctypes.c_uint32],ctypes.c_int)
        end=api('EndUpdateResourceW',[pointer,ctypes.c_int],ctypes.c_int)
        def read(handle,name):
            entry=find(handle,name,pointer(10))
            if not entry: return None
            address=lock(resource(handle,entry))
            if not address: raise ctypes.WinError(ctypes.get_last_error())
            return ctypes.string_at(address,size(handle,entry))
        for target in scripts.glob('*.exe'):
            handle=load(str(target),None,0x2)
            if not handle: raise ctypes.WinError(ctypes.get_last_error())
            try:
                kind=read(handle,'UV_TRAMPOLINE_KIND')
                value=read(handle,'UV_PYTHON_PATH') if kind in (bytes([1]),bytes([2])) else None
            finally: free(handle)
            if value is None: continue
            previous=value.decode()
            if not os.path.normcase(previous).startswith(os.path.normcase(data['original']+os.sep)): continue
            replacement=(str(root)+previous[len(data['original']):]).encode()
            before[os.path.abspath(target)]='sha256='+base64.urlsafe_b64encode(hashlib.sha256(target.read_bytes()).digest()).rstrip(b'=').decode()
            writer=begin(str(target),False)
            if not writer: raise ctypes.WinError(ctypes.get_last_error())
            buffer=ctypes.create_string_buffer(replacement)
            if not update(writer,pointer(10),'UV_PYTHON_PATH',0,buffer,len(replacement)):
                error=ctypes.WinError(ctypes.get_last_error());end(writer,True);raise error
            if not end(writer,False): raise ctypes.WinError(ctypes.get_last_error())
            changed.add(os.path.abspath(target))
    else:
        original=data['original'].encode();replacement=str(root).encode()
        for target in scripts.iterdir():
            if not target.is_file() or target.is_symlink(): continue
            value=target.read_bytes()
            if value.startswith(b'#!') and original in value:
                before[os.path.abspath(target)]='sha256='+base64.urlsafe_b64encode(hashlib.sha256(value).digest()).rstrip(b'=').decode()
                target.write_bytes(value.replace(original,replacement));changed.add(os.path.abspath(target))
    for distribution in distributions:
        records=[distribution.locate_file(file) for file in distribution.files or [] if file.name=='RECORD']
        for record in records:
            with record.open(newline='') as stream: rows=list(csv.reader(stream))
            for row in rows:
                target=distribution.locate_file(row[0])
                if os.path.abspath(target) not in changed or row[1]!=before[os.path.abspath(target)]: continue
                content=target.read_bytes();row[1]='sha256='+base64.urlsafe_b64encode(hashlib.sha256(content).digest()).rstrip(b'=').decode();row[2]=str(len(content))
            with record.open('w',newline='') as stream: csv.writer(stream,lineterminator='\n').writerows(rows)
    previous=data['original'];replacement=str(root);quoted=json.dumps(previous,ensure_ascii=False)[1:-1]
    text=receipt.read_text()
    if quoted!=previous: text=text.replace(quoted,json.dumps(replacement,ensure_ascii=False)[1:-1])
    receipt.write_text(text.replace(previous,replacement))
print(json.dumps(sources if data['operation']=='sources' else True))
`

/** Capture actual installed npm manifests and bin links, using the pinned npm's own bin selection. */
export function captureNpmConnectorPreparation(input: {
  launchers: LauncherEnvironment
  key: string
  cwd: string
  environment: Record<string, string>
}) {
  return Effect.gen(function* () {
    if (!/^[a-f0-9]{64}$/.test(input.key))
      return yield* Effect.fail({ kind: "unknown", detail: "Invalid connector preparation key" } as const)
    const environment = yield* Environment.Service
    const handle = yield* environment.spawner.spawn(
      ChildProcess.make(input.launchers.node, ["--input-type=commonjs", "-e", npmCaptureProgram], {
        cwd: input.cwd,
        env: input.environment,
        extendEnv: false,
        stdin: {
          stream: Stream.succeed(
            new TextEncoder().encode(
              JSON.stringify({
                npmCli: input.launchers.npmCli,
                prefix: path.join(input.launchers.runtimeRoot, "prepared", input.key),
                key: input.key,
                prefixes: npmEntryPrefixes,
              }),
            ),
          ),
          endOnDone: true,
        },
      }),
    )
    const [code, stdout, stderr] = yield* Effect.all(
      [handle.exitCode, Stream.mkUint8Array(handle.stdout), Stream.mkUint8Array(handle.stderr)],
      { concurrency: "unbounded" },
    )
    if (code !== 0) return yield* Effect.fail({ kind: "unknown", detail: new TextDecoder().decode(stderr) } as const)
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ConnectorPreparation))(
      new TextDecoder().decode(stdout),
    )
  }).pipe(Effect.mapError(launchFailure))
}

export function preparedNpmEntry(preparation: ConnectorPreparation, input: { kind: "package" | "bin"; name: string }) {
  return preparation.entries[npmEntryPrefixes[input.kind] + input.name]
}

/** Current invocation data is bound after package readiness; none of it is written to ready.json. */
export function bindConnectorLaunch(input: {
  launchers: LauncherEnvironment
  preparation: ConnectorPreparation
  python: string
  cwd: string
  environment: Record<string, string>
  source:
    | { runner: "npm-exec"; syntax: "npx" | "npm-exec"; arguments: readonly string[]; declaration: Effect.Success<ReturnType<typeof readNpmLaunchDeclaration>> }
    | { runner: "uv-tool"; syntax: "uvx" | "uv"; arguments: readonly string[]; declaration: ReturnType<typeof parseUvToolSettings> & { commandName: string | null } }
}): Effect.Effect<PreparedLaunch, ConnectorLaunchFailure, Environment.Service | Scope.Scope> {
  return Effect.gen(function* () {
    const paths = input.launchers.platform === "win32-x64" ? path.win32 : path.posix
    const packageBins = [...new Set([
      ...(input.source.runner === "npm-exec" ? [paths.join(input.launchers.runtimeRoot, "prepared", input.preparation.key, "node_modules", ".bin")] : []),
      ...Object.values(input.preparation.entries).map(file => paths.dirname(file)),
      ...input.preparation.required.filter(file => paths.basename(file) === "pyvenv.cfg").map(file => paths.join(paths.dirname(file), input.launchers.platform === "win32-x64" ? "Scripts" : "bin")),
    ])]
    const source = input.source
    const npmPackage = source.runner === "npm-exec" && source.declaration.selection === "package"
      ? source.declaration.requests[0]?.alias ?? source.declaration.requests[0]?.name ?? Object.keys(input.preparation.packages)[0]
      : undefined
    const defaultEntry = npmPackage ? preparedNpmEntry(input.preparation, { kind: "package", name: npmPackage }) : undefined
    const service = source.runner === "npm-exec"
      ? source.declaration.selection === "package"
        ? [Object.entries(input.preparation.entries).find(([name, entry]) => name.startsWith(npmEntryPrefixes.bin) && entry === defaultEntry)?.[0].slice(npmEntryPrefixes.bin.length) ?? "", ...source.declaration.arguments.slice(1)]
        : [...source.declaration.arguments]
      : source.declaration.command.map((argument, index) => index === 0 && source.declaration.from === null ? source.declaration.commandName ?? input.preparation.required.filter(file => paths.basename(file) === "pyvenv.cfg").map(file => paths.basename(paths.dirname(file)))[0] ?? argument : argument)
    if (source.runner === "npm-exec" && source.declaration.selection === "package" && !defaultEntry)
      return yield* Effect.fail({ kind: "unknown", detail: "The prepared package has no default executable" } as const)
    const execution = source.runner === "npm-exec"
      ? yield* readNpmLaunchEnvironment({ ...input, ...source, serviceArguments: service, packageBins })
      : yield* readUvLaunchEnvironment({ ...input, ...source })
    const environment = connectorRunnerEnvironment({ runner: source.runner, launchers: input.launchers, key: input.preparation.key, inherited: {}, declared: execution.environment, packageBins, python: input.python })
    const shell = source.runner === "npm-exec" && (source.declaration.selection === "call" || source.declaration.selection === "shell")
    const head = shell ? source.declaration.call : service[0]
    if (shell) {
      const script = head || (input.launchers.platform === "win32-x64" ? "cmd" : "sh")
      return {
        runner: source.runner, key: input.preparation.key, cwd: execution.cwd,
        command: [input.launchers.node, "--input-type=commonjs", "-e", connectorShellProgram],
        environment: { ...environment, [connectorShellInput]: JSON.stringify({ npmCli: input.launchers.npmCli, command: script, arguments: [], shell: source.declaration.scriptShell || true }) },
      } satisfies PreparedLaunch
    }
    if (!head) return yield* Effect.fail({ kind: "unknown", detail: "No connector executable was declared" } as const)
    const selected = source.runner === "npm-exec"
      ? defaultEntry ?? preparedNpmEntry(input.preparation, { kind: "bin", name: head })
      : input.preparation.entries[head]
    const entry = selected ?? (yield* resolveConnectorExecutable({ head, cwd: execution.cwd, environment, launchers: input.launchers }))
    const args = service.slice(1)
    if (input.launchers.platform === "win32-x64" && /\.(cmd|bat)$/i.test(entry))
      return { runner: source.runner, key: input.preparation.key, cwd: execution.cwd,
        command: [input.launchers.node, "--input-type=commonjs", "-e", connectorShellProgram],
        environment: { ...environment, [connectorShellInput]: JSON.stringify({ npmCli: input.launchers.npmCli, command: entry, arguments: args, shell: true }) },
      } satisfies PreparedLaunch
    if (input.launchers.platform === "win32-x64" && /\.ps1$/i.test(entry)) {
      const interpreter = yield* resolveConnectorExecutable({ head: "powershell.exe", cwd: execution.cwd, environment, launchers: input.launchers })
      return { runner: source.runner, key: input.preparation.key, cwd: execution.cwd, environment, command: [interpreter, "-File", entry, ...args] } satisfies PreparedLaunch
    }
    const files = yield* Environment.Service
    const prefix = yield* files.files.read(entry, { offset: 0, length: 256 })
    const node = /\.[cm]?js$/i.test(entry) || /^#![^\r\n]*\bnode(?:\s|$)/.test(new TextDecoder().decode(prefix.bytes))
    if (source.runner === "uv-tool" && (/\.pyw?$/i.test(entry) || /^#![^\r\n]*\bpython[\d.w]*(?:\s|$)/i.test(new TextDecoder().decode(prefix.bytes)))) {
      const cfg = input.preparation.required.find(file => paths.basename(file) === "pyvenv.cfg" && entry.startsWith(paths.dirname(file) + paths.sep))
      if (cfg) {
        const interpreter = paths.join(paths.dirname(cfg), input.launchers.platform === "win32-x64" ? "Scripts" : "bin", input.launchers.platform === "win32-x64" ? /\.pyw$/i.test(entry) ? "pythonw.exe" : "python.exe" : "python")
        return { runner: source.runner, key: input.preparation.key, cwd: execution.cwd, environment, command: [interpreter, entry, ...args] } satisfies PreparedLaunch
      }
    }
    return { runner: source.runner, key: input.preparation.key, cwd: execution.cwd, environment, command: node ? [input.launchers.node, entry, ...args] : [entry, ...args] } satisfies PreparedLaunch
  }).pipe(Effect.mapError(launchFailure))
}

function resolveConnectorExecutable(input: { head: string; cwd: string; environment: Record<string, string>; launchers: LauncherEnvironment }) {
  return Effect.gen(function* () {
    const environment = yield* Environment.Service
    const windows = input.launchers.platform === "win32-x64"
    const paths = windows ? path.win32 : path.posix
    const lookup = (name: string) => Object.entries(input.environment).find(([key]) => windows ? key.toLowerCase() === name.toLowerCase() : key === name)?.[1]
    const suffixes = windows && !paths.extname(input.head) ? ["", ...(lookup("PATHEXT") || ".COM;.EXE;.BAT;.CMD").split(";")] : [""]
    const directories = paths.isAbsolute(input.head) || input.head.includes("/") || windows && input.head.includes("\\")
      ? [input.cwd]
      : (lookup("PATH") || "").split(windows ? ";" : ":")
    for (const directory of directories) for (const suffix of suffixes) {
      const candidate = paths.resolve(input.cwd, directory, input.head + suffix)
      const kind = yield* Environment.typeFollowing(environment.files, candidate).pipe(Effect.catchTag("Environment.NotFound", () => Effect.succeed(undefined)))
      if (kind === "file") return candidate
    }
    return yield* Effect.fail({ kind: "dependency", program: input.head } as const)
  })
}

const connectorShellInput = "CODEPUPPY_MCP_SHELL_INPUT"
const connectorShellProgram = String.raw`
const input = JSON.parse(process.env.` + connectorShellInput + String.raw`)
delete process.env.` + connectorShellInput + String.raw`
const npmRequire = require('node:module').createRequire(input.npmCli)
npmRequire('@npmcli/promise-spawn')(input.command, input.arguments, { shell: input.shell, cwd: process.cwd(), env: process.env, stdio: 'inherit' }).catch(error => {
  if (error.signal) { process.kill(process.pid, error.signal); return }
  if (error.message) process.stderr.write(String(error.message) + '\n')
  process.exitCode = typeof error.code === 'number' ? error.code : 1
})
`

/** Read uv's installed receipt and distribution metadata without importing connector code or .pth files. */
export function captureUvConnectorPreparation(input: {
  launchers: LauncherEnvironment
  key: string
  python: string
  cwd: string
  environment: Record<string, string>
}) {
  return Effect.gen(function* () {
    if (!/^[a-f0-9]{64}$/.test(input.key))
      return yield* Effect.fail({ kind: "unknown", detail: "Invalid connector preparation key" } as const)
    const environment = yield* Environment.Service
    const handle = yield* environment.spawner.spawn(
      ChildProcess.make(input.python, ["-I", "-S", "-c", uvCaptureProgram], {
        cwd: input.cwd,
        env: input.environment,
        extendEnv: false,
        stdin: {
          stream: Stream.succeed(
            new TextEncoder().encode(
              JSON.stringify({
                prefix: path.join(input.launchers.runtimeRoot, "prepared", input.key),
                key: input.key,
              }),
            ),
          ),
          endOnDone: true,
        },
      }),
    )
    const [code, stdout, stderr] = yield* Effect.all(
      [handle.exitCode, Stream.mkUint8Array(handle.stdout), Stream.mkUint8Array(handle.stderr)],
      { concurrency: "unbounded" },
    )
    if (code !== 0) return yield* Effect.fail({ kind: "unknown", detail: new TextDecoder().decode(stderr) } as const)
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ConnectorPreparation))(
      new TextDecoder().decode(stdout),
    )
  }).pipe(Effect.mapError(launchFailure))
}

const uvCaptureProgram = String.raw`
import importlib.metadata
import json
import pathlib
import sys
import tomllib

try:
    data = json.load(sys.stdin)
    prefix = pathlib.Path(data['prefix'])
    canonical = prefix.resolve(strict=True)
    def owned(source):
        target = pathlib.Path(source).resolve(strict=True)
        if not target.is_relative_to(canonical):
            raise ValueError('Prepared uv file escaped its prefix')
        return prefix / target.relative_to(canonical)
    packages = {}
    entries = {}
    required = set()
    receipts = list((prefix / 'uv' / 'tools').glob('*/uv-receipt.toml'))
    if not receipts:
        raise ValueError('Installed uv tool receipt is missing')
    for source in receipts:
        receipt = owned(source)
        tool = receipt.parent
        required.update([str(receipt), str(owned(tool / 'pyvenv.cfg'))])
        interpreter = tool / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
        if not interpreter.is_file():
            raise ValueError('Installed uv interpreter is missing')
        required.add(str(interpreter))
        sites = list(tool.glob('lib/python*/site-packages'))
        windows = tool / 'Lib' / 'site-packages'
        if windows.is_dir():
            sites.append(windows)
        if not sites:
            raise ValueError('Installed uv tool environment is missing')
        for site in sites:
            directory = owned(site)
            required.add(str(directory))
            for distribution in importlib.metadata.distributions(path=[str(directory)]):
                packages[distribution.metadata['Name']] = distribution.version
                # Files in the real installed RECORD locate metadata without importing the package.
                for file in distribution.files or []:
                    if file.name == 'METADATA':
                        required.add(str(owned(distribution.locate_file(file))))
        with receipt.open('rb') as stream:
            declaration = tomllib.load(stream)['tool']
        for entry in declaration['entrypoints']:
            target = owned(entry['install-path'])
            if not target.is_file():
                raise ValueError('Installed uv entry is missing')
            entries[entry['name']] = str(target)
            required.add(str(target))
    print(json.dumps(dict(schema=1, ready=True, key=data['key'], runner='uv-tool', packages=packages, entries=entries, required=sorted(required))))
except Exception as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
`

const npmCaptureProgram = String.raw`
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
;(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  const npmRequire = createRequire(input.npmCli)
  const PackageJson = npmRequire('@npmcli/package-json')
  const getBin = npmRequire(path.join(path.dirname(npmRequire.resolve('libnpmexec/package.json')), 'lib/get-bin-from-manifest.js'))
  const canonical = fs.realpathSync(input.prefix)
  const owned = (file) => {
    const relative = path.relative(canonical, fs.realpathSync(file))
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Prepared npm file escaped its prefix')
    return path.join(input.prefix, relative)
  }
  const root = JSON.parse(fs.readFileSync(path.join(input.prefix, 'package.json'), 'utf8'))
  const packages = Object.create(null)
  const entries = Object.create(null)
  const defaults = Object.create(null)
  const required = new Set([owned(path.join(input.prefix, 'package.json'))])
  const lock = path.join(input.prefix, 'package-lock.json')
  if (fs.existsSync(lock)) required.add(owned(lock))
  const bins = new Set()
  for (const name of Object.keys({ ...root.dependencies, ...root.devDependencies, ...root.optionalDependencies })) {
    const target = path.join(input.prefix, 'node_modules', name)
    if (!fs.existsSync(target)) continue
    const directory = owned(target)
    const manifest = (await PackageJson.normalize(directory)).content
    packages[name] = typeof manifest.version === 'string' ? manifest.version : null
    required.add(owned(path.join(directory, 'package.json')))
    required.add(directory)
    for (const bin of Object.keys(manifest.bin || {})) bins.add(bin)
    try { defaults[name] = getBin(manifest) } catch { /* Explicit bins / --call need no default. */ }
  }
  for (const name of bins) {
    const shim = path.join(input.prefix, 'node_modules', '.bin', name)
    if (!fs.existsSync(process.platform === 'win32' ? shim + '.cmd' : shim)) continue
    const target = process.platform === 'win32'
      ? path.resolve(path.dirname(shim), await npmRequire('read-cmd-shim')(shim + '.cmd'))
      : shim
    const entry = owned(target)
    if (!fs.statSync(entry).isFile()) continue
    entries[input.prefixes.bin + name] = entry
    required.add(entry)
  }
  for (const [name, bin] of Object.entries(defaults)) {
    const entry = entries[input.prefixes.bin + bin]
    if (entry) entries[input.prefixes.package + name] = entry
  }
  process.stdout.write(JSON.stringify({ schema: 1, ready: true, key: input.key, runner: 'npm-exec', packages, entries, required: [...required] }))
})().catch((error) => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1 })
`
