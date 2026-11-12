// REQ-236 AC2 / AC3(`#1562`)的云连接器一半在 OpenCode 2 上(`#1662` parity 第 5 项;v1 的
// packages/opencode/test/mcp/codepuppy-cloud-credential-hot.test.ts 随换代删除):Code Puppy 治理的云连接器每个请求现读凭据文件,
// 同一身份续期热应用后不重启引擎,下一个请求就带新凭据。
//
// 宿主:test-component/codepuppy-engine.ts(生产注入 + 真 ext);代付态 —— `CODEPUPPY_CLOUD_MCP_URL` 指向本文件的本机
// streamable-HTTP MCP 端点、登录铸的 `CODEPUPPY_MCP_TOKEN` 文件在场 ⇒ 注入面写出带 `{file:}` 引用的云 MCP 定义,并在 sidecar
// 环境里置 `CODEPUPPY_CLOUD_MCP_SERVER` / `CODEPUPPY_CLOUD_MCP_DEF`。凭据文件由生产 `syncSecretFiles`(fork 时)与
// `applyPlatformCredentialsHot`(续期时)写。端点记下每个请求的 Authorization 是哪个合成令牌(用例输出只有判定)。
//   ① 令牌 A 连上 ⇒ 端点收到的每个请求都带 A;
//   ② 热应用令牌 B(不重启)⇒ 重新连接时每个请求都带 B,一个 A 都没有;
//   ③ 删掉凭据文件 ⇒ 重新连接以认证错误失败,端点一个请求都没收到(请求不出网)。
// 已知的坏(实测,`#1662` parity r3):连接不经 `governedCredentialFetch`(packages/core/src/mcp/client.ts 的 codepuppy(#1562) 块)⇒
// `{file:}` 只在装配置时解析一次,② 里重新连接带的仍是 A。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { applyPlatformCredentialsHot, secretFilePath, syncSecretFiles } from "./codepuppy-secret-files"

const sandbox = engineSandbox()
const model = scriptedModel()
const TOKEN_A = `SENTINEL-CLOUD-MCP-A-${crypto.randomUUID()}`
const TOKEN_B = `SENTINEL-CLOUD-MCP-B-${crypto.randomUUID()}`
const API_KEY = `SENTINEL-CLOUD-API-${crypto.randomUUID()}`
type Seen = "A" | "B" | "other" | "none"
const seen: Seen[] = []

// 最小的 streamable-HTTP MCP 端点:initialize / notifications / tools/list,其余空结果;GET(独立 SSE 流)不提供。
const endpoint = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const authorization = request.headers.get("authorization")
    seen.push(authorization === `Bearer ${TOKEN_A}` ? "A" : authorization === `Bearer ${TOKEN_B}` ? "B" : authorization ? "other" : "none")
    if (request.method === "GET") return new Response(null, { status: 405 })
    if (request.method !== "POST") return new Response(null, { status: 200 })
    const message = (await request.json()) as { id?: number | string; method?: string; params?: { protocolVersion?: string } }
    if (message.id === undefined) return new Response(null, { status: 202 })
    const result =
      message.method === "initialize"
        ? { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-cloud", version: "1" } }
        : message.method === "tools/list"
          ? { tools: [] }
          : {}
    return Response.json({ jsonrpc: "2.0", id: message.id, result })
  },
})

const userData = path.join(sandbox.root, "cloud-hot-userdata")
let host: ReturnType<typeof codepuppyEngine>
let running: Running | undefined
let forked: Set<string>
beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  // fork 时:生产 syncSecretFiles 物化登录铸的云 MCP 令牌 A(和平台凭据),记下 fork 时的凭据集合(server.ts 同形)
  forked = new Set(syncSecretFiles(userData, { CODEPUPPY_MCP_TOKEN: TOKEN_A, CODEPUPPY_API_KEY: API_KEY }).written)
  process.env.CODEPUPPY_CLOUD_MCP_URL = `http://127.0.0.1:${endpoint.port}/mcp`
  host = codepuppyEngine({ sandbox, name: "cloud-hot", modelBaseURL: model.baseURL })
  running = await host.start()
}, 60_000)
afterAll(async () => {
  await running?.close().catch(() => undefined)
  endpoint.stop(true)
  model.stop()
  delete process.env.CODEPUPPY_CLOUD_MCP_URL
})

const status = async () =>
  (((await running!.send("GET", "/api/mcp")).json?.data ?? []) as Array<{ name: string; status: { status: string; error?: string } }>).find((server) => server.name === "codepuppy")?.status
async function settled() {
  for (let i = 0; i < 200; i++) {
    const current = await status()
    if (current && current.status !== "pending" && current.status !== "connecting") return current
    await Bun.sleep(50)
  }
  return status()
}
async function reconnect() {
  const before = seen.length
  await running!.send("POST", "/api/experimental/mcp/codepuppy/disconnect", {})
  await running!.send("POST", "/api/experimental/mcp/codepuppy/connect", {})
  return { requests: () => seen.slice(before), status: await settled() }
}

describe("REQ-236 #1562 云连接器:每个请求现读凭据,续期热应用不重启", () => {
  test("① 令牌 A 连上 ⇒ 每个请求都带 A", async () => {
    expect((await settled())?.status).toBe("connected")
    expect(seen.length).toBeGreaterThan(0)
    expect([...new Set(seen)]).toEqual(["A"])
  }, 30_000)

  test("② 热应用令牌 B(不重启)⇒ 重新连接时每个请求都带 B", async () => {
    expect(applyPlatformCredentialsHot(userData, { CODEPUPPY_MCP_TOKEN: TOKEN_B, CODEPUPPY_API_KEY: API_KEY }, forked)).toBe("applied")
    const { requests, status } = await reconnect()
    expect(status?.status).toBe("connected")
    expect(requests().length).toBeGreaterThan(0)
    expect([...new Set(requests())]).toEqual(["B"])
  }, 30_000)

  test("③ 凭据文件删掉 ⇒ 重新连接以认证错误失败,端点零请求", async () => {
    fs.rmSync(secretFilePath(userData, "CODEPUPPY_MCP_TOKEN"))
    const { requests, status } = await reconnect()
    expect(status?.status).toBe("failed")
    expect(status?.error).toContain("auth")
    expect(requests()).toEqual([])
  }, 30_000)
})
