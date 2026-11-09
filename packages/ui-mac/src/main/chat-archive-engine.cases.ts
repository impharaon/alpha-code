// `#1667`(#1662 L5;编排器 2026-11-09 跨线事实:2.x core/server 从不发 `session.status` / `session.idle`,一轮结束是
// `session.execution.succeeded|failed|interrupted`):对话存档上报器(chat-archive-uploader.ts)在真 OpenCode 2 上被
// **真的执行事件**唤醒,读回真引擎的消息,铸出的 `turn` 体是这一轮的话。
//   · 沙箱真引擎 + 本机 OpenAI 兼容模型桩;上报器用生产的 createChatArchiveUploader(start() 订阅事件流),alpha-web 那一端
//     由注入的 fetch 截下(引擎那一端走真 fetch);
//   · 反向臂(旧名字):同一个引擎的不过滤事件流里,这一轮结束时只有 `session.execution.*`,`session.idle` / `session.status`
//     一条都没有;按旧名字过滤的订阅引擎照收(200),可这一轮跑完它一条事件都没送 —— 按 v1 名字订阅的人永远等不到。
// 本文件由 chat-archive-engine.test.ts 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../test-component/engine-sandbox"
import { buildEngineServerOptions } from "./engine-server-options"
import { engineClient } from "./engine-client"
import { engineAuthorization } from "./engine-authorization"
import { openChatArchiveCursor } from "./chat-archive-cursor"
import { createChatArchiveUploader } from "./chat-archive-uploader"

const sandbox = engineSandbox()
const PASSWORD = "cp-l5-archive"
const REPLY = "cp-l5 archived reply"
const WEB = "https://web.cp-l5.invalid"

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "chatcmpl-cp-l5", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const llm = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) =>
    new URL(request.url).pathname === "/v1/chat/completions"
      ? new Response(chunk({ role: "assistant", content: REPLY }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
      : new Response("not found", { status: 404 }),
})

const engines: Array<{ close: () => Promise<void> }> = []
let engineUrl = ""
let projectDirectory = ""

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  const { startEngine } = await import("../../engine/engine-embed")
  const slot = engineSlot(sandbox, "archive")
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
  engineUrl = engine.url.replace(/\/$/, "")
})

afterAll(async () => {
  for (const engine of engines.reverse()) await engine.close().catch(() => undefined)
  llm.stop(true)
})

const connection = () => ({ url: engineUrl, username: "opencode", password: PASSWORD })
const auth = () => ({ authorization: engineAuthorization(PASSWORD) })

/** 读一条 SSE 流直到 `until` 成立(或超时),返回看到的全部事件。 */
async function collectEvents(response: Response, until: (event: { type?: string; data?: { sessionID?: string } }) => boolean, ms: number) {
  const seen: Array<{ type?: string; data?: { sessionID?: string } }> = []
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const deadline = Date.now() + ms
  try {
    while (Date.now() < deadline) {
      const next = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now()))])
      if (!next || next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      let index: number
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const line = frame.split("\n").find((item) => item.startsWith("data:"))
        if (!line) continue
        const event = JSON.parse(line.slice(5).trim()) as { type?: string; data?: { sessionID?: string } }
        seen.push(event)
        if (until(event)) return seen
      }
    }
    return seen
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

describe("对话存档在 OpenCode 2 上由执行事件唤醒", () => {
  test("真执行事件唤醒上报器:读回真引擎的这一轮,turn 体里是用户的话与模型的回复", async () => {
    const posted: Array<{ turn: { engine_session_id: string; messages: Array<Record<string, unknown>> } }> = []
    let wake: () => void = () => {}
    const archived = new Promise<void>((resolve) => (wake = resolve))
    let subscribed: () => void = () => {}
    const listening = new Promise<void>((resolve) => (subscribed = resolve))
    const uploader = createChatArchiveUploader({
      awaitServer: async () => connection(),
      webBase: () => WEB,
      token: () => "archive-bearer",
      cursor: openChatArchiveCursor({ userDataPath: mkdtempSync(join(sandbox.root, "archive-ud-")), now: () => 1 }),
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input)
        if (url.startsWith(WEB)) {
          posted.push({ turn: JSON.parse((init!.body as FormData).get("turn") as string) })
          wake()
          return Response.json({ archived: true, messages_written: 2, attachments_written: 0 })
        }
        const response = await fetch(input, init)
        if (url.includes("/api/event")) subscribed()
        return response
      }) as typeof fetch,
      sleep: async () => {},
      log: { info: () => {}, warn: (message, meta) => console.warn(message, JSON.stringify(meta)) },
    })
    const stop = uploader.start()
    try {
      await listening
      await new Promise((resolve) => setTimeout(resolve, 200))
      const client = engineClient(connection())
      const sessionID = (await client.session.create({ location: { directory: projectDirectory }, title: "cp-l5 archive" })).id
      await client.session.prompt({ sessionID, text: "please archive this" })
      await Promise.race([archived, new Promise((_, reject) => setTimeout(() => reject(new Error("uploader was never woken")), 20_000))])
      expect(posted).toHaveLength(1)
      expect(posted[0]!.turn.engine_session_id).toBe(sessionID)
      expect(posted[0]!.turn.messages.map(({ role, text, provider_id, model_id }) => ({ role, text, provider_id, model_id }))).toEqual([
        { role: "user", text: "please archive this", provider_id: "stub", model_id: "m" },
        { role: "assistant", text: REPLY, provider_id: "stub", model_id: "m" },
      ])
    } finally {
      stop()
    }
  }, 60_000)

  test("反向臂(旧名字):这一轮结束时事件流里只有 session.execution.*,没有 session.idle / session.status;按旧名字过滤的订阅什么都等不到", async () => {
    const headers = { ...auth(), accept: "text/event-stream" }
    const all = await fetch(`${engineUrl}/api/event`, { headers })
    const legacy = await fetch(`${engineUrl}/api/event?types=session.idle&types=session.status`, { headers })
    expect([all.status, legacy.status]).toEqual([200, 200])
    const client = engineClient(connection())
    const sessionID = (await client.session.create({ location: { directory: projectDirectory }, title: "cp-l5 events" })).id
    const events = collectEvents(all, (event) => event.type === "session.execution.succeeded" && event.data?.sessionID === sessionID, 20_000)
    const legacyEvents = collectEvents(legacy, (event) => event.data?.sessionID === sessionID, 5_000)
    await new Promise((resolve) => setTimeout(resolve, 200))
    await client.session.prompt({ sessionID, text: "hello" })
    const seen = (await events).filter((event) => event.data?.sessionID === sessionID).map((event) => event.type)
    expect(seen).toContain("session.execution.succeeded")
    expect(seen).not.toContain("session.idle")
    expect(seen).not.toContain("session.status")
    // 按 v1 名字订阅:这一轮跑完了,这条流上关于这个会话的事件一条都没有(只可能有连接帧)
    expect((await legacyEvents).filter((event) => event.data?.sessionID === sessionID)).toEqual([])
  }, 60_000)
})
