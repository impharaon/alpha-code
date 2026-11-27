// Headless process peer: real embedded engine/ext, production fence, Bun IPC instead of Electron's parent port.
import { engineSandbox, assertEngineSandboxed } from "./engine-sandbox"
import { codepuppyEngine, type Running } from "./codepuppy-engine"
import { serveCredentialsFromOutside } from "./credential-table"
import { codepuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { applyProcessFence } from "../src/main/process-fence-apply"

const sandbox = engineSandbox()
const listeners: Array<(event: { data: unknown }) => void> = []
const post = (message: unknown) => process.send?.(message)
;(process as unknown as { parentPort: unknown }).parentPort = {
  postMessage: post,
  on: (_event: string, listener: (event: { data: unknown }) => void) => listeners.push(listener),
}
const host = codepuppyEngine({ sandbox, name: "network-egress", modelBaseURL: "https://model.egress.test/v1", egressProxy: process.env.HTTPS_PROXY })
await assertEngineSandboxed(sandbox)
const credentials = await serveCredentialsFromOutside()
let engine: Running | undefined
process.on("message", async (value: unknown) => {
  const command = value as { type: string; id: number; method: string; route: string; body?: unknown; fence: { profile: string; addonPath: string } }
  if (command.type.startsWith("codepuppy.network.")) { listeners.forEach((listener) => listener({ data: value })); return }
  try {
    if (command.type === "fixture.start") {
      const applied = applyProcessFence(command.fence, { insideDir: host.projectDirectory, outsideDir: process.env.EGRESS_OUTSIDE! })
      engine = await host.start()
      post({ type: "fixture.ready", pid: process.pid, url: engine.url, authorization: engine.authorization, applied })
      return
    }
    if (command.type === "fixture.restart") { await engine!.close(); engine = await host.start(); post({ type: "fixture.reply", id: command.id, value: { url: engine.url, authorization: engine.authorization } }); return }
    if (command.type === "fixture.call") { post({ type: "fixture.reply", id: command.id, value: await engine!.send(command.method, command.route, command.body) }); return }
    if (command.type === "fixture.stop") { await engine?.close(); credentials.stop(); process.exit(0) }
  } catch (error) {
    post({ type: "fixture.error", id: command.id, error: String(error) })
    if (command.type === "fixture.start") { credentials.stop(); process.exit(1) }
  }
})
const bootstrap = codepuppyBootstrap()
post({ type: "fixture.prepared", sandbox, userData: host.userData, globalRoot: bootstrap.paths.globalRoot, project: host.projectDirectory, config: host.slot.configDirectory, env: Object.fromEntries(["HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "TMPDIR"].map((key) => [key, process.env[key]])) })
