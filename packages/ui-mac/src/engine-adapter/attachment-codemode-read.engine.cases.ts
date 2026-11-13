// `#1669` 打包回归第六轮 N01:附件 docx 读到了,文件卡却说「这一轮助手没有读取」(0.1.26 同样操作是「已读取」)。
// 0.1.26 的 MCP 工具是直接工具(Code Mode 要 OPENCODE_EXPERIMENTAL_CODE_MODE 才开),读取是一次 `codepuppy-word_read_docx` 工具部件;
// 2.x 的 MCP 工具默认进 Code Mode,读取发生在 `execute` 的程序里,引擎把每次内层调用记在 execute 部件的 `metadata.toolCalls`
// (packages/core/src/codemode/tool.ts progressHooks:tool = Code Mode 路径、status、input)。
//
// 生产链:嵌进 sidecar 的那台 OpenCode 2(test-component/codepuppy-engine.ts:生产 injectCodePuppyConfig + 真 ext)+ 本机模型桩 +
// 一个名叫 `codepuppy-word` 的真 stdio MCP 读取桩(只列 read_docx)→ composer 的生产 buildAttachmentParts 发出暂存附件 →
// ext 真读取指令 → 模型经 `execute` 调 `tools["codepuppy-word"].read_docx` → 生产引擎适配器(prompt_async、/global/event 投影、
// GET /session/:id/message、GET /mcp)→ 冻结 app 的 event-reducer → 时间线模型 projectTimelineRows 的用户行附件读取结果。
// 每条判两条入口:事件流(发出后停在会话页)与重新打开会话(从侧栏打开)。
//
// 已知的坏(2026-11-13 实跑):timeline-attachments.ts 只认直接读取工具部件(修复前)⇒ 第一条两条入口都是 not-read(前提断言照过:
// 读取桩收到一次调用、execute 部件记下了这个附件的路径),被拒那条两条入口都是 not-read;第二条照样绿。
// 被拒那条的「读取失败:文件打不开」与 0.1.26 直接调用被拒时同一个结果(错误原文不含 is not available / timeout)。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { createStore } from "solid-js/store"
import { applyDirectoryEvent } from "../../../codepuppy-app/src/context/global-sync/event-reducer"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, MCP_FIXTURE, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { attachmentAbsolutePath, attachmentReaderServer } from "../shared/attachment-path"
import { buildAttachmentParts } from "../renderer/codepuppy-ui/composer-attachments-core"
import { projectTimelineRows, type TimelineRow } from "../renderer/codepuppy-ui/session-timeline/timeline-model"
import type { TimelineAttachmentRead } from "../renderer/codepuppy-ui/session-timeline/timeline-attachments"
import { createEngineFetch } from "./index"
import type { V1Payload } from "./events"

const sandbox = engineSandbox()
const ORIGIN = "http://127.0.0.1:47670"
const BUILD = "build"
const ASK = "codepuppy-ask"
const SERVER = attachmentReaderServer("word")
const MCP_CALLS = path.join(sandbox.root, "reader-calls.log")
const model = scriptedModel()

let host: ReturnType<typeof codepuppyEngine>
let running: Running
let adapter: typeof fetch
const events: Array<{ directory: string; payload: V1Payload }> = []
const stream = new AbortController()

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  // 本机读取工具的桩:真 stdio MCP 服务器(#1563 夹具),服务名是第一方 Word 连接器的名字,只列 read_docx(server.py 的入参形状)。
  const toolsFile = path.join(sandbox.root, "reader-tools.json")
  fs.writeFileSync(
    toolsFile,
    JSON.stringify([{ name: "read_docx", description: "read a .docx", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }]),
  )
  host = codepuppyEngine({
    sandbox,
    name: "attach-read",
    modelBaseURL: model.baseURL,
    mcp: { [SERVER]: { type: "local", command: [process.execPath, MCP_FIXTURE], environment: { CODEPUPPY_MCP_TOOLS_FILE: toolsFile, CODEPUPPY_MCP_CALL_LOG: MCP_CALLS } } },
  })
  running = await host.start()
  adapter = createEngineFetch({
    isEngineOrigin: (origin) => origin === ORIGIN,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => running.fetch(new Request(input, init))) as typeof fetch,
  }) as typeof fetch
  const response = await adapter(`${ORIGIN}/global/event`, { signal: stream.signal })
  void (async () => {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      for (let index = buffer.indexOf("\n\n"); index >= 0; index = buffer.indexOf("\n\n")) {
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)))
      }
    }
  })().catch(() => undefined)
  for (let i = 0; i < 200 && (await services())[SERVER]?.status !== "connected"; i++) await Bun.sleep(50)
  if ((await services())[SERVER]?.status !== "connected") throw new Error(`the ${SERVER} reader stub never connected: ${JSON.stringify(await services())}`)
}, 120_000)

afterAll(async () => {
  stream.abort()
  await running?.close().catch(() => undefined)
  model.stop()
})

const headers = () => ({ "content-type": "application/json", "x-opencode-directory": encodeURIComponent(host.projectDirectory) })
const services = async () => (await (await adapter(`${ORIGIN}/mcp`, { headers: headers() })).json()) as Record<string, { status?: string }>
const readerCalls = () => (fs.existsSync(MCP_CALLS) ? fs.readFileSync(MCP_CALLS, "utf8").split("\n").filter(Boolean).length : 0)

function staged(id: string) {
  return { id, name: "rc.docx", size: 36_641, kind: "document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", reader: "word", directory: host.projectDirectory, path: `attachments/${id}/rc.docx` }
}

/** 发一条带暂存附件的消息(经适配器建会话、prompt_async),模型经 `execute` 跑 `program`;请求审批档的那次审批经适配器的 v1 回复入口拒绝。 */
async function turn(options: { agent: string; attachment: ReturnType<typeof staged>; program: string; reject?: boolean }) {
  const sessionID = ((await (await adapter(`${ORIGIN}/session`, { method: "POST", headers: headers(), body: "{}" })).json()) as { id: string }).id
  const call = { name: "execute", args: { code: options.program } }
  const prompt = await adapter(`${ORIGIN}/session/${sessionID}/prompt_async`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      agent: options.agent,
      parts: [{ type: "text", text: `CP-CALL ${JSON.stringify(call)}\n` }, ...buildAttachmentParts([options.attachment as never])],
    }),
  })
  expect(prompt.status).toBe(204)
  if (options.reject) {
    let request: { id: string; sessionID: string; permission?: string } | undefined
    for (let i = 0; i < 200 && !request; i++) {
      const pending = (await (await adapter(`${ORIGIN}/permission`, { headers: headers() })).json()) as Array<{ id: string; sessionID: string; permission?: string }>
      request = pending.find((item) => item.sessionID === sessionID)
      if (!request) await Bun.sleep(50)
    }
    if (!request) throw new Error("the read never reached an approval")
    const replied = await adapter(`${ORIGIN}/permission/${request.id}/reply`, { method: "POST", headers: headers(), body: JSON.stringify({ reply: "reject" }) })
    expect(replied.status).toBe(200)
  }
  const idle = () =>
    events.some((event) => event.payload.type === "session.idle" && (event.payload.properties as { sessionID: string }).sessionID === sessionID)
  for (let i = 0; i < 300 && !idle(); i++) await Bun.sleep(50)
  if (!idle()) throw new Error(`session ${sessionID} never went idle through the adapter`)
  return sessionID
}

type UserRow = Extract<TimelineRow, { kind: "user" }>
const readOf = (rows: TimelineRow[]) => rows.find((row): row is UserRow => row.kind === "user")?.attachments[0]?.read

/** 用户行附件的读取结果,两条入口各一份:事件流归约出的 store,与重新打开会话读到的消息页。 */
async function attachmentRead(sessionID: string): Promise<{ live?: TimelineAttachmentRead; reopened?: TimelineAttachmentRead; execute: unknown }> {
  const [store, setStore] = createStore<any>({
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    message: {},
    session_message: {},
    part: {},
    part_text_accum_delta: {},
    limit: 50,
  })
  for (const event of events)
    if (event.directory === host.projectDirectory)
      applyDirectoryEvent({ event: event.payload, store, setStore, push: () => {}, directory: host.projectDirectory, loadLsp: () => {}, setSessionTodo: () => {} })
  const attachments = { directory: host.projectDirectory, services: await services() }
  const messages = JSON.parse(JSON.stringify(store.message[sessionID] ?? []))
  const live = projectTimelineRows({ messages, partsOf: (id) => store.part[id] ?? [], status: store.session_status[sessionID]?.type ?? "idle", attachments })
  const page = (await (await adapter(`${ORIGIN}/session/${sessionID}/message?limit=50`, { headers: headers() })).json()) as Array<{ info: any; parts: any[] }>
  const reopened = projectTimelineRows({
    messages: page.map((item) => item.info),
    partsOf: (id) => page.find((item) => item.info.id === id)?.parts ?? [],
    status: "idle",
    attachments,
  })
  const execute = page.flatMap((item) => item.parts).find((part) => part.type === "tool" && part.tool === "execute")
  return { live: readOf(live), reopened: readOf(reopened), execute: execute && { status: execute.state.status, toolCalls: execute.state.metadata?.toolCalls } }
}

const program = (file: string) => `return await tools[${JSON.stringify(SERVER)}].read_docx({ path: ${JSON.stringify(file)} })`

describe("#1669 N01 附件经 Code Mode 读取:嵌入式引擎 → 生产适配器 → 冻结归约器 → 时间线附件读取结果", () => {
  test("execute 里读的就是这个附件(全部批准)⇒ 两条入口都是「已读取」", async () => {
    const attachment = staged("1b0f3c52-7d1c-4c4b-9f0a-3c2d1e0f9a01")
    const before = readerCalls()
    const sessionID = await turn({ agent: BUILD, attachment, program: program(attachmentAbsolutePath(host.projectDirectory, attachment.path)) })
    const result = await attachmentRead(sessionID)
    // 前提:读取真的经 Code Mode 发生(读取桩收到一次 tools/call;execute 部件记下那次内层调用,路径是这个附件)
    expect(readerCalls()).toBe(before + 1)
    expect(result.execute).toEqual({
      status: "completed",
      toolCalls: [{ tool: `${SERVER}.read_docx`, status: "completed", input: { path: attachmentAbsolutePath(host.projectDirectory, attachment.path) } }],
    })
    expect({ live: result.live, reopened: result.reopened }).toEqual({ live: { kind: "read" }, reopened: { kind: "read" } })
  }, 60_000)

  test("execute 里读的是另一个文件 ⇒ 不是「已读取」(回合结束 = 这一轮助手没有读取)", async () => {
    const attachment = staged("1b0f3c52-7d1c-4c4b-9f0a-3c2d1e0f9a02")
    const other = attachmentAbsolutePath(host.projectDirectory, "attachments/1b0f3c52-7d1c-4c4b-9f0a-3c2d1e0f9a03/rc.docx")
    const sessionID = await turn({ agent: BUILD, attachment, program: program(other) })
    const result = await attachmentRead(sessionID)
    expect(result.execute).toMatchObject({ toolCalls: [{ tool: `${SERVER}.read_docx`, status: "completed", input: { path: other } }] })
    expect({ live: result.live, reopened: result.reopened }).toEqual({ live: { kind: "not-read" }, reopened: { kind: "not-read" } })
  }, 60_000)

  test("读的是这个附件但读取失败(请求审批档,审批被拒)⇒ 不是「已读取」(读取失败),读取桩零调用", async () => {
    const attachment = staged("1b0f3c52-7d1c-4c4b-9f0a-3c2d1e0f9a04")
    const before = readerCalls()
    const target = attachmentAbsolutePath(host.projectDirectory, attachment.path)
    const sessionID = await turn({ agent: ASK, attachment, program: program(target), reject: true })
    const result = await attachmentRead(sessionID)
    expect(readerCalls()).toBe(before)
    expect(result.execute).toMatchObject({ toolCalls: [{ tool: `${SERVER}.read_docx`, status: "error", input: { path: target } }] })
    expect({ live: result.live, reopened: result.reopened }).toEqual({
      live: { kind: "failed", reason: "unreadable" },
      reopened: { kind: "failed", reason: "unreadable" },
    })
  }, 60_000)
})
