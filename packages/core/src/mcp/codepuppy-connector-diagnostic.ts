import path from "node:path"
import { Effect, Exit, PlatformError, References, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import type {
  ConnectorLaunchDiagnostic,
  ConnectorLaunchFailure,
  ConnectorLaunchHost,
  ConnectorLaunchState,
  LaunchIdentity,
} from "@opencode/util/codepuppy-connector-launch"
import { KilledBySignal } from "@opencode/util/cross-spawn-spawner"
import { Environment } from "../environment/index.js"

/** The connection owns one producer per attempt; root only transports its snapshots and queries. */
export function createConnectorLaunchAttempt(
  input: Parameters<typeof observeConnectorLaunch>[0] & {
    sidecarGeneration: string
    changed: ConnectorLaunchHost["changed"]
  },
) {
  return Effect.gen(function* () {
    const observed = yield* observeConnectorLaunch(input)
    let sequence = 0
    let active = true
    let failed = false
    const secrets = input.secrets.filter(Boolean).sort((a, b) => b.length - a.length)
    const changed = (state: ConnectorLaunchState) => {
      if (!active) return
      input.changed({
        identity: input.identity,
        sidecarGeneration: input.sidecarGeneration,
        sequence: ++sequence,
        state,
      })
    }
    return {
      ...observed,
      identity: input.identity,
      preparing(
        stage: Extract<ConnectorLaunchState, { phase: "preparing" }>["stage"],
        progress: Extract<ConnectorLaunchState, { phase: "preparing" }>["progress"],
      ) {
        if (!active || failed) return
        observed.stage(stage)
        changed({ phase: "preparing", stage, progress })
      },
      connecting: Effect.sync(() => {
        if (!active || failed) return
        observed.stage("handshake")
        changed({ phase: "connecting" })
      }),
      connected: Effect.sync(() => {
        if (!active || failed) return
        observed.stage("running")
        changed({ phase: "connected" })
      }),
      failed: (failure: ConnectorLaunchFailure) =>
        Effect.suspend(() => {
          if (!active || failed) return Effect.void
          failed = true
          const safe = "detail" in failure ? { ...failure, detail: maskDiagnostic(failure.detail, secrets) } : failure
          return observed.diagnostic.pipe(
            Effect.tapError((error) =>
              Effect.logWarning("connector diagnostic could not be written", {
                error: maskDiagnostic(String(error), secrets),
              }),
            ),
            Effect.ignore,
            Effect.andThen(
              Effect.sync(() => changed({ phase: "failed", failure: safe, diagnostic: input.identity.attempt })),
            ),
          )
        }),
      disabled: Effect.sync(() => {
        if (!failed) changed({ phase: "disabled" })
        active = false
      }),
    }
  })
}

/** This attempt's Location spawner observes real handles; stdio receives the same masked stderr. */
export function observeConnectorLaunch(input: {
  identity: LaunchIdentity
  requestedCommand: readonly string[]
  cwd: string
  runtimeRoot: string
  secrets: readonly string[]
}) {
  return Effect.gen(function* () {
    const environment = yield* Environment.Service
    const secrets = [...new Set(input.secrets.filter(Boolean))].sort((a, b) => b.length - a.length)
    const mask = (value: string) => maskDiagnostic(value, secrets)
    const transcriptFile = path.join(
      input.runtimeRoot,
      "diagnostics",
      encodeURIComponent(input.identity.attempt).replaceAll(".", "%2E"),
      "transcript.json",
    )
    const value: ConnectorLaunchDiagnostic = {
      identity: input.identity,
      requestedCommand: input.requestedCommand.map(mask),
      effectiveCommand: [],
      cwd: mask(input.cwd),
      exitCode: null,
      signal: null,
      stderr: "",
      stage: "launcher",
      transcriptFile,
    }
    let processNumber = 0
    let error: string | undefined
    const safeError = (failure: PlatformError.PlatformError) => {
      const reason = failure.reason
      const cause =
        reason.cause instanceof KilledBySignal
          ? reason.cause
          : reason.cause === undefined
            ? undefined
            : new Error(mask(reason.cause instanceof Error ? reason.cause.message : String(reason.cause)))
      return reason._tag === "BadArgument"
        ? PlatformError.badArgument({ ...reason, description: reason.description && mask(reason.description), cause })
        : PlatformError.systemError({
            ...reason,
            pathOrDescriptor:
              typeof reason.pathOrDescriptor === "string" ? mask(reason.pathOrDescriptor) : reason.pathOrDescriptor,
            description: reason.description && mask(reason.description),
            cause,
          })
    }
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        const number = ++processNumber
        value.effectiveCommand = commandArguments(command).map(mask)
        value.cwd = mask(command._tag === "StandardCommand" ? (command.options.cwd ?? input.cwd) : input.cwd)
        value.exitCode = null
        value.signal = null
        error = undefined
        yield* Effect.logInfo("spawning connector process", { command: value.effectiveCommand, cwd: value.cwd })
        // The underlying spawner logs argv. Only this attempt suppresses that raw spawn line;
        // the ordinary structured log above contains its masked counterpart.
        const handle = yield* environment.spawner.spawn(command).pipe(
          Effect.provideService(References.MinimumLogLevel, "None"),
          Effect.tapError((failure) =>
            Effect.sync(() => {
              error = mask(failure.message)
            }),
          ),
          Effect.mapError(safeError),
        )
        const stderr = handle.stderr.pipe(
          Stream.decodeText(),
          Stream.map((text) => ({ text, final: false })),
          Stream.catch((failure) => Stream.succeed({ text: "", final: true, failure })),
          Stream.concat(Stream.succeed({ text: "", final: true })),
          Stream.mapAccum(
            () => "",
            (pending, chunk) => {
              const text = pending + chunk.text
              const boundary = chunk.final ? text.length : diagnosticBoundary(text, secrets)
              return [
                text.slice(boundary),
                [{ text: mask(text.slice(0, boundary)), failure: "failure" in chunk ? chunk.failure : undefined }],
              ] as const
            },
          ),
          Stream.flatMap((output) =>
            Stream.succeed(output.text).pipe(
              Stream.concat(output.failure ? Stream.fail(output.failure) : Stream.empty),
            ),
          ),
          Stream.filter((text) => text !== ""),
          Stream.tap((text) =>
            Effect.sync(() => {
              value.stderr += text
            }),
          ),
          Stream.encodeText,
          Stream.tapError((failure) =>
            Effect.sync(() => {
              error = mask(failure.message)
            }),
          ),
          Stream.mapError(safeError),
        )
        const stdout = handle.stdout.pipe(Stream.mapError(safeError))
        const exitCode = yield* Effect.cached(
          handle.exitCode.pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (number !== processNumber) return
                if (Exit.isSuccess(exit)) {
                  value.exitCode = exit.value
                  return
                }
                const failure = Exit.findErrorOption(exit)
                if (failure._tag === "None") return
                error = mask(failure.value.message)
                if (failure.value.reason.cause instanceof KilledBySignal)
                  value.signal = failure.value.reason.cause.signal
              }),
            ),
            Effect.mapError(safeError),
          ),
        )
        yield* Effect.forkScoped(exitCode.pipe(Effect.ignore))
        return ChildProcessSpawner.makeHandle({
          ...handle,
          stdout,
          stderr,
          all: stdout.pipe(Stream.merge(stderr)),
          exitCode,
          stdin: handle.stdin.pipe(Sink.mapError(safeError)),
          isRunning: handle.isRunning.pipe(Effect.mapError(safeError)),
          kill: (options) => handle.kill(options).pipe(Effect.mapError(safeError)),
          getInputFd: (fd) => handle.getInputFd(fd).pipe(Sink.mapError(safeError)),
          getOutputFd: (fd) => handle.getOutputFd(fd).pipe(Stream.mapError(safeError)),
          unref: handle.unref.pipe(
            Effect.map((reref) => reref.pipe(Effect.mapError(safeError))),
            Effect.mapError(safeError),
          ),
        })
      }),
    )
    return {
      environment: Environment.Service.of({ ...environment, spawner }),
      stage(stage: ConnectorLaunchDiagnostic["stage"]) {
        value.stage = stage
      },
      diagnostic: Effect.suspend(() => {
        const snapshot = structuredClone(value)
        return environment.files
          .write(
            transcriptFile,
            new TextEncoder().encode(
              JSON.stringify({ ...snapshot, ...(error === undefined ? {} : { error }) }, null, 2),
            ),
          )
          .pipe(Effect.as(snapshot))
      }),
    }
  })
}

function commandArguments(command: ChildProcess.Command): string[] {
  if (command._tag === "StandardCommand")
    return [command.command, ...command.args.map((arg) => (typeof arg === "string" ? arg : "[redacted]"))]
  return [...commandArguments(command.left), "|", ...commandArguments(command.right)]
}

const secretQueryParameter =
  "(?:x-amz-(?:credential|security-token|signature)|x-goog-(?:credential|signature)|sig|signature|(?:access_token|token|password|passwd|secret|credentials?|username|api[_-]?key|key|auth|authorization)(?:[_-]?(?:ref|version))?)"
const secretQueryName = new RegExp(`^${secretQueryParameter}$`, "i")

/** Shared credential-query classification for diagnostics and non-secret resolution identities. */
export function isConnectorSecretQueryParameter(name: string) {
  return secretQueryName.test(name)
}

function maskDiagnostic(text: string, secrets: readonly string[]) {
  const transport = text
    .replace(/((?:proxy-)?authorization\s*:\s*)[^\r\n]+/gi, "$1[redacted]")
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, "bearer [redacted]")
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi, (url) =>
      url
        .replace(/^(\w[\w+.-]*:\/\/)[^/?#]*@/, "$1[redacted]@")
        .replace(/([?&])([^=&#]+)=[^&#]*/g, (field: string, separator: string, name: string) =>
          isConnectorSecretQueryParameter(new URLSearchParams(`${name}=`).keys().next().value ?? name)
            ? `${separator}${name}=[redacted]`
            : field,
        ),
    )
  return secrets.reduce((value, secret) => value.split(secret).join("[redacted]"), transport)
}

/** Hold incomplete lines and any known secret crossing a line, without truncating the transcript. */
function diagnosticBoundary(text: string, secrets: readonly string[]) {
  let boundary = text.lastIndexOf("\n") + 1
  let previous = -1
  while (boundary !== previous) {
    previous = boundary
    for (const secret of secrets) {
      for (let start = text.indexOf(secret); start !== -1 && start < boundary; start = text.indexOf(secret, start + 1))
        if (start + secret.length > boundary) boundary = text.lastIndexOf("\n", start - 1) + 1
      for (let length = Math.min(text.length, secret.length - 1); length > 0; length--)
        if (text.endsWith(secret.slice(0, length)) && text.length - length < boundary)
          boundary = text.lastIndexOf("\n", text.length - length - 1) + 1
    }
  }
  return boundary
}
