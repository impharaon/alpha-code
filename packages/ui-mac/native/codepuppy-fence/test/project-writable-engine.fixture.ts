// Real embedded engine peer for V3/V4/V5. The parent exercises the production main listener;
// this adapter uses its canonical grant/probe protocol. Signed utilityProcess transport is G0/V7.
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { engineSandbox, assertEngineSandboxed } from "../../../test-component/engine-sandbox"
import { codepuppyEngine, type Running } from "../../../test-component/codepuppy-engine"
import { applyProcessFence, loadFenceAddon } from "../../../src/main/process-fence-apply"
import { buildWriteGrantReply, buildWriteProbeReply, parseWriteGrantCommand, parseWriteProbeCommand, runWorkspaceWriteProbe } from "../../../src/main/workspace-write-probe"

const root = process.env.CODEPUPPY_WRITABLE_ENGINE_ROOT!
const A = process.env.CODEPUPPY_WRITABLE_A!
// Never registered in any generation: the start-time self-check's known-outside directory. (B is the test's
// project, and a project granted in an earlier generation is carried into later W1s, INT-safety R3.)
const OUTSIDE = process.env.CODEPUPPY_WRITABLE_OUTSIDE!
const sandbox = engineSandbox()
// The ext reaches the production main of the parent test through this IPC channel when asked (directory-write-approval
// engine cases: R6 queries); otherwise codepuppyEngine() gives it the shared fake main, as before.
if (process.env.CODEPUPPY_WRITABLE_PARENT_PORT === "1") await import("../../../test-fixtures/process-fence/engine-parent-port-preload")
// The production engine build rewrites FileAccess and its callers so external-directory requests carry the actual targets
// (R5, scripts/build-engine.ts); an engine loaded from source gets the same rewrite when asked (directory-write-approval
// engine cases: the write tool's card for a new path in HOME). Unset: unchanged, as for every other user of this fixture.
if (process.env.CODEPUPPY_WRITABLE_DIRECTORY_ACCESS === "1") {
  const { projectDirectoryAccessSource } = await import("../../../engine/file-access-transform")
  const { packageManagerShellSource } = await import("../../../engine/package-manager-shell-transform")
  Bun.plugin({
    name: "directory-access-seam",
    setup(build) {
      build.onLoad({ filter: /\/packages\/core\/src\/(?:file-access|file-write|tool\/plugin\/(?:patch|shell|grep|glob|opencode|image-generate))\.ts$/ }, async (args) => {
        const code = await Bun.file(args.path).text()
        const delegated = packageManagerShellSource(code, args.path)
        return { contents: projectDirectoryAccessSource(delegated ?? code, args.path) ?? delegated ?? code, loader: "ts" }
      })
    },
  })
}
let engine: Running | undefined
let delayConsume = 0
let starting: Promise<void> | undefined
const host = codepuppyEngine({ sandbox, name: "workspace-write", modelBaseURL: process.env.CODEPUPPY_WRITABLE_MODEL_URL!, databasePath: join(root, "engine.db") })
mkdirSync(A, { recursive: true })
const send = (value: unknown) => process.send?.(value)
process.on("message", async (value: unknown) => {
  const command = value as { type?: string; fence?: { profile: string; addonPath: string }; ms?: number; directory?: string }
  const grant = parseWriteGrantCommand(value)
  if (grant) {
    if (delayConsume) await new Promise((resolve) => setTimeout(resolve, delayConsume))
    const consumed = loadFenceAddon(commandFence!.addonPath).consumeExtension(grant.token)
    send({ type: "fixture.consumed", id: grant.id, pid: process.pid, handle: consumed.handle, errno: consumed.errno })
    send(buildWriteGrantReply(grant.id, consumed.handle >= 0 ? { outcome: "granted" } : { outcome: "failed", detail: `consume errno=${consumed.errno}` }))
    return
  }
  const probe = parseWriteProbeCommand(value)
  if (probe) { send(buildWriteProbeReply(probe.id, runWorkspaceWriteProbe(probe.directory))); return }
  if (command.type === "fixture.delay") { delayConsume = command.ms ?? 0; return }
  if (command.type === "fixture.reverse") {
    for (const type of ["workspace-open-record", "grant-write", "issue-write", "open-directory-picker"]) send({ type, server: "sidecar", directory: command.directory })
    send({ type: "fixture.reverse-sent" })
    return
  }
  if (command.type === "stop") {
    await engine?.close()
    process.exit(0)
  }
  if (command.type !== "start" || starting) return
  commandFence = command.fence
  starting = (async () => {
    await assertEngineSandboxed(sandbox)
    if (!commandFence) throw new Error("fixture refuses an unfenced start")
    const applied = applyProcessFence(commandFence, { insideDir: A, outsideDir: OUTSIDE })
    engine = await host.start()
    send({ type: "fixture.ready", pid: process.pid, url: engine.url, authorization: engine.authorization, database: join(root, "engine.db"), buildId: applied.buildId })
    send({ type: "ready" })
  })().catch((error) => {
    send({ type: "error", error: { message: String(error) } })
    process.exit(1)
  })
})
let commandFence: { addonPath: string; profile: string } | undefined
