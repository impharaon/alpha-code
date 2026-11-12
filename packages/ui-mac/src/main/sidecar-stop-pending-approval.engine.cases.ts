// `#1647` AC1 在 OpenCode 2 上(`#1662` parity 第 8 项;v1 的 packages/opencode/test/server/codepuppy-sidecar-stop.test.ts 随换代删除):
// 一轮停在审批上时停止引擎,这一轮被释放 —— 不挂着、不在重启后接着跑、审批的那个工具一次都没执行。
//
// 走生产的停止路径:sidecar 收到 stop 后调的 `stopSidecarEngine`(关掉 `start()` 的作用域;引擎的 Permission 服务在收尾时把待批
// 请求一律拒掉),再在同一个库上重启(Code Puppy 不传 `lifecycle`,引擎不会续跑未释放的执行认领,engine-embed.ts 的 N1)。
// 宿主:test-component/codepuppy-engine.ts(生产注入 + 真 ext + 探针插件 + 本机模型桩 + 真 stdio MCP 服务器);「请求审批」档,
// 插件工具与第三方 MCP 工具都由 Code Puppy 策略询问。
//   · 直接工具调用:重启后工具部件以 error 结束、有结束时间;助手消息带 aborted 错误;待批列表为空;会话不在运行;工具零执行;
//     会话接得住下一句。
//   · MCP 工具(2.x 默认进 Code Mode,模型经 `execute` 调):真 MCP tools/call 为 0;待批列表为空;会话不在运行;`execute` 部件有结束
//     时间、它记下的那次 MCP 调用是 error。
// 已知的坏:停之前先回复 once ⇒ 工具真执行了一次(计数是活的)。
// 实测、不在本文件断言(交编排器):经 Code Mode 的那一轮,`execute` 部件以 completed 结束(内容是 Tool.Error)、助手消息不带 aborted
// —— Code Mode 把内层调用的失败收进自己的结果,这一步按 tool-calls 收尾,与直接调用的形状不同。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, probe, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { stopSidecarEngine } from "./sidecar-stop"

const sandbox = engineSandbox()
const ASK = "codepuppy-ask"
const MCP_CALLS = path.join(sandbox.root, "stop-mcp-calls.log")
const model = scriptedModel()
let host: ReturnType<typeof codepuppyEngine>
let running: Running | undefined
const send = (method: string, route: string, body?: unknown) => running!.send(method, route, body)

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  host = codepuppyEngine({ sandbox, name: "stop", modelBaseURL: model.baseURL, mcpCallLog: MCP_CALLS })
  running = await host.start()
}, 60_000)

afterAll(async () => {
  await running?.close().catch(() => undefined)
  model.stop()
})

type Tool = { type: string; name: string; state: { status: string; error?: { type: string }; metadata?: { toolCalls?: Array<{ status: string }> } }; time: { completed?: number } }
type Message = { type: string; error?: { type: string }; finish?: string; time: { completed?: number }; content?: Tool[] }

async function askedTurn(call: { name: string; args: Record<string, unknown> }) {
  const created = await send("POST", "/api/session", { location: { directory: host.projectDirectory }, agent: ASK, model: { id: "m", providerID: "codepuppy" } })
  const sessionID = created.json.data.id as string
  await send("POST", `/api/session/${sessionID}/prompt`, { text: `CP-CALL ${JSON.stringify(call)}` })
  for (const until = Date.now() + 8000; Date.now() < until; await Bun.sleep(25)) {
    const pending = (await send("GET", `/api/session/${sessionID}/permission`)).json?.data ?? []
    if (pending.length) return { sessionID, pending: pending as Array<{ id: string; action: string }> }
  }
  throw new Error("the turn never reached an approval")
}

/** 生产的停止路径,然后在同一个库与配置上重启。 */
async function stopAndRestart() {
  await stopSidecarEngine({ close: running!.close })
  running = await host.start()
}

async function stored(sessionID: string) {
  const messages = (await send("GET", `/api/session/${sessionID}/message`)).json.data as Message[]
  const assistant = messages.find((message) => message.type === "assistant")
  return { assistant, tool: assistant?.content?.find((part) => part.type === "tool") }
}
const active = async (sessionID: string) => ((await send("GET", "/api/session/active")).json.data as Record<string, unknown>)[sessionID]
const mcpCalls = () => (fs.existsSync(MCP_CALLS) ? fs.readFileSync(MCP_CALLS, "utf8").split("\n").filter(Boolean).length : 0)

describe("#1647 AC1:停在审批上的一轮,停止引擎即被释放", () => {
  test("直接工具调用:工具部件以 error 结束、有结束时间;助手消息 aborted;待批为空;不在运行;零执行;会话接得住下一句", async () => {
    const { sessionID, pending } = await askedTurn({ name: "cp_probe", args: {} })
    expect(pending.map((request) => request.action)).toEqual(["plugin::cp_probe"])
    const before = probe()
    await stopAndRestart()
    expect(before.runs.cp_probe).toBe(0)
    expect(probe().runs.cp_probe).toBe(0)

    const { assistant, tool } = await stored(sessionID)
    expect(tool?.state.status).toBe("error")
    expect(tool?.state.error?.type).toBe("aborted")
    expect(tool?.time.completed).toBeNumber()
    expect(assistant?.error?.type).toBe("aborted")
    expect(assistant?.time.completed).toBeNumber()
    expect((await send("GET", `/api/session/${sessionID}/permission`)).json.data).toEqual([])
    expect(await active(sessionID)).toBeUndefined()

    const before2 = model.requests.length
    await send("POST", `/api/session/${sessionID}/prompt`, { text: "hello again" })
    expect((await send("POST", `/api/experimental/session/${sessionID}/wait`)).status).toBe(204)
    expect(model.requests.length).toBeGreaterThan(before2)
  }, 60_000)

  test("MCP 工具(经 Code Mode):真 MCP tools/call 为 0;待批为空;不在运行;execute 部件有结束时间,它记下的 MCP 调用是 error", async () => {
    for (let i = 0; i < 200 && ((await send("GET", "/api/mcp")).json?.data ?? []).find((server: { name: string }) => server.name === "probe")?.status.status !== "connected"; i++)
      await Bun.sleep(50)
    const { sessionID, pending } = await askedTurn({ name: "execute", args: { code: 'return await tools.probe.echo({ text: "hi" })' } })
    expect(pending.map((request) => request.action)).toEqual(["mcp:probe:echo"])
    await stopAndRestart()
    expect(mcpCalls()).toBe(0)

    const { tool } = await stored(sessionID)
    expect(tool?.name).toBe("execute")
    expect(tool?.time.completed).toBeNumber()
    expect(tool?.state.metadata?.toolCalls?.map((call) => call.status)).toEqual(["error"])
    expect((await send("GET", `/api/session/${sessionID}/permission`)).json.data).toEqual([])
    expect(await active(sessionID)).toBeUndefined()
  }, 60_000)

  test("已知的坏:停之前先批准一次 ⇒ 工具真执行了一次(计数是活的)", async () => {
    const { sessionID, pending } = await askedTurn({ name: "cp_probe", args: {} })
    await send("POST", `/api/session/${sessionID}/permission/${pending[0]!.id}/reply`, { decision: "once" })
    await send("POST", `/api/experimental/session/${sessionID}/wait`)
    const before = probe()
    await stopAndRestart()
    expect(before.runs.cp_probe).toBe(1)
  }, 60_000)
})
