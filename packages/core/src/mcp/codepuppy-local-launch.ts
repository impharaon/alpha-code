import { Effect } from "effect"
import type { Mcp } from "@opencode/schema/mcp"
import type { CodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { connectorPackageRunner } from "@opencode/util/codepuppy-command-head"
import type { ConnectorLaunchHost, DeclaredFirstParty } from "@opencode/util/codepuppy-connector-launch"
import type { McpConnection } from "./connection.js"

/**
 * The trusted Code Puppy context of one local entry (design §4.4/§4.7, v2.1 V21-R2): present only when this generation's sidecar
 * published its launcher descriptor and host. Package runners prepare through the frozen prepareConnectorLaunch before any start
 * permit; native commands keep their own environment and get only the dependency check and diagnostics.
 */
export function connectorLocalLaunch(input: {
  config: Mcp.ServerConfig
  directory: string
  bootstrap: CodePuppyBootstrap | undefined
  declared: DeclaredFirstParty | undefined
  host: () => ConnectorLaunchHost
}): McpConnection.Input["localLaunch"] {
  const config = input.config
  const launchers = input.bootstrap?.launchers
  const generation = input.bootstrap?.sidecarGeneration
  if (config.type !== "local" || !launchers || generation === undefined) return undefined
  const command = config.command
  const runner = connectorPackageRunner(command, launchers.platform === "win32-x64" ? "win32" : "darwin")
  const environment = config.environment ?? {}
  return {
    sidecarGeneration: String(generation),
    runtimeRoot: launchers.runtimeRoot,
    // Values the user configured for this server; short flags are left readable so masking cannot shred the diagnostic.
    secrets: Object.values(environment).filter((value) => value.length >= 8),
    host: input.host(),
    ...(input.declared ? { firstParty: { launchers, declaration: input.declared } } : {}),
    ...(runner && command[0] !== undefined
      ? {
          packagePreparation: ({ identity, runtimeDep }) =>
            Effect.gen(function* () {
              // Both modules stay out of engine startup; only a package-runner start loads them.
              const { McpStdio } = yield* Effect.promise(() => import("./stdio.js"))
              const { prepareConnectorLaunch } = yield* Effect.promise(() => import("./codepuppy-connector-launch.js"))
              return yield* prepareConnectorLaunch({
                runner,
                identity,
                command: [command[0]!, ...command.slice(1)],
                cwd: McpStdio.resolveCwd(input.directory, config.cwd),
                environment,
                runtimeDep,
              })
            }),
        }
      : {}),
  }
}
