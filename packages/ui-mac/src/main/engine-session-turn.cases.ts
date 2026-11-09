// `#1667`(#1662 L5,清点表 S6 / S9):自动化两个入口在 OpenCode 2 上的「发一条、等跑完、拿回复」(engine-session-turn.ts),
// 对着沙箱里的真引擎 + 一个本机的 OpenAI 兼容模型桩判(模型桩回固定文字,慢 400ms —— 让「没等就读」读不到这一轮)。
//   · 成功:返回值就是模型桩说的那句话;
//   · 模型那边 400(不可重试;5xx 引擎会退避重试):抛错,原因里带引擎记下的失败(不是空回复冒充成功);
//   · 反向臂:prompt 之后不调 wait 直接读消息列表 ⇒ 读不到这一轮的回复(wait 这一步是必需的,不是装饰)。
// 客户端是生产的 engineClient(经 HTTP 打引擎监听的回环端口,带 Basic 口令)。
// 本文件由 engine-session-turn.test.ts 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../test-component/engine-sandbox"
import { buildEngineServerOptions } from "./engine-server-options"
import { engineClient } from "./engine-client"
import { promptAndWait } from "./engine-session-turn"

const sandbox = engineSandbox()
const PASSWORD = "cp-l5-turn"
const REPLY = "cp-l5 automation reply"
const model = { status: 200, delayMs: 400, calls: 0 }

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "chatcmpl-cp-l5", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

const llm = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response("not found", { status: 404 })
    model.calls++
    await new Promise((resolve) => setTimeout(resolve, model.delayMs))
    if (model.status !== 200) return Response.json({ error: { message: "cp-l5 model stub refused", type: "server_error" } }, { status: model.status })
    const body = chunk({ role: "assistant", content: REPLY }) + chunk({}, "stop") + "data: [DONE]\n\n"
    return new Response(body, { headers: { "content-type": "text/event-stream" } })
  },
})

const engines: Array<{ close: () => Promise<void> }> = []
let client: ReturnType<typeof engineClient>
let projectDirectory = ""

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  const { startEngine } = await import("../../engine/engine-embed")
  const slot = engineSlot(sandbox, "turn")
  projectDirectory = slot.projectDirectory
  const content = JSON.stringify({
    providers: {
      stub: { package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: `http://127.0.0.1:${llm.port}/v1`, apiKey: "cp-l5-not-a-key" }, models: { m: { name: "m" } } },
    },
    model: "stub/m",
  })
  const engine = await startEngine(
    buildEngineServerOptions({
      hostname: "127.0.0.1",
      port: 0,
      password: PASSWORD,
      engineVersion: "test",
      databasePath: slot.databasePath,
      configDirectory: slot.configDirectory,
      config: { content },
      models: { fetch: false },
      filewatcher: false,
      platform: process.platform,
    }),
  )
  engines.push(engine)
  client = engineClient({ url: engine.url, username: "opencode", password: PASSWORD })
})

afterAll(async () => {
  for (const engine of engines.reverse()) await engine.close().catch(() => undefined)
  llm.stop(true)
})

const freshSession = async () => (await client.session.create({ location: { directory: projectDirectory }, title: "cp-l5 turn" })).id

describe("OpenCode 2 上的「发一条、等跑完、拿回复」", () => {
  test("成功:返回模型这一轮说的话", async () => {
    model.status = 200
    expect(await promptAndWait(client, { sessionID: await freshSession(), text: "hello" })).toBe(REPLY)
  }, 60_000)

  test("模型 400:抛错,原因来自引擎记下的失败", async () => {
    model.status = 400
    try {
      await expect(promptAndWait(client, { sessionID: await freshSession(), text: "hello" })).rejects.toThrow(/engine turn failed/)
    } finally {
      model.status = 200
    }
  }, 60_000)

  test("反向臂:prompt 之后不等就读 ⇒ 读不到这一轮的回复", async () => {
    const sessionID = await freshSession()
    await client.session.prompt({ sessionID, text: "hello" })
    const early = (await client.message.list({ sessionID, order: "desc", limit: 50 })) as { data: Array<{ type: string; content?: Array<{ type: string; text?: string }> }> }
    expect(early.data.some((message) => message.type === "assistant" && message.content?.some((item) => item.text === REPLY))).toBe(false)
    await client.experimental.session.wait({ sessionID })
  }, 60_000)
})
