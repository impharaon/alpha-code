// `#1667`(#1662 L5):在测试进程里让真 OpenCode 2 引擎把一份 v1 会话库转成 2.x —— 两件事的共用夹具。
//
//   · `registerV1MigrationTransform()`:用 `Bun.plugin` 把 engine/v1-migration-transform.ts(打进 sidecar 引擎包的同一份改写)
//     套在上游转换器 `v1-migration.bun.ts` 上。bun 下 `#v1-migration` 直接解析到这份 bun 实现,不套就是上游原样
//     (L4 裁决第 6 条的反向臂靠这一点)。`applied()` 报插件真的改写过几次 —— 改写没发生却判绿,是假绿。
//     必须在 import 任何引擎模块**之前**调用。
//   · `seedLegacyTables()`:在引擎建好 2.x schema 的库上补 v1 的 `session` / `message` / `part` 三张表并写入行 ——
//     上游自己的转换器测试同一种夹具(`packages/core/test/v1-migration.test.ts` 的 createLegacyTables,列照抄)。
//     行的 JSON 形状取自 v1 引擎写法:消息 data = SessionV1.User/Assistant 去掉 id/sessionID,part data = SessionV1.Part 去掉
//     id/sessionID/messageID;工具 part 的 `display` 在顶层(Code Puppy v1 的 session/processor.ts 写入)。
// 一律用临时 HOME/XDG 沙箱里的库(engine-sandbox.ts),绝不碰 owner 的数据目录。
import { transformV1MigrationSource } from "../engine/v1-migration-transform"

const SQLITE = "/usr/bin/sqlite3"

const counter = { value: 0 }

export function registerV1MigrationTransform() {
  Bun.plugin({
    name: "codepuppy:v1-migration-transform (test)",
    setup(build) {
      build.onLoad({ filter: /[\\/]core[\\/]src[\\/]database[\\/]v1-migration\.bun\.ts$/ }, async (args) => {
        const upstream = await Bun.file(args.path).text()
        counter.value++
        return { contents: transformV1MigrationSource(upstream), loader: "ts" }
      })
    },
  })
  return { applied: () => counter.value }
}

export type LegacySession = { id: string; directory: string; agent?: string | null; model?: object | null; time?: number }
export type LegacyMessage = { id: string; sessionID: string; time: number; data: object }
export type LegacyPart = { id: string; messageID: string; sessionID: string; data: object }

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
const json = (value: unknown) => quote(JSON.stringify(value))

export function sqlite(dbPath: string, sql: string) {
  const result = Bun.spawnSync([SQLITE, "-batch", "-bail", dbPath], { stdin: Buffer.from(sql) })
  if (result.exitCode !== 0) throw new Error(`sqlite3 failed: ${result.stderr.toString()}`)
  return result.stdout.toString()
}

export function seedLegacyTables(dbPath: string, rows: { sessions: LegacySession[]; messages: LegacyMessage[]; parts: LegacyPart[] }) {
  sqlite(
    dbPath,
    [
      `CREATE TABLE session (
        id text PRIMARY KEY, project_id text NOT NULL, workspace_id text, parent_id text, slug text NOT NULL,
        directory text NOT NULL, path text, title text NOT NULL, version text NOT NULL, share_url text,
        summary_additions integer, summary_deletions integer, summary_files integer, summary_diffs text, metadata text,
        cost real DEFAULT 0 NOT NULL, tokens_input integer DEFAULT 0 NOT NULL, tokens_output integer DEFAULT 0 NOT NULL,
        tokens_reasoning integer DEFAULT 0 NOT NULL, tokens_cache_read integer DEFAULT 0 NOT NULL,
        tokens_cache_write integer DEFAULT 0 NOT NULL, revert text, permission text, agent text, model text,
        time_created integer NOT NULL, time_updated integer NOT NULL, time_compacting integer, time_archived integer
      );`,
      "CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);",
      "CREATE TABLE part (id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);",
      ...rows.sessions.map(
        (s) =>
          `INSERT INTO session (id, project_id, slug, directory, title, version, agent, model, time_created, time_updated) VALUES (${quote(s.id)}, 'global', ${quote(s.id)}, ${quote(s.directory)}, ${quote(s.id)}, '1', ${s.agent == null ? "NULL" : quote(s.agent)}, ${s.model == null ? "NULL" : json(s.model)}, ${s.time ?? 1}, ${(s.time ?? 1) + 1});`,
      ),
      ...rows.messages.map((m) => `INSERT INTO message VALUES (${quote(m.id)}, ${quote(m.sessionID)}, ${m.time}, ${m.time + 1}, ${json(m.data)});`),
      ...rows.parts.map((p) => `INSERT INTO part VALUES (${quote(p.id)}, ${quote(p.messageID)}, ${quote(p.sessionID)}, 1, 2, ${json(p.data)});`),
    ].join("\n"),
  )
}

/** v1 助手消息 data 的最小合法形状(上游转换器测试的 `assistant()` 同款)。 */
export function legacyAssistant(parentID: string, time: number, extra: Record<string, unknown> = {}) {
  return {
    role: "assistant",
    time: { created: time, completed: time + 5 },
    parentID,
    modelID: "model",
    providerID: "provider",
    mode: "build",
    agent: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...extra,
  }
}

export function legacyUser(time: number, extra: Record<string, unknown> = {}) {
  return { role: "user", time: { created: time }, agent: "build", model: { providerID: "provider", modelID: "model" }, ...extra }
}
