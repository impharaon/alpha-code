// `#1667`(#1662 L5;L3 交回、编排器裁决 alpha-code#1666 评论 6737930969 第 1 条 `l1r-naming-resume`,#1569):
// 0.1.24 的旧名(平台供应商 `alpha`、`alpha-*` 模式、工具卡快照里的 `alpha-word` / `alpha-bundled` …)必须在 OpenCode 2 把
// v1 会话转成 2.x **之前**由 ui-mac 的 `runNamingMigrationDbStep`(`buildSessionRewriteSql`)改掉:改写只认 v1 的
// `session` / `message` / `part` 三张表,转换一旦跑完(`kv` 里记 completed)就不再重跑 —— 顺序反了,旧名永远留在 2.x 里,
// 旧会话续写时按 `alpha` 供应商找模型,找不到。
//
// 启动环路的两步都是真的:main 的会话库一步(真 `runNamingMigrationDbStep`,真 sqlite3、真备份、真日志)与 sidecar 里起引擎时
// 上游的 v1 转换(沙箱里的真 OpenCode 2,转换器套打进包的同一份改写 —— 工具卡快照才跟得过去,见 engine/v1-migration-transform.ts)。
// 库路径两边同源:main 用 `resolveDbPath(env)`,引擎的 `database.path` 用 engine-paths.ts 的 `engineDatabasePath`(同一个函数之上)。
//   · 生产顺序(先改名、后起引擎):2.x 会话的 agent / model 与工具卡快照都是新名;
//   · 反向臂(先起引擎转换、后改名):2.x 里留着旧名,改名那一步只改到了已经没人读的 v1 表。
// 生产里这两步的先后由 index.ts 的源码顺序决定(宿主里那条 ANCHOR)。
//
// 本文件由 naming-before-v1-conversion.test.ts 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../test-component/engine-sandbox"
import { legacyAssistant, legacyUser, registerV1MigrationTransform, seedLegacyTables } from "../../test-component/v1-legacy-db"
import { buildEngineServerOptions } from "./engine-server-options"
import { withEngineAuthorization } from "./engine-authorization"
import { engineDatabasePath } from "./engine-paths"
import { resolveDbPath } from "./db-safety"
import { dbUndo, runNamingMigrationDbStep } from "./naming-migration-db"
import { createMigrationFs } from "./naming-migration-fs"
import { openJournal } from "./naming-migration-journal"
import type { EngineFetch } from "./in-process-engine"

const sandbox = engineSandbox()
const plugin = registerV1MigrationTransform()
const engines: Array<{ close: () => Promise<void> }> = []

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})

afterAll(async () => {
  for (const engine of engines.reverse()) await engine.close().catch(() => undefined)
})

let n = 0
/** 一台「升级中的机器」:自己的 XDG_DATA_HOME(库在 `<它>/opencode/opencode.db`,打包态)、自己的迁移日志目录。 */
function machine() {
  const root = join(sandbox.root, `naming-machine-${++n}`)
  const env = { XDG_DATA_HOME: join(root, "data") }
  const databasePath = engineDatabasePath({ packaged: true, env, home: sandbox.home, channel: "prod" })
  // R17:main 改写的库与引擎打开的库是同一个文件。
  expect(databasePath).toBe(resolveDbPath({ packaged: true, env, home: sandbox.home }).path!)
  mkdirSync(join(databasePath, ".."), { recursive: true })
  const slot = { ...engineSlot(sandbox, `naming-${n}`), databasePath }
  const migrationDir = join(root, "userData", "codepuppy-naming-migration")
  const journal = openJournal(
    createMigrationFs({ trees: [migrationDir] }),
    join(migrationDir, "journal.json"),
    { v: 1, runId: `r${n}`, status: "running", environment: "prod", steps: [] },
    { db: dbUndo({ fs: createMigrationFs, sqlite: () => ({ code: 1, stdout: "", stderr: "" }), now: () => new Date() }) },
  )
  const renameStep = () => runNamingMigrationDbStep(journal, { packaged: true, env, home: sandbox.home })
  return { slot, renameStep }
}

async function startOn(slot: ReturnType<typeof engineSlot>) {
  const { startEngine } = await import("../../engine/engine-embed")
  let fetch: EngineFetch | undefined
  const engine = await startEngine(
    buildEngineServerOptions({
      hostname: "127.0.0.1",
      port: 0,
      password: "cp-l5-naming",
      engineVersion: "test",
      databasePath: slot.databasePath,
      configDirectory: slot.configDirectory,
      config: { content: "{}" },
      models: { fetch: false },
      filewatcher: false,
      platform: process.platform,
    }),
    { onDispatch: (dispatch) => (fetch = withEngineAuthorization(dispatch, "cp-l5-naming")) },
  )
  engines.push(engine)
  const get = async (route: string) => {
    const response = await fetch!(new Request(`http://codepuppy-sidecar.invalid${route}`, { headers: { "x-opencode-directory": encodeURIComponent(slot.projectDirectory) } }))
    expect([route, response.status]).toEqual([route, 200])
    return (await response.json()) as any
  }
  const converted = async () => {
    for (let i = 0; i < 100; i++) {
      if ((await get("/api/experimental/migration/v1")).status === "completed") return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error("v1 migration did not complete")
  }
  return { engine, get, converted }
}

// 0.1.24 写下的旧名(取值同 naming-migration-db.test.ts 的夹具,F7)。
const SESSION = "ses_cp_l5_naming"
const USER = "msg_000000000011aaaaaaaaaaaaaa"
const ASSISTANT = "msg_000000000012aaaaaaaaaaaaaa"
const AUTH = { bindingId: "bind-1", evidenceDigest: `sha256:${"a1".repeat(32)}` }
const oldDisplay = { identity: { source: "mcp", origin: "alpha-word", name: "read_docx" }, technicalId: "alpha-word_read_docx", authority: { kind: "alpha-bundled", ...AUTH } }
const newDisplay = { identity: { source: "mcp", origin: "codepuppy-word", name: "read_docx" }, technicalId: "alpha-word_read_docx", authority: { kind: "codepuppy-bundled", ...AUTH } }

/** 先起一次引擎建好 2.x schema(全新的库,没有 v1 表 ⇒ 什么都不转),再补上 0.1.24 的 v1 会话。 */
async function upgradingMachine() {
  const m = machine()
  const first = await startOn(m.slot)
  await first.engine.close()
  seedLegacyTables(m.slot.databasePath, {
    sessions: [{ id: SESSION, directory: m.slot.projectDirectory, agent: "alpha-readonly", model: { id: "deepseek-flash", providerID: "alpha", variant: "high" } }],
    messages: [
      { id: USER, sessionID: SESSION, time: 10, data: legacyUser(10, { agent: "alpha-readonly", model: { providerID: "alpha", modelID: "deepseek-flash" } }) },
      { id: ASSISTANT, sessionID: SESSION, time: 20, data: legacyAssistant(USER, 20, { agent: "alpha-readonly", providerID: "alpha", modelID: "deepseek-flash" }) },
    ],
    parts: [
      { id: "prt_1", messageID: USER, sessionID: SESSION, data: { type: "text", text: "resume me" } },
      {
        id: "prt_2",
        messageID: ASSISTANT,
        sessionID: SESSION,
        data: { type: "tool", tool: "alpha-word_read_docx", callID: "call_word", display: oldDisplay, state: { status: "completed", input: {}, output: "doc", title: "read", metadata: {}, time: { start: 21, end: 22 } } },
      },
    ],
  })
  return m
}

/** 2.x 里这条旧会话续写时读的指针(会话的 agent / model)与它工具卡的快照。 */
async function resumePointers(engine: Awaited<ReturnType<typeof startOn>>) {
  const session = (await engine.get(`/api/session/${SESSION}`)).data
  const messages = (await engine.get(`/api/session/${SESSION}/message?order=asc`)).data as Array<{ type: string; content?: Array<Record<string, any>> }>
  const tool = messages.find((m) => m.type === "assistant")?.content?.find((item) => item.type === "tool")
  return { agent: session.agent, providerID: session.model?.providerID, display: tool?.state?.metadata?.codepuppyDisplay }
}

describe("#1569 会话库改名先于 OpenCode 2 的 v1 转换", () => {
  test("生产顺序:先跑 runNamingMigrationDbStep、再起引擎转换 ⇒ 2.x 会话的 agent / model 与工具卡快照都是新名", async () => {
    const m = await upgradingMachine()
    expect(m.renameStep()).toEqual({ ok: true })
    const engine = await startOn(m.slot)
    await engine.converted()
    expect(plugin.applied()).toBeGreaterThan(0)
    expect(await resumePointers(engine)).toEqual({ agent: "codepuppy-readonly", providerID: "codepuppy", display: newDisplay })
  }, 90_000)

  test("反向臂:先起引擎转换、再跑改名 ⇒ 改名照样报成功,可 2.x 里留着旧名(转换不重跑,改写只改到 v1 表)", async () => {
    const m = await upgradingMachine()
    const before = await startOn(m.slot)
    await before.converted()
    await before.engine.close()
    expect(m.renameStep()).toEqual({ ok: true })
    const after = await startOn(m.slot)
    await after.converted()
    expect(await resumePointers(after)).toEqual({ agent: "alpha-readonly", providerID: "alpha", display: oldDisplay })
  }, 90_000)
})
