/** Main-issued capabilities cross only the controlled, in-memory sidecar channel. */
export type McpProxyBinding = {
  packageId: string
  entryId: string
  generation: string
  definitionDigest: `sha256:${string}`
  serverUrl: string
  proxyUrl: string
  proxyAuthorization: string
}
export type PluginMcpProxies = Record<string, readonly McpProxyBinding[]>
const KEY = Symbol.for("codepuppy.plugin-mcp-proxies")
const slot = globalThis as Record<symbol, unknown>

export function publishPluginMcpProxies(value: unknown): void {
  if (!record(value) || !Object.values(value).every(bindings => Array.isArray(bindings) && bindings.every(binding =>
    record(binding) && Object.keys(binding).length === 7 && ["packageId", "entryId", "generation", "definitionDigest", "serverUrl", "proxyUrl", "proxyAuthorization"].every(key => typeof binding[key] === "string") &&
    /^sha256:[a-f0-9]{64}$/.test(String(binding.definitionDigest)) && /^Bearer [a-f0-9]{64}$/.test(String(binding.proxyAuthorization)) && URL.canParse(String(binding.serverUrl)) && URL.canParse(String(binding.proxyUrl))))) throw Error("Invalid plugin MCP proxy bindings")
  slot[KEY] = Object.freeze(Object.fromEntries(Object.entries(value).map(([name, bindings]) => [name, Object.freeze((bindings as McpProxyBinding[]).map(binding => Object.freeze({ ...binding })))])))
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) }
function current(name: string) {
  const bindings = slot[KEY] as PluginMcpProxies | undefined
  return bindings && Object.hasOwn(bindings, name) ? bindings[name]! : []
}
export function pluginMcpLoopback(url: URL): boolean { return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password }
export function pluginMcpEndpoint(binding: McpProxyBinding, url: URL): boolean {
  const endpoint = new URL(binding.serverUrl)
  return endpoint.origin === url.origin && endpoint.pathname === url.pathname
}

/** A single connection captures a generation. Revocation cannot hand an old transport its successor's bearer. */
export function pluginMcpFetch(name: string, serverUrl: string, base: typeof globalThis.fetch): typeof globalThis.fetch {
  const binding = current(name).find(binding => binding.serverUrl === serverUrl)
  if (!binding) return base
  const send: typeof globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    if (!current(name).some(value => value.proxyAuthorization === binding.proxyAuthorization)) throw new DOMException("Plugin MCP binding was revoked", "AbortError")
    const url = new URL(input instanceof Request ? input.url : input)
    if (!pluginMcpEndpoint(binding, url)) return base(input, init)
    const response = await base(input, { ...init, redirect: "manual", proxy: { url: binding.proxyUrl, headers: { "Proxy-Authorization": binding.proxyAuthorization }, respectNoProxy: false } } as RequestInit)
    if (init?.redirect === "manual" || response.status < 300 || response.status > 399 || !response.headers.has("location")) return response
    if (init?.redirect === "error") throw TypeError("MCP request redirected")
    const next = new URL(response.headers.get("location")!, url)
    // The ordinary destination authority owns redirects; the private proxy bearer never follows them.
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (next.origin !== url.origin) { headers.delete("Authorization"); headers.delete("Cookie") }
    const method = init?.method ?? (input instanceof Request ? input.method : "GET")
    const get = response.status === 303 && method !== "HEAD" || [301, 302].includes(response.status) && method === "POST"
    await response.body?.cancel()
    return base(next, { ...init, headers, ...(get ? { method: "GET", body: undefined } : {}) })
  }, base)
  return send
}
