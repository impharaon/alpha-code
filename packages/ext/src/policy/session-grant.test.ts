// I-05 contract A (design upgrade-fewer-takeovers §4): "allow for this session" lives in the re-taken
// packages/core/src/permission.ts (`codepuppy(#1128 §4.4, I-05)` block) and behaves as in the current release 0.1.26:
// an `always` reply grants (action, each `save` item) to that session only, in memory; a configured deny still wins;
// another session and a child session created later still ask; nothing is written to the session row or to the
// project's saved approvals; and the reply's cascade releases only pending requests of the same session.
// Production permission engine, sessions, agents and plugin hooks in the isolated host (policy-host.cases.ts). The
// restart half of invariant 4 is session-grant-restart.test.ts; invariant 6 is register-policy.test.ts E6.
import { beforeAll, describe, expect } from "bun:test"
import { Bus, E, isolate, it, Location, Permission, PermissionSaved, Plugin, promisePlugin, seedProject, Session } from "./policy-host.cases"

beforeAll(isolate)
const { Effect, Fiber } = E

type Rule = { action: string; resource: string; effect: "allow" | "deny" | "ask" }
const READ_ASKS: Rule[] = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "read", resource: "*", effect: "ask" },
  { action: "edit", resource: "*", effect: "ask" },
]

/** Sessions whose requests a later plugin's evaluate hook turns from ask into allow (review R1 #2: "now evaluates to allow"). */
const flipped = new Set<string>()

const engine = (rules: Rule[]) =>
  Effect.gen(function* () {
    flipped.clear()
    const plugins = yield* Plugin.Service
    yield* plugins.activate([
      promisePlugin("config-agents", async (ctx: any) => {
        await ctx.agent.transform((editor: any) => editor.update("build", (agent: any) => agent.permissions.push(...rules)))
      }),
      promisePlugin("flip-evaluate", async (ctx: any) => {
        await ctx.permission.hook("evaluate", async (event: any) => {
          if (flipped.has(event.sessionID) && event.effect === "ask") event.effect = "allow"
        })
      }),
    ])
    yield* plugins.awaitActivation
    yield* seedProject
    const location = yield* Location.Service
    const sessions = yield* Session.Service
    const create = () => sessions.create({ location: { directory: location.directory }, agent: "build" } as never)
    const a = (yield* create()).id as string
    const b = (yield* create()).id as string
    const replied: { requestID: string; reply: string; sessionID: string }[] = []
    const unsubscribe = yield* (yield* Bus.Service).listen((event: any) => {
      if (event.type === Permission.Event.Replied.type) replied.push(event.data)
      return Effect.void
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    const permission = yield* Permission.Service
    /** A tool call's request: waits for the reply. */
    const pend = (sessionID: string, action: string, resource: string, save: string[]) =>
      Effect.forkChild(permission.assert({ sessionID, agent: "build", action, resources: [resource], save, metadata: {} }))
    /** What the engine decides for a request right now (an ask leaves a pending request behind, unanswered). */
    const effect = (sessionID: string, action: string, resource: string) =>
      Effect.map(permission.ask({ sessionID, agent: "build", action, resources: [resource], save: [], metadata: {} }), (result: any) => result.effect)
    const pendingFor = (sessionID: string, resource: string) =>
      Effect.gen(function* () {
        for (let i = 0; i < 200; i += 1) {
          const found = (yield* permission.list()).find((request: any) => request.sessionID === sessionID && request.resources[0] === resource)
          if (found) return found
          yield* Effect.sleep("10 millis")
        }
        throw new Error(`no pending request for ${resource} in ${sessionID}`)
      })
    /** Asks in `sessionID`, replies `always` to it, and waits for the call to go on. */
    const grant = (sessionID: string, action: string, resource: string, save: string[]) =>
      Effect.gen(function* () {
        const fiber = yield* pend(sessionID, action, resource, save)
        const request = yield* pendingFor(sessionID, resource)
        yield* permission.reply({ requestID: request.id, reply: "always" })
        yield* Fiber.join(fiber)
        return request
      })
    return { permission, sessions, a, b, replied, pend, effect, pendingFor, grant }
  })

describe("[packages/core/src/permission.ts codepuppy(I-05)] allow for this session: a session-scoped, in-memory grant", () => {
  it.live("an always reply grants the request's save patterns for its action in this session; a resource outside them and another action still ask", () =>
    Effect.gen(function* () {
      const { a, effect, grant } = yield* engine(READ_ASKS)
      yield* grant(a, "read", "src/a.ts", ["src/*"])
      expect(yield* effect(a, "read", "src/a.ts")).toBe("allow")
      expect(yield* effect(a, "read", "src/b.ts")).toBe("allow")
      expect(yield* effect(a, "read", "lib/c.ts")).toBe("ask")
      expect(yield* effect(a, "edit", "src/b.ts")).toBe("ask")
    }),
  )

  it.live("an always reply to a request without save grants nothing: the same request asks again", () =>
    Effect.gen(function* () {
      const { a, effect, grant } = yield* engine(READ_ASKS)
      yield* grant(a, "read", "src/a.ts", [])
      expect(yield* effect(a, "read", "src/a.ts")).toBe("ask")
    }),
  )

  it.live("a configured deny outranks the grant; the same allow written as a session rule overrides it (known-bad arm)", () =>
    Effect.gen(function* () {
      const { a, b, sessions, effect, grant } = yield* engine([...READ_ASKS, { action: "read", resource: "secret/*", effect: "deny" }])
      yield* grant(a, "read", "notes.md", ["*"])
      expect(yield* effect(a, "read", "other.md")).toBe("allow")
      expect(yield* effect(a, "read", "secret/key")).toBe("deny")
      // Known bad (the engine-branch adapter's shape, design F-02): session rules merge after the agent's, so the
      // same allow kept there beats the configured deny.
      yield* sessions.setPermissions({ sessionID: b, permissions: [{ action: "read", resource: "*", effect: "allow" }] } as never)
      expect(yield* effect(b, "read", "secret/key")).toBe("allow")
    }),
  )

  it.live("another session and a child session created after the grant still ask; a session rule is inherited by that child (known-bad arm)", () =>
    Effect.gen(function* () {
      const { a, b, sessions, effect, grant } = yield* engine(READ_ASKS)
      yield* grant(a, "read", "notes.md", ["*"])
      expect(yield* effect(a, "read", "notes.md")).toBe("allow")
      expect(yield* effect(b, "read", "notes.md")).toBe("ask")
      const child = (yield* sessions.create({ parentID: a, agent: "build" } as never)).id as string
      expect(yield* effect(child, "read", "notes.md")).toBe("ask")
      // Known bad: a grant kept as a session rule is copied into every child created afterwards (core session.ts create).
      yield* sessions.setPermissions({ sessionID: b, permissions: [{ action: "read", resource: "*", effect: "allow" }] } as never)
      const inheriting = (yield* sessions.create({ parentID: b, agent: "build" } as never)).id as string
      expect(yield* effect(inheriting, "read", "notes.md")).toBe("allow")
    }),
  )

  it.live("the grant writes neither the session's rules nor a saved approval", () =>
    Effect.gen(function* () {
      const { a, sessions, grant } = yield* engine(READ_ASKS)
      yield* grant(a, "read", "notes.md", ["*"])
      expect((yield* sessions.get(a)).permissions ?? []).toEqual([])
      expect(yield* (yield* PermissionSaved.Service).list()).toEqual([])
    }),
  )

  it.live("the always cascade leaves another session's pending request pending even when it now evaluates to allow", () =>
    Effect.gen(function* () {
      const { permission, a, b, replied, pend, pendingFor, grant } = yield* engine(READ_ASKS)
      const waiting = yield* pend(b, "read", "other.md", ["*"])
      const other = yield* pendingFor(b, "other.md")
      flipped.add(b)
      // Premise: re-evaluated now, B's request is allowed — so only the cascade's session filter keeps it pending.
      expect(yield* permission.allows({ sessionID: b, agent: "build", action: "read", resources: ["other.md"] })).toBe(true)
      const target = yield* grant(a, "read", "notes.md", ["*"])
      expect((yield* permission.list()).map((request: any) => request.id)).toContain(other.id)
      expect(replied.map((event) => event.requestID)).toEqual([target.id])
      yield* permission.reply({ requestID: other.id, reply: "reject" })
      yield* Fiber.await(waiting)
    }),
  )
})
