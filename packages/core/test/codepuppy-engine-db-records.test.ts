// INT-safety I-13 / SPEC-engine-config-fence BR-02 (DESIGN-engine-config-fence §4.6, D8, D9): a fenced process can write
// the engine's own database, so the engine no longer acts on three kinds of records a conversation could plant there.
//   L1 (permission.ts `codepuppy(I-13 L1)`): the project's saved approvals take no part in a permission decision.
//   L2 (permission.ts `codepuppy(I-13 L2)`): of the session row's rules only `deny` entries take part.
//   L3 (config.ts `codepuppy(I-13 L3)`): wellknown sources, cached manifests and cached documents load no configuration.
// Each case plants the record the way a direct database write would and keeps a control showing the record is one that
// would widen the decision, or load, if the engine honoured it. Real-engine evidence under the production fence:
// packages/ui-mac/src/main/engine-db-records.engine.test.ts.
import path from "path"
import fs from "fs/promises"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Credential } from "@opencode/core/credential"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { PermissionTable } from "@opencode/core/permission/sql"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { WellKnown } from "@opencode/core/wellknown"
import type { Entry } from "@opencode/schema/config"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { emptyCredentialNode } from "./fixture/config-nodes"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const permissionIt = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionStore.node, PermissionSaved.node, Agent.node, Permission.node]),
    [Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/project") }))))],
  ),
)
const configIt = testEffect(Layer.empty)

const SESSION = Session.ID.make("ses_planted")
const AGENT = Agent.ID.make("test")

/** The project and session rows the permission service reads, and the agent's own rules. */
const setup = Effect.fnUntraced(function* (rules: Permission.Ruleset) {
  const { db } = yield* Database.Service
  yield* db.insert(ProjectTable).values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] }).run().pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({ id: SESSION, project_id: Project.ID.global, slug: "planted", directory: "/project", title: "planted", version: "test", agent: AGENT })
    .run()
    .pipe(Effect.orDie)
  yield* setRules(rules)
})

const setRules = Effect.fnUntraced(function* (rules: Permission.Ruleset) {
  const agents = yield* Agent.Service
  yield* agents.transform((editor) => editor.update(AGENT, (agent) => void (agent.permissions = [...rules])))
})

/** A direct write to the session row, as `sqlite3` from a fenced shell would make it. */
const plantSessionRule = Effect.fnUntraced(function* (permission: Permission.Ruleset) {
  const { db } = yield* Database.Service
  yield* db.update(SessionTable).set({ permission }).where(eq(SessionTable.id, SESSION)).run().pipe(Effect.orDie)
})

/** What the engine decides for this request now (a fresh id each time, so an ask never collides with an earlier one). */
const decide = Effect.fnUntraced(function* (action: string, resource: string) {
  const service = yield* Permission.Service
  return (yield* service.ask({ id: Permission.ID.create(), sessionID: SESSION, agent: AGENT, action, resources: [resource] })).effect
})

const hasPlanted = (entries: readonly Entry[]) =>
  entries.some((entry) => entry.type === "document" && entry.info.mcp?.servers?.planted !== undefined)

describe("[packages/core/src/permission.ts, config.ts codepuppy(I-13 L1–L3)] planted engine-database records are not honoured", () => {
  permissionIt.effect("L1: a saved approval planted in the engine database allows nothing; the request still asks", () =>
    Effect.gen(function* () {
      yield* setup([])
      const { db } = yield* Database.Service
      yield* db.insert(PermissionTable).values({ id: PermissionSaved.ID.create(), project_id: Project.ID.global, action: "shell", resource: "*" }).run().pipe(Effect.orDie)
      // The record is there and the saved-approval service still lists it (its routes are unchanged).
      const saved = yield* PermissionSaved.Service
      const rows = yield* saved.list({ projectID: Project.ID.global })
      expect(rows.map((row) => [row.action, row.resource])).toEqual([["shell", "*"]])
      // Control: merged the way upstream merged it (after the configured rules, as allow), the engine's own evaluate allows.
      const merged = rows.map((row): Permission.Rule => ({ action: row.action, resource: row.resource, effect: "allow" }))
      expect(Permission.evaluate("shell", "echo planted", [], merged).effect).toBe("allow")
      expect(yield* decide("shell", "echo planted")).toBe("ask")
    }),
  )

  permissionIt.effect("L2: a session-row allow or ask takes no part in the decision; a session-row deny still denies", () =>
    Effect.gen(function* () {
      yield* setup([])
      // allow does not widen an ask. Control: merged after the agent's rules (upstream), it would allow.
      const allowShell: Permission.Rule = { action: "shell", resource: "*", effect: "allow" }
      yield* plantSessionRule([allowShell])
      expect(Permission.evaluate("shell", "echo planted", [], [allowShell]).effect).toBe("allow")
      expect(yield* decide("shell", "echo planted")).toBe("ask")

      // The read-only tier's static deny: neither an ask nor an allow on the row softens it (D9).
      const denyEdit: Permission.Rule = { action: "edit", resource: "*", effect: "deny" }
      yield* setRules([denyEdit])
      for (const effect of ["ask", "allow"] as const) {
        const row: Permission.Rule = { action: "edit", resource: "*", effect }
        yield* plantSessionRule([row])
        expect(Permission.evaluate("edit", "src/a.ts", [denyEdit], [row]).effect).toBe(effect)
        expect(yield* decide("edit", "src/a.ts")).toBe("deny")
      }

      // Code Puppy's own row write — the automation parser session's subagent deny — still denies.
      yield* setRules([{ action: "*", resource: "*", effect: "allow" }])
      yield* plantSessionRule([{ action: "subagent", resource: "*", effect: "deny" }])
      expect(yield* decide("subagent", "general")).toBe("deny")
      expect(yield* decide("read", "src/a.ts")).toBe("allow")
    }),
  )

  configIt.live("L3: a planted wellknown source, cached manifest and cached document load no configuration; the same document as the inline document does", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const global = path.join(tmp.path, "global")
        const project = path.join(tmp.path, "project")
        yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))
        // A closed local port: the manifest fetch fails at once and the engine would fall back to the cached manifest.
        const origin = "http://127.0.0.1:9"
        const document = { mcp: { planted: { type: "local", command: ["planted-connector"] } } }
        const kv = Layer.succeedContext(yield* Layer.build(LayerNode.compile(KV.node)))
        const instance = (options: Config.Options) =>
          AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node, WellKnown.node, KV.node]), [
            Config.node.replace(Config.configured({ system: false, ...options })),
            Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(project) })))),
            Global.node.replace(Global.layerWith({ config: global, home: path.join(global, "home") })),
            Credential.node.replace(emptyCredentialNode),
            KV.node.replace(kv),
            Watcher.node.replace(Watcher.testLayer),
          ])
        // Planted before the engine starts, as a write from an earlier turn would be (configuration loads at startup).
        yield* Effect.gen(function* () {
          const store = yield* KV.Service
          yield* store.set("wellknown:sources", [origin])
          yield* store.set(`wellknown:manifest:${origin}`, {})
          yield* store.set(`wellknown:config:${origin}`, [document])
        }).pipe(Effect.provide(kv))
        yield* Effect.gen(function* () {
          // The records are what the wellknown service reads: the source with its cached manifest, and the cached document.
          const wellknown = yield* WellKnown.Service
          expect((yield* wellknown.entries()).map((entry) => entry.origin)).toEqual([origin])
          expect(yield* wellknown.cached(origin)).toEqual([document])
          const config = yield* Config.Service
          expect(hasPlanted(yield* config.entries())).toBe(false)
        }).pipe(Effect.scoped, Effect.provide(instance({})))
        // Control: the same document given through a layer that is honoured (the inline document Code Puppy's injection
        // uses) loads the local connector. Integration documents would not do as a control: they drop local servers.
        yield* Effect.gen(function* () {
          const config = yield* Config.Service
          expect(hasPlanted(yield* config.entries())).toBe(true)
        }).pipe(Effect.scoped, Effect.provide(instance({ content: JSON.stringify(document) })))
      }),
    ),
  )
})
