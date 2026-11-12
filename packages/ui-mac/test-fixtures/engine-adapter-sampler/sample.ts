// `#1668`:重采引擎适配器的夹具(packages/ui-mac/src/engine-adapter/fixtures/*.json)。不进任何门;用法见 README.md。
//
// 起一个隔离的 2.x 引擎(本仓 packages/cli `serve`,临时 HOME/XDG、临时 git 项目)与同目录的假模型,跑五个剧本,
// 每条 `/api/event` 帧之后立刻读一次该会话的消息页(适配器投影器那一刻读到的),写成夹具;再经适配器实测会话级
// 「总是允许」(打印结果,不写夹具)与 reject 连带、重放、二次回复(写 permission-reply.json)。
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createEngineFetch } from "../../src/engine-adapter/index"
import { requestFingerprint } from "../../src/engine-adapter/permission-replies"
import { startMockModel } from "./mock-model"

const REPO = resolve(import.meta.dir, "../../../..")
const OUT = resolve(import.meta.dir, "../../src/engine-adapter/fixtures")
const SOURCE_PATH = "packages/ui-mac/test-fixtures/engine-adapter-sampler/sample.ts"
const ENGINE_PORT = Number(process.env.SAMPLER_ENGINE_PORT ?? 47911)
const MODEL_PORT = Number(process.env.SAMPLER_MODEL_PORT ?? 47920)

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
        models: { m: { name: "Mock M", capabilities: { tools: true } } },
      },
    },
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

  // 6. 会话级「总是允许」,经适配器:界面的 v1 回复 `/permission/:id/reply {reply:"always"}` ⇒ 适配器给会话追加只覆盖
  //    所问动作与资源的规则 + 回 once。同一资源不再问,另一资源照样问(打印,不写夹具)。
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
      sessionScopedAlways: { afterFirst, afterSame, afterOther: asks.length, expected: { afterFirst: 1, afterSame: 1, afterOther: 2 }, alwaysReplies, rules },
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
  await viaAdapter("GET", `/permission?directory=${encodeURIComponent(project)}`)
  const command = { requestFingerprint: await requestFingerprint(getA1.body.data), decisionID: "pdec_sampler_reject", decision: "reject" }
  const rejected = await viaAdapter("POST", `/api/session/${sessionA}/permission/${a1}/reply`, command)
  const replay = await viaAdapter("POST", `/api/session/${sessionA}/permission/${a1}/reply`, command)
  const replyAgain = await exchange("POST", `/api/session/${sessionA}/permission/${a1}/reply`, { decision: "once" })
  const pendingB = await exchange("GET", `/api/session/${sessionB}/permission`)
  const settled = await exchange("POST", `/api/session/${sessionB}/permission/${b1}/reply`, { decision: "once" })
  await Bun.sleep(300)
  const frames = records
    .map((record) => record.frame)
    .filter((frame) => /^permission\.(asked|replied)$/.test(frame.type) && [sessionA, sessionB].includes(frame.data?.sessionID))
  write("permission-reply.json", {
    _source: source(
      "Three asks created with POST /api/session/:id/permission (agent build, read, save [\"*\"]): A1 .env and A2 other.env in session A, B1 .env in session B. " +
        "`frames` = every permission.asked / permission.replied frame of A and B in arrival order. `pendingA` / `getA1` are the raw engine reads before replying; " +
        "`rejected` / `replay` are the adapter's v2 reply route for A1 (reject, then the same command again); `replyAgain` is a raw second engine reply to A1; " +
        "`pendingB` is B's list after the reject; `settled` is the raw once reply to B1.",
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
  })
  console.log(`fixtures written to ${OUT}`)
} finally {
  stop.abort()
  await subscription.catch(() => {})
  engine.kill()
  model.stop(true)
}
