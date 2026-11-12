// REQ-159 (`#1321`) / REQ-234 (`#1531`) on OpenCode 2 (`#1662`) —— the engine process that process-fence-engine.test.ts drives.
// Run as `bun --preload engine-fence-preload.ts [--preload engine-parent-port-preload.ts] run engine-embed-driver.ts` (flags after
// `run`, see the test). Same order as the shipped sidecar (sidecar.ts `start`): the fence is already installed by the preload before
// this file imports anything; then production `injectCodePuppyConfig`, the ext entry is preloaded (sidecar `extPreload`), and the
// embedded engine (`engine/engine-embed.ts`, the entry packaged into dist-engine) is started with `buildEngineServerOptions`.
//
// `CP1321_FETCH` decides what the extension gets as its engine handle (the slot `in-process-engine.ts` publishes):
//   · `in-process` — the shipped wiring: the listening app's dispatch, wrapped with the password, published inside `Transform`;
//   · `tcp`        — known-bad: a fetch that goes over loopback TCP to this engine's own listening port;
//   · `none`       — nothing published.
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { injectCodePuppyConfig } from "../../src/main/codepuppy-config-injection"
import { buildEngineServerOptions } from "../../src/main/engine-server-options"
import { engineAuthorization, withEngineAuthorization } from "../../src/main/engine-authorization"
import { publishInProcessEngine } from "../../src/main/in-process-engine"

const env = process.env
const userData = env.CP1321_USER_DATA!
const extDir = env.CP1321_EXT_DIR || undefined
const password = env.CP1321_PASSWORD!
const mode = env.CP1321_FETCH ?? "in-process"

const injection = injectCodePuppyConfig(userData, extDir, "stable")
if (!injection.ok) console.error(`engine-embed-driver: injection failed: ${injection.error.message}`)
if (extDir) await import(pathToFileURL(join(extDir, "server.js")).href)
const { startEngine } = await import("../../engine/engine-embed")
const engine = await startEngine(
  buildEngineServerOptions({
    hostname: "127.0.0.1",
    port: 0,
    password,
    engineVersion: "test",
    databasePath: join(userData, "engine.db"),
    configDirectory: join(userData, "codepuppy-engine-config"),
    config: injection.config,
    models: { ...(injection.models.file ? { file: injection.models.file } : {}), fetch: false },
    filewatcher: false,
    platform: process.platform,
  }),
  { onDispatch: (dispatch) => void (mode === "in-process" && publishInProcessEngine(withEngineAuthorization(dispatch, password))) },
)
if (mode === "tcp")
  publishInProcessEngine(async (request) => {
    const url = new URL(request.url)
    const headers = new Headers(request.headers)
    headers.set("authorization", engineAuthorization(password))
    return fetch(new URL(url.pathname + url.search, engine.url), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
    })
  })
process.on("SIGTERM", () => {
  void engine.close().finally(() => process.exit(0))
})
console.log(`engine-embed-driver: listening ${engine.url} (fetch=${mode})`)
