// `#1668` I7a:审批回复与回执(permission-replies.ts,L4 推导规格)。
//
// 每一条都从冻结界面的消费形状走进适配器:v1 SDK(`throwOnError`,与 DirectorySDK 同配)经 engineFetch 发请求,
// 回执交给冻结的 replyPermissionV1 / createPermissionV2Feed / permissionDecisionSubmitError /
// createPermissionDecisionCommand,v2 入口按 permission-surface.tsx:73-80 的取法读 `result.data.data`。
// 引擎一侧是假的 HTTP 引擎:请求、replied 帧、404 体都取自真 2.x 引擎采样(fixtures/permission-reply.json,
// 同一份采样里适配器对真引擎的 reject 收据列出 A1+A2、重放同一张、再回一次 404);回复语义照 L4 实测的前提
// (packages/core/src/permission.ts reply():先发目标的 replied,reject 再逐条连带同会话的待审)。
// 每条都带反向臂:拿掉那条规则时会出什么错。
import { describe, expect, spyOn, test } from "bun:test"
import { createOpencodeClient, type PermissionV2DecisionCommand, type PermissionV2DecisionReceipt } from "@opencode-ai/sdk/v2/client"
import {
  adaptPermissionV1Receipt,
  adaptPermissionV1Request,
  replyPermissionV1,
} from "../../../codepuppy-app/src/context/permission-v1-adapter"
import { createPermissionDecisionCommand, permissionDecisionSubmitError } from "../renderer/codepuppy-ui/PermissionDialog"
import { createPermissionV2Feed } from "../renderer/codepuppy-ui/session-workspace/session-permission-feed"
import fixture from "./fixtures/permission-reply.json"
import { createProjector, type V1Payload } from "./events"
import { createEngineFetch } from "./index"
import { createPermissionReplies, requestFingerprint } from "./permission-replies"

const ORIGIN = "http://127.0.0.1:47003"
const { sessionA, sessionB, a1, a2, b1 } = fixture.ids
type EngineRequest = { id: string; sessionID: string; action: string; resources: string[]; save?: string[]; metadata?: Record<string, unknown> }
type Rule = { action: string; resource: string; effect: "allow" | "deny" | "ask" }
const ASKED = fixture.frames.filter((frame) => frame.type === "permission.asked").map((frame) => frame.data as EngineRequest)

/** 2.x `Wildcard.match`(packages/core/src/util/wildcard.ts)与 `evaluate`(permission.ts:94-104):最后一条命中的规则说了算。 */
function wildcard(input: string, pattern: string) {
  let escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
  return new RegExp(`^${escaped}$`, "s").test(input)
}
const evaluate = (rules: readonly Rule[], action: string, resource: string) =>
  rules.findLast((rule) => wildcard(action, rule.action) && wildcard(resource, rule.resource))?.effect ?? "ask"
/** build 档位对 `*.env` 询问(采样里那三条询问就是它问的)。 */
const AGENT_RULES: Rule[] = [
  { action: "read", resource: "*", effect: "allow" },
  { action: "read", resource: "*.env", effect: "ask" },
]

function fakeEngine(options: { repliedAfterResponse?: boolean } = {}) {
  const pending = new Map(ASKED.map((request) => [request.id, structuredClone(request)]))
  const sessionRules = new Map<string, Rule[]>()
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const replies: Array<{ requestID: string; decision: string; message?: string }> = []
  const patches: unknown[] = []
  const encoder = new TextEncoder()
  let sequence = 0
  const publish = (type: string, data: unknown) => {
    const chunk = encoder.encode(`data: ${JSON.stringify({ id: `evt_${++sequence}`, created: Date.now(), type, data })}\n\n`)
    for (const stream of streams) {
      try {
        stream.enqueue(chunk)
      } catch {
        streams.delete(stream)
      }
    }
  }
  const notFound = (requestID: string) =>
    Response.json({ ...fixture.replyAgain.body, requestID, message: `Permission request not found: ${requestID}` }, { status: 404 })

  /** permission.ts reply():目标的 replied 先发;reject 连带同会话的每一条待审;once 只了结目标。 */
  function reply(target: EngineRequest, decision: string) {
    const frames = [{ sessionID: target.sessionID, requestID: target.id, reply: decision }]
    pending.delete(target.id)
    if (decision === "reject")
      for (const [id, item] of pending) {
        if (item.sessionID !== target.sessionID) continue
        frames.push({ sessionID: item.sessionID, requestID: id, reply: "reject" })
        pending.delete(id)
      }
    // repliedAfterResponse:SSE 与回复响应走两条连接,帧可以晚于响应、而且一条一条地到(目标在前)。
    if (options.repliedAfterResponse)
      frames.forEach((frame, index) => setTimeout(() => publish("permission.replied", frame), 30 * (index + 1)))
    else frames.forEach((frame) => publish("permission.replied", frame))
  }

  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const { pathname } = new URL(request.url)
    const parts = pathname.split("/").filter(Boolean)
    const method = request.method
    if (method === "GET" && pathname === "/api/event") {
      let own: ReadableStreamDefaultController<Uint8Array> | undefined
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          own = controller
          streams.add(controller)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "evt_0", type: "server.connected", data: {} })}\n\n`))
        },
        cancel() {
          if (own) streams.delete(own)
        },
      })
      return new Response(body, { headers: { "content-type": "text/event-stream" } })
    }
    if (method === "GET" && pathname === "/api/permission/request")
      return Response.json({ location: { directory: "/proj" }, data: [...pending.values()] })
    if (parts[0] === "api" && parts[1] === "session" && parts[3] === "permission") {
      const sessionID = parts[2]!
      if (method === "GET" && parts.length === 4)
        return Response.json({ data: [...pending.values()].filter((item) => item.sessionID === sessionID) })
      const found = pending.get(parts[4]!)
      if (!found || found.sessionID !== sessionID) return notFound(parts[4]!)
      if (method === "GET" && parts.length === 5) return Response.json({ data: found })
      if (method === "POST" && parts[5] === "reply") {
        const body = (await request.json()) as { decision: string; message?: string }
        replies.push({ requestID: found.id, ...body })
        reply(found, body.decision)
        return new Response(null, { status: 204 })
      }
    }
    if (parts[0] === "api" && parts[1] === "session" && parts.length === 3) {
      const sessionID = parts[2]!
      if (method === "GET")
        return Response.json({
          data: {
            id: sessionID,
            projectID: "proj_1",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 0, updated: 0 },
            location: { directory: "/proj" },
            permissions: sessionRules.get(sessionID) ?? [],
          },
        })
      if (method === "PATCH") {
        const body = (await request.json()) as { permissions?: Rule[] }
        patches.push(body)
        if (body.permissions) sessionRules.set(sessionID, body.permissions)
        return new Response(null, { status: 204 })
      }
    }
    return Response.json({ name: "FakeEngineUnknownRoute", data: { method, pathname } }, { status: 599 })
  }

  /** 引擎问一次权限:规则放行就不问;要问就挂起并发 permission.asked。 */
  function ask(sessionID: string, action: string, resource: string) {
    const effect = evaluate([...AGENT_RULES, ...(sessionRules.get(sessionID) ?? [])], action, resource)
    if (effect !== "ask") return effect
    const request = { id: `per_fake_${++sequence}`, sessionID, action, resources: [resource], save: ["*"] }
    pending.set(request.id, request)
    publish("permission.asked", request)
    return effect
  }

  return { fetch: fetch as typeof globalThis.fetch, pending, replies, patches, sessionRules, ask }
}

function setup(options?: { repliedAfterResponse?: boolean }) {
  const engine = fakeEngine(options)
  const engineFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ORIGIN, fetch: engine.fetch })
  const client = createOpencodeClient({ baseUrl: ORIGIN, fetch: engineFetch as typeof fetch, throwOnError: true })
  /** 冻结 v1 通道的一张卡(适配器经 GET /permission 交出,冻结 adaptPermissionV1Request 铸 `engine-v1:` 指纹)。 */
  const cards = async (sessionID: string) =>
    ((await client.permission.list()).data ?? [])
      .filter((request) => request.sessionID === sessionID)
      .map((request) => adaptPermissionV1Request(request, "build"))
  /** permission-surface.tsx 的 v1 分支:replyPermissionV1(throwOnError 客户端)。 */
  const replyV1 = (sessionID: string) => (requestID: string, command: PermissionV2DecisionCommand) =>
    replyPermissionV1({ client } as never, { sessionID, requestID, command })
  /** permission-surface.tsx:73-80 的 v2 分支:回执 = `result.data.data`。 */
  const replyV2 = (sessionID: string, via = client) => (requestID: string, command: PermissionV2DecisionCommand) =>
    via.v2.session.permission
      .reply({ sessionID, requestID, permissionV2DecisionCommand: command })
      .then((result) => {
        if (!result.data) throw new Error("Permission reply response is missing DecisionReceipt")
        return result.data.data as PermissionV2DecisionReceipt
      })
  const fingerprint = (id: string) => requestFingerprint(engine.pending.get(id)! as never)
  return { engine, engineFetch, client, cards, replyV1, replyV2, fingerprint }
}

async function loadedFeed(list: () => Promise<any[]>, reply: (id: string, command: PermissionV2DecisionCommand) => Promise<PermissionV2DecisionReceipt>) {
  const feed = createPermissionV2Feed({ list, reply })
  feed.load()
  for (let attempt = 0; attempt < 100 && !feed.state.ready; attempt++) await Bun.sleep(5)
  expect(feed.state.ready).toBe(true)
  return feed
}

const ids = (feed: { state: { requests: Array<{ id: string }> } }) => feed.state.requests.map((request) => request.id)

describe("#1668 审批回执:冻结界面消费的形状", () => {
  test("v1 通道(审批卡的实际路径):once 经 replyPermissionV1 落到引擎,冻结 feed 收卡;v2 入口回 `{data: 收据}`,收据各字段齐", async () => {
    const { engine, cards, replyV1, replyV2, fingerprint } = setup()
    const feed = await loadedFeed(() => cards(sessionA), replyV1(sessionA))
    const card = feed.state.requests.find((request) => request.id === a1)!
    const synthesized = await feed.reply(a1, createPermissionDecisionCommand(card, "once"))
    expect(engine.replies).toEqual([{ requestID: a1, decision: "once" }])
    expect(synthesized).toMatchObject({ requestID: a1, sessionID: sessionA, decision: "once", resolvedRequestIDs: [a1] })
    expect(ids(feed)).toEqual([a2])

    const command = { requestFingerprint: await fingerprint(a2), decisionID: "pdec_shape", decision: "once" as const }
    const receipt = await replyV2(sessionA)(a2, command)
    expect(Object.keys(receipt).sort()).toEqual(
      ["committedAt", "decision", "decisionID", "requestFingerprint", "requestID", "resolvedRequestIDs", "sessionID"].sort(),
    )
    expect(receipt).toMatchObject({ requestID: a2, sessionID: sessionA, requestFingerprint: command.requestFingerprint, decisionID: "pdec_shape", decision: "once", resolvedRequestIDs: [a2] })
    expect(receipt.requestFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof receipt.committedAt).toBe("number")
    feed.apply({ type: "replied", receipt })
    expect(ids(feed)).toEqual([])
  })

  test("反向臂:没有适配器合成收据(2.x 回复只回 204)⇒ permission-surface 的取法当场报缺收据", async () => {
    const { engine, replyV2, fingerprint } = setup()
    const raw = createOpencodeClient({ baseUrl: ORIGIN, fetch: engine.fetch, throwOnError: true })
    const command = { requestFingerprint: await fingerprint(a1), decisionID: "pdec_raw", decision: "once" as const }
    await expect(replyV2(sessionA, raw)(a1, command)).rejects.toThrow("missing DecisionReceipt")
  })

  test("v2 审批通道列表为空:2.x 请求只经 v1 通道进审批面(否则缺 subject/scope 的 v2 形状会被卡片自动拒绝)", async () => {
    const { client, cards } = setup()
    const listed = await client.v2.session.permission.list({ sessionID: sessionA })
    expect(listed.data?.data).toEqual([])
    expect((await cards(sessionA)).map((card) => card.fingerprint)).toEqual([`engine-v1:${a1}`, `engine-v1:${a2}`])
  })
})

describe("#1668 审批回执:陈旧快照 409、过期 404", () => {
  test("交出后引擎里同一 id 的内容变了 ⇒ 409 ConflictError,卡片判为冲突,什么都不发;对照:内容没变照常发出", async () => {
    const stale = setup()
    const feed = await loadedFeed(() => stale.cards(sessionA), stale.replyV1(sessionA))
    stale.engine.pending.get(a1)!.metadata = { changed: true }
    const card = feed.state.requests.find((request) => request.id === a1)!
    const error = await feed.reply(a1, createPermissionDecisionCommand(card, "once")).catch((caught) => caught)
    expect(permissionDecisionSubmitError(error).kind).toBe("conflict")
    expect(stale.engine.replies).toEqual([])
    expect(ids(feed)).toContain(a1)

    const fresh = setup()
    const control = await loadedFeed(() => fresh.cards(sessionA), fresh.replyV1(sessionA))
    await control.reply(a1, createPermissionDecisionCommand(control.state.requests.find((request) => request.id === a1)!, "once"))
    expect(fresh.engine.replies).toEqual([{ requestID: a1, decision: "once" }])
  })

  test("v2 命令的指纹不是那份快照 ⇒ 409;这个窗口从没交出过的请求 ⇒ 409(决定没绑在显示过的快照上)", async () => {
    const { engine, replyV2, replyV1 } = setup()
    const wrong = { requestFingerprint: "0".repeat(64), decisionID: "pdec_wrong", decision: "once" as const }
    const conflict = await replyV2(sessionA)(a1, wrong).catch((caught) => caught)
    expect(permissionDecisionSubmitError(conflict).kind).toBe("conflict")

    const error = spyOn(console, "error").mockImplementation(() => {})
    const unseen = await replyV1(sessionB)(b1, { requestFingerprint: `engine-v1:${b1}`, decisionID: "pdec_unseen", decision: "once" }).catch(
      (caught) => caught,
    )
    expect(permissionDecisionSubmitError(unseen).kind).toBe("conflict")
    expect(error.mock.calls.flat().join(" ")).toContain(b1)
    error.mockRestore()
    expect(engine.replies).toEqual([])
  })

  test("交出后请求已不在引擎里(别处答了 / 引擎重启)⇒ 404 PermissionNotFoundError,卡片判为失败,什么都不发", async () => {
    const { engine, cards, replyV1 } = setup()
    const feed = await loadedFeed(() => cards(sessionA), replyV1(sessionA))
    engine.pending.delete(a1)
    const error = await feed.reply(a1, createPermissionDecisionCommand(feed.state.requests.find((r) => r.id === a1)!, "once")).catch((caught) => caught)
    // 冻结 v1 SDK 的 throwOnError 把错误体包成 Error(message, { cause: { body, status } })(codepuppy-sdk-v1/src/error-interceptor.ts)。
    expect((error as Error).cause).toMatchObject({ status: 404, body: { _tag: "PermissionNotFoundError", requestID: a1 } })
    expect(permissionDecisionSubmitError(error).kind).toBe("failed")
    expect(engine.replies).toEqual([])
  })
})

describe("#1668 审批回执:幂等重放", () => {
  test("同一命令再来一次 ⇒ 同一张收据,引擎只收到一次;反向臂:真引擎对同一 id 的第二次回复是 404(采样)", async () => {
    const { engine, client, cards, replyV2, fingerprint } = setup()
    await cards(sessionA)
    const command = { requestFingerprint: await fingerprint(a1), decisionID: "pdec_replay", decision: "once" as const }
    const [first, concurrent] = await Promise.all([replyV2(sessionA)(a1, command), replyV2(sessionA)(a1, command)])
    const again = await replyV2(sessionA)(a1, command)
    expect(concurrent).toEqual(first)
    expect(again).toEqual(first)
    expect(engine.replies).toEqual([{ requestID: a1, decision: "once" }])

    expect(fixture.replyAgain.status).toBe(404)
    expect(fixture.replay).toEqual(fixture.rejected)
    const direct = await engine.fetch(`${ORIGIN}/api/session/${sessionA}/permission/${a1}/reply`, {
      method: "POST",
      body: JSON.stringify({ decision: "once" }),
    })
    expect(direct.status).toBe(404)

    for (const changed of [
      { ...command, decisionID: "pdec_other" },
      { ...command, decision: "reject" as const },
    ]) {
      const error = await client.v2.session.permission
        .reply({ sessionID: sessionA, requestID: a1, permissionV2DecisionCommand: changed })
        .catch((caught) => caught)
      expect(permissionDecisionSubmitError(error).kind).toBe("conflict")
    }
    expect(engine.replies).toHaveLength(1)
  })

  test("v1 入口的重试(审批卡「重试」沿用失败的命令)⇒ 成功而不是 404,引擎只收到一次", async () => {
    const { engine, cards, replyV1 } = setup()
    const [card] = await cards(sessionA)
    const command = createPermissionDecisionCommand(card!, "once")
    await replyV1(sessionA)(a1, command)
    await expect(replyV1(sessionA)(a1, command)).resolves.toMatchObject({ requestID: a1 })
    expect(engine.replies).toEqual([{ requestID: a1, decision: "once" }])
  })
})

describe("#1668 审批回执:reject 的连带", () => {
  test("reject A1 ⇒ 收据列出 A1 与同会话的 A2,另一会话的 B1 不动;replied 帧晚于回复响应到达也不漏(与真引擎采样的收据一致)", async () => {
    const { engine, cards, replyV2, fingerprint } = setup({ repliedAfterResponse: true })
    const feed = await loadedFeed(() => cards(sessionA), replyV2(sessionA))
    const command = { requestFingerprint: await fingerprint(a1), decisionID: "pdec_cascade", decision: "reject" as const }
    const receipt = await feed.reply(a1, command)
    expect(receipt.resolvedRequestIDs).toEqual([a1, a2])
    expect(receipt.resolvedRequestIDs).toEqual(fixture.rejected.body.data.resolvedRequestIDs)
    expect([...engine.pending.keys()]).toEqual([b1])
    expect(ids(feed)).toEqual([])
  })

  test("反向臂:收据只列目标(没有事件窗口)⇒ 冻结 feed 里同会话的 A2 一直挂着", async () => {
    const { cards, replyV1 } = setup()
    const feed = await loadedFeed(() => cards(sessionA), replyV1(sessionA))
    feed.apply({ type: "replied", receipt: adaptPermissionV1Receipt({ sessionID: sessionA, requestID: a1, reply: "reject" }) })
    expect(ids(feed)).toEqual([a2])
  })

  test("v1 通道:连带的 replied 帧经投影器成为 v1 permission.replied,冻结 feed 逐条收卡", async () => {
    const replies = createPermissionReplies()
    const events: V1Payload[] = []
    const api = { session: { get: async () => ({ location: { directory: "/proj" } }) } }
    const projector = createProjector(api as never, (_directory, payload) => events.push(payload), replies)
    const feed = await loadedFeed(
      async () => ASKED.filter((request) => request.sessionID === sessionA).map((request) => adaptPermissionV1Request(replies.show(request as never) as never, "build")),
      async () => {
        throw new Error("unused")
      },
    )
    for (const frame of fixture.frames.filter((item) => item.type === "permission.replied")) await projector(frame as never)
    for (const event of events) feed.apply({ type: "replied", receipt: adaptPermissionV1Receipt(event.properties as never) })
    expect(ids(feed)).toEqual([])
  })
})

describe("#1668 「本次会话内允许」:会话规则 + once,从不发 2.x always", () => {
  test("会话卡点「本次会话内允许」⇒ 追加只覆盖所问动作与资源的 allow(已有规则保留)再回 once;同一资源不再问,另一资源照问", async () => {
    const { engine, cards, replyV1 } = setup()
    const existing: Rule = { action: "bash", resource: "git status", effect: "allow" }
    engine.sessionRules.set(sessionA, [existing])
    const feed = await loadedFeed(() => cards(sessionA), replyV1(sessionA))
    const card = feed.state.requests.find((request) => request.id === a1)!
    await feed.reply(a1, createPermissionDecisionCommand(card, "always", "proj_1"))
    expect(engine.patches).toEqual([{ permissions: [existing, { action: "read", resource: ".env", effect: "allow" }] }])
    expect(engine.replies).toEqual([{ requestID: a1, decision: "once" }])
    expect(engine.ask(sessionA, "read", ".env")).toBe("allow")
    expect(engine.ask(sessionA, "read", "other.env")).toBe("ask")
    expect(engine.ask(sessionB, "read", ".env")).toBe("ask")
  })

  test("反向臂:照 v1 `always` 记 save 模式(`*`)⇒ 另一资源也不再问 —— 上面「另一资源照问」那一条会红", () => {
    const saveRule: Rule = { action: "read", resource: "*", effect: "allow" }
    expect(evaluate([...AGENT_RULES, saveRule], "read", "other.env")).toBe("allow")
    expect(evaluate([...AGENT_RULES, { action: "read", resource: ".env", effect: "allow" }], "read", "other.env")).toBe("ask")
  })
})
