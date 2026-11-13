// `#1669`:同一个对话里切回「全部批准」/ 默认助手,引擎的下一轮真的回到默认助手(0.1.26 的语义)。
//
// 0.1.26:不带 agent 的消息由默认助手跑(packages/opencode/src/session/prompt.ts createUserMessage:
// `agentName ? agents.get(agentName) : agents.defaultInfo()`;命令同,`cmd.agent ?? input.agent`)。界面据此在「全部批准」+
// 默认助手时**不带** agent(composer-state.ts buildPromptRequest / tierAgent;命令只带档位强制的 agent;时间线「继续」同一张表)。
// 2.x 把助手记在会话上(core session.ts switchAgent → session.agent,context.ts 按它选助手):适配器若只在带了 agent 时才切,
// 切回默认的那一条照旧由上一条的只读 / 请求审批 / 计划助手跑 —— 界面写着「全部批准」,引擎却不让改文件或逐次询问。
//
// 判据都在真入口上:界面的请求构造(buildPromptRequest、tierAgent,与 codepuppy-composer / use-projects / session-timeline
// 同样展开)→ 界面用的同一个 v2 SDK 客户端 → 生产的 createEngineFetch → 真监听端口的嵌入式 OpenCode 2(生产注入 + 真 ext,
// test-component/codepuppy-engine.ts)。每一轮在引擎一侧看:这一轮由哪个助手跑(助手消息的 `agent`)、模型这一轮手里有没有
// write、模型调一次 write 的结局(写下 / 先问 / 没写下)。
//   · 普通发送:同一个对话 只读 → 默认 → 请求审批 → 默认 → 计划 → 默认,每次切回默认那一轮由 build 跑、文件直接写下。
//   · 斜杠命令:只读、计划之后在「全部批准」下发命令,命令那一轮由 build 跑、文件写下。
//   · 「继续」:只读之后在「全部批准」下点继续,那一轮由 build 跑、模型手里有 write。
//   · 终端命令:只读之后,不带 agent 的 shell 把会话的助手切回默认(0.1.26 的 shell 要求带 agent,界面总是带;这里只判缺席时同一语义)。
//   · 量具自检:直接对引擎发、不切助手 ⇒ 下一轮照旧由上一轮的只读助手跑 —— 2.x 确实记住会话的助手,上面几条判得出差别。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录;凭据是合成的。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { createOpencodeClient, type ModelRef } from "@opencode-ai/sdk/v2/client"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { buildPromptRequest, tierAgent, v1CommandModelFields, v1PromptModelFields, type PermMode } from "../renderer/codepuppy-ui/composer-state"
import { dict as en } from "../renderer/i18n/en"
import { createEngineFetch } from "./index"

const sandbox = engineSandbox()
const model = scriptedModel()
const DEFAULT = "build"
const ASK = "codepuppy-ask"
const READONLY = "codepuppy-readonly"
const PLAN = "plan"
/** 用户显式选过的模型(界面这时随每条消息 / 命令带上它;沙箱里平台节点只有这一个模型)。 */
const MODEL: ModelRef = { providerID: "codepuppy", id: "m" }
const COMMAND = "cp-write"

let host: ReturnType<typeof codepuppyEngine>
let running: Running
let client: ReturnType<typeof createOpencodeClient>
const send = (method: string, route: string, body?: unknown) => running.send(method, route, body)
const directory = () => host.projectDirectory
const writeCall = (file: string) => `CP-CALL ${JSON.stringify({ name: "write", args: { path: file, content: "x" } })}`

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  host = codepuppyEngine({
    sandbox,
    name: "agent",
    modelBaseURL: model.baseURL,
    // 项目里的一条命令:模板让模型桩写参数给的那个文件。
    projectFiles: { "opencode.json": JSON.stringify({ commands: { [COMMAND]: { template: writeCall("$1") } } }) },
  })
  running = await host.start()
  const origin = new URL(running.url).origin
  // main 的 onBeforeSendHeaders(I8)给发往引擎源的请求补口令。
  const engineHttp = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    request.headers.set("authorization", running.authorization)
    return fetch(request)
  }) as typeof fetch
  const engineFetch = createEngineFetch({ isEngineOrigin: (candidate) => candidate === origin, fetch: engineHttp })
  // use-projects 建的就是这个客户端(createOpencodeClient + 适配器的 fetch)。
  client = createOpencodeClient({ baseUrl: origin, fetch: engineFetch as typeof fetch })
}, 60_000)

afterAll(async () => {
  await running?.close().catch(() => undefined)
  model.stop()
})

// ── 界面的三个发送入口(请求按生产代码同样展开)────────────────────────────────────────────
type Sent = { error?: unknown }

/** 侧栏「新对话」建会话(use-projects startChat)。 */
async function conversation() {
  const created = (await client.session.create({ directory: directory() } as never)) as Sent & { data?: { id: string } }
  expect(created.error).toBeUndefined()
  return created.data!.id
}

/** 会话内普通发送(codepuppy-composer 的 session 模式):`req.agent` 有才带,显式选的模型随消息走。 */
async function composerSend(sessionID: string, text: string, perm: PermMode, agent: string | null) {
  const req = buildPromptRequest({ text, model: null, effort: null, perm, agent })
  const sent = (await client.session.promptAsync({
    sessionID,
    directory: directory(),
    parts: req.parts,
    ...(req.agent ? { agent: req.agent } : {}),
    ...v1PromptModelFields(MODEL),
  } as never)) as Sent
  expect(sent.error).toBeUndefined()
}

/** 会话内斜杠命令(codepuppy-composer):只带档位强制的 agent,不带手选助手。 */
async function composerCommand(sessionID: string, file: string, perm: PermMode) {
  const tier = tierAgent(perm)
  const sent = (await client.session.command({
    sessionID,
    directory: directory(),
    command: COMMAND,
    arguments: file,
    ...(tier ? { agent: tier } : {}),
    ...v1CommandModelFields(MODEL),
  } as never)) as Sent
  expect(sent.error).toBeUndefined()
}

/** 时间线中断态的「继续」(session-timeline continueTurn):`tierAgent(档位) ?? 手选助手`,一条 synthetic 文本。 */
async function timelineContinue(sessionID: string, perm: PermMode, agent: string | null) {
  const chosen = tierAgent(perm) ?? agent
  const sent = (await client.session.promptAsync({
    sessionID,
    directory: directory(),
    ...(chosen ? { agent: chosen } : {}),
    parts: [{ type: "text", text: en["codepuppy.timeline.continuePrompt"], synthetic: true }],
  } as never)) as Sent
  expect(sent.error).toBeUndefined()
}

// ── 引擎一侧的观察(进程内分发,不经适配器)─────────────────────────────────────────────────
type EngineMessage = { id: string; type: string; agent?: string }
type Turn = { agent: string; writeTool: boolean; write?: "written" | "asked" | "not-written" }

const messagesOf = async (sessionID: string) => (await send("GET", `/api/session/${sessionID}/message?order=asc&limit=200`)).json.data as EngineMessage[]
const sessionAgent = async (sessionID: string) => (await send("GET", `/api/session/${sessionID}`)).json.data.agent as string | undefined

/**
 * 一轮:经 `submit` 发出,在引擎一侧等它停下(遇到审批就经引擎的回复路由拒掉),再看这一轮的事实 ——
 * 由哪个助手跑(这一轮新出现的助手消息的 `agent`)、模型这一轮的工具表里有没有 write、`file` 有没有写下。
 */
async function turn(sessionID: string, file: string | undefined, submit: () => Promise<unknown>): Promise<Turn> {
  const seen = new Set((await messagesOf(sessionID)).map((message) => message.id))
  const before = model.requests.length
  await submit()
  let settled = false
  const idle = send("POST", `/api/experimental/session/${sessionID}/wait`).finally(() => (settled = true))
  const asked = new Set<string>()
  while (!settled) {
    const pending = ((await send("GET", `/api/session/${sessionID}/permission`)).json?.data ?? []) as Array<{ id: string }>
    for (const request of pending) {
      if (asked.has(request.id)) continue
      asked.add(request.id)
      await send("POST", `/api/session/${sessionID}/permission/${request.id}/reply`, { decision: "reject" })
    }
    if (!settled) await Bun.sleep(25)
  }
  await idle
  const agents = [...new Set((await messagesOf(sessionID)).filter((message) => !seen.has(message.id) && message.type === "assistant").map((message) => message.agent))]
  // 同一轮里引擎还会发起不带工具的起标题请求;判模型这一轮手里的工具表,取带工具最多的那一次。
  const tools = model.requests.slice(before).toSorted((a, b) => b.tools.length - a.tools.length)[0]?.tools ?? []
  const result: Turn = { agent: agents.join(","), writeTool: tools.includes("write") }
  if (file) result.write = fs.existsSync(path.join(directory(), file)) ? "written" : asked.size ? "asked" : "not-written"
  return result
}

const ranAs = (agent: string, write: Turn["write"], writeTool = agent !== READONLY): Turn => ({ agent, writeTool, ...(write ? { write } : {}) })

describe("#1669 切回「全部批准」/ 默认助手:引擎的下一轮由默认助手跑", () => {
  test("普通发送:同一对话 只读 → 默认 → 请求审批 → 默认 → 计划 → 默认,每次切回默认那一轮由 build 跑、文件直接写下", async () => {
    const sessionID = await conversation()
    const steps: Array<[PermMode, string | null]> = [
      ["readonly", null],
      ["allow", null],
      ["ask", null],
      ["allow", null],
      ["allow", PLAN],
      ["allow", null],
    ]
    const got: Turn[] = []
    for (const [index, [perm, agent]] of steps.entries()) {
      const file = `send-${index}.txt`
      got.push(await turn(sessionID, file, () => composerSend(sessionID, writeCall(file), perm, agent)))
    }
    expect(got).toEqual([
      ranAs(READONLY, "not-written"),
      ranAs(DEFAULT, "written"),
      ranAs(ASK, "asked"),
      ranAs(DEFAULT, "written"),
      ranAs(PLAN, "not-written"),
      ranAs(DEFAULT, "written"),
    ])
  }, 120_000)

  test("斜杠命令:只读、计划之后在「全部批准」下发命令 ⇒ 命令那一轮由 build 跑、文件写下", async () => {
    const sessionID = await conversation()
    const got = [
      await turn(sessionID, "cmd-0.txt", () => composerSend(sessionID, writeCall("cmd-0.txt"), "readonly", null)),
      await turn(sessionID, "cmd-1.txt", () => composerCommand(sessionID, "cmd-1.txt", "allow")),
      await turn(sessionID, "cmd-2.txt", () => composerSend(sessionID, writeCall("cmd-2.txt"), "allow", PLAN)),
      await turn(sessionID, "cmd-3.txt", () => composerCommand(sessionID, "cmd-3.txt", "allow")),
    ]
    expect(got).toEqual([ranAs(READONLY, "not-written"), ranAs(DEFAULT, "written"), ranAs(PLAN, "not-written"), ranAs(DEFAULT, "written")])
  }, 120_000)

  test("「继续」:只读之后在「全部批准」下点继续 ⇒ 那一轮由 build 跑、模型手里有 write", async () => {
    const sessionID = await conversation()
    const got = [
      await turn(sessionID, "cont-0.txt", () => composerSend(sessionID, writeCall("cont-0.txt"), "readonly", null)),
      await turn(sessionID, undefined, () => timelineContinue(sessionID, "allow", null)),
    ]
    expect(got).toEqual([ranAs(READONLY, "not-written"), ranAs(DEFAULT, undefined)])
  }, 120_000)

  test("终端命令:只读之后不带 agent 的 shell ⇒ 会话的助手回到默认", async () => {
    const sessionID = await conversation()
    expect(await turn(sessionID, "shell-0.txt", () => composerSend(sessionID, writeCall("shell-0.txt"), "readonly", null))).toEqual(ranAs(READONLY, "not-written"))
    expect(await sessionAgent(sessionID)).toBe(READONLY)
    const sent = (await client.session.shell({ sessionID, directory: directory(), command: "true" } as never)) as Sent
    expect(sent.error).toBeUndefined()
    expect(await sessionAgent(sessionID)).toBe(DEFAULT)
  }, 120_000)

  test("量具自检:直接对引擎发、不切助手 ⇒ 下一轮照旧由上一轮的只读助手跑(2.x 记住会话的助手)", async () => {
    const created = await send("POST", "/api/session", { location: { directory: directory() }, agent: READONLY, model: { id: MODEL.id, providerID: MODEL.providerID } })
    expect(created.status).toBe(200)
    const sessionID = created.json.data.id as string
    const prompt = (file: string) => () => send("POST", `/api/session/${sessionID}/prompt`, { text: writeCall(file) })
    const got = [await turn(sessionID, "raw-0.txt", prompt("raw-0.txt")), await turn(sessionID, "raw-1.txt", prompt("raw-1.txt"))]
    expect(got).toEqual([ranAs(READONLY, "not-written"), ranAs(READONLY, "not-written")])
  }, 120_000)
})
