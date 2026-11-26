import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "../../util/src/cross-spawn-spawner"
import { LayerNode } from "../../util/src/effect/layer-node"

/** Fixed app Python jobs in the fenced owning Location; no command string or model executable. */
export async function runDocumentPython(
  input: { python: string; script: string; directory: string; jobRoot: string } & (
    | { operation: "render" }
    | { operation: "verify"; runtimeRoot: string }
  ),
  signal: AbortSignal,
) {
  let stderr = ""
  const process = Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      const args = input.operation === "verify" ? [input.runtimeRoot, input.jobRoot] : [input.jobRoot]
      const handle = yield* spawner.spawn(
        ChildProcess.make(input.python, ["-I", "-B", input.script, ...args], {
          cwd: input.directory,
          forceKillAfter: "2 seconds",
        }),
      )
      const output = yield* Effect.all(
        [
          Stream.runFold(
            Stream.decodeText(handle.stdout),
            () => "",
            (a, b) => a + b,
          ),
          Stream.runDrain(
            Stream.decodeText(handle.stderr).pipe(
              Stream.tap((chunk) =>
                Effect.sync(() => {
                  stderr += chunk
                }),
              ),
            ),
          ),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      )
      return { stdout: output[0], stderr, exitCode: Number(output[2]) }
    }),
  ).pipe(Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)))
  return Effect.runPromise(process, { signal })
}
