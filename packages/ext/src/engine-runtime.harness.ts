// The engine as the shipped desktop runs it: bundled with an Effect of its own. The sidecar's engine chunk and the ext bundle
// (scripts/build.ts inlines effect, ADR-006) each carry one, so what crosses between ext and engine crosses two Effect
// instances. A test that imports both from source shares one Effect and cannot see that boundary; this bundle restores it.
// It holds the engine's tool runtime and the read tool's output parts, with the Effect they were built by. The bundle is
// built from an in-memory entry and loaded from memory (a Blob URL); nothing is written to disk.
//
// File name `.harness.ts`: a test helper, not a test file and not in the ext typecheck (tsconfig exclude).
import { join } from "node:path"

const RUNTIME = join(import.meta.dir, "../../core/src/tool/runtime.ts")
const READ_FILESYSTEM = join(import.meta.dir, "../../core/src/tool/read-filesystem.ts")
const ENTRY = join(import.meta.dir, "separately-bundled-engine.ts")

type SeparatelyBundledEngine = typeof import("../../core/src/tool/runtime") &
  Pick<typeof import("../../core/src/tool/read-filesystem"), "ReadToolFileSystem"> &
  Pick<typeof import("effect"), "Effect" | "Schema">

let engine: Promise<SeparatelyBundledEngine> | undefined

export function separatelyBundledEngine(): Promise<SeparatelyBundledEngine> {
  return (engine ??= (async () => {
    const source = [
      `export * from ${JSON.stringify(RUNTIME)}`,
      `export { ReadToolFileSystem } from ${JSON.stringify(READ_FILESYSTEM)}`,
      `export { Effect, Schema } from "effect"`,
    ].join("\n")
    const built = await Bun.build({ entrypoints: [ENTRY], files: { [ENTRY]: source }, target: "bun", format: "esm" })
    if (!built.success) throw new AggregateError(built.logs, "the engine did not bundle")
    return import(URL.createObjectURL(new Blob([await built.outputs[0]!.text()], { type: "text/javascript" })))
  })())
}
