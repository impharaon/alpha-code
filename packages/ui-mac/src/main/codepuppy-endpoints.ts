// Single endpoint RESOLVER (main process). Replaces "hardcoded constant baked into every bundle" with
// a layered resolution so a moved gateway/account URL needs NO code change or repackage:
//
//   env override  >  userData pin file  >  login discovery (①)  >  hardcoded default (bootstrap)
//   CODEPUPPY_*_URL      <userData>/           token response          shared/codepuppy-config.ts
//                    codepuppy-endpoints.json   { endpoints: {...} }
//
// Why this exists (the bug it prevents): `platform` was once hardcoded to a wrong host and shipped
// baked-in (pre-REQ-070 history: api.tidelabs.click 404 → workers.dev → now the real custom domain
// alpha-gateway.tidelabs.click). The volatile URLs
// (gateway/account) now come from discovery/pin so the platform can move clients without a release.
// The renderer no longer imports the constant directly — it reads the resolved set over IPC
// (endpoints-ipc.ts → window.api.endpoints). Pure node (fs only); no electron import.

import fs from "node:fs"
import path from "node:path"
import { ContractIncompatibleError } from "@codepuppy/contracts-consumer"
import { CODEPUPPY_ENDPOINTS, CODEPUPPY_PATHS, type CodePuppyEndpoints } from "../shared/codepuppy-config"
import { USER_DATA_LAYOUT } from "./user-data-layout"
import { resolveCodePuppyStateBase } from "./codepuppy-environment"

// Capture before applyAuthEnv can fill these. App-filled values are never user exports.
let inherited: { model: boolean; cloud: boolean } | undefined
export function inheritedEngineEndpointEnv() {
  return inherited ??= { model: process.env.CODEPUPPY_BASE_URL !== undefined, cloud: process.env.CODEPUPPY_CLOUD_MCP_URL !== undefined }
}
export type EndpointRoute = "preferred" | "direct"
let route: EndpointRoute = "preferred"
let revision = 0
let interval: ReturnType<typeof setInterval> | undefined
let probe: Promise<void> | undefined
let routeLog: (line: string) => void = () => {}

const ENV_KEYS: Record<keyof CodePuppyEndpoints, string> = {
  web: "CODEPUPPY_WEB_URL",
  platform: "CODEPUPPY_PLATFORM_URL",
  account: "CODEPUPPY_ACCOUNT_URL",
  cloud: "CODEPUPPY_CLOUD_URL",
  mcp: "CODEPUPPY_MCP_URL",
}
const KEYS = ["web", "platform", "account", "cloud", "mcp"] as const

let userDataPath = ""
let override: Partial<CodePuppyEndpoints> = {} // <userData>/codepuppy-endpoints.json — manual pin, read at init
let discovered: Partial<CodePuppyEndpoints> = {} // from the login token response (①), persisted across restarts

const strip = (u?: string | null): string | undefined => {
  const v = u?.replace(/\/+$/, "")
  if (!v) return undefined
  // A pin/discovery/env value resolves into CODEPUPPY_BASE_URL — the bearer-carrying proxy target — so a
  // tampered plain-http or attacker host would exfil the JWT. Accept https only (loopback http for dev);
  // anything else falls through to the next precedence tier / hardcoded default (C26).
  try {
    const p = new URL(v)
    const loopback = p.hostname === "localhost" || p.hostname === "127.0.0.1" || p.hostname === "[::1]"
    if (p.protocol === "https:" || (p.protocol === "http:" && loopback)) return v
  } catch {
    /* not a valid URL — reject */
  }
  return undefined
}
const overrideFile = () => path.join(userDataPath, USER_DATA_LAYOUT.endpoints)
const discoveredFile = () => path.join(userDataPath, USER_DATA_LAYOUT.discoveredEndpoints)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

function readPartial(file: string): Partial<CodePuppyEndpoints> {
  try {
    const d: unknown = JSON.parse(fs.readFileSync(file, "utf8"))
    if (!isRecord(d)) return {}
    const out: Partial<CodePuppyEndpoints> = {}
    for (const k of KEYS) {
      const s = strip(typeof d[k] === "string" ? d[k] : undefined)
      if (s) out[k] = s
    }
    return out
  } catch {
    return {}
  }
}

function readDiscovery(file: string, reportContractFailure: (error: unknown) => void): Partial<CodePuppyEndpoints> {
  if (!fs.existsSync(file)) return {}
  try {
    return decodeEndpointDiscovery(JSON.parse(fs.readFileSync(file, "utf8")))
  } catch (error) {
    const failure =
      error instanceof ContractIncompatibleError
        ? error
        : new ContractIncompatibleError({
            surface: "endpoint-discovery",
            received_version: "unknown",
            reason: "schema-validation",
          })
    try {
      fs.rmSync(file, { force: true })
    } catch {
      /* invalid persisted discovery remains untrusted even when cleanup is unavailable */
    }
    reportContractFailure(failure)
    return {}
  }
}

/** Called once at startup (index.ts), AFTER preferAppEnv and BEFORE initAuthEnv — so applyAuthEnv
 *  resolves the proxy URL with the pin + persisted discovery already loaded. */
export function initEndpoints(dataPath: string, reportContractFailure: (error: unknown) => void, log: (line: string) => void = () => {}) {
  userDataPath = dataPath
  override = readPartial(overrideFile())
  discovered = readDiscovery(discoveredFile(), reportContractFailure)
  routeLog = log
  route = "preferred"
  configureRoute()
}

/** ① The alpha-web /auth/token response carries
 *  `{ endpoints: { platform, account, cloud, mcp, web } }`. Persist accepted values so the next
 *  sidecar fork resolves the right services without a desktop release. A present payload is
 *  accepted atomically; an invalid version or endpoint throws without changing discovery state. */
export function setDiscoveredEndpoints(payload: unknown) {
  discovered = decodeEndpointDiscovery(payload)
  try {
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.writeFileSync(discoveredFile(), JSON.stringify({ schema_version: 1, ...discovered }), { encoding: "utf8", mode: 0o600 })
  } catch {
    /* persistence is best-effort; the validated in-memory discovery remains authoritative */
  }
  configureRoute()
}

export function decodeEndpointDiscovery(payload: unknown): CodePuppyEndpoints {
  const value = isRecord(payload) ? payload : null
  const keys = value ? Object.keys(value) : []
  const allowed = new Set(["schema_version", ...KEYS])
  const web = strip(typeof value?.web === "string" ? value.web : undefined)
  const platform = strip(typeof value?.platform === "string" ? value.platform : undefined)
  const account = strip(typeof value?.account === "string" ? value.account : undefined)
  const cloud = strip(typeof value?.cloud === "string" ? value.cloud : undefined)
  const mcp = strip(typeof value?.mcp === "string" ? value.mcp : undefined)
  if (
    !value ||
    value.schema_version !== 1 ||
    keys.some((key) => !allowed.has(key)) ||
    !web ||
    !platform ||
    !account ||
    !cloud ||
    (value.mcp !== undefined && !mcp)
  ) {
    throw new ContractIncompatibleError({
      surface: "endpoint-discovery",
      received_version:
        value && "schema_version" in value
          ? typeof value.schema_version === "number"
            ? value.schema_version
            : "unknown"
          : "missing",
      reason: "schema-validation",
    })
  }
  return { web, platform, account, cloud, ...(mcp ? { mcp } : {}) }
}

/** Resolve all endpoints. Precedence (highest first): env override (dev/staging) > userData pin >
 *  login discovery > hardcoded default. `mcp` is omitted unless someone provides it; callers derive
 *  `${cloud}/mcp`. */
export function resolveEndpoints(): CodePuppyEndpoints {
  const endpoints = preferredEndpoints()
  if (currentRoute() !== "direct") return endpoints
  return { ...endpoints, platform: CODEPUPPY_ENDPOINTS.platform, cloud: CODEPUPPY_ENDPOINTS.cloud, mcp: `${CODEPUPPY_ENDPOINTS.cloud}${CODEPUPPY_PATHS.mcpGateway}` }
}

export function preferredEndpoints(): CodePuppyEndpoints {
  const pick = (k: keyof CodePuppyEndpoints): string | undefined =>
    strip(process.env[ENV_KEYS[k]]) ?? override[k] ?? discovered[k]
  const mcp = pick("mcp")
  return {
    web: pick("web") ?? CODEPUPPY_ENDPOINTS.web,
    platform: pick("platform") ?? CODEPUPPY_ENDPOINTS.platform,
    account: pick("account") ?? CODEPUPPY_ENDPOINTS.account,
    cloud: pick("cloud") ?? CODEPUPPY_ENDPOINTS.cloud,
    ...(mcp ? { mcp } : {}),
  }
}

export function relayConfigured(): boolean {
  const exported = inheritedEngineEndpointEnv()
  if (exported.model || exported.cloud || Object.values(ENV_KEYS).some((key) => strip(process.env[key]))) return false
  const endpoints = preferredEndpoints()
  return endpoints.platform !== CODEPUPPY_ENDPOINTS.platform || endpoints.cloud !== CODEPUPPY_ENDPOINTS.cloud
}

export function currentRoute(): EndpointRoute {
  return relayConfigured() ? route : "preferred"
}

/** Same path is published to the engine; no consumer derives it a second time. */
export function endpointRouteRef(): `{file:${string}}` | undefined {
  if (!relayConfigured()) return undefined
  const state = resolveCodePuppyStateBase("endpoint route")
  return state.ok ? `{file:${path.join(state.casBaseRoot, "endpoint-route", state.environment)}}` : undefined
}

export function noteRelayFailureSignal(): void {
  void probeRelay("egress-failure")
}

function configureRoute() {
  revision++
  clearInterval(interval)
  interval = undefined
  if (!relayConfigured()) return
  publishRoute(route, "configured")
  interval = setInterval(() => void probeRelay("periodic"), 60_000)
  interval.unref()
  void probeRelay("configured")
}

function probeRelay(reason: string): Promise<void> | undefined {
  if (!relayConfigured()) return
  if (probe) return probe
  const version = revision
  const endpoints = preferredEndpoints()
  probe = Promise.all([entryHealthy(endpoints.platform), entryHealthy(endpoints.cloud)]).then((healthy) => {
    if (version === revision && relayConfigured()) publishRoute(healthy.every(Boolean) ? "preferred" : "direct", reason)
  }).finally(() => {
    probe = undefined
    if (version !== revision) void probeRelay("endpoints-changed")
  })
  return probe
}

async function entryHealthy(base: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let response: Response | undefined
  try {
    response = await fetch(`${base}/health`, { signal: controller.signal, redirect: "error" })
    if (![200, 503].includes(response.status) || !/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) return false
    reader = response.body?.getReader()
    if (!reader) return false
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 65_536) return false
      chunks.push(chunk.value)
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    return isRecord(body) && isRecord(body.readiness) && typeof body.readiness.state === "string"
  } catch {
    return false
  } finally {
    clearTimeout(timer)
    if (reader) void reader.cancel().catch(() => {})
    else if (response?.body) void response.body.cancel().catch(() => {})
  }
}

function publishRoute(next: EndpointRoute, reason: string) {
  const previous = route
  const ref = endpointRouteRef()
  if (ref && (next !== route || reason === "configured" || !fs.existsSync(ref.slice(6, -1)))) {
    const file = ref.slice(6, -1)
    const temporary = `${file}.${process.pid}.tmp`
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
      fs.writeFileSync(temporary, next, { mode: 0o600 })
      fs.chmodSync(temporary, 0o600)
      fs.renameSync(temporary, file)
    } catch {
      routeLog("endpoint route publication failed")
    }
  }
  route = next
  if (previous !== next) routeLog(`endpoint route ${previous} -> ${next} (${reason})`)
}
