// `#1668` I7a:审批请求的形状。夹具 = 真 2.x 引擎的 permission.asked 帧与同一时刻的 `GET /api/permission/request`
// (fixtures/permission-asked.json);引擎没装 ext,metadata 为空,这里按 seams I7a 补上 L4 会写的四个冻结键。
// 回复一侧暂缓(编排器 2026-11-09:等 L4 的回执规格),这里钉住它是**明确标注的桩**,不是静默吞掉。
import { describe, expect, spyOn, test } from "bun:test"
import fixture from "./fixtures/permission-asked.json"
import { createProjector, type V1Payload } from "./events"
import { createEngineFetch } from "./index"
import { toV1PermissionRequest } from "./v1-shapes"

const I7A_METADATA = {
  identity: { kind: "builtin", name: "read" },
  authority: { kind: "engine" },
  policy: { canonical: "read", askedBy: "policy" },
  codepuppyRisk: "low",
}

const asked = { ...fixture.frame.data, metadata: I7A_METADATA }

describe("#1668 I7a 审批请求 2.x → v1", () => {
  test("事件流:action/resources/save/source 映射回 v1 的 permission/patterns/always/tool,metadata 四键原样透传", async () => {
    const events: V1Payload[] = []
    const api = { session: { get: async () => ({ location: { directory: fixture.frame.location.directory } }) } }
    const projector = createProjector(api as never, (_directory, payload) => events.push(payload))
    await projector({ ...fixture.frame, data: asked } as never)
    expect(events).toEqual([
      {
        type: "permission.asked",
        properties: {
          id: asked.id,
          sessionID: asked.sessionID,
          permission: "read",
          patterns: [".env"],
          always: ["*"],
          metadata: I7A_METADATA,
          tool: { messageID: asked.source.messageID, callID: asked.source.id },
        },
      },
    ])
  })

  test("列表:GET /permission 与事件同一个映射(同一个真引擎请求)", () => {
    const [listed] = fixture.list.data
    expect(toV1PermissionRequest(listed as never)).toMatchObject({
      permission: "read",
      patterns: [".env"],
      tool: { messageID: listed!.source.messageID, callID: listed!.source.id },
    })
  })

  test("反向臂:直接用冻结 app 的 1.17.13 归一(不补 2.x 的 `source.id`)⇒ 审批卡丢掉工具调用 id", async () => {
    const { normalizePermissionRequest } = await import("./frozen-shapes")
    expect((normalizePermissionRequest(asked as never).tool as { callID?: string }).callID).toBeUndefined()
  })

  test("回复暂缓:三个回复入口都是明确标注的 501(等 L4 回执规格),不猜回执、不发往引擎", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {})
    const seen: string[] = []
    const engineFetch = createEngineFetch({
      isEngineOrigin: (origin) => origin === "http://127.0.0.1:47002",
      fetch: (async (input: RequestInfo | URL) => {
        seen.push(String(input))
        return new Response(null, { status: 204 })
      }) as typeof fetch,
    })
    for (const path of ["/permission/per_1/reply", "/session/ses_1/permissions/per_1", "/api/session/ses_1/permission/per_1/reply"]) {
      const response = await engineFetch(`http://127.0.0.1:47002${path}`, { method: "POST", body: JSON.stringify({ reply: "once" }) })
      expect(response.status).toBe(501)
      expect(JSON.stringify(await response.json())).toContain("L4 receipt spec")
    }
    expect(seen).toEqual([])
    error.mockRestore()
  })
})
