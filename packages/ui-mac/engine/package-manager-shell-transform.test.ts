import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { packageManagerShellSource } from "./package-manager-shell-transform"
import { projectDirectoryAccessSource } from "./file-access-transform"

const cache = resolve(import.meta.dirname, "../node_modules/.cache")
mkdirSync(cache, { recursive: true })
const root = mkdtempSync(join(cache, "prepared-shell-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const core = resolve(import.meta.dirname, "../../core/src/shell.ts")
const actual = (await Bun.file(core).text())
const source = packageManagerShellSource(actual, core)!

test("H2 exact Core/Plugin adapters compile together and reject upstream drift", async () => {
  for (const file of ["core/src/shell", "core/src/plugin/hooks", "core/src/plugin/host", "core/src/tool/plugin/shell", "plugin/src/effect/shell", "plugin/src/promise/shell", "plugin/src/promise/adapter"]) {
    const path = resolve(import.meta.dirname, "../..", file + ".ts")
    const original = await Bun.file(path).text()
    const delegated = packageManagerShellSource(original, path)!
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(projectDirectoryAccessSource(delegated, path) ?? delegated)).not.toThrow()
  }
  expect(() => packageManagerShellSource(actual.replace("        const id = Shell.ID.ascending()", "        const id = moved()"), core)).toThrow("seam moved")
})

test("H2 actual Shell.create prepares before delegating and transmits a private fd through the real Node spawner", async () => {
  const create = source.slice(source.indexOf('      const create = Effect.fn("Shell.create")'), source.indexOf("      return Service.of({ create,"))
  const entry = join(root, "driver.ts")
  await Bun.write(entry, `
import { Effect, Deferred, Duration, Fiber, Latch, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { LayerNode } from ${JSON.stringify(resolve(import.meta.dirname, "../../util/src/effect/layer-node.ts"))}
import { CrossSpawnSpawner } from ${JSON.stringify(resolve(import.meta.dirname, "package-manager-spawner.ts"))}
import { Shell } from "@opencode/schema/shell"
import { AppProcess } from "@opencode/util/process"
import { produce } from ${JSON.stringify(Bun.resolveSync("immer", resolve(import.meta.dirname, "../../core")))}
import path from "node:path"
import { createWriteStream, readFileSync } from "node:fs"
const outputDir = ${JSON.stringify(root)}
const events = []
const commands = new Map()
const exitOrder = []
const EXITED_LIMIT = 25
const location = { directory: outputDir }
const SessionSchema = { ID: { ast: undefined } }
const Schema = { is: () => () => false }
const environments = { get: () => Effect.succeed(undefined) }
const shell = { resolve: () => Effect.succeed("/bin/sh") }
const ShellSelect = { args: (shell, command) => ["-c", command] }
const bus = { publish: () => Effect.void }
const removeCommand = () => Effect.void
const hooks = { trigger: (domain, name, event) => Effect.sync(() => {
  events.push(name)
  if (name === "codepuppy.prepared") event.delegate = {
    executionSource: "IFS= read -r proof <&3; exec 3<&-; [ \\"$proof\\" = private-test-bytes ] && printf delegated",
    privateInput: { fd: 3, data: Buffer.from("private-test-bytes\\n") },
    bindProcess: async ({pid}) => { events.push({ bind: pid }) },
    cancel: async (reason) => { events.push({ cancel: reason }) },
    finish: async () => { events.push("finish") },
  }
  return event
}) }
const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const environment = { spawner: yield* ChildProcessSpawner }
  const runFork = Effect.runForkWith(yield* Effect.context())
${create}
  const info = yield* create({ command: "printf original", shell: "/bin/sh", metadata: { sessionID: "ses_real", messageID: "msg_real", callID: "call_real" } }, () => Effect.sync(() => { events.push("prepare") }))
  const command = commands.get(info.id)
  const terminal = yield* Deferred.await(command.done)
  return { info, terminal, events, output: readFileSync(info.file, "utf8") }
})).pipe(Effect.provide(LayerNode.compile(CrossSpawnSpawner.node))))
console.log("RESULT " + JSON.stringify(result))
`)
  const built = await Bun.build({ entrypoints: [entry], target: "node", format: "esm", outdir: join(root, "out"), packages: "bundle" })
  if (!built.success) throw new AggregateError(built.logs)
  const result = spawnSync(Bun.which("node")!, [built.outputs[0].path], { cwd: root, encoding: "utf8", timeout: 20_000 })
  expect(result.status, result.stderr).toBe(0)
  const record = JSON.parse(result.stdout.split("\n").find((line) => line.startsWith("RESULT "))!.slice(7))
  expect(record.events.slice(0, 3)).toEqual(["create.before", "prepare", "codepuppy.prepared"])
  expect(record.events[3]).toEqual({ bind: record.info.pid })
  expect(record.terminal.exit).toBe(0)
  expect(record.info.command).toBe("printf original")
  expect(JSON.stringify(record.info)).not.toContain("private-test-bytes")
  expect(record.output).toBe("delegated")
  expect(record.events).toContain("finish")
})
