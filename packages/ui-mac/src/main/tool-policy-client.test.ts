// REQ-131 / #1130 —— main 侧 tool policy 客户端:每个引擎状态码都映射到一个**闭集**结果码,
// 且 inventory 在 main 侧再 decode 一次(形状漂移 ⇒ invalid-shape,不把解释不了的对象交给 renderer)。
// `#1667`(#1662 接口文档 I5):2.x 下经插件 RPC `POST /api/rpc/codepuppy.tool-policy/<method>`,请求体 `{ input }`、
// 成功体 `{ output }`;RPC 错误(400 `RpcError { type }` / 500)按冻结的映射表逐行翻回现有失败码。
// 反向臂:URL 改回 v1 的 `/api/permission/tool-policy/*` ⇒ 第一组断言红。
import { describe, expect, test } from "bun:test"
import { createToolPolicyClient, toolPolicyRpcRoute } from "./tool-policy-client"

const server = { url: "http://127.0.0.1:39117", username: "opencode", password: "route-password" }
const directory = "/Users/kai/app/kama bot"

type Seen = { url: URL; method: string; headers: Record<string, string>; body: string | undefined }

function fetchFor(handler: (seen: Seen) => Response | Promise<Response>, seen: Seen[] = []) {
  const impl = async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url)
    const record: Seen = {
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})),
      body: typeof init?.body === "string" ? init.body : undefined,
    }
    seen.push(record)
    return handler(record)
  }
  return { fetch: impl as unknown as typeof fetch, seen }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const inventoryBody = {
  version: 1,
  partition: { account: "anonymous", workspace: "prj_1" },
  user: { status: "absent" },
  managed: { status: "ok" },
  classRecords: [],
  services: [
    {
      source: "builtin",
      origin: "",
      class: "builtin",
      authority: { kind: "not-asserted" },
      tools: [
        {
          canonical: "builtin::write",
          identity: { source: "builtin", origin: "", name: "write" },
          technicalId: "write",
          authority: { kind: "not-asserted" },
          effective: { state: "enabled", action: "allow", reason: { kind: "default", class: "builtin" } },
          newlyDiscovered: false,
        },
      ],
    },
  ],
  invalid: { count: 0, entries: [] },
}

describe("tool policy client (main) —— 插件 RPC", () => {
  const rpcError = (type: string) => json(400, { _tag: "RpcError", type, message: type })

  test("inventory: POST /api/rpc/codepuppy.tool-policy/inventory,Basic 口令 + 编码过的目录头,body {};decode { output }", async () => {
    const { fetch, seen } = fetchFor(() => json(200, { output: inventoryBody }))
    const client = createToolPolicyClient({ awaitServer: async () => server, fetch })
    const result = await client.inventory({ directory })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error("expected ok")
    expect(result.inventory.services[0]!.tools[0]!.canonical).toBe("builtin::write")
    expect(seen).toHaveLength(1)
    expect(seen[0]!.url.pathname).toBe("/api/rpc/codepuppy.tool-policy/inventory")
    expect(seen[0]!.url.pathname).toBe(toolPolicyRpcRoute("inventory"))
    expect(seen[0]!.url.pathname.startsWith("/api/permission/tool-policy")).toBe(false)
    expect(seen[0]!.method).toBe("POST")
    expect(JSON.parse(seen[0]!.body!)).toEqual({})
    expect(seen[0]!.headers.Authorization).toBe(`Basic ${Buffer.from("opencode:route-password").toString("base64")}`)
    expect(seen[0]!.headers["x-opencode-directory"]).toBe(encodeURIComponent(directory))
  })

  test("setRecord / removeRecord / reset 的路由与 { input } 请求体", async () => {
    const record = { selector: { level: "class", class: "plugin" }, state: "ask" } as const
    const selector = { level: "tool", canonical: "builtin::write" } as const
    const { fetch, seen } = fetchFor(({ url }) => json(200, url.pathname.endsWith("/reset") ? { output: { backup: "/x/policy.json.quarantined-1" } } : {}))
    const client = createToolPolicyClient({ awaitServer: async () => server, fetch })
    expect(await client.setRecord({ directory, record })).toEqual({ ok: true })
    expect(await client.removeRecord({ directory, selector })).toEqual({ ok: true })
    expect(await client.reset({ directory })).toEqual({ ok: true, backup: "/x/policy.json.quarantined-1" })
    expect(seen.map((s) => [s.method, s.url.pathname, JSON.parse(s.body!)])).toEqual([
      ["POST", "/api/rpc/codepuppy.tool-policy/setRecord", { input: record }],
      ["POST", "/api/rpc/codepuppy.tool-policy/removeRecord", { input: { selector } }],
      ["POST", "/api/rpc/codepuppy.tool-policy/reset", {}],
    ])
    expect(seen[0]!.headers["content-type"]).toBe("application/json")
  })

  test("inventory: a 200 whose output drifts from the wire contract is invalid-shape, not a partial list", async () => {
    const drifted = { ...inventoryBody, services: [{ ...inventoryBody.services[0], tools: [{ canonical: 1 }] }] }
    const { fetch } = fetchFor(() => json(200, { output: drifted }))
    const client = createToolPolicyClient({ awaitServer: async () => server, fetch })
    expect(await client.inventory({ directory })).toEqual({ ok: false, code: "invalid-shape" })
  })

  // 冻结映射表(接口文档 I5)逐行:[引擎回的, inventory, setRecord / removeRecord, reset]
  const table: Array<[string, () => Response, string, string, string]> = [
    ["503(引擎还在启动)", () => json(503, { code: "service_starting" }), "engine-unavailable", "engine-unavailable", "engine-unavailable"],
    ["400 rpc.unavailable(这个 Location 没注册 RPC)", () => rpcError("rpc.unavailable"), "not-wired", "not-wired", "not-wired"],
    ["400 quarantined", () => rpcError("quarantined"), "request-failed", "quarantined", "write-failed"],
    ["400 invalid-record", () => rpcError("invalid-record"), "request-failed", "invalid-record", "request-failed"],
    ["400 rpc.invalid_input", () => rpcError("rpc.invalid_input"), "request-failed", "invalid-record", "request-failed"],
    ["400 write-failed", () => rpcError("write-failed"), "request-failed", "write-failed", "write-failed"],
    ["500 RpcInternalError", () => json(500, { _tag: "RpcInternalError", type: "rpc.internal", message: "x" }), "request-failed", "write-failed", "write-failed"],
  ]
  for (const [label, response, read, write, reset] of table)
    test(`映射:${label} ⇒ inventory ${read} / 写 ${write} / reset ${reset}`, async () => {
      const client = createToolPolicyClient({ awaitServer: async () => server, fetch: fetchFor(response).fetch })
      const record = { selector: { level: "class", class: "plugin" }, state: "ask" } as const
      expect(await client.inventory({ directory })).toEqual({ ok: false, code: read })
      expect(await client.setRecord({ directory, record })).toEqual({ ok: false, code: write })
      expect(await client.removeRecord({ directory, selector: { level: "tool", canonical: "builtin::write" } })).toEqual({ ok: false, code: write })
      expect(await client.reset({ directory })).toEqual({ ok: false, code: reset })
    })

  test("拿不到地址 ⇒ engine-unavailable;传输失败 ⇒ request-failed(同 v1)", async () => {
    const down = createToolPolicyClient({ awaitServer: () => Promise.reject(new Error("no engine")), fetch: fetchFor(() => json(200, {})).fetch })
    expect(await down.inventory({ directory })).toEqual({ ok: false, code: "engine-unavailable" })
    const broken = createToolPolicyClient({
      awaitServer: async () => server,
      fetch: (async () => {
        throw new Error("socket hang up")
      }) as unknown as typeof fetch,
    })
    expect(await broken.setRecord({ directory, record: { selector: { level: "class", class: "plugin" }, state: "ask" } })).toEqual({ ok: false, code: "request-failed" })
  })

  test("every method refuses an empty directory before touching the engine (partition needs an instance)", async () => {
    const { fetch, seen } = fetchFor(() => json(200, { output: inventoryBody }))
    const client = createToolPolicyClient({ awaitServer: async () => server, fetch })
    expect(await client.inventory({ directory: "" })).toEqual({ ok: false, code: "request-failed" })
    expect(await client.reset({ directory: "   " })).toEqual({ ok: false, code: "request-failed" })
    expect(seen).toHaveLength(0)
  })
})
