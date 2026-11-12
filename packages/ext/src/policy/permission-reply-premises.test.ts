// #1662 L4 ruling item 1 (adr033 decision receipt): measurements of the OpenCode 2 permission engine that decide
// whether Code Puppy's receipt contract can be derived in the L6 adapter instead of re-taking the kernel. They stay as
// premise pins: the adapter spec (docs/architecture/2026-11-09-1662-permission-reply-measurements.md) is only correct
// while these hold, so an upstream change that breaks one turns this file red.
//   (i)   a pending request's payload cannot change under its id;
//   (ii)  one reply emits a `permission.replied` event for every request it resolves (always / reject cascades);
//   (iii) a second reply to the same id is NotFound (the kernel keeps no reply history).
import { beforeAll, describe, expect } from "bun:test"
import { Bus, E, isolate, it, Location, Permission, Plugin, promisePlugin, seedProject, Session } from "./policy-host.cases"

beforeAll(isolate)
const { Effect, Exit, Cause, Fiber } = E

type Rule = { action: string; resource: string; effect: "allow" | "deny" | "ask" }

const engine = (rules: Rule[]) =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    yield* plugins.activate([
      promisePlugin("config-agents", async (ctx: any) => {
        await ctx.agent.transform((editor: any) => editor.update("build", (agent: any) => agent.permissions.push(...rules)))
      }),
    ])
    yield* plugins.awaitActivation
    yield* seedProject
    const location = yield* Location.Service
    const sessions = yield* Session.Service
    const a = yield* sessions.create({ location: { directory: location.directory }, agent: "build" } as never)
    const b = yield* sessions.create({ location: { directory: location.directory }, agent: "build" } as never)
    const replied: { requestID: string; reply: string; sessionID: string }[] = []
    const bus = yield* Bus.Service
    const unsubscribe = yield* bus.listen((event: any) => {
      if (event.type === Permission.Event.Replied.type) replied.push(event.data)
      return Effect.void
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    return { permission: yield* Permission.Service, a: a.id, b: b.id, replied }
  })

const ASK_EDIT: Rule[] = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "edit", resource: "*", effect: "ask" },
  { action: "shell", resource: "*", effect: "ask" },
]

const awaitPending = (count: number) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    for (let i = 0; i < 200; i += 1) {
      const list = yield* permission.list()
      if (list.length >= count) return list
      yield* Effect.sleep("10 millis")
    }
    return yield* permission.list()
  })

describe("OpenCode 2 permission reply premises (adr033 receipt derivation)", () => {
  it.live("(i) a pending request's payload never changes under its id: a second admission with the same id is refused", () =>
    Effect.gen(function* () {
      const { permission, a } = yield* engine(ASK_EDIT)
      const id = Permission.ID.create()
      const first = yield* Effect.forkChild(
        permission.assert({ id, sessionID: a, agent: "build", action: "edit", resources: ["src/a.ts"], save: ["src/*"], metadata: { file: "a" } }),
      )
      const [pending] = yield* awaitPending(1)
      expect(pending?.id).toBe(id)
      const second = yield* permission
        .assert({ id, sessionID: a, agent: "build", action: "edit", resources: ["src/OTHER.ts"], save: [], metadata: { file: "other" } })
        .pipe(Effect.exit)
      expect(Exit.isFailure(second) && String(Cause.squash(second.cause))).toContain("Duplicate pending permission ID")
      const now = yield* permission.get(id)
      expect(now).toMatchObject({ id, resources: ["src/a.ts"], metadata: { file: "a" } })
      yield* permission.reply({ requestID: id, reply: "reject" })
      yield* Fiber.await(first)
    }),
  )

  it.live("(ii) one always reply emits a replied event for every request it resolves, and only those", () =>
    Effect.gen(function* () {
      const { permission, a, b, replied } = yield* engine(ASK_EDIT)
      const ask = (sessionID: string, action: string, resource: string) =>
        Effect.forkChild(permission.assert({ sessionID, agent: "build", action, resources: [resource], save: ["src/*"], metadata: {} }))
      const f1 = yield* ask(a, "edit", "src/one.ts")
      yield* awaitPending(1)
      const f2 = yield* ask(b, "edit", "src/two.ts")
      yield* awaitPending(2)
      const f3 = yield* ask(a, "shell", "ls")
      const list = yield* awaitPending(3)
      const one = list.find((request: any) => request.resources[0] === "src/one.ts")!
      const two = list.find((request: any) => request.resources[0] === "src/two.ts")!
      const shell = list.find((request: any) => request.action === "shell")!
      yield* permission.reply({ requestID: one.id, reply: "always" })
      yield* Fiber.join(f1)
      yield* Fiber.join(f2)
      expect(replied.filter((event) => event.reply === "always").map((event) => event.requestID).sort()).toEqual([one.id, two.id].sort())
      expect(replied.some((event) => event.requestID === shell.id)).toBe(false)
      expect((yield* permission.list()).map((request: any) => request.id)).toEqual([shell.id])
      yield* permission.reply({ requestID: shell.id, reply: "reject" })
      yield* Fiber.await(f3)
    }),
  )

  it.live("(ii) a reject cascades to every pending request of the same session, each with its own replied event", () =>
    Effect.gen(function* () {
      const { permission, a, b, replied } = yield* engine(ASK_EDIT)
      const f1 = yield* Effect.forkChild(permission.assert({ sessionID: a, agent: "build", action: "edit", resources: ["src/x.ts"], save: [], metadata: {} }))
      yield* awaitPending(1)
      const f2 = yield* Effect.forkChild(permission.assert({ sessionID: a, agent: "build", action: "shell", resources: ["ls"], save: [], metadata: {} }))
      yield* awaitPending(2)
      const f3 = yield* Effect.forkChild(permission.assert({ sessionID: b, agent: "build", action: "shell", resources: ["pwd"], save: [], metadata: {} }))
      const list = yield* awaitPending(3)
      const target = list.find((request: any) => request.resources[0] === "src/x.ts")!
      yield* permission.reply({ requestID: target.id, reply: "reject" })
      yield* Fiber.await(f1)
      yield* Fiber.await(f2)
      const rejected = replied.filter((event) => event.reply === "reject")
      expect(rejected.map((event) => event.sessionID)).toEqual([a, a])
      expect(rejected.map((event) => event.requestID)).toContain(target.id)
      expect((yield* permission.list()).map((request: any) => request.sessionID)).toEqual([b])
      const other = (yield* permission.list())[0]!
      yield* permission.reply({ requestID: other.id, reply: "reject" })
      yield* Fiber.await(f3)
    }),
  )

  // Review R1 #7: the receipt window (docs/architecture/2026-11-09-1662-permission-reply-measurements.md rule 3) depends on
  // the order of one reply's replied events. Measured: the target first, then the cascade — so a window that stops at
  // the target's own event holds only the target, and the receipt must keep collecting until the cascade has arrived.
  for (const reply of ["always", "reject"] as const)
    it.live(`(ii) one ${reply} reply publishes the target's replied event first, then the cascaded ones`, () =>
      Effect.gen(function* () {
        const { permission, a, b, replied } = yield* engine(ASK_EDIT)
        const ask = (sessionID: string, action: string, resource: string) =>
          Effect.forkChild(permission.assert({ sessionID, agent: "build", action, resources: [resource], save: ["src/*"], metadata: {} }))
        const fibers = [yield* ask(a, "edit", "src/target.ts")]
        yield* awaitPending(1)
        // always cascades to the same pattern in any session; reject to every pending request of the same session.
        fibers.push(reply === "always" ? yield* ask(b, "edit", "src/cascade.ts") : yield* ask(a, "shell", "ls"))
        const list = yield* awaitPending(2)
        const target = list.find((request: any) => request.resources[0] === "src/target.ts")!
        const cascade = list.find((request: any) => request.id !== target.id)!
        yield* permission.reply({ requestID: target.id, reply })
        for (const fiber of fibers) yield* Fiber.await(fiber)
        const events = replied.filter((event) => event.reply === reply).map((event) => event.requestID)
        expect(events).toEqual([target.id, cascade.id])
        // The earlier spec text's window (sending → the target's own event) would have dropped the cascade.
        expect(events.slice(0, events.indexOf(target.id) + 1)).toEqual([target.id])
      }),
    )

  it.live("(iii) a second reply to the same id is NotFound: the engine keeps no reply history", () =>
    Effect.gen(function* () {
      const { permission, a } = yield* engine(ASK_EDIT)
      const fiber = yield* Effect.forkChild(permission.assert({ sessionID: a, agent: "build", action: "edit", resources: ["src/y.ts"], save: [], metadata: {} }))
      const [request] = yield* awaitPending(1)
      yield* permission.reply({ requestID: request!.id, reply: "once" })
      yield* Fiber.join(fiber)
      const again = yield* permission.reply({ requestID: request!.id, reply: "once" }).pipe(Effect.exit)
      expect(Exit.isFailure(again) && (Cause.squash(again.cause) as { _tag?: string })._tag).toBe("Permission.NotFoundError")
    }),
  )
})
