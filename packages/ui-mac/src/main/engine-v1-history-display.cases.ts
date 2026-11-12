// `#1667`(#1662 L5,L4 裁决 alpha-code#1666 评论 6737732975 第 6 条 `adr041-history-display-conversion`,接口文档 I7b):
// 升级到 OpenCode 2 时,旧对话里每次工具调用的来源快照跟着转过去 —— v1 工具 part 顶层的 `display` 进 2.x 的
// `state.metadata.codepuppyDisplay`(renderer 的工具卡读这一格)。
//
// 真引擎(临时 HOME/XDG 沙箱)+ 夹具库:先起一次引擎建好 2.x schema,再补 v1 三张表与行(test-component/v1-legacy-db.ts),
// 再起引擎 —— 启动时上游转换器把 v1 会话转成 2.x,判据读 `GET /api/session/:id/message` 里转出来的工具调用:
//   · 带快照的 completed / error / 被打断(running)三种工具 part:快照原样在;
//   · 不带快照的:没有 `codepuppyDisplay`(不推断);快照不是对象:同样不写;
//   · `state.metadata` 里已经有 `codepuppyDisplay` 的:保留原值,不被 part 顶层的覆盖。
// 反向臂(宿主用 CODEPUPPY_TEST_V1_DISPLAY_TRANSFORM=off 再跑一遍本文件):不套我们的改写 = 上游原样 ⇒ 快照全丢。
//
// 本文件由 engine-v1-history-display.test.ts 宿主起独立 `bun test` 子进程跑(沙箱改环境变量、插件改模块装载,都不出那个进程)。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../test-component/engine-sandbox"
import { legacyAssistant, legacyUser, registerV1MigrationTransform, seedLegacyTables } from "../../test-component/v1-legacy-db"
import { buildEngineServerOptions } from "./engine-server-options"
import { withEngineAuthorization } from "./engine-authorization"
import type { EngineFetch } from "./in-process-engine"

const sandbox = engineSandbox()
const TRANSFORM = process.env.CODEPUPPY_TEST_V1_DISPLAY_TRANSFORM !== "off"
const plugin = TRANSFORM ? registerV1MigrationTransform() : undefined
const engines: Array<{ close: () => Promise<void> }> = []

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})

afterAll(async () => {
  for (const engine of engines.reverse()) await engine.close().catch(() => undefined)
})

async function startOn(slot: ReturnType<typeof engineSlot>) {
  const { startEngine } = await import("../../engine/engine-embed")
  let fetch: EngineFetch | undefined
  const engine = await startEngine(
    buildEngineServerOptions({
      hostname: "127.0.0.1",
      port: 0,
      password: "cp-l5-v1-display",
      engineVersion: "test",
      databasePath: slot.databasePath,
      configDirectory: slot.configDirectory,
      config: { content: "{}" },
      models: { fetch: false },
      filewatcher: false,
      platform: process.platform,
    }),
    { onDispatch: (dispatch) => (fetch = withEngineAuthorization(dispatch, "cp-l5-v1-display")) },
  )
  const get = async (route: string) => {
    const response = await fetch!(new Request(`http://codepuppy-sidecar.invalid${route}`, { headers: { "x-opencode-directory": encodeURIComponent(slot.projectDirectory) } }))
    return { status: response.status, body: (await response.json()) as any }
  }
  return { engine, get }
}

/** 先起一次引擎把库建成 2.x schema,补上 v1 的表与行,再起引擎 —— 启动时的转换在第二次起来时跑;等它报 completed。 */
async function convertedOn(name: string, seed: (projectDirectory: string) => Parameters<typeof seedLegacyTables>[1]) {
  const slot = engineSlot(sandbox, name)
  const first = await startOn(slot)
  await first.engine.close()
  seedLegacyTables(slot.databasePath, seed(slot.projectDirectory))
  const second = await startOn(slot)
  engines.push(second.engine)
  let status: unknown
  for (let i = 0; i < 100; i++) {
    status = (await second.get("/api/experimental/migration/v1")).body
    if ((status as { status?: string }).status === "completed") return second
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`v1 migration did not complete: ${JSON.stringify(status)}`)
}

const AUTH = { kind: "codepuppy-bundled", bindingId: "bind-1", evidenceDigest: `sha256:${"a1".repeat(32)}` }
const snapshot = (name: string) => ({ identity: { source: "mcp", origin: "codepuppy-word", name }, technicalId: `codepuppy-word_${name}`, authority: AUTH, location: { kind: "local" } })
const EXISTING = { identity: { source: "builtin", origin: "opencode", name: "read" }, technicalId: "read", authority: { kind: "not-asserted" } }

const SESSION = "ses_cp_l5_display"
const USER = "msg_000000000001aaaaaaaaaaaaaa"
const ASSISTANT = "msg_000000000002aaaaaaaaaaaaaa"
const done = { start: 21, end: 22 }
const TOOLS: Array<{ callID: string; display?: unknown; state: Record<string, unknown> }> = [
  { callID: "call_completed", display: snapshot("read_docx"), state: { status: "completed", input: {}, output: "doc", title: "read", metadata: { truncated: false }, time: done } },
  { callID: "call_error", display: snapshot("write_docx"), state: { status: "error", input: {}, error: "boom", time: done } },
  { callID: "call_running", display: snapshot("list_docx"), state: { status: "running", input: {}, time: { start: 21 } } },
  { callID: "call_without", state: { status: "completed", input: {}, output: "x", title: "read", metadata: {}, time: done } },
  { callID: "call_not_object", display: "codepuppy-word_read_docx", state: { status: "completed", input: {}, output: "x", title: "read", metadata: {}, time: done } },
  { callID: "call_existing", display: snapshot("read_docx"), state: { status: "completed", input: {}, output: "x", title: "read", metadata: { codepuppyDisplay: EXISTING }, time: done } },
]

describe(`v1 → 2.x 转换带上工具卡来源快照(${TRANSFORM ? "套了 Code Puppy 的改写" : "反向臂:上游原样"})`, () => {
  test("转换后的工具调用:带快照的原样在 state.metadata.codepuppyDisplay;不带的、不是对象的不写;已有的不覆盖", async () => {
    const engine = await convertedOn("v1-display", (directory) => ({
      sessions: [{ id: SESSION, directory }],
      messages: [
        { id: USER, sessionID: SESSION, time: 10, data: legacyUser(10) },
        { id: ASSISTANT, sessionID: SESSION, time: 20, data: legacyAssistant(USER, 20) },
      ],
      parts: [
        { id: "prt_1", messageID: USER, sessionID: SESSION, data: { type: "text", text: "convert my history" } },
        ...TOOLS.map((tool, i) => ({
          id: `prt_${i + 2}`,
          messageID: ASSISTANT,
          sessionID: SESSION,
          data: { type: "tool", tool: "codepuppy-word_read_docx", callID: tool.callID, ...(tool.display === undefined ? {} : { display: tool.display }), state: tool.state },
        })),
      ],
    }))
    const messages = await engine.get(`/api/session/${SESSION}/message?order=asc`)
    expect(messages.status).toBe(200)
    const assistant = (messages.body.data as Array<{ type: string; content?: Array<Record<string, any>> }>).find((m) => m.type === "assistant")
    const tools = Object.fromEntries((assistant?.content ?? []).filter((item) => item.type === "tool").map((item) => [item.id, item.state]))
    expect(Object.keys(tools).sort()).toEqual(TOOLS.map((tool) => tool.callID).sort())
    const display = (callID: string) => tools[callID]?.metadata?.codepuppyDisplay

    if (!TRANSFORM) {
      // 反向臂:上游的 SessionV1.ToolPart 不认 `display`,解码时就丢了 —— 三条带快照的一条都没过去。
      for (const callID of ["call_completed", "call_error", "call_running"]) expect([callID, display(callID)]).toEqual([callID, undefined])
      expect(display("call_existing")).toEqual(EXISTING)
      return
    }
    expect(plugin!.applied()).toBeGreaterThan(0)
    expect(display("call_completed")).toEqual(snapshot("read_docx"))
    expect(tools.call_completed.metadata.truncated).toBe(false) // 原有的 metadata 键还在
    expect(display("call_error")).toEqual(snapshot("write_docx"))
    expect(display("call_running")).toEqual(snapshot("list_docx"))
    expect(tools.call_running.status).toBe("error") // 被打断的 running 在 2.x 里是 tool.interrupted 的 error
    expect(display("call_without")).toBeUndefined()
    expect(display("call_not_object")).toBeUndefined()
    expect(display("call_existing")).toEqual(EXISTING)
  }, 90_000)
})
