export function terminalWebSocketURL(input: {
  protocol?: "v1" | "v2"
  url: string
  id: string
  directory: string
  cursor: number
  ticket?: string
  sameOrigin?: boolean
  username?: string
  password?: string
  authToken?: boolean
}) {
  // `#1668`:Code Puppy 的界面始终走 v1 数据路径,但终端 WebSocket 不经 fetch、适配器接不到 —— 不论协议都直接连
  // OpenCode 2 的 `/api/pty/:id/connect`,目录走 `location[directory]`,凭 pty.connectToken 发的单次票据放行
  // (renderer 不持有口令,不再拼 auth_token)。
  const next = new URL(`${input.url}/api/pty/${input.id}/connect`)
  next.searchParams.set("location[directory]", input.directory)
  next.searchParams.set("cursor", String(input.cursor))
  next.protocol = next.protocol === "https:" ? "wss:" : "ws:"
  if (input.ticket) next.searchParams.set("ticket", input.ticket)
  return next
}
