// SPEC-stored-credentials-fence BR-02 / BR-03 (DESIGN-stored-credentials-fence §4.4, config.ts `codepuppy(I-20)`): Code Puppy's two
// documents — the explicit file and the inline content — take credential values from the in-process table only, pulled from the main
// process before each load, and only at the closed list of credential positions. Every other position is left to the engine's own
// {file:} read (in the fenced process that read is refused). A failed pull substitutes nothing, never an older table.
// Real-engine evidence: packages/ui-mac/src/main/stored-credentials.engine.test.ts. Values are visibly fake.
import path from "path"
import fs from "fs/promises"
import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { WellKnown } from "@opencode/core/wellknown"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import {
  __resetCodePuppyCredentialsForTests,
  installCodePuppyCredentialSource,
  publishCodePuppyCredentials,
  type CodePuppyCredentials,
} from "@opencode/util/codepuppy-credentials"
import { emptyCredentialNode } from "./fixture/config-nodes"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)
afterEach(() => __resetCodePuppyCredentialsForTests())

const loadEntries = (tmp: string, options: Config.Options) =>
  Effect.gen(function* () {
    const project = path.join(tmp, "project")
    const global = path.join(tmp, "global")
    yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))
    const kv = Layer.succeedContext(yield* Layer.build(LayerNode.compile(KV.node)))
    const instance = AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node, WellKnown.node, KV.node]), [
      Config.node.replace(Config.configured({ system: false, ...options })),
      Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(project) })))),
      Global.node.replace(Global.layerWith({ config: global, home: path.join(global, "home") })),
      Credential.node.replace(emptyCredentialNode),
      KV.node.replace(kv),
      Watcher.node.replace(Watcher.testLayer),
    ])
    return yield* Effect.gen(function* () {
      return JSON.stringify(yield* (yield* Config.Service).entries())
    }).pipe(Effect.scoped, Effect.provide(instance))
  })

/** The stores: on disk one value, in the table another — a load that reads the disk shows the disk value. */
const stores = (tmp: string) => {
  const userData = path.join(tmp, "userData")
  return {
    userData,
    own: path.join(userData, "codepuppy-mcp-secrets", "alpha", "v-0000aaaa", "TOKEN"),
    other: path.join(userData, "codepuppy-mcp-secrets", "bravo", "v-0000aaaa", "TOKEN"),
    platform: path.join(userData, "codepuppy-secrets", "CODEPUPPY_API_KEY"),
    tableOnly: path.join(userData, "codepuppy-secrets", "ONLY_IN_THE_TABLE"),
  }
}
const writeDisk = async (file: string, value: string) => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, value)
}

describe("codepuppy(I-20) config load: the in-process table at the closed list of positions", () => {
  it.live("listed positions take the table's value (not the disk's); an unlisted position, an inline entry in the explicit file and another connector's token are left to the engine's own read", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const s = stores(tmp.path)
        yield* Effect.promise(async () => {
          await writeDisk(s.own, "FAKE-disk-alpha")
          await writeDisk(s.other, "FAKE-disk-bravo")
          await writeDisk(s.platform, "FAKE-disk-platform")
        })
        const table: CodePuppyCredentials = {
          [s.own]: { value: "FAKE-table-alpha\n", use: { kind: "connector", server: "alpha" } },
          [s.other]: { value: "FAKE-table-bravo", use: { kind: "connector", server: "bravo" } },
          [s.platform]: { value: "FAKE-table-platform", use: { kind: "inline" } },
          [s.tableOnly]: { value: "FAKE-table-only", use: { kind: "inline" } },
        }
        let pulls = 0
        installCodePuppyCredentialSource(async () => {
          pulls++
          return table
        })
        const explicit = path.join(tmp.path, "explicit.json")
        yield* Effect.promise(() =>
          fs.writeFile(
            explicit,
            JSON.stringify({
              agents: { build: { system: `{file:${s.tableOnly}}` } },
              mcp: { alpha: { type: "local", command: ["alpha-mcp"], environment: { OWN: `{file:${s.own}}`, PLATFORM: `{file:${s.platform}}`, OTHER: `{file:${s.other}}` } } },
            }),
          ),
        )
        const content = JSON.stringify({ mcp: { servers: { codepuppy: { type: "remote", url: "https://cloud.invalid/mcp", headers: { Authorization: `Bearer {file:${s.platform}}` } } } } })
        const entries = yield* loadEntries(tmp.path, { file: explicit, content })
        expect(pulls).toBe(2) // one pull per document load (explicit + inline), never merged
        expect(entries).toContain('"OWN":"FAKE-table-alpha"')
        expect(entries).toContain('"Authorization":"Bearer FAKE-table-platform"')
        // unlisted position: not from the table; the engine's own read of a path not on disk gives an empty string
        expect(entries).not.toContain("FAKE-table-only")
        // an inline entry is never substituted from the explicit file; another connector's token is not substituted into alpha
        expect(entries).not.toContain("FAKE-table-platform\",\"OTHER")
        expect(entries).toContain('"PLATFORM":"FAKE-disk-platform"')
        expect(entries).toContain('"OTHER":"FAKE-disk-bravo"')
        expect(entries).not.toContain("FAKE-table-bravo")
      }),
    ),
  )

  it.live("a failed pull substitutes nothing — never the table published before — and the next load pulls again", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const s = stores(tmp.path)
        publishCodePuppyCredentials({ [s.tableOnly]: { value: "FAKE-old-table", use: { kind: "inline" } } })
        let fail = true
        installCodePuppyCredentialSource(async () => {
          if (fail) throw new Error("no reply from the main process")
          return { [s.tableOnly]: { value: "FAKE-current", use: { kind: "inline" } } }
        })
        const content = JSON.stringify({ mcp: { servers: { codepuppy: { type: "remote", url: "https://cloud.invalid/mcp", headers: { Authorization: `Bearer {file:${s.tableOnly}}` } } } } })
        const failed = yield* loadEntries(tmp.path, { content })
        expect(failed).not.toContain("FAKE-old-table")
        expect(failed).toContain('"Authorization":"Bearer "')
        fail = false
        expect(yield* loadEntries(tmp.path, { content })).toContain('"Authorization":"Bearer FAKE-current"')
      }),
    ),
  )

  it.live("without a source (repository CLI, upstream tests) the documents load as upstream does", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const s = stores(tmp.path)
        yield* Effect.promise(() => writeDisk(s.platform, "FAKE-disk-platform"))
        const content = JSON.stringify({ mcp: { servers: { codepuppy: { type: "remote", url: "https://cloud.invalid/mcp", headers: { Authorization: `Bearer {file:${s.platform}}` } } } } })
        expect(yield* loadEntries(tmp.path, { content })).toContain('"Authorization":"Bearer FAKE-disk-platform"')
      }),
    ),
  )
})
