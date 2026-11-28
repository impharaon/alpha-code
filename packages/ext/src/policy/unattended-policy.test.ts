// #1699:真实权限服务、Promise 适配器与执行链;逻辑时钟不前进,Asked 事件与结局竞争。
import { canonicalJsonDigest } from "./store"
import { expect } from "bun:test"
import path from "node:path"
import type { Context } from "@opencode/plugin/promise/plugin"
import {
  AUTOMATION_PROFILES,
  UNATTENDED_DENIAL_KEY,
  type UnattendedProfile,
} from "../../../schema/src/codepuppy-unattended"
import { buildUnattendedLive } from "../../../ui-mac/src/main/codepuppy-sidecar-messages"
import { registerPolicy } from "./index"
import { createUnattendedState } from "./unattended"
import { createToolPolicyStore, defaultPolicyBaseDir, mcpBindingEvidence } from "./resolver"
import * as sourceGate from "./gate"
import { separatelyBundledExtPolicy } from "../engine-runtime.harness"
import { toSessionError } from "../../../core/src/session/to-session-error"
import {
  Bus,
  E,
  isolate,
  it,
  Location,
  Permission,
  Plugin,
  PluginHooks,
  promisePlugin,
  publishPolicyAccount,
  ROOT,
  seedProject,
  Session,
  Tool,
  mcpToolMark,
} from "./policy-host.cases"

const { Effect, Exit, Cause, Deferred, Fiber } = E
isolate()
const allow = { action: "*", resource: "*", effect: "allow" as const }

const setup = (
  selected: UnattendedProfile | undefined,
  options: {
    ask?: boolean
    disabled?: boolean
    changed?: boolean
    agentAsk?: boolean
    agentRawAsk?: boolean
    laterAsk?: boolean
    fixedDeny?: boolean
  } = {},
) =>
  Effect.gen(function* () {
    const location = yield* Location.Service
    const plugins = yield* Plugin.Service
    const state = createUnattendedState()
    const account = publishPolicyAccount("unattended")
    const agent = Object.entries(AUTOMATION_PROFILES).find(([, profile]) => profile === selected)?.[0] ?? "build"
    const counts = { writes: 0 }
    yield* plugins.activate([
      promisePlugin("unattended-config", async (ctx: Context) => {
        await ctx.agent.transform((editor) => {
          for (const name of [...Object.keys(AUTOMATION_PROFILES), "build"])
            editor.update(name, (draft) =>
              draft.permissions.push(
                allow,
                // A ruleset-axis ask on the tool's identity. Written by the agent's rules, not the session row: since I-13 L2
                // only a session row's deny entries take part (packages/ext/src/policy/session-row-rules.test.ts).
                ...(options.agentAsk ? [{ action: "mcp:unattended:write", resource: "*", effect: "ask" as const }] : []),
                // An ask on the raw permission action (not the identity), so the engine's first verdict is ask while the
                // ruleset axis does not ask; also on the agent's rules since I-13 L2.
                ...(options.agentRawAsk ? [{ action: "unattended_write", resource: "*", effect: "ask" as const }] : []),
              ),
            )
        })
        await ctx.mcp.transform((editor) => editor.set("unattended", { type: "remote", url: "http://127.0.0.1:1/mcp" }))
      }),
      promisePlugin("unattended-policy", async (ctx: Context) => {
        const policy = await registerPolicy(ctx, state, () => undefined)
        await policy.seal()
      }),
      promisePlugin("unattended-mcp", async (ctx: Context) => {
        await ctx.tool.transform((editor) => {
          for (const name of ["write", "code_write"])
            editor.add({
              name,
              description: "真实副作用计数",
              input: { type: "object", properties: {} },
              options: { namespace: "unattended", codemode: name === "code_write" },
              ...mcpToolMark("unattended", name),
              execute: async () => {
                counts.writes++
                return { content: "written" }
              },
            })
        })
        if (options.laterAsk)
          await ctx.permission.hook("evaluate", (event) => {
            if (event.action === "later-ask") event.effect = "ask"
          })
      }),
    ])
    yield* plugins.awaitActivation
    yield* seedProject
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      location: { directory: location.directory },
      agent,
      ...(options.fixedDeny
        ? {
            permissions: ["read", "subagent", "external_directory"].map((action) => ({
              action,
              resource: "*",
              effect: "deny",
            })),
          }
        : {}),
    } as never)
    const store = createToolPolicyStore({
      baseDir: defaultPolicyBaseDir(path.join(ROOT, "data", "opencode")),
      account: () => account,
      workspace: () => location.directory,
    })
    if (selected !== undefined)
      state.install(
        buildUnattendedLive({
          seq: 1,
          nonce: "host-nonce",
          sessions: [{ sessionID: session.id, promptID: "msg_owned", ...(selected === "none" ? {} : { agent }) }],
        }),
      )
    const hooks = yield* PluginHooks.Service
    yield* hooks.trigger("session", "prompt", {
      sessionID: session.id,
      messageID: "msg_owned",
      prompt: { text: "go" },
      delivery: "queue",
    } as never)
    const asked = yield* Deferred.make()
    const bus = yield* Bus.Service
    const unsubscribe = yield* bus.listen((event: { type: string }) =>
      event.type === "permission.asked" ? Deferred.succeed(asked, "asked").pipe(Effect.asVoid) : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const registry = yield* Tool.Service
    const snapshot = yield* registry.snapshot([allow])
    // 先拿到真实工具清单再改策略,覆盖已选出工具随后被停用的竞态。
    if (options.ask || options.disabled || options.changed)
      yield* Effect.promise(() =>
        store.setRecord({
          selector: { level: "service", source: "mcp", origin: "unattended" },
          state: options.disabled ? "disabled" : options.changed ? "enabled" : "ask",
          ...(options.changed
            ? {
                bindingDigest: canonicalJsonDigest(
                  mcpBindingEvidence("unattended", { type: "remote", url: "http://127.0.0.1:2/mcp" }),
                ),
              }
            : {}),
        }),
      )
    const execute = (name = "unattended_write", input: unknown = {}) =>
      snapshot
        .execute({
          sessionID: session.id,
          agent,
          messageID: "msg_owned",
          call: { type: "tool-call", id: `call_${crypto.randomUUID()}`, name, input },
        })
        .pipe(Effect.exit)
    const immediate = (operation = execute()) => Effect.raceFirst(operation, Deferred.await(asked))
    return { session, agent, counts, execute, immediate, store, snapshot, state, asked }
  })

for (const ask of [false, true])
  it.effect(`标准档${ask ? "每次询问" : "默认询问"}的 MCP 工具直接执行,零 Asked`, () =>
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
  { profile: "standard" as const, options: { agentAsk: true }, reason: "refused" },
  { profile: "none" as const, options: { ask: true }, reason: "refused" },
])
  it.effect(`${item.profile} ${JSON.stringify(item.options)} 立即具名拒绝,没有计时器推进或副作用`, () =>
    Effect.gen(function* () {
      const host = yield* setup(item.profile, item.options)
      const result = yield* host.immediate()
      expect(result).not.toBe("asked")
      expect(Exit.isFailure(result)).toBe(true)
      const failure = Cause.squash(result.cause) as InstanceType<typeof Tool.Error>
      expect(failure.metadata?.[UNATTENDED_DENIAL_KEY]).toMatchObject({
        version: 1,
        reason: item.reason,
        tool: "write",
      })
      expect(host.counts.writes).toBe(0)
    }),
  )

it.effect("none 档初值 allow 被后续钩子改 ask 仍立即拒绝,无工具调用的断言同样不等人", () =>
  Effect.gen(function* () {
    const host = yield* setup("none", { laterAsk: true })
    const permission = yield* Permission.Service
    const result = yield* host.immediate(
      permission
        .assert({ sessionID: host.session.id, action: "later-ask", resources: ["*"], save: [], metadata: {} })
        .pipe(Effect.exit),
    )
    expect(result).not.toBe("asked")
    expect(Exit.isFailure(result)).toBe(true)
    expect(yield* permission.list()).toEqual([])
  }),
)

it.effect("Code Mode 子调用的第一条拒绝补在外层成功终态上", () =>
  Effect.gen(function* () {
    const host = yield* setup("readonly")
    const result = yield* host.immediate(
      host.execute("execute", { code: "return await tools.unattended.code_write({})" }),
    )
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
    const hooks = yield* PluginHooks.Service
    yield* hooks.trigger("session", "prompt", {
      sessionID: host.session.id,
      messageID: "msg_foreign",
      prompt: { text: "foreign input" },
      delivery: "queue",
    } as never)
    host.state.install(
      buildUnattendedLive({
        seq: 2,
        nonce: "next",
        sessions: [{ sessionID: host.session.id, agent: host.agent, promptID: "msg_owned" }],
      }),
    )
    const result = yield* host.immediate()
    expect(result).toBe("asked")
    const permission = yield* Permission.Service
    const [request] = yield* permission.list()
    yield* permission.reply({ requestID: request.id, reply: "reject" })
    expect(host.counts.writes).toBe(0)
  }),
)

for (const selected of ["readonly", "standard"] as const)
  it.effect(`${selected} 已启用的 MCP 工具照旧执行`, () =>
    Effect.gen(function* () {
      const host = yield* setup(selected)
      yield* Effect.promise(() =>
        host.store.setRecord({ selector: { level: "class", class: "third-party-mcp" }, state: "enabled" }),
      )
      expect(Exit.isSuccess(yield* host.immediate())).toBe(true)
      expect(host.counts.writes).toBe(1)
    }),
  )

it.effect("AC-04 配置禁止的读文件、子任务和项目外目录无计时等待", () =>
  Effect.gen(function* () {
    const host = yield* setup("standard", { fixedDeny: true })
    const permission = yield* Permission.Service
    for (const [action, resource] of [
      ["read", ".env"],
      ["subagent", "general"],
      ["external_directory", "/outside/*"],
    ]) {
      const result = yield* host.immediate(
        permission
          .assert({ sessionID: host.session.id, action, resources: [resource], save: [], metadata: {} })
          .pipe(Effect.exit),
      )
      expect(result).not.toBe("asked")
      expect(Exit.isFailure(result)).toBe(true)
    }
    expect(host.counts.writes).toBe(0)
  }),
)

for (const selected of ["standard", "readonly", "none"] as const)
  it.effect(`${selected} 无工具调用的同类断言复用 T1,零 Asked`, () =>
    Effect.gen(function* () {
      const host = yield* setup(selected, { ask: true })
      const permission = yield* Permission.Service
      const result = yield* host.immediate(
        permission
          .assert({ sessionID: host.session.id, action: "unattended_write", resources: ["*"], save: [], metadata: {} })
          .pipe(Effect.exit),
      )
      expect(result).not.toBe("asked")
      expect(Exit.isSuccess(result)).toBe(selected === "standard")
      expect(host.counts.writes).toBe(0)
    }),
  )

it.effect("在册会话切换 agent 后仅按 none 拒绝,缺省 agent 也读真实当前会话", () =>
  Effect.gen(function* () {
    const host = yield* setup("standard", { ask: true })
    const sessions = yield* Session.Service
    yield* sessions.switchAgent({ sessionID: host.session.id, agent: "build" })
    const current = yield* sessions.get(host.session.id)
    const result = yield* host.immediate(
      host.snapshot
        .execute({
          sessionID: host.session.id,
          agent: current.agent,
          messageID: "msg_owned",
          call: { type: "tool-call", id: "call_switched", name: "unattended_write", input: {} },
        })
        .pipe(Effect.exit),
    )
    expect(result).not.toBe("asked")
    expect(Exit.isFailure(result)).toBe(true)
    expect(
      (Cause.squash(result.cause) as InstanceType<typeof Tool.Error>).metadata?.[UNATTENDED_DENIAL_KEY],
    ).toMatchObject({ reason: "refused" })
    const permission = yield* Permission.Service
    const noAgent = yield* host.immediate(
      permission
        .assert({
          sessionID: host.session.id,
          action: "unattended_write",
          resources: ["*"],
          save: [],
          metadata: {},
        })
        .pipe(Effect.exit),
    )
    expect(noAgent).not.toBe("asked")
    expect(Exit.isFailure(noAgent)).toBe(true)
    expect(host.counts.writes).toBe(0)
  }),
)

it.effect("T1 allow 对无工具调用的原始 ask 与直接 return 不等价", () =>
  Effect.gen(function* () {
    const host = yield* setup("standard", { ask: true, agentRawAsk: true })
    const permission = yield* Permission.Service
    const result = yield* host.immediate(
      permission
        .assert({
          sessionID: host.session.id,
          action: "unattended_write",
          resources: ["*"],
          save: [],
          metadata: {},
        })
        .pipe(Effect.exit),
    )
    expect(result).not.toBe("asked")
    expect(Exit.isSuccess(result)).toBe(true)
    expect(host.counts.writes).toBe(0)
  }),
)

// The shipped ext bundle carries its own Tool.Error class (scripts/build.ts, ADR-006). 2026-11-28 packaged-layout probe
// (embedded engine + packages/ext/dist/server.js): a policy-disabled tool came back as type "unknown" with no
// codepuppyDisplay, where the source layout gives "tool.execution" with it.
for (const layout of ["source", "separately bundled"] as const)
  for (const denial of ["policy-disabled", "unattended readonly"] as const)
    it.effect(`${layout} ext: the ${denial} denial reaches the engine as tool.execution with its metadata`, () =>
      Effect.gen(function* () {
        const gate = layout === "source" ? { ...sourceGate, createToolPolicyStore } : yield* Effect.promise(separatelyBundledExtPolicy)
        const plugins = yield* Plugin.Service
        const location = yield* Location.Service
        const facts = { technicalId: "gated", permission: "gated", identity: { source: "plugin", origin: "", name: "gated" }, authority: { kind: "not-asserted" } }
        const store = gate.createToolPolicyStore({ baseDir: path.join(ROOT, "gate", crypto.randomUUID()), account: () => "acct:gate", workspace: () => location.directory })
        if (denial === "policy-disabled") yield* Effect.promise(() => store.setRecord({ selector: { level: "tool", canonical: "plugin::gated" }, state: "disabled" }))
        const deps = {
          protectedRoots: undefined as never,
          profile: async () => (denial === "unattended readonly" ? ("readonly" as const) : undefined),
          denied: () => {},
          store,
          facts: async () => facts as never,
          ruleset: async () => [{ action: "plugin::gated", resource: "*", effect: "ask" as const }],
          directory: () => location.directory,
          assert: async () => {},
        }
        yield* plugins.activate([
          promisePlugin(`gated-${layout}-${denial}`, async (ctx: Context) => {
            await ctx.tool.transform((editor) =>
              editor.add({
                name: "gated",
                description: "gated",
                input: { type: "object", properties: {} },
                options: { codemode: false },
                execute: async (_input, context) => {
                  await gate.decide(deps, { tool: "gated", sessionID: context.sessionID, agent: context.agent, id: context.id, messageID: context.messageID })
                  return { content: "ran" }
                },
              }),
            )
          }),
        ])
        yield* plugins.awaitActivation
        const snapshot = yield* (yield* Tool.Service).snapshot([allow])
        const result = yield* snapshot
          .execute({ sessionID: "ses_gate", agent: "build", messageID: "msg_gate", call: { type: "tool-call", id: "call_gate", name: "gated", input: {} } })
          .pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
        const failure = Cause.squash((result as { cause: never }).cause) as InstanceType<typeof Tool.Error>
        expect(toSessionError(failure).type).toBe("tool.execution")
        expect(failure.metadata?.codepuppyDisplay).toMatchObject({ identity: facts.identity })
        if (denial === "unattended readonly") expect(failure.metadata?.[UNATTENDED_DENIAL_KEY]).toMatchObject({ version: 1, reason: "readonly", tool: "gated" })
      }),
    )
