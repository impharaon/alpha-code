import path from "node:path"
import { randomUUID } from "node:crypto"
import { Effect, Option, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import type { Scope } from "effect"
import type {
  LauncherEnvironment,
  ConnectorLaunchFailure,
  PackageRunner,
} from "@opencode/util/codepuppy-connector-launch"
import { Environment } from "../environment/index.js"

const Preparation = Schema.Struct({
  schema: Schema.Literal(1),
  ready: Schema.Literal(true),
  key: Schema.String,
  runner: Schema.Literals(["uv-tool", "npm-exec"]),
  packages: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
  entries: Schema.Record(Schema.String, Schema.String),
  required: Schema.Array(Schema.String),
})

export type ConnectorPreparation = Omit<typeof Preparation.Type, "schema" | "ready">

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
      ? { npm_config_prefer_offline: "true", npm_config_ignore_scripts: "true", npm_config_update_notifier: "false" }
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
    const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Preparation))(source)
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
  if (typeof error === "object" && error !== null && "kind" in error && error.kind === "unknown" && "detail" in error)
    return { kind: "unknown", detail: String(error.detail) }
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
