// INT-safety I-13 / SPEC-engine-config-fence BR-02 (DESIGN-engine-config-fence §4.6 L2, D16): of the session row's rules only
// `deny` entries take part — at every read of the row. The engine database is writable from inside the fence, so the row
// can be planted. This file covers the extension's read: `ruleset()` in index.ts hands the gate "agent rules + session-row
// rules", and an unattended run that the gate allows never reaches the engine's own decision (gate.ts `confirm`), so a
// planted session-row allow there would beat an agent's identity deny on its own. The engine's read is
// packages/core/test/codepuppy-engine-db-records.test.ts.
// Harness: the production permission service, Promise adapter and execution chain (policy-host.cases.ts), as
// unattended-policy.test.ts uses it. The tool is plugin-registered with the MCP layer's mark (the ext gives it an MCP
// identity) and its executor makes no engine permission call, so the outcome is the extension's decision.
import { beforeAll, expect } from "bun:test"
import type { Context } from "@opencode/plugin/promise/plugin"
import { AUTOMATION_PROFILES, type UnattendedProfile } from "../../../schema/src/codepuppy-unattended"
import { buildUnattendedLive } from "../../../ui-mac/src/main/codepuppy-sidecar-messages"
import { registerPolicy } from "./index"
import { createUnattendedState } from "./unattended"
import { E, isolate, it, Location, Plugin, PluginHooks, promisePlugin, publishPolicyAccount, seedProject, Session, Tool, mcpToolMark } from "./policy-host.cases"

const { Effect, Exit, Cause } = E
beforeAll(isolate)

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
