import { Effect, ManagedRuntime, Redacted, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { AppProcess } from "../../util/src/process"
import { LayerNode } from "../../util/src/effect/layer-node"
import { bindPackageShellCommand, type RuntimeLocation } from "@opencode/plugin/codepuppy-package-runtime"
import { pluginProcessConfig } from "../../ui-mac/src/shared/plugin-mcp-config"
import type { Text } from "../../ui-mac/src/shared/host-extension-package-contract/plugin-package"

type PackageProcessInput = {
  source: Parameters<typeof pluginProcessConfig>[0]
  command: Text
  args?: Text[]
  environment: Record<string, string | undefined>
  environmentFile?: string
  signal: AbortSignal
}

/** Source/value binding stays in core; AppProcess owns the only spawn, stdin and cancellation path. */
export function createPackageProcesses(location: RuntimeLocation) {
  const runtime = ManagedRuntime.make(LayerNode.compile(AppProcess.node))
  const environment = async (input: Pick<PackageProcessInput, "source" | "environment" | "environmentFile" | "signal">, timeout?: number): Promise<Record<string, string | undefined>> => {
    if (!input.environmentFile || Bun.file(input.environmentFile).size === 0) return {}
    const config = pluginProcessConfig(input.source)
    const result = await runtime.runPromise(Effect.gen(function* () {
      const processes = yield* AppProcess.Service
      return yield* processes.run(ChildProcess.make("bash", ["-c", '"$(command -p -v env)" -0; printf "\\0"; . "$1" >/dev/null; "$(command -p -v env)" -0', "package-session-environment", input.environmentFile!], {
        cwd: input.source.projectDir, extendEnv: true, env: { ...config.environment(), ...input.environment },
      }), { signal: input.signal, timeout })
    }))
    if (result.exitCode !== 0) throw Error("runtime-failed: session environment shell exited " + result.exitCode)
    const split = result.stdout.toString("utf8").split("\0\0")
    if (split.length !== 2) throw Error("runtime-failed: session environment export failed")
    const variables = (text: string) => new Map(text.split("\0").filter(Boolean).map(entry => {
      const separator = entry.indexOf("=")
      return [entry.slice(0, separator), entry.slice(separator + 1)] as const
    }))
    const before = variables(split[0]!)
    const after = variables(split[1]!)
    return Object.fromEntries([...new Set([...before.keys(), ...after.keys()])]
      .filter(key => key !== "CLAUDE_ENV_FILE" && before.get(key) !== after.get(key))
      .map(key => [key, after.get(key)]))
  }
  const prepare = async (input: PackageProcessInput, timeout?: number) => {
    const inherited = await environment(input, timeout)
    const owned = pluginProcessConfig(input.source).environment()
    const config = pluginProcessConfig({ ...input.source, resolveEnvironment: name => Object.hasOwn(owned, name) ? owned[name] : Object.hasOwn(inherited, name) ? inherited[name] : input.environment[name] ?? input.source.resolveEnvironment(name) })
    const bound =
      input.args === undefined
        ? await bindPackageShellCommand(location, {
            parts: input.command.map((part) =>
              typeof part === "string" ? part : { boundValue: config.render([part]) },
            ),
          })
        : { executable: config.render(input.command), argv: input.args.map(config.render), env: {} }
    const command = ChildProcess.make(
      bound.executable,
      bound.argv.map((value) =>
        [...config.secretValues].some((secret) => value.includes(secret)) ? Redacted.make(value) : value,
      ),
      { cwd: input.source.projectDir, extendEnv: true, env: { ...input.environment, ...inherited, ...config.environment(), ...bound.env } },
    )
    const redact = (text: string) =>
      [...config.secretValues]
        .toSorted((left, right) => right.length - left.length)
        .reduce((text, secret) => text.replaceAll(secret, "[redacted]"), text)
    return { command, redact }
  }
  return {
    command: async (input: PackageProcessInput & { stdin: Record<string, unknown>; timeoutSeconds: number }) => {
      const deadline = performance.now() + input.timeoutSeconds * 1000
      const prepared = await prepare(input, input.timeoutSeconds * 1000)
      const result = await runtime
        .runPromise(
          Effect.gen(function* () {
            const processes = yield* AppProcess.Service
            return yield* processes.run(prepared.command, {
              stdin: JSON.stringify(input.stdin),
              signal: input.signal,
              timeout: Math.max(0, deadline - performance.now()),
            })
          }),
        )
        .catch((error) => {
          throw new Error(prepared.redact(error instanceof Error ? error.message : String(error)))
        })
      return {
        exitCode: result.exitCode,
        stdout: result.stdout.toString("utf8"),
        redact: prepared.redact,
        stderr: prepared.redact(result.stderr.toString("utf8")),
      }
    },
    monitor: async (input: PackageProcessInput, onLine: (line: string) => void | Promise<void>) => {
      const prepared = await prepare(input)
      try {
        await runtime.runPromise(
          Effect.gen(function* () {
            const processes = yield* AppProcess.Service
            yield* processes
              .runStream(prepared.command, { signal: input.signal, okExitCodes: [0] })
              .pipe(
                Stream.runForEach((line) =>
                  input.signal.aborted
                    ? Effect.void
                    : Effect.promise(() => Promise.resolve(onLine(prepared.redact(line)))),
                ),
              )
          }),
        )
      } catch (error) {
        if (!input.signal.aborted)
          throw new Error(prepared.redact(error instanceof Error ? error.message : String(error)))
      }
    },
    dispose: () => runtime.dispose(),
  }
}
