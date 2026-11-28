// The shipped desktop's two bundles: the sidecar's engine chunk and the ext bundle (scripts/build.ts inlines everything,
// ADR-006) each carry their own Effect and their own copy of the schema modules, so what crosses between ext and engine
// crosses two instances. A test that imports both from source shares one copy and cannot see that boundary; these bundles
// restore it. Each is built from an in-memory entry and loaded from memory (a Blob URL); nothing is written to disk.
//   · separatelyBundledEngine: the engine's tool runtime and the read tool's output parts, with the Effect they were built by.
//   · separatelyBundledExtPolicy: the ext's policy gate and policy store, with the Tool.Error class and Effect they carry.
//   · separatelyBundledNetworkEgress: the ext's network-egress tracker, with the Tool.Error class it carries.
//
// File name `.harness.ts`: a test helper, not a test file and not in the ext typecheck (tsconfig exclude).
import { join } from "node:path"

const RUNTIME = join(import.meta.dir, "../../core/src/tool/runtime.ts")
const READ_FILESYSTEM = join(import.meta.dir, "../../core/src/tool/read-filesystem.ts")
const POLICY_GATE = join(import.meta.dir, "policy/gate.ts")
const POLICY_RESOLVER = join(import.meta.dir, "policy/resolver.ts")
const NETWORK_EGRESS = join(import.meta.dir, "network-egress.ts")

async function bundle(name: string, exports: string[]) {
  const entry = join(import.meta.dir, `${name}.ts`)
  const built = await Bun.build({ entrypoints: [entry], files: { [entry]: exports.join("\n") }, target: "bun", format: "esm" })
  if (!built.success) throw new AggregateError(built.logs, `${name} did not bundle`)
  return import(URL.createObjectURL(new Blob([await built.outputs[0]!.text()], { type: "text/javascript" })))
}

type SeparatelyBundledEngine = typeof import("../../core/src/tool/runtime") &
  Pick<typeof import("../../core/src/tool/read-filesystem"), "ReadToolFileSystem"> &
  Pick<typeof import("effect"), "Effect" | "Schema">

let engine: Promise<SeparatelyBundledEngine> | undefined

export function separatelyBundledEngine(): Promise<SeparatelyBundledEngine> {
  return (engine ??= bundle("separately-bundled-engine", [
    `export * from ${JSON.stringify(RUNTIME)}`,
    `export { ReadToolFileSystem } from ${JSON.stringify(READ_FILESYSTEM)}`,
    `export { Effect, Schema } from "effect"`,
  ]))
}

type SeparatelyBundledExtPolicy = typeof import("./policy/gate") & Pick<typeof import("./policy/resolver"), "createToolPolicyStore">

let policy: Promise<SeparatelyBundledExtPolicy> | undefined

export function separatelyBundledExtPolicy(): Promise<SeparatelyBundledExtPolicy> {
  return (policy ??= bundle("separately-bundled-ext-policy", [
    `export * from ${JSON.stringify(POLICY_GATE)}`,
    `export { createToolPolicyStore } from ${JSON.stringify(POLICY_RESOLVER)}`,
  ]))
}

let egress: Promise<typeof import("./network-egress")> | undefined

export function separatelyBundledNetworkEgress(): Promise<typeof import("./network-egress")> {
  return (egress ??= bundle("separately-bundled-network-egress", [`export * from ${JSON.stringify(NETWORK_EGRESS)}`]))
}
