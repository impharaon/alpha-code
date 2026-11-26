import path from "node:path"
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/process"
import type { Scope } from "effect"
import type { LauncherEnvironment, ConnectorLaunchFailure } from "@opencode/util/codepuppy-connector-launch"
import { Environment } from "../environment/index.js"

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
  }).pipe(
    Effect.mapError(
      (error): ConnectorLaunchFailure => ({
        kind: "unknown",
        detail: error instanceof Error ? error.message : String(error),
      }),
    ),
  )
}
