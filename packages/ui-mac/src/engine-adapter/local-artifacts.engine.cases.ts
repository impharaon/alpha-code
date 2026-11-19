// DESIGN-local-session-artifacts:产物页「本次对话」里的本机产物,从引擎已持久化的工具 part 推出。判据都在真入口上:
// 嵌进 sidecar 的那台 OpenCode 2(test-component/codepuppy-engine.ts:生产注入 + 真 ext)+ 本机模型桩 + 一个名叫 `codepuppy-word`
// 的真 stdio MCP 桩(只列 write_docx,server.py 的入参形状)→ 生产引擎适配器(prompt_async、/permission、GET /session/:id/message
// 不带 limit = 面板生产注入 messagesOf 读的那一页)→ 面板的推导 readLocalArtifacts。
//
// 同一个会话里依次:经 `execute` 调第一方 Word 写工具、`write` 一份 .html、`patch` 新建一份 .md(design §2 标「推断」的投影在这里实测)、
// `write` 一份 .ts 与一份 .json(不是文档)、`write` 一份会话目录外的 .md(审批经适配器的 v1 回复入口批准)、经 `subagent` 让子会话
// `write` 一份 .md。重新打开会话(读消息页)后:三条来源与子会话的文档列出,代码 / JSON / 目录外的不列。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, MCP_FIXTURE, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { readLocalArtifacts, type SessionMessageWithParts } from "../renderer/codepuppy-ui/session-rail/artifacts/local-artifacts"
import { CODEPUPPY_OFFICE_CONNECTORS, OFFICE_WRITE_TOOL } from "../shared/office-advisories"
import { createEngineFetch } from "./index"
import type { V1Payload } from "./opencode2/events"

const sandbox = engineSandbox()
const ORIGIN = "http://127.0.0.1:47671"
const BUILD = "build"
const PATCH_MODEL = "gpt-5"
const WORD = CODEPUPPY_OFFICE_CONNECTORS.find((connector) => connector.format === "word")!.name
const WRITE_DOCX = OFFICE_WRITE_TOOL.word
const MCP_CALLS = path.join(sandbox.root, "word-calls.log")
const model = scriptedModel()

let host: ReturnType<typeof codepuppyEngine>
let running: Running
let adapter: typeof fetch
const events: Array<{ directory: string; payload: V1Payload }> = []
const stream = new AbortController()

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  const toolsFile = path.join(sandbox.root, "word-tools.json")
  fs.writeFileSync(
    toolsFile,
    JSON.stringify([{ name: WRITE_DOCX, description: "write a .docx", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }]),
  )
  host = codepuppyEngine({
    sandbox,
    name: "local-artifacts",
    modelBaseURL: model.baseURL,
    // 引擎只给 gpt-5 一类模型 `patch`(同时拿走 edit / write;core tool/plugin/patch.ts 的 context 钩子),其余模型反过来:patch 那一回合用它
    platformModels: { m: { name: "m" }, [PATCH_MODEL]: { name: PATCH_MODEL } },
    mcp: { [WORD]: { type: "local", command: [process.execPath, MCP_FIXTURE], environment: { CODEPUPPY_MCP_TOOLS_FILE: toolsFile, CODEPUPPY_MCP_CALL_LOG: MCP_CALLS } } },
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
  for (let i = 0; i < 200 && (await services())[WORD]?.status !== "connected"; i++) await Bun.sleep(50)
  if ((await services())[WORD]?.status !== "connected") throw new Error(`the ${WORD} stub never connected: ${JSON.stringify(await services())}`)
}, 120_000)

afterAll(async () => {
  stream.abort()
  await running?.close().catch(() => undefined)
  model.stop()
})

const headers = () => ({ "content-type": "application/json", "x-opencode-directory": encodeURIComponent(host.projectDirectory) })
const services = async () => (await (await adapter(`${ORIGIN}/mcp`, { headers: headers() })).json()) as Record<string, { status?: string }>

/** 一个回合:模型照 `CP-CALL` 调一次工具;回合里出现的审批经适配器的 v1 回复入口批准(once);等到这个会话再次 idle。 */
async function turn(sessionID: string, call: { name: string; args: Record<string, unknown> }, modelID = "m") {
  const from = events.length
  const prompt = await adapter(`${ORIGIN}/session/${sessionID}/prompt_async`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      agent: BUILD,
      // 每回合都点名模型:不点名时引擎沿用上一回合的模型(patch 那回合之后 write 就不可用了)
      model: { providerID: "codepuppy", modelID },
      parts: [{ type: "text", text: `CP-CALL ${JSON.stringify(call)}\n` }],
    }),
  })
  expect(prompt.status).toBe(204)
  const idle = () =>
    events
      .slice(from)
      .some((event) => event.payload.type === "session.idle" && (event.payload.properties as { sessionID: string }).sessionID === sessionID)
  for (let i = 0; i < 400 && !idle(); i++) {
    const pending = (await (await adapter(`${ORIGIN}/permission`, { headers: headers() })).json()) as Array<{ id: string }>
    for (const request of pending)
      await adapter(`${ORIGIN}/permission/${request.id}/reply`, { method: "POST", headers: headers(), body: JSON.stringify({ reply: "once" }) })
    await Bun.sleep(50)
  }
  if (!idle()) throw new Error(`session ${sessionID} never went idle through the adapter`)
}

/** 面板生产注入 messagesOf 读的那一页:v1 `session.messages` 不带 limit(整条会话)。 */
async function messagesOf(sessionID: string): Promise<SessionMessageWithParts[]> {
  const response = await adapter(`${ORIGIN}/session/${sessionID}/message`, { headers: headers() })
  if (!response.ok) throw new Error(`messages ${sessionID}: ${response.status}`)
  return (await response.json()) as SessionMessageWithParts[]
}

const toolParts = (page: SessionMessageWithParts[]) => page.flatMap((item) => item.parts).filter((part) => part.type === "tool") as any[]

describe("本机产物:嵌入式引擎 → 生产适配器 → 面板推导", () => {
  test("Office 写入(execute 内)、write 的 .html、patch 新建的 .md、子会话 write 的 .md 列出;.ts / .json / 目录外的不列", async () => {
    const dir = host.projectDirectory
    const outside = path.join(sandbox.root, "outside-notes.md")
    const sessionID = ((await (await adapter(`${ORIGIN}/session`, { method: "POST", headers: headers(), body: "{}" })).json()) as { id: string }).id

    await turn(sessionID, { name: "execute", args: { code: `return await tools[${JSON.stringify(WORD)}].${WRITE_DOCX}({ path: ${JSON.stringify(path.join(dir, "report.docx"))} })` } })
    await turn(sessionID, { name: "write", args: { path: "page.html", content: "<h1>hi</h1>" } })
    await turn(sessionID, { name: "patch", args: { patchText: "*** Begin Patch\n*** Add File: notes/plan.md\n+# plan\n*** End Patch" } }, PATCH_MODEL)
    await turn(sessionID, { name: "write", args: { path: "src/app.ts", content: "export {}\n" } })
    await turn(sessionID, { name: "write", args: { path: "config.json", content: "{}\n" } })
    await turn(sessionID, { name: "write", args: { path: outside, content: "# outside\n" } })
    await turn(sessionID, {
      name: "subagent",
      args: { agent: "general", description: "sub", prompt: `CP-CALL ${JSON.stringify({ name: "write", args: { path: "sub-report.md", content: "# sub\n" } })}` },
    })

    // 前提:每一次写都真的发生了(MCP 桩收到一次 write_docx;引擎写下的文件都在,目录外那份也在)
    expect(fs.readFileSync(MCP_CALLS, "utf8").split("\n").filter(Boolean)).toEqual([WRITE_DOCX])
    for (const file of ["page.html", "notes/plan.md", "src/app.ts", "config.json", "sub-report.md"]) expect(fs.existsSync(path.join(dir, file))).toBe(true)
    expect(fs.existsSync(outside)).toBe(true)

    const page = await messagesOf(sessionID)
    const parts = toolParts(page)
    const execute = parts.find((part) => part.tool === "execute")
    expect(execute?.state.metadata?.toolCalls).toEqual([{ tool: `${WORD}.${WRITE_DOCX}`, status: "completed", input: { path: path.join(dir, "report.docx") } }])
    // design §2「推断」那一格的实测:patch 新建在 v1 投影里是 type:"add",relativePath 是会话目录内的相对路径
    const patch = parts.find((part) => part.tool === "patch")
    expect(patch?.state.status).toBe("completed")
    expect(patch?.state.metadata?.files).toEqual([expect.objectContaining({ type: "add", relativePath: "notes/plan.md" })])
    const subagent = parts.find((part) => part.tool === "subagent")
    expect(typeof subagent?.state.metadata?.sessionId).toBe("string")

    const items = await readLocalArtifacts(dir, sessionID, messagesOf)
    expect(items.map((item) => item.path)).toEqual(["sub-report.md", "notes/plan.md", "page.html", "report.docx"])
    expect(items[0]!.sessionID).toBe(subagent.state.metadata.sessionId)
    expect(items.slice(1).every((item) => item.sessionID === sessionID)).toBe(true)
    expect(items.every((item, index) => index === 0 || item.writtenAt <= items[index - 1]!.writtenAt)).toBe(true)
  }, 180_000)
})
