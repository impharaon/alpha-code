// `#1667`(#1662 L5,设计 1662「MCP OAuth on OpenCode 2」决定 3):admission 的 MCP OAuth 就绪探针在 OpenCode 2 上的语义,
// 对着沙箱里的真引擎 + 本机一个 OAuth 授权服务器兼远端 MCP 的替身判。被测的是生产接缝 `createPackageMcpOauthEngineV1`
// (`PUT /api/experimental/mcp/:server`,再读 `GET /api/mcp` 直到不是 pending),经生产 engineClient 带 Basic 口令。
//   · 登录走引擎自己的集成 OAuth(list → get → connect/oauth → 「浏览器」跟 302 到引擎自己的回环回调 → attempt complete);
//   · 同名同 URL ⇒ connected;同一个 URL 换个名字 ⇒ needs_auth(凭证按「名 + URL」绑定);登录前同名同 URL ⇒ needs_auth;
//   · 引擎拒绝请求(口令不对)⇒ { ok: false },admission 据此 fail-closed;
//   · 反向臂:v1 的 `POST /mcp` 在 2.x 引擎上拿不到这台服务的状态(旧接缝在 2.x 上恒判 engine-unavailable)。
// 本文件由 package-mcp-oauth.engine.test.ts 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,默认 Location
// (进程 cwd)也切到沙箱里的空项目目录,绝不碰 owner 的数据目录、浏览器或钥匙串。围栏不在这里测(设计 §10 R-2 已在生产围栏下实测)。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../test-component/engine-sandbox"
import { engineAuthorization } from "./engine-authorization"
import { buildEngineServerOptions } from "./engine-server-options"
import { engineClient } from "./engine-client"
import { createPackageMcpOauthEngineV1 } from "./package-mcp-oauth"

const sandbox = engineSandbox()
const PASSWORD = "cp-l5-mcp-oauth"
const SERVICE = "oauth-remote"
const OTHER_NAME = "oauth-remote-renamed"

// ── 替身:OAuth 授权服务器 + 要求 Bearer 的远端 MCP(同一个回环源)────────────────────────────────────────────────
const challenges = new Map<string, string>()
const tokens = new Set<string>()
const fake = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const origin = url.origin
    const path = url.pathname
    if (path.startsWith("/.well-known/oauth-protected-resource"))
      return Response.json({ resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ["header"] })
    if (path.startsWith("/.well-known/oauth-authorization-server") || path.startsWith("/.well-known/openid-configuration"))
      return Response.json({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      })
    if (path === "/register" && request.method === "POST")
      return Response.json(
        { ...((await request.json()) as object), client_id: `cp-l5-client-${randomBytes(4).toString("hex")}`, token_endpoint_auth_method: "none" },
        { status: 201 },
      )
    if (path === "/authorize") {
      const code = `code-${randomBytes(8).toString("hex")}`
      challenges.set(code, url.searchParams.get("code_challenge") ?? "")
      const back = new URL(url.searchParams.get("redirect_uri") ?? "")
      back.searchParams.set("code", code)
      back.searchParams.set("state", url.searchParams.get("state") ?? "")
      return new Response(null, { status: 302, headers: { location: back.toString() } })
    }
    if (path === "/token" && request.method === "POST") {
      const form = new URLSearchParams(await request.text())
      const code = form.get("code") ?? ""
      const challenge = challenges.get(code)
      if (challenge === undefined || createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") !== challenge)
        return Response.json({ error: "invalid_grant" }, { status: 400 })
      challenges.delete(code)
      const token = `tok-${randomBytes(8).toString("hex")}`
      tokens.add(token)
      return Response.json({ access_token: token, token_type: "Bearer", expires_in: 3600 })
    }
    if (path === "/mcp") {
      const authorization = request.headers.get("authorization") ?? ""
      if (!authorization.startsWith("Bearer ") || !tokens.has(authorization.slice("Bearer ".length)))
        return Response.json(
          { error: "unauthorized" },
          { status: 401, headers: { "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` } },
        )
      if (request.method !== "POST") return new Response(null, { status: 405 })
      const message = (await request.json()) as { id?: unknown; method?: string; params?: { protocolVersion?: string } }
      if (message.id === undefined) return new Response(null, { status: 202 })
      const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: message.id, result }, { headers: { "mcp-session-id": "cp-l5-session" } })
      if (message.method === "initialize")
        return reply({ protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "cp-l5-mcp", version: "1.0.0" } })
      if (message.method === "tools/list")
        return reply({ tools: [{ name: "cp_l5_ping", description: "ping", inputSchema: { type: "object", properties: {} } }] })
      if (message.method === "ping") return reply({})
      return Response.json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } })
    }
    return new Response("not found", { status: 404 })
  },
})
const MCP_URL = `http://127.0.0.1:${fake.port}/mcp`

const engines: Array<{ close: () => Promise<void> }> = []
let engineUrl = ""
let client: ReturnType<typeof engineClient>
const previousCwd = process.cwd()

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  const { startEngine } = await import("../../engine/engine-embed")
  const slot = engineSlot(sandbox, "mcp-oauth")
  // 生产接缝不带 location(与 v1 的 `POST /mcp` 同义)⇒ 引擎用进程 cwd 当默认 Location;切到沙箱里的空项目目录。
  process.chdir(slot.projectDirectory)
  const engine = await startEngine(
    buildEngineServerOptions({
      hostname: "127.0.0.1",
      port: 0,
      password: PASSWORD,
      engineVersion: "test",
      databasePath: slot.databasePath,
      configDirectory: slot.configDirectory,
      config: { content: "{}" },
      models: { fetch: false },
      filewatcher: false,
      platform: process.platform,
    }),
  )
  engines.push(engine)
  engineUrl = engine.url
  client = engineClient({ url: engine.url, username: "opencode", password: PASSWORD })
})

afterAll(async () => {
  for (const engine of engines.reverse()) await engine.close().catch(() => undefined)
  process.chdir(previousCwd)
  fake.stop(true)
})

/** 引擎自己的集成 OAuth,调用顺序与 U6 适配层相同;「浏览器」是本进程(与真浏览器一样在引擎外)。 */
async function signInThroughEngine(name: string) {
  const integration = (await client.integration.list()).data.find(
    (entry) => entry.metadata?.source === "mcp" && entry.name === name,
  )
  if (!integration) throw new Error(`engine lists no MCP integration named ${name}`)
  const method = (await client.integration.get({ integrationID: integration.id })).data.methods.find(
    (entry) => entry.type === "oauth",
  )
  if (!method) throw new Error(`integration ${integration.id} has no oauth method`)
  const attempt = (await client.integration.oauth.connect({ integrationID: integration.id, methodID: method.id })).data
  const authorize = await fetch(attempt.url, { redirect: "manual" })
  const callback = await fetch(authorize.headers.get("location") ?? "")
  expect(callback.status).toBe(200)
  for (;;) {
    const status = (await client.integration.oauth.status({ integrationID: integration.id, attemptID: attempt.attemptID })).data
    if (status.status !== "pending") return status.status
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

describe("admission 的 MCP OAuth 就绪探针(OpenCode 2)", () => {
  test("同名同 URL 只有在引擎自己的登录之后才 connected;同一个 URL 换个名字 ⇒ needs_auth", async () => {
    const probe = createPackageMcpOauthEngineV1(async () => ({ url: engineUrl, username: "opencode", password: PASSWORD }))
    expect(await probe.add(SERVICE, { type: "remote", url: MCP_URL })).toEqual({ ok: true, status: "needs_auth" })
    expect(await signInThroughEngine(SERVICE)).toBe("complete")
    expect(await probe.add(SERVICE, { type: "remote", url: MCP_URL })).toEqual({ ok: true, status: "connected" })
    expect(await probe.add(OTHER_NAME, { type: "remote", url: MCP_URL })).toEqual({ ok: true, status: "needs_auth" })
  }, 60_000)

  test("引擎拒绝请求(口令不对)⇒ { ok: false },不给状态", async () => {
    const probe = createPackageMcpOauthEngineV1(async () => ({ url: engineUrl, username: "opencode", password: "wrong" }))
    expect(await probe.add(SERVICE, { type: "remote", url: MCP_URL })).toMatchObject({ ok: false })
  }, 30_000)

  test("反向臂:v1 的 POST /mcp 在 2.x 引擎上拿不到这台服务的状态", async () => {
    const response = await fetch(`${engineUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: engineAuthorization(PASSWORD), "Content-Type": "application/json" },
      body: JSON.stringify({ name: SERVICE, config: { type: "remote", url: MCP_URL, enabled: true } }),
    })
    const body = await response.text()
    const parsed = (() => {
      try {
        return JSON.parse(body) as Record<string, { status?: unknown } | undefined>
      } catch {
        return undefined
      }
    })()
    expect({ status: response.status, serviceStatus: parsed?.[SERVICE]?.status }).toEqual({ status: 404, serviceStatus: undefined })
  }, 30_000)
})
