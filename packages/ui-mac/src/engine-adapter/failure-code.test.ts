// `#1668` H2:Code Puppy 登记的失败码前缀(L4 在接管的引擎代码里用 `withFailureCode` 加在 `Mcp.Status` 的 error 与会话错误
// message 前面)。适配器用 `parseFailureCode` 读回:去掉前缀给界面显示,码交给 0.1.26 读的字段 —— MCP 的 `code`(定制中心的
// 「重新安装」,use-extensions.ts mcpRepair)与回合错误的网络层(timeline-model.ts turnErrorOf)。
//
// 前缀由 L4 的生产函数 `withFailureCode` 现做(不手写它的文法);消息形状取真引擎采样(fixtures/read-tool.json 的助手消息,
// 补上 2.x `Session.StructuredError` 形状的 error)。
import { describe, expect, test } from "bun:test"
import { classifyNetFailure, withFailureCode } from "@opencode/schema/codepuppy-net-failure"
import { CODEPUPPY_OFFICE_CONNECTORS } from "../shared/office-advisories"
import { mcpRepair } from "../renderer/extensions/use-extensions"
import { turnErrorOf } from "../renderer/codepuppy-ui/session-timeline/timeline-model"
import readTool from "./fixtures/read-tool.json"
import { createProjector, type V1Payload } from "./opencode2/events"
import { createReceiptLedger } from "./contract/receipts"
import { toV1McpStatus, toV1Messages } from "./opencode2/v1-shapes"

const office = CODEPUPPY_OFFICE_CONNECTORS[0]!.name

describe("#1668 H2 登记失败码 → 0.1.26 读的字段", () => {
  test("MCP failed:去掉前缀显示原文,dependency_missing 让第一方文档工具给出「重新安装」", () => {
    const status = toV1McpStatus([
      { name: office, status: { status: "failed", error: withFailureCode("dependency_missing", "spawn python3 ENOENT") } },
      { name: "other", status: { status: "failed", error: "connection closed" } },
    ] as never)
    expect(status[office]).toEqual({ status: "failed", error: "spawn python3 ENOENT", code: "dependency_missing" })
    expect(mcpRepair(office, status[office])).toBe("reinstall-app")
    // 没有前缀:原样,不归因
    expect(status.other).toEqual({ status: "failed", error: "connection closed" })
    expect(mcpRepair("other", status.other)).toBeUndefined()
  })

  test("会话错误(消息读回):网络层进 metadata.codepuppyNetLayer,回合错误卡按层说话,文本不带前缀", () => {
    const fixture = readTool as unknown as { sessionID: string; final: any[] }
    const final = JSON.parse(JSON.stringify(fixture.final))
    // 失败落在回合最后一条助手上(前面的助手之后还有成功的助手 = 已被续写接过去,不算回合失败)。
    const assistant = final.filter((message: any) => message.type === "assistant").at(-1)
    assistant.error = { type: "provider.transport", message: withFailureCode("dns", "getaddrinfo ENOTFOUND api.example.com") }
    const infos = toV1Messages(fixture.sessionID, final).map((item) => item.info).filter((info) => info.role === "assistant")
    expect(turnErrorOf(infos as never)).toMatchObject({ message: "getaddrinfo ENOTFOUND api.example.com", netLayer: "dns" })
  })

  // 0.2.4 owner 报告:「这轮回复没有完成 / Connection lost while reading the response: UND_ERR_BODY_TIMEOUT: Body Timeout Error / APIError」。
  // 回复读到一半断流:引擎 @opencode/ai route/executor.ts 记 Transport(operation read),带回 200 应答的状态;分类器认不出层。
  // 失败消息的形状照 to-session-error.ts providerError("provider.transport"):status 来自 http 上下文。
  const MID_STREAM = "Connection lost while reading the response: UND_ERR_BODY_TIMEOUT: Body Timeout Error"
  const finalWith = (mutate: (final: any[]) => void) => {
    const fixture = readTool as unknown as { sessionID: string; final: any[] }
    const final = JSON.parse(JSON.stringify(fixture.final))
    mutate(final)
    return toV1Messages(fixture.sessionID, final).map((item) => item.info).filter((info) => info.role === "assistant")
  }

  test("回复读到一半断流(认不出层的联网失败)⇒ 记作「连接中途断开了」,不让原文当正文", () => {
    const infos = finalWith((final) => {
      const last = final.filter((message) => message.type === "assistant").at(-1)
      last.error = { type: "provider.transport", message: MID_STREAM, status: 200 }
      final.find((message) => message.type === "idle").outcome = "failed"
    })
    expect(turnErrorOf(infos as never)).toMatchObject({ name: "APIError", message: MID_STREAM, netUnattributed: true })
    expect(turnErrorOf(infos as never)?.cause).toBeUndefined()
  })

  test("断流后引擎续写完成(step.ts Outcome.Continue)⇒ 这一轮完成了,不出回合错误卡", () => {
    const infos = finalWith((final) => {
      const first = final.find((message) => message.type === "assistant")
      first.error = { type: "provider.transport", message: MID_STREAM, status: 200 }
      const at = final.indexOf(first) + 1
      final.splice(at, 0, {
        id: "msg_1f205480a001ContinueSynth01",
        type: "synthetic",
        text: "The previous response was interrupted. Continue from where you left off without repeating completed content.",
        time: { created: first.time.completed + 1 },
      })
    })
    expect(infos).toHaveLength(2)
    expect(turnErrorOf(infos as never)).toBeUndefined()
  })

  test("续写成功之后回合又在 idle 上失败 ⇒ 回合错误卡写的是这次失败,不是前面已恢复的那次", () => {
    const infos = finalWith((final) => {
      const first = final.find((message) => message.type === "assistant")
      first.error = { type: "provider.transport", message: MID_STREAM, status: 200 }
      const idle = final.find((message) => message.type === "idle")
      idle.outcome = "failed"
      idle.error = { type: "provider.no-route", message: "No model selected" }
    })
    expect(turnErrorOf(infos as never)).toMatchObject({ message: "No model selected" })
  })

  test("会话错误(事件流):session.error 与重试状态的文本同样去掉前缀,网络层同样带上", async () => {
    const events: V1Payload[] = []
    const api = {
      message: { list: async () => ({ data: [], cursor: {} }) },
      session: { get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, location: { directory: "/p" }, time: { created: 0, updated: 0 } }), diff: async () => [] },
    }
    const projector = createProjector(api as never, (_directory, payload) => events.push(payload), createReceiptLedger())
    const error = { type: "provider.transport", message: withFailureCode("tcp", "connect ECONNREFUSED 10.0.0.1:443") }
    await projector({ type: "session.retry.scheduled", location: { directory: "/p" }, data: { sessionID: "ses_1", attempt: 1, at: 1, error } } as never)
    await projector({ type: "session.execution.failed", location: { directory: "/p" }, data: { sessionID: "ses_1", error } } as never)
    expect(events.find((event) => event.type === "session.status")?.properties).toMatchObject({
      status: { type: "retry", message: "connect ECONNREFUSED 10.0.0.1:443" },
    })
    expect(events.find((event) => event.type === "session.error")?.properties).toEqual({
      sessionID: "ses_1",
      error: { name: "UnknownError", data: { message: "connect ECONNREFUSED 10.0.0.1:443", metadata: { codepuppyNetLayer: "tcp" } } },
    })
  })

  // 0.2.4 owner 报告:实时重试行写出了 `UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error (…`。重试状态要像回合错误一样把层带给界面,
  // 界面才能写「连接超时」而不是原文。消息由引擎结算点同一对生产函数现做(classifyNetFailure 认 undici 连接超时 → withFailureCode)。
  test("重试状态(连接超时):文本去掉前缀,网络层随状态带到界面", async () => {
    const events: V1Payload[] = []
    const api = {
      message: { list: async () => ({ data: [], cursor: {} }) },
      session: { get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, location: { directory: "/p" }, time: { created: 0, updated: 0 } }), diff: async () => [] },
    }
    const projector = createProjector(api as never, (_directory, payload) => events.push(payload), createReceiptLedger())
    const undici = {
      name: "ConnectTimeoutError",
      code: "UND_ERR_CONNECT_TIMEOUT",
      message: "Connect Timeout Error (attempted address: gateway.example.com:443, timeout: 10000ms)",
    }
    const net = classifyNetFailure({ message: "fetch failed", cause: undici }, { via: "other" })
    expect(net).toEqual({ layer: "connect-timeout", code: "UND_ERR_CONNECT_TIMEOUT" })
    const raw = `${undici.code}: ${undici.message}`
    const error = { type: "provider.transport", message: withFailureCode(net!.layer, raw) }
    await projector({ type: "session.retry.scheduled", location: { directory: "/p" }, data: { sessionID: "ses_1", attempt: 2, at: 5, error } } as never)
    expect(events.find((event) => event.type === "session.status")?.properties).toEqual({
      sessionID: "ses_1",
      status: { type: "retry", attempt: 2, message: raw, metadata: { codepuppyNetLayer: "connect-timeout" }, next: 5 },
    })
  })
})
