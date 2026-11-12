import { describe, expect, test } from "bun:test"
import { terminalWebSocketURL } from "./terminal-websocket-url"

describe("terminalWebSocketURL", () => {
  test("uses the current ticketed PTY route", () => {
    const url = terminalWebSocketURL({
      url: "http://127.0.0.1:49365",
      id: "pty_test",
      directory: "/tmp/project",
      cursor: 0,
      ticket: "connect-ticket",
    })

    expect(url.protocol).toBe("ws:")
    expect(url.username).toBe("")
    expect(url.password).toBe("")
    expect(url.pathname).toBe("/api/pty/pty_test/connect")
    expect(url.searchParams.get("location[directory]")).toBe("/tmp/project")
    expect(url.searchParams.get("cursor")).toBe("0")
    expect(url.searchParams.get("ticket")).toBe("connect-ticket")
    expect(url.searchParams.has("auth_token")).toBe(false)
  })

  // `#1668`:Code Puppy 的界面始终走 v1 数据路径,而终端 WebSocket 不经 fetch(引擎适配器接不到)—— 不论协议都连
  // OpenCode 2 的 `/api/pty/:id/connect`,凭 pty.connectToken 发的单次票据放行;renderer 不持有口令,URL 里从不带凭据。
  test("v1 protocol also opens the 2.x ticketed PTY route", () => {
    const url = terminalWebSocketURL({
      protocol: "v1",
      url: "https://app.example.test",
      id: "pty_test",
      directory: "/tmp/project",
      cursor: 10,
      ticket: "connect-ticket",
    })

    expect(url.protocol).toBe("wss:")
    expect(url.pathname).toBe("/api/pty/pty_test/connect")
    expect(url.searchParams.get("location[directory]")).toBe("/tmp/project")
    expect(url.searchParams.has("directory")).toBe(false)
    expect(url.searchParams.get("cursor")).toBe("10")
    expect(url.searchParams.get("ticket")).toBe("connect-ticket")
  })

  test("never puts credentials in the websocket URL, whatever the caller passes", () => {
    for (const input of [
      { sameOrigin: false },
      { sameOrigin: true },
      { sameOrigin: true, authToken: true },
    ]) {
      const url = terminalWebSocketURL({
        protocol: "v1",
        url: "http://127.0.0.1:49365",
        id: "pty_test",
        directory: "/tmp/project",
        cursor: 0,
        username: "opencode",
        password: "secret",
        ...input,
      })

      expect(url.username).toBe("")
      expect(url.password).toBe("")
      expect(url.pathname).toBe("/api/pty/pty_test/connect")
      expect(url.searchParams.has("auth_token")).toBe(false)
      expect(url.searchParams.has("ticket")).toBe(false)
    }
  })
})
