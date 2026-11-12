// ADR-038 (#668) on OpenCode 2 — ruling item 2: the re-taken packages/core/src/permission.ts bounds the wait for an
// approval reply. At the deadline only that request ends (no cascade to the session's other pending requests), its
// card is retracted with a replied event, and the call fails by name — it is never allowed. Runs the production
// permission engine in the isolated host (policy-host.cases.ts).
import { beforeAll, describe, expect, test } from "bun:test"
import { Bus, E, isolate, it, Location, Permission, Plugin, promisePlugin, seedProject, Session } from "./policy-host.cases"

beforeAll(isolate)
const { Effect, Exit, Cause, Fiber } = E
const QuestionTool = (await import(`${import.meta.dir}/../../../core/src/tool/plugin/question.ts`)).QuestionTool

const ENV = "CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS"

const engine = Effect.gen(function* () {
  const plugins = yield* Plugin.Service
  yield* plugins.activate([
    promisePlugin("config-agents", async (ctx: any) => {
      await ctx.agent.transform((editor: any) =>
        editor.update("build", (agent: any) =>
          agent.permissions.push({ action: "*", resource: "*", effect: "allow" }, { action: "edit", resource: "*", effect: "ask" }),
        ),
      )
    }),
  ])
  yield* plugins.awaitActivation
  yield* seedProject
  const location = yield* Location.Service
  const session = yield* (yield* Session.Service).create({ location: { directory: location.directory }, agent: "build" } as never)
  const replied: { requestID: string; reply: string }[] = []
  const unsubscribe = yield* (yield* Bus.Service).listen((event: any) => {
    if (event.type === Permission.Event.Replied.type) replied.push(event.data)
    return Effect.void
  })
  yield* Effect.addFinalizer(() => unsubscribe)
  return { permission: yield* Permission.Service, sessionID: session.id, replied }
})

const ask = (permission: any, sessionID: string, file: string, timeoutMs: number) =>
  Effect.gen(function* () {
    process.env[ENV] = String(timeoutMs)
    const fiber = yield* Effect.forkChild(
      permission.assert({ sessionID, agent: "build", action: "edit", resources: [file], save: [], metadata: {} }),
    )
    for (let i = 0; i < 100 && !(yield* permission.list()).some((request: any) => request.resources[0] === file); i += 1)
      yield* Effect.sleep("5 millis")
    return fiber
  })

describe("ADR-038 approval deadline on OpenCode 2", () => {
  it.live("an unanswered request fails by name at the deadline, its card is retracted, and nothing is allowed", () =>
    Effect.gen(function* () {
      const { permission, sessionID, replied } = yield* engine
      const fiber = yield* ask(permission, sessionID, "src/late.ts", 150)
      const [request] = yield* permission.list()
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(false)
      const failure = Cause.squash((exit as any).cause) as Error
      expect(failure).toBeInstanceOf(QuestionTool.CancelledError)
      expect(failure.message).toContain("本次操作**没有**被放行")
      expect(failure.message).toContain("src/late.ts")
      expect(replied).toEqual([{ sessionID, requestID: request.id, reply: "reject" }])
      expect(yield* permission.list()).toEqual([])
    }),
  )

  it.live("only that request ends: another pending request of the same session is still waiting (no cascade)", () =>
    Effect.gen(function* () {
      const { permission, sessionID, replied } = yield* engine
      const short = yield* ask(permission, sessionID, "src/short.ts", 150)
      const long = yield* ask(permission, sessionID, "src/long.ts", 60_000)
      expect(Exit.isSuccess(yield* Fiber.await(short))).toBe(false)
      const left = yield* permission.list()
      expect(left.map((request: any) => request.resources[0])).toEqual(["src/long.ts"])
      expect(replied.map((event) => event.reply)).toEqual(["reject"])
      yield* permission.reply({ requestID: left[0].id, reply: "once" })
      expect(Exit.isSuccess(yield* Fiber.await(long))).toBe(true)
    }),
  )

  it.live("an answer before the deadline wins", () =>
    Effect.gen(function* () {
      const { permission, sessionID } = yield* engine
      const fiber = yield* ask(permission, sessionID, "src/answered.ts", 5_000)
      const [request] = yield* permission.list()
      yield* permission.reply({ requestID: request.id, reply: "once" })
      expect(Exit.isSuccess(yield* Fiber.await(fiber))).toBe(true)
    }),
  )

  test("the default is 300 s and every invalid override falls back to it, never to no deadline", () => {
    const { askTimeoutMs, ASK_TIMEOUT_MS_DEFAULT } = Permission
    expect(ASK_TIMEOUT_MS_DEFAULT).toBe(300_000)
    expect(askTimeoutMs({})).toBe(300_000)
    expect(askTimeoutMs({ [ENV]: "1500" })).toBe(1500)
    for (const bad of ["", "0", "-5", "abc", "1.5", "Infinity", "1e400"]) expect(askTimeoutMs({ [ENV]: bad })).toBe(300_000)
  })

  test("the deadline failure takes the session runner's dismissal path, so the step ends with this message", () => {
    const failure = Permission.unansweredError({ action: "edit", resources: ["a"], timeoutMs: 300_000 })
    // step.ts writes a QuestionTool.CancelledError's message on the tool call; model-request recovers it as a decline.
    expect(failure._tag).toBe("QuestionTool.CancelledError")
    expect(failure).toBeInstanceOf(QuestionTool.CancelledError)
    expect(failure.message).toContain("审批请求等待 300 秒无人应答")
  })
})
