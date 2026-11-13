// `#1697`(I-04 M5b):采样直通路由 `/api/integration/*` 用的本机假 OAuth —— 一个要 OAuth 的远端 MCP 服务器加它自己的授权服务器,
// 只答 MCP SDK 的标准流程会问的几条(401 + 资源元数据、授权服务器元数据、动态注册、换 token),不连外网。用法见 README.md。
//
//   POST /mcp                                     ⇒ 401,WWW-Authenticate 指向资源元数据(引擎据此找授权服务器)
//   GET  /.well-known/oauth-protected-resource*   ⇒ { resource, authorization_servers: [本服务] }
//   GET  /.well-known/oauth-authorization-server* ⇒ 授权 / 换 token / 注册三个端点,PKCE S256,公开客户端
//   POST /register                                ⇒ 201,client_id 固定为 sampler-client
//   POST /token                                   ⇒ 固定的 access / refresh token
// 授权端点本身不答:采样器从引擎交回的授权地址里取 state 与 redirect_uri,自己拼回调地址交给 complete。

export function startMockOAuth(port: number) {
  const origin = `http://127.0.0.1:${port}`
  const metadata = {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  }
  const requests: string[] = []
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url)
      requests.push(`${request.method} ${url.pathname}`)
      if (url.pathname === "/mcp")
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: {
            "content-type": "application/json",
            "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
          },
        })
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
        return Response.json({ resource: `${origin}/mcp`, authorization_servers: [origin] })
      if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) return Response.json(metadata)
      if (url.pathname === "/register" && request.method === "POST") {
        const body = (await request.json()) as Record<string, unknown>
        return Response.json({ ...body, client_id: "sampler-client", token_endpoint_auth_method: "none" }, { status: 201 })
      }
      if (url.pathname === "/token" && request.method === "POST")
        return Response.json({ access_token: "sampler-access", token_type: "Bearer", expires_in: 3600, refresh_token: "sampler-refresh" })
      return new Response("not found", { status: 404 })
    },
  })
  return { origin, requests, stop: () => server.stop(true) }
}
