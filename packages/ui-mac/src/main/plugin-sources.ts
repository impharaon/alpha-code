import { createHash, randomUUID } from "node:crypto"
import { posix, join } from "node:path"
import { readdir, lstat, readFile, readlink } from "node:fs/promises"
import { gunzip } from "node:zlib"
import { readMarketplace, convertPluginTree, convertMcpServerDefinition } from "../shared/host-extension-package-contract/plugin-conversion.mjs"
import type { Capture, Json, MarketplaceEntry, Source, TreeNode, PluginPackage, Text } from "../shared/host-extension-package-contract/plugin-conversion"

import type { PackageGraphAnnotationsV1 } from "../shared/plugin-install"
import type { PackageAcceptedFactsV1 } from "./package-installability"
import { SKILL_MD_PATH } from "../shared/host-extension-package-contract/decoder"
import { PLUGIN_SOURCE_REQUEST_TIMEOUT_MS, PLUGIN_SOURCE_DEADLINE_MS } from "../shared/plugin-source-timing"

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
export function allPluginSourcesSucceeded(sources: readonly SourceStatusV1[] | undefined): boolean {
  return !!sources && sources.every((source) => source.status === "ok") &&
    PLUGIN_SOURCE_ORDER.every((required) => sources.some((source) => source.source === required))
}

const MARKETPLACES = [
  { source: "claude-marketplace", ecosystem: "claude", repository: "https://github.com/anthropics/claude-plugins-official", manifest: ".claude-plugin/marketplace.json" },
  { source: "codex-marketplace", ecosystem: "codex", repository: "https://github.com/openai/plugins", manifest: ".agents/plugins/marketplace.json" },
] as const
const MCP_REGISTRY = "https://registry.modelcontextprotocol.io/v0.1/servers"
const NPM_REGISTRY = "https://registry.npmjs.org"
// Largest recorded marketplace download is 25.8MB; leave ample room for real bundles.
const SOURCE_DOWNLOAD_MAX_BYTES = 128 * 1024 * 1024
const SOURCE_UNPACK_MAX_BYTES = 512 * 1024 * 1024
type Archive = { commit?: string; members: Map<string, { node: TreeNode; bytes?: Uint8Array }> }
type IndexedSourceCandidate = { candidate: CandidateV1 } & (
  | { kind: "marketplace"; entry: MarketplaceEntry; market: typeof MARKETPLACES[number] }
  | { kind: "mcp-registry"; serverName: string; version: string }
  | { kind: "npm"; name: string; version: string }
)
type SourceCandidate = IndexedSourceCandidate | { kind: "captured"; candidate: { id: string; displayName?: string }; capture(): Promise<Capture> }
export type PreparedPluginSourceV1 =
  | { kind: "package"; candidateId: string; displayName: string }
  | { kind: "marketplace"; entries: { id: string; displayName: string; description: string; source: "local-folder" | "claude-marketplace" | "codex-marketplace" }[] }

/** Private picker/Git preparation transport; the frozen candidate and install DTOs stay unchanged. */
export type PreparePluginSourceInputV1 = { kind: "folder" } | { kind: "git"; url: string }
export type PreparePluginSourceResultV1 = { ok: true; prepared: PreparedPluginSourceV1 } | { ok: false; detail: string; canceled?: true }

type SourceFailure = { ok: false; code: "unknown-id" | "source-unreachable" | "source-changed"; detail: string }
type ConvertedCandidate = Awaited<ReturnType<typeof convertPluginTree>> & { ok: true; capture: Capture; runtimeIdentity: string | undefined; publisher?: CandidateV1["publisher"] }
type CatalogContents = Pick<PackageAcceptedFactsV1, "envelope"> & { components: readonly Pick<PackageAcceptedFactsV1["components"][number], "payload">[] }
type CatalogComparison = { catalogId: string; packageId: string; version: string; runtimeIdentity: string }

/** One instance per main-process run; only this owner mints candidate IDs and retains fetched bytes. */
export function createPluginSources(deps: { catalog: () => Promise<readonly CandidateV1[]>; catalogPackage?: (id: string, version?: string) => Promise<CatalogContents | undefined>; installed?: () => readonly { packageId: string; name: string; enabled: boolean; runtimeIdentity?: string }[]; fetch?: (url: string, init?: RequestInit) => Promise<Response> }) {
  const searches = new Map<string, readonly SourceStatusV1[]>()
  const candidates = new Map<string, SourceCandidate>()
  const captures = new Map<string, Promise<Capture>>()
  const conversions = new Map<string, Promise<ConvertedCandidate | SourceFailure>>()
  const catalogRows = new Map<string, CandidateV1>()
  const catalogIdentities = new Map<string, Promise<CatalogComparison | undefined>>()
  const catalogComparisonRequests = new Map<string, Promise<CatalogComparison[]>>()
  const archives = new Map<string, Promise<Archive>>()
  const indexes = new Map<string, Promise<ReturnType<typeof readMarketplace>>>()
  const registryQueries = new Map<string, Promise<ReturnType<typeof registryRecord>[]>>()
  const npmQueries = new Map<string, Promise<{ name: string; version: string; description: string }[]>>()
  // Keep deadline/resource failure provenance private; the source failure wire shape remains unchanged.
  const boundedFailures = new WeakMap<SourceFailure, "network" | "format">()
  const get = async (url: string, signal?: AbortSignal) => {
    if (signal?.aborted) throw new SourceError("network", "Source deadline exceeded")
    const controller = new AbortController()
    try {
      return await sourceDeadline((async () => {
        const response = await (deps.fetch ?? fetch)(url, { signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal }).catch(() => { throw new SourceError("network", "Source request failed") })
        if (!response.ok) throw new SourceError("http", "Source returned HTTP " + response.status)
        if (Number(response.headers.get("content-length")) > SOURCE_DOWNLOAD_MAX_BYTES) {
          void response.body?.cancel().catch(() => undefined)
          throw new SourceSizeLimit()
        }
        if (!response.body) return new Uint8Array()
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let length = 0
        try {
          for (;;) {
            const chunk = await reader.read()
            if (chunk.done) break
            length += chunk.value.byteLength
            if (length > SOURCE_DOWNLOAD_MAX_BYTES) throw new SourceSizeLimit()
            chunks.push(chunk.value)
          }
        } catch (error) {
          void reader.cancel().catch(() => undefined)
          throw error instanceof SourceSizeLimit ? error : new SourceError("network", "Source download failed")
        } finally {
          reader.releaseLock()
        }
        const bytes = new Uint8Array(length)
        let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
        return bytes
      })(), PLUGIN_SOURCE_REQUEST_TIMEOUT_MS)
    } finally {
      controller.abort()
    }
  }
  const loadIndex = (market: typeof MARKETPLACES[number], signal?: AbortSignal) => {
    const known = indexes.get(market.source)
    if (known) return known
    const pending = get(market.repository.replace("https://github.com/", "https://raw.githubusercontent.com/") + "/main/" + market.manifest, signal).then((bytes) => {
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
      .then(async (bytes) => {
        const archive = await readArchive(bytes)
        if (!/^[a-f0-9]{40}$/.test(archive.commit ?? "")) throw new Error("Codeload has no fixed commit")
        return archive
      })
      .catch((error: unknown) => { archives.delete(key); throw error })
    archives.set(key, pending)
    return pending
  }
  const loadRegistry = (query: string, signal?: AbortSignal) => {
    const known = registryQueries.get(query)
    if (known) return known
    const pending = (async () => {
      const records: ReturnType<typeof registryRecord>[] = []
      const cursors = new Set<string>()
      let cursor = ""
      do {
        const page = registryDocument(await get(MCP_REGISTRY + "?search=" + encodeURIComponent(query) + "&version=latest" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), signal))
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
  const loadNpm = (query: string, signal?: AbortSignal) => {
    const known = npmQueries.get(query)
    if (known) return known
    const pending = (async () => {
      const records: { name: string; version: string; description: string }[] = []
      let offset = 0
      do {
        const page = registryDocument(await get(NPM_REGISTRY + "/-/v1/search?text=" + encodeURIComponent(query + " keywords:opencode-plugin") + "&size=250&from=" + offset, signal))
        if (!Array.isArray(page.objects) || typeof page.total !== "number" || !Number.isSafeInteger(page.total) || page.total < 0) throw new SourceError("format", "npm search is not readable")
        for (const item of page.objects) {
          const pkg = isRecord(item) && isRecord(item.package) ? item.package : undefined
          if (!pkg || typeof pkg.name !== "string" || typeof pkg.version !== "string") throw new SourceError("format", "npm package identity is invalid")
          records.push({ name: pkg.name, version: pkg.version, description: typeof pkg.description === "string" ? pkg.description : "" })
        }
        offset += page.objects.length
        if (offset >= page.total) break
        if (!page.objects.length) throw new SourceError("format", "npm search pagination is incomplete")
      } while (true)
      return [...new Map(records.map((record) => [record.name + "@" + record.version, record])).values()]
    })().catch((error: unknown) => { npmQueries.delete(query); throw error })
    npmQueries.set(query, pending)
    return pending
  }
  const captureCandidate = async (candidateId: string): Promise<{ ok: true; capture: Capture } | SourceFailure> => {
    const selected = [...candidates.values()].find((entry) => entry.candidate.id === candidateId)
    if (!selected) return { ok: false, code: "unknown-id", detail: "Candidate is unknown in this application run" }
    try {
      const known = captures.get(candidateId)
      const pending = known ?? (async () => {
        if (selected.kind === "captured") return selected.capture()
        if (selected.kind === "npm") {
          const metadata = registryDocument(await get(NPM_REGISTRY + "/" + encodeURIComponent(selected.name) + "/" + encodeURIComponent(selected.version)))
          if (metadata.name !== selected.name || metadata.version !== selected.version) throw new SourceChanged()
          if (!isRecord(metadata.dist) || typeof metadata.dist.tarball !== "string" || typeof metadata.dist.integrity !== "string") throw new SourceError("format", "npm distribution metadata is missing")
          const bytes = await get(metadata.dist.tarball)
          const integrity = metadata.dist.integrity.split(/\s+/).find((value) => /^(sha512|sha384|sha256|sha1)-/.test(value))
          if (!integrity) throw new SourceError("format", "npm integrity is not readable")
          const separator = integrity.indexOf("-")
          if (createHash(integrity.slice(0, separator)).update(bytes).digest("base64") !== integrity.slice(separator + 1)) throw new SourceError("format", "npm integrity does not match")
          return treeCapture({ kind: "npm", locator: selected.name, ecosystem: "opencode", entryName: selected.name, version: selected.version, integrity: metadata.dist.integrity }, (await readArchive(bytes)).members)
        }
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
        const capture = treeCapture({ kind: "marketplace", locator: repository, repository, commit: archive.commit, pluginPath: path, ecosystem: selected.market.ecosystem, entryName: selected.entry.name }, relative)
        selected.candidate.upstream.commit = archive.commit
        return capture
      })()
      captures.set(candidateId, pending)
      return { ok: true, capture: await pending }
    } catch (error) {
      captures.delete(candidateId)
      if (error instanceof SourceChanged && selected.kind === "marketplace") {
        indexes.delete(selected.market.source)
        archives.delete(selected.market.repository + "@refs/heads/main")
        const source = selected.entry.source
        if (source.kind === "git") archives.delete(githubRepository(source.url)! + "@" + (source.commit ?? source.ref ?? "refs/heads/main"))
      }
      const failure: SourceFailure = { ok: false, code: error instanceof SourceChanged ? "source-changed" : "source-unreachable", detail: error instanceof SourceChanged ? "Selected source changed; search again" : "Selected source could not be captured" }
      if (error instanceof SourceDeadline || error instanceof SourceSizeLimit) boundedFailures.set(failure, error instanceof SourceDeadline ? "network" : "format")
      return failure
    }
  }
  const convertCandidate = async (candidateId: string): Promise<ConvertedCandidate | SourceFailure> => {
    const known = conversions.get(candidateId)
    if (known) return known
    const pending = (async (): Promise<ConvertedCandidate | SourceFailure> => {
      const captured = await captureCandidate(candidateId)
      if (!captured.ok) return captured
      const converted = captured.capture.source.kind === "mcp-registry"
        ? { ...convertMcpServerDefinition(JSON.parse(new TextDecoder().decode(await captured.capture.readFile("server.json"))), captured.capture.source), replacements: new Map<string, Uint8Array>() }
        : await convertPluginTree(captured.capture)
      const selected = [...candidates.values()].find((entry) => entry.candidate.id === candidateId)
      if (selected?.kind === "captured") selected.candidate.displayName = converted.package.name
      const publisher = selected && selected.kind !== "captured" ? selected.candidate.publisher : undefined
      return { ok: true, capture: captured.capture, ...converted, runtimeIdentity: pluginRuntimeIdentity(converted.package), ...(publisher ? { publisher } : {}) }
    })().catch((): SourceFailure => ({ ok: false, code: "source-unreachable", detail: "Selected source could not be converted" }))
    conversions.set(candidateId, pending)
    const result = await pending
    if (!result.ok) conversions.delete(candidateId)
    return result
  }
  const catalogComparisons = (name: string, requestId?: string): Promise<CatalogComparison[]> => {
    const requestKey = requestId ? JSON.stringify([requestId, name.toLowerCase()]) : undefined
    const known = requestKey ? catalogComparisonRequests.get(requestKey) : undefined
    if (known) return known
    const pending = (async () => {
      const rows = (await deps.catalog()).filter((row) => row.name.toLowerCase() === name.toLowerCase())
      const comparisons = await Promise.all(rows.map(async (row) => {
        const key = row.id + "@" + row.upstream.version
        const known = row.upstream.version ? catalogIdentities.get(key) : undefined
        if (known) return known
        const pending = (async () => {
          const facts = await deps.catalogPackage?.(row.id, row.upstream.version)
          if (!facts || (row.upstream.version && facts.envelope.prelude.version !== row.upstream.version)) return
          const mcps: (McpIdentity | undefined)[] = []
          const skills: string[] = []
          for (const component of facts.components) {
            const payload = component.payload
            if (payload.schema === "codepuppy.host-extension-package.payload.mcp-remote.v1") mcps.push(["http", payload.behavior.url, Object.keys(payload.behavior.headersTemplate)])
            if (payload.schema === "codepuppy.host-extension-package.payload.mcp-local.v1") {
              const command = stdioIdentity(payload.behavior.command.map((token) => [token]))
              mcps.push(command ? ["stdio", command, []] : undefined)
            }
            if (payload.schema !== "codepuppy.host-extension-package.payload.skill.v1") continue
            const file = payload.behavior.files.find((file) => file.path === SKILL_MD_PATH)
            if (!file) throw new SourceError("format", "Catalog skill entry is missing")
            const bytes = await get(file.url)
            const digest = createHash("sha256").update(bytes).digest("hex")
            if (digest !== file.sha256 || bytes.length !== file.bytes) throw new SourceError("format", "Catalog skill integrity does not match")
            const converted = await convertPluginTree({ source: { kind: "listing", locator: file.url }, nodes: [{ kind: "file", path: SKILL_MD_PATH, mode: 0o644, bytes: bytes.length, digest: `sha256:${digest}` }], readFile: async () => bytes })
            const skill = converted.package.entries.find((entry) => entry.kind === "skill")
            if (!skill) throw new SourceError("format", "Catalog skill definition is invalid")
            skills.push(skill.sourceName)
          }
          const runtimeIdentity = identity(row.name, mcps, skills)
          return runtimeIdentity ? { catalogId: row.id, packageId: facts.envelope.prelude.packageId, version: facts.envelope.prelude.version, runtimeIdentity } : undefined
        })().catch(() => { catalogIdentities.delete(key); return undefined })
        if (row.upstream.version) catalogIdentities.set(key, pending)
        return pending
      }))
      return comparisons.filter((row): row is CatalogComparison => row !== undefined)
    })().catch(error => { if (requestKey) catalogComparisonRequests.delete(requestKey); throw error })
    if (requestKey) catalogComparisonRequests.set(requestKey, pending)
    return pending
  }
  return {
    /** I-15: an install of this candidate finished (either way). Its captured and converted bytes and the fetched archives are
     *  dropped instead of living until the app exits; a later use of any candidate fetches again (robustness, not a limit). */
    release(candidateId: string) {
      captures.delete(candidateId)
      conversions.delete(candidateId)
      archives.clear()
    },
    searchedSources(searchId: string) { return searches.get(searchId) },
    displayNameForId(id: string) { return [...candidates.values()].find(entry => entry.candidate.id === id)?.candidate.displayName ?? catalogRows.get(id)?.displayName },
    async prepareCapture(capture: Capture): Promise<PreparedPluginSourceV1> {
      const issue = (getCapture: () => Promise<Capture>) => {
        const id = "cand_" + randomUUID()
        candidates.set("captured:" + id, { kind: "captured", candidate: { id }, capture: getCapture })
        return id
      }
      const manifest = [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"].find(path => capture.nodes.some(node => node.kind === "file" && node.path === path))
      if (manifest) {
        const ecosystem = manifest.startsWith(".agents/") ? "codex" : "claude"
        const marketplace = readMarketplace(await capture.readFile(manifest), ecosystem)
        return { kind: "marketplace", entries: marketplace.entries.flatMap(entry => {
          if (entry.source.kind === "unsupported") return []
          const source = entry.source
          const prefix = source.kind === "path" ? source.path.replace(/\/$/, "") : source.path ?? ""
          const provenance: Source = capture.source.kind === "folder"
            ? { ...capture.source, ecosystem, entryName: entry.name }
            : { kind: "marketplace", locator: source.kind === "git" ? source.url : capture.source.locator, repository: source.kind === "git" ? source.url : capture.source.repository, commit: source.kind === "git" ? source.commit : capture.source.commit, pluginPath: prefix, ecosystem, entryName: entry.name }
          const id = issue(async () => {
            if (source.kind === "git") {
              const captured = await this.captureGit(source.url, source.commit ?? source.ref ?? "refs/heads/main", source.path)
              return { ...captured, source: { ...captured.source, kind: "marketplace", ecosystem, entryName: entry.name } }
            }
            const base = prefix && prefix !== "." ? prefix + "/" : ""
            const nodes = capture.nodes.filter(node => node.path.startsWith(base) && node.path !== prefix).map(node => ({ ...node, path: node.path.slice(base.length) }))
            if (!nodes.length) throw Error("Selected marketplace subtree is missing")
            return { source: provenance, nodes, readFile: path => capture.readFile(base + path) }
          })
          return [{ id, displayName: entry.name, description: entry.description, source: capture.source.kind === "folder" ? "local-folder" as const : ecosystem === "claude" ? "claude-marketplace" as const : "codex-marketplace" as const }]
        }) }
      }
      const candidateId = issue(async () => capture)
      const converted = await convertCandidate(candidateId)
      if (!converted.ok) throw Error(converted.detail)
      return { kind: "package", candidateId, displayName: converted.package.name }
    },
    async resolveInstallSource(id: string): Promise<{ kind: "catalog"; catalogId: string } | { kind: "candidate"; candidateId: string } | undefined> {
      if ([...candidates.values()].some((entry) => entry.candidate.id === id)) return { kind: "candidate", candidateId: id }
      if (catalogRows.has(id) || (await deps.catalog()).some((row) => row.id === id)) return { kind: "catalog", catalogId: id }
    },
    async captureFolder(directory: string): Promise<Capture> {
      const members: Archive["members"] = new Map()
      const visit = async (relative: string): Promise<void> => {
        for (const name of (await readdir(join(directory, relative))).sort()) {
          const path = relative ? relative + "/" + name : name
          const stat = await lstat(join(directory, path))
          if (stat.isSymbolicLink()) { members.set(path, { node: { kind: "symlink", path, target: await readlink(join(directory, path)) } }); continue }
          if (stat.isDirectory()) { members.set(path, { node: { kind: "directory", path, mode: stat.mode & 0o7777 } }); await visit(path); continue }
          if (!stat.isFile()) continue
          const bytes = new Uint8Array(await readFile(join(directory, path)))
          members.set(path, { node: { kind: "file", path, mode: stat.mode & 0o7777, bytes: bytes.length, digest: ("sha256:" + createHash("sha256").update(bytes).digest("hex")) as `sha256:${string}` }, bytes })
        }
      }
      await visit("")
      return treeCapture({ kind: "folder", locator: directory }, members)
    },
    async captureGit(repository: string, revision: string, path = ""): Promise<Capture> {
      const canonical = githubRepository(repository)
      if (!canonical) throw new SourceError("format", "Git source is not a supported repository")
      if (path && !relativePath(path)) throw new SourceError("format", "Git source path is invalid")
      const archive = await loadArchive(canonical, revision)
      if (/^[a-f0-9]{40}$/.test(revision) && archive.commit !== revision) throw new SourceChanged()
      const members = new Map([...archive.members].filter(([name]) => !path || name.startsWith(path + "/")).map(([name, member]) => [path ? name.slice(path.length + 1) : name, member]))
      return treeCapture({ kind: "git", locator: canonical, repository: canonical, commit: archive.commit, pluginPath: path }, members)
    },
    async searchSources(query: string, onProgress?: (result: SourceSearchResultV1) => void): Promise<SourceSearchResultV1> {
      const searchId = "search_" + randomUUID()
      const expires = Date.now() + PLUGIN_SOURCE_DEADLINE_MS
      const controllers = new Map(PLUGIN_SOURCE_ORDER.map(source => [source, new AbortController()]))
      const withinSource = <T>(source: PluginSourceIdV1, work: Promise<T>) => sourceDeadline(work, Math.max(0, expires - Date.now())).catch(error => { controllers.get(source)!.abort(); throw error })
      const groups: { status: SourceStatusV1; candidates: CandidateV1[] }[] = []
      const orderedGroups = () => groups.toSorted((left, right) => PLUGIN_SOURCE_ORDER.indexOf(left.status.source) - PLUGIN_SOURCE_ORDER.indexOf(right.status.source))
      const snapshot = (): SourceSearchResultV1 => ({ searchId, query, sources: orderedGroups().map(group => ({ ...group.status })), candidates: orderedGroups().flatMap(group => group.candidates.map(candidate => ({ ...candidate, upstream: { ...candidate.upstream } }))) })
      const sourceFailed = (source: PluginSourceIdV1, reason: "network" | "format" = "network") => {
        const group = groups.find(group => group.status.source === source)!
        group.status = { source, status: "failed", reason, detail: reason === "network" ? "Source could not be read within its network budget" : "Source exceeded its archive resource budget" }
      }
      const convertedForSearch = async (candidate: CandidateV1) => {
        if (Date.now() >= expires) return
        if (groups.find(group => group.status.source === candidate.source)?.status.status === "failed") return
        try {
          const result = await withinSource(candidate.source, convertCandidate(candidate.id))
          if (!result.ok && boundedFailures.has(result)) sourceFailed(candidate.source, boundedFailures.get(result)!)
          return result.ok ? result : undefined
        } catch {
          sourceFailed(candidate.source)
        }
      }
      const decorate = async () => {
        const ordered = orderedGroups().flatMap(group => group.candidates)
        const installed = deps.installed?.() ?? []
        for (const [index, candidate] of ordered.entries()) {
          if (candidate.source === "catalog") continue
          const higher = ordered.slice(0, index).filter((entry) => PLUGIN_SOURCE_ORDER.indexOf(entry.source) < PLUGIN_SOURCE_ORDER.indexOf(candidate.source) && entry.name.toLowerCase() === candidate.name.toLowerCase())
          if (!higher.length) continue
          const converted = await convertedForSearch(candidate)
          if (!converted?.runtimeIdentity) continue
          for (const entry of higher) {
            const other = entry.source === "catalog"
              ? await withinSource("catalog", catalogComparisons(entry.name, searchId)).then(rows => rows.find(row => row.catalogId === entry.id)?.runtimeIdentity).catch(() => { sourceFailed("catalog"); return undefined })
              : (await convertedForSearch(entry))?.runtimeIdentity
            if (other !== converted.runtimeIdentity) continue
            candidate.sameAs = entry.sameAs ?? entry.id
            break
          }
        }
        for (const candidate of ordered) {
          const direct = installed.find(item => item.packageId === candidate.id)
          const possible = installed.filter(item => item.runtimeIdentity && item.name.toLowerCase() === candidate.name.toLowerCase())
          const converted = !direct && possible.length ? await convertedForSearch(candidate) : undefined
          const match = direct ?? (converted?.ok ? possible.find(item => item.runtimeIdentity === converted.runtimeIdentity) : undefined)
          if (match) candidate.installed = { packageId: match.packageId, enabled: match.enabled }
        }
      }
      const comparisons: Promise<void>[] = []
      const publish = (group: { status: SourceStatusV1; candidates: CandidateV1[] }) => {
        for (const candidate of group.candidates) { delete candidate.sameAs; delete candidate.installed }
        groups.push(group)
        onProgress?.(snapshot())
        if (Date.now() < expires) comparisons.push(decorate().then(() => { onProgress?.(snapshot()) }))
      }
      try {
        await Promise.all([
          Promise.allSettled([withinSource("catalog", deps.catalog())]).then(results => {
            const catalog = results[0]!
            const local = catalog.status === "fulfilled" ? rank(catalog.value, query) : []
            catalogRows.clear()
            if (catalog.status === "fulfilled") for (const row of catalog.value) catalogRows.set(row.id, row)
            const source: SourceStatusV1 = catalog.status === "fulfilled"
              ? { source: "catalog", status: "ok", matched: local.length, skipped: 0 }
              : { source: "catalog", status: "failed", reason: catalog.reason instanceof SourceError ? catalog.reason.reason : "format", detail: "Customization catalog is unavailable" }
            publish({ status: source, candidates: local })
          }),
          ...MARKETPLACES.map(market => Promise.allSettled([withinSource(market.source, loadIndex(market, controllers.get(market.source)!.signal))]).then(results => {
            const result = results[0]!
            const group = (() : { status: SourceStatusV1; candidates: CandidateV1[] } => {
              if (result.status === "rejected") {
                const failure = result.reason instanceof SourceError ? result.reason : new SourceError("network", "Marketplace is unavailable")
                return { status: { source: market.source, status: "failed", reason: failure.reason, detail: failure.message }, candidates: [] }
              }
              const matches = result.value.entries.filter((entry) => relevance(entry.name, entry.name, entry.description, query) > 0)
              const available = matches.flatMap((entry): CandidateV1[] => {
                if (entry.source.kind === "unsupported" || (entry.source.kind === "git" && !githubRepository(entry.source.url))) return []
                const identity = market.source + JSON.stringify(entry)
                const known = candidates.get(identity)
                if (known && known.kind !== "captured") return [known.candidate]
                const repository = entry.source.kind === "git" ? githubRepository(entry.source.url)! : market.repository
                const candidate: CandidateV1 = {
                  id: "cand_" + randomUUID(), source: market.source, name: entry.name, displayName: entry.name, description: entry.description, kind: "plugin",
                  upstream: { repository, ...(entry.source.kind === "path" ? { path: entry.source.path } : { ...(entry.source.path === undefined ? {} : { path: entry.source.path }), ...(entry.source.commit ? { commit: entry.source.commit } : {}) }) },
                }
                candidates.set(identity, { kind: "marketplace", entry, candidate, market })
                return [candidate]
              })
              return { status: { source: market.source, status: "ok", matched: available.length, skipped: matches.length - available.length }, candidates: rank(available, query) }

            })()
            publish(group)
          })),
          Promise.allSettled([withinSource("mcp-registry", loadRegistry(query, controllers.get("mcp-registry")!.signal))]).then(results => {
            const registry = results[0]!
            const found = registry.status === "fulfilled" ? registry.value.map((record) => {
              const identity = "mcp-registry:" + record.server.name + "@" + record.server.version
              const known = candidates.get(identity)
              if (known && known.kind !== "captured") return known.candidate
              const candidate: CandidateV1 = { id: "cand_" + randomUUID(), source: "mcp-registry", name: record.server.name, displayName: typeof record.server.title === "string" ? record.server.title : record.server.name,
                description: typeof record.server.description === "string" ? record.server.description : "", kind: "mcp", publisher: record.publisher,
                upstream: { serverName: record.server.name, version: record.server.version } }
              candidates.set(identity, { kind: "mcp-registry", candidate, serverName: record.server.name, version: record.server.version })
              return candidate
            }) : []
            const failure = registry.status === "rejected" ? registry.reason instanceof SourceError ? registry.reason : new SourceError("network", "Registry is unavailable") : undefined
            const registryStatus: SourceStatusV1 = failure ? { source: "mcp-registry", status: "failed", reason: failure.reason, detail: failure.message } : { source: "mcp-registry", status: "ok", matched: found.length, skipped: 0 }
            publish({ status: registryStatus, candidates: found })
          }),
          Promise.allSettled([withinSource("opencode-npm", loadNpm(query, controllers.get("opencode-npm")!.signal))]).then(results => {
            const npm = results[0]!
            const npmFound = npm.status === "fulfilled" ? npm.value.filter((pkg) => relevance(pkg.name, pkg.name, pkg.description, query) > 0).map((pkg) => {
              const identity = "npm:" + pkg.name + "@" + pkg.version
              const known = candidates.get(identity)
              if (known && known.kind !== "captured") return known.candidate
              const candidate: CandidateV1 = { id: "cand_" + randomUUID(), source: "opencode-npm", name: pkg.name, displayName: pkg.name, description: pkg.description, kind: "plugin", upstream: { npm: pkg.name, version: pkg.version } }
              candidates.set(identity, { kind: "npm", candidate, name: pkg.name, version: pkg.version })
              return candidate
            }) : []
            const npmFailure = npm.status === "rejected" ? npm.reason instanceof SourceError ? npm.reason : new SourceError("network", "npm is unavailable") : undefined
            const npmStatus: SourceStatusV1 = npmFailure ? { source: "opencode-npm", status: "failed", reason: npmFailure.reason, detail: npmFailure.message } : { source: "opencode-npm", status: "ok", matched: npmFound.length, skipped: 0 }
            publish({ status: npmStatus, candidates: rank(npmFound, query) })
          }),
        ])
        await Promise.all(comparisons)
        if (Date.now() < expires) await decorate()
        const result = snapshot()
        searches.set(searchId, result.sources.map(source => ({ ...source })))
        onProgress?.(result)
        return result
      } finally {
        for (const controller of controllers.values()) controller.abort()
      }
    },
    captureCandidate,
    convertCandidate,
    catalogComparisons,
  }
}

class SourceError extends Error {
  constructor(readonly reason: "network" | "http" | "format", message: string) { super(message) }
}
class SourceDeadline extends SourceError {
  constructor() { super("network", "Source deadline exceeded") }
}
class SourceSizeLimit extends SourceError {
  constructor() { super("format", "Source exceeded its archive resource budget") }
}
function sourceDeadline<T>(work: Promise<T>, duration: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SourceDeadline()), duration)
    work.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}
class SourceChanged extends Error {}

type McpIdentity = [transport: string, endpoint: string, headers: string[]]

/** Shared by search folding and the install entry's pre-commit comparison. */
export function pluginRuntimeIdentity(pkg: PluginPackage): string | undefined {
  return identity(pkg.name, pkg.entries.filter((entry) => entry.kind === "mcp").map((entry): McpIdentity | undefined => {
    const endpoint = entry.transport === "stdio" ? stdioIdentity(entry.command) : literal(entry.url)
    return endpoint ? [entry.transport, endpoint, entry.transport === "stdio" ? [] : Object.keys(entry.headers)] : undefined
  }), pkg.entries.filter((entry) => entry.kind === "skill").map((entry) => entry.sourceName))
}

/** Shared installed identity projection for deduplication and read-only search presentation. */
export function installedPackageIdentity(graph: PackageGraphAnnotationsV1 & { root: { name: string } }) {
  const name = graph.source?.kind === "marketplace" ? graph.source.entryName
    : graph.source?.kind === "npm" ? graph.source.name
    : graph.source?.kind === "mcp-registry" ? graph.source.serverName.split("/").at(-1)!
    : graph.root.name
  return { name, runtimeIdentity: graph.declarations ? packageDeclarationRuntimeIdentity(name, graph.declarations) : undefined }
}

/** Installed sanitized declarations use the same identity implementation as captured definitions. */
export function packageDeclarationRuntimeIdentity(name: string, declarations: readonly import("../shared/plugin-install").PackageDeclarationV1[]): string | undefined {
  return identity(name, declarations.flatMap((entry): McpIdentity[] => {
    if (!entry.mcp) return []
    const endpoint = entry.mcp.type === "local" ? stdioIdentity(entry.mcp.command.map((token) => [token])) : entry.mcp.url
    return endpoint ? [[entry.mcp.type === "local" ? "stdio" : "http", endpoint, entry.mcp.type === "remote" ? Object.keys(entry.mcp.headers ?? {}) : []]] : []
  }), declarations.filter((entry) => entry.kind === "skill").map((entry) => entry.sourceName))
}

function identity(name: string, mcps: (McpIdentity | undefined)[], skills: string[]): string | undefined {
  if ((!mcps.length && !skills.length) || mcps.some((entry) => entry === undefined)) return
  return JSON.stringify([name.toLowerCase(), mcps.map((entry) => [entry![0], entry![1], [...new Set(entry![2].map((header) => header.toLowerCase()))].sort()]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))), [...new Set(skills)].sort()])
}

function stdioIdentity(command: readonly Text[]): string | undefined {
  const executable = literal(command[0] ?? [])
  const argument = command.slice(1).find((part) => !literal(part)?.startsWith("-"))
  const token = argument ? literal(argument) : undefined
  if (!executable || (argument && token === undefined)) return
  const version = token?.lastIndexOf("@") ?? -1
  return executable + (token ? " " + (version > 0 ? token.slice(0, version) : token.replace(/==[^=]+$/, "")) : "")
}

function literal(text: Text): string | undefined { return text.every((part) => typeof part === "string") ? text.join("") : undefined }

function treeCapture(source: Source, members: Archive["members"]): Capture {
  return { source, nodes: [...members].map(([path, member]) => ({ ...member.node, path })), readFile: async (path) => {
    const visited = new Set<string>()
    const read = (name: string): Uint8Array => {
      if (visited.has(name)) throw new Error("Captured link cycle")
      visited.add(name)
      const member = members.get(name)
      if (member?.bytes) return member.bytes
      if (member?.node.kind === "symlink") return read(posix.normalize(posix.join(posix.dirname(name), member.node.target)))
      throw new Error("Captured file is missing")
    }
    return read(path)
  } }
}

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
async function readArchive(compressed: Uint8Array): Promise<Archive> {
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    gunzip(compressed, { maxOutputLength: SOURCE_UNPACK_MAX_BYTES }, (error, output) => {
      if (error) return reject((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE" ? new SourceSizeLimit() : error)
      resolve(output)
    })
  })
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
  return { commit: global.comment, members }
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
