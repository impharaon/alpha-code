// `#1214` AC2 / ADR-038 在 OpenCode 2 上(`#1662` parity,编排器 r5 补充):一次审批等到期限无人应答,时间线上的工具卡认得出
// 「审批超时、fail-closed」这一确定结局(`codepuppy.timeline.stepAskTimeout`),而不是退回「错误详情已隐藏」。
//
// 界面是权威(owner:「界面当前的 alpha 才是唯一权威吧」):卡片的判据 `PERMISSION_ASK_TIMEOUT_PATTERN`
// (packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/cards/tool-card-model.ts)认 0.1.26 引擎那句话的首行
// 「审批请求等待 N 秒无人应答」;重接管的内核块(packages/core/src/permission.ts 的 codepuppy(ADR-038))必须照写这句。
//
// 真路径:嵌进 sidecar 的引擎(test-component/codepuppy-engine.ts:生产注入 + 真 ext)+ 本机模型桩;期限经
// `CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS` 压到 500 ms(每次请求现读);「请求审批」档的 shell 调用等审批到期 ⇒ 引擎写下这次工具调用的失败;
// 引擎的消息经桌面同一个适配器(packages/codepuppy-app/src/utils/session-message.ts 的 normalizeSessionMessages)变成 v1 形状的工具部件,
// 再交给卡片模型的分类(toolCardHeadOf)。另判模型下一轮读到的是同一句话(与 0.1.26 一样,模型与用户读到的是同一句)。
// 已知的坏(实测):内核块写的是英文「This approval request waited N s …」⇒ 卡片不认,askTimedOut 缺席。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, textOf, type Running } from "../../test-component/codepuppy-engine"
import { normalizeSessionMessages } from "../../../codepuppy-app/src/utils/session-message"
import { toolCardHeadOf } from "../renderer/codepuppy-ui/session-timeline/cards/tool-card-model"

const sandbox = engineSandbox()
const model = scriptedModel()
let running: Running | undefined
let directory = ""
beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  process.env.CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS = "500"
  const host = codepuppyEngine({ sandbox, name: "ask-timeout", modelBaseURL: model.baseURL })
  directory = host.projectDirectory
  running = await host.start()
}, 60_000)
afterAll(async () => {
  await running?.close().catch(() => undefined)
  model.stop()
  delete process.env.CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS
})

describe("#1214 AC2:审批等到期限无人应答 ⇒ 工具卡认出「审批超时」", () => {
  test("请求审批档的 shell 调用到期 ⇒ 适配器给出的工具部件被卡片分类为审批超时;模型下一轮读到同一句话", async () => {
    const send = running!.send
    const sessionID = (await send("POST", "/api/session", { location: { directory }, agent: "codepuppy-ask", model: { id: "m", providerID: "codepuppy" } })).json.data.id as string
    await send("POST", `/api/session/${sessionID}/prompt`, { text: `CP-CALL ${JSON.stringify({ name: "shell", args: { command: "ls", description: "list" } })}` })
    await send("POST", `/api/experimental/session/${sessionID}/wait`)

    const source = (await send("GET", `/api/session/${sessionID}/message?order=asc`)).json.data
    const { parts } = normalizeSessionMessages(sessionID, source)
    const tool = [...parts.values()].flat().find((part) => part.type === "tool" && part.tool === "shell")
    expect(tool?.type).toBe("tool")
    expect(tool && tool.type === "tool" ? tool.state.status : undefined).toBe("error")
    const head = toolCardHeadOf(tool as never)
    expect(head.askTimedOut).toBe(true)

    // 模型读到的:下一轮请求里这次工具调用的结果就是这句(首行 + 请求的动作与资源 + 回到会话重试的指引)
    const before = model.requests.length
    await send("POST", `/api/session/${sessionID}/prompt`, { text: "and now?" })
    await send("POST", `/api/experimental/session/${sessionID}/wait`)
    // 2.x 把工具失败按 `{"error":{"type":"tool.execution","message":…}}` 交给模型(上游的统一形状);message 就是 0.1.26 那四行
    const toolMessage = model.requests
      .slice(before)
      .flatMap((request) => request.messages)
      .find((message) => message.role === "tool")
    const read = JSON.parse(textOf(toolMessage?.content)) as { error?: { message?: string } }
    expect(read.error?.message).toBe(
      "审批请求等待 1 秒无人应答,已按 fail-closed 结束:本次操作**没有**被放行。\n" +
        '请求:permission=shell patterns=["ls"]\n' +
        "常见原因:审批对话框所在的会话页没有打开(切到了别的会话/别的页面),或审批面未连上本会话。\n" +
        "下一步:回到该会话页后重试这次操作;若这类操作应当长期放行,把它写进 permission 规则(config 里配成 allow),不要靠等待。",
    )
  }, 60_000)
})
