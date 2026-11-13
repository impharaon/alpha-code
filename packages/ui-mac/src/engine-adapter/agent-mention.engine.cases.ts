// `#1669` R17:从 @ 菜单选中一个助手再发出 ⇒ 这一轮派给那个助手(0.1.26 的结局)。
//
// 0.1.26:选中 `@general` 发「新建文件…」⇒ 模型调 task 派子任务;「请求审批」档弹委派卡「派出子任务 / 交给助手 general /
// 子任务里不再逐项询问」,拒绝后没有文件。v1 引擎给 agent part 紧跟一段 synthetic 指令(v0.1.26 packages/opencode/src/session/
// prompt.ts:1114-1128)。0.2.0 候选(r6 实测):消息带着 agents:[general],模型却自己调 write,卡是「改文件」—— 2.x 组装请求时
// 不带点名(core session/runner/to-llm-message.ts 的 `case "user"`),2.x 的委派动作也改叫 `subagent`。
//
// 判据都在真入口上:界面的请求构造(buildMentionParts 把 @ 菜单的点名造成 agent part,buildPromptRequest 按档位带 agent,与
// codepuppy-composer 同样展开)→ 界面用的 v2 SDK 客户端 → 生产的 createEngineFetch → 真监听端口的嵌入式 OpenCode 2(生产注入 +
// 真 ext,test-component/codepuppy-engine.ts)。审批卡走界面那一条:GET /permission(适配器交出 v1 形状)→ 冻结的
// adaptPermissionV1Request → createPermissionV2Feed,回复经 replyPermissionV1。
// 模型桩照它拿到的请求行事:用户回合里有登记过的派发指令(ext context-injection.ts 的 agent-mention.delegate)⇒ 照指令调
// subagent;没有 ⇒ 照 `CP-CALL` 自己调工具(候选包上模型的做法)。所以派不派只取决于请求里有没有那句指令。
//   · 全部批准 + 选中 @general:这一轮请求的用户消息正文后面紧跟一句指令;引擎为 general 起子任务(子会话由 general 跑、
//     文件由它写下),本会话自己不调 write。
//   · 请求审批 + 选中 @general:界面拿到的是委派卡的形状(动作 task、交给 general、能力轴请求);拒绝后没有子会话、没有文件。
//   · 没选中(正文里手打 `@general`,没有 agent part):请求里没有指令,不派子任务,本会话自己写下文件。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录;凭据是合成的。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { createOpencodeClient, type ModelRef } from "@opencode-ai/sdk/v2/client"
import { adaptPermissionV1Request, replyPermissionV1 } from "../../../codepuppy-app/src/context/permission-v1-adapter"
import { AGENT_MENTION_ID, renderTemplate } from "../../../ext/src/context-injection"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, textOf, type ModelRequest, type Running } from "../../test-component/codepuppy-engine"
import { buildMentionParts } from "../renderer/codepuppy-ui/composer-autocomplete-core"
import { buildPromptRequest, v1PromptModelFields, type PermMode } from "../renderer/codepuppy-ui/composer-state"
import { createPermissionDecisionCommand, permissionRequestFacts } from "../renderer/codepuppy-ui/PermissionDialog"
import { createPermissionV2Feed } from "../renderer/codepuppy-ui/session-workspace/session-permission-feed"
import { createEngineFetch } from "./index"

const sandbox = engineSandbox()
const GENERAL = "general"
const ASK = "codepuppy-ask"
const SUBAGENT_PREFIX = "You are a subagent spawned by another session."
/** 用户显式选过的模型(界面随每条消息带上它;沙箱里平台节点只有这一个模型)。 */
const MODEL: ModelRef = { providerID: "codepuppy", id: "m" }
const steer = (name: string) => renderTemplate(AGENT_MENTION_ID, { name })
const writeCall = (file: string) => `CP-CALL ${JSON.stringify({ name: "write", args: { path: file, content: "hello" } })}`

/** 模型桩:请求里有派给 general 的指令 ⇒ 调 subagent(prompt = 用户的正文);否则照 `CP-CALL` 调工具;上一条是工具结果 ⇒ 收尾。 */
function delegatingModel() {
  const requests: ModelRequest[] = []
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: "chatcmpl-cp-mention", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const headers = { "content-type": "text/event-stream" }
  const text = (value: string) => new Response(chunk({ role: "assistant", content: value }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers })
  let calls = 0
  const toolCall = (name: string, args: Record<string, unknown>) =>
    new Response(
      chunk({ role: "assistant", tool_calls: [{ index: 0, id: `call_cp_mention_${++calls}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }) +
        chunk({}, "tool_calls") +
        "data: [DONE]\n\n",
      { headers },
    )
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (!request.url.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
      const body = (await request.json()) as { messages?: ModelRequest["messages"]; tools?: Array<{ function?: { name?: string } }> }
      const messages = body.messages ?? []
      const tools = (body.tools ?? []).map((tool) => String(tool.function?.name))
      requests.push({ tools, messages })
      // 起标题等不带工具的请求、工具结果之后的那一步:回一句话收尾
      if (tools.length === 0 || messages.at(-1)?.role === "tool") return text("done")
      const lastUser = textOf(messages.filter((message) => message.role === "user").at(-1)?.content)
      if (lastUser.includes(steer(GENERAL))) return toolCall("subagent", { agent: GENERAL, description: "r17", prompt: lastUser.replace(steer(GENERAL), "").trim() })
      const marker = lastUser.match(/CP-CALL (\{.*\})/)
      if (!marker) return text("ok")
      const call = JSON.parse(marker[1]!) as { name: string; args: Record<string, unknown> }
      return toolCall(call.name, call.args)
    },
  })
  return { baseURL: `http://127.0.0.1:${server.port}/v1`, requests, stop: () => server.stop(true) }
}

const model = delegatingModel()
let host: ReturnType<typeof codepuppyEngine>
let running: Running
let client: ReturnType<typeof createOpencodeClient>
const send = (method: string, route: string, body?: unknown) => running.send(method, route, body)
const directory = () => host.projectDirectory

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  host = codepuppyEngine({ sandbox, name: "mention", modelBaseURL: model.baseURL })
  running = await host.start()
  const origin = new URL(running.url).origin
  // main 的 onBeforeSendHeaders(I8)给发往引擎源的请求补口令。
  const engineHttp = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    request.headers.set("authorization", running.authorization)
    return fetch(request)
  }) as typeof fetch
  const engineFetch = createEngineFetch({ isEngineOrigin: (candidate) => candidate === origin, fetch: engineHttp })
  client = createOpencodeClient({ baseUrl: origin, fetch: engineFetch as typeof fetch, directory: directory() })
}, 60_000)

afterAll(async () => {
  await running?.close().catch(() => undefined)
  model.stop()
})

// ── 界面一侧 ────────────────────────────────────────────────────────────────────────────────────────
type Sent = { error?: unknown; data?: unknown }

/** 侧栏「新对话」建会话(use-projects startChat)。 */
async function conversation() {
  const created = (await client.session.create({} as never)) as Sent & { data?: { id: string } }
  expect(created.error).toBeUndefined()
  return created.data!.id
}

/** 会话内发送(codepuppy-composer 的 session 模式):正文 + 从 @ 菜单点名的助手造的 agent part,档位强制的 agent 随消息走。 */
async function composerSend(sessionID: string, body: string, perm: PermMode, picked: readonly string[]) {
  const req = buildPromptRequest({
    text: body,
    extraParts: buildMentionParts(body, directory(), picked.map((name) => ({ type: "agent" as const, name, content: `@${name}` }))),
    model: null,
    effort: null,
    perm,
    agent: null,
  })
  const sent = (await client.session.promptAsync({
    sessionID,
    parts: req.parts,
    ...(req.agent ? { agent: req.agent } : {}),
    ...v1PromptModelFields(MODEL),
  } as never)) as Sent
  expect(sent.error).toBeUndefined()
}

/** 审批卡的消费方:冻结 v1 通道的卡(GET /permission 交出)+ createPermissionV2Feed,回复经 replyPermissionV1。 */
async function cardFeed(sessionID: string) {
  const feed = createPermissionV2Feed({
    list: async () =>
      ((await client.permission.list()).data ?? []).filter((request) => request.sessionID === sessionID).map((request) => adaptPermissionV1Request(request, ASK)),
    reply: (requestID, command) => replyPermissionV1({ client } as never, { sessionID, requestID, command }),
  })
  feed.load()
  for (let attempt = 0; attempt < 200 && !feed.state.ready; attempt++) await Bun.sleep(10)
  expect(feed.state.ready).toBe(true)
  return feed
}

// ── 引擎一侧(进程内分发,不经适配器)───────────────────────────────────────────────────────────────
type EngineMessage = { id: string; type: string; agent?: string; content?: Array<{ type: string; name?: string }> }

const idle = (sessionID: string) => send("POST", `/api/experimental/session/${sessionID}/wait`)
const pendingOf = async (sessionID: string) => ((await send("GET", `/api/session/${sessionID}/permission`)).json?.data ?? []) as Array<{ id: string; action: string }>
const children = async (parentID: string) =>
  (((await send("GET", "/api/session")).json?.data ?? []) as Array<{ id: string; parentID?: string; agent?: string }>).filter((item) => item.parentID === parentID)
const messagesOf = async (sessionID: string) => (await send("GET", `/api/session/${sessionID}/message?order=asc&limit=200`)).json.data as EngineMessage[]
/** 这个会话里助手调过的工具名(按顺序)。 */
const toolsCalled = async (sessionID: string) =>
  (await messagesOf(sessionID)).filter((message) => message.type === "assistant").flatMap((message) => (message.content ?? []).filter((item) => item.type === "tool").map((item) => item.name))
const lastUserText = (request: ModelRequest) => textOf(request.messages.filter((message) => message.role === "user").at(-1)?.content)
const fileWritten = (file: string) => fs.existsSync(path.join(directory(), file))

async function waitPending(sessionID: string, ms = 8000) {
  for (const until = Date.now() + ms; Date.now() < until; ) {
    const list = await pendingOf(sessionID)
    if (list.length) return list
    await Bun.sleep(25)
  }
  return []
}

describe("#1669 R17 从 @ 菜单点名的助手:这一轮派给它", () => {
  test("全部批准 + 选中 @general:请求的用户消息正文后面紧跟派发指令;引擎为 general 起子任务,文件由子会话写下,本会话不调 write", async () => {
    const sessionID = await conversation()
    const file = "r17-allow.txt"
    const body = `@${GENERAL} ${writeCall(file)}`
    const before = model.requests.length
    await composerSend(sessionID, body, "allow", [GENERAL])
    await idle(sessionID)
    const turn = model.requests.slice(before)

    // 本会话这一轮的请求:用户消息 = 正文 + 紧跟其后的一句派发指令(恰好一句)
    const steered = turn.filter((request) => !lastUserText(request).startsWith(SUBAGENT_PREFIX) && request.tools.length > 0)
    expect(steered.length).toBeGreaterThan(0)
    for (const request of steered) {
      const user = lastUserText(request)
      expect(user.endsWith(steer(GENERAL))).toBe(true)
      expect(user.split(steer(GENERAL))).toHaveLength(2)
      expect(user.startsWith(body)).toBe(true)
    }
    // 引擎为 general 起了子任务:一个子会话,由 general 跑,它写下了文件;子会话的请求里没有派发指令(它的消息没点名)
    const [child, ...more] = await children(sessionID)
    expect(more).toEqual([])
    expect(child?.agent).toBe(GENERAL)
    expect(await toolsCalled(child!.id)).toEqual(["write"])
    expect(fileWritten(file)).toBe(true)
    expect(turn.filter((request) => lastUserText(request).startsWith(SUBAGENT_PREFIX)).some((request) => lastUserText(request).includes(steer(GENERAL)))).toBe(false)
    // 本会话自己只调了 subagent
    expect(await toolsCalled(sessionID)).toEqual(["subagent"])
    expect(await pendingOf(sessionID)).toEqual([])
  }, 120_000)

  test("请求审批 + 选中 @general:界面拿到的是委派卡(动作 task、交给 general、能力轴请求);拒绝后没有子会话、没有文件", async () => {
    const sessionID = await conversation()
    const file = "r17-ask.txt"
    await composerSend(sessionID, `@${GENERAL} ${writeCall(file)}`, "ask", [GENERAL])
    expect(await waitPending(sessionID)).toHaveLength(1)
    const feed = await cardFeed(sessionID)
    const [card, ...more] = feed.state.requests
    expect(more).toEqual([])
    // PermissionDialog 按 v1 的 `task` 画委派卡:「派出子任务」+「交给助手 <resources[0]>」+ 能力轴(没有 metadata.policy)时的
    // 「子任务里不再逐项询问」;事实核不实的卡会被自动拒绝,所以这里也核一遍。
    expect([card?.action, card?.resources]).toEqual(["task", [GENERAL]])
    expect(card?.metadata?.policy).toBeUndefined()
    expect(permissionRequestFacts(card!).verified).toBe(true)

    await feed.reply(card!.id, createPermissionDecisionCommand(card!, "reject"))
    await idle(sessionID)
    expect(await children(sessionID)).toEqual([])
    expect(fileWritten(file)).toBe(false)
    expect(await toolsCalled(sessionID)).toEqual(["subagent"])
  }, 120_000)

  test("没选中(正文里手打 @general,没有 agent part):请求里没有派发指令,不派子任务,本会话自己写下文件", async () => {
    const sessionID = await conversation()
    const file = "r17-typed.txt"
    const before = model.requests.length
    await composerSend(sessionID, `@${GENERAL} ${writeCall(file)}`, "allow", [])
    await idle(sessionID)
    const turn = model.requests.slice(before)
    expect(turn.filter((request) => request.tools.length > 0).length).toBeGreaterThan(0)
    expect(turn.some((request) => lastUserText(request).includes(steer(GENERAL)))).toBe(false)
    expect(await children(sessionID)).toEqual([])
    expect(await toolsCalled(sessionID)).toEqual(["write"])
    expect(fileWritten(file)).toBe(true)
  }, 120_000)
})
