export * as CrossSpawnSpawner from "./package-manager-spawner"
export { KilledBySignal, RELEASE_FORCE_KILL_AFTER } from "../../util/src/cross-spawn-spawner"

import { Context, Layer } from "effect"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner, make } from "effect/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "../../util/src/cross-spawn-spawner"
import { projectPackageManagerEnvironment } from "../src/shared/package-manager-environment"

export function projectPackageManagerCommand(command: ChildProcess.Command): ChildProcess.Command {
  if (command._tag === "PipedCommand") return ChildProcess.pipeTo(projectPackageManagerCommand(command.left), projectPackageManagerCommand(command.right), command.options)
  return ChildProcess.make(command.command, command.args, {
    ...command.options,
    env: projectPackageManagerEnvironment(command.options.env),
    // An omitted env inherits Node's environment even when extendEnv was omitted.
    extendEnv: command.options.env === undefined ? true : command.options.extendEnv,
  })
}

export const node = CrossSpawnSpawner.node.mapLayer((layer) => Layer.flatMap(layer, (context) => {
  const original = Context.get(context, ChildProcessSpawner)
  return Layer.succeed(ChildProcessSpawner, make((command) => original.spawn(projectPackageManagerCommand(command))))
}))
