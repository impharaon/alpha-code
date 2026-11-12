// `#1569` AC4 在 OpenCode 2 上(`#1662` parity 第 7 项;v1 的 packages/opencode/test/session/codepuppy-naming-resume.test.ts 随换代删除):
// 0.1.24 的旧会话经升级迁移(先改名、后由引擎做 v1 → 2.x 转换)之后,三条续写路径都能完成,不报找不到供应商或模式。
//
// 宿主:test-component/codepuppy-engine.ts(生产注入 + 真 ext + 本机模型桩),配置里只有新名 —— 平台供应商 `codepuppy`、
// `codepuppy-readonly` 模式(与 0.1.25 起一样,旧名在新版里不存在)。库里先由引擎建好 2.x schema,再补上 0.1.24 写下的 v1 会话
// (供应商 `alpha`、模式 `alpha-readonly`;夹具同 naming-before-v1-conversion.cases.ts),然后走生产顺序:main 的
// `runNamingMigrationDbStep` 改写 v1 表,引擎起来做一次转换(转换器套打进包的同一份改写,test-component/v1-legacy-db.ts)。
// 2.x 上的三条路(与 v1 的对应):
//   ① 继续生成:往旧会话发一句 ⇒ 运行器按会话的 agent / model 选,这一轮完成;
//   ② 压缩后续写:0.1.24 留下的、已完成的压缩(触发消息 + 摘要)转换成 2.x 的压缩消息 ⇒ 在它之后续写完成;再手动压缩一次 ⇒ 压缩
//      (引擎的 compaction agent 用会话的模型)与之后的续写都完成;
//   ③ 溢出:供应商第一次回「上下文过长」⇒ 引擎压缩后在同一轮重试 ⇒ 完成。2.x 没有 v1 R18 的「重放复制最近一条用户消息」,
//      v1 那条对照臂(迁移 SQL 漏改最近一条用户消息)在 2.x 上没有对应的状态。
// 实测(不断言):0.1.24 留下的**没有完成**的压缩触发消息(没有配对摘要)在转换时被丢掉(packages/core/src/database/v1-migration.bun.ts
// 的 compaction 分支),续写时不会补跑那次压缩。
// 已知的坏:反向顺序(先转换、后改名)⇒ 旧名留在 2.x,续写具名失败。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { legacyAssistant, legacyUser, registerV1MigrationTransform, seedLegacyTables } from "../../test-component/v1-legacy-db"
import { codepuppyEngine, scriptedModel, textOf, type Running } from "../../test-component/codepuppy-engine"
import { engineDatabasePath } from "./engine-paths"
import { dbUndo, runNamingMigrationDbStep } from "./naming-migration-db"
import { createMigrationFs } from "./naming-migration-fs"
import { openJournal } from "./naming-migration-journal"

const sandbox = engineSandbox()
const plugin = registerV1MigrationTransform()
const model = scriptedModel()
const running: Running[] = []

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  for (const engine of running.reverse()) await engine.close().catch(() => undefined)
  model.stop()
})

// 0.1.24 写下的旧名(取值同 naming-migration-db.test.ts / naming-before-v1-conversion.cases.ts 的夹具)
const OLD = { agent: "alpha-readonly", model: { id: "deepseek-flash", providerID: "alpha", variant: "high" } }
const PLAIN = "ses_cp_parity_resume"
const COMPACTED = "ses_cp_parity_compacted"
const SUMMARY = "CP-RESUME-SUMMARY the user asked to keep tabs"

let n = 0
/** 一台「升级中的机器」:自己的 XDG_DATA_HOME(库在打包态的 `<它>/opencode/opencode.db`)、自己的迁移日志;库里是 0.1.24 的两条会话。 */
async function upgradingMachine() {
  const root = join(sandbox.root, `resume-machine-${++n}`)
  const env = { XDG_DATA_HOME: join(root, "data") }
  const databasePath = engineDatabasePath({ packaged: true, env, home: sandbox.home, channel: "prod" })
  mkdirSync(join(databasePath, ".."), { recursive: true })
  const host = codepuppyEngine({
    sandbox,
    name: `resume-${n}`,
    modelBaseURL: model.baseURL,
    databasePath,
    platformModels: { "deepseek-flash": { name: "deepseek-flash" } },
  })
  // 先起一次建好 2.x schema(全新的库,没有 v1 表 ⇒ 什么都不转),再补上 0.1.24 的 v1 会话
  await (await host.start()).close()
  const user = (time: number) => legacyUser(time, { agent: OLD.agent, model: { providerID: OLD.model.providerID, modelID: OLD.model.id } })
  const assistant = (parentID: string, time: number, extra: Record<string, unknown> = {}) =>
    legacyAssistant(parentID, time, { agent: OLD.agent, mode: OLD.agent, providerID: OLD.model.providerID, modelID: OLD.model.id, ...extra })
  seedLegacyTables(databasePath, {
    sessions: [PLAIN, COMPACTED].map((id) => ({ id, directory: host.projectDirectory, agent: OLD.agent, model: OLD.model })),
    messages: [
      { id: "msg_000000000011aaaaaaaaaaaaaa", sessionID: PLAIN, time: 10, data: user(10) },
      { id: "msg_000000000012aaaaaaaaaaaaaa", sessionID: PLAIN, time: 20, data: assistant("msg_000000000011aaaaaaaaaaaaaa", 20) },
      // 已完成的压缩:触发消息(compaction part)+ 配对的摘要助手消息,之后还有一句
      { id: "msg_000000000021aaaaaaaaaaaaaa", sessionID: COMPACTED, time: 10, data: user(10) },
      { id: "msg_000000000022aaaaaaaaaaaaaa", sessionID: COMPACTED, time: 20, data: assistant("msg_000000000021aaaaaaaaaaaaaa", 20) },
      { id: "msg_000000000023aaaaaaaaaaaaaa", sessionID: COMPACTED, time: 30, data: user(30) },
      { id: "msg_000000000024aaaaaaaaaaaaaa", sessionID: COMPACTED, time: 40, data: assistant("msg_000000000023aaaaaaaaaaaaaa", 40, { summary: true }) },
      { id: "msg_000000000025aaaaaaaaaaaaaa", sessionID: COMPACTED, time: 50, data: user(50) },
      { id: "msg_000000000026aaaaaaaaaaaaaa", sessionID: COMPACTED, time: 60, data: assistant("msg_000000000025aaaaaaaaaaaaaa", 60) },
    ],
    parts: [
      { id: "prt_11", messageID: "msg_000000000011aaaaaaaaaaaaaa", sessionID: PLAIN, data: { type: "text", text: "resume me" } },
      { id: "prt_12", messageID: "msg_000000000012aaaaaaaaaaaaaa", sessionID: PLAIN, data: { type: "text", text: "sure" } },
      { id: "prt_21", messageID: "msg_000000000021aaaaaaaaaaaaaa", sessionID: COMPACTED, data: { type: "text", text: "first" } },
      { id: "prt_22", messageID: "msg_000000000022aaaaaaaaaaaaaa", sessionID: COMPACTED, data: { type: "text", text: "first reply" } },
      { id: "prt_23", messageID: "msg_000000000023aaaaaaaaaaaaaa", sessionID: COMPACTED, data: { type: "compaction", auto: true } },
      { id: "prt_24", messageID: "msg_000000000024aaaaaaaaaaaaaa", sessionID: COMPACTED, data: { type: "text", text: SUMMARY } },
      { id: "prt_25", messageID: "msg_000000000025aaaaaaaaaaaaaa", sessionID: COMPACTED, data: { type: "text", text: "after compaction" } },
      { id: "prt_26", messageID: "msg_000000000026aaaaaaaaaaaaaa", sessionID: COMPACTED, data: { type: "text", text: "after reply" } },
    ],
  })
  const migrationDir = join(root, "userData", "codepuppy-naming-migration")
  const journal = openJournal(
    createMigrationFs({ trees: [migrationDir] }),
    join(migrationDir, "journal.json"),
    { v: 1, runId: `r${n}`, status: "running", environment: "prod", steps: [] },
    { db: dbUndo({ fs: createMigrationFs, sqlite: () => ({ code: 1, stdout: "", stderr: "" }), now: () => new Date() }) },
  )
  const renameStep = () => runNamingMigrationDbStep(journal, { packaged: true, env, home: sandbox.home })
  /** 起引擎并等它的 v1 → 2.x 转换跑完。 */
  const start = async () => {
    const engine = await host.start()
    running.push(engine)
    for (let i = 0; i < 100; i++) {
      if ((await engine.send("GET", "/api/experimental/migration/v1")).json?.status === "completed") return engine
      await Bun.sleep(100)
    }
    throw new Error("v1 migration did not complete")
  }
  return { renameStep, start }
}

/** 往会话发一句、等这一轮跑完,返回这一轮的结局与它发出的模型请求。 */
async function resume(engine: Running, sessionID: string, text: string) {
  const before = model.requests.length
  const sent = await engine.send("POST", `/api/session/${sessionID}/prompt`, { text })
  expect(sent.status).toBeLessThan(300)
  await engine.send("POST", `/api/experimental/session/${sessionID}/wait`)
  const messages = (await engine.send("GET", `/api/session/${sessionID}/message`)).json.data as Array<{ type: string; error?: { type: string; message?: string }; content?: Array<{ type: string; text?: string }> }>
  const last = messages.find((message) => message.type === "assistant")
  return { last, requests: model.requests.slice(before), session: (await engine.send("GET", `/api/session/${sessionID}`)).json.data }
}
const replied = (outcome: Awaited<ReturnType<typeof resume>>) =>
  outcome.last?.error === undefined && (outcome.last?.content ?? []).some((part) => part.type === "text" && ["ok", "done"].includes(part.text ?? ""))

describe("#1569 AC4:升级迁移之后,旧会话的三条续写路径在 OpenCode 2 上都能完成", () => {
  test("生产顺序:① 继续生成;② 已转换的压缩之后续写,再手动压缩并续写;③ 溢出 ⇒ 压缩后重试完成", async () => {
    const machine = await upgradingMachine()
    expect(machine.renameStep()).toEqual({ ok: true })
    const engine = await machine.start()
    expect(plugin.applied()).toBeGreaterThan(0)

    const plain = await resume(engine, PLAIN, "continue please")
    expect([plain.session.agent, plain.session.model?.providerID]).toEqual(["codepuppy-readonly", "codepuppy"])
    expect(replied(plain), JSON.stringify(plain.last)).toBe(true)
    expect(plain.requests.length).toBeGreaterThan(0)

    // ② 转换出的压缩消息在 2.x 的历史里,续写的模型请求从摘要接着走
    const compacted = (await engine.send("GET", `/api/session/${COMPACTED}/message?order=asc`)).json.data as Array<{ type: string; summary?: string }>
    expect(compacted.filter((message) => message.type === "compaction").map((message) => message.summary)).toEqual([SUMMARY])
    const afterCompaction = await resume(engine, COMPACTED, "go on")
    expect(replied(afterCompaction), JSON.stringify(afterCompaction.last)).toBe(true)
    expect(afterCompaction.requests.some((request) => request.messages.some((message) => textOf(message.content).includes(SUMMARY)))).toBe(true)
    // 手动压缩(用会话的模型)⇒ 压缩完成,之后续写完成
    const before = model.requests.length
    expect((await engine.send("POST", `/api/session/${COMPACTED}/compact`, {})).status).toBeLessThan(300)
    await engine.send("POST", `/api/experimental/session/${COMPACTED}/wait`)
    expect(model.requests.length).toBeGreaterThan(before)
    const manual = (await engine.send("GET", `/api/session/${COMPACTED}/message?order=asc`)).json.data as Array<{ type: string; status?: string }>
    expect(manual.filter((message) => message.type === "compaction").map((message) => message.status), JSON.stringify(manual.filter((message) => message.type === "compaction"))).toEqual(["completed", "completed"])
    expect(replied(await resume(engine, COMPACTED, "and more"))).toBe(true)

    // ③ 第一次请求被判上下文过长 ⇒ 引擎压缩、在同一轮重试
    const overflow = await resume(engine, PLAIN, "CP-OVERFLOW-ONCE keep going")
    expect(replied(overflow), JSON.stringify(overflow.last)).toBe(true)
    const history = (await engine.send("GET", `/api/session/${PLAIN}/message?order=asc`)).json.data as Array<{ type: string; reason?: string; status?: string }>
    // 溢出触发的压缩,引擎记作 auto(packages/core/src/session/compaction.ts 的 Compaction.Started);它在这一轮里真的发了压缩请求
    expect(history.filter((message) => message.type === "compaction").map((message) => [message.reason, message.status])).toEqual([["auto", "completed"]])
    expect(overflow.requests.some((request) => textOf(request.messages.filter((message) => message.role === "user").at(-1)?.content).includes("<template>"))).toBe(true)
  }, 120_000)

  test("已知的坏:反向顺序(先起引擎转换、再改名)⇒ 旧名留在 2.x,继续生成具名失败、模型一次都没被调用", async () => {
    const machine = await upgradingMachine()
    const first = await machine.start()
    await first.close()
    expect(machine.renameStep()).toEqual({ ok: true })
    const engine = await machine.start()
    const outcome = await resume(engine, PLAIN, "continue please")
    expect([outcome.session.agent, outcome.session.model?.providerID]).toEqual([OLD.agent, OLD.model.providerID])
    expect(replied(outcome)).toBe(false)
    expect(outcome.requests).toEqual([])
  }, 120_000)
})
