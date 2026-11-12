// #1662 L4, ruling item 3 (ADR-041 decision 2, "collisions are rejected, never last-wins"), the Browser-plugin part:
// OpenCode 2's tool registry stores a tool under its effective name and the last registration wins
// (packages/core/src/tool.ts `commit` → Map.set). The upstream Browser plugin registers after every built-in tool
// (packages/core/src/plugin/internal.ts `post`), so a Browser tool whose effective name equalled a built-in's would
// silently replace it. This pins that it does not: a Location booted with the Browser plugin removed (a config
// `remove` operation, as a user's config would write it) and one booted with it must agree on every built-in tool, and
// everything the Browser plugin adds lives under its own `browser` namespace.
//
// HOME, XDG_*, TMPDIR and the database are isolated by the shared test preload (bunfig.toml, I-08) before any module loads.
import { describe, expect } from "bun:test"

const { Duration, Effect, Layer, LayerMap, Stream } = await import("effect")
const { App } = await import("@opencode/core/app")
const { ConfigPluginSource } = await import("@opencode/core/config/plugin/source")
const { AppNodeBuilder } = await import("@opencode/core/effect/app-node-builder")
const { Instance } = await import("@opencode/core/instance")
const { Location } = await import("@opencode/core/location")
const { LocationServiceMap } = await import("@opencode/core/location-services")
const { Plugin } = await import("@opencode/core/plugin")
const { SdkPlugins } = await import("@opencode/core/plugin/sdk")
const { AbsolutePath } = await import("@opencode/core/schema")
const { Tool } = await import("@opencode/core/tool")
const { LayerNode } = await import("@opencode/util/effect/layer-node")
const { Global } = await import("@opencode/util/global")
const { Npm } = await import("@opencode/util/npm")
const { Bus } = await import("../src/bus")
const { Database } = await import("../src/database/database")
const { tempGlobalLayer } = await import("./fixture/global")
const { offlineModels } = await import("./fixture/models")
const { tmpdirScoped } = await import("./fixture/tmpdir")
const { testEffect } = await import("./lib/effect")

const BROWSER_PLUGIN = "opencode.browser"
// What the next Location boot's configuration says about plugins; read once per boot.
let operations: { readonly type: "remove"; readonly target: string }[] = []

const unexpected = (pkg: string) =>
  Effect.fail(new Npm.InstallFailedError({ add: [pkg], dir: "", cause: new Error(`Unexpected Npm call: ${pkg}`) }))

const instances = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const map = yield* LayerMap.make(
      (ref: ReturnType<typeof Location.Ref.make>) => Instance.layer(ref, { discovery: false, replacements: bindings }),
      { idleTimeToLive: Duration.infinity },
    )
    const bindings: any = [
      App.node.replace(App.configured({ channel: "dev" })),
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      ConfigPluginSource.node.replace(
        Layer.succeed(
          ConfigPluginSource.Service,
          ConfigPluginSource.Service.of({ operations: () => Effect.succeed([...operations]), changes: () => Stream.never }),
        ),
      ),
      Npm.node.replace(
        Layer.succeed(
          Npm.Service,
          Npm.Service.of({
            add: unexpected,
            resolve: (name: string) => Effect.succeed({ directory: "", name }),
            check: () => Effect.succeed(false),
            update: unexpected,
            which: () => Effect.undefined,
          }),
        ),
      ),
      LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, map)),
      Instance.node.replace(
        Layer.succeed(Instance.Service, { provide: (session: any) => Effect.provide(map.get(session.location)) }),
      ),
    ]
    return map
  }),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    LocationServiceMap.node.replace(instances),
  ]),
)

type Registered = { readonly name: string; readonly namespace: string | undefined }

/** Every registered tool of a freshly booted Location, by effective name. */
const registry = (remove: boolean) =>
  Effect.gen(function* () {
    operations = remove ? [{ type: "remove", target: BROWSER_PLUGIN }] : []
    const directory = yield* tmpdirScoped()
    const locations = yield* LocationServiceMap.Service
    return yield* Effect.gen(function* () {
      yield* (yield* Plugin.Service).awaitActivation
      const tools = yield* (yield* Tool.Service).list()
      return new Map<string, Registered>(
        tools.map((tool: any) => [tool.id as string, { name: tool.name, namespace: tool.options?.namespace }]),
      )
    }).pipe(Effect.scoped, Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))))
  })

const isBrowser = (tool: Registered) => tool.namespace === "browser" || tool.namespace?.startsWith("browser.") === true

/** Built-in tools the second registry lost or replaced (the last-wins collision this file exists to catch). */
const collisions = (builtins: Map<string, Registered>, all: Map<string, Registered>) =>
  [...builtins].filter(([id, tool]) => {
    const after = all.get(id)
    return after === undefined || after.name !== tool.name || after.namespace !== tool.namespace
  }).map(([id]) => id)

describe("ADR-041 on OpenCode 2: the Browser plugin's tool names never collide with built-in tools", () => {
  it.live("booting with the Browser plugin changes no built-in tool and adds only browser-namespaced ones", () =>
    Effect.gen(function* () {
      const builtins = yield* registry(true)
      const all = yield* registry(false)
      expect(builtins.size).toBeGreaterThan(10)
      expect([...builtins.values()].some(isBrowser)).toBe(false)
      expect(collisions(builtins, all)).toEqual([])
      const added = [...all].filter(([id]) => !builtins.has(id)).map(([, tool]) => tool)
      expect(added.length).toBeGreaterThan(0)
      expect(added.filter((tool) => !isBrowser(tool))).toEqual([])
    }),
  )

  it.live("known-bad arm: a browser tool registered under a built-in's effective name is reported", () =>
    Effect.gen(function* () {
      const builtins = yield* registry(true)
      const [id] = [...builtins.keys()]
      const replaced = new Map(builtins)
      replaced.set(id!, { name: id!, namespace: "browser" })
      expect(collisions(builtins, replaced)).toEqual([id])
    }),
  )
})
