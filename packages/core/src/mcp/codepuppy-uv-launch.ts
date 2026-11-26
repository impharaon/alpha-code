import { Effect, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import type { ConnectorLaunchFailure, LauncherEnvironment } from "@opencode/util/codepuppy-connector-launch"
import { Environment } from "../environment/index.js"
import { ConnectorRequirement } from "./codepuppy-connector-key.js"
import { connectorContentRuntime, connectorSourceProgram } from "./codepuppy-connector-content.js"

/** Preserve uv's parsed options; only the tool-run execution switches differ from tool-install. */
export function uvToolInstallArguments(input: {
  syntax: "uvx" | "uv"
  arguments: readonly string[]
  declaration: ReturnType<typeof parseUvToolSettings>
}) {
  const command = input.declaration.command
  const offset = input.arguments.length - command.length
  if (offset < 0 || command.some((value, index) => input.arguments[offset + index] !== value))
    throw Error("uv command does not match the parsed declaration")
  const original = input.arguments.slice(0, offset)
  if (original.at(-1) === "--") original.pop()
  const options: string[] = []
  for (let index = 0; index < original.length; index++) {
    const token = original[index]!
    if (token === "--from" || token === "--env-file") {
      index++
      continue
    }
    if (/^--(?:from|env-file)=/.test(token) || token === "--isolated" || token === "--no-env-file") continue
    options.push(token)
  }
  const packageSource = input.declaration.from ?? command[0]
  if (!packageSource) throw Error("uv tool declaration has no package source")
  if (input.syntax === "uvx") return ["tool", "install", ...options, "--", packageSource]
  const run = options.findIndex((token, index) => token === "run" && options[index - 1] === "tool")
  if (run === -1) throw Error("Expected uv tool run declaration")
  options[run] = "install"
  return [...options, "--", packageSource]
}

/** The pinned uv parses every CLI/config option without resolving a package or executing a service. */
export function readUvLaunchDeclaration(input: {
  syntax: "uvx" | "uv"
  arguments: readonly string[]
  cwd: string
  environment: Record<string, string>
  launchers: LauncherEnvironment
}) {
  return Effect.gen(function* () {
    const environment = yield* Environment.Service
    const process = yield* environment.spawner.spawn(
      ChildProcess.make(
        input.launchers.uv,
        ["--show-settings", ...(input.syntax === "uvx" ? ["tool", "run"] : []), ...input.arguments],
        { cwd: input.cwd, env: input.environment, extendEnv: false },
      ),
    )
    const [code, stdout, stderr] = yield* Effect.all(
      [process.exitCode, Stream.mkUint8Array(process.stdout), Stream.mkUint8Array(process.stderr)],
      { concurrency: "unbounded" },
    )
    if (code !== 0) return yield* Effect.fail({ kind: "unknown", detail: new TextDecoder().decode(stderr) } as const)
    return yield* Effect.try({
      try: () => parseUvToolSettings(new TextDecoder().decode(stdout)),
      catch: (error): ConnectorLaunchFailure => ({ kind: "unknown", detail: String(error) }),
    })
  }).pipe(Effect.mapError(uvLaunchFailure))
}

/** Install into the caller's per-content UV_TOOL_DIR; preparation never invokes the service command. */
export function installUvConnector(input: {
  installArguments: readonly string[]
  cwd: string
  environment: Record<string, string>
  launchers: LauncherEnvironment
}) {
  return Effect.gen(function* () {
    const environment = yield* Environment.Service
    const process = yield* environment.spawner.spawn(
      ChildProcess.make(input.launchers.uv, input.installArguments, { cwd: input.cwd, env: input.environment, extendEnv: false }),
    )
    const [exitCode, stdout, stderr] = yield* Effect.all(
      [process.exitCode, Stream.mkUint8Array(process.stdout), Stream.mkUint8Array(process.stderr)],
      { concurrency: "unbounded" },
    )
    return { exitCode, stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr) }
  }).pipe(Effect.mapError(uvLaunchFailure))
}

function uvLaunchFailure(error: unknown): ConnectorLaunchFailure {
  return typeof error === "object" && error !== null && "kind" in error && error.kind === "unknown" && "detail" in error
    ? { kind: "unknown", detail: String(error.detail) }
    : { kind: "unknown", detail: String(error) }
}

/** uv owns dotenv expansion and cwd flags. This read-side command executes only our metadata probe. */
export function readUvLaunchEnvironment(input: Parameters<typeof readUvLaunchDeclaration>[0] & {
  declaration: ReturnType<typeof parseUvToolSettings>
}) {
  return Effect.gen(function* () {
    const options = input.arguments.slice(0, input.arguments.length - input.declaration.command.length)
    const directories: string[] = []
    for (let index = 0; index < options.length; index++) {
      const option = options[index]!
      if (option === "--directory") directories.push(option, options[++index]!)
      else if (option.startsWith("--directory=")) directories.push(option)
    }
    const environment = yield* Environment.Service
    const process = yield* environment.spawner.spawn(ChildProcess.make(input.launchers.uv, [
      ...directories, "run", "--offline", "--no-config", "--no-project",
      ...(input.declaration.noEnvironmentFiles ? ["--no-env-file"] : input.declaration.environmentFiles.flatMap(file => ["--env-file", file])),
      "--", input.launchers.node, "--input-type=commonjs", "-e", "process.stdout.write(JSON.stringify({cwd:process.cwd(),environment:process.env}))",
    ], { cwd: input.cwd, env: input.environment, extendEnv: false }))
    const [code, stdout, stderr] = yield* Effect.all([process.exitCode, Stream.mkUint8Array(process.stdout), Stream.mkUint8Array(process.stderr)], { concurrency: "unbounded" })
    if (code !== 0) return yield* Effect.fail({ kind: "unknown", detail: new TextDecoder().decode(stderr) } as const)
    const value = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ cwd: Schema.String, environment: Schema.Record(Schema.String, Schema.String) })))(new TextDecoder().decode(stdout)).pipe(Effect.mapError((): ConnectorLaunchFailure => ({ kind: "unknown", detail: "Could not decode uv execution metadata" })))
    // uv never overwrites an existing variable with an env-file value. Restore
    // the supplied role projection after the metadata probe's own PATH changes.
    return { cwd: value.cwd, environment: { ...value.environment, ...input.environment } }
  }).pipe(Effect.mapError(uvLaunchFailure))
}

const uvSourceOptions = [
  { field: "with_requirements", argument: "--with-requirements", purpose: "dependencies" },
  { field: "constraints", argument: "--constraints", short: "-c", purpose: "constraints" },
  { field: "overrides", argument: "--overrides", purpose: "overrides" },
  { field: "build_constraints", argument: "--build-constraints", short: "-b", purpose: "build-constraints" },
] as const

/** Rebind only editable inputs; installed dependency versions are reused in the private environment. */
export function uvEditableInstallArguments(input: {
  installArguments: readonly string[]
  python: string
  sources: readonly string[]
}) {
  const args: string[] = []
  for (let index = 0; index < input.installArguments.length - 2; index++) {
    const token = input.installArguments[index]!
    if (token === "tool" && input.installArguments[index + 1] === "install") { args.push("pip", "install"); index++; continue }
    if (["--offline", "--reinstall"].includes(token)) continue
    const option = ["--with", "--with-editable", "--with-requirements", "--python", "-p"].find(option => token === option || token.startsWith(option + "=") || option === "-p" && token.startsWith(option))
    if (!option) { args.push(token); continue }
    if (token === option) index++
  }
  return [...args, "--offline", "--no-deps", "--reinstall", "--python", input.python, ...input.sources.flatMap(source => ["--editable", source])]
}

const UvContent = Schema.Struct({
  requirements: Schema.Array(ConnectorRequirement),
  options: Schema.Record(Schema.String, Schema.Unknown),
  configuration: Schema.Array(Schema.Struct({
    purpose: Schema.Literals(["dependencies", "constraints", "overrides", "build-constraints", "source"]),
    value: Schema.Unknown,
  })),
  sourceBindings: Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String, editable: Schema.Boolean })),
  requirementFiles: Schema.Record(Schema.String, Schema.String),
  installFiles: Schema.Array(Schema.Struct({ argument: Schema.Literals(uvSourceOptions.map(value => value.argument)), path: Schema.String })),
  commandName: Schema.NullOr(Schema.String),
  runtimeRequest: Schema.NullOr(Schema.String),
  packageSource: Schema.String,
})

/** Parse package standards with the pinned Python's bundled packaging/pip, never a system module. */
export function normalizeUvLaunchDeclaration(input: Parameters<typeof readUvLaunchDeclaration>[0] & {
  declaration: ReturnType<typeof parseUvToolSettings>
  python: string
  temporary: string
}) {
  return Effect.gen(function* () {
    const environment = yield* Environment.Service
    const execution = yield* readUvLaunchEnvironment(input)
    const handle = yield* environment.spawner.spawn(ChildProcess.make(input.launchers.node, ["--input-type=commonjs", "-e", uvContentProgram], {
      cwd: execution.cwd, env: execution.environment, extendEnv: false,
      stdin: { stream: Stream.succeed(new TextEncoder().encode(JSON.stringify({
        ...connectorContentRuntime(input.launchers, input.python, input.temporary),
        declaration: input.declaration,
        arguments: input.arguments,
        windows: input.launchers.platform === "win32-x64",
        sourceCache: input.launchers.environment.XDG_CACHE_HOME,
        settings: parseUvResolvedValue(input.declaration.fields.settings!),
        pythonPlatform: parseUvResolvedValue(input.declaration.fields.python_platform!),
        sources: Object.fromEntries(uvSourceOptions.map(option => [option.field, parseUvResolvedValue(input.declaration.fields[option.field]!)])),
        sourceOptions: uvSourceOptions,
        sourceProgram: connectorSourceProgram,
        requirementsProgram: uvRequirementProgram,
      }))), endOnDone: true },
    }))
    const [code, stdout, stderr] = yield* Effect.all([handle.exitCode, Stream.mkUint8Array(handle.stdout), Stream.mkUint8Array(handle.stderr)], { concurrency: "unbounded" })
    if (code !== 0) return yield* Effect.fail({ kind: "unknown", detail: new TextDecoder().decode(stderr) } as const)
    const value = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(UvContent))(new TextDecoder().decode(stdout))
    const original = uvToolInstallArguments(input)
    const options: string[] = []
    for (let index = 0; index < original.length - 2; index++) {
      const token = original[index]!
      const source = uvSourceOptions.find(option => token === option.argument || token.startsWith(option.argument + "=") || "short" in option && token.startsWith(option.short))
      if (!source) { options.push(token); continue }
      if (token === source.argument || "short" in source && token === source.short) index++
    }
    return { ...value, cwd: execution.cwd, installArguments: [...options, ...value.installFiles.flatMap(value => [value.argument, value.path]), "--", value.packageSource], declaration: { ...input.declaration, commandName: value.commandName } }
  }).pipe(Effect.mapError(uvLaunchFailure))
}

/** uv validates its own interpreter selector, without a package request or an online Python download. */
export function checkUvPinnedPythonRequest(input: {
  launchers: LauncherEnvironment
  python: string
  cwd: string
  environment: Record<string, string>
  request: { tool: string; python: string | null }
}) {
  return Effect.gen(function* () {
    const environment = yield* Environment.Service
    const handle = yield* environment.spawner.spawn(ChildProcess.make(input.launchers.uv, [
      "tool", "run", "--offline", "--no-config", "--from", input.request.tool,
      ...(input.request.python === null ? [] : ["--python", input.request.python]), "--", input.launchers.node,
      "--input-type=commonjs", "-e",
      "const fs=require('node:fs'),path=require('node:path');const scripts=process.env.PATH.split(path.delimiter)[0];const selected=path.join(scripts,process.platform==='win32'?'python.exe':'python');const expected=fs.realpathSync(process.argv[1]);const normalize=value=>process.platform==='win32'?value.toLowerCase():value;let matches=normalize(fs.realpathSync(selected))===normalize(expected);if(!matches&&process.platform==='win32'){const cfg=path.join(path.dirname(scripts),'pyvenv.cfg');const home=fs.existsSync(cfg)&&/^home\\s*=\\s*(.+)$/m.exec(fs.readFileSync(cfg,'utf8'))?.[1].trim();matches=!!home&&normalize(fs.realpathSync(home))===normalize(path.dirname(expected))}process.stdout.write(JSON.stringify(matches))",
      input.python,
    ], { cwd: input.cwd, env: input.environment, extendEnv: false }))
    const [code, stdout, stderr] = yield* Effect.all([handle.exitCode, Stream.mkUint8Array(handle.stdout), Stream.mkUint8Array(handle.stderr)], { concurrency: "unbounded" })
    if (code !== 0) return yield* Effect.fail({ kind: "unknown", detail: new TextDecoder().decode(stderr) } as const)
    if (new TextDecoder().decode(stdout).trim() !== "true")
      return yield* Effect.fail({ kind: "unknown", detail: "The requested interpreter does not match the pinned Python" } as const)
  }).pipe(Effect.mapError(uvLaunchFailure))
}

const uvRequirementProgram = String.raw`
import json, pathlib, sys
# ensurepip is part of the pinned standalone interpreter, including on Windows.
root = pathlib.Path(sys.base_prefix)
wheels = list(root.glob('lib/python*/ensurepip/_bundled/pip-*.whl')) + list(root.glob('Lib/ensurepip/_bundled/pip-*.whl'))
if len(wheels) != 1:
    raise ValueError('Pinned Python ensurepip wheel is missing')
sys.path.insert(0, str(wheels[0]))
from pip._vendor.packaging.requirements import Requirement, InvalidRequirement
from pip._vendor.packaging.utils import canonicalize_name
from pip._vendor.packaging.version import Version, InvalidVersion
from pip._vendor.packaging.specifiers import SpecifierSet, InvalidSpecifier
from pip._internal.req.req_file import preprocess, get_line_parser
data = json.load(sys.stdin)
def requirement(text):
    try:
        value = Requirement(text)
        return dict(name=canonicalize_name(value.name), extras=sorted(canonicalize_name(extra) for extra in value.extras), version=str(value.specifier) or '*', url=value.url, marker=str(value.marker) if value.marker else None)
    except InvalidRequirement:
        # uv also accepts unnamed paths/URLs and the tool-only name@version spelling.
        return dict(source=text)
def interpreter(text):
    # uv0.13.10 PythonRequest::try_from_tool_name uses these full implementation
    # names, and accepts Python version selectors rather than PEP508 package extras.
    value = text.lower()
    for prefix in ['python'] + (['pythonw'] if data.get('windows') else []) + ['cpython', 'pypy', 'graalpy']:
        if not value.startswith(prefix):
            continue
        suffix = value[len(prefix):]
        if not suffix or suffix.startswith('@'):
            return value
        if suffix.isspace():
            continue
        for candidate in [suffix, suffix.removesuffix('t').removesuffix('d')]:
            try:
                Version(candidate)
                return value
            except InvalidVersion:
                pass
            for expression in [candidate, '==' + candidate]:
                try:
                    SpecifierSet(expression)
                    return value
                except InvalidSpecifier:
                    pass
    return None
if 'requirement' in data:
    target = interpreter(data['requirement']) if data.get('tool') else None
    result = dict(interpreter=target, pipWheel=str(wheels[0])) if target else requirement(data['requirement'])
else:
    result = []
    parse = get_line_parser(None)
    for _, line in preprocess(data['content']):
        args, options = parse(line)
        result.append(dict(requirement=args, editables=options.editables, requirements=options.requirements, constraints=options.constraints, index=options.index_url, extraIndexes=options.extra_index_urls, links=options.find_links, noIndex=options.no_index, requireHashes=options.require_hashes, hashes=options.hashes, noBinary=sorted(options.format_control.no_binary), onlyBinary=sorted(options.format_control.only_binary)))
print(json.dumps(result))
`

const uvContentProgram = String.raw`
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { fileURLToPath } = require('node:url')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')
;(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  const clean = require('node:vm').runInThisContext('(' + input.normalizer + ')')
  const sanitize = value => clean(value, input.queryPattern)
  const content = require('node:vm').runInThisContext('(' + input.sourceProgram + ')')(input)
  const python = data => {
    const result = spawnSync(input.python, ['-I', '-S', '-c', input.requirementsProgram], { input: JSON.stringify(data), encoding: 'utf8', env: process.env })
    if (result.status !== 0) throw Error(result.stderr)
    return JSON.parse(result.stdout)
  }
  fs.mkdirSync(input.temporary, { recursive: true, mode: 0o700 })
  const requirements = []
  const sourceBindings = []
  const local = async (reference, editable = false) => {
    const file = reference.startsWith('file:') ? fileURLToPath(new URL(reference, 'file://' + process.cwd() + '/')) : path.resolve(reference)
    const sha256 = await content.identify(file, 'python')
    if (!sourceBindings.some(value => value.path === file && value.editable === editable)) sourceBindings.push({ path: file, sha256, editable })
    return { kind: 'content', sha256 }
  }
  let runtimeRequest = null
  let packageSource = input.declaration.from || input.declaration.command[0]
  const requirement = async (text, editable = false, implicit = false, tool = false) => {
    const target = tool ? python({ requirement: text, tool: true, windows: input.windows }) : null
    if (tool) {
      if (target.interpreter) { runtimeRequest = target.interpreter; packageSource = target.pipWheel; return { kind: 'interpreter', request: target.interpreter } }
    }
    const expanded = implicit ? text.replace(/^([^/@\\]+)@([^@]+)$/, (_,name,version) => name + (version === 'latest' ? '' : '==' + version)) : text
    const parsed = target && expanded === text ? target : python({ requirement: expanded })
    const attributes = { ...(parsed.name ? { name: parsed.name } : {}), ...(parsed.extras?.length ? { extras: parsed.extras } : {}), ...(parsed.marker ? { marker: parsed.marker } : {}), ...(editable ? { editable: true } : {}) }
    let source = parsed.url || parsed.source
    if (source && !parsed.url && !fs.existsSync(path.resolve(source))) {
      const extras = /\[([^\]]+)\]$/.exec(source)
      if (extras) { attributes.extras = extras[1].split(',').map(value => value.trim().toLowerCase().replace(/[-_.]+/g, '-')).sort(); source = source.slice(0, -extras[0].length) }
    }
    if (!source) return { kind: 'registry', name: parsed.name, version: parsed.version, ...attributes }
    if (/^(?:git\+)?file:/.test(source) || /^(?:\.{1,2}[\\/]|\/|[A-Za-z]:[\\/])/.test(source) || fs.existsSync(path.resolve(source))) {
      return { ...await local(source.replace(/^git\+/, ''), editable), ...attributes }
    }
    if (/^git\+/.test(source)) {
      const url = new URL(source)
      const at = url.pathname.lastIndexOf('@')
      const revision = at < 0 ? '' : url.pathname.slice(at + 1)
      if (at >= 0) url.pathname = url.pathname.slice(0, at)
      const subdirectory = new URLSearchParams(url.hash.slice(1)).get('subdirectory')
      url.hash = ''
      return { kind: 'git', url: sanitize(url.toString()), revision, ...(subdirectory ? { subdirectory } : {}), ...attributes }
    }
    return { kind: 'remote', url: sanitize(source), ...attributes }
  }
  const scalar = value => value === null || typeof value !== 'object' ? String(value ?? '') : value.kind === 'tuple' ? value.items.map(scalar).join('') : (() => { throw Error('Invalid uv URL component') })()
  const url = value => {
    const f = value.fields
    const host = scalar(f.host)
    return scalar(f.scheme) + '://' + (host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host) + (f.port == null ? '' : ':' + scalar(f.port)) + scalar(f.path) + (f.query == null ? '' : '?' + scalar(f.query)) + (f.fragment == null ? '' : '#' + scalar(f.fragment))
  }
  const project = async value => {
    if (Array.isArray(value)) return Promise.all(value.map(project))
    if (value === null || typeof value !== 'object') return typeof value === 'string' && /^(?:file:|\.{1,2}[\\/]|\/|[A-Za-z]:[\\/])/.test(value) ? local(value) : value
    if (value.kind === 'tuple') return value.name === 'Some' || value.name === 'Url' ? project(value.items[0]) : { type: value.name, values: await Promise.all(value.items.map(project)) }
    if (value.name === 'SafeUrl') { const source = url(value); return source.startsWith('file:') ? local(source) : sanitize(source) }
    if (value.name === 'VerbatimUrl') return project(value.fields.url)
    const entries = []
    for (const [key, item] of Object.entries(value.fields)) if (key !== 'origin' && Object.hasOwn(sanitize({ [key]: null }), key)) entries.push([key, await project(item)])
    return Object.fromEntries(entries)
  }
  const settings = input.settings.fields.resolver
  const options = await project(settings)
  options.python_platform = await project(input.pythonPlatform)
  const files = []
  const seen = new Map()
  const requirementFiles = Object.create(null)
  const rawUrl = reference => {
    const withoutCredentials = source => { const value = new URL(source); value.username = ''; value.password = ''; return value.href }
    const candidates = [...input.arguments, ...Object.values(process.env)].flatMap(value => String(value).match(/https?:\/\/[^\s<>"']+/g) || [])
    return candidates.filter(value => URL.canParse(value)).find(value => withoutCredentials(value) === withoutCredentials(reference)) || reference
  }
  const readFile = async reference => {
    if (!/^https?:/.test(reference)) return fs.readFileSync(reference.startsWith('file:') ? fileURLToPath(reference) : reference, 'utf8')
    const npmRequire = createRequire(input.npmCli)
    const target = new URL(rawUrl(reference))
    const authorization = target.username || target.password ? 'Basic ' + Buffer.from(decodeURIComponent(target.username) + ':' + decodeURIComponent(target.password)).toString('base64') : undefined
    target.username = ''; target.password = ''
    const response = await npmRequire('make-fetch-happen')(target.href, { headers: authorization ? { authorization } : {}, proxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY, noProxy: process.env.NO_PROXY, cachePath: path.join(input.sourceCache, 'connector-requirements'), cache: 'force-cache' })
    if (!response.ok) throw Error('Requirement source HTTP ' + response.status + ' ' + target.origin)
    return response.text()
  }
  const read = async reference => {
    const canonical = /^https?:/.test(reference) ? reference : fs.realpathSync(reference.startsWith('file:') ? fileURLToPath(reference) : reference)
    if (seen.has(canonical)) return seen.get(canonical)
    const id = files.length
    const target = path.join(input.temporary, 'requirements-' + id + '.txt')
    seen.set(canonical, id); files.push(null); requirementFiles[reference] = target
    const records = python({ content: (await readFile(canonical)).replace(/^(-[rce])=/gm, '$1 ') })
    const facts = []
    const lines = []
    for (const record of records) {
      const value = {}
      if (record.requirement) { value.requirement = await requirement(record.requirement); lines.push(record.requirement + Object.entries(record.hashes || {}).flatMap(([algorithm, hashes]) => hashes.map(hash => ' --hash=' + algorithm + ':' + hash)).join('')) }
      if (record.editables?.length) { value.editables = await Promise.all(record.editables.map(spec => requirement(spec, true))); lines.push(...record.editables.map(spec => '-e ' + spec)) }
      for (const [field, flag] of [['requirements', '-r'], ['constraints', '-c']]) for (const child of record[field] || []) {
        const next = /^https?:/.test(canonical) ? new URL(child, canonical).toString() : path.resolve(path.dirname(canonical), child)
        const edge = await read(next)
        ;(value[field] ||= []).push({ file: edge }); lines.push(flag + ' ' + JSON.stringify(path.join(input.temporary, 'requirements-' + edge + '.txt')))
      }
      for (const [field, flag] of [['index', '--index-url'], ['extraIndexes', '--extra-index-url'], ['links', '--find-links']]) for (const item of typeof record[field] === 'string' ? [record[field]] : record[field] || []) {
        const source = field === 'links' && !/^[a-z][a-z0-9+.-]*:/.test(item) ? path.resolve(item) : item
        ;(value[field] ||= []).push(field === 'links' && !/^https?:/.test(source) ? await local(source) : sanitize(source)); lines.push(flag + ' ' + source)
      }
      for (const [field, flag] of [['noIndex','--no-index'],['requireHashes','--require-hashes']]) if (record[field]) { value[field] = true; lines.push(flag) }
      for (const [field, flag] of [['noBinary','--no-binary'],['onlyBinary','--only-binary']]) if (record[field]?.length) { value[field] = record[field]; lines.push(flag + ' ' + record[field].join(',')) }
      if (Object.keys(record.hashes || {}).length) value.hashes = record.hashes
      facts.push(value)
    }
    files[id] = facts
    fs.writeFileSync(target, lines.join('\n') + '\n', { mode: 0o600 })
    return id
  }
  const main = await requirement(input.declaration.from || input.declaration.command[0], false, !input.declaration.from, true)
  requirements.push(main)
  for (const source of input.declaration.with) requirements.push(await requirement(source))
  for (const source of input.declaration.withEditable) requirements.push(await requirement(source, true))
  const configuration = []
  const installFiles = []
  for (const {field,purpose,argument} of input.sourceOptions) for (const source of input.sources[field]) {
    const reference = source.name === 'Local' ? scalar(source.items[0]) : source.name === 'Remote' ? url(source.items[0]) : '-'
    if (reference === '-') {
      // Preparation has a closed input stream; protocol stdin belongs to the later service.
      // Give uv the same EOF source without consuming the service's initialize message.
      const target = path.join(input.temporary, 'requirements-stdin.txt')
      fs.writeFileSync(target, '', { mode: 0o600 }); requirementFiles[reference] = target
      installFiles.push({ argument, path: target })
      configuration.push({ purpose, value: [] }); continue
    }
    const file = await read(reference)
    installFiles.push({ argument, path: path.join(input.temporary, 'requirements-' + file + '.txt') })
    configuration.push({ purpose, value: { file } })
  }
  if (files.length) configuration.push({ purpose: 'source', value: files })
  const commandName = input.declaration.from ? null : runtimeRequest ? 'python' : main.name ? /^[A-Za-z0-9_.-]+/.exec(input.declaration.command[0])?.[0] || main.name : null
  process.stdout.write(JSON.stringify({ requirements, options, configuration, sourceBindings, requirementFiles, installFiles, commandName, runtimeRequest, packageSource }))
})().catch(error => { if(typeof error.code==='string'&&/^[A-Z][A-Z_0-9]+$/.test(error.code))process.stderr.write('Connector source code '+error.code+'\n');process.stderr.write(String(error.message)); process.exitCode = 1 })
`

export type UvResolvedValue = string | number | boolean | null | UvResolvedValue[] |
  { kind: "record"; name: string; fields: Record<string, UvResolvedValue> } |
  { kind: "tuple"; name: string; items: UvResolvedValue[] }

/** Parser for the pinned Rust Debug value grammar, not a second uv CLI parser. */
export function parseUvResolvedValue(source: string): UvResolvedValue {
  let offset = 0
  const space = () => { while (/\s/.test(source[offset] ?? "")) offset++ }
  const sequence = (end: string) => {
    const values: UvResolvedValue[] = []
    for (;;) {
      space()
      if (source[offset] === end) { offset++; return values }
      if (offset >= source.length) throw Error("Incomplete uv resolved sequence")
      values.push(value())
      space()
      if (source[offset] === ",") offset++
      else if (source[offset] !== end) throw Error("Invalid uv resolved sequence")
    }
  }
  const record = (name: string): UvResolvedValue => {
    const fields: Record<string, UvResolvedValue> = Object.create(null)
    for (;;) {
      space()
      if (source[offset] === "}") { offset++; return { kind: "record", name, fields } }
      const quoted = source[offset] === '"'
      let key = quoted ? String(value()) : /^[a-zA-Z_][\w-]*/.exec(source.slice(offset))?.[0]
      if (key === undefined) throw Error("Invalid uv resolved field")
      if (!quoted) {
        offset += key.length
        space()
        if (source[offset] === "(") { offset++; const items = sequence(")"); key = items.length === 1 ? String(items[0]) : JSON.stringify([key, items]) }
      }
      space()
      if (source[offset++] !== ":") throw Error("Invalid uv resolved field separator")
      fields[key] = value()
      space()
      if (source[offset] === ",") offset++
      else if (source[offset] !== "}") throw Error("Invalid uv resolved record")
    }
  }
  const value = (): UvResolvedValue => {
    space()
    const begin = offset
    if (source[offset] === '"') {
      offset++
      let escaped = false
      while (offset < source.length) {
        const char = source[offset++]!
        if (escaped) escaped = false
        else if (char === "\\") escaped = true
        else if (char === '"') return strings(source.slice(begin, offset), "scalar")[0]!
      }
      throw Error("Incomplete uv resolved string")
    }
    if (source[offset] === "[") { offset++; return sequence("]") }
    if (source[offset] === "(") { offset++; return { kind: "tuple", name: "", items: sequence(")") } }
    if (source[offset] === "{") { offset++; return record("") }
    const token = /^[^\s,(){}\[\]]+/.exec(source.slice(offset))?.[0]
    if (!token) throw Error("Invalid uv resolved value")
    offset += token.length
    space()
    if (source[offset] === "(") { offset++; return { kind: "tuple", name: token, items: sequence(")") } }
    if (source[offset] === "{") { offset++; return record(token) }
    if (token === "None") return null
    if (token === "true" || token === "false") return token === "true"
    return /^-?\d+(?:\.\d+)?$/.test(token) ? Number(token) : token
  }
  const result = value()
  space()
  if (offset !== source.length) throw Error("Trailing uv resolved data")
  return result
}

/** uv 0.13.10 Debug output is a pinned internal wire format. Keep config transient, never hash the whole text. */
export function parseUvToolSettings(text: string) {
  const start = /^ToolRunSettings \{\r?$/m.exec(text)
  if (!start) throw Error("Missing uv ToolRunSettings")
  const fields: Record<string, string> = {}
  let offset = start.index + start[0].length
  while (offset < text.length) {
    while (/\s/.test(text[offset] ?? "")) offset++
    if (text[offset] === "}")
      return {
        command: strings(fields.command!, "list"),
        from: strings(fields.from!, "scalar").at(0) ?? null,
        with: strings(fields.with!, "list"),
        withEditable: strings(fields.with_editable!, "list"),
        environmentFiles: strings(fields.env_file!, "list"),
        noEnvironmentFiles: fields.no_env_file === "true",
        // This includes effective resolver options and operational/volatile settings. The
        // content-key stage must select non-secret resolution facts, not this entire object.
        fields,
      }
    const name = /^[a-z_]+:/.exec(text.slice(offset))
    if (!name) throw Error("Invalid uv settings field")
    offset += name[0].length
    const begin = offset
    const stack: string[] = []
    let quoted = false
    let escaped = false
    for (; offset < text.length; offset++) {
      const char = text[offset]!
      if (quoted) {
        if (escaped) escaped = false
        else if (char === "\\") escaped = true
        else if (char === '"') quoted = false
        continue
      }
      if (char === '"') {
        quoted = true
        continue
      }
      if ("([{".includes(char)) {
        stack.push(char)
        continue
      }
      if (")]}".includes(char)) {
        const opened = stack.pop()
        if (opened !== { ")": "(", "]": "[", "}": "{" }[char]) throw Error("Unbalanced uv settings value")
        continue
      }
      if (char !== "," || stack.length) continue
      fields[name[0].slice(0, -1)] = text.slice(begin, offset).trim()
      offset++
      break
    }
  }
  throw Error("Incomplete uv ToolRunSettings")
}

export function uvPythonRequest(declaration: ReturnType<typeof parseUvToolSettings>) {
  return strings(declaration.fields.python!, "scalar").at(0) ?? null
}

function strings(source: string, shape: "list" | "scalar") {
  if (source === undefined) throw Error("Missing uv settings value")
  let text = source.trim()
  if (text === "None") return []
  if (text.startsWith("Some(")) {
    if (!text.endsWith(")")) throw Error("Invalid uv settings option")
    text = text.slice(5, -1).trim().replace(/,$/, "").trim()
  }
  if (shape === "list") {
    if (!text.startsWith("[") || !text.endsWith("]")) throw Error("Invalid uv settings list")
    text = text.slice(1, -1)
  }
  const result: string[] = []
  for (let offset = 0; offset < text.length; ) {
    while (/[\s,]/.test(text[offset] ?? "")) offset++
    if (offset === text.length) break
    if (text[offset++] !== '"') throw Error("Invalid uv settings string")
    let value = ""
    let closed = false
    while (offset < text.length) {
      const char = text[offset++]!
      if (char === '"') {
        closed = true
        break
      }
      if (char !== "\\") {
        value += char
        continue
      }
      const escape = text[offset++]!
      const simple: Record<string, string> = { '"': '"', "'": "'", "\\": "\\", n: "\n", r: "\r", t: "\t", "0": "\0" }
      if (simple[escape] !== undefined) {
        value += simple[escape]
        continue
      }
      if (escape === "u" && text[offset] === "{") {
        const end = text.indexOf("}", offset)
        const hex = text.slice(offset + 1, end)
        if (end === -1 || !/^[a-f0-9]{1,6}$/i.test(hex)) throw Error("Invalid uv Unicode escape")
        const code = Number.parseInt(hex, 16)
        if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw Error("Invalid uv Unicode scalar")
        value += String.fromCodePoint(code)
        offset = end + 1
        continue
      }
      throw Error("Invalid uv string escape")
    }
    if (!closed) throw Error("Unterminated uv settings string")
    result.push(value)
  }
  if (shape === "scalar" && result.length !== 1) throw Error("Invalid uv scalar value")
  return result
}
