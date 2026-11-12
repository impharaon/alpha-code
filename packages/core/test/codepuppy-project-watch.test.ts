// Project-wide file change events (#1662 L4 Unit F; UI parity with the current release). The re-taken
// packages/core/src/filesystem/location-watcher.ts adds a recursive watch on the Location's folder when main's switch
// is on (codepuppy-project-watch.ts); each change is published as `filesystem.changed`, which the desktop's adapter
// already turns into file-panel updates. Real watcher (Parcel: fs-events on macOS, inotify on Linux), real temp folder,
// real bus, wired as upstream's test/filesystem/watcher.test.ts wires LocationWatcher.
//
// Red if location-watcher.ts is upstream's again (only the VCS branch file is watched: no event for a project file),
// or if an ignored folder (.git, node_modules) or a switched-off watch still publishes.
import { afterAll, beforeAll, describe, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { Effect, Layer, Stream } from "effect"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { LocationWatcher } from "@opencode/core/filesystem/location-watcher"
import { LocationWatcherPolicy } from "@opencode/core/filesystem/location-watcher-policy"
import { PROJECT_WATCH_ENV } from "@opencode/core/filesystem/codepuppy-project-watch"
import { FileSystem } from "@opencode/schema/filesystem"
import { Location } from "@opencode/core/location"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { AbsolutePath } from "@opencode/core/schema"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

type Change = { file: string; event: "add" | "change" | "unlink" }
const it = testEffect(Layer.empty)

/** The production LocationWatcher over a real folder; collects every published change. */
const watching = <A, E, R>(directory: string, body: (changes: Change[]) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const changes: Change[] = []
    const bus = yield* Bus.Service
    yield* bus.subscribe(FileSystem.Event.Changed).pipe(
      Stream.runForEach((event: any) => Effect.sync(() => void changes.push({ file: fs.realpathSync.native(path.dirname(event.data.file)) + path.sep + path.basename(event.data.file), event: event.data.event }))),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* LocationWatcher.Service
    return yield* body(changes)
  }).pipe(
    Effect.scoped,
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([PluginSupervisor.node, LocationWatcher.node, LocationWatcherPolicy.node, Bus.node, Config.node]), [
        Config.node.replace(Config.testLayer()),
        Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) })))),
        PluginSupervisor.node.replace(Layer.empty),
        // Every Global root in a temp folder (review R1 #10), should anything in the graph resolve it.
        Global.node.replace(tempGlobalLayer),
      ]),
    ),
  )

const until = (probe: () => boolean, label: string, ms = 10_000) =>
  Effect.promise(async () => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (probe()) return
      await Bun.sleep(25)
    }
    throw new Error(`timed out: ${label}`)
  })

/** The subscription is asynchronous: touch a probe file until its event arrives, so later changes are not missed. */
const warmUp = (root: string, changes: Change[]) =>
  Effect.promise(async () => {
    const probe = path.join(root, "warm-up.txt")
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      fs.writeFileSync(probe, String(Date.now()))
      await Bun.sleep(100)
      if (changes.some((change) => change.file === probe)) return true
    }
    return false
  })

describe("project-wide file change events", () => {
  let previous: string | undefined
  beforeAll(() => {
    previous = process.env[PROJECT_WATCH_ENV]
    process.env[PROJECT_WATCH_ENV] = "true"
  })
  afterAll(() => {
    if (previous === undefined) delete process.env[PROJECT_WATCH_ENV]
    else process.env[PROJECT_WATCH_ENV] = previous
  })

  it.live("a file and a file in a subfolder: created, modified and deleted each publish their kind; .git and node_modules publish nothing", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const root = fs.realpathSync.native(tmp.path)
          for (const folder of ["sub", ".git", path.join("node_modules", "pkg")]) fs.mkdirSync(path.join(root, folder), { recursive: true })
          yield* watching(root, (changes) =>
            Effect.gen(function* () {
              expect(yield* warmUp(root, changes)).toBe(true)
              for (const file of [path.join(root, "a.txt"), path.join(root, "sub", "b.txt")]) {
                const seen = (event: Change["event"]) => () => changes.some((change) => change.file === file && change.event === event)
                fs.writeFileSync(file, "one\n")
                yield* until(seen("add"), `add ${file}`)
                yield* Effect.promise(() => Bun.sleep(150))
                fs.writeFileSync(file, "two\n")
                yield* until(seen("change"), `change ${file}`)
                fs.rmSync(file)
                yield* until(seen("unlink"), `unlink ${file}`)
              }
              fs.writeFileSync(path.join(root, ".git", "config"), "x\n")
              fs.writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "x\n")
              // A later change that does arrive bounds the wait for the ignored ones.
              fs.writeFileSync(path.join(root, "after.txt"), "x\n")
              yield* until(() => changes.some((change) => change.file === path.join(root, "after.txt")), "after.txt")
              yield* Effect.promise(() => Bun.sleep(300))
              expect(changes.filter((change) => change.file.includes(`${path.sep}.git${path.sep}`) || change.file.includes(`${path.sep}node_modules${path.sep}`))).toEqual([])
            }),
          )
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("with main's switch off, a project file publishes nothing", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          process.env[PROJECT_WATCH_ENV] = "false"
          const root = fs.realpathSync.native(tmp.path)
          yield* watching(root, (changes) =>
            Effect.gen(function* () {
              expect(yield* warmUp(root, changes)).toBe(false)
            }),
          ).pipe(Effect.ensuring(Effect.sync(() => (process.env[PROJECT_WATCH_ENV] = "true"))))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  { timeout: 20_000 },
  )
})
