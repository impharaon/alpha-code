// Review-panel diff for a turn the engine starts itself (#1662 L4 Unit F; UI parity with the current release): a
// background subagent's completion arrives after idle as a synthetic message and starts a turn. The re-taken file is
// packages/core/src/session/diff.ts, which accepts a synthetic message as the anchor and counts it as a turn's opening.
// Real Session service, projector, snapshots and git working copy, wired as upstream's test/session-diff.test.ts.
//
// Red if diff.ts is upstream's again: anchoring on the synthetic message fails with "is not a user message" (the 400
// the desktop measured).
import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { Snapshot } from "@opencode/core/snapshot"
import { Money } from "@opencode/schema/money"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, Session.node, LocationServiceMap.node]),
    [Global.node.replace(tempGlobalLayer), SessionExecution.node.replace(SessionExecution.noopLayer), offlineModels],
  ),
)

describe("review diff for a turn started by the engine's synthetic message", () => {
  it.live("user, assistant, idle, synthetic, assistant (b.txt), idle, then a later user turn", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const directory = path.join(tmp.path, "project")
      const write = (name: string, content: string) => () => Bun.write(path.join(directory, name), content)
      yield* Effect.promise(async () => {
        await fs.mkdir(directory)
        await write("seed.txt", "seed\n")()
        await $`git init -q`.cwd(directory).quiet()
        await $`git -c core.fsmonitor=false add .`.cwd(directory).quiet()
      })
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
      const diff = (from: SessionMessage.ID) =>
        sessions.diff({ sessionID: created.id, context: 0, from }).pipe(Effect.map((files) => files.map((file) => [file.file, file.status])))

      yield* Effect.gen(function* () {
        yield* (yield* Plugin.Service).awaitActivation
        const snapshot = yield* Snapshot.Service
        const usage = { cost: Money.USD.zero, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }
        const step = Effect.fn(function* (edit: () => Promise<unknown>) {
          const before = yield* snapshot.capture()
          if (!before) throw new Error("Start snapshot missing")
          const assistantMessageID = SessionMessage.ID.create()
          yield* bus.publish(SessionEvent.Step.Started, {
            sessionID: created.id,
            assistantMessageID,
            agent: Agent.defaultID,
            model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test-provider") },
            snapshot: before,
            started: 0,
          })
          yield* Effect.promise(edit)
          const after = yield* snapshot.capture()
          yield* bus.publish(SessionEvent.Step.Ended, {
            sessionID: created.id,
            assistantMessageID,
            finish: "stop",
            ...usage,
            snapshot: after,
            files: after ? yield* snapshot.files({ from: before, to: after }) : undefined,
          })
        })
        const idle = bus.publish(SessionEvent.Execution.Succeeded, { sessionID: created.id })
        const promote = SessionInbox.promote(database.db, bus, created.id, "steer")

        const user = (yield* sessions.prompt({ sessionID: created.id, text: "Add a", resume: false })).id
        yield* promote
        yield* step(write("a.txt", "a\n"))
        yield* idle
        const synthetic = (yield* sessions.synthetic({ sessionID: created.id, text: "Subagent finished", resume: false })).id
        yield* promote
        yield* step(write("b.txt", "b\n"))
        yield* idle

        expect(yield* diff(synthetic)).toEqual([["b.txt", "added"]])
        expect(yield* diff(user)).toEqual([["a.txt", "added"]])

        // A later user turn neither moves the synthetic turn's start past its anchor nor joins it.
        yield* sessions.prompt({ sessionID: created.id, text: "Add c", resume: false })
        yield* promote
        yield* step(write("c.txt", "c\n"))
        yield* idle
        expect(yield* diff(synthetic)).toEqual([["b.txt", "added"]])
      }).pipe(Effect.provide(LocationServiceMap.Service.get(created.location)))
    }),
    // Real Location/plugin startup and Git snapshots can exceed five seconds under load (as upstream's diff test).
    { timeout: 30_000 },
  )
})
