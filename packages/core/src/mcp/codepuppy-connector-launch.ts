import path from "node:path"
import { randomUUID } from "node:crypto"
import { Effect, Option, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import type { Scope } from "effect"
import type {
  LauncherEnvironment,
  ConnectorLaunchFailure,
  PackageRunner,
  PreparedLaunch,
} from "@opencode/util/codepuppy-connector-launch"
import { isConnectorLaunchFailure } from "@opencode/util/codepuppy-connector-launch"
import { Environment } from "../environment/index.js"
import { connectorNpmDefaults, readNpmLaunchDeclaration, readNpmLaunchEnvironment } from "./codepuppy-npm-launch.js"
import { parseUvToolSettings, readUvLaunchEnvironment } from "./codepuppy-uv-launch.js"

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
      : source.declaration.command.map((argument, index) => index === 0 && source.declaration.from === null ? source.declaration.commandName ?? argument : argument)
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
