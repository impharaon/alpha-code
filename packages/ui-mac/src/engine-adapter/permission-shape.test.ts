// `#1668` I7a:审批请求的形状。夹具 = 真 2.x 引擎的 permission.asked 帧与同一时刻的 `GET /api/permission/request`
// (fixtures/permission-asked.json);引擎没装 ext,metadata 为空,这里按 seams I7a 补上 L4 会写的四个冻结键。
// 回复与回执按 L4 的推导规格实现,行为由 permission-reply.test.ts 钉住;这里只钉三个回复入口都接上了。
import { describe, expect, spyOn, test } from "bun:test"
import fixture from "./fixtures/permission-asked.json"
import { createProjector, type V1Payload } from "./opencode2/events"
import { createEngineFetch } from "./index"
import { createPermissionReplies } from "./opencode2/permission-replies"
import { toV1PermissionRequest } from "./opencode2/v1-shapes"

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
    const projector = createProjector(api as never, (_directory, payload) => events.push(payload), createPermissionReplies())
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
    const { normalizePermissionRequest } = await import("../../../codepuppy-app/src/context/global-sync/utils")
    expect((normalizePermissionRequest(asked as never).tool as { callID?: string }).callID).toBeUndefined()
  })

  test("三个回复入口都接到回执逻辑(不再是 501 桩):这个窗口没交出过的请求 ⇒ 409,一个字节都不发往引擎", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {})
    const seen: string[] = []
    const engineFetch = createEngineFetch({
      isEngineOrigin: (origin) => origin === "http://127.0.0.1:47002",
      fetch: (async (input: RequestInfo | URL) => {
        seen.push(String(input))
        return new Response(null, { status: 204 })
      }) as typeof fetch,
    })
    const bodies: Record<string, unknown> = {
      "/permission/per_1/reply": { reply: "once" },
      "/session/ses_1/permissions/per_1": { response: "once" },
      "/api/session/ses_1/permission/per_1/reply": { decision: "once", decisionID: "pdec_1" },
    }
    for (const [path, body] of Object.entries(bodies)) {
      const response = await engineFetch(`http://127.0.0.1:47002${path}`, { method: "POST", body: JSON.stringify(body) })
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ _tag: "ConflictError", resource: "per_1" })
    }
    expect(seen).toEqual([])
    error.mockRestore()
  })
})
