import { afterAll, expect, test, vi } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CODEPUPPY_ENDPOINTS } from "../shared/codepuppy-config"
import { initCodePuppyEnvironment } from "./codepuppy-environment"

// Frozen endpoint functions have no test-only transport option. Intercept the one IO boundary;
// every nonfixture host is refused, including compiled defaults. No real DNS/network is used.
const originalFetch = globalThis.fetch
const health = await Bun.file(new URL("./fixtures/relay-route/health-cloud.json", import.meta.url)).text()
const calls: string[] = []
let respond: (url: string, init?: RequestInit) => Promise<Response> = async () => new Response(health, { headers: { "content-type": "application/json" } })
globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
  const url = String(input)
  if (!new URL(url).hostname.endsWith(".test")) throw new Error("unexpected test destination")
  calls.push(url)
  return respond(url, init)
}) as typeof fetch
delete process.env.CODEPUPPY_BASE_URL
delete process.env.CODEPUPPY_CLOUD_MCP_URL
for (const key of ["WEB", "PLATFORM", "ACCOUNT", "CLOUD", "MCP"]) delete process.env[`CODEPUPPY_${key}_URL`]
const endpoints = await import("./codepuppy-endpoints")
const root = mkdtempSync(join(tmpdir(), "endpoint-route-"))
mkdirSync(join(root, "home"))
const environment = initCodePuppyEnvironment({ isPackaged: true, channel: "prod", appDataDir: join(root, "appData"), homeDir: join(root, "home") })
const data = join(root, "data")
mkdirSync(data)
const logs: string[] = []
const preferred = { platform: "https://gateway.test", cloud: "https://cloud.test", mcp: "https://cloud.test/mcp" }
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const configure = (pin: Record<string, string> = {}) => {
  writeFileSync(join(data, "codepuppy-endpoints.json"), JSON.stringify(pin))
  endpoints.initEndpoints(data, () => {}, (line) => logs.push(line))
}
afterAll(() => { configure(); vi.useRealTimers(); globalThis.fetch = originalFetch })

test("R1 no relay and explicit environment override stay inert", async () => {
  configure()
  expect(endpoints.relayConfigured()).toBe(false)
  expect(endpoints.resolveEndpoints()).toEqual(CODEPUPPY_ENDPOINTS)
  expect(endpoints.endpointRouteRef()).toBeUndefined()
  expect(calls).toEqual([])
  process.env.CODEPUPPY_PLATFORM_URL = "https://exported.test"
  configure(preferred)
  endpoints.noteRelayFailureSignal()
  await flush()
  expect(endpoints.relayConfigured()).toBe(false)
  expect(endpoints.resolveEndpoints().platform).toBe("https://exported.test")
  expect(calls).toEqual([])
  delete process.env.CODEPUPPY_PLATFORM_URL
})

test("R2 all three routed addresses switch together, leaving web/account and preferred intact", async () => {
  respond = async () => new Response("bad gateway", { status: 502 })
  configure(preferred)
  await flush()
  expect(endpoints.currentRoute()).toBe("direct")
  expect(endpoints.preferredEndpoints()).toMatchObject(preferred)
  expect(endpoints.resolveEndpoints()).toMatchObject({ platform: CODEPUPPY_ENDPOINTS.platform, cloud: CODEPUPPY_ENDPOINTS.cloud, mcp: `${CODEPUPPY_ENDPOINTS.cloud}/mcp`, web: CODEPUPPY_ENDPOINTS.web, account: CODEPUPPY_ENDPOINTS.account })
})

test("R3 both health entries require bounded, recognizable JSON; application 503 remains healthy", async () => {
  for (const entry of ["gateway", "cloud"]) for (const variant of ["ready", "unready", "html", "forbidden", "gateway-error", "missing", "json", "oversize", "tls"]) {
    respond = async (url) => {
      if (!url.includes(entry) || variant === "ready") return Response.json(JSON.parse(health))
      if (variant === "unready") return Response.json(JSON.parse(health), { status: 503 })
      if (variant === "tls") throw new TypeError("fixture TLS failure")
      return new Response(variant === "missing" ? "{}" : variant === "json" ? "{" : variant === "oversize" ? " ".repeat(65537) : "<html>challenge</html>", { status: variant === "forbidden" ? 403 : variant === "gateway-error" ? 502 : 200, headers: { "content-type": variant === "html" ? "text/html" : "application/json" } })
    }
    configure(preferred)
    await flush()
    expect([entry, variant, endpoints.currentRoute()]).toEqual([entry, variant, ["ready", "unready"].includes(variant) ? "preferred" : "direct"])
  }
})

test("R4 initial, periodic and coalesced immediate probes obey the deadline and recover", async () => {
  vi.useFakeTimers()
  calls.length = 0
  respond = async (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timed out")), { once: true }))
  configure(preferred)
  endpoints.noteRelayFailureSignal()
  endpoints.noteRelayFailureSignal()
  expect(calls).toHaveLength(2)
  vi.advanceTimersByTime(5000)
  await flush()
  expect(endpoints.currentRoute()).toBe("direct")
  respond = async () => Response.json(JSON.parse(health))
  vi.advanceTimersByTime(55_000)
  await flush()
  expect(endpoints.currentRoute()).toBe("preferred")
  expect(calls).toHaveLength(4)
  endpoints.noteRelayFailureSignal()
  await flush()
  expect(calls).toHaveLength(6)
  vi.useRealTimers()
})

test("R5 route file is canonical, private, atomic-word-only and reset on initialization", async () => {
  configure(preferred)
  await flush()
  const file = join(environment.casBaseRoot, "endpoint-route", "prod")
  expect(endpoints.endpointRouteRef()).toBe(`{file:${file}}`)
  expect(readFileSync(file, "utf8")).toBe("preferred")
  expect(statSync(file).mode & 0o777).toBe(0o600)
  respond = async () => new Response(null, { status: 504 })
  endpoints.noteRelayFailureSignal()
  await flush()
  expect(readFileSync(file, "utf8")).toBe("direct")
  configure(preferred)
  expect(readFileSync(file, "utf8")).toBe("preferred")
  await flush()
  expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false)
  expect(logs.some((line) => line.includes("preferred -> direct"))).toBe(true)
  expect(logs.every((line) => !line.includes("https:"))).toBe(true)
})

test("R6 a late old probe cannot overwrite the route for newly discovered preferred endpoints", async () => {
  configure()
  const release = Promise.withResolvers<Response>()
  respond = async () => release.promise.then((response) => response.clone())
  endpoints.setDiscoveredEndpoints({ schema_version: 1, ...CODEPUPPY_ENDPOINTS, ...preferred })
  respond = async () => Response.json(JSON.parse(health))
  endpoints.setDiscoveredEndpoints({ schema_version: 1, ...CODEPUPPY_ENDPOINTS, platform: "https://new-gateway.test", cloud: "https://new-cloud.test" })
  release.resolve(new Response(null, { status: 502 }))
  await flush()
  expect(endpoints.currentRoute()).toBe("preferred")
  expect(endpoints.preferredEndpoints().platform).toBe("https://new-gateway.test")
  expect(calls.some((url) => url === "https://new-cloud.test/health")).toBe(true)
})
