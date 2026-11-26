import { Effect, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import type { ConnectorLaunchFailure, LauncherEnvironment } from "@opencode/util/codepuppy-connector-launch"
import { Environment } from "../environment/index.js"
import { connectorResolutionContent } from "./codepuppy-connector-key.js"
import { connectorSecretQueryPattern } from "./codepuppy-connector-diagnostic.js"

/** Runs on the Location. The npm pack list and Python's TOML reader remain their format owners. */
export const connectorSourceProgram = String.raw`
(input) => {
  const fs = require('node:fs')
  const path = require('node:path')
  const crypto = require('node:crypto')
  const { createRequire } = require('node:module')
  const { spawnSync } = require('node:child_process')
  const { fileURLToPath } = require('node:url')
  const npmRequire = createRequire(input.npmCli)
  const normalize = require('node:vm').runInThisContext('(' + input.normalizer + ')')
  const clean = value => normalize(value, input.queryPattern)
  const digest = value => crypto.createHash('sha256').update(JSON.stringify(clean(value))).digest('hex')
  const metadata = (file, bytes) => {
    if (path.extname(file) === '.json') {
      try { return JSON.parse(bytes.toString('utf8')) } catch { return undefined }
    }
    if (path.extname(file) === '.toml') {
      const result = spawnSync(input.python, ['-I', '-S', '-c', 'import json,sys,tomllib;print(json.dumps(tomllib.loads(sys.stdin.read(), parse_float=str),default=str))'], { input: bytes, encoding: 'utf8', env: process.env })
      if (result.status !== 0) return undefined
      return JSON.parse(result.stdout)
    }
    return undefined
  }
  const local = (text, base) => {
    const match = /^(.*?\s+@\s+)?((?:git\+)?file:[^\s;]+|\.{1,2}[\\/][^\s;]+|[A-Za-z]:[\\/][^\s;]+|\/[^\s;]+)(.*)$/.exec(text)
    if (!match) return
    const reference = match[2].replace(/^git\+/, '')
    const file = reference.startsWith('file://') ? fileURLToPath(reference) : path.resolve(base, decodeURIComponent(reference.replace(/^file:/, '')))
    return { file, prefix: match[1] || '', suffix: match[3] }
  }
  async function identify(file, manager) {
    const nodes = []
    const visited = new Map()
    const rewrite = async (value, base, source = false) => {
      if (typeof value === 'string') {
        const reference = source || /^(?:.*?\s+@\s+)?(?:git\+)?file:/.test(value) ? local(value, base) : undefined
        return reference ? { source: await visit(reference.file), prefix: reference.prefix, suffix: reference.suffix } : clean(value)
      }
      if (Array.isArray(value)) return Promise.all(value.map(item => rewrite(item, base, source)))
      if (value === null || typeof value !== 'object') return value
      const result = Object.create(null)
      for (const key of Object.keys(value).sort()) {
        if (!Object.hasOwn(clean({ [key]: null }), key)) continue
        result[key] = await rewrite(value[key], base, source || ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides', 'resolutions', 'sources'].includes(key))
      }
      return result
    }
    const visit = async source => {
      const canonical = fs.realpathSync(source)
      if (visited.has(canonical)) return visited.get(canonical)
      const id = nodes.length
      visited.set(canonical, id)
      nodes.push(null)
      if (fs.statSync(canonical).isFile()) {
        const bytes = fs.readFileSync(canonical)
        const parsed = metadata(canonical, bytes)
        nodes[id] = parsed === undefined ? { bytes: crypto.createHash('sha256').update(bytes).digest('hex') } : { content: await rewrite(parsed, path.dirname(canonical)) }
        return id
      }
      const directory = Object.create(null)
      const files = manager === 'npm' && fs.existsSync(path.join(canonical, 'package.json'))
        ? await npmRequire('npm-packlist')(await new (npmRequire('@npmcli/arborist'))({ ...input.packageOptions, path: canonical }).loadActual())
        : null
      if (files) {
        for (const name of files.sort()) directory[name.split(path.sep).join('/')] = await visit(path.join(canonical, name))
      } else {
        for (const entry of fs.readdirSync(canonical, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
          if (['.git', '.hg', '.svn', '__pycache__', '.venv', '.env'].includes(entry.name) || entry.name.startsWith('.env.')) continue
          directory[entry.name] = await visit(path.join(canonical, entry.name))
        }
      }
      nodes[id] = { files: directory }
      return id
    }
    await visit(file)
    return digest(nodes)
  }
  const archived = new Map()
  async function archive(directory) {
    const canonical = fs.realpathSync(directory)
    if (archived.has(canonical)) return archived.get(canonical)
    const target = path.join(input.temporary, 'source-' + archived.size + '.tgz')
    archived.set(canonical, target)
    const bytes = await npmRequire('libnpmpack')(canonical, { ...input.packageOptions, dryRun: true })
    const unpacked = target + '.source'
    fs.mkdirSync(unpacked, { recursive: true, mode: 0o700 })
    await new Promise((resolve, reject) => {
      const extract = npmRequire('tar').x({ cwd: unpacked, strip: 1 })
      extract.on('error', reject).on('close', resolve)
      extract.end(bytes)
    })
    const manifestFile = path.join(unpacked, 'package.json')
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    const replace = async value => {
      if (typeof value === 'string') {
        const reference = local(value, canonical)
        if (!reference) return value
        const source = fs.statSync(reference.file).isDirectory() ? await archive(reference.file) : reference.file
        return reference.prefix + 'file:' + source + reference.suffix
      }
      if (value === null || typeof value !== 'object') return value
      for (const key of Object.keys(value)) value[key] = await replace(value[key])
      return value
    }
    for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides'])
      if (manifest[key]) manifest[key] = await replace(manifest[key])
    fs.writeFileSync(manifestFile, JSON.stringify(manifest))
    fs.writeFileSync(target, await npmRequire('libnpmpack')(unpacked, { ...input.packageOptions, dryRun: true }), { mode: 0o600 })
    return target
  }
  return { identify, archive }
}
`

export function connectorContentRuntime(launchers: LauncherEnvironment, python: string, temporary: string) {
  return {
    npmCli: launchers.npmCli,
    python,
    temporary,
    normalizer: connectorResolutionContent.toString(),
    queryPattern: connectorSecretQueryPattern,
  }
}

/** Local source identity is content-based; no directory, Location or credential is a hash salt. */
export function readConnectorSource(input: {
  launchers: LauncherEnvironment
  python: string
  temporary: string
  sources: readonly { path: string; manager: "npm" | "python" }[]
  cwd: string
  environment: Record<string, string>
}) {
  return Effect.gen(function* () {
    const environment = yield* Environment.Service
    const process = yield* environment.spawner.spawn(
      ChildProcess.make(input.launchers.node, ["--input-type=commonjs", "-e", sourceProgram], {
        cwd: input.cwd,
        env: input.environment,
        extendEnv: false,
        stdin: {
          stream: Stream.succeed(
            new TextEncoder().encode(
              JSON.stringify({
                ...connectorContentRuntime(input.launchers, input.python, input.temporary),
                sources: input.sources,
              }),
            ),
          ),
          endOnDone: true,
        },
      }),
    )
    const [code, stdout, stderr] = yield* Effect.all(
      [process.exitCode, Stream.mkUint8Array(process.stdout), Stream.mkUint8Array(process.stderr)],
      { concurrency: "unbounded" },
    )
    if (code !== 0) return yield* Effect.fail({ kind: "unknown", detail: new TextDecoder().decode(stderr) } as const)
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.String)))(
      new TextDecoder().decode(stdout),
    )
  }).pipe(
    Effect.mapError(
      (error): ConnectorLaunchFailure => ({
        kind: "unknown",
        detail: typeof error === "object" && error !== null && "detail" in error ? String(error.detail) : String(error),
      }),
    ),
  )
}

const sourceProgram =
  String.raw`
const fs = require('node:fs')
;(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'))
  const content = (` +
  connectorSourceProgram +
  String.raw`)(input)
  const result = []
  for (const source of input.sources) result.push(await content.identify(source.path, source.manager))
  process.stdout.write(JSON.stringify(result))
})().catch(error => { process.stderr.write(String(error.message)); process.exitCode = 1 })
`
