// alpha-code#1569 AC3 —— 会话库一步(方案 §5、R18、裁决 C2)。真 /usr/bin/sqlite3;缺失时整组响亮跳过。
//
// 夹具的 JSON 形状取自引擎写法:消息 data = SessionV1.User/Assistant 去掉 id/sessionID(core/src/session/sql.ts),
// part data = SessionV1.Part 去掉 id/sessionID/messageID,工具 part 的 `display` 是 ToolDisplaySnapshotV1
// (opencode/src/session/processor.ts 写入),识图标记在转写块 `metadata` 与 Read 结果 `state.metadata`
// (ext/src/cloud-vision-hooks.ts 读取)。旧取值来自 v0.1.24(F7)。
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { dbUndo, runNamingMigrationDbStep } from "./naming-migration-db"
import { createMigrationFs } from "./naming-migration-fs"
import { openJournal } from "./naming-migration-journal"

const SQLITE = "/usr/bin/sqlite3"
const HAS_SQLITE = existsSync(SQLITE)
if (!HAS_SQLITE) console.warn("⚠️ naming-migration-db.test: /usr/bin/sqlite3 missing — every AC3 case below is SKIPPED")
const itSql = test.skipIf(!HAS_SQLITE)

const TMP = mkdtempSync(join(tmpdir(), "naming-migration-db-"))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const AUTH = { bindingId: "bind-1", evidenceDigest: `sha256:${"a1".repeat(32)}` }
const display = (source: string, origin: string, name: string, kind: string, technicalId: string) => ({
  identity: { source, origin, name },
  technicalId,
  authority: kind === "not-asserted" ? { kind } : { kind, ...AUTH },
})
const VISION = { images: [{ id: "img_1", sha256: "ab".repeat(32), text: "a cat" }] }

const SESSIONS: Array<[string, string | null, object]> = [
  ["ses_1", "alpha-readonly", { id: "deepseek-flash", providerID: "alpha", variant: "high" }],
  ["ses_2", "build", { id: "claude-sonnet", providerID: "anthropic" }],
]
const MESSAGES: Array<[string, string, object]> = [
  ["msg_a", "ses_1", { role: "user", time: { created: 1 }, agent: "alpha-readonly", model: { providerID: "alpha", modelID: "deepseek-flash" } }],
  // 并列时间戳:msg_c 按 id 降序排在 msg_b 前面 —— 它是最近一条用户消息,但它带压缩部件
  ["msg_b", "ses_1", { role: "user", time: { created: 5 }, agent: "alpha-ask", model: { providerID: "alpha", modelID: "deepseek-pro" } }],
  ["msg_c", "ses_1", { role: "user", time: { created: 5 }, agent: "alpha-readonly", model: { providerID: "alpha", modelID: "deepseek-flash" } }],
  ["msg_d", "ses_1", { role: "assistant", time: { created: 6 }, agent: "alpha-readonly", providerID: "alpha", modelID: "deepseek-flash", parentID: "msg_c" }],
  ["msg_e", "ses_2", { role: "user", time: { created: 2 }, agent: "build", model: { providerID: "anthropic", modelID: "claude-sonnet" } }],
]
const PARTS: Array<[string, string, string, object]> = [
  ["prt_c1", "msg_c", "ses_1", { type: "compaction", auto: true }],
  ["prt_d1", "msg_d", "ses_1", { type: "tool", tool: "cloud_cloud_dispatch", callID: "c1", display: display("mcp", "cloud", "cloud_dispatch", "alpha-cloud", "cloud_cloud_dispatch"), state: { status: "completed", input: { kind: "image" }, output: "ok" } }],
  ["prt_d2", "msg_d", "ses_1", { type: "tool", tool: "alpha-word_read_docx", callID: "c2", display: display("mcp", "alpha-word", "read_docx", "alpha-bundled", "alpha-word_read_docx"), state: { status: "completed", input: {}, output: "doc" } }],
  ["prt_d3", "msg_d", "ses_1", { type: "tool", tool: "alpha_cloud_access", callID: "c3", display: display("plugin", "@codepuppy/ext", "alpha_cloud_access", "alpha-bundled", "alpha_cloud_access"), state: { status: "completed", input: {}, output: "x" } }],
  ["prt_d4", "msg_d", "ses_1", { type: "tool", tool: "hub_search", callID: "c4", display: display("plugin", "@codepuppy/ext", "hub_search", "alpha-bundled", "hub_search"), state: { status: "completed", input: {}, output: "x" } }],
  ["prt_d5", "msg_d", "ses_1", { type: "tool", tool: "hub_search", callID: "c5", display: display("plugin", "someone-else", "hub_search", "not-asserted", "hub_search"), state: { status: "completed", input: {}, output: "x" } }],
  ["prt_d6", "msg_d", "ses_1", { type: "tool", tool: "cloud_other", callID: "c6", display: display("mcp", "cloud", "other_tool", "not-asserted", "cloud_other"), state: { status: "completed", input: {}, output: "x" } }],
  ["prt_d7", "msg_d", "ses_1", { type: "tool", tool: "read", callID: "c7", state: { status: "completed", input: { filePath: "/a.png" }, output: "img", metadata: { alpha_vision: VISION, truncated: false } } }],
  ["prt_b1", "msg_b", "ses_1", { type: "text", text: "see image", metadata: { alpha_vision: VISION } }],
  ["prt_e1", "msg_e", "ses_2", { type: "text", text: "plain" }],
]

const q = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'`

function seedDb(dbPath: string) {
  mkdirSync(join(dbPath, ".."), { recursive: true })
  const sql = [
    "CREATE TABLE migration(id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL);",
    "INSERT INTO migration VALUES ('20260101000000_x', 1);",
    "CREATE TABLE session(id TEXT PRIMARY KEY, agent TEXT, model TEXT);",
    "CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, data TEXT NOT NULL);",
    "CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, data TEXT NOT NULL);",
    ...SESSIONS.map(([id, agent, model]) => `INSERT INTO session VALUES ('${id}', ${agent === null ? "NULL" : `'${agent}'`}, ${q(model)});`),
    ...MESSAGES.map(([id, session, data]) => `INSERT INTO message VALUES ('${id}', '${session}', ${q(data)});`),
    ...PARTS.map(([id, message, session, data]) => `INSERT INTO part VALUES ('${id}', '${message}', '${session}', ${q(data)});`),
  ].join("\n")
  const r = Bun.spawnSync([SQLITE, dbPath], { stdin: Buffer.from(sql) })
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
}

function rows(dbPath: string, table: "session" | "message" | "part"): Record<string, unknown> {
  const cols = table === "session" ? "id, json_object('agent', agent, 'model', json(model))" : "id, data"
  const r = Bun.spawnSync([SQLITE, "-readonly", "-separator", "\t", dbPath, `SELECT ${cols} FROM ${table} ORDER BY id;`])
  return Object.fromEntries(
    r.stdout
      .toString()
      .trim()
      .split("\n")
      .map((line) => {
        const tab = line.indexOf("\t")
        return [line.slice(0, tab), JSON.parse(line.slice(tab + 1))]
      }),
  )
}

let n = 0
function setup() {
  const root = join(TMP, `c${++n}`)
  const dataHome = join(root, "data")
  const dbPath = join(dataHome, "opencode", "opencode.db")
  const migrationDir = join(root, "userData", "codepuppy-naming-migration")
  seedDb(dbPath)
  const fs = createMigrationFs({ trees: [migrationDir] })
  const journal = openJournal(fs, join(migrationDir, "journal.json"), { v: 1, runId: "r", status: "running", environment: "prod", steps: [] }, { db: dbUndo({ fs: createMigrationFs, sqlite: () => ({ code: 1, stdout: "", stderr: "" }), now: () => new Date() }) })
  return { root, dataHome, dbPath, migrationDir, journal, env: { XDG_DATA_HOME: dataHome } }
}

describe("AC3 —— 会话库:只改指针与快照,历史原件不动", () => {
  itSql("会话指针、最近用户消息与最近普通用户消息、显示快照、识图标记键 —— 逐字段核对,其余 JSON 深相等", () => {
    const c = setup()
    const before = { session: rows(c.dbPath, "session"), message: rows(c.dbPath, "message"), part: rows(c.dbPath, "part") }
    const result = runNamingMigrationDbStep(c.journal, { packaged: true, env: c.env, home: c.root })
    expect(result).toEqual({ ok: true })
    const after = { session: rows(c.dbPath, "session"), message: rows(c.dbPath, "message"), part: rows(c.dbPath, "part") }

    const expected = structuredClone(before) as { session: Record<string, any>; message: Record<string, any>; part: Record<string, any> }
    expected.session.ses_1 = { agent: "codepuppy-readonly", model: { id: "deepseek-flash", providerID: "codepuppy", variant: "high" } }
    // msg_c = 最近一条用户消息(续写 / 压缩取它);msg_b = 最近一条普通用户消息(溢出重放复制它的 agent/model)
    expected.message.msg_c.agent = "codepuppy-readonly"
    expected.message.msg_c.model.providerID = "codepuppy"
    expected.message.msg_b.agent = "codepuppy-ask"
    expected.message.msg_b.model.providerID = "codepuppy"
    // msg_a(更早的历史)与 msg_d(助手消息)不动
    expected.part.prt_d1.display.identity = { source: "mcp", origin: "codepuppy", name: "dispatch" }
    expected.part.prt_d1.display.authority.kind = "codepuppy-cloud"
    expected.part.prt_d2.display.identity.origin = "codepuppy-word"
    expected.part.prt_d2.display.authority.kind = "codepuppy-bundled"
    expected.part.prt_d3.display.identity.name = "codepuppy_access"
    expected.part.prt_d3.display.authority.kind = "codepuppy-bundled"
    expected.part.prt_d4.display.identity.name = "codepuppy_hub_search"
    expected.part.prt_d4.display.authority.kind = "codepuppy-bundled"
    // prt_d5(第三方插件同名 hub_search)、prt_d6(旧服务器键但不是平台工具名)不动
    expected.part.prt_d7.state.metadata = { truncated: false, codepuppy_vision: VISION }
    expected.part.prt_b1.metadata = { codepuppy_vision: VISION }
    expect(after).toEqual(expected)
    // tool 别名与 technicalId 是历史事实
    expect(after.part.prt_d1).toMatchObject({ tool: "cloud_cloud_dispatch", display: { technicalId: "cloud_cloud_dispatch" } })
    expect(Object.keys((after.part.prt_d7 as any).state.metadata)).not.toContain("alpha_vision")

    // 改写前的备份进了迁移目录(不进日常轮转目录),且可读、完整
    const backups = readdirSync(join(c.migrationDir, "db"))
    expect(backups.length).toBe(1)
    const check = Bun.spawnSync([SQLITE, "-readonly", join(c.migrationDir, "db", backups[0]!), "PRAGMA integrity_check;"])
    expect(check.stdout.toString().trim()).toBe("ok")
  })

  itSql("撤销:从备份可续做地恢复,内容回到改写前", () => {
    const c = setup()
    const before = { session: rows(c.dbPath, "session"), message: rows(c.dbPath, "message"), part: rows(c.dbPath, "part") }
    expect(runNamingMigrationDbStep(c.journal, { packaged: true, env: c.env, home: c.root })).toEqual({ ok: true })
    c.journal.undoAll()
    expect({ session: rows(c.dbPath, "session"), message: rows(c.dbPath, "message"), part: rows(c.dbPath, "part") }).toEqual(before)
  })

  itSql("库不存在 / 非打包 ⇒ 不登记这一步", () => {
    const c = setup()
    expect(runNamingMigrationDbStep(c.journal, { packaged: true, env: { XDG_DATA_HOME: join(c.root, "nowhere") }, home: c.root })).toEqual({ ok: true })
    expect(runNamingMigrationDbStep(c.journal, { packaged: false, env: c.env, home: c.root })).toEqual({ ok: true })
    expect(existsSync(join(c.migrationDir, "db"))).toBe(false)
  })
})
