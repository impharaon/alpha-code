import { Effect, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import type { ConnectorLaunchFailure, LauncherEnvironment } from "@opencode/util/codepuppy-connector-launch"
import { Environment } from "../environment/index.js"
import { ConnectorRequirement } from "./codepuppy-connector-key.js"
import { connectorContentRuntime, connectorSourceProgram } from "./codepuppy-connector-content.js"

export const connectorNpmDefaults = {
  "prefer-offline": "true",
  "ignore-scripts": "true",
  "update-notifier": "false",
} as const

const NpmRequest = Schema.Struct({
  specification: Schema.String,
  name: Schema.NullOr(Schema.String),
  type: Schema.String,
  fetchSpec: Schema.NullOr(Schema.String),
  rawSpec: Schema.String,
  alias: Schema.NullOr(Schema.String),
  registry: Schema.Boolean,
  revision: Schema.String,
  subdirectory: Schema.NullOr(Schema.String),
})

const NpmDeclaration = Schema.Struct({
  arguments: Schema.Array(Schema.String),
  packages: Schema.Array(
    Schema.Struct({ specification: Schema.String, name: Schema.NullOr(Schema.String), type: Schema.String }),
  ),
  call: Schema.String,
  scriptShell: Schema.NullOr(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  resolutionOptions: Schema.Record(Schema.String, Schema.Unknown),
  requests: Schema.Array(NpmRequest),
  selection: Schema.Literals(["package", "command", "call", "shell"]),
})

const NpmContent = Schema.Struct({
  ...NpmDeclaration.fields,
  requirements: Schema.Array(ConnectorRequirement),
  installSpecs: Schema.Array(Schema.String),
  configuration: Schema.Array(
    Schema.Struct({ purpose: Schema.Literal("dependencies"), value: Schema.Array(ConnectorRequirement) }),
  ),
})

// Execute the pinned npm's own npx rewrite and configuration parser, not an imitation of
// its flags/shorthands. Intercept only the final CLI dispatch: parsing must not run the service.
// Both option records contain transient effective configuration, including authentication.
// resolutionOptions preserves semantic release-age inputs, but still needs the key owner's
// non-secret projection. Neither record is a receipt and neither may be logged or persisted.
const npmDeclarationProgram = String.raw`
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
;(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  const npmRequire = createRequire(input.npmCli)
  const Config = npmRequire('@npmcli/config')
  const { definitions, shorthands, flatten, nerfDarts } = npmRequire('@npmcli/config/lib/definitions')
  const npa = npmRequire('npm-package-arg')
  const boundEnvironment = Object.fromEntries(Object.keys(input.boundEnvironment).map(key => [key, Object.entries(process.env).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1]]))
  const declarationProcess = { argv: [process.execPath, input.syntax === 'npx' ? input.npxCli : input.npmCli, ...input.arguments] }
  if (input.syntax === 'npx') {
    const npxRequire = createRequire(input.npxCli)
    const intercept = Object.assign((id) => id === '../lib/cli.js' ? () => {} : npxRequire(id), { resolve: npxRequire.resolve })
    vm.compileFunction(fs.readFileSync(input.npxCli, 'utf8').replace(/^#![^\n]*(?:\n|$)/, ''), ['require', 'process', 'console'], { filename: input.npxCli })(intercept, declarationProcess, console)
  }
  let before = null
  const config = new Config({ definitions, shorthands, flatten: (source, target) => flatten(source, new Proxy(target, {
    set(object, key, value) {
      // Observe the official flatten's winning write, rather than repeating npm's
      // source precedence or recording its Date.now-derived cutoff as content.
      if (key === 'before') before = value === null ? null : Object.hasOwn(source, 'before')
        ? { kind: 'before', date: value }
        : { kind: 'relative-age', days: source['min-release-age'] }
      return Reflect.set(object, key, value)
    },
  })), nerfDarts, npmPath: path.dirname(path.dirname(input.npmCli)), argv: declarationProcess.argv })
  await config.load()
  for (const [key, value] of Object.entries(boundEnvironment)) {
    if (value === undefined) { delete process.env[key]; continue }
    process.env[key] = value
    if (key.toLowerCase().startsWith('npm_config_')) config.set(key.slice('npm_config_'.length).replaceAll('_', '-'), value, 'cli')
  }
  const command = config.parsedArgv.remain.shift()
  const { deref } = npmRequire('../lib/utils/cmd-list.js')
  if (deref(command) !== 'exec') throw new Error('Expected npm exec declaration')
  const packages = config.get('package').map((specification) => {
    const parsed = npa(specification, process.cwd())
    return { specification, name: parsed.name ?? null, type: parsed.type }
  })
  const options = config.flat
  const args = config.parsedArgv.remain
  const call = config.get('call')
  if (call && args.length) throw Error('Cannot use --call with positional arguments')
  let selection = call ? 'call' : packages.length ? (args.length ? 'command' : 'shell') : args.length ? 'package' : 'shell'
  let localPackage
  if (selection === 'package' && !args[0].includes('/') && !args[0].includes('@')) {
    for (let directory = process.cwd();; directory = path.dirname(directory)) {
      const bin = path.join(directory, 'node_modules', '.bin', args[0] + (process.platform === 'win32' ? '.cmd' : ''))
      if (fs.existsSync(bin)) {
        const target = process.platform === 'win32' ? path.resolve(path.dirname(bin), await npmRequire('read-cmd-shim')(bin)) : fs.realpathSync(bin)
        for (let owner = path.dirname(target); owner !== path.dirname(owner); owner = path.dirname(owner)) {
          if (!fs.existsSync(path.join(owner, 'package.json'))) continue
          localPackage = owner
          selection = 'command'
          break
        }
        break
      }
      if (directory === path.dirname(directory)) break
    }
  }
  const requests = (packages.length ? packages.map(p => p.specification) : localPackage ? [localPackage] : selection === 'package' ? [args[0]] : []).map(specification => {
    const original = npa(specification, process.cwd())
    const parsed = original.subSpec || original
    return { specification, name: parsed.name || original.name || null, type: parsed.type, fetchSpec: parsed.fetchSpec || null, rawSpec: parsed.rawSpec,
      alias: original.subSpec ? original.name : null, registry: !!parsed.registry,
      revision: parsed.gitCommittish || (parsed.gitRange ? 'semver:' + parsed.gitRange : ''), subdirectory: parsed.gitSubdir || null }
  })
  const declaration = { arguments: args, packages, call, scriptShell: config.get('script-shell'), options, resolutionOptions: { ...options, before }, requests, selection }
  if (input.operation.kind === 'environment') {
    const runFile = path.join(path.dirname(npmRequire.resolve('libnpmexec/package.json')), 'lib/run-script.js')
    const runRequire = createRequire(runFile)
    const scriptRoot = path.dirname(npmRequire.resolve('@npmcli/run-script/package.json'))
    const makeArgs = npmRequire(path.join(scriptRoot, 'lib/make-spawn-args.js'))
    const packageEnvs = npmRequire(path.join(scriptRoot, 'lib/package-envs.js'))
    const capture = async value => ({ cwd: value.path, environment: makeArgs({ ...value, cmd: value.pkg.scripts[value.event], env: { ...value.env, ...packageEnvs(value.pkg) } })[2].env })
    const intercept = Object.assign(id => id === '@npmcli/run-script' ? capture : runRequire(id), { resolve: runRequire.resolve })
    const module = { exports: {} }
    vm.compileFunction(fs.readFileSync(runFile, 'utf8'), ['require','module','exports'], { filename: runFile })(intercept, module, module.exports)
    const result = await module.exports({ args: input.operation.arguments, call, flatOptions: options, path: config.localPrefix, runPath: process.cwd(), binPaths: input.operation.bins, scriptShell: config.get('script-shell') || undefined })
    process.stdout.write(JSON.stringify(result))
    return
  }
  if (input.operation.kind === 'install') {
    const effective = Object.assign(Object.create(null), ...config.list.slice(0, -1).toReversed())
    delete effective.before
    delete effective['min-release-age']
    if (before && before.kind === 'before') effective.before = before.date
    else effective['min-release-age'] = before ? before.days : 0
    const bound = new Set(Object.keys(input.boundEnvironment).map(key => key.toLowerCase()))
    const role = new Set(['prefix', 'global', 'workspace', 'workspaces', 'include-workspace-root', 'package', 'call', 'script-shell', ...Object.keys(input.defaults)])
    const serialized = Object.entries(effective).flatMap(([key,value]) => {
      if (role.has(key) || bound.has('npm_config_' + key.replaceAll('-', '_').toLowerCase())) return []
      return (Array.isArray(value) ? value : [value]).flatMap(item => typeof item === 'object' && item !== null && !(item instanceof Date)
        ? [] : ['--' + key + '=' + (item instanceof Date ? item.toISOString() : item === null ? '' : String(item))])
    })
    const prefix = path.join(input.runtimeRoot, 'prepared', input.operation.key)
    fs.mkdirSync(prefix, { recursive: true })
    process.argv = [process.execPath, input.npmCli, 'install', ...serialized, '--prefix', prefix, '--global=false', '--workspaces=false', ...Object.entries(input.defaults).map(([key,value]) => '--' + key + '=' + value), '--', ...input.operation.specs]
    // The bound authority also carries pnpm's directories under npm's prefix (pnpm reads no
    // other name). npm itself receives only the bound keys its own definitions declare.
    for (const key of bound) {
      if (!key.startsWith('npm_config_') || Object.hasOwn(definitions, key.slice('npm_config_'.length).replace(/(?!^)_/g, '-'))) continue
      for (const name of Object.keys(process.env)) if (name.toLowerCase() === key) delete process.env[name]
    }
    require(input.npmCli)
    return
  }
  if (input.operation.kind === 'normalize') {
    fs.mkdirSync(input.content.temporary, { recursive: true, mode: 0o700 })
    const content = vm.runInThisContext('(' + input.contentProgram + ')')({ ...input.content, packageOptions: { ...options, ignoreScripts: input.defaults['ignore-scripts'] === 'true' } })
    const semver = npmRequire('semver')
    const requirements = []
    const installSpecs = []
    for (const request of requests) {
      const attributes = request.alias ? { alias: request.alias } : {}
      if (request.registry) {
        requirements.push({ kind: 'registry', name: request.name, version: request.type === 'version' ? semver.valid(request.rawSpec) : request.type === 'range' ? new semver.Range(request.rawSpec).range || '*' : request.rawSpec, ...attributes })
        installSpecs.push(request.specification)
      } else if (request.type === 'directory' || request.type === 'file' || request.type === 'git' && /^file:/.test(request.fetchSpec || '')) {
        const source = request.type === 'git' ? require('node:url').fileURLToPath(request.fetchSpec) : request.fetchSpec
        const sha256 = await content.identify(source, 'npm')
        requirements.push({ kind: 'content', sha256: request.type === 'git' ? require('node:crypto').createHash('sha256').update(sha256 + '\n' + request.revision).digest('hex') : sha256, ...(request.name ? { name: request.name } : {}), ...attributes })
        const archive = request.type === 'directory' ? await content.archive(source) : source
        installSpecs.push(request.type === 'git' ? request.specification : (request.alias || request.name ? (request.alias || request.name) + '@' : '') + 'file:' + archive)
      } else if (request.type === 'git') {
        requirements.push({ kind: 'git', url: request.fetchSpec, revision: request.revision, ...(request.subdirectory ? { subdirectory: request.subdirectory } : {}), ...attributes })
        installSpecs.push(request.specification)
      } else {
        requirements.push({ kind: 'remote', url: request.fetchSpec, ...(request.name ? { name: request.name } : {}), ...attributes })
        installSpecs.push(request.specification)
      }
    }
    // An explicit repeated package can win by order. This is package-resolution
    // order, never the service's argv or the source's absolute directory.
    process.stdout.write(JSON.stringify({ ...declaration, requirements, installSpecs, configuration: [{ purpose: 'dependencies', value: requirements }] }))
    return
  }
  process.stdout.write(JSON.stringify(declaration))
})().catch((error) => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1 })
`

/** Official npm parsing in the Location; arguments are the original argv after npx/npm. No package or service runs. */
export function readNpmLaunchDeclaration(input: {
  syntax: "npx" | "npm-exec"
  arguments: readonly string[]
  cwd: string
  environment: Record<string, string>
  launchers: LauncherEnvironment
}) {
  return Effect.gen(function* () {
    const result = yield* runNpmLauncher(input, { kind: "declaration" })
    if (result.exitCode !== 0) return yield* Effect.fail({ kind: "unknown", detail: result.stderr } as const)
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(NpmDeclaration))(result.stdout)
  }).pipe(Effect.mapError(npmFailure))
}

export function normalizeNpmLaunchDeclaration(
  input: Parameters<typeof readNpmLaunchDeclaration>[0] & { python: string; temporary: string },
) {
  return Effect.gen(function* () {
    const result = yield* runNpmLauncher(input, {
      kind: "normalize",
      content: connectorContentRuntime(input.launchers, input.python, input.temporary),
    })
    if (result.exitCode !== 0) return yield* Effect.fail({ kind: "unknown", detail: result.stderr } as const)
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(NpmContent))(result.stdout)
  }).pipe(Effect.mapError(npmFailure))
}

export function installNpmConnector(
  input: Parameters<typeof readNpmLaunchDeclaration>[0] & { key: string; installSpecs: readonly string[] },
) {
  return runNpmLauncher(input, { kind: "install", key: input.key, specs: input.installSpecs })
}

export function readNpmLaunchEnvironment(input: Parameters<typeof readNpmLaunchDeclaration>[0] & { serviceArguments: readonly string[]; packageBins: readonly string[] }) {
  return Effect.gen(function* () {
    const result = yield* runNpmLauncher(input, { kind: "environment", arguments: input.serviceArguments, bins: input.packageBins })
    if (result.exitCode !== 0) return yield* Effect.fail({ kind: "unknown", detail: result.stderr } as const)
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ cwd: Schema.String, environment: Schema.Record(Schema.String, Schema.String) })))(result.stdout).pipe(Effect.mapError((): ConnectorLaunchFailure => ({ kind: "unknown", detail: "Could not decode npm execution metadata" })))
  }).pipe(Effect.mapError(npmFailure))
}

function runNpmLauncher(
  input: Parameters<typeof readNpmLaunchDeclaration>[0],
  operation:
    | { kind: "declaration" }
    | { kind: "normalize"; content: ReturnType<typeof connectorContentRuntime> }
    | { kind: "install"; key: string; specs: readonly string[] }
    | { kind: "environment"; arguments: readonly string[]; bins: readonly string[] },
) {
  return Effect.gen(function* () {
    const environment = yield* Environment.Service
    const process = yield* environment.spawner.spawn(
      ChildProcess.make(input.launchers.node, ["--input-type=commonjs", "-e", npmDeclarationProgram], {
        cwd: input.cwd,
        env: input.environment,
        extendEnv: false,
        stdin: {
          stream: Stream.succeed(
            new TextEncoder().encode(
              JSON.stringify({
                syntax: input.syntax,
                arguments: input.arguments,
                npmCli: input.launchers.npmCli,
                npxCli: input.launchers.npxCli,
                operation,
                content: operation.kind === "normalize" ? operation.content : undefined,
                contentProgram: connectorSourceProgram,
                runtimeRoot: input.launchers.runtimeRoot,
                boundEnvironment: input.launchers.packageManagerEnv,
                defaults: connectorNpmDefaults,
              }),
            ),
          ),
          endOnDone: true,
        },
      }),
    )
    const [exitCode, stdout, stderr] = yield* Effect.all(
      [process.exitCode, Stream.mkUint8Array(process.stdout), Stream.mkUint8Array(process.stderr)],
      { concurrency: "unbounded" },
    )
    return {
      exitCode: Number(exitCode),
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
    }
  }).pipe(Effect.mapError(npmFailure))
}

function npmFailure(error: unknown): ConnectorLaunchFailure {
  return {
    kind: "unknown",
    detail: typeof error === "object" && error !== null && "detail" in error ? String(error.detail) : String(error),
  }
}
