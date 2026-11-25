import { createUnattendedState } from "./unattended"
// #1662 L4 — lane seams I5: the tool policy API over the OpenCode 2 plugin RPC, called through the engine's RPC
// registry (`Rpc.Service.call`, what `POST /api/rpc/:rpcID/:method` runs after its activation wait;
// packages/server/src/handlers/rpc.ts maps a returned error to HTTP 400 `RpcError { type }`).
import { describe, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { E, it, Location, Plugin, promisePlugin, isolate, publishPolicyAccount, ROOT, Rpc } from "./policy-host.cases"
import { registerPolicy } from "./index"
import { createToolPolicyStore, defaultPolicyBaseDir, type ToolPolicyWriter } from "./resolver"
import { createHubBridge, type HubPort } from "../hub-bridge"
import { policyFilePath } from "./store"
import { parseToolPolicyInventory } from "../../../schema/src/codepuppy-tool-inventory"

const { Effect, Exit, Cause } = E
isolate()

const ID = "codepuppy.tool-policy"

/** `toolPolicy`: the writer registerPolicy hands the store (production: the bridge to main, when the process has a parent port). */
const setupWith = (toolPolicy?: ToolPolicyWriter) => Effect.gen(function* () {
  const account = publishPolicyAccount("rpc")
  const plugins = yield* Plugin.Service
  yield* plugins.activate([
    promisePlugin("builtins", async (ctx: any) => {
      await ctx.tool.transform((editor: any) =>
        editor.add({
          name: "probe_write",
          options: { codemode: false },
          description: "probe",
          input: { type: "object", properties: {} },
          execute: async () => ({ content: "ok" }),
        }),
      )
    }),
    promisePlugin("codepuppy-ext", async (ctx: any) => {
      const policy = await registerPolicy(ctx, createUnattendedState(), undefined as never, toolPolicy)
      await policy.seal()
    }),
  ])
  yield* plugins.awaitActivation
  const location = yield* Location.Service
  const store = createToolPolicyStore({
    baseDir: defaultPolicyBaseDir(path.join(ROOT, "data", "opencode")),
    account: () => account,
    workspace: () => location.directory,
  })
  return { account, location, store }
})
const setup = setupWith()

const call = (method: string, input: unknown) =>
  Effect.gen(function* () {
    const rpc = yield* Rpc.Service
    return yield* rpc.call(ID, method, input).pipe(Effect.exit)
  })

const errorType = (exit: any) => (Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { type?: string }).type : undefined)

describe("tool policy RPC (I5)", () => {
  it.live("inventory returns a document that decodes as ToolPolicyInventoryV1", () =>
    Effect.gen(function* () {
      yield* setup
      const exit: any = yield* call("inventory", {})
      expect(Exit.isSuccess(exit)).toBe(true)
      const inventory = parseToolPolicyInventory(exit.value)
      const builtin = inventory.services.find((service) => service.source === "builtin")
      expect(builtin?.tools.map((tool) => tool.canonical)).toContain("builtin::probe_write")
      expect(inventory.user).toEqual({ status: "absent" })
    }),
  )

  it.live("setRecord writes, removeRecord removes, reset backs the document up", () =>
    Effect.gen(function* () {
      const { store } = yield* setup
      const record = { selector: { level: "tool", canonical: "builtin::probe_write" }, state: "disabled" }
      expect(Exit.isSuccess(yield* call("setRecord", record))).toBe(true)
      const written = yield* Effect.promise(() => store.snapshot())
      expect(written.user).toEqual({ status: "ok", records: [record] })
      expect(Exit.isSuccess(yield* call("removeRecord", { selector: record.selector }))).toBe(true)
      expect((yield* Effect.promise(() => store.snapshot())).user).toEqual({ status: "ok", records: [] })
      const reset: any = yield* call("reset", {})
      expect(reset.value?.backup).toContain(".quarantined-")
    }),
  )

  it.live("a quarantined document ⇒ setRecord fails with type quarantined", () =>
    Effect.gen(function* () {
      const { account, location } = yield* setup
      const file = policyFilePath(defaultPolicyBaseDir(path.join(ROOT, "data", "opencode")), {
        account,
        workspace: location.directory,
      })
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, "{ not json")
      const exit = yield* call("setRecord", { selector: { level: "class", class: "plugin" }, state: "ask" })
      expect(errorType(exit)).toBe("quarantined")
    }),
  )

  it.live("an invalid record ⇒ type invalid-record, nothing written", () =>
    Effect.gen(function* () {
      const { store } = yield* setup
      // service/tool enabled without a binding digest violates the binding guard (§5).
      const exit = yield* call("setRecord", { selector: { level: "tool", canonical: "builtin::probe_write" }, state: "enabled" })
      expect(errorType(exit)).toBe("invalid-record")
      expect((yield* Effect.promise(() => store.snapshot())).user).toEqual({ status: "absent" })
    }),
  )

  it.live("reverse arm: without registerPolicy the RPC is unavailable", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      yield* plugins.activate([promisePlugin("codepuppy-ext", async () => {})])
      yield* plugins.awaitActivation
      expect(errorType(yield* call("inventory", {}))).toBe("rpc.unavailable")
    }),
  )
})

// SPEC-engine-config-fence BR-03 / AC-05 / DESIGN-engine-config-fence §4.5 / E6:生产里 registerPolicy 拿到的写者是 hub 桥,经 parentPort 交给 main;
// main 跑 receiveToolPolicyWrite(生产那一份)写盘、写完再回复。这里 port 的另一头就是它(真目录;投递走定时器,像跨进程那样异步)。
/** main over the parent port: every request is handed to main's production receiver; replies come back asynchronously. */
function mainOverPort(baseDir: string, receive: typeof import("./store").receiveToolPolicyWrite, delayMs = 0) {
  const listeners: Array<(event: { data: unknown }) => void> = []
  const requests: Array<{ op?: string; partition?: unknown }> = []
  const lines: string[] = []
  const port: HubPort = {
    postMessage: (message) => {
      requests.push(message as { op?: string })
      setTimeout(() => receive(message, { baseDir, post: (reply) => queueMicrotask(() => listeners.forEach((listener) => listener({ data: reply }))), log: (line) => void lines.push(line) }), delayMs)
    },
    on: (_event, listener) => void listeners.push(listener),
  }
  return { port, requests, lines }
}
const mainBaseDir = () => defaultPolicyBaseDir(path.join(ROOT, "data", "opencode"))

describe("tool policy RPC with main's writer (I-13 E6)", () => {
  it.live("setRecord / removeRecord / reset are written by main over the port — ext sends one request per write and writes nothing itself — and the next read sees the new document", () =>
    Effect.gen(function* () {
      const { receiveToolPolicyWrite } = yield* Effect.promise(() => import("./store"))
      const main = mainOverPort(mainBaseDir(), receiveToolPolicyWrite)
      const { account, location, store } = yield* setupWith(createHubBridge(main.port, { log: () => {} }).toolPolicy)
      const record = { selector: { level: "tool", canonical: "builtin::probe_write" }, state: "disabled" }
      expect(Exit.isSuccess(yield* call("setRecord", record))).toBe(true)
      expect((yield* Effect.promise(() => store.snapshot())).user).toEqual({ status: "ok", records: [record] })
      expect(Exit.isSuccess(yield* call("removeRecord", { selector: record.selector }))).toBe(true)
      expect((yield* Effect.promise(() => store.snapshot())).user).toEqual({ status: "ok", records: [] })
      const reset: any = yield* call("reset", {})
      expect(reset.value?.backup).toContain(".quarantined-")
      expect((yield* Effect.promise(() => store.snapshot())).user).toEqual({ status: "absent" })
      expect(main.requests.map((request) => request.op)).toEqual(["save", "save", "reset"])
      for (const request of main.requests) expect(request.partition).toEqual({ account, workspace: location.directory })
      expect(main.lines).toEqual([])
    }),
  )

  it.live("AC-05: main cannot write ⇒ setRecord / removeRecord fail with write-failed, reset fails, the old document stays byte for byte; main names each failure in one line", () =>
    Effect.gen(function* () {
      const { receiveToolPolicyWrite } = yield* Effect.promise(() => import("./store"))
      const main = mainOverPort(mainBaseDir(), receiveToolPolicyWrite)
      const { account, location } = yield* setupWith(createHubBridge(main.port, { log: () => {} }).toolPolicy)
      const record = { selector: { level: "tool", canonical: "builtin::probe_write" }, state: "disabled" }
      expect(Exit.isSuccess(yield* call("setRecord", record))).toBe(true)
      const file = policyFilePath(mainBaseDir(), { account, workspace: location.directory })
      const before = fs.readFileSync(file)
      fs.chmodSync(mainBaseDir(), 0o500)
      try {
        expect(errorType(yield* call("setRecord", { selector: { level: "class", class: "plugin" }, state: "ask" }))).toBe("write-failed")
        expect(errorType(yield* call("removeRecord", { selector: record.selector }))).toBe("write-failed")
        expect(Exit.isFailure(yield* call("reset", {}))).toBe(true)
      } finally {
        fs.chmodSync(mainBaseDir(), 0o700)
      }
      expect(fs.readFileSync(file)).toEqual(before)
      expect(main.lines.filter((line) => line.startsWith("[I-13] tool policy "))).toHaveLength(3)
    }),
  )

  it.live("two setRecord for two tools in flight at once (the settings page changing two rows) ⇒ both records on disk", () =>
    Effect.gen(function* () {
      const { receiveToolPolicyWrite } = yield* Effect.promise(() => import("./store"))
      const main = mainOverPort(mainBaseDir(), receiveToolPolicyWrite, 20)
      const { store } = yield* setupWith(createHubBridge(main.port, { log: () => {} }).toolPolicy)
      const first = { selector: { level: "tool", canonical: "builtin::probe_write" }, state: "disabled" }
      const second = { selector: { level: "class", class: "plugin" }, state: "ask" }
      const exits = yield* Effect.all([call("setRecord", first), call("setRecord", second)], { concurrency: "unbounded" })
      expect(exits.map((exit) => Exit.isSuccess(exit))).toEqual([true, true])
      const written = (yield* Effect.promise(() => store.snapshot())).user as { status: string; records: unknown[] }
      expect(written.status).toBe("ok")
      expect(written.records).toHaveLength(2)
      expect(written.records).toEqual(expect.arrayContaining([first, second]))
    }),
  )
})
