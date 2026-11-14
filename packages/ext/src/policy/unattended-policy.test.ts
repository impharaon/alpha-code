// #1699:真实权限服务、Promise 适配器与执行链;逻辑时钟不前进,Asked 事件与结局竞争。
import { beforeAll, expect } from "bun:test"
import path from "node:path"
import type { Context } from "@opencode/plugin/promise/plugin"
import { AUTOMATION_PROFILES, UNATTENDED_DENIAL_KEY, type UnattendedProfile } from "../../../schema/src/codepuppy-unattended"
import { buildUnattendedLive } from "../../../ui-mac/src/main/codepuppy-sidecar-messages"
import { registerPolicy } from "./index"
import { createUnattendedState } from "./unattended"
import { createToolPolicyStore, defaultPolicyBaseDir } from "./resolver"
import { Bus, E, isolate, it, Location, Permission, Plugin, PluginHooks, promisePlugin, ROOT, seedProject, Session, Tool, mcpToolMark } from "./policy-host.cases"

const { Effect, Exit, Cause, Deferred, Fiber } = E
beforeAll(isolate)
const allow = { action: "*", resource: "*", effect: "allow" as const }

const setup = (selected: UnattendedProfile | undefined, options: { ask?: boolean; disabled?: boolean; changed?: boolean; sessionAsk?: boolean; laterAsk?: boolean; fixedDeny?: boolean } = {}) =>
  Effect.gen(function* () {
    const location = yield* Location.Service
    const plugins = yield* Plugin.Service
    const state = createUnattendedState()
    const account = `unattended-${crypto.randomUUID()}`
    process.env.CODEPUPPY_POLICY_ACCOUNT = account
    const agent = Object.entries(AUTOMATION_PROFILES).find(([, profile]) => profile === selected)?.[0] ?? "build"
    const counts = { writes: 0 }
    yield* plugins.activate([
      promisePlugin("unattended-config", async (ctx: Context) => {
        await ctx.agent.transform((editor) => {
          for (const name of [...Object.keys(AUTOMATION_PROFILES), "build"])
            editor.update(name, (draft) => draft.permissions.push(allow))
        })
        await ctx.mcp.transform((editor) => editor.set("unattended", { type: "remote", url: "http://127.0.0.1:1/mcp" }))
      }),
      promisePlugin("unattended-policy", async (ctx: Context) => {
        const policy = await registerPolicy(ctx, state)
        await policy.seal()
      }),
      promisePlugin("unattended-mcp", async (ctx: Context) => {
        await ctx.tool.transform((editor) => {
          for (const name of ["write", "code_write"]) editor.add({
            name, description: "真实副作用计数", input: { type: "object", properties: {} },
            options: { namespace: "unattended", codemode: name === "code_write" },
            ...mcpToolMark("unattended", name),
            execute: async () => { counts.writes++; return { content: "written" } },
          })
        })
        if (options.laterAsk) await ctx.permission.hook("evaluate", (event) => { if (event.action === "later-ask") event.effect = "ask" })
      }),
    ])
    yield* plugins.awaitActivation
    yield* seedProject
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ location: { directory: location.directory }, agent,
      ...(options.sessionAsk ? { permissions: [{ action: "mcp:unattended:write", resource: "*", effect: "ask" }] } : {}),
      ...(options.fixedDeny ? { permissions: ["read", "subagent", "external_directory"].map((action) => ({ action, resource: "*", effect: "deny" })) } : {}),
    } as never)
    const store = createToolPolicyStore({ baseDir: defaultPolicyBaseDir(path.join(ROOT, "data", "opencode")), account: () => account, workspace: () => location.directory })
    if (options.ask || options.disabled || options.changed) yield* Effect.promise(() => store.setRecord({
      selector: { level: "service", source: "mcp", origin: "unattended" },
      state: options.disabled ? "disabled" : options.changed ? "enabled" : "ask",
      ...(options.changed ? { bindingDigest: `sha256:${"0".repeat(64)}` } : {}),
    }))
    if (selected !== undefined) state.install(buildUnattendedLive({ seq: 1, nonce: "host-nonce", sessions: [{ sessionID: session.id, promptID: "msg_owned", ...(selected === "none" ? {} : { agent }) }] }))
    const hooks = yield* PluginHooks.Service
    yield* hooks.trigger("session", "prompt", { sessionID: session.id, messageID: "msg_owned", prompt: { text: "go" }, delivery: "queue" } as never)
    const asked = yield* Deferred.make()
    const bus = yield* Bus.Service
    const unsubscribe = yield* bus.listen((event: { type: string }) => event.type === "permission.asked" ? Deferred.succeed(asked, "asked").pipe(Effect.asVoid) : Effect.void)
    yield* Effect.addFinalizer(() => unsubscribe)
    const registry = yield* Tool.Service
    const snapshot = yield* registry.snapshot([allow])
    const execute = (name = "unattended_write", input: unknown = {}) => snapshot.execute({
      sessionID: session.id, agent, messageID: "msg_owned",
      call: { type: "tool-call", id: `call_${crypto.randomUUID()}`, name, input },
    }).pipe(Effect.exit)
    const immediate = (operation = execute()) => Effect.raceFirst(operation, Deferred.await(asked))
    return { session, agent, counts, execute, immediate, store, snapshot, state, asked }
  })

for (const ask of [false, true]) it.effect(`标准档${ask ? "每次询问" : "默认询问"}的 MCP 工具直接执行,零 Asked`, () =>
  Effect.gen(function* () {
    const host = yield* setup("standard", { ask })
    const result = yield* host.immediate()
    expect(result).not.toBe("asked")
    expect(Exit.isSuccess(result)).toBe(true)
    expect(host.counts.writes).toBe(1)
    const permission = yield* Permission.Service
    expect(yield* permission.list()).toEqual([])
  }),
)

for (const item of [
  { profile: "readonly" as const, options: {}, reason: "readonly" },
  { profile: "readonly" as const, options: { ask: true }, reason: "readonly" },
  { profile: "standard" as const, options: { disabled: true }, reason: "needs-confirmation" },
  { profile: "standard" as const, options: { changed: true }, reason: "needs-confirmation" },
  { profile: "standard" as const, options: { sessionAsk: true }, reason: "refused" },
  { profile: "none" as const, options: { ask: true }, reason: "refused" },
]) it.effect(`${item.profile} ${JSON.stringify(item.options)} 立即具名拒绝,没有计时器推进或副作用`, () =>
  Effect.gen(function* () {
    const host = yield* setup(item.profile, item.options)
    const result = yield* host.immediate()
    expect(result).not.toBe("asked")
    expect(Exit.isFailure(result)).toBe(true)
    const failure = Cause.squash(result.cause) as InstanceType<typeof Tool.Error>
    expect(failure.metadata?.[UNATTENDED_DENIAL_KEY]).toMatchObject({ version: 1, reason: item.reason, tool: "write" })
    expect(host.counts.writes).toBe(0)
  }),
)

it.effect("none 档初值 allow 被后续钩子改 ask 仍立即拒绝,无工具调用的断言同样不等人", () =>
  Effect.gen(function* () {
    const host = yield* setup("none", { laterAsk: true })
    const permission = yield* Permission.Service
    const result = yield* host.immediate(permission.assert({ sessionID: host.session.id, action: "later-ask", resources: ["*"], save: [], metadata: {} }).pipe(Effect.exit))
    expect(result).not.toBe("asked")
    expect(Exit.isFailure(result)).toBe(true)
    expect(yield* permission.list()).toEqual([])
  }),
)

it.effect("Code Mode 子调用的第一条拒绝补在外层成功终态上", () =>
  Effect.gen(function* () {
    const host = yield* setup("readonly")
    const result = yield* host.immediate(host.execute("execute", { code: "return await tools.unattended.code_write({})" }))
    expect(result).not.toBe("asked")
    expect(Exit.isSuccess(result)).toBe(true)
    expect(result.value.metadata?.[UNATTENDED_DENIAL_KEY]).toMatchObject({ reason: "readonly", tool: "code_write" })
    expect(host.counts.writes).toBe(0)
  }),
)

it.effect("未登记的询问档产生 Asked 并保持等待,人工批准后才执行", () =>
  Effect.gen(function* () {
    const host = yield* setup(undefined, { ask: true })
    const fiber = yield* Effect.forkChild(host.execute())
    yield* Deferred.await(host.asked)
    expect(host.counts.writes).toBe(0)
    const permission = yield* Permission.Service
    const [request] = yield* permission.list()
    expect(request.action).toBe("mcp:unattended:write")
    yield* permission.reply({ requestID: request.id, reply: "once" })
    expect(Exit.isSuccess(yield* Fiber.join(fiber))).toBe(true)
    expect(host.counts.writes).toBe(1)
  }),
)

it.effect("外来输入退出后旧快照不能重新授予自动化语义", () =>
  Effect.gen(function* () {
    const host = yield* setup("standard", { ask: true })
    host.state.preparePrompt({ sessionID: host.session.id, messageID: "msg_foreign" })
    host.state.install(buildUnattendedLive({ seq: 2, nonce: "next", sessions: [{ sessionID: host.session.id, agent: host.agent, promptID: "msg_owned" }] }))
    const result = yield* host.immediate()
    expect(result).toBe("asked")
    const permission = yield* Permission.Service
    const [request] = yield* permission.list()
    yield* permission.reply({ requestID: request.id, reply: "reject" })
    expect(host.counts.writes).toBe(0)
  }),
)

it.effect("只读档已启用工具照旧执行;配置 deny 在不推进时钟时拒绝", () =>
  Effect.gen(function* () {
    const readonly = yield* setup("readonly")
    yield* Effect.promise(() => readonly.store.setRecord({ selector: { level: "class", class: "third-party-mcp" }, state: "enabled" }))
    expect(Exit.isSuccess(yield* readonly.immediate())).toBe(true)
    expect(readonly.counts.writes).toBe(1)
  }),
)

it.effect("AC-04 配置禁止的读文件、子任务和项目外目录无计时等待", () =>
  Effect.gen(function* () {
    const host = yield* setup("standard", { fixedDeny: true })
    const permission = yield* Permission.Service
    for (const [action, resource] of [["read", ".env"], ["subagent", "general"], ["external_directory", "/outside/*"]]) {
      const result = yield* host.immediate(permission.assert({ sessionID: host.session.id, action, resources: [resource], save: [], metadata: {} }).pipe(Effect.exit))
      expect(result).not.toBe("asked")
      expect(Exit.isFailure(result)).toBe(true)
    }
    expect(host.counts.writes).toBe(0)
  }),
)
