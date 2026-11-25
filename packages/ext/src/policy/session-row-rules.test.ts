// INT-safety I-13 / SPEC-engine-config-fence BR-02 (DESIGN-engine-config-fence §4.6 L2, D16): of the session row's rules only
// `deny` entries take part — at every read of the row. The engine database is writable from inside the fence, so the row
// can be planted. This file covers the extension's read: `ruleset()` in index.ts hands the gate "agent rules + session-row
// rules", and an unattended run that the gate allows never reaches the engine's own decision (gate.ts `confirm`), so a
// planted session-row allow there would beat an agent's identity deny on its own. It also covers the engine's session
// context (packages/core/src/session/context.ts `select`): it merges the session row into the rules that decide which tools,
// skills and connector descriptions a request gets, and a plugin tool whose only guard is a whole-tool deny on its permission
// action has no other check. The engine's decision read is packages/core/test/codepuppy-engine-db-records.test.ts.
// Harness: the production permission service, Promise adapter and execution chain (policy-host.cases.ts), as
// unattended-policy.test.ts uses it. The tool is plugin-registered with the MCP layer's mark (the ext gives it an MCP
// identity) and its executor makes no engine permission call, so the outcome is the extension's decision.
import { expect } from "bun:test"
import type { Context } from "@opencode/plugin/promise/plugin"
import { AUTOMATION_PROFILES, type UnattendedProfile } from "../../../schema/src/codepuppy-unattended"
import { buildUnattendedLive } from "../../../ui-mac/src/main/codepuppy-sidecar-messages"
import { registerPolicy } from "./index"
import { createUnattendedState } from "./unattended"
import { E, isolate, it, Location, Plugin, PluginHooks, promisePlugin, publishPolicyAccount, seedProject, Session, SessionContext, Tool, mcpToolMark } from "./policy-host.cases"

const { Effect, Exit, Cause } = E
isolate()

type Rule = { action: string; resource: string; effect: "allow" | "deny" | "ask" }
const IDENTITY = "mcp:unattended:write"
const allow: Rule = { action: "*", resource: "*", effect: "allow" }
const identityDeny: Rule = { action: IDENTITY, resource: "*", effect: "deny" }

/** One call of the tool in a fresh session of `profile` (undefined = interactive), with `row` planted on the session row. */
const call = (profile: UnattendedProfile | undefined, agentRules: Rule[], row: Rule[]) =>
  Effect.gen(function* () {
    const location = yield* Location.Service
    const plugins = yield* Plugin.Service
    const state = createUnattendedState()
    publishPolicyAccount(`session-row-${crypto.randomUUID()}`)
    const agent = Object.entries(AUTOMATION_PROFILES).find(([, selected]) => selected === profile)?.[0] ?? "build"
    const counts = { writes: 0 }
    yield* plugins.activate([
      promisePlugin("session-row-config", async (ctx: Context) => {
        await ctx.agent.transform((editor) => {
          for (const name of [...Object.keys(AUTOMATION_PROFILES), "build"]) editor.update(name, (draft) => draft.permissions.push(...agentRules))
        })
        await ctx.mcp.transform((editor) => editor.set("unattended", { type: "remote", url: "http://127.0.0.1:1/mcp" }))
      }),
      promisePlugin("session-row-policy", async (ctx: Context) => {
        const policy = await registerPolicy(ctx, state, () => undefined)
        await policy.seal()
      }),
      promisePlugin("session-row-tool", async (ctx: Context) => {
        await ctx.tool.transform((editor) => {
          editor.add({
            name: "write",
            description: "counts side effects",
            input: { type: "object", properties: {} },
            options: { namespace: "unattended", codemode: false },
            ...mcpToolMark("unattended", "write"),
            execute: async () => {
              counts.writes++
              return { content: "written" }
            },
          })
        })
      }),
    ])
    yield* plugins.awaitActivation
    yield* seedProject
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ location: { directory: location.directory }, agent } as never)
    // The planted row: written to the session's stored rules, the column every reader of the session row reads.
    if (row.length) yield* sessions.setPermissions({ sessionID: session.id, permissions: row } as never)
    if (profile !== undefined)
      state.install(buildUnattendedLive({ seq: 1, nonce: "host-nonce", sessions: [{ sessionID: session.id, promptID: "msg_owned", agent }] }))
    const hooks = yield* PluginHooks.Service
    yield* hooks.trigger("session", "prompt", { sessionID: session.id, messageID: "msg_owned", prompt: { text: "go" }, delivery: "queue" } as never)
    const registry = yield* Tool.Service
    const snapshot = yield* registry.snapshot([allow])
    const exit = yield* snapshot
      .execute({ sessionID: session.id, agent, messageID: "msg_owned", call: { type: "tool-call", id: `call_${crypto.randomUUID()}`, name: "unattended_write", input: {} } })
      .pipe(Effect.raceFirst(Effect.sleep("5 seconds").pipe(Effect.as("waiting" as const))), Effect.exit)
    const refusal = Exit.isFailure(exit) ? String((Cause.squash(exit.cause) as Error).message) : undefined
    return { ran: Exit.isSuccess(exit) && exit.value !== "waiting", refusal, writes: counts.writes }
  })

it.live("control: in an unattended standard-tier session the tool runs when no rule denies it", () =>
  Effect.gen(function* () {
    const result = yield* call("standard", [allow], [])
    expect(result).toMatchObject({ ran: true, writes: 1 })
  }),
)

it.live("unattended standard tier: a planted session-row allow does not lift the agent's identity deny; nothing runs", () =>
  Effect.gen(function* () {
    const result = yield* call("standard", [allow, identityDeny], [{ action: IDENTITY, resource: "*", effect: "allow" }])
    expect(result.writes).toBe(0)
    expect(result.ran).toBe(false)
    expect(result.refusal).toContain("cap-hard-deny")
  }),
)

for (const profile of [undefined, "standard"] as const)
  it.live(`a session-row deny, the automation parser session's own write, still refuses the tool (${profile ?? "interactive"})`, () =>
    Effect.gen(function* () {
      const result = yield* call(profile, [allow], [identityDeny])
      expect(result.writes).toBe(0)
      expect(result.ran).toBe(false)
      expect(result.refusal).toMatch(profile === undefined ? /Permission denied: mcp:unattended:write/ : /cap-hard-deny/)
    }),
  )

const PERMISSION = "probe_action"

/**
 * One request's selection in a fresh 全部批准-tier session, with `row` planted on the session row: two plugin tools guarded only
 * by a whole-tool rule on their permission action — one offered directly, one through the Code Mode catalogue — and a call
 * of each through the selection's own tools, the path a model request takes.
 */
const select = (agentRules: Rule[], row: Rule[]) =>
  Effect.gen(function* () {
    const location = yield* Location.Service
    const plugins = yield* Plugin.Service
    const state = createUnattendedState()
    publishPolicyAccount(`session-row-${crypto.randomUUID()}`)
    const counts = { runs: 0 }
    yield* plugins.activate([
      promisePlugin("session-row-config", async (ctx: Context) => {
        await ctx.agent.transform((editor) => {
          for (const name of [...Object.keys(AUTOMATION_PROFILES), "build"]) editor.update(name, (draft) => draft.permissions.push(...agentRules))
        })
      }),
      promisePlugin("session-row-policy", async (ctx: Context) => {
        const policy = await registerPolicy(ctx, state, () => undefined)
        await policy.seal()
      }),
      promisePlugin("session-row-probe", async (ctx: Context) => {
        await ctx.tool.transform((editor) => {
          for (const [name, codemode] of [["probe_direct", false], ["probe_catalogue", true]] as const)
            editor.add({
              name,
              description: "plugin tool guarded only by a whole-tool rule on its permission action",
              input: { type: "object", properties: {} },
              options: { codemode, permission: PERMISSION },
              execute: async () => {
                counts.runs++
                return { content: "ran" }
              },
            })
        })
      }),
    ])
    yield* plugins.awaitActivation
    yield* seedProject
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ location: { directory: location.directory }, agent: "build" } as never)
    if (row.length) yield* sessions.setPermissions({ sessionID: session.id, permissions: row } as never)
    const hooks = yield* PluginHooks.Service
    yield* hooks.trigger("session", "prompt", { sessionID: session.id, messageID: "msg_1", prompt: { text: "go" }, delivery: "queue" } as never)
    const context = yield* SessionContext.Service
    const selection = yield* context.select(session.id)
    const run = (name: string, input: unknown) =>
      selection.tools
        .execute({ sessionID: session.id, agent: "build", messageID: "msg_1", call: { type: "tool-call", id: `call_${crypto.randomUUID()}`, name, input } })
        .pipe(Effect.exit)
    yield* run("probe_direct", {})
    yield* run("execute", { code: "return await tools.probe_catalogue({})" })
    return {
      direct: selection.tools.definitions.some((definition: { name: string }) => definition.name === "probe_direct"),
      catalogue: JSON.stringify(selection.tools.codeModeCatalog ?? {}).includes("probe_catalogue"),
      runs: counts.runs,
    }
  })

it.live("control: with no rule against it, the plugin tool is in the request, directly and in the Code Mode catalogue, and runs", () =>
  Effect.gen(function* () {
    expect(yield* select([allow], [])).toEqual({ direct: true, catalogue: true, runs: 2 })
  }),
)

it.live("a planted session-row allow does not bring back a plugin tool the agent denies by its permission action: absent from the request and the Code Mode catalogue, it cannot run", () =>
  Effect.gen(function* () {
    const deny: Rule = { action: PERMISSION, resource: "*", effect: "deny" }
    expect(yield* select([allow, deny], [{ action: PERMISSION, resource: "*", effect: "allow" }])).toEqual({ direct: false, catalogue: false, runs: 0 })
  }),
)

it.live("a session-row deny on a plugin tool's permission action, the product's own kind of row write, still takes it out of the request", () =>
  Effect.gen(function* () {
    expect(yield* select([allow], [{ action: PERMISSION, resource: "*", effect: "deny" }])).toEqual({ direct: false, catalogue: false, runs: 0 })
  }),
)
