import { Effect, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import type { ConnectorLaunchFailure, LauncherEnvironment } from "@opencode/util/codepuppy-connector-launch"
import { Environment } from "../environment/index.js"

const NpmDeclaration = Schema.Struct({
  arguments: Schema.Array(Schema.String),
  packages: Schema.Array(
    Schema.Struct({ specification: Schema.String, name: Schema.NullOr(Schema.String), type: Schema.String }),
  ),
  call: Schema.String,
  scriptShell: Schema.NullOr(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  resolutionOptions: Schema.Record(Schema.String, Schema.Unknown),
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
  const command = config.parsedArgv.remain.shift()
  const { deref } = npmRequire('../lib/utils/cmd-list.js')
  if (deref(command) !== 'exec') throw new Error('Expected npm exec declaration')
  const packages = config.get('package').map((specification) => {
    const parsed = npa(specification, process.cwd())
    return { specification, name: parsed.name ?? null, type: parsed.type }
  })
  const options = config.flat
  process.stdout.write(JSON.stringify({ arguments: config.parsedArgv.remain, packages, call: config.get('call'), scriptShell: config.get('script-shell'), options, resolutionOptions: { ...options, before } }))
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
    if (exitCode !== 0)
      return yield* Effect.fail({ kind: "unknown", detail: new TextDecoder().decode(stderr) } as const)
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(NpmDeclaration))(new TextDecoder().decode(stdout))
  }).pipe(
    Effect.mapError(
      (error): ConnectorLaunchFailure => ({
        kind: "unknown",
        detail: typeof error === "object" && error !== null && "detail" in error ? String(error.detail) : String(error),
      }),
    ),
  )
}
