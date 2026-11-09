// Real OpenCode 2 plugin host for the policy tests (not a stand-in): the production plugin service, promise adapter,
// tool registry, permission engine, agents, sessions and session context from packages/core, wired the way core's
// own plugin tests wire them (packages/core/test/plugin/fixture.ts), with the production permission engine kept.
//
// Isolation (dispatch: engine tests never touch owner data): HOME and every XDG root point at a fresh temp directory
// and the database is in memory *before* any core module loads, because core computes its global paths at import
// (packages/util/src/global-roots.ts). Network: core's test runner refuses non-loopback fetches.
//
// `.cases.ts`: a helper, not a test file — no `bun test` entry, no typecheck surface (packages/ext/tsconfig.json).
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-policy-host-"))
const ISOLATED: Record<string, string> = {
  HOME: path.join(ROOT, "home"),
  OPENCODE_TEST_HOME: path.join(ROOT, "home"),
  XDG_DATA_HOME: path.join(ROOT, "data"),
  XDG_CONFIG_HOME: path.join(ROOT, "config"),
  XDG_CACHE_HOME: path.join(ROOT, "cache"),
  XDG_STATE_HOME: path.join(ROOT, "state"),
  OPENCODE_DB: ":memory:",
}
const saved = Object.fromEntries(Object.keys(ISOLATED).map((key) => [key, process.env[key]]))
for (const [key, value] of Object.entries(ISOLATED)) {
  fs.mkdirSync(value === ":memory:" ? ROOT : value, { recursive: true })
  process.env[key] = value
}

/** Restores the caller's environment (call from `afterAll`). */
export function restoreEnvironment() {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

const core = path.resolve(import.meta.dir, "../../../core")
const load = (relative: string) => import(path.join(core, relative))
const resolve = (specifier: string) => import(Bun.resolveSync(specifier, core))

export const E = await resolve("effect")
const { Effect, Layer } = E
const { AppNodeBuilder } = await load("src/effect/app-node-builder.ts")
const { LayerNode } = await resolve("@opencode/util/effect/layer-node")
const { LayerNodePlatform } = await resolve("@opencode/util/effect/app-node-platform")
const { AppProcess } = await resolve("@opencode/util/process")
const { FSUtil } = await resolve("@opencode/util/fs-util")
const { Global } = await resolve("@opencode/util/global")
const { Npm } = await resolve("@opencode/util/npm")

export const { Plugin } = await load("src/plugin.ts")
export const { PluginHooks } = await load("src/plugin/hooks.ts")
export const { Tool } = await load("src/tool.ts")
export const { Permission } = await load("src/permission.ts")
export const { Agent } = await load("src/agent.ts")
export const { Session } = await load("src/session.ts")
export const { SessionContext } = await load("src/session/context.ts")
export const { Location } = await load("src/location.ts")
export const { Rpc } = await load("src/rpc.ts")
export const { Mcp } = await load("src/mcp/index.ts")
export const { fromPromise } = await resolve("@opencode/plugin/promise/adapter")
export const SchemaTool = (await resolve("@opencode/schema/tool")).Tool

const nodes = {
  Artifact: (await load("src/artifact.ts")).Artifact,
  AISDK: (await load("src/aisdk.ts")).AISDK,
  Command: (await load("src/command.ts")).Command,
  Config: (await load("src/config.ts")).Config,
  Credential: (await load("src/credential.ts")).Credential,
  Database: (await load("src/database/database.ts")).Database,
  Environment: (await load("src/environment/index.ts")).Environment,
  FileAccess: (await load("src/file-access.ts")).FileAccess,
  Bus: (await load("src/bus.ts")).Bus,
  FileSystem: (await load("src/filesystem.ts")).FileSystem,
  Form: (await load("src/form.ts")).Form,
  Generate: (await load("src/generate.ts")).Generate,
  InstructionDiscovery: (await load("src/instruction-discovery.ts")).InstructionDiscovery,
  Integration: (await load("src/integration.ts")).Integration,
  Job: (await load("src/job.ts")).Job,
  KV: (await load("src/kv.ts")).KV,
  Model: (await load("src/model.ts")).Model,
  Provider: (await load("src/provider.ts")).Provider,
  SharedCache: (await load("src/shared-cache.ts")).SharedCache,
  InstructionEntry: (await load("src/session/instruction-entry.ts")).InstructionEntry,
  PersistentPty: (await load("src/persistent-pty.ts")).PersistentPty,
  LocationServiceMap: (await load("src/location-service-map.ts")).LocationServiceMap,
  Reference: (await load("src/reference.ts")).Reference,
  Skill: (await load("src/skill.ts")).Skill,
  SkillDiscovery: (await load("src/skill/discovery.ts")).SkillDiscovery,
  Watcher: (await load("src/filesystem/watcher.ts")).Watcher,
  Vcs: (await load("src/vcs.ts")).Vcs,
  WebSearch: (await load("src/websearch.ts")).WebSearch,
  Worktree: (await load("src/worktree.ts")).Worktree,
  WorktreeStrategies: (await load("src/worktree/strategies.ts")).WorktreeStrategies,
}
const { tempLocationLayer } = await load("test/fixture/location.ts")
const { emptyMcp } = await load("test/fixture/mcp.ts")
const { State } = await load("src/state.ts")
const { offlineModels } = await load("test/fixture/models.ts")
const { testEffect } = await load("test/lib/effect.ts")

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: (name: string) => Effect.succeed({ directory: "", name }),
    resolve: (name: string) => Effect.succeed({ directory: "", name }),
    check: () => Effect.succeed(false),
    update: (name: string) => Effect.succeed({ directory: "", name }),
    which: () => Effect.undefined,
  }),
)
const generateLayer = Layer.succeed(
  nodes.Generate.Service,
  nodes.Generate.Service.of({ text: () => Effect.succeed(""), image: () => Effect.die("unused"), decisions: () => Effect.die("unused") }),
)
const configLayer = nodes.Config.testLayer()

/**
 * MCP with a real configuration state (core `State`, the editor semantics of packages/core/src/mcp/index.ts) and no
 * runtime: plugins' `mcp.transform` callbacks run and see each other's servers in order; nothing connects.
 */
const configuredMcpLayer = Layer.sync(Mcp.Service, () => {
  const state = State.create({
    name: "mcp",
    initial: () => ({ servers: new Map<string, unknown>() }),
    editor: (editor: { servers: Map<string, any> }) => ({
      list: () => Array.from(editor.servers),
      get: (name: string) => editor.servers.get(name),
      set: (name: string, config: unknown) => void editor.servers.set(name, structuredClone(config)),
      update: (name: string, update: (config: any) => void) => {
        const current = editor.servers.get(name)
        if (current) update(current)
      },
      remove: (name: string) => void editor.servers.delete(name),
    }),
  })
  return Mcp.Service.of({ ...emptyMcp, transform: state.transform, reload: state.reload })
})

/** Core's plugin test graph with the production permission engine and the session context added. */
export const HostLayer = AppNodeBuilder.build(
  LayerNode.group([
    AppProcess.node,
    nodes.FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    nodes.Credential.node,
    nodes.Config.node,
    nodes.Database.node,
    nodes.Environment.node,
    nodes.FileAccess.node,
    Global.node,
    nodes.Bus.node,
    nodes.Form.node,
    nodes.Generate.node,
    LayerNodePlatform.httpClient,
    Plugin.node,
    Agent.node,
    nodes.Artifact.node,
    nodes.AISDK.node,
    nodes.Provider.node,
    nodes.Model.node,
    nodes.Command.node,
    nodes.InstructionDiscovery.node,
    nodes.Integration.node,
    nodes.Job.node,
    nodes.KV.node,
    Mcp.node,
    Session.node,
    SessionContext.node,
    nodes.SharedCache.node,
    nodes.InstructionEntry.node,
    nodes.PersistentPty.node,
    nodes.LocationServiceMap.node,
    Permission.node,
    PluginHooks.node,
    nodes.Reference.node,
    Rpc.node,
    nodes.Skill.node,
    nodes.SkillDiscovery.node,
    Tool.node,
    nodes.Vcs.node,
    nodes.Watcher.node,
    nodes.WebSearch.node,
    nodes.Worktree.node,
    nodes.WorktreeStrategies.node,
  ]),
  [
    Location.node.replace(tempLocationLayer),
    Npm.node.replace(npmLayer),
    nodes.Config.node.replace(configLayer),
    Mcp.node.replace(configuredMcpLayer),
    nodes.Generate.node.replace(generateLayer),
    offlineModels,
  ],
).pipe(Layer.provideMerge(configLayer))

export const it = testEffect(HostLayer)

let generation = 0

/**
 * A promise-shaped plugin activated through the production adapter (`fromPromise`), as the module loader does.
 * Every call is a new revision, so re-activating restarts it (the supervisor keeps unchanged generations running).
 */
export function promisePlugin(id: string, setup: (context: any) => unknown) {
  generation += 1
  return { ...fromPromise({ id, setup }), revision: String(generation) }
}
