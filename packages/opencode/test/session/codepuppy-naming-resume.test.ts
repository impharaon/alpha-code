// alpha-code#1569 AC4 —— 升级迁移之后,旧会话「继续生成」、压缩后续写、溢出重放后续写都能完成,
// 不报找不到供应商或模式。
//
// 做法:在真引擎库(测试实例的 Database)里按 0.1.24 的写法写一段**旧形状**的会话 —— 供应商 `alpha`、
// agent `alpha-readonly` —— 再在同一个库上执行升级迁移真正下发的那份 SQL(ui-mac `buildSessionRewriteSql()`,
// 相对路径 import 它的纯函数,不抄一份),然后走生产入口 SessionPrompt.loop。配置里只有新名字的供应商
// `codepuppy` 与 agent `codepuppy-readonly`(与 0.1.25 一样:旧名在新版里不存在)。
// 对照臂:不迁移 ⇒ 报错;迁移 SQL 去掉「最近一条普通用户消息」(R18)⇒ 溢出重放复制旧名 ⇒ 报错。
//
// 脚手架沿用 prompt.test.ts 的层装配与 TestLLMServer 假供应商(只换供应商 id 与 agent 名)。
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import path from "path"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Format } from "../../src/format"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { buildSessionRewriteSql } from "../../../ui-mac/src/main/naming-migration-db"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({ summarize: () => Effect.void, diff: () => Effect.succeed([]), computeDiff: () => Effect.succeed([]) }),
)
const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)
const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    tools: () => Effect.succeed({}),
    bindingFacts: () => Effect.succeed(undefined),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth"),
    authenticate: () => Effect.die("unexpected MCP auth"),
    finishAuth: () => Effect.die("unexpected MCP auth"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const root = LayerNode.group([
  LayerNode.group([
    SessionPrompt.node,
    Session.node,
    SessionProjector.node,
    MessageV2.node,
    Snapshot.node,
    LLM.node,
    Env.node,
    AgentSvc.node,
    Command.node,
    Permission.node,
    Plugin.node,
    Config.node,
    ProviderSvc.node,
    LSP.node,
    MCP.node,
    FSUtil.node,
    BackgroundJob.node,
    SessionStatus.node,
    SessionRunState.node,
    Database.node,
    EventV2Bridge.node,
    Question.node,
    Todo.node,
    ToolRegistry.node,
    Skill.node,
    Git.node,
    Ripgrep.node,
    Format.node,
    Truncate.node,
    SessionProcessor.node,
    Image.node,
    SessionCompaction.node,
    SessionRevert.node,
    Instruction.node,
    SystemPrompt.node,
    CrossSpawnSpawner.node,
    RuntimeFlags.node,
  ]),
  LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
])
const it = testEffect(
  LayerNode.compile(root, [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, mcp],
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
  ]),
)

/** 0.1.25 的配置:只有新名字的供应商与 agent。 */
const newNamesOnly = (url: string): Partial<ConfigV1.Info> =>
  ({
    provider: {
      codepuppy: {
        name: "Code Puppy",
        id: "codepuppy",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          "deepseek-flash": {
            id: "deepseek-flash",
            name: "DeepSeek Flash",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: { apiKey: "test-key", baseURL: url },
      },
    },
    agent: { "codepuppy-readonly": { mode: "primary", description: "read-only tier", prompt: "You only read." } },
  }) as Partial<ConfigV1.Info>

const OLD_MODEL = { providerID: ProviderV2.ID.make("alpha"), modelID: ModelV2.ID.make("deepseek-flash") }
const OLD_AGENT = "alpha-readonly"

const setup = Effect.fn("test.setup")(function* () {
  const { directory } = yield* TestInstance
  const llm = yield* TestLLMServer
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(path.join(directory, "opencode.json"), JSON.stringify(newNamesOnly(llm.url)))
  const config = yield* Config.Service
  yield* config.get()
  const sessions = yield* Session.Service
  const prompt = yield* SessionPrompt.Service
  const { db } = yield* Database.Service
  const chat = yield* sessions.create({ title: "old", permission: [{ permission: "*", pattern: "*", action: "allow" }] })
  // 0.1.24 写下的会话指针
  yield* db.run(`UPDATE session SET agent = '${OLD_AGENT}', model = '{"id":"deepseek-flash","providerID":"alpha"}' WHERE id = '${chat.id}'`)
  return { llm, sessions, prompt, db, chat }
})

/** 一轮旧形状的对话:用户消息(旧 agent / 旧供应商)+ 已完成的助手回复。 */
const oldTurn = Effect.fn("test.oldTurn")(function* (sessionID: SessionID, text: string, created: number) {
  const sessions = yield* Session.Service
  const user = yield* sessions.updateMessage({ id: MessageID.ascending(), role: "user", sessionID, agent: OLD_AGENT, model: OLD_MODEL, time: { created } })
  yield* sessions.updatePart({ id: PartID.ascending(), messageID: user.id, sessionID, type: "text", text })
  const assistant = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID,
    mode: OLD_AGENT,
    agent: OLD_AGENT,
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 10, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: OLD_MODEL.modelID,
    providerID: OLD_MODEL.providerID,
    time: { created: created + 1, completed: created + 2 },
    finish: "stop",
  })
  yield* sessions.updatePart({ id: PartID.ascending(), messageID: assistant.id, sessionID, type: "text", text: `re: ${text}` })
  return user
})

/** 0.1.24 在压缩还没做完时留下的触发消息(旧 agent / 旧供应商 + 压缩部件)。 */
const oldCompactionTrigger = Effect.fn("test.oldCompactionTrigger")(function* (sessionID: SessionID, created: number, overflow: boolean) {
  const sessions = yield* Session.Service
  const msg = yield* sessions.updateMessage({ id: MessageID.ascending(), role: "user", sessionID, agent: OLD_AGENT, model: OLD_MODEL, time: { created } })
  yield* sessions.updatePart({ id: PartID.ascending(), messageID: msg.id, sessionID, type: "compaction", auto: true, ...(overflow ? { overflow: true } : {}) })
  return msg
})

/** 在测试实例的真引擎库上执行升级迁移下发的那份 SQL(生产一次喂给 sqlite3;这里按行逐条交给同一个连接)。 */
const migrate = (sql = buildSessionRewriteSql()) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    for (const statement of sql.split("\n")) yield* db.run(statement)
  })

const WITHOUT_R18 = () => buildSessionRewriteSql().replace(" UNION SELECT id FROM temp.naming_latest_plain_user", "")

it.instance("继续生成:迁移后旧会话按会话指针接着发,能完成", () =>
  Effect.gen(function* () {
    const { llm, prompt, chat, db } = yield* setup()
    yield* oldTurn(chat.id, "first", 100)
    yield* migrate()
    const row = yield* db.select({ agent: SessionTable.agent, model: SessionTable.model }).from(SessionTable).where(eq(SessionTable.id, chat.id)).get().pipe(Effect.orDie)
    expect(row).toEqual({ agent: "codepuppy-readonly", model: { id: "deepseek-flash", providerID: "codepuppy" } })
    yield* prompt.prompt({ sessionID: chat.id, agent: row!.agent!, noReply: true, parts: [{ type: "text", text: "继续" }] })
    yield* llm.text("continued")
    const result = yield* prompt.loop({ sessionID: chat.id })
    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") {
      expect(result.info.error).toBeUndefined()
      expect(result.info.providerID).toBe(ProviderV2.ID.make("codepuppy"))
      expect(result.info.agent).toBe("codepuppy-readonly")
    }
    expect(yield* llm.calls).toBe(1)
  }),
)

it.instance("对照臂:不迁移 ⇒ 旧会话按会话指针接着发即失败(旧 agent 在新版里不存在)", () =>
  Effect.gen(function* () {
    const { prompt, chat } = yield* setup()
    yield* oldTurn(chat.id, "first", 100)
    const exit = yield* prompt.prompt({ sessionID: chat.id, agent: OLD_AGENT, noReply: true, parts: [{ type: "text", text: "继续" }] }).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
  }),
)

it.instance("压缩后续写:0.1.24 留下的压缩触发消息,迁移后压缩与续写都能完成", () =>
  Effect.gen(function* () {
    const { llm, prompt, chat, sessions } = yield* setup()
    yield* oldTurn(chat.id, "first", 100)
    yield* oldCompactionTrigger(chat.id, 200, false)
    yield* migrate()
    yield* llm.text("summary of the conversation")
    yield* llm.text("continued after compaction")
    const result = yield* prompt.loop({ sessionID: chat.id })
    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") expect(result.info.error).toBeUndefined()
    expect(yield* llm.calls).toBe(2)
    const all = yield* sessions.messages({ sessionID: chat.id })
    expect(all.some((m) => m.info.role === "assistant" && m.info.summary === true)).toBe(true)
  }),
)

it.instance("溢出重放后续写:重放复制的是最近一条普通用户消息,迁移后能完成(R18)", () =>
  Effect.gen(function* () {
    const { llm, prompt, chat, sessions } = yield* setup()
    yield* oldTurn(chat.id, "earlier context", 100)
    const plain = yield* oldTurn(chat.id, "the big request", 200)
    yield* oldCompactionTrigger(chat.id, 300, true)
    yield* migrate()
    yield* llm.text("summary of the conversation")
    yield* llm.text("continued after replay")
    const result = yield* prompt.loop({ sessionID: chat.id })
    expect(result.info.role).toBe("assistant")
    if (result.info.role === "assistant") expect(result.info.error).toBeUndefined()
    const replayed = (yield* sessions.messages({ sessionID: chat.id })).filter((m) => m.info.role === "user" && m.info.time.created > 300 && m.parts.some((p) => p.type === "text" && p.text === "the big request"))
    expect(replayed.length).toBe(1)
    const info = replayed[0]!.info
    if (info.role === "user") expect({ agent: info.agent, providerID: info.model.providerID }).toEqual({ agent: "codepuppy-readonly", providerID: ProviderV2.ID.make("codepuppy") })
    expect(plain.agent).toBe(OLD_AGENT)
  }),
)

it.instance("对照臂:迁移 SQL 不改最近一条普通用户消息 ⇒ 溢出重放复制旧名 ⇒ 续写失败", () =>
  Effect.gen(function* () {
    const { llm, prompt, chat } = yield* setup()
    yield* oldTurn(chat.id, "earlier context", 100)
    yield* oldTurn(chat.id, "the big request", 200)
    yield* oldCompactionTrigger(chat.id, 300, true)
    yield* migrate(WITHOUT_R18())
    yield* llm.text("summary of the conversation")
    yield* llm.text("never reached")
    const exit = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.exit)
    const failed = Exit.isFailure(exit) || (Exit.isSuccess(exit) && exit.value.info.role === "assistant" && exit.value.info.error !== undefined)
    expect(failed).toBe(true)
  }),
)
