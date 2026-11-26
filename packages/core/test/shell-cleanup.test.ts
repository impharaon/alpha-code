import { describe, expect } from "bun:test"
import path from "path"
import { spawn } from "node:child_process"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Shell } from "@opencode/core/shell"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const withStore = <A, E, R>(body: (fs: FSUtil.Interface, root: string) => Effect.Effect<A, E, R>) =>
  withTempDir((tmp) => {
    const layer = AppNodeBuilder.build(LayerNode.group([FSUtil.node, Global.node]), [
      Global.node.replace(Global.layerWith({ data: tmp.path })),
    ])
    return Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      return yield* body(fs, tmp.path)
    }).pipe(Effect.provide(layer))
  })

describe("Shell cleanup", () => {
  it.live("removes only encrypted captures whose owner has exited", () => withStore((fs, root) => Effect.gen(function* () {
    const pid = yield* Effect.promise(() => new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, ["--eval", ""], { stdio: "ignore" })
      child.once("error", reject)
      child.once("exit", () => resolve(child.pid!))
    }))
    const directory = path.join(root, Shell.DIRECTORY, "project")
    yield* fs.ensureDir(directory)
    const file = (owner: number) => path.join(directory, `sh_0123456789abABCDEFGHIJKLMN.out.pending.${owner}.${"a".repeat(32)}.enc`)
    for (const owner of [pid, process.pid, Number.MAX_SAFE_INTEGER]) yield* fs.writeFileString(file(owner), "ciphertext fixture")
    yield* Shell.cleanup()
    expect(yield* fs.exists(file(pid))).toBe(false)
    expect(yield* fs.exists(file(process.pid))).toBe(true)
    expect(yield* fs.exists(file(Number.MAX_SAFE_INTEGER))).toBe(true)
  })))
  it.live("removes expired output files across projects", () =>
    withStore((fs, root) =>
      Effect.gen(function* () {
        const first = path.join(root, Shell.DIRECTORY, "first")
        const second = path.join(root, Shell.DIRECTORY, "second")
        const old = path.join(first, "sh_0123456789abABCDEFGHIJKLMN.out")
        const recent = path.join(second, "sh_0123456789abNOPQRSTUVWXYZ0.out")
        const unrelated = path.join(first, "notes.out")
        yield* fs.ensureDir(first)
        yield* fs.ensureDir(second)
        yield* fs.writeFileString(old, "old")
        yield* fs.writeFileString(recent, "recent")
        yield* fs.writeFileString(unrelated, "unrelated")
        const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000)
        yield* fs.utimes(old, new Date(), expired)
        yield* fs.utimes(unrelated, new Date(), expired)

        yield* Shell.cleanup()

        expect(yield* fs.exists(old)).toBe(false)
        expect(yield* fs.exists(recent)).toBe(true)
        expect(yield* fs.exists(unrelated)).toBe(true)
      }),
    ),
  )
})
