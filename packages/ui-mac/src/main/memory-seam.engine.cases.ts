// `#1662` parity 第 4 项(ADR-045 的前提探针在 OpenCode 2 上重跑;v1 的 packages/opencode/test/session/codepuppy-427-memory-seam-probe.test.ts
// 随换代删除):长期记忆打算走的接缝 —— main 把一份按项目渲染的文件的**绝对路径**放进注入配置的 `instructions` —— 在嵌进 sidecar
// 的 OpenCode 2 上是否仍然「放进去就进上下文、删掉就不再生效」。
//
// 前提更正(交编排器):v1 从未把长期记忆注入对话(#425 没有落地),v1 留下的只有这个接缝的前提探针;所以这里判的是接缝,不是记忆。
// 2.x 的机制:配置的 `instructions` 由 core 的 opencode.config.instruction 装,每个文件被监听,变化后重扫(packages/core/src/config/
// plugin/instruction.ts),进模型这一轮的 system(`Instructions from: <路径>`)。判据看模型桩收到的请求,不看引擎内部状态。
//   ① 列进配置的文件 ⇒ 新会话的模型请求里恰好一段 `Instructions from: <路径>`,正文在;
//   ② 原地改写、写临时文件再改名替换 ⇒ 新会话带新正文。
//   ③ 删掉文件 ⇒ 新会话的请求里不再有它;已经在跑的会话的下一次请求带上引擎自己的「不再适用」说明(原文记进用例)——
//      与 v1 不同:v1 每一步重读文件,删掉后正文从 system 里消失;2.x 不改已发出的基线,旧正文留在这个会话的历史里;
// 实测不成立、不在本文件断言(交编排器,影响 #425 的渲染器写法):删掉之后再写回同一路径,10 秒内的新会话都不再带它 ——
// 被删文件的监听随之结束,要等配置重载或重启;渲染器清空记忆时应写空文件,不要删。
// 对照(判官看得见「没接」):同一份文件不列进配置 ⇒ 0 段。
// 文件监听按生产默认开着(engine-server-options.ts 的桌面开关)。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../test-component/engine-sandbox"
import { buildEngineServerOptions } from "./engine-server-options"
import { withEngineAuthorization } from "./engine-authorization"
import type { EngineFetch } from "./in-process-engine"

const sandbox = engineSandbox()
const PASSWORD = "cp-parity-memory"
const MEMORY = path.join(sandbox.root, "memory-context", "project.md")
const MARK_1 = "CP-MEMORY-FIRST the user prefers tabs"
const MARK_2 = "CP-MEMORY-SECOND the user prefers spaces"
const MARK_3 = "CP-MEMORY-THIRD the user prefers two spaces"

// 模型桩:记下每次请求里 system 与全部消息的文字,回一句固定的话
const requests: Array<{ system: string; all: string }> = []
const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "chatcmpl-cp-memory", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const textOf = (content: unknown) => (typeof content === "string" ? content : Array.isArray(content) ? content.map((part: any) => part?.text ?? "").join("") : "")
const llm = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (!request.url.endsWith("/v1/chat/completions")) return new Response("not found", { status: 404 })
    const body = (await request.json()) as { messages?: Array<{ role: string; content?: unknown }>; tools?: unknown[] }
    const messages = body.messages ?? []
    // 起标题的请求不带工具;只记这一轮真正的模型请求
    if ((body.tools ?? []).length > 0 || messages.some((message) => textOf(message.content).includes("CP-MEMORY-TURN")))
      requests.push({
        system: messages.filter((message) => message.role === "system").map((message) => textOf(message.content)).join("\n"),
        all: messages.map((message) => textOf(message.content)).join("\n"),
      })
    return new Response(chunk({ role: "assistant", content: "ok" }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  },
})

const engines: Array<{ close: () => Promise<void> }> = []
beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  for (const engine of engines.reverse()) await engine.close().catch(() => undefined)
  llm.stop(true)
})

async function engineWith(name: string, instructions: string[]) {
  const { startEngine } = await import("../../engine/engine-embed")
  const slot = engineSlot(sandbox, name)
  const content = JSON.stringify({
    providers: { stub: { package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: `http://127.0.0.1:${llm.port}/v1`, apiKey: "cp-memory-not-a-key" }, models: { m: { name: "m" } } } },
    model: "stub/m",
    instructions,
  })
  let fetch: EngineFetch | undefined
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
      filewatcher: true,
      platform: process.platform,
    }),
    { onDispatch: (dispatch) => (fetch = withEngineAuthorization(dispatch, PASSWORD)) },
  )
  engines.push(engine)
  const send = (method: string, route: string, body?: unknown) =>
    fetch!(
      new Request(`http://codepuppy-sidecar.invalid${route}`, {
        method,
        headers: { "x-opencode-directory": encodeURIComponent(slot.projectDirectory), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
  const session = async () => ((await (await send("POST", "/api/session", { location: { directory: slot.projectDirectory } })).json()) as { data: { id: string } }).data.id
  /** 在这个会话里发一轮,返回模型这一轮收到的请求。 */
  const turn = async (sessionID: string) => {
    const before = requests.length
    await send("POST", `/api/session/${sessionID}/prompt`, { text: `CP-MEMORY-TURN ${before}` })
    await send("POST", `/api/experimental/session/${sessionID}/wait`)
    const request = requests.slice(before).at(-1)
    expect(request, `no model request for ${sessionID}`).toBeDefined()
    return request!
  }
  return { session, turn }
}

const blocks = (text: string) => text.split(`Instructions from: ${MEMORY}`).length - 1

/** 文件监听有防抖(100ms),变化之后按新会话的请求轮询到预期出现为止。 */
async function untilNewSession(engine: Awaited<ReturnType<typeof engineWith>>, ok: (request: { system: string; all: string }) => boolean) {
  let last: { system: string; all: string } | undefined
  for (const until = Date.now() + 10_000; Date.now() < until; ) {
    last = await engine.turn(await engine.session())
    if (ok(last)) return last
    await Bun.sleep(200)
  }
  return last!
}

describe("ADR-045 接缝:注入配置里的 instructions 文件在 OpenCode 2 上进上下文、删掉即不再生效", () => {
  test("① 列进配置 ⇒ 恰好一段、正文在;② 原地改写与原子替换 ⇒ 新会话带新正文;③ 删掉 ⇒ 新会话里没有,在跑的会话收到引擎的「不再适用」", async () => {
    fs.mkdirSync(path.dirname(MEMORY), { recursive: true })
    fs.writeFileSync(MEMORY, `${MARK_1}\n`)
    const engine = await engineWith("memory-seam", [MEMORY])

    const running = await engine.session()
    const first = await engine.turn(running)
    expect(blocks(first.system)).toBe(1)
    expect(first.system).toContain(MARK_1)

    fs.writeFileSync(MEMORY, `${MARK_2}\n`)
    const rewritten = await untilNewSession(engine, (request) => request.all.includes(MARK_2))
    expect(blocks(rewritten.system)).toBe(1)
    expect(rewritten.system).toContain(MARK_2)
    expect(rewritten.all).not.toContain(MARK_1)

    // 渲染器常用的写法:写临时文件再改名替换
    fs.writeFileSync(`${MEMORY}.tmp`, `${MARK_3}\n`)
    fs.renameSync(`${MEMORY}.tmp`, MEMORY)
    const replaced = await untilNewSession(engine, (request) => request.all.includes(MARK_3))
    expect(blocks(replaced.system)).toBe(1)
    expect(replaced.all).not.toContain(MARK_2)

    fs.rmSync(MEMORY)
    const gone = await untilNewSession(engine, (request) => !request.all.includes(MARK_3))
    expect(blocks(gone.all)).toBe(0)
    expect(gone.all).not.toContain(MARK_3)
    // 在跑的会话:2.x 不重写已发出的基线(提示缓存前缀),旧正文仍在历史里,引擎在下一次请求补一条
    // `<system-update>` 说明它不再适用(packages/core/src/instruction-discovery.ts:只剩这一个文件时是整源的 removed 渲染)
    const after = await engine.turn(running)
    expect(after.all).toContain("<system-update>\nPreviously loaded instructions no longer apply.\n</system-update>")
  }, 90_000)

  test("对照:同一份文件不列进配置 ⇒ 模型请求里 0 段(判官看得见「没接」)", async () => {
    fs.mkdirSync(path.dirname(MEMORY), { recursive: true })
    fs.writeFileSync(MEMORY, `${MARK_1}\n`)
    const engine = await engineWith("memory-seam-control", [])
    const request = await engine.turn(await engine.session())
    expect(blocks(request.all)).toBe(0)
    expect(request.all).not.toContain(MARK_1)
  }, 60_000)
})
