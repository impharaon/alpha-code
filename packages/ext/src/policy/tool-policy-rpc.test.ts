// #1662 L4 — lane seams I5: the tool policy API over the OpenCode 2 plugin RPC, called through the engine's RPC
// registry (`Rpc.Service.call`, what `POST /api/rpc/:rpcID/:method` runs after its activation wait;
// packages/server/src/handlers/rpc.ts maps a returned error to HTTP 400 `RpcError { type }`).
import { beforeAll, describe, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { E, it, Location, Plugin, promisePlugin, isolate, ROOT, Rpc } from "./policy-host.cases"
import { registerPolicy } from "./index"
import { createToolPolicyStore, defaultPolicyBaseDir } from "./resolver"
import { policyFilePath } from "./store"
import { parseToolPolicyInventory } from "../../../schema/src/codepuppy-tool-inventory"

const { Effect, Exit, Cause } = E
beforeAll(isolate)

const ID = "codepuppy.tool-policy"

const setup = Effect.gen(function* () {
  const account = `rpc-${Math.random().toString(36).slice(2)}`
  process.env.CODEPUPPY_POLICY_ACCOUNT = account
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
      const policy = await registerPolicy(ctx)
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
