import { createHash, randomUUID } from "node:crypto"
import { posix } from "node:path"
import { gunzipSync } from "node:zlib"
import { readMarketplace } from "../shared/host-extension-package-contract/plugin-conversion.mjs"
import type { Capture, Json, MarketplaceEntry, TreeNode } from "../shared/host-extension-package-contract/plugin-conversion"

export type PluginSourceIdV1 = "catalog" | "claude-marketplace" | "codex-marketplace" | "opencode-npm" | "mcp-registry"
export type SourceStatusV1 =
  | { source: PluginSourceIdV1; status: "ok"; matched: number; skipped: number }
  | { source: PluginSourceIdV1; status: "failed"; reason: "network" | "http" | "format"; detail: string }
export type CandidateV1 = {
  id: string; source: PluginSourceIdV1; name: string; displayName: string; description: string; kind: "plugin" | "mcp"
  sameAs?: string
  installed?: { packageId: string; enabled: boolean }
  publisher?: { kind: "github"; account: string } | { kind: "domain"; domain: string }
  upstream: { repository?: string; commit?: string; path?: string; serverName?: string; version?: string; npm?: string }
}
export type SourceSearchResultV1 = { searchId: string; query: string; sources: SourceStatusV1[]; candidates: CandidateV1[] }
export const PLUGIN_SOURCE_ORDER: readonly PluginSourceIdV1[] = ["catalog", "claude-marketplace", "codex-marketplace", "opencode-npm", "mcp-registry"]
const MARKETPLACES = [
  { source: "claude-marketplace", ecosystem: "claude", repository: "https://github.com/anthropics/claude-plugins-official", manifest: ".claude-plugin/marketplace.json" },
  { source: "codex-marketplace", ecosystem: "codex", repository: "https://github.com/openai/plugins", manifest: ".agents/plugins/marketplace.json" },
] as const
const MCP_REGISTRY = "https://registry.modelcontextprotocol.io/v0.1/servers"
type Archive = { commit: string; members: Map<string, { node: TreeNode; bytes?: Uint8Array }> }
type SourceCandidate = { candidate: CandidateV1 } & (
  | { kind: "marketplace"; entry: MarketplaceEntry; market: typeof MARKETPLACES[number] }
  | { kind: "mcp-registry"; serverName: string; version: string }
)

/** One instance per main-process run; only this owner mints candidate IDs and retains fetched bytes. */
export function createPluginSources(deps: { catalog: () => Promise<readonly CandidateV1[]>; fetch?: (url: string) => Promise<Response> }) {
  const candidates = new Map<string, SourceCandidate>()
  const captures = new Map<string, Promise<Capture>>()
  const archives = new Map<string, Promise<Archive>>()
  const indexes = new Map<string, Promise<ReturnType<typeof readMarketplace>>>()
  const registryQueries = new Map<string, Promise<ReturnType<typeof registryRecord>[]>>()
  const get = async (url: string) => {
    const response = await (deps.fetch ?? fetch)(url).catch(() => { throw new SourceError("network", "Source request failed") })
    if (!response.ok) throw new SourceError("http", "Source returned HTTP " + response.status)
    return new Uint8Array(await response.arrayBuffer().catch(() => { throw new SourceError("network", "Source download failed") }))
  }
  const loadIndex = (market: typeof MARKETPLACES[number]) => {
    const known = indexes.get(market.source)
    if (known) return known
    const pending = get(market.repository.replace("https://github.com/", "https://raw.githubusercontent.com/") + "/main/" + market.manifest).then((bytes) => {
      try { return readMarketplace(bytes, market.ecosystem) } catch { throw new SourceError("format", "Marketplace is not readable") }
    }).catch((error: unknown) => { indexes.delete(market.source); throw error })
    indexes.set(market.source, pending)
    return pending
  }
  const loadArchive = (repository: string, revision: string) => {
    const key = repository + "@" + revision
    const known = archives.get(key)
    if (known) return known
    const pending = get("https://codeload.github.com/" + repository.slice("https://github.com/".length) + "/tar.gz/" + revision.split("/").map(encodeURIComponent).join("/"))
      .then((bytes) => readCodeload(bytes))
      .catch((error: unknown) => { archives.delete(key); throw error })
    archives.set(key, pending)
    return pending
  }
  const loadRegistry = (query: string) => {
    const known = registryQueries.get(query)
    if (known) return known
    const pending = (async () => {
      const records: ReturnType<typeof registryRecord>[] = []
      const cursors = new Set<string>()
      let cursor = ""
      do {
        const page = registryDocument(await get(MCP_REGISTRY + "?search=" + encodeURIComponent(query) + "&version=latest" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "")))
        if (!Array.isArray(page.servers)) throw new SourceError("format", "Registry search has no server records")
        records.push(...page.servers.map(registryRecord))
        const next = isRecord(page.metadata) ? page.metadata.nextCursor : undefined
        if (next !== undefined && typeof next !== "string") throw new SourceError("format", "Registry cursor is invalid")
        cursor = typeof next === "string" ? next : ""
        if (cursor && cursors.has(cursor)) throw new SourceError("format", "Registry cursor repeats")
        if (cursor) cursors.add(cursor)
      } while (cursor)
      return [...new Map(records.map((record) => [record.server.name + "@" + record.server.version, record])).values()]
    })().catch((error: unknown) => { registryQueries.delete(query); throw error })
    registryQueries.set(query, pending)
    return pending
  }
  return {
    async searchSources(query: string): Promise<SourceSearchResultV1> {
      const [catalog, results, registry] = await Promise.all([
        Promise.allSettled([deps.catalog()]).then((results) => results[0]!),
        Promise.allSettled(MARKETPLACES.map(loadIndex)),
        Promise.allSettled([loadRegistry(query)]).then((results) => results[0]!),
      ])
      const local = catalog.status === "fulfilled" ? rank(catalog.value, query) : []
      const source: SourceStatusV1 = catalog.status === "fulfilled"
        ? { source: "catalog", status: "ok", matched: local.length, skipped: 0 }
        : { source: "catalog", status: "failed", reason: "format", detail: "Customization catalog is unavailable" }
      const markets = MARKETPLACES.map((market, index): { status: SourceStatusV1; candidates: CandidateV1[] } => {
        const result = results[index]!
        if (result.status === "rejected") {
          const failure = result.reason instanceof SourceError ? result.reason : new SourceError("network", "Marketplace is unavailable")
          return { status: { source: market.source, status: "failed", reason: failure.reason, detail: failure.message }, candidates: [] }
        }
        const matches = result.value.entries.filter((entry) => relevance(entry.name, entry.name, entry.description, query) > 0)
        const available = matches.flatMap((entry): CandidateV1[] => {
          if (entry.source.kind === "unsupported" || (entry.source.kind === "git" && !githubRepository(entry.source.url))) return []
          const identity = market.source + JSON.stringify(entry)
          const known = candidates.get(identity)
          if (known) return [known.candidate]
          const repository = entry.source.kind === "git" ? githubRepository(entry.source.url)! : market.repository
          const candidate: CandidateV1 = {
            id: "cand_" + randomUUID(), source: market.source, name: entry.name, displayName: entry.name, description: entry.description, kind: "plugin",
            upstream: { repository, ...(entry.source.kind === "path" ? { path: entry.source.path } : { ...(entry.source.path === undefined ? {} : { path: entry.source.path }), ...(entry.source.commit ? { commit: entry.source.commit } : {}) }) },
          }
          candidates.set(identity, { kind: "marketplace", entry, candidate, market })
          return [candidate]
        })
        return { status: { source: market.source, status: "ok", matched: available.length, skipped: matches.length - available.length }, candidates: rank(available, query) }
      })
      const found = registry.status === "fulfilled" ? registry.value.map((record) => {
        const identity = "mcp-registry:" + record.server.name + "@" + record.server.version
        const known = candidates.get(identity)
        if (known) return known.candidate
        const candidate: CandidateV1 = { id: "cand_" + randomUUID(), source: "mcp-registry", name: record.server.name, displayName: typeof record.server.title === "string" ? record.server.title : record.server.name,
          description: typeof record.server.description === "string" ? record.server.description : "", kind: "mcp", publisher: record.publisher,
          upstream: { serverName: record.server.name, version: record.server.version } }
        candidates.set(identity, { kind: "mcp-registry", candidate, serverName: record.server.name, version: record.server.version })
        return candidate
      }) : []
      const failure = registry.status === "rejected" ? registry.reason instanceof SourceError ? registry.reason : new SourceError("network", "Registry is unavailable") : undefined
      const registryStatus: SourceStatusV1 = failure ? { source: "mcp-registry", status: "failed", reason: failure.reason, detail: failure.message } : { source: "mcp-registry", status: "ok", matched: found.length, skipped: 0 }
      const groups = [{ status: source, candidates: local }, ...markets, { status: registryStatus, candidates: found }]
        .toSorted((left, right) => PLUGIN_SOURCE_ORDER.indexOf(left.status.source) - PLUGIN_SOURCE_ORDER.indexOf(right.status.source))
      return { searchId: "search_" + randomUUID(), query, sources: groups.map((group) => group.status), candidates: groups.flatMap((group) => group.candidates) }
    },
    async captureCandidate(candidateId: string): Promise<{ ok: true; capture: Capture } | { ok: false; code: "unknown-id" | "source-unreachable" | "source-changed"; detail: string }> {
      const selected = [...candidates.values()].find((entry) => entry.candidate.id === candidateId)
      if (!selected) return { ok: false, code: "unknown-id", detail: "Candidate is unknown in this application run" }
      try {
        const known = captures.get(candidateId)
        const pending = known ?? (async () => {
          if (selected.kind === "mcp-registry") {
            const locator = MCP_REGISTRY + "/" + encodeURIComponent(selected.serverName) + "/versions/" + encodeURIComponent(selected.version)
            const record = registryRecord(registryDocument(await get(locator)))
            if (record.server.name !== selected.serverName || record.server.version !== selected.version) throw new SourceChanged()
            const bytes = new TextEncoder().encode(JSON.stringify(record.server))
            const capture: Capture = {
              source: { kind: "mcp-registry", locator, serverName: selected.serverName, version: selected.version },
              nodes: [{ kind: "file", path: "server.json", mode: 0o644, bytes: bytes.length, digest: ("sha256:" + createHash("sha256").update(bytes).digest("hex")) as `sha256:${string}` }],
              readFile: async (path) => { if (path !== "server.json") throw new Error("Captured file is missing"); return bytes },
            }
            return capture
          }
          const source = selected.entry.source
          if (source.kind === "unsupported") throw new SourceError("format", "Source cannot be captured")
          const repository = source.kind === "path" ? selected.market.repository : githubRepository(source.url)!
          const archive = await loadArchive(repository, source.kind === "path" ? "refs/heads/main" : source.commit ?? source.ref ?? "refs/heads/main")
          if (source.kind === "git" && source.commit && archive.commit !== source.commit) throw new SourceChanged()
          if (source.kind === "path") {
            const manifest = archive.members.get(selected.market.manifest)?.bytes
            if (!manifest) throw new SourceChanged()
            const entry = readMarketplace(manifest, selected.market.ecosystem).entries.find((entry) => entry.name === selected.entry.name)
            if (JSON.stringify(entry) !== JSON.stringify(selected.entry)) throw new SourceChanged()
          }
          const path = source.kind === "path" ? source.path : source.path ?? ""
          const prefix = path ? path + "/" : ""
          const members = [...archive.members].filter(([name]) => name.startsWith(prefix) && name !== path)
          if (!members.length) throw new SourceChanged()
          const relative = new Map(members.map(([name, member]) => [name.slice(prefix.length), member]))
          const capture: Capture = {
            source: { kind: "marketplace", locator: repository, repository, commit: archive.commit, pluginPath: path, ecosystem: selected.market.ecosystem, entryName: selected.entry.name },
            nodes: [...relative].map(([name, member]) => ({ ...member.node, path: name })),
            readFile: async (name) => {
              const visited = new Set<string>()
              const read = (name: string): Uint8Array => {
                if (visited.has(name)) throw new Error("Captured link cycle")
                visited.add(name)
                const member = relative.get(name)
                if (member?.bytes) return member.bytes
                if (member?.node.kind === "symlink") return read(posix.normalize(posix.join(posix.dirname(name), member.node.target)))
                throw new Error("Captured file is missing")
              }
              return read(name)
            },
          }
          selected.candidate.upstream.commit = archive.commit
          return capture
        })()
        captures.set(candidateId, pending)
        return { ok: true, capture: await pending }
      } catch (error) {
        captures.delete(candidateId)
        return { ok: false, code: error instanceof SourceChanged ? "source-changed" : "source-unreachable", detail: error instanceof SourceChanged ? "Selected source changed; search again" : "Selected source could not be captured" }
      }
    },
  }
}

class SourceError extends Error {
  constructor(readonly reason: "network" | "http" | "format", message: string) { super(message) }
}
class SourceChanged extends Error {}

function registryDocument(bytes: Uint8Array): Record<string, Json> {
  try {
    const value: Json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    if (isRecord(value)) return value
  } catch { /* Source status carries a safe format error, never response content. */ }
  throw new SourceError("format", "Registry response is not readable")
}

function registryRecord(value: Json): { server: Record<string, Json> & { name: string; version: string }; publisher: NonNullable<CandidateV1["publisher"]> } {
  if (!isRecord(value) || !isRecord(value.server) || typeof value.server.name !== "string" || typeof value.server.version !== "string" || !value.server.version) throw new SourceError("format", "Registry server identity is invalid")
  const server = { ...value.server, name: value.server.name, version: value.server.version }
  const namespace = server.name.split("/")
  if (namespace.length !== 2 || !namespace[1]) throw new SourceError("format", "Registry namespace is invalid")
  if (!isRecord(value._meta) || !isRecord(value._meta["io.modelcontextprotocol.registry/official"])) throw new SourceError("format", "Registry publication metadata is missing")
  const github = namespace[0]!.match(/^io\.github\.([A-Za-z0-9][A-Za-z0-9-]*)$/)
  const publisher: CandidateV1["publisher"] = github ? { kind: "github", account: github[1]! }
    : /^(?:[a-z][a-z0-9-]*\.)+[a-z][a-z0-9-]*$/.test(namespace[0]!) ? { kind: "domain", domain: namespace[0]!.split(".").reverse().join(".").replace(/^mcp\./, "") } : undefined
  if (!publisher) throw new SourceError("format", "Registry namespace is invalid")
  return { server, publisher }
}

function isRecord(value: Json | undefined): value is { [key: string]: Json } { return value !== null && typeof value === "object" && !Array.isArray(value) }

function rank(candidates: readonly CandidateV1[], query: string): CandidateV1[] {
  return candidates.filter((entry) => relevance(entry.name, entry.displayName, entry.description, query) > 0)
    .toSorted((left, right) => relevance(right.name, right.displayName, right.description, query) - relevance(left.name, left.displayName, left.description, query))
}
function relevance(name: string, display: string, description: string, query: string): number {
  const target = query.trim().toLowerCase()
  if (!target) return 1
  if (name.toLowerCase() === target || display.toLowerCase() === target) return 3
  if (name.toLowerCase().includes(target) || display.toLowerCase().includes(target)) return 2
  return description.toLowerCase().includes(target) ? 1 : 0
}
function githubRepository(value: string): string | undefined {
  const url = URL.parse(value)
  if (!url || url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port || url.search || url.hash) return
  const path = url.pathname.replace(/\.git$/, "").replace(/\/$/, "")
  return /^\/[\w.-]+\/[\w.-]+$/.test(path) ? "https://github.com" + path : undefined
}

/** GitHub codeload's ustar/PAX container, parsed without materializing any path or executing source content. */
function readCodeload(compressed: Uint8Array): Archive {
  const bytes = gunzipSync(compressed)
  const members: Archive["members"] = new Map()
  let global: Record<string, string> = {}
  let extended: Record<string, string> = {}
  let root: string | undefined
  let longName: string | undefined
  let longLink: string | undefined
  for (let offset = 0; offset < bytes.length;) {
    const header = bytes.subarray(offset, offset + 512)
    if (header.length !== 512) throw new Error("Truncated tar header")
    if (header.every((byte) => byte === 0)) break
    const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0)
    if (checksum !== octal(header.subarray(148, 156))) throw new Error("Invalid tar checksum")
    const size = octal(header.subarray(124, 136))
    const data = bytes.subarray(offset + 512, offset + 512 + size)
    if (data.length !== size) throw new Error("Truncated tar member")
    offset += 512 + Math.ceil(size / 512) * 512
    const type = text(header.subarray(156, 157))
    if (type === "g") { global = { ...global, ...pax(data) }; continue }
    if (type === "x") { extended = pax(data); continue }
    if (type === "L") { longName = text(data).replace(/\n$/, ""); continue }
    if (type === "K") { longLink = text(data).replace(/\n$/, ""); continue }
    const prefix = text(header.subarray(345, 500))
    const path = (extended.path ?? longName ?? (prefix ? prefix + "/" : "") + text(header.subarray(0, 100))).replace(/\/$/, "")
    const link = extended.linkpath ?? longLink ?? text(header.subarray(157, 257))
    extended = {}; longName = undefined; longLink = undefined
    if (!relativePath(path)) throw new Error("Invalid tar path")
    const segments = path.split("/")
    root ??= segments[0]
    if (segments[0] !== root) throw new Error("Multiple archive roots")
    const name = segments.slice(1).join("/")
    if (!name) continue
    if (members.has(name)) throw new Error("Duplicate archive destination")
    const mode = octal(header.subarray(100, 108))
    if (mode > 0o7777) throw new Error("Invalid tar mode")
    if (type === "5") { members.set(name, { node: { kind: "directory", path: name, mode } }); continue }
    if (type === "2") { members.set(name, { node: { kind: "symlink", path: name, target: link } }); continue }
    if (type !== "0" && type !== "") throw new Error("Unsupported tar member")
    members.set(name, { node: { kind: "file", path: name, mode, bytes: data.length, digest: ("sha256:" + createHash("sha256").update(data).digest("hex")) as `sha256:${string}` }, bytes: data })
  }
  if (!/^[a-f0-9]{40}$/.test(global.comment ?? "")) throw new Error("Codeload has no fixed commit")
  return { commit: global.comment!, members }
}
function text(bytes: Uint8Array): string { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\0", 1)[0]! }
function octal(bytes: Uint8Array): number {
  const value = text(bytes).trim()
  if (!/^[0-7]+$/.test(value)) throw new Error("Invalid tar number")
  const parsed = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(parsed)) throw new Error("Invalid tar number")
  return parsed
}
function relativePath(value: string): boolean { return !!value && !value.includes("\0") && !value.includes("\\") && !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && value.split("/").every((segment) => !!segment && segment !== "." && segment !== "..") }
function pax(bytes: Uint8Array): Record<string, string> {
  const fields: Record<string, string> = {}
  for (let offset = 0; offset < bytes.length;) {
    const space = bytes.indexOf(32, offset)
    if (space < offset) throw new Error("Invalid pax record")
    const sizeText = text(bytes.subarray(offset, space))
    if (!/^\d+$/.test(sizeText)) throw new Error("Invalid pax length")
    const size = Number(sizeText)
    if (!Number.isSafeInteger(size) || size <= space - offset + 1 || offset + size > bytes.length || bytes[offset + size - 1] !== 10) throw new Error("Invalid pax length")
    const record = text(bytes.subarray(space + 1, offset + size - 1))
    const equals = record.indexOf("=")
    if (equals < 1) throw new Error("Invalid pax field")
    fields[record.slice(0, equals)] = record.slice(equals + 1)
    offset += size
  }
  return fields
}
