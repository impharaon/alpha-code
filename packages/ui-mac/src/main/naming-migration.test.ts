// alpha-code#1569 —— 升级迁移的行为测试(AC1、AC2、AC5、AC6、AC8 的动态部分;方案 §9)。
//
// 夹具 = 一台 0.1.24 用户机的形状:userData 下的旧名持久化项、三环境共用的全局根、四个 Office 组件
// (收据与授权账用生产写器 upsertRecordV2 / writeCapabilityGrantSync 写出,形状与 codepuppy-office-instance.test.ts
// 里取自 owner 本机 prod 的那四条相同,只是名字换回旧名)、含注释的环境配置、治理文件、设置与模型选择 store 文件、
// 以及一个真 sqlite 引擎库。全局根的目录骨架按 codepuppy-environment.ts initCodePuppyEnvironment 建的拓扑手写
// (`<base>/{cas,env/{prod,beta,dev}}`);没有起 dev GUI 去取真实启动产物 —— 那会碰本机的 dev userData 与钥匙串。
import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { parse } from "jsonc-parser"
import { CODEPUPPY_OFFICE_CONNECTORS } from "../shared/office-advisories"
import { addReceipt } from "./codepuppy-installs"
import { evaluateCapabilityDiff, readCapabilityGrant, writeCapabilityGrantSync } from "./ext-capability-grants"
import { collectInventory } from "./ext-inventory"
import { upsertRecordV2 } from "./ext-receipt-v2"
import { runNamingMigrationBoot, type NamingMigrationPorts } from "./naming-migration"
import { runNamingMigrationDbStep } from "./naming-migration-db"
import { createMigrationFs, type MigrationFs, type WriteAllowList } from "./naming-migration-fs"
import { openJournal, readJournalFile, type JournalJson } from "./naming-migration-journal"
import { USER_DATA_LAYOUT } from "./user-data-layout"

const SQLITE = "/usr/bin/sqlite3"
const HAS_SQLITE = existsSync(SQLITE)
if (!HAS_SQLITE) console.warn("⚠️ naming-migration.test: /usr/bin/sqlite3 missing — the session-database legs below are SKIPPED")
const itSql = test.skipIf(!HAS_SQLITE)

const TMP = mkdtempSync(join(tmpdir(), "naming-migration-test-"))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const SECRET = "SECRET-SENTINEL-do-not-copy"
const OLD_OFFICE = ["alpha-word", "alpha-excel", "alpha-powerpoint", "alpha-pdf"] as const

type Fixture = {
  root: string
  appData: string
  userData: string
  home: string
  base: string
  dstBase: string
  dataHome: string
  dbPath: string
  env: Record<string, string>
}

let seq = 0
function seed(opts: { db?: boolean } = {}): Fixture {
  const root = join(TMP, `m${++seq}`)
  const appData = join(root, "Application Support")
  const userData = join(appData, "ai.opencode.desktop")
  const base = join(appData, "alpha-code-state")
  const home = join(root, "home")
  const dataHome = join(root, "xdg-data")
  const f: Fixture = {
    root,
    appData,
    userData,
    home,
    base,
    dstBase: join(appData, "codepuppy-state"),
    dataHome,
    dbPath: join(dataHome, "opencode", "opencode.db"),
    env: { XDG_DATA_HOME: dataHome },
  }
  for (const dir of [userData, home, join(base, "cas"), join(base, "env", "dev"), join(base, "env", "beta"), join(base, "fence-workspaces")])
    mkdirSync(dir, { recursive: true })
  const prod = join(base, "env", "prod")
  mkdirSync(prod, { recursive: true })

  // userData:加密文件只放哨兵(迁移只许改名,绝不读出、复制、记录它)
  const put = (rel: string, body: string) => {
    mkdirSync(join(userData, rel, ".."), { recursive: true })
    writeFileSync(join(userData, rel), body)
  }
  put("alpha-auth.json", JSON.stringify({ v: 1, enc: SECRET }))
  put("alpha-pkce.json", JSON.stringify({ enc: SECRET }))
  put("alpha-byok-keys.json", JSON.stringify({ v: 1, enc: SECRET }))
  put("alpha-secrets/CODEPUPPY_API_KEY", SECRET)
  put("alpha-mcp-secrets/github/v-1/GITHUB_TOKEN", SECRET)
  put("alpha.env", `CODEPUPPY_API_KEY=${SECRET}\n`)
  put("alpha-behavior.md", "# behavior\n")
  put("alpha-identity.md", "# identity\n")
  put("alpha-endpoints.json", JSON.stringify({ web: "https://example.invalid" }))
  put("alpha-surfaces.json", "{}")
  put("alpha-connections/records.json", "[]")
  put("alpha-db-backups/opencode-backup-20261001-000000.db", "old backup bytes")
  put("alpha-shell-env.json", JSON.stringify({ shell: "/bin/zsh", env: { PATH: "/usr/bin" } }))
  put("alpha-live-models.json", '{"v":3,"models":["deepseek-flash"],"signature":"lkg-bytes-kept"}')
  put("alpha-byok-catalog.json", '{"v":1,"providers":["openai"],"sig":"byok-lkg-bytes"}')
  put("alpha-applied-catalog.json", '{"applied":true}')
  put("alpha-discovered-endpoints.json", '{"discovered":true}')
  put("remote-catalog.json", '{"signed":"catalog"}')
  put(
    "alpha-engine-config/opencode.json",
    JSON.stringify(
      {
        instructions: [join(userData, "alpha-identity.md"), join(userData, "alpha-behavior.md")],
        provider: { alpha: { options: { apiKey: `{file:${join(userData, "alpha-secrets", "CODEPUPPY_API_KEY")}}` } } },
        skills: { paths: [join(base, "env", "prod", "skills")] },
      },
      null,
      2,
    ),
  )
  put(
    "opencode.settings",
    JSON.stringify({ alphaCloudScheduleLastPull: 1730000000000, alphaNewLayoutSeeded: true, alphaCustomAgentsSeeded: true, defaultServerUrl: "http://127.0.0.1:4096" }, null, "\t"),
  )
  put(
    "opencode.global.dat",
    JSON.stringify(
      {
        model: JSON.stringify({
          user: [{ providerID: "alpha", modelID: "deepseek-flash", visibility: "show", favorite: true }],
          recent: [
            { providerID: "alpha", modelID: "deepseek-pro" },
            { providerID: "anthropic", modelID: "claude-sonnet" },
          ],
          variant: { "alpha/deepseek-pro": "high", "anthropic/claude-sonnet": "low" },
        }),
        "server.v1": JSON.stringify({ list: [] }),
      },
      null,
      "\t",
    ),
  )
  put(
    "opencode.workspace.proj.1a2b3c.dat",
    JSON.stringify(
      {
        "workspace:prompt": JSON.stringify({ prompt: [{ type: "text", content: "keep this alpha text" }], model: { providerID: "alpha", modelID: "deepseek-flash" } }),
        "session:ses_1:prompt": JSON.stringify({ prompt: [], model: { providerID: "anthropic", modelID: "claude-sonnet" } }),
        "workspace:tabs": JSON.stringify(["a"]),
      },
      null,
      "\t",
    ),
  )
  put("opencode.draft.d1.9f8e.dat", JSON.stringify({ "draft:prompt": JSON.stringify({ prompt: [], model: { providerID: "alpha", modelID: "deepseek-pro", variant: "high" } }) }, null, "\t"))

  // 全局根:四个 Office 组件(生产写器)+ 一条带绝对路径 files[] 的技能收据
  for (const [i, connector] of CODEPUPPY_OFFICE_CONNECTORS.entries()) {
    const name = OLD_OFFICE[i]!
    const written = upsertRecordV2(prod, {
      id: `mcp:${name}`,
      name,
      kind: "mcp",
      environment: "prod",
      scope: { kind: "global" },
      version: "1.0.0",
      manifestDigest: `sha256:${"b9".repeat(32)}`,
      grantDigest: `sha256:${"ef".repeat(32)}`,
      desiredState: "enabled",
      origin: "catalog",
      configKey: `mcp.${name}`,
      transaction: { id: `tx-msx1-${connector.format}`, state: "committed" },
      installedAt: "2026-08-17T09:43:50.836Z",
      updatedAt: "2026-08-17T09:43:52.755Z",
    })
    if (!written.ok) throw new Error(written.reason)
    writeCapabilityGrantSync(prod, {
      v: 1,
      key: `mcp--${name}`,
      capabilities: ["engine:config", "process:spawn"],
      manifestDigest: `sha256:${"b9".repeat(32)}`,
      txId: `tx-msx1-${connector.format}`,
      grantedAt: "2026-08-17T09:43:50.970Z",
    })
  }
  const skillDir = join(prod, "skills", "my-skill")
  mkdirSync(skillDir, { recursive: true })
  const added = addReceipt(prod, {
    id: "user:my-skill",
    name: "my-skill",
    type: "skill",
    scope: "global",
    installedAt: "2026-09-01T00:00:00.000Z",
    origin: "created",
    files: [skillDir],
  })
  if (!added.ok) throw new Error(added.reason)
  writeFileSync(
    join(prod, "alpha.jsonc"),
    `// owner's comment stays\n${JSON.stringify(
      {
        mcp: Object.fromEntries(OLD_OFFICE.map((name) => [name, { type: "local", command: ["python3", join(base, "env", "prod", "office", `${name}.py`)] }])),
        agent: { "alpha-readonly": { temperature: 0.1 }, build: { temperature: 0.3 } },
        skills: { paths: [join(base, "env", "prod", "skills")] },
        note: "alpha-code-state is mentioned in prose and stays",
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(prod, "governance.json"),
    JSON.stringify(
      {
        version: 1,
        mode: "denylist",
        agents: { hide: ["alpha-ask"], disable: [], allow: ["alpha-readonly", "build"], override: { "alpha-readonly": { model: "alpha/deepseek-flash", temperature: 0.2 } } },
        skills: { deny: ["customize-code-puppy", "pdf"] },
        commands: { override: {} },
      },
      null,
      2,
    ),
  )
  mkdirSync(join(prod, "ext-tx", "journal"), { recursive: true })
  writeFileSync(join(prod, "ext-tx", "journal", "tx-old.json"), JSON.stringify({ txId: "tx-old", op: "install", state: "committed" }))
  writeFileSync(join(base, "env", "beta", "alpha.jsonc"), "{}\n")
  writeFileSync(join(base, "fence-workspaces", "prod.json"), JSON.stringify({ v: 1, workspaces: [] }))

  if (opts.db && HAS_SQLITE) seedDb(f.dbPath)
  return f
}

/** 引擎库的最小真形状(packages/core/src/session/sql.ts 的三张表 + migration 水位表)。 */
function seedDb(dbPath: string) {
  mkdirSync(join(dbPath, ".."), { recursive: true })
  const sql = `
CREATE TABLE migration(id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL);
INSERT INTO migration VALUES ('20260101000000_x', 1);
CREATE TABLE session(id TEXT PRIMARY KEY, agent TEXT, model TEXT);
CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, data TEXT NOT NULL);
INSERT INTO session VALUES ('ses_a', 'alpha-readonly', '{"id":"deepseek-flash","providerID":"alpha"}');
INSERT INTO message VALUES ('msg_1', 'ses_a', '{"role":"user","time":{"created":1},"agent":"alpha-readonly","model":{"providerID":"alpha","modelID":"deepseek-flash"}}');
INSERT INTO part VALUES ('prt_1', 'msg_1', 'ses_a', '{"type":"text","text":"hi"}');`
  const r = Bun.spawnSync([SQLITE, dbPath], { stdin: Buffer.from(sql) })
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
}

function dbRows(dbPath: string): string {
  const r = Bun.spawnSync([SQLITE, "-readonly", dbPath, "SELECT 's', id, agent, model FROM session UNION ALL SELECT 'm', id, session_id, data FROM message UNION ALL SELECT 'p', id, message_id, data FROM part ORDER BY 1, 2;"])
  return r.stdout.toString()
}

const OTHERS = (f: Fixture) => [join(f.appData, "ai.opencode.desktop.beta"), join(f.appData, "ai.opencode.desktop.dev")]

function boot(f: Fixture, ports?: NamingMigrationPorts, extra: Partial<Parameters<typeof runNamingMigrationBoot>[0]> = {}) {
  return runNamingMigrationBoot(
    {
      environment: "prod",
      onboardingTest: false,
      userData: f.userData,
      appData: f.appData,
      home: f.home,
      env: f.env,
      otherChannelUserData: OTHERS(f),
      extraUndo: {},
      precheck: () => {},
      ...extra,
    },
    ports,
  )
}

/** 全量:A 段 + B 段 + 完成标记(index.ts 的接线顺序)。 */
function migrate(f: Fixture, ports?: NamingMigrationPorts) {
  const result = boot(f, ports)
  if (result.kind !== "ready") throw new Error(`boot did not get ready: ${JSON.stringify(result)}`)
  const db = runNamingMigrationDbStep(result.journal, { packaged: true, env: f.env, home: f.home }, ports)
  if (!db.ok) throw new Error(db.message)
  result.journal.complete()
}

/** 树快照:相对路径 → 内容摘要(fixture 根路径归一成 <ROOT>,两个夹具可比);迁移目录与库文件另判。 */
function snapshot(f: Fixture, opts: { skip?: (rel: string) => boolean } = {}): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const rel = relative(f.root, p)
      if (rel.includes("codepuppy-naming-migration") || rel.startsWith("xdg-data") || opts.skip?.(rel)) continue
      const st = lstatSync(p)
      if (st.isSymbolicLink()) out[rel] = `link:${readlinkSync(p)}`
      else if (st.isDirectory()) {
        out[rel] = "dir"
        walk(p)
      } else out[rel] = createHash("sha256").update(readFileSync(p, "utf8").replaceAll(f.root, "<ROOT>")).digest("hex")
    }
  }
  walk(f.root)
  return out
}

function recordingFs(writes: string[], wrap?: (fs: MigrationFs) => Partial<MigrationFs>) {
  return (allow: WriteAllowList): MigrationFs => {
    const real = createMigrationFs(allow)
    const recorded: MigrationFs = {
      ...real,
      rename: (from, to) => (writes.push(`rename ${from} -> ${to}`), real.rename(from, to)),
      copy: (from, to) => (writes.push(`copy ${to}`), real.copy(from, to)),
      writeAtomic: (p, d) => (writes.push(`write ${p}`), real.writeAtomic(p, d)),
      append: (p, d) => (writes.push(`append ${p}`), real.append(p, d)),
      mkdir: (p) => (writes.push(`mkdir ${p}`), real.mkdir(p)),
      remove: (p) => (writes.push(`remove ${p}`), real.remove(p)),
    }
    return { ...recorded, ...wrap?.(recorded) }
  }
}

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"))

describe("AC1 / AC5 —— 首次启动把旧名持久化项改到新名", () => {
  itSql("全量迁移:userData、全局根、配置、收据、设置、模型选择、缓存", () => {
    const f = seed({ db: true })
    const lkg = readFileSync(join(f.userData, "alpha-live-models.json"))
    const byokLkg = readFileSync(join(f.userData, "alpha-byok-catalog.json"))
    const auth = readFileSync(join(f.userData, "alpha-auth.json"))
    migrate(f)
    const U = f.userData
    const prod = join(f.dstBase, "env", "prod")

    // userData:改名项在新名下、旧名不在;加密文件字节不变
    for (const [item, name] of Object.entries(USER_DATA_LAYOUT)) {
      if (item === "appliedCatalog" || item === "discoveredEndpoints") continue
      expect(existsSync(join(U, name)), `${name} 应在`).toBe(true)
    }
    for (const old of readdirSync(U)) expect(old.startsWith("alpha"), `旧名残留:${old}`).toBe(false)
    expect(readFileSync(join(U, USER_DATA_LAYOUT.auth)).equals(auth)).toBe(true)
    expect(readFileSync(join(U, USER_DATA_LAYOUT.secrets, "CODEPUPPY_API_KEY"), "utf8")).toBe(SECRET)
    expect(existsSync(join(U, "codepuppy.env"))).toBe(true)
    // AC5:两份 LKG 原字节改名;三份缓存删除(进了迁移备份目录,字节不改)
    expect(readFileSync(join(U, USER_DATA_LAYOUT.liveModels)).equals(lkg)).toBe(true)
    expect(readFileSync(join(U, USER_DATA_LAYOUT.byokCatalog)).equals(byokLkg)).toBe(true)
    for (const gone of ["remote-catalog.json", USER_DATA_LAYOUT.appliedCatalog, USER_DATA_LAYOUT.discoveredEndpoints]) expect(existsSync(join(U, gone))).toBe(false)
    const backups = readdirSync(join(U, "codepuppy-naming-migration", "backup"))
    for (const cache of ["remote-catalog.json", "alpha-applied-catalog.json", "alpha-discovered-endpoints.json"])
      expect(backups.some((name) => name.endsWith(`-${cache}`)), `${cache} 应进备份`).toBe(true)

    // 全局根整体改名;当前环境 alpha.jsonc → codepuppy.jsonc;beta 的不动
    expect(existsSync(f.base)).toBe(false)
    expect(existsSync(join(f.dstBase, "cas"))).toBe(true)
    expect(existsSync(join(prod, "alpha.jsonc"))).toBe(false)
    expect(readFileSync(join(f.dstBase, "env", "beta", "alpha.jsonc"), "utf8")).toBe("{}\n")
    const configText = readFileSync(join(prod, "codepuppy.jsonc"), "utf8")
    expect(configText.startsWith("// owner's comment stays\n")).toBe(true)
    const config = parse(configText) as { mcp: Record<string, { command: string[] }>; agent: Record<string, unknown>; skills: { paths: string[] }; note: string }
    expect(Object.keys(config.mcp).sort()).toEqual(["codepuppy-excel", "codepuppy-pdf", "codepuppy-powerpoint", "codepuppy-word"])
    expect(config.mcp["codepuppy-word"]!.command[1]).toBe(join(prod, "office", "alpha-word.py"))
    expect(Object.keys(config.agent).sort()).toEqual(["build", "codepuppy-readonly"])
    expect(config.skills.paths).toEqual([join(prod, "skills")])
    expect(config.note).toBe("alpha-code-state is mentioned in prose and stays")

    // 引擎配置:目录改名 + 绝对路径前缀改写
    const engine = readJson(join(U, USER_DATA_LAYOUT.engineConfig, "opencode.json"))
    expect(engine.instructions).toEqual([join(U, "codepuppy-identity.md"), join(U, "codepuppy-behavior.md")])
    expect(engine.provider.alpha.options.apiKey).toBe(`{file:${join(U, "codepuppy-secrets", "CODEPUPPY_API_KEY")}}`)
    expect(engine.skills.paths).toEqual([join(prod, "skills")])

    // 收据:Office 四件 name / id / configKey 改新,files[] 前缀改写
    const ledger = readJson(join(prod, "installs.json")) as { receipts: Array<Record<string, unknown>>; records: Array<Record<string, unknown>> }
    for (const list of [ledger.receipts, ledger.records]) {
      const office = list.filter((entry) => String(entry.name).includes("-word") || String(entry.name).includes("-pdf"))
      expect(office.map((entry) => entry.name).sort()).toEqual(["codepuppy-pdf", "codepuppy-word"])
      for (const entry of office) {
        expect(String(entry.id)).toBe(`mcp:${entry.name}`)
        expect(String(entry.configKey)).toBe(`mcp.${entry.name}`)
      }
    }
    expect(ledger.receipts.find((entry) => entry.name === "my-skill")!.files).toEqual([join(prod, "skills", "my-skill")])
    expect(JSON.stringify(ledger)).not.toMatch(/alpha-(word|excel|pdf|powerpoint)/)

    // 治理文件
    const gov = readJson(join(prod, "governance.json"))
    expect(gov.agents.hide).toEqual(["codepuppy-ask"])
    expect(gov.agents.allow).toEqual(["codepuppy-readonly", "build"])
    expect(gov.agents.override).toEqual({ "codepuppy-readonly": { model: "codepuppy/deepseek-flash", temperature: 0.2 } })
    expect(gov.skills.deny).toEqual(["customize-codepuppy", "pdf"])

    // 设置键:读旧写新删旧
    const settings = readJson(join(U, "opencode.settings"))
    expect(settings).toEqual({
      defaultServerUrl: "http://127.0.0.1:4096",
      codepuppyCloudScheduleLastPull: 1730000000000,
      codepuppyNewLayoutSeeded: true,
      codepuppyCustomAgentsSeeded: true,
    })

    // 模型选择:只换供应商 id,提示词正文与别家供应商不动
    const global = JSON.parse(readJson(join(U, "opencode.global.dat")).model)
    expect(global.user[0]).toEqual({ providerID: "codepuppy", modelID: "deepseek-flash", visibility: "show", favorite: true })
    expect(global.recent).toEqual([
      { providerID: "codepuppy", modelID: "deepseek-pro" },
      { providerID: "anthropic", modelID: "claude-sonnet" },
    ])
    expect(global.variant).toEqual({ "codepuppy/deepseek-pro": "high", "anthropic/claude-sonnet": "low" })
    const workspace = readJson(join(U, "opencode.workspace.proj.1a2b3c.dat"))
    expect(JSON.parse(workspace["workspace:prompt"])).toEqual({ prompt: [{ type: "text", content: "keep this alpha text" }], model: { providerID: "codepuppy", modelID: "deepseek-flash" } })
    expect(JSON.parse(workspace["session:ses_1:prompt"]).model.providerID).toBe("anthropic")
    expect(workspace["workspace:tabs"]).toBe(JSON.stringify(["a"]))
    expect(JSON.parse(readJson(join(U, "opencode.draft.d1.9f8e.dat"))["draft:prompt"]).model).toEqual({ providerID: "codepuppy", modelID: "deepseek-pro", variant: "high" })

    // 日志:完成标记
    expect(readJson(join(U, "codepuppy-naming-migration", "journal.json")).status).toBe("complete")
  })
})

describe("AC2 —— Office 授权账:目录与 key 改新,其余原样,读得回、不再要授权", () => {
  test("readCapabilityGrant 读得到 4 个新键;capabilities / manifestDigest / txId / grantedAt 不变;同集合不需要确认;清单显示 4 份", () => {
    const f = seed()
    const before = OLD_OFFICE.map((name) => readCapabilityGrant(join(f.base, "env", "prod"), `mcp--${name}`)!)
    expect(before.every(Boolean)).toBe(true)
    expect(boot(f).kind).toBe("ready")
    const prod = join(f.dstBase, "env", "prod")
    for (const [i, connector] of CODEPUPPY_OFFICE_CONNECTORS.entries()) {
      const key = `mcp--${connector.name}`
      const grant = readCapabilityGrant(prod, key)
      expect(grant, key).not.toBeNull()
      expect({ ...grant, key: undefined }).toEqual({ ...before[i]!, key: undefined })
      expect(evaluateCapabilityDiff(prod, key, grant!.capabilities).requiresConfirmation).toBe(false)
      expect(existsSync(join(prod, "ext-store", `mcp--${OLD_OFFICE[i]}`))).toBe(false)
    }
    const rows = collectInventory({ catalog: null, globalRoot: prod }).rows.filter((row) => row.id.startsWith("mcp:codepuppy-"))
    expect(rows.length).toBe(4)
    expect(rows.every((row) => row.granted?.capabilities.join(",") === "engine:config,process:spawn")).toBe(true)
  })
})

describe("AC6 —— 失败整套撤销;被杀后先撤再跑;完成后跳过", () => {
  itSql("① 会话库步失败(A 段已全做完)⇒ 树逐项回到夹具、库内容恢复、日志归档为 undone", () => {
    const f = seed({ db: true })
    const tree = snapshot(f)
    const rows = dbRows(f.dbPath)
    const result = boot(f)
    expect(result.kind).toBe("ready")
    if (result.kind !== "ready") return
    let calls = 0
    const failing: NamingMigrationPorts = {
      sqlite: (args, stdin) => {
        calls += 1
        const real = Bun.spawnSync([SQLITE, ...args], { stdin: Buffer.from(stdin ?? "") })
        // 备份照常;改写那一次:先真把库改了,再报失败 —— 撤销必须把它从备份恢复回来
        if (stdin?.includes("BEGIN IMMEDIATE")) return { code: 1, stdout: real.stdout.toString(), stderr: "injected failure after rewrite" }
        return { code: real.exitCode ?? -1, stdout: real.stdout.toString(), stderr: real.stderr.toString() }
      },
    }
    const db = runNamingMigrationDbStep(result.journal, { packaged: true, env: f.env, home: f.home }, failing)
    expect(db).toEqual({ ok: false, message: expect.stringContaining("injected failure") })
    expect(calls).toBeGreaterThan(1)
    expect(snapshot(f)).toEqual(tree)
    expect(dbRows(f.dbPath)).toBe(rows)
    const journal = readJson(join(f.userData, "codepuppy-naming-migration", "journal.json"))
    expect(journal.status).toBe("undone")
    expect(journal.steps.every((step: { state: string }) => step.state === "undone")).toBe(true)
    // 下一次启动:归档旧日志、重新跑一轮
    expect(boot(f).kind).toBe("ready")
    expect(readdirSync(join(f.userData, "codepuppy-naming-migration")).some((name) => /^journal-.+-undone\.json$/.test(name))).toBe(true)
  })

  test("A 段中途一步失败 ⇒ 已做的步逆序撤销,树回到夹具,返回 failed", () => {
    const f = seed()
    const tree = snapshot(f)
    const ports: NamingMigrationPorts = {
      fs: recordingFs([], (fs) => ({
        rename: (from, to) => {
          if (from.endsWith("remote-catalog.json")) throw new Error("injected rename failure")
          fs.rename(from, to)
        },
      })),
    }
    const result = boot(f, ports)
    expect(result).toEqual({ kind: "failed", message: "injected rename failure" })
    expect(snapshot(f)).toEqual(tree)
    expect(readdirSync(join(f.userData, "codepuppy-naming-migration")).some((name) => /^journal-.+-undone\.json$/.test(name))).toBe(true)
  })

  test("② 第 N 步做完后进程被杀(完成标记之前)⇒ 下次启动先完整撤销再重跑,结果与一次跑完相同", () => {
    const reference = seed()
    expect(boot(reference).kind).toBe("ready")
    const expected = snapshot(reference)

    const f = seed()
    const child = runChild(f, "apply", 6)
    expect(child.signalCode, child.stderr).toBe("SIGKILL")
    const killed = readJson(join(f.userData, "codepuppy-naming-migration", "journal.json"))
    expect(killed.status).toBe("running")
    expect(killed.steps.filter((step: { state: string }) => step.state === "done").length).toBe(6)

    const result = boot(f)
    expect(result.kind).toBe("ready")
    expect(snapshot(f)).toEqual(expected)
    const archived = readdirSync(join(f.userData, "codepuppy-naming-migration")).filter((name) => name.endsWith("-undone.json"))
    expect(archived.length).toBe(1)
    const undoneRun = readJson(join(f.userData, "codepuppy-naming-migration", archived[0]!))
    expect(undoneRun.runId).toBe(killed.runId)
    expect(undoneRun.status).toBe("undone")
    expect(undoneRun.steps.every((step: { state: string }) => step.state === "undone")).toBe(true)
  })

  test("③ 撤销途中被杀 ⇒ 重启从停下处续撤,已 undone 的步不再执行,终态回到夹具", () => {
    const f = seed()
    const tree = snapshot(f)
    const child = runChild(f, "undo", 3)
    expect(child.signalCode, child.stderr).toBe("SIGKILL")
    const killed = readJson(join(f.userData, "codepuppy-naming-migration", "journal.json")) as { status: string; steps: Array<{ kind: string; state: string; payload: { from?: string; to?: string } }> }
    expect(killed.status).toBe("running")
    const undone = killed.steps.filter((step) => step.state === "undone")
    const pending = killed.steps.filter((step) => step.state !== "undone" && step.kind === "rename")
    expect(undone.length).toBe(3)

    const writes: string[] = []
    const result = boot(f, { fs: recordingFs(writes) }, { precheck: () => { throw new Error("stop after rollback") } })
    expect(result).toEqual({ kind: "failed", message: "stop after rollback" })
    for (const step of undone.filter((s) => s.kind === "rename"))
      expect(writes.filter((w) => w === `rename ${step.payload.to} -> ${step.payload.from}`).length, "已撤的步被重复执行").toBe(0)
    for (const step of pending) expect(writes.filter((w) => w === `rename ${step.payload.to} -> ${step.payload.from}`).length).toBe(1)
    expect(snapshot(f)).toEqual(tree)
  })

  itSql("⑤ 完成后再启动 ⇒ skip(complete),零写", () => {
    const f = seed({ db: true })
    migrate(f)
    const writes: string[] = []
    expect(boot(f, { fs: recordingFs(writes) })).toEqual({ kind: "skip", reason: "complete" })
    expect(writes).toEqual([])
  })
})

describe("R15 —— 日志续撤:已 undone 的步不再执行(间谍计数)", () => {
  test("撤到一半停下(撤销抛错)⇒ 从盘上重开日志续撤,只执行剩下的步,每步一次", () => {
    const dir = join(TMP, "journal-unit")
    mkdirSync(dir, { recursive: true })
    const file = join(dir, "journal.json")
    const fs = createMigrationFs({ trees: [dir] })
    const calls: number[] = []
    const failAt = { seq: 2 }
    const spy = (payload: JournalJson) => {
      const n = (payload as { n: number }).n
      if (n === failAt.seq) throw new Error(`stopped at ${n}`)
      calls.push(n)
    }
    const journal = openJournal(fs, file, { v: 1, runId: "r", status: "running", environment: "prod", steps: [] }, { spy })
    for (const n of [1, 2, 3, 4]) journal.step("spy", { n }, () => {})
    expect(() => journal.undoAll()).toThrow("stopped at 2")
    expect(calls).toEqual([4, 3])
    const onDisk = readJournalFile(fs, file)!
    expect(onDisk.steps.map((step) => step.state)).toEqual(["done", "done", "undone", "undone"])
    expect(onDisk.undoError).toContain("step 2")

    failAt.seq = -1
    calls.length = 0
    openJournal(fs, file, onDisk, { spy }).undoAll()
    expect(calls).toEqual([2, 1])
    expect(readJournalFile(fs, file)!.status).toBe("undone")
  })
})

/** 子进程跑同一个入口,在日志第 n 次「done」(apply)/「undone」(undo)落盘之后 SIGKILL 自己。 */
function runChild(f: Fixture, mode: "apply" | "undo", n: number) {
  const script = `${f.root}-child.ts`
  writeFileSync(
    script,
    `import { runNamingMigrationBoot } from ${JSON.stringify(join(import.meta.dir, "naming-migration.ts"))}
import { createMigrationFs } from ${JSON.stringify(join(import.meta.dir, "naming-migration-fs.ts"))}
const [userData, appData, home] = process.argv.slice(2)
const fs = (allow) => {
  const real = createMigrationFs(allow)
  return {
    ...real,
    rename(from, to) {
      if (${JSON.stringify(mode)} === "undo" && from.endsWith("remote-catalog.json")) throw new Error("injected")
      real.rename(from, to)
    },
    writeAtomic(p, data) {
      real.writeAtomic(p, data)
      if (!p.endsWith("journal.json")) return
      const state = ${JSON.stringify(mode === "apply" ? "done" : "undone")}
      if (JSON.parse(data).steps.filter((s) => s.state === state).length >= ${n}) process.kill(process.pid, "SIGKILL")
    },
  }
}
runNamingMigrationBoot({ environment: "prod", onboardingTest: false, userData, appData, home, env: {}, otherChannelUserData: [], extraUndo: {}, precheck: () => {} }, { fs })
`,
  )
  const r = Bun.spawnSync([process.execPath, script, f.userData, f.appData, f.home])
  return { signalCode: r.signalCode, stderr: r.stderr.toString() }
}

describe("R6 —— 目标全局根已存在", () => {
  /** dev 运行留下的形状(手写,未取真实产物):initCodePuppyEnvironment 建的骨架 + dev 环境的文件与按环境命名的真源文件。 */
  function devSkeleton(dst: string) {
    for (const dir of ["cas", "env/prod", "env/beta", "env/dev/ext-store", "fence-workspaces", "custom-providers", "mcp-servers", "egress-grants"])
      mkdirSync(join(dst, dir), { recursive: true })
    writeFileSync(join(dst, "env/dev/codepuppy.jsonc"), "{}\n")
    writeFileSync(join(dst, "env/dev/installs.json"), JSON.stringify({ v: 2, receipts: [], records: [] }))
    for (const dir of ["fence-workspaces", "custom-providers", "mcp-servers", "egress-grants"]) writeFileSync(join(dst, dir, "dev.json"), "{}")
  }

  test("只有 dev 产物 ⇒ 先把目标挪到 aside-<runId>,再改名源;失败撤销时两步都还原", () => {
    const f = seed()
    devSkeleton(f.dstBase)
    const tree = snapshot(f)
    const failing: NamingMigrationPorts = {
      fs: recordingFs([], (fs) => ({
        rename: (from, to) => {
          if (from.endsWith("remote-catalog.json")) throw new Error("injected")
          fs.rename(from, to)
        },
      })),
    }
    expect(boot(f, failing).kind).toBe("failed")
    expect(snapshot(f)).toEqual(tree)

    expect(boot(f).kind).toBe("ready")
    const aside = readdirSync(join(f.userData, "codepuppy-naming-migration")).filter((name) => name.startsWith("aside-"))
    expect(aside.length).toBe(1)
    expect(existsSync(join(f.userData, "codepuppy-naming-migration", aside[0]!, "env/dev/codepuppy.jsonc"))).toBe(true)
    expect(existsSync(join(f.dstBase, "env/prod/codepuppy.jsonc"))).toBe(true)
  })

  for (const [label, rel] of [
    ["env/prod 下有文件", "env/prod/codepuppy.jsonc"],
    ["fence-workspaces/beta.json", "fence-workspaces/beta.json"],
    ["egress-grants/prod.json", "egress-grants/prod.json"],
    ["清单外的新目录 some-truth/beta.json(按目录扫描,不靠清单)", "some-truth/beta.json"],
  ] as const)
    test(`目标里有 prod/beta 的东西(${label})⇒ 预检失败、零写`, () => {
      const f = seed()
      devSkeleton(f.dstBase)
      mkdirSync(join(f.dstBase, rel, ".."), { recursive: true })
      writeFileSync(join(f.dstBase, rel), "{}")
      const writes: string[] = []
      const result = boot(f, { fs: recordingFs(writes) })
      expect(result.kind).toBe("failed")
      if (result.kind === "failed") expect(result.message).toContain(join(f.dstBase, rel))
      expect(writes).toEqual([])
    })

  test("源不在、目标在(另一个渠道已经搬过)⇒ 不动全局根,当前环境的配置照常迁", () => {
    const f = seed()
    const moved = join(f.appData, "codepuppy-state")
    Bun.spawnSync(["mv", f.base, moved])
    expect(boot(f).kind).toBe("ready")
    expect(existsSync(join(moved, "env/prod/codepuppy.jsonc"))).toBe(true)
    expect(readdirSync(join(f.userData, "codepuppy-naming-migration")).some((name) => name.startsWith("aside-"))).toBe(false)
  })
})

describe("预检:不迁并给出可读错误(零写)", () => {
  function expectRefused(f: Fixture, contains: string, ports: NamingMigrationPorts = {}) {
    const writes: string[] = []
    const result = boot(f, { ...ports, fs: recordingFs(writes) })
    expect(result.kind).toBe("failed")
    if (result.kind === "failed") expect(result.message).toContain(contains)
    expect(writes).toEqual([])
  }

  test("R10 / R20-6:另一个渠道的 SingletonLock 指向活着的 Code Puppy 进程 ⇒ 失败,连 running 日志也不撤", () => {
    const f = seed()
    const beta = join(f.appData, "ai.opencode.desktop.beta")
    mkdirSync(beta, { recursive: true })
    symlinkSync("Tides-MacBook-Pro.local-4242", join(beta, "SingletonLock"))
    mkdirSync(join(f.userData, "codepuppy-naming-migration"), { recursive: true })
    writeFileSync(join(f.userData, "codepuppy-naming-migration", "journal.json"), JSON.stringify({ v: 1, runId: "r", status: "running", environment: "prod", steps: [] }))
    expectRefused(f, "正在运行", {
      pidAlive: (pid) => pid === 4242,
      executableOf: () => "/Applications/Code Puppy Beta.app/Contents/MacOS/Code Puppy Beta",
    })
    expect(readJson(join(f.userData, "codepuppy-naming-migration", "journal.json")).status).toBe("running")
  })

  test("锁指向活着的进程、但可执行文件不是 Code Puppy(真跑 /bin/ps:子进程 /bin/sleep)⇒ 视为不在跑", () => {
    const f = seed()
    const sleeper = Bun.spawn(["/bin/sleep", "30"])
    try {
      const beta = join(f.appData, "ai.opencode.desktop.beta")
      mkdirSync(beta, { recursive: true })
      symlinkSync(`host-${sleeper.pid}`, join(beta, "SingletonLock"))
      expect(boot(f).kind).toBe("ready")
    } finally {
      sleeper.kill()
    }
  })

  test("锁指向已死的 pid / 不是 <主机>-<pid> 形状 ⇒ 视为不在跑", () => {
    const f = seed()
    const [beta, dev] = OTHERS(f)
    for (const dir of [beta!, dev!]) mkdirSync(dir, { recursive: true })
    symlinkSync("host-4242", join(beta!, "SingletonLock"))
    symlinkSync("garbage", join(dev!, "SingletonLock"))
    expect(boot(f, { pidAlive: () => false, executableOf: () => "/Applications/Code Puppy.app/Contents/MacOS/Code Puppy" }).kind).toBe("ready")
  })

  test("R8:prod 环境有未完成的扩展事务 ⇒ 失败", () => {
    const f = seed()
    writeFileSync(join(f.base, "env/prod/ext-tx/journal/tx-live.json"), JSON.stringify({ txId: "tx-live", op: "install", state: "staged" }))
    expectRefused(f, "未完成的扩展安装")
  })

  test("当前环境 alpha.jsonc 与 codepuppy.jsonc 并存 ⇒ 失败", () => {
    const f = seed()
    writeFileSync(join(f.base, "env/prod/codepuppy.jsonc"), "{}")
    expectRefused(f, "同时存在")
  })

  test("任一改名目标已存在 ⇒ 失败", () => {
    const f = seed()
    writeFileSync(join(f.userData, USER_DATA_LAYOUT.auth), "{}")
    expectRefused(f, USER_DATA_LAYOUT.auth)
  })

  test("调用方的 precheck 抛错 ⇒ 失败、零写", () => {
    const f = seed()
    const writes: string[] = []
    expect(boot(f, { fs: recordingFs(writes) }, { precheck: () => { throw new Error("caller says no") } })).toEqual({ kind: "failed", message: "caller says no" })
    expect(writes).toEqual([])
  })

  test("日志里有本版本认不出的步骤 ⇒ 失败,不撤", () => {
    const f = seed()
    mkdirSync(join(f.userData, "codepuppy-naming-migration"), { recursive: true })
    writeFileSync(
      join(f.userData, "codepuppy-naming-migration", "journal.json"),
      JSON.stringify({ v: 1, runId: "r", status: "running", environment: "prod", steps: [{ seq: 1, kind: "keychain-rename", payload: {}, state: "done" }] }),
    )
    expectRefused(f, "keychain-rename")
  })
})

describe("跳过:dev / 打包 onboarding 测试 / Windows —— 一个文件都不碰", () => {
  for (const [label, extra, ports, reason] of [
    ["dev", { environment: "dev" as const }, {}, "dev"],
    ["onboarding", { onboardingTest: true }, {}, "onboarding-test"],
    ["R7 Windows", {}, { platform: "win32" as const }, "unsupported-platform"],
  ] as const)
    test(label, () => {
      const f = seed()
      let fsCalls = 0
      const result = boot(f, { ...ports, fs: (allow) => (fsCalls++, createMigrationFs(allow)) }, extra)
      expect(result).toEqual({ kind: "skip", reason })
      expect(fsCalls).toBe(0)
      expect(existsSync(f.base)).toBe(true)
    })
})

describe("全新安装(没有任何旧数据)", () => {
  test("userData 还不存在、也没有旧全局根 ⇒ ready,只写迁移日志", () => {
    const root = join(TMP, `fresh${++seq}`)
    const appData = join(root, "Application Support")
    mkdirSync(appData, { recursive: true })
    const userData = join(appData, "ai.opencode.desktop")
    const writes: string[] = []
    const result = runNamingMigrationBoot(
      { environment: "prod", onboardingTest: false, userData, appData, home: root, env: {}, otherChannelUserData: [], extraUndo: {}, precheck: () => {} },
      { fs: recordingFs(writes) },
    )
    expect(result.kind).toBe("ready")
    expect(writes.every((w) => w.includes("codepuppy-naming-migration"))).toBe(true)
    expect(readdirSync(appData)).toEqual(["ai.opencode.desktop"])
  })
})

describe("AC8 —— 只写白名单里的位置,不读出、不记录凭据", () => {
  itSql("全夹具跑一遍:每一次写都落在 userData / 新旧全局根 / 引擎库及其旁件里;日志与备份里没有凭据哨兵", () => {
    const f = seed({ db: true })
    const writes: string[] = []
    migrate(f, { fs: recordingFs(writes) })
    const allowed = [f.userData, f.base, f.dstBase]
    const dbFamily = [f.dbPath, `${f.dbPath}-wal`, `${f.dbPath}-shm`, `${f.dbPath}.restore-tmp`]
    const targets = writes.map((w) => w.split(" ").slice(1).join(" ").split(" -> ").at(-1)!)
    expect(targets.length).toBeGreaterThan(20)
    for (const target of targets)
      expect(allowed.some((root) => target === root || target.startsWith(`${root}/`)) || dbFamily.includes(target) || target.startsWith(`${f.dbPath}.corrupt-`), target).toBe(true)
    const migrationDir = join(f.userData, "codepuppy-naming-migration")
    const leak = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name)
        if (lstatSync(p).isDirectory()) return name.startsWith("aside-") ? [] : leak(p)
        return readFileSync(p).includes(SECRET) ? [p] : []
      })
    expect(leak(migrationDir)).toEqual([])
  })

  test("对照臂:白名单收窄后,同一次迁移在第一次写之前就被端口拒绝", () => {
    const f = seed()
    const narrow: NamingMigrationPorts = { fs: (allow) => createMigrationFs({ trees: allow.trees.filter((root) => root === f.userData) }) }
    const result = boot(f, narrow)
    expect(result.kind).toBe("failed")
    if (result.kind === "failed") expect(result.message).toContain("allow-list")
    expect(existsSync(f.base)).toBe(true)
  })
})
