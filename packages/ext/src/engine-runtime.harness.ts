// The engine's tool runtime as the shipped desktop runs it: bundled with an Effect of its own. The sidecar's engine chunk and
// the ext bundle (scripts/build.ts inlines effect, ADR-006) each carry one, so what the ext hands the engine crosses two Effect
// instances. A test that imports both from source shares one Effect and cannot see that boundary; this bundle restores it.
// The bundle is loaded from memory (a Blob URL); nothing is written to disk.
//
// File name `.harness.ts`: a test helper, not a test file and not in the ext typecheck (tsconfig exclude).
import { join } from "node:path"

const RUNTIME = join(import.meta.dir, "../../core/src/tool/runtime.ts")

let runtime: Promise<typeof import("../../core/src/tool/runtime")> | undefined

export function separatelyBundledEngineRuntime(): Promise<typeof import("../../core/src/tool/runtime")> {
  return (runtime ??= (async () => {
    const built = await Bun.build({ entrypoints: [RUNTIME], target: "bun", format: "esm" })
    if (!built.success) throw new AggregateError(built.logs, "the engine tool runtime did not bundle")
    return import(URL.createObjectURL(new Blob([await built.outputs[0]!.text()], { type: "text/javascript" })))
  })())
}
