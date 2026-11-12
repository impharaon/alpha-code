// #1130 Settings inventory on OpenCode 2 — what the codepuppy.tool-policy `inventory` method returns (rpc.ts
// `buildInventory`). Replaces packages/opencode/test/permission/codepuppy-tool-inventory.test.ts (#1662 L4); the
// v1 cases I1–I5 keep their meaning, I2 runs against the real host so "the badge tells the truth" is the same
// resolver the executor uses, not a re-derivation.
import { beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { buildInventory } from "./rpc"
import { toolFacts, type IdentityInput } from "./identity"
import type { ToolPolicySnapshot } from "./resolver"
import { E, isolate, it, Location, Plugin, promisePlugin, ROOT, Rpc, Tool } from "./policy-host.cases"
import { registerPolicy } from "./index"
import { createToolPolicyStore, defaultPolicyBaseDir } from "./resolver"

beforeAll(isolate)
const { Effect, Exit, Cause } = E

const POLICY_URL = "https://mcp.example.test/policy"
const input = (over: Partial<IdentityInput> = {}): IdentityInput => ({
  early: new Set(["write"]),
  earlyAmbiguous: false,
  mcp: new Map([["policy", { type: "remote", url: POLICY_URL } as never]]),
  bundled: undefined,
  extOrigin: "/x/plugin.js",
  env: {},
  ...over,
})
const snapshot = (records: unknown[] = [], over: Partial<ToolPolicySnapshot> = {}): ToolPolicySnapshot =>
  ({
    partition: { account: "acct", workspace: "ws" },
    managed: { status: "ok", ruleset: [], sources: [] },
    user: records.length ? { status: "ok", records } : { status: "absent" },
    load: { status: "absent" },
    revision: "absent",
    ...over,
  }) as ToolPolicySnapshot
const TOOLS = [
  toolFacts({ id: "write", name: "write" }, input()),
  toolFacts({ id: "policy_paid_action", name: "paid_action", options: { namespace: "policy" } }, input()),
  toolFacts({ id: "policy_free_action", name: "free_action", options: { namespace: "policy" } }, input()),
  toolFacts({ id: "probe", name: "probe" }, input()),
]

describe("Settings inventory", () => {
  test("I1 derived from the live registry: every source present, grouped by service, digests and new-discovery flags in place", () => {
    const inventory = buildInventory(snapshot(), TOOLS, [])
    expect(inventory.services.map((service) => `${service.source}:${service.origin}`)).toEqual(["builtin:", "mcp:policy", "plugin:"])
    const mcp = inventory.services.find((service) => service.source === "mcp")!
    expect(mcp.class).toBe("third-party-mcp")
    expect(mcp.tools.map((tool) => tool.canonical)).toEqual(["mcp:policy:free_action", "mcp:policy:paid_action"])
    expect(mcp.bindingDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(mcp.tools.every((tool) => tool.newlyDiscovered)).toBe(true)
    const builtin = inventory.services.find((service) => service.source === "builtin")!
    expect(builtin.tools[0]?.newlyDiscovered).toBe(false)
    expect(inventory.invalid).toEqual({ count: 0, entries: [] })
  })

  it.live("I2 the badge tells the truth: a tool the inventory shows disabled is refused by the production executor", () =>
    Effect.gen(function* () {
      const account = `inv-${Math.random().toString(36).slice(2)}`
      process.env.CODEPUPPY_POLICY_ACCOUNT = account
      const plugins = yield* Plugin.Service
      yield* plugins.activate([
        promisePlugin("builtins", async (ctx: any) => {
          await ctx.tool.transform((editor: any) =>
            editor.add({ name: "probe_write", options: { codemode: false }, description: "p", input: { type: "object", properties: {} }, execute: async () => ({ content: "ran" }) }),
          )
        }),
        promisePlugin("codepuppy-ext", async (ctx: any) => {
          const policy = await registerPolicy(ctx)
          await policy.seal()
        }),
        promisePlugin("config-agents", async (ctx: any) => {
          await ctx.agent.transform((editor: any) =>
            editor.update("build", (agent: any) => agent.permissions.push({ action: "*", resource: "*", effect: "allow" })),
          )
        }),
      ])
      yield* plugins.awaitActivation
      const location = yield* Location.Service
      const store = createToolPolicyStore({ baseDir: defaultPolicyBaseDir(path.join(ROOT, "data", "opencode")), account: () => account, workspace: () => location.directory })
      yield* Effect.promise(() => store.setRecord({ selector: { level: "tool", canonical: "builtin::probe_write" }, state: "disabled" } as never))
      const listed: any = yield* (yield* Rpc.Service).call("codepuppy.tool-policy", "inventory", {})
      const row = listed.services.flatMap((service: any) => service.tools).find((tool: any) => tool.canonical === "builtin::probe_write")
      expect(row.effective.state).toBe("disabled")
      const executed = yield* (yield* (yield* Tool.Service).snapshot([{ action: "*", resource: "*", effect: "allow" }]))
        .execute({ sessionID: "ses_inv", agent: "build", messageID: "msg_inv", call: { type: "tool-call", id: "call_inv", name: "probe_write", input: {} } })
        .pipe(Effect.exit)
      expect(Exit.isFailure(executed) && String((Cause.squash(executed.cause) as Error).message)).toContain("builtin::probe_write")
    }),
  )

  test("I3 the digest the inventory hands out is the one that makes enabled stick; a rebind returns to ask with a new digest", () => {
    const before = buildInventory(snapshot(), TOOLS, [])
    const paid = before.services.find((service) => service.source === "mcp")!.tools.find((tool) => tool.canonical === "mcp:policy:paid_action")!
    const enabled = [{ selector: { level: "tool", canonical: "mcp:policy:paid_action" }, state: "enabled", bindingDigest: paid.bindingDigest }]
    const after = buildInventory(snapshot(enabled), TOOLS, [])
    const row = after.services.find((service) => service.source === "mcp")!.tools.find((tool) => tool.canonical === "mcp:policy:paid_action")!
    expect(row.effective).toMatchObject({ state: "enabled", reason: { kind: "user", level: "tool" } })
    const rebound = [toolFacts({ id: "policy_paid_action", name: "paid_action", options: { namespace: "policy" } }, input({ mcp: new Map([["policy", { type: "remote", url: "https://moved.example.test/policy" } as never]]) }))]
    const moved = buildInventory(snapshot(enabled), rebound, []).services[0]!.tools[0]!
    expect(moved.effective).toMatchObject({ state: "ask", reason: { kind: "binding-changed", level: "tool" } })
    expect(moved.bindingDigest).not.toBe(paid.bindingDigest)
  })

  test("I4 a configured identity deny folds into the cap, so Settings can say why it is locked", () => {
    const inventory = buildInventory(snapshot(), TOOLS, [{ action: "mcp:policy:paid_action", resource: "*", effect: "deny" }])
    const row = inventory.services.find((service) => service.source === "mcp")!.tools.find((tool) => tool.canonical === "mcp:policy:paid_action")!
    expect(row.effective).toEqual({ state: "disabled", action: "deny", reason: { kind: "cap-hard-deny", sources: ["permission-ruleset"] } })
  })

  test("I5 quarantine surfaces: a broken document marks the user layer quarantined and every configurable tool disabled", () => {
    const inventory = buildInventory(snapshot([], { user: { status: "quarantined", reason: "broken" } }), TOOLS, [])
    expect(inventory.user).toEqual({ status: "quarantined", reason: "broken" })
    const states = inventory.services.flatMap((service) => service.tools.map((tool) => tool.effective))
    expect(states.every((effective) => effective.state === "disabled" && effective.reason.kind === "quarantine")).toBe(true)
  })
})
