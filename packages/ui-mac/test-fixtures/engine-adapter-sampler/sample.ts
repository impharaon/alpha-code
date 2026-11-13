// `#1668`:重采引擎适配器的夹具(packages/ui-mac/src/engine-adapter/fixtures/*.json)。不进任何门;用法见 README.md。
//
// 起一个隔离的 2.x 引擎(本仓 packages/cli `serve`,临时 HOME/XDG、临时 git 项目)与同目录的假模型,跑五个剧本,
// 每条 `/api/event` 帧之后立刻读一次该会话的消息页(适配器投影器那一刻读到的),写成夹具;再经适配器实测会话级
// 「总是允许」(打印结果,不写夹具)与 reject 连带、重放、二次回复、会话内放行(写 permission-reply.json;
// 只重采这一份:`bun sample.ts permission`)。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createEngineFetch } from "../../src/engine-adapter/index"
import { requestFingerprint } from "../../src/engine-adapter/contract/receipts"
import { startMockModel } from "./mock-model"

const REPO = resolve(import.meta.dir, "../../../..")
const OUT = resolve(import.meta.dir, "../../src/engine-adapter/fixtures")
const SOURCE_PATH = "packages/ui-mac/test-fixtures/engine-adapter-sampler/sample.ts"
const ENGINE_PORT = Number(process.env.SAMPLER_ENGINE_PORT ?? 47911)
const MODEL_PORT = Number(process.env.SAMPLER_MODEL_PORT ?? 47920)

// 只跑点名的剧本:`bun sample.ts tools continue files command`;不点名 = 全部。
const only = new Set(process.argv.slice(2))
const run = (name: string) => only.size === 0 || only.has(name)

const commit = Bun.spawnSync(["git", "-C", REPO, "rev-parse", "--short=10", "HEAD"]).stdout.toString().trim()
const source = (what: string) =>
  `Sampled by \`bun ${SOURCE_PATH}\` (alpha-code#1668 L6) at ${commit}: a real OpenCode 2 engine from this repo's packages/cli \`serve\`, ` +
  `isolated HOME/XDG, one git project, and the scripted OpenAI-compatible mock model next to the sampler. ${what}`

// ── 隔离环境 ──
const root = mkdtempSync(join(tmpdir(), "codepuppy-sampler-"))
const home = join(root, "home")
const project = join(root, "proj")
mkdirSync(join(home, ".config/opencode"), { recursive: true })
mkdirSync(project, { recursive: true })
writeFileSync(join(project, "a.txt"), "hi\n")
writeFileSync(join(project, ".env"), "SECRET=1\n")
writeFileSync(join(project, "other.env"), "X=1\n")
for (const args of [["init", "-q"], ["add", "a.txt"], ["-c", "user.email=s@s", "-c", "user.name=s", "commit", "-qm", "init"]])
  Bun.spawnSync(["git", ...args], { cwd: project })
writeFileSync(
  join(home, ".config/opencode/opencode.json"),
  JSON.stringify({
    model: "mock/m",
    providers: {
      mock: {
        name: "Mock",
        package: "@ai-sdk/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${MODEL_PORT}/v1`, apiKey: "x" },
        models: {
          m: { name: "Mock M", capabilities: { tools: true } },
          // 2.x 只给 id 含 `gpt-` 的模型 patch 工具(core/src/tool/plugin/patch.ts 的 context 钩子)
          "gpt-5-mock": { name: "Mock GPT", capabilities: { tools: true } },
        },
      },
    },
    commands: { hello: { template: "say hello plainly", description: "Say hello" } },
  }),
)

const model = startMockModel(MODEL_PORT)
const engine = Bun.spawn(
  [process.execPath, "run", "--cwd", join(REPO, "packages/cli"), "src/index.ts", "serve", "--port", String(ENGINE_PORT), "--hostname", "127.0.0.1"],
  {
    cwd: project,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: home,
      XDG_DATA_HOME: join(home, ".local/share"),
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_STATE_HOME: join(home, ".local/state"),
      XDG_CACHE_HOME: join(home, ".cache"),
      TERM: "dumb",
    },
    stdout: "pipe",
    stderr: "inherit",
  },
)

/** 引擎启动时打印一次性口令;读到它才算起来了(口令只在这个进程里用,不落盘、不打印)。 */
async function enginePassword() {
  const reader = engine.stdout.getReader()
  const decoder = new TextDecoder()
  let text = ""
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    const match = /server password (\S+)/.exec(text)
    if (match) {
      reader.releaseLock()
      return match[1]!
    }
  }
  throw new Error("engine did not report a password")
}

const password = await enginePassword()
const BASE = `http://127.0.0.1:${ENGINE_PORT}`
const HEADERS = { authorization: `Basic ${btoa(`opencode:${password}`)}`, "content-type": "application/json" }
const loc = `location%5Bdirectory%5D=${encodeURIComponent(project)}`

async function exchange(method: string, path: string, body?: unknown, via: typeof fetch = fetch) {
  const response = await via(`${BASE}${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : undefined
  } catch {
    parsed = text
  }
  return { status: response.status, body: parsed as any }
}
const call = async (method: string, path: string, body?: unknown) => (await exchange(method, path, body)).body

// 适配器(与 renderer 同一个 createEngineFetch);口令在生产由 main 补,这里由包一层 fetch 补。
const adapterFetch = createEngineFetch({
  isEngineOrigin: (origin) => origin === BASE,
  fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    request.headers.set("authorization", HEADERS.authorization)
    return fetch(request)
  }) as typeof fetch,
}) as typeof fetch
const viaAdapter = (method: string, path: string, body?: unknown) => exchange(method, path, body, adapterFetch)

// ── 事件录制:每帧之后读一次消息页;到达回合边界时(turn-diff 剧本)再读一次逐回合 diff ──
type Record_ = { frame: any; snapshot?: unknown; diff?: unknown }
const records: Record_[] = []
const hooks: Array<(frame: any) => Promise<void>> = []
const userOf = new Map<string, string>()
const diffSessions = new Set<string>()
const stop = new AbortController()
const subscription = (async () => {
  const response = await fetch(`${BASE}/api/event`, { headers: HEADERS, signal: stop.signal })
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n")
        if (!data) continue
        const frame = JSON.parse(data)
        const record: Record_ = { frame }
        records.push(record)
        const sessionID: string | undefined = frame.data?.sessionID
        if (sessionID) record.snapshot = await call("GET", `/api/session/${sessionID}/message?order=desc&limit=20`)
        if (frame.type === "session.inbox.delivered" && sessionID) userOf.set(sessionID, frame.data.inboxID)
        if (sessionID && diffSessions.has(sessionID) && /^session\.(step\.ended|execution\.(succeeded|failed|interrupted))$/.test(frame.type))
          record.diff = await call("GET", `/api/session/${sessionID}/diff?from=${userOf.get(sessionID)}`)
        for (const hook of hooks) await hook(frame)
      }
    }
  } catch {}
})()
await Bun.sleep(400)

async function idle(sessionID: string, turns = 1) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const ended = records.filter(
      (record) => record.frame.data?.sessionID === sessionID && /^session\.execution\.(succeeded|failed|interrupted)$/.test(record.frame.type),
    )
    if (ended.length >= turns) return
    await Bun.sleep(100)
  }
  throw new Error(`session ${sessionID} did not go idle`)
}

const sessionOf = (frame: any): string | undefined => frame.data?.sessionID ?? frame.data?.form?.sessionID
const recordsOf = (sessionID: string) =>
  records.filter((record) => sessionOf(record.frame) === sessionID).map(({ frame, snapshot, diff }) => ({
    frame,
    ...(snapshot !== undefined ? { snapshot } : {}),
    ...(diff !== undefined ? { diff } : {}),
  }))
const create = async () => (await call("POST", "/api/session", { location: { directory: project } })).data.id as string
const finalOf = async (sessionID: string) => (await call("GET", `/api/session/${sessionID}/message?order=asc&limit=200`)).data
const write = (name: string, value: unknown) => writeFileSync(join(OUT, name), JSON.stringify(value, null, 1))

try {
  if (run("base")) {
    // 1. read-tool:思考 + 正文 + 读文件;用户消息带一个 I11' 暂存附件条目(data: URI 声明自定义 mime,引擎嗅探成 text/plain)
    const meta = { v: 1, name: "x.pdf", mime: "application/pdf", size: 3, path: "attachments/00000000-0000-4000-8000-000000000000/x.pdf", reader: "pdf" }
    const read = await create()
    const prompt = await call("POST", `/api/session/${read}/prompt`, {
      text: "read a.txt please",
      files: [{ uri: `data:application/vnd.codepuppy.attachment+json;base64,${Buffer.from(JSON.stringify(meta)).toString("base64")}`, name: "codepuppy-attachment.json" }],
    })
    await idle(read)
    write("read-tool.json", {
      _source: source("Records = /api/event frames, each with the GET /api/session/:id/message?order=desc&limit=20 read right after it; `final` = order=asc after idle."),
      directory: project,
      sessionID: read,
      records: recordsOf(read),
      final: await finalOf(read),
      prompt: { status: 200, body: prompt },
    })

    // 2. todo:todowrite 三条任务
    const todo = await create()
    await call("POST", `/api/session/${todo}/prompt`, { text: "make a todo list" })
    await idle(todo)
    write("todo.json", { _source: source("Same recording as read-tool.json; the mock calls todowrite."), directory: project, sessionID: todo, records: recordsOf(todo), final: await finalOf(todo) })

    // 3. question:提问表单,答 Blue
    const question = await create()
    let formList: unknown
    hooks.push(async (frame) => {
      if (frame.type !== "form.created" || frame.data?.form?.sessionID !== question) return
      formList = await call("GET", `/api/form?${loc}`)
      await call("POST", `/api/session/${question}/form/${frame.data.form.id}/reply`, { answer: { q0: "Blue" } })
    })
    await call("POST", `/api/session/${question}/prompt`, { text: "ask me something" })
    await idle(question)
    write("question.json", {
      _source: source("Same recording as read-tool.json; the mock calls question and the sampler answers Blue."),
      directory: project,
      sessionID: question,
      records: recordsOf(question),
      final: await finalOf(question),
      formList,
    })

    // 4. permission-asked:读 .env ⇒ build agent 询问;记下原始帧与同一时刻的待审列表,答 once
    const permission = await create()
    let asked: unknown
    let list: unknown
    hooks.push(async (frame) => {
      if (frame.type !== "permission.asked" || frame.data?.sessionID !== permission || asked) return
      asked = frame
      list = await call("GET", `/api/permission/request?${loc}`)
      await call("POST", `/api/session/${permission}/permission/${frame.data.id}/reply`, { decision: "once" })
    })
    await call("POST", `/api/session/${permission}/prompt`, { text: "read my secret" })
    await idle(permission)
    write("permission-asked.json", {
      _source: source(
        "The build agent's `read *.env` ask fired on a mock `read .env`. `frame` is the raw permission.asked frame; `list` is GET /api/permission/request right after it. No ext runs here, so metadata is empty; tests add the four I7a keys.",
      ),
      frame: asked,
      list,
    })

    // 5. turn-diff:写 b.txt;每个步结束与回合结束时读 GET /api/session/:id/diff?from=<用户消息>
    const turn = await create()
    diffSessions.add(turn)
    await call("POST", `/api/session/${turn}/prompt`, { text: "write a file" })
    await idle(turn)
    write("turn-diff.json", {
      _source: source(
        "One turn whose mock tool call writes b.txt. Records at session.step.ended / session.execution.* also carry `diff` = GET /api/session/:id/diff?from=<the turn's user message> taken then (REQ-142); top-level `diff` is the same call after idle.",
      ),
      directory: project,
      sessionID: turn,
      userID: userOf.get(turn),
      records: recordsOf(turn),
      final: await finalOf(turn),
      diff: await call("GET", `/api/session/${turn}/diff?from=${userOf.get(turn)}`),
    })
  }

  if (run("base") || run("permission")) {
    // 6. 会话级「总是允许」,经适配器:界面的 v1 回复 `/permission/:id/reply {reply:"always"}` ⇒ 适配器原样发 always,
    //    内核给这个会话记 save 的每一项(build 档位读 .env 时是 `*`)。同一资源、另一资源都不再问(打印,不写夹具)。
    const always = await create()
    const asks: any[] = []
    const alwaysReplies: unknown[] = []
    hooks.push(async (frame) => {
      if (frame.type !== "permission.asked" || frame.data?.sessionID !== always) return
      asks.push(frame.data)
      await viaAdapter("GET", `/permission?directory=${encodeURIComponent(project)}`)
      const reply = asks.length === 1 ? "always" : "reject"
      alwaysReplies.push((await viaAdapter("POST", `/permission/${frame.data.id}/reply`, { reply })).status)
    })
    await call("POST", `/api/session/${always}/prompt`, { text: "read my secret" })
    await idle(always, 1)
    const afterFirst = asks.length
    await call("POST", `/api/session/${always}/prompt`, { text: "read my secret again" })
    await idle(always, 2)
    const afterSame = asks.length
    await call("POST", `/api/session/${always}/prompt`, { text: "read the other file" })
    await idle(always, 3)
    const rules = (await call("GET", `/api/session/${always}`)).data.permissions
    console.log(
      JSON.stringify({
        sessionScopedAlways: { afterFirst, afterSame, afterOther: asks.length, expected: { afterFirst: 1, afterSame: 1, afterOther: 1 }, alwaysReplies, rules },
      }),
    )

    // 7. permission-reply:同一会话两条待审(A1 .env、A2 other.env)、另一会话一条(B1);经适配器的 v2 入口 reject A1,
    //    收据应列 A1+A2、B1 不动;同一命令重放 ⇒ 同一张收据;直接对引擎再回 A1 ⇒ 404(前提 iii)。原始帧与响应写成夹具。
    const sessionA = await create()
    const sessionB = await create()
    const askVia = (sessionID: string, path: string) =>
      exchange("POST", `/api/session/${sessionID}/permission`, { agent: "build", action: "read", resources: [path], save: ["*"] })
    const created = [await askVia(sessionA, ".env"), await askVia(sessionA, "other.env"), await askVia(sessionB, ".env")]
    const [a1, a2, b1] = created.map((item) => item.body.data.id as string)
    await Bun.sleep(300)
    const pendingA = await exchange("GET", `/api/session/${sessionA}/permission`)
    const getA1 = await exchange("GET", `/api/session/${sessionA}/permission/${a1}`)
    // 指纹按适配器交给界面的那份 v1 请求、用回执账本导出的同一个函数算(设计 §4.8)
    const shown = async (id: string) =>
      ((await viaAdapter("GET", `/permission?directory=${encodeURIComponent(project)}`)).body as any[]).find((request) => request.id === id)
    const command = { requestFingerprint: await requestFingerprint(await shown(a1)), decisionID: "pdec_sampler_reject", decision: "reject" }
    const rejected = await viaAdapter("POST", `/api/session/${sessionA}/permission/${a1}/reply`, command)
    const replay = await viaAdapter("POST", `/api/session/${sessionA}/permission/${a1}/reply`, command)
    const replyAgain = await exchange("POST", `/api/session/${sessionA}/permission/${a1}/reply`, { decision: "once" })
    const pendingB = await exchange("GET", `/api/session/${sessionB}/permission`)
    const settled = await exchange("POST", `/api/session/${sessionB}/permission/${b1}/reply`, { decision: "once" })
    await Bun.sleep(300)
    // 会话内允许(I-05 契约 A):C1 a.env、C2 ab.env(save ["a*"]),经适配器 v2 入口对 C1 回 always ⇒ 收据应列 C1+C2、
    // 会话规则不被写;之后在 C 里再问 a.env 直接 allow,再问 b.env(save 覆盖不到)仍要问,另一会话 D 问 a.env 仍要问。
    const askSaving = (sessionID: string, path: string) =>
      exchange("POST", `/api/session/${sessionID}/permission`, { agent: "build", action: "read", resources: [path], save: ["a*"] })
    const sessionC = await create()
    const sessionD = await create()
    const [c1, c2] = [await askSaving(sessionC, "a.env"), await askSaving(sessionC, "ab.env")].map((item) => item.body.data.id as string)
    await Bun.sleep(300)
    const alwaysCommand = {
      requestFingerprint: await requestFingerprint(await shown(c1)),
      decisionID: "pdec_sampler_always",
      decision: "always",
      grantScope: { kind: "project", projectID: "unused-by-the-adapter" },
      grantExpiresAt: null,
    }
    const allowed = await viaAdapter("POST", `/api/session/${sessionC}/permission/${c1}/reply`, alwaysCommand)
    const sessionAlways = {
      ids: { sessionC, c1, c2, sessionD },
      command: alwaysCommand,
      allowed,
      pendingAfter: await exchange("GET", `/api/session/${sessionC}/permission`),
      rules: (await call("GET", `/api/session/${sessionC}`)).data.permissions,
      askSame: await askSaving(sessionC, "a.env"),
      askOther: await askSaving(sessionC, "b.env"),
      askOtherSession: await askSaving(sessionD, "a.env"),
    }
    const frames = records
      .map((record) => record.frame)
      .filter((frame) => /^permission\.(asked|replied)$/.test(frame.type) && [sessionA, sessionB].includes(frame.data?.sessionID))
    write("permission-reply.json", {
      _source: source(
        "Three asks created with POST /api/session/:id/permission (agent build, read, save [\"*\"]): A1 .env and A2 other.env in session A, B1 .env in session B. " +
          "`frames` = every permission.asked / permission.replied frame of A and B in arrival order. `pendingA` / `getA1` are the raw engine reads before replying; " +
          "`rejected` / `replay` are the adapter's v2 reply route for A1 (reject, then the same command again; the command's fingerprint is computed over the request as the adapter's GET /permission displays it); `replyAgain` is a raw second engine reply to A1; " +
          "`pendingB` is B's list after the reject; `settled` is the raw once reply to B1. " +
          "`sessionAlways`: C1 a.env and C2 ab.env (save [\"a*\"]) in session C; `allowed` is the adapter's v2 reply route for C1 with decision always; " +
          "`pendingAfter` / `rules` are C's pending list and session rules right after; `askSame` / `askOther` are fresh POST /api/session/:id/permission for a.env / b.env in C, " +
          "`askOtherSession` the same for a.env in a new session D.",
      ),
      ids: { sessionA, sessionB, a1, a2, b1 },
      created,
      pendingA,
      getA1,
      command,
      rejected,
      replay,
      replyAgain,
      pendingB,
      settled,
      frames,
      sessionAlways,
    })
  }

  // ── #1668 R1 修复(F1–F4)的剧本:`bun sample.ts tools continue files command` ──
  // 这些剧本里的审批一律答 once(edit / shell / patch / subagent 在 build 档位可能询问,子会话也算)。
  let autoAllow = false
  hooks.push(async (frame) => {
    if (!autoAllow || frame.type !== "permission.asked") return
    await call("POST", `/api/session/${frame.data.sessionID}/permission/${frame.data.id}/reply`, { decision: "once" })
  })
  const fsFrames = (from: number) => records.slice(from).filter((record) => record.frame.type === "filesystem.changed").map((record) => record.frame)

  if (run("tools")) {
    // F1:冻结工具卡读的键。每个工具一个会话;patch 只给 gpt- 模型,先切模型。
    autoAllow = true
    writeFileSync(join(project, "p0.txt"), "hi\n")
    const scripts: Record<string, string> = {
      delegate: "delegate this",
      background: "background delegate",
      edit: "edit a.txt now",
      shell: "run shell",
      patch: "patchfile",
    }
    const sessions: Record<string, unknown> = {}
    for (const [name, text] of Object.entries(scripts)) {
      const sessionID = await create()
      if (name === "patch") await call("POST", `/api/session/${sessionID}/model`, { model: { providerID: "mock", id: "gpt-5-mock" } })
      await call("POST", `/api/session/${sessionID}/prompt`, { text })
      await idle(sessionID)
      if (name === "background") await Bun.sleep(1_500)
      // 逐帧记录只留前台 subagent 的(运行中的子会话 id 只在帧里);其余工具只用完成后的消息。
      sessions[name] = { sessionID, ...(name === "delegate" ? { records: recordsOf(sessionID) } : {}), final: await finalOf(sessionID) }
    }
    autoAllow = false
    write("tools.json", {
      _source: source(
        "One session per tool the frozen tool cards read: foreground subagent, background subagent, edit a.txt, shell `echo hi`, patch (session switched to the mock `gpt-5-mock` model, the only kind 2.x gives the patch tool). Each entry has `final` (order=asc after idle); the foreground subagent also has records (frames with the message page read after each). Permission asks were answered once.",
      ),
      directory: project,
      sessions,
    })
  }

  if (run("continue")) {
    // F2:时间线「继续」经适配器(v1 prompt_async,全部 synthetic 文本)发出;它那个回合写 c.txt。对照:另一个会话用 2.x 的
    // synthetic 消息续写,再拿它当 diff 的 from(引擎拒绝)。
    const sessionID = await create()
    diffSessions.add(sessionID)
    await call("POST", `/api/session/${sessionID}/prompt`, { text: "read a.txt please" })
    await idle(sessionID)
    const continued = await viaAdapter("POST", `/session/${sessionID}/prompt_async`, { parts: [{ type: "text", text: "Continue", synthetic: true }] })
    await idle(sessionID, 2)
    const legacy = await create()
    await call("POST", `/api/session/${legacy}/prompt`, { text: "read a.txt please" })
    await idle(legacy)
    const synthetic = await call("POST", `/api/session/${legacy}/synthetic`, { text: "Continue", description: "Continue", resume: true })
    await idle(legacy, 2)
    write("continue.json", {
      _source: source(
        "Turn 1 `read a.txt please`; turn 2 is the timeline's Continue sent through the adapter (POST /session/:id/prompt_async, one synthetic text part), whose mock call writes c.txt. Records carry the message page after each frame and, at step / execution boundaries, `diff` = GET /api/session/:id/diff?from=<that turn's user message>. `legacy` = the same continuation as a 2.x synthetic message, and the diff asked with it as `from`.",
      ),
      directory: project,
      sessionID,
      continued: { status: continued.status },
      continueID: userOf.get(sessionID),
      records: recordsOf(sessionID),
      final: await finalOf(sessionID),
      diff: await call("GET", `/api/session/${sessionID}/diff?from=${userOf.get(sessionID)}`),
      legacy: {
        sessionID: legacy,
        syntheticID: synthetic.data.id,
        final: await finalOf(legacy),
        diff: await exchange("GET", `/api/session/${legacy}/diff?from=${synthetic.data.id}`),
      },
    })
  }

  if (run("files")) {
    // F3:filesystem.changed 什么时候来。① 助手写 b.txt 的回合;② 项目里从外面新建再删除一个文件;③ fs.watch a.txt 后从外面改它。
    rmSync(join(project, "b.txt"), { force: true })
    const sessionID = await create()
    diffSessions.add(sessionID)
    const turnFrom = records.length
    await call("POST", `/api/session/${sessionID}/prompt`, { text: "write a file" })
    await idle(sessionID)
    await Bun.sleep(1_000)
    const turnFrames = fsFrames(turnFrom)
    const externalFrom = records.length
    writeFileSync(join(project, "ext.txt"), "x\n")
    await Bun.sleep(1_500)
    rmSync(join(project, "ext.txt"))
    await Bun.sleep(1_500)
    const externalFrames = fsFrames(externalFrom)
    const watch = await exchange("POST", `/api/experimental/fs/watch?${loc}`, { path: "a.txt" })
    const watchedFrom = records.length
    writeFileSync(join(project, "a.txt"), "changed\n")
    await Bun.sleep(1_500)
    write("files.json", {
      _source: source(
        "`turnFrames` = every filesystem.changed frame (any session or none) during a turn whose mock call writes b.txt; `externalFrames` = the same while ext.txt is created then removed in the project from outside; `watch` = POST /api/experimental/fs/watch {path: a.txt}, `watchedFrames` = filesystem.changed frames after a.txt is then rewritten from outside. Records / final / diff as in turn-diff.json for the b.txt turn.",
      ),
      directory: project,
      sessionID,
      records: recordsOf(sessionID),
      diff: await call("GET", `/api/session/${sessionID}/diff?from=${userOf.get(sessionID)}`),
      turnFrames,
      externalFrames,
      watch: { status: watch.status },
      watchedFrames: fsFrames(watchedFrom),
    })
  }

  if (run("command")) {
    // F4:配置命令 hello(模板 "say hello plainly")。先直接对引擎发 2.x command(看它回什么、回时会话是否已在跑),再经适配器
    // 发 v1 command(composer 读回的 info.id)。
    const raw = await create()
    const rawCommand = await exchange("POST", `/api/session/${raw}/command`, { name: "hello", text: "" })
    const activeAfter = await call("GET", "/api/session/active")
    await idle(raw)
    const sessionID = await create()
    const reply = await viaAdapter("POST", `/session/${sessionID}/command`, { command: "hello", arguments: "" })
    await idle(sessionID)
    write("command.json", {
      _source: source(
        "Config command `hello` (template `say hello plainly`). `rawCommand` = POST /api/session/:id/command straight to the engine, `activeAfter` = GET /api/session/active right after it returned; `reply` = the adapter's v1 POST /session/:id/command for a second session, whose records / final follow.",
      ),
      directory: project,
      raw: { sessionID: raw, rawCommand, activeAfter },
      sessionID,
      reply,
      records: recordsOf(sessionID),
      final: await finalOf(sessionID),
    })
  }

  if (run("parity")) {
    // 0.1.26 对照的四处差异:① 读目录;② 运行中 shell 的输出(进度帧给 shellID,按游标读 /api/shell/:id/output);
    // ③ 慢的后台子会话:父会话先收尾,完成通知(2.x synthetic)再开一个写 b.txt 的回合 —— 分别拿各种 from 问 diff;
    // ④ 外部编辑:fs.watch 能不能看目录、看着的文件被删 / 旁边新建文件各来什么帧。
    autoAllow = true
    mkdirSync(join(project, "sub/inner"), { recursive: true })
    writeFileSync(join(project, "sub/one.txt"), "1\n")
    writeFileSync(join(project, "sub/two.txt"), "2\n")
    rmSync(join(project, "b.txt"), { force: true })

    const dir = await create()
    await call("POST", `/api/session/${dir}/prompt`, { text: "list the folder" })
    await idle(dir)

    const shell = await create()
    const pages: Array<{ at: number; cursor: number; page: unknown }> = []
    let shellDone = false
    hooks.push(async (frame) => {
      if (frame.data?.sessionID !== shell) return
      if (frame.type === "session.tool.success" || frame.type === "session.tool.failed") shellDone = true
      if (frame.type !== "session.tool.progress" || !frame.data.metadata?.shellID) return
      const id = frame.data.metadata.shellID as string
      void (async () => {
        let cursor = 0
        while (!shellDone) {
          const page = await call("GET", `/api/shell/${id}/output?${loc}&cursor=${cursor}`)
          pages.push({ at: Date.now(), cursor, page })
          if (typeof page?.data?.cursor === "number") cursor = page.data.cursor
          await Bun.sleep(150)
        }
      })()
    })
    await call("POST", `/api/session/${shell}/prompt`, { text: "slow shell" })
    await idle(shell)

    const background = await create()
    await call("POST", `/api/session/${background}/prompt`, { text: "slow background" })
    await idle(background, 2)
    await Bun.sleep(500)
    const backgroundFinal = await finalOf(background)
    const synthetic = backgroundFinal.findLast((message: any) => message.type === "synthetic")
    const user = backgroundFinal.findLast((message: any) => message.type === "user")
    const backgroundDiffs = {
      latest: await exchange("GET", `/api/session/${background}/diff`),
      fromUser: await exchange("GET", `/api/session/${background}/diff?from=${user?.id}`),
      fromSynthetic: await exchange("GET", `/api/session/${background}/diff?from=${synthetic?.id}`),
    }

    const watchFrom = records.length
    writeFileSync(join(project, "w.txt"), "w\n")
    const watches = {
      directory: await exchange("POST", `/api/experimental/fs/watch?${loc}`, { path: "sub" }),
      root: await exchange("POST", `/api/experimental/fs/watch?${loc}`, { path: "." }),
      file: await exchange("POST", `/api/experimental/fs/watch?${loc}`, { path: "w.txt" }),
    }
    writeFileSync(join(project, "sub/three.txt"), "3\n")
    writeFileSync(join(project, "new.txt"), "n\n")
    await Bun.sleep(1_500)
    const createdFrames = fsFrames(watchFrom)
    const unlinkFrom = records.length
    rmSync(join(project, "w.txt"))
    await Bun.sleep(1_500)
    autoAllow = false
    write("parity.json", {
      _source: source(
        "0.1.26 parity probes. `dir` = a session whose mock reads the directory sub (sub/one.txt, sub/two.txt, sub/inner/). `shell` = a session whose mock runs a shell printing line1..line3 0.4 s apart: records, plus `pages` = GET /api/shell/:id/output?cursor= every 150 ms from the tool's progress frame (metadata.shellID) until the tool settled. `background` = a background subagent whose child answers after 2.5 s, so the parent goes idle first and the completion notice (a 2.x synthetic) starts a turn that writes b.txt; `diffs` asks GET /api/session/:id/diff with no from, from the user message, and from the synthetic. `watches` = POST /api/experimental/fs/watch for a directory, for `.`, and for the file w.txt; `createdFrames` = filesystem.changed after sub/three.txt and new.txt are created from outside; `unlinkFrames` = after w.txt is removed from outside.",
      ),
      directory: project,
      dir: { sessionID: dir, final: await finalOf(dir) },
      shell: { sessionID: shell, records: recordsOf(shell), pages, final: await finalOf(shell) },
      background: { sessionID: background, final: backgroundFinal, diffs: backgroundDiffs },
      watches,
      createdFrames,
      unlinkFrames: fsFrames(unlinkFrom),
    })
  }

  // ── `#1697` I-04 M2a:目录类的原始 2.x 响应(适配器 GET /agent、GET /provider 的输入),给翻译器自有投影的等价核对 ──
  if (run("catalog")) {
    const fresh = await create() // 新建、还没提问的会话:2.x 不给标题
    write("catalog.json", {
      _source: source(
        "Raw 2.x catalog responses for the project location, as the adapter's GET /agent and GET /provider read them: GET /api/agent, GET /api/provider, GET /api/model, GET /api/model/default; and GET /api/session (what GET /session translates and what the /api/session passthrough returns) right after creating freshSessionID, which has no prompt and so no title. 2.x provider config takes no model status (a declared status deprecated comes back active), so no deprecated model can be sampled here; the parity test derives one by flipping a sampled model's status.",
      ),
      directory: project,
      agents: await call("GET", `/api/agent?${loc}`),
      providers: await call("GET", `/api/provider?${loc}`),
      models: await call("GET", `/api/model?${loc}`),
      defaultModel: await call("GET", `/api/model/default?${loc}`),
      freshSessionID: fresh,
      sessions: await call("GET", `/api/session?${loc}&limit=200`),
    })
  }

  // ── `#1697` I-04 M2a:消息谱系里其余几种(切档位、`!` shell、压缩),给翻译器自有消息投影的等价核对 ──
  if (run("lineage")) {
    autoAllow = true
    const sessionID = await create()
    const at = `?directory=${encodeURIComponent(project)}`
    const settled = async (done: (messages: any[]) => boolean) => {
      for (let attempt = 0; attempt < 300; attempt++) {
        if (done(await finalOf(sessionID))) return
        await Bun.sleep(100)
      }
      throw new Error(`session ${sessionID} did not settle`)
    }
    // 经适配器发(与界面同一条路):带档位的发送 ⇒ 2.x 先切档位再提问;「压缩对话」;composer 的 `!` 命令
    const sent = async (path: string, body: unknown) => {
      const response = await viaAdapter("POST", `/session/${sessionID}/${path}${at}`, body)
      if (response.status >= 300) throw new Error(`${path} via the adapter: ${response.status} ${JSON.stringify(response.body)}`)
    }
    await sent("prompt_async", { agent: "build", parts: [{ type: "text", text: "say hello plainly" }] })
    await idle(sessionID)
    // 压缩在 shell 之前:消息投影把压缩挂在最近一条用户消息上,shell 之后没有可挂的
    await sent("summarize", {})
    await settled((messages) => messages.some((message) => message.type === "compaction" && message.status !== "running"))
    await sent("shell", { command: "echo lineage" })
    await settled((messages) => messages.some((message) => message.type === "shell" && message.status !== "running"))
    write("lineage.json", {
      _source: source(
        "Message lineage: via the adapter, a prompt with agent build (2.x records agent-switched first; permission asks answered once), then summarize (compaction), then a composer shell command echo lineage. `final` = order=asc once the compaction settled and the shell exited.",
      ),
      directory: project,
      sessionID,
      final: await finalOf(sessionID),
    })
    autoAllow = false
  }

  console.log(`fixtures written to ${OUT}`)
} finally {
  stop.abort()
  await subscription.catch(() => {})
  engine.kill()
  model.stop(true)
}
