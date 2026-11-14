// `#1668` H2:Code Puppy 登记的失败码前缀(L4 在接管的引擎代码里用 `withFailureCode` 加在 `Mcp.Status` 的 error 与会话错误
// message 前面)。适配器用 `parseFailureCode` 读回:去掉前缀给界面显示,码交给 0.1.26 读的字段 —— MCP 的 `code`(定制中心的
// 「重新安装」,use-extensions.ts mcpRepair)与回合错误的网络层(timeline-model.ts turnErrorOf)。
//
// 前缀由 L4 的生产函数 `withFailureCode` 现做(不手写它的文法);消息形状取真引擎采样(fixtures/read-tool.json 的助手消息,
// 补上 2.x `Session.StructuredError` 形状的 error)。
import { describe, expect, test } from "bun:test"
import { withFailureCode } from "@opencode/schema/codepuppy-net-failure"
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
    const assistant = final.find((message: any) => message.type === "assistant")
    assistant.error = { type: "provider.transport", message: withFailureCode("dns", "getaddrinfo ENOTFOUND api.example.com") }
    const infos = toV1Messages(fixture.sessionID, final).map((item) => item.info).filter((info) => info.role === "assistant")
    expect(turnErrorOf(infos as never)).toMatchObject({ message: "getaddrinfo ENOTFOUND api.example.com", netLayer: "dns" })
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
})
