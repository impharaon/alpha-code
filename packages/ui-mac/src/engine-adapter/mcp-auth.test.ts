// `#1668` H1(设计 docs/specs/1662-opencode2/design.md「MCP OAuth on OpenCode 2」§4,lane/1667-l5-main 7cba42b10d):
// v1 的「去授权」长调用。2.x 在 attempt `complete` 时先写凭证、MCP 随后异步重连 —— L5 实测 complete 后 253 ms 才从 pending
// 变成 connected。定制中心(use-extensions.ts authenticateMcp)在调用返回后立刻重读 `/mcp`,要 `connected === true` 才报成功;
// 所以适配器必须等这台 MCP 离开 pending 再返回。假引擎的重连比一个轮询间隔长,让「仍是 pending ⇒ 再读」这一支也走到。
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createEngineFetch } from "./index"

const ENGINE = "http://127.0.0.1:47007"
const RECONNECT_MS = 1_200

function engine(terminal: "complete" | "failed") {
  let statusPolls = 0
  let completedAt: number | undefined
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url)
    const path = url.pathname
    if (path === "/api/integration") return Response.json({ data: [{ id: "mcp_1", name: "docs", metadata: { source: "mcp" } }] })
    if (path === "/api/integration/mcp_1") return Response.json({ data: { methods: [{ type: "oauth", id: "oauth" }] } })
    if (path === "/api/integration/mcp_1/connect/oauth")
      return Response.json({ data: { attemptID: "att_1", url: "https://auth.example/authorize", mode: "auto", paste: true } })
    if (path === "/api/integration/mcp_1/connect/oauth/att_1") {
      statusPolls++
      if (statusPolls < 2) return Response.json({ data: { status: "pending" } })
      completedAt ??= Date.now()
      return Response.json({ data: { status: terminal } })
    }
    if (path === "/api/mcp") {
      const status =
        terminal === "failed"
          ? { status: "needs_auth", error: "Authorization required" }
          : completedAt !== undefined && Date.now() - completedAt >= RECONNECT_MS
            ? { status: "connected" }
            : { status: "pending" }
      return Response.json({ data: [{ name: "docs", status }] })
    }
    return new Response(`unexpected ${path}`, { status: 500 })
  }) as typeof globalThis.fetch
  return createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch })
}

const opened: string[] = []
beforeEach(() => {
  opened.length = 0
  ;(globalThis as { window?: unknown }).window = { api: { openLink: (url: string) => opened.push(url) } }
})
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe("#1668 H1 MCP OAuth 完成后等 MCP 离开 pending", () => {
  test(
    "complete ⇒ 回 connected;紧接着的 /mcp 也是 connected(定制中心判成功)",
    async () => {
      const engineFetch = engine("complete")
      const response = await engineFetch(`${ENGINE}/mcp/docs/auth/authenticate`, { method: "POST" })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: "connected" })
      expect(opened).toEqual(["https://auth.example/authorize"])
      expect(await (await engineFetch(`${ENGINE}/mcp`)).json()).toEqual({ docs: { status: "connected" } })
    },
    { timeout: 10_000 },
  )

  test(
    "failed ⇒ 直接回这台 MCP 的当前状态(needs_auth),不等",
    async () => {
      const engineFetch = engine("failed")
      const started = Date.now()
      const response = await engineFetch(`${ENGINE}/mcp/docs/auth/authenticate`, { method: "POST" })
      expect(await response.json()).toEqual({ status: "needs_auth", error: "Authorization required" })
      expect(Date.now() - started).toBeLessThan(2_800)
    },
    { timeout: 10_000 },
  )
})
