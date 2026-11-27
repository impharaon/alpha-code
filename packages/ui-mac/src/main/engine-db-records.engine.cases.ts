// SPEC-engine-config-fence AC-03 (INT-safety I-13, DESIGN-engine-config-fence §4.6 L1–L3, §6 E4): the fence cannot keep
// the engine's own database read-only, so a conversation's shell can plant records there. Real embedded engine +
// production Code Puppy injection + real ext + local scripted model; the whole process runs under the production-rendered
// fence profile with the real native addon, so every planting command is the engine's own shell tool, fenced.
// Three planted records: a saved approval, a session-row allow, and a wellknown source with its cached manifest and a
// cached document carrying a local MCP server. In the 请求审批 tier the shell still asks; after the configuration is
// reloaded (an engine restart on the same database) the planted connector is not there and its command never runs.
// Each case first reads the database from outside the engine to prove the record really was written.
// Run only through engine-db-records.engine.test.ts; the fence is process-lifetime.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import fs from "node:fs"
import path from "node:path"
import { buildFenceAddon } from "../../scripts/build-fence-addon"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, textOf, type Running } from "../../test-component/codepuppy-engine"
import { serveCredentialsFromOutside } from "../../test-component/credential-table"
import { applyProcessFence } from "./process-fence-apply"
import { renderProcessFenceProfile, resolveEngineRoots } from "./process-fence-profile"
import { planConfigFence, planCredentialStores } from "./process-fence-plan"
import { credentialStores } from "./codepuppy-secret-files"

const describeDarwin = process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec") ? describe : describe.skip
const ASK_TIER = "codepuppy-ask"
const APPROVE_ALL_TIER = "build"
/** The command's output exists only if the command ran: the command text carries the arithmetic, not its result. */
const RAN = (tag: string) => ({ command: `echo $((6*7))${tag}`, marker: `42${tag}` })

describeDarwin("引擎库里植入的三类记录不放行、不装载(真引擎 + 真围栏 + 真 ext)", () => {
  const sandbox = engineSandbox()
  const model = scriptedModel()
  let host: ReturnType<typeof codepuppyEngine>
  let running: Running | undefined
  let fenced = ""

  beforeAll(async () => {
    await assertEngineSandboxed(sandbox)
    host = codepuppyEngine({ sandbox, name: "db-records", modelBaseURL: model.baseURL })
    fenced = host.projectDirectory
    // Outside the writable set (not under /private/tmp, $TMPDIR or the sandbox HOME); the host removes it afterwards.
    const base = process.env.CODEPUPPY_WRITE_REFUSAL_ROOT!
    fs.mkdirSync(base, { recursive: true })
    const scratch = fs.realpathSync(fs.mkdtempSync(path.join(base, "db-records-")))
    const addon = buildFenceAddon({ out: path.join(scratch, "codepuppy_fence.node"), buildId: `db-records-${Date.now()}` }).out
    const roots = resolveEngineRoots(process.env, sandbox.home)
    const codepuppyGlobalRoot = path.join(sandbox.root, "db-records-state", "codepuppy-state", "env", "dev")
    const profile = renderProcessFenceProfile({
      workspaces: [fenced],
      codepuppyGlobalRoot,
      // The engine database lives under the sandbox root, writable as the data directory is in production.
      userDataPath: sandbox.root,
      stateHome: process.env.XDG_STATE_HOME!,
      roots,
      egressProxyPort: Number(new URL(model.baseURL).port),
      // SPEC-engine-config-fence slice ②: the production protected set (production planner step: real paths, pre-created
      // directories), over this engine's own userData, state root and global configuration directory
      configFence: planConfigFence(
        { userDataPath: host.userData, appStateRoot: path.dirname(path.dirname(codepuppyGlobalRoot)), codepuppyGlobalRoot, engineConfigDirectory: host.slot.configDirectory, roots },
        { realpath: (p) => fs.realpathSync.native(p), mkdirp: (p) => void fs.mkdirSync(p, { recursive: true }) },
      ).configFence,
      // SPEC-stored-credentials-fence:生产 profile 同样带 C1(这台引擎自己的凭据存放点,生产计划器那一步落真实路径)
      homebrewFence: [], credentialStores: planCredentialStores(credentialStores({ userDataPath: host.userData }), { realpath: (p) => fs.realpathSync.native(p) }),
    })
    // SPEC-stored-credentials-fence: C1 refuses this process its own credential stores once fenced — main (outside the fence) answers the pulls
    await serveCredentialsFromOutside()
    applyProcessFence({ addonPath: addon, profile }, { insideDir: fenced, outsideDir: scratch })
    running = await host.start()
    expect(() => fs.writeFileSync(path.join(scratch, "probe"), "x")).toThrow(/EPERM|operation not permitted/i)
  }, 180_000)

  afterAll(async () => {
    await running?.close().catch(() => undefined)
    model.stop()
  })

  const send = (method: string, route: string, body?: unknown) => running!.send(method, route, body)

  async function createSession(agent: string) {
    const created = await send("POST", "/api/session", { location: { directory: fenced }, agent, model: { id: "m", providerID: "codepuppy" } })
    expect(created.status).toBe(200)
    return created.json.data.id as string
  }

  /** One model turn calling the shell; every approval request is answered with `decision` and its action recorded. */
  async function shell(sessionID: string, command: string, decision: "once" | "reject") {
    const before = model.requests.length
    await send("POST", `/api/session/${sessionID}/prompt`, { text: `CP-CALL ${JSON.stringify({ name: "shell", args: { command, description: "planted record probe" } })}` })
    const asked: string[] = []
    const settled = send("POST", `/api/experimental/session/${sessionID}/wait`)
    for (let i = 0; i < 300; i++) {
      if (await Promise.race([settled.then(() => true), Bun.sleep(40).then(() => false)])) break
      const pending = ((await send("GET", `/api/session/${sessionID}/permission`)).json?.data ?? []) as Array<{ id: string; action: string }>
      for (const request of pending) {
        asked.push(request.action)
        await send("POST", `/api/session/${sessionID}/permission/${request.id}/reply`, { decision })
      }
    }
    await settled
    const toolText = model.requests
      .slice(before)
      .flatMap((request) => request.messages.filter((message) => message.role === "tool").map((message) => textOf(message.content)))
      .join("\n")
    return { asked, toolText }
  }

  /** The planting itself: the engine's own (fenced) shell runs `sqlite3` on its database, in the 全部批准 tier. */
  async function plant(name: string, sql: string) {
    const file = path.join(fenced, `${name}.sql`)
    fs.writeFileSync(file, sql)
    const sessionID = await createSession(APPROVE_ALL_TIER)
    const result = await shell(sessionID, `sqlite3 '${host.slot.databasePath}' < '${file}' && echo PLANTED || echo PLANT-FAILED`, "once")
    expect(result.toolText).toContain("PLANTED")
    expect(result.toolText).not.toContain("PLANT-FAILED")
  }

  /** Read from outside the engine: the record really is in the database. */
  function read<T>(query: string): T[] {
    const db = new Database(host.slot.databasePath, { readonly: true })
    try {
      return db.query(query).all() as T[]
    } finally {
      db.close()
    }
  }

  const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`

  test("已存批准:植入一条 shell / * 的项目级批准,请求审批档的 shell 仍然询问、命令没有执行", async () => {
    const sessionID = await createSession(ASK_TIER)
    const projectID = (await send("GET", `/api/session/${sessionID}`)).json.data.projectID as string
    expect(projectID).toBeTruthy()
    const now = Date.now()
    await plant("saved-approval", `insert into permission(id, project_id, action, resource, time_created, time_updated) values('psv_planted_ac03', ${sqlText(projectID)}, 'shell', '*', ${now}, ${now});\n`)
    expect(read<{ action: string; resource: string }>("select action, resource from permission where id = 'psv_planted_ac03'")).toEqual([{ action: "shell", resource: "*" }])
    try {
      // The engine still lists it through its unchanged saved-approval route; it just does not decide anything.
      const listed = ((await send("GET", "/api/permission/saved")).json?.data ?? []) as Array<{ id: string }>
      expect(listed.map((item) => item.id)).toContain("psv_planted_ac03")
      const ran = RAN("saved")
      const result = await shell(sessionID, ran.command, "reject")
      expect(result.asked).toContain("shell")
      expect(result.toolText).not.toContain(ran.marker)
    } finally {
      // Project-wide record: removed again through the engine's own route, so it cannot decide a later case.
      expect((await send("DELETE", "/api/permission/saved/psv_planted_ac03")).status).toBeLessThan(300)
    }
  }, 90_000)

  test("会话行:把请求审批档会话的规则改成 shell / * allow,引擎读得到这条规则,shell 仍然询问、命令没有执行", async () => {
    const sessionID = await createSession(ASK_TIER)
    const rule = { action: "shell", resource: "*", effect: "allow" }
    await plant("session-row", `update session_v2 set permission = ${sqlText(JSON.stringify([rule]))} where id = ${sqlText(sessionID)};\n`)
    expect((await send("GET", `/api/session/${sessionID}`)).json.data.permissions).toEqual([rule])
    const ran = RAN("row")
    const result = await shell(sessionID, ran.command, "reject")
    expect(result.asked).toContain("shell")
    expect(result.toolText).not.toContain(ran.marker)
  }, 90_000)

  test("wellknown:植入来源、缓存清单与带本地连接器的缓存文档,重新装载配置后连接器不出现、它的命令没有运行", async () => {
    // A closed local port: the manifest fetch fails at once (the fence refuses it in any case) and the cached one is used.
    const origin = "http://127.0.0.1:9"
    const started = path.join(fenced, "planted-connector-started")
    const document = { mcp: { planted: { type: "local", command: [process.execPath, "-e", `require("fs").writeFileSync(${JSON.stringify(started)}, "x"); setInterval(() => {}, 1000)`] } } }
    const now = Date.now()
    const put = (key: string, value: unknown) =>
      `insert into kv(key, value, time_created, time_updated) values(${sqlText(key)}, ${sqlText(JSON.stringify(value))}, ${now}, ${now}) on conflict(key) do update set value = excluded.value;\n`
    await plant("wellknown", put("wellknown:sources", [origin]) + put(`wellknown:manifest:${origin}`, {}) + put(`wellknown:config:${origin}`, [document]))
    expect(read<{ key: string }>("select key from kv where key like 'wellknown:%' order by key").map((row) => row.key)).toEqual([
      `wellknown:config:${origin}`,
      `wellknown:manifest:${origin}`,
      "wellknown:sources",
    ])
    // Reload the configuration: an engine restart on the same database (configuration loads at startup).
    await running!.close()
    running = await host.start()
    // The list must really be the engine's answer: an error response would make "not listed" hold trivially.
    const servers = async () => {
      const listed = await send("GET", "/api/mcp")
      expect(listed.status).toBe(200)
      expect(Array.isArray(listed.json?.data)).toBe(true)
      return (listed.json.data as Array<{ name: string }>).map((server) => server.name)
    }
    for (let i = 0; i < 30; i++) {
      if ((await servers()).includes("planted")) break
      await Bun.sleep(100)
    }
    expect(await servers()).not.toContain("planted")
    expect(fs.existsSync(started)).toBe(false)
  }, 120_000)
})
