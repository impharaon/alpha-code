// alpha-code#1662 L1a — the H1 embedding shape, nothing more: import `@opencode/server/process` and call
// `start()` the way upstream's own CLI does (packages/cli/src/server-process.ts `run`: same layer stack),
// with a `Transform` that captures the listener's app so the embedder gets an in-process fetch (E2).
// Built by build-embed.ts into ${OC2}/packages/cli/dist-node/embed.mjs and imported by the utilityProcess.
import { NodeServices } from "@effect/platform-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { start } from "@opencode/server/process"
import { ServerFetch } from "@opencode/server/fetch"
import { Effect, Exit, Scope } from "effect"
import { HttpEffect } from "effect/http"

type Options = {
  readonly port: number
  readonly password: string
  readonly databasePath: string
  readonly configContent: string
}

const layers = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(LayerNode.compile(LayerNode.group([Global.node, AppProcess.node]))),
    Effect.provide(NodeServices.layer),
  ) as Effect.Effect<A, E, Scope.Scope>

function serverOptions(options: Options) {
  return {
    app: { name: "ac1662-l1-probe", version: "2.2.6-embed", channel: "local" },
    hostname: "127.0.0.1",
    port: options.port,
    password: options.password,
    database: { path: options.databasePath },
    models: { fetch: false },
    config: { project: false, claude: false, content: options.configContent },
    fs: { filewatcher: false, fff: process.platform !== "win32" },
  }
}

export async function startEngine(options: Options) {
  const scope = Scope.makeUnsafe()
  let captured: Parameters<NonNullable<Parameters<typeof start>[2]>>[0] | undefined
  const server = await Effect.runPromise(
    layers(
      start(serverOptions(options) as Parameters<typeof start>[0], undefined, (app) => {
        captured = app
        return app
      }),
    ).pipe(Scope.provide(scope)),
  )
  if (!captured) throw new Error("Transform was never called — no in-process app")
  return {
    address: server.address,
    /** In-process fetch over the SAME app the listener serves (captured by the Transform hook). */
    inProcessFetch: HttpEffect.toWebHandler(captured),
    /** Negative control for E2: a SECOND application graph (ServerFetch.make) over the same database. */
    separateGraphFetch: async () =>
      Effect.runPromise(layers(ServerFetch.make(serverOptions(options) as Parameters<typeof ServerFetch.make>[0])).pipe(Scope.provide(scope))),
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}

/**
 * Route 2 (orchestrator, design review round 1): ONE graph from `ServerFetch.make`, no upstream listener.
 * The embedder serves `handler` on its own Node listener and calls the same `handler` in process.
 */
export async function startFetchOnly(options: Options) {
  const scope = Scope.makeUnsafe()
  const make = () =>
    Effect.runPromise(layers(ServerFetch.make(serverOptions(options) as Parameters<typeof ServerFetch.make>[0])).pipe(Scope.provide(scope)))
  return {
    handler: await make(),
    /** Negative control for E2: a second, independent ServerFetch.make graph over the same database. */
    separateGraphFetch: make,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}
