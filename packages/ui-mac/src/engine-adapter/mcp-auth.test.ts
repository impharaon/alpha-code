// `#1668` H1(设计 docs/specs/1662-opencode2/design.md「MCP OAuth on OpenCode 2」§4,lane/1667-l5-main 7cba42b10d):
// v1 的「去授权」长调用。2.x 在 attempt `complete` 时先写凭证、MCP 随后异步重连 —— L5 实测 complete 后 253 ms 才从 pending
// 变成 connected。定制中心(use-extensions.ts authenticateMcp)在调用返回后立刻重读 `/mcp`,要 `connected === true` 才报成功;
// 所以适配器必须等这台 MCP 离开 pending 再返回。假引擎的重连比一个轮询间隔长,让「仍是 pending ⇒ 再读」这一支也走到。
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createEngineFetch } from "./index"

const ENGINE = "http://127.0.0.1:47007"
const RECONNECT_MS = 1_200

function engine(terminal: "complete" | "failed" | "expired", disabled = false) {
  let statusPolls = 0
  let mcpReads = 0
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
      mcpReads++
      // failed:第一次读到时这台仍在 pending(还在按旧凭证重连),之后才落到 needs_auth —— 适配器若在失败后也等它离开 pending,
      // 就会多读几次、回 needs_auth;不等则只读这一次、原样回 pending。
      const status = disabled ? { status: "disabled" } :
        terminal !== "complete"
          ? mcpReads === 1
            ? { status: "pending" }
            : { status: "needs_auth", error: "Authorization required" }
          : completedAt !== undefined && Date.now() - completedAt >= RECONNECT_MS
            ? { status: "connected" }
            : { status: "pending" }
      return Response.json({ data: [{ name: "docs", status }] })
    }
    return new Response(`unexpected ${path}`, { status: 500 })
  }) as typeof globalThis.fetch
  return {
    engineFetch: createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch }),
    reads: () => ({ attemptStatus: statusPolls, mcp: mcpReads }),
  }
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
  test.each(["complete", "failed", "expired"] as const)("disabled OAuth %s distinguishes authorization from runtime activation", async (terminal) => {
    const fake = engine(terminal, true)
    const response = await fake.engineFetch(`${ENGINE}/mcp/docs/auth/authenticate`, { method: "POST" })
    expect(await response.json()).toMatchObject({ status: terminal === "complete" ? "disabled" : "failed" })
  }, 10_000)
  test(
    "complete ⇒ 回 connected;紧接着的 /mcp 也是 connected(定制中心判成功)",
    async () => {
      const { engineFetch } = engine("complete")
      const response = await engineFetch(`${ENGINE}/mcp/docs/auth/authenticate`, { method: "POST" })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: "connected" })
      expect(opened).toEqual(["https://auth.example/authorize"])
      expect(await (await engineFetch(`${ENGINE}/mcp`)).json()).toEqual({ docs: { status: "connected" } })
    },
    { timeout: 10_000 },
  )

  // `#1705`:按假引擎收到的请求判「不等」,不判墙钟:授权尝试状态读两次(进行中、失败)后只读一次 MCP 状态就回,
  // 读到的是 pending 也原样回 —— 进入「等 MCP 离开 pending」的轮询会多读、回 needs_auth。
  test(
    "failed ⇒ 直接回这台 MCP 的当前状态(读到 pending 也原样回),不等它离开 pending",
    async () => {
      const { engineFetch, reads } = engine("failed")
      const response = await engineFetch(`${ENGINE}/mcp/docs/auth/authenticate`, { method: "POST" })
      expect(await response.json()).toEqual({ status: "pending" })
      expect(reads()).toEqual({ attemptStatus: 2, mcp: 1 })
    },
    { timeout: 10_000 },
  )
})
