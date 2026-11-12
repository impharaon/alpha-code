// `#1668` seams I8:renderer 怎么连引擎 —— 只拿引擎源地址,不带任何认证头(`Authorization` 由 main 的
// onBeforeSendHeaders 对引擎源补上,L5)。这里钉 renderer 一侧:壳交给冻结 app 的连接只有 `{ url }`、WSL 连接
// 不带口令,冻结 app 与 Code Puppy 自己的客户端经适配器发出的请求里都没有 authorization 头。
import { describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createApiForServer, createSdkForServer } from "../../../codepuppy-app/src/utils/server"
import { createEngineFetch } from "../engine-adapter"
import { readyWslConnections } from "./wsl/connections"

const ENGINE = "http://127.0.0.1:47004"

function recording() {
  const headers: Array<{ path: string; authorization: string | null }> = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    headers.push({ path: new URL(request.url).pathname, authorization: request.headers.get("authorization") })
    if (new URL(request.url).pathname === "/api/info") return Response.json({ version: "local", pid: 1 })
    return Response.json({ data: [], cursor: {} })
  }) as typeof globalThis.fetch
  return { headers, engineFetch: createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch }) }
}

async function exercise(server: { url: string; password?: string }) {
  const { headers, engineFetch } = recording()
  const fetch = engineFetch as typeof globalThis.fetch
  // 冻结 app(server-sdk.tsx 的建法:v1 SDK + 1.17.13 客户端,都经 Platform.fetch)
  await createSdkForServer({ server, fetch, throwOnError: false }).session.list()
  await createApiForServer({ server, fetch }).session.list({})
  // Code Puppy 自己的客户端(侧栏 / 定制中心 / 云运行的建法)与探活
  await createOpencodeClient({ baseUrl: server.url, fetch }).global.health()
  await engineFetch(new URL("/global/health", server.url))
  return headers
}

describe("#1668 I8 renderer 连引擎不带口令", () => {
  test("只有 { url } 的连接 ⇒ 经适配器到引擎的每个请求都没有 authorization 头", async () => {
    const headers = await exercise({ url: ENGINE })
    expect(headers.length).toBeGreaterThanOrEqual(4)
    expect(headers.filter((item) => item.authorization !== null)).toEqual([])
  })

  test("反向臂:连接里带了口令(I8 之前壳的写法)⇒ 请求带上 Basic 头 —— 上面那条测得出这种回退", async () => {
    const headers = await exercise({ url: ENGINE, password: "secret" })
    expect(headers.some((item) => item.authorization?.startsWith("Basic "))).toBe(true)
  })

  test("WSL 连接:main 给了口令也不进 renderer 的连接对象", () => {
    const [connection] = readyWslConnections({
      servers: [
        { config: { id: "wsl:Ubuntu", distro: "Ubuntu" }, runtime: { kind: "ready", url: "http://127.0.0.1:47005", username: "opencode", password: "secret" } },
      ],
    } as never)
    expect(connection!.http).toEqual({ url: "http://127.0.0.1:47005" })
  })
})
