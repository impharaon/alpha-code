import { expect, test } from "bun:test"
import { mkdtemp, rm, cp, readFile, stat } from "node:fs/promises"
import { appendFileSync, cpSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import opencode from "../../test-fixtures/plugin-helper/opencode/provenance.json"
import npm from "../../test-fixtures/plugin-helper/opencode/npm/provenance.json"
import formalCatalog from "../../test-fixtures/plugin-helper/catalog/catalog.json"
import catalogProvenance from "../../test-fixtures/plugin-helper/catalog/provenance.json"
import { createHash, createPublicKey, verify } from "node:crypto"
import { decodePackageEnvelopeHeaderV1, decodePackageProfilePayloadV1 } from "../shared/host-extension-package-contract/decoder"
import { gunzipSync, gzipSync } from "node:zlib"
import { join } from "node:path"
import catalog from "../renderer/extensions/codepuppy-catalog.json"
import codex from "../../test-fixtures/plugin-helper/codex/provenance.json"
import { captureStandardFixture, fixtureCommit, fixtureRoot } from "../../test-fixtures/plugin-helper/fixture"

const sourcesModule = () => import("./plugin-sources")
const marketplace = () => Bun.file(join(fixtureRoot, ".claude-plugin/marketplace.json")).text()
const archive = () => Bun.file(join(fixtureRoot, "claude-selection.tar.gz")).arrayBuffer()
const catalogCandidates = () => catalog.entries.map((entry) => ({ id: entry.id, source: "catalog" as const, name: entry.name, displayName: entry.displayName, description: entry.description, kind: "plugin" as const, upstream: {} }))
const formalCandidates = () => formalCatalog.packages.filter((entry) => ["package:github", "package:github-official"].includes(entry.prelude.packageId)).map((entry) => ({ id: entry.prelude.packageId, source: "catalog" as const, name: entry.presentation.displayName, displayName: entry.presentation.displayName, description: entry.presentation.description, kind: "plugin" as const, upstream: { version: entry.prelude.version } }))
async function formalPackage(id: string) {
  const envelope = formalCatalog.packages.find((entry) => entry.prelude.packageId === id)!
  const header = decodePackageEnvelopeHeaderV1(new TextEncoder().encode(JSON.stringify(envelope)))
  if (!header.ok) throw new Error("Pinned formal envelope was not accepted")
  const components = await Promise.all(header.components.filter((component) => component.status === "supported").map(async (item) => {
    const ref = item.component.payloadRef
    const file = catalogProvenance.files.find((file) => file.url === ref.url)!
    const bytes = await Bun.file(join(fixtureRoot, "catalog", file.path)).bytes()
    if (bytes.length !== ref.bytes || createHash("sha256").update(bytes).digest("hex") !== ref.sha256) throw new Error("Pinned payload integrity failed")
    const decoded = decodePackageProfilePayloadV1(item.component.profileId, bytes, item.component.capabilities)
    if (!decoded.ok) throw new Error("Pinned formal payload was not accepted")
    return { payload: decoded.payload }
  }))
  return { envelope: header.envelope, components }
}

async function fixtureFetch(url: string | URL | Request): Promise<Response> {
  const address = String(url)
  if (address === "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json") return new Response(await marketplace())
  if (address === "https://codeload.github.com/anthropics/claude-plugins-official/tar.gz/refs/heads/main") return new Response(await archive())
  if (address === "https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json") return new Response(await Bun.file(join(fixtureRoot, "codex/.agents/plugins/marketplace.json")).bytes())
  if (address === "https://codeload.github.com/openai/plugins/tar.gz/refs/heads/main") return new Response(await Bun.file(join(fixtureRoot, "codex/selection.tar.gz")).bytes())
  if (address.startsWith("https://registry.modelcontextprotocol.io/v0.1/servers?")) return new Response(await Bun.file(join(fixtureRoot, "registry", address.includes("search=io.github.github%2Fgithub-mcp-server") ? "github-registry-search.json" : "empty-search.json")).bytes())
  if (address === "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.github%2Fgithub-mcp-server/versions/2.1.0") return new Response(await Bun.file(join(fixtureRoot, "registry/github-registry-version.json")).bytes())
  if (address.startsWith("https://registry.npmjs.org/-/v1/search?")) {
    const page = await Bun.file(join(fixtureRoot, "opencode/npm", address.includes("text=skills") ? "search.json" : "empty-search.json")).json()
    // Scope the recorded index to these actual objects for skills; control other queries as no-match records.
    return Response.json({ ...page, objects: address.includes("text=skills") ? page.objects : [], total: address.includes("text=skills") ? page.objects.length : 0 })
  }
  if (address === "https://registry.npmjs.org/opencode-skills-hub/0.0.5") return new Response(await Bun.file(join(fixtureRoot, "opencode/npm/metadata.json")).bytes())
  if (address === npm.tarballUrl) return new Response(await Bun.file(join(fixtureRoot, "opencode/npm/package.tgz")).bytes())
  for (const tree of opencode.trees) if (address === "https://codeload.github.com/" + tree.repository.slice("https://github.com/".length) + "/tar.gz/" + tree.commit) return new Response(await Bun.file(join(fixtureRoot, "opencode", tree.root, tree.archive.path)).bytes())
  throw new Error(`unexpected fixture URL: ${address}`)
}

test("catalog miss continues to the pinned Claude context7 entry", async () => {
  expect(catalog.entries.some((entry) => /context7/i.test(`${entry.name} ${entry.displayName} ${entry.description}`))).toBe(false)
  expect(JSON.parse(await marketplace()).plugins.some((entry: { name: string }) => entry.name === "context7")).toBe(true)
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => catalogCandidates(), fetch: fixtureFetch })
  const result = await sources.searchSources("context7")
  expect(result.sources.slice(0, 2)).toMatchObject([{ source: "catalog", status: "ok", matched: 0 }, { source: "claude-marketplace", status: "ok", matched: 1 }])
  expect(result.candidates).toMatchObject([{ source: "claude-marketplace", name: "context7", upstream: { repository: "https://github.com/anthropics/claude-plugins-official", path: "external_plugins/context7" } }])
  expect(result.candidates[0]!.id).toMatch(/^cand_/)
  expect(result.searchId).not.toBe("")
  const captured = await sources.captureCandidate(result.candidates[0]!.id)
  expect(captured.ok).toBe(true)
  if (!captured.ok) throw new Error(captured.code)
  expect(captured.capture.source.commit).toBe(fixtureCommit)
  expect(captured.capture.nodes.map((node) => node.path).filter(Boolean).sort()).toEqual([".claude-plugin", ".claude-plugin/plugin.json", ".mcp.json", "README.md"])
  expect(JSON.parse(new TextDecoder().decode(await captured.capture.readFile(".mcp.json")))).toEqual({ mcpServers: { context7: { type: "http", url: "https://mcp.context7.com/mcp?client=claude-code-plugin" } } })
  expect(await captured.capture.readFile(".mcp.json")).toEqual(new Uint8Array(await Bun.file(join(fixtureRoot, "external_plugins/context7/.mcp.json")).arrayBuffer()))
})

test("catalog candidates precede marketplace candidates; names alone do not claim sameAs", async () => {
  expect(catalog.entries.find((entry) => entry.name === "playwright")).toMatchObject({ id: "mcp:playwright", type: "mcp" })
  expect(JSON.parse(await marketplace()).plugins.some((entry: { name: string }) => entry.name === "playwright")).toBe(true)
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => catalogCandidates(), fetch: fixtureFetch })
  const result = await sources.searchSources("playwright")
  expect(result.candidates[0]).toMatchObject({ id: "mcp:playwright", source: "catalog", name: "playwright" })
  expect(result.candidates.some((candidate) => candidate.source === "claude-marketplace" && candidate.name === "playwright")).toBe(true)
  expect(result.candidates.filter((candidate) => candidate.source === "claude-marketplace").every((candidate) => candidate.sameAs === undefined)).toBe(true)
})

test("successful index and pinned archive bytes are reused within the application run", async () => {
  const requests: string[] = []
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => { requests.push(String(url)); return fixtureFetch(url) } })
  const first = await sources.searchSources("playwright")
  const second = await sources.searchSources("playwright")
  const id = first.candidates[0]!.id
  expect(second.candidates[0]!.id).toBe(id)
  const one = await sources.captureCandidate(id)
  const two = await sources.captureCandidate(id)
  expect(one.ok && two.ok && one.capture === two.capture).toBe(true)
  // §4.7:每份清单先请求一次转发入口(本夹具不答)再取原地址;两次搜索之间索引与归档都复用,所以原地址仍是 5 次、转发各 1 次。
  expect(requests.filter((url) => !url.startsWith("https://alpha-github-hk.tidelabs.click/"))).toHaveLength(5)
  expect(requests.filter((url) => url.startsWith("https://alpha-github-hk.tidelabs.click/")).sort()).toEqual([RELAY_CLAUDE, RELAY_CODEX])
  expect(requests.every((url) => !url.includes("api.github.com"))).toBe(true)
})

test("failed sources are truthful and not cached as no results", async () => {
  // §4.7:清单经转发与原地址两次都失败才算该来源失败,所以第一次搜索让 Claude 清单的两个地址都回 503。
  const claudeRequests: string[] = []
  let codexRequests = 0
  let available = false
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => {
    if (url.includes("openai/plugins/main/")) codexRequests++
    if (!url.includes("claude-plugins-official/main/")) return fixtureFetch(url)
    claudeRequests.push(url)
    return available ? fixtureFetch(url) : new Response("unavailable", { status: 503 })
  } })
  const failed = await sources.searchSources("playwright")
  expect(failed.sources.slice(0, 2)).toMatchObject([{ status: "ok" }, { source: "claude-marketplace", status: "failed", reason: "http" }])
  expect(failed.candidates).toEqual([])
  available = true
  const retried = await sources.searchSources("playwright")
  expect(retried.candidates).toHaveLength(1)
  // 失败没有被缓存成「无结果」:第二次搜索重新请求 Claude 清单(转发 → 原地址);成功的 Codex 清单不再请求。
  expect(claudeRequests).toEqual([RELAY_CLAUDE, RAW_CLAUDE, RELAY_CLAUDE, RAW_CLAUDE])
  expect(codexRequests).toBe(2)
})

test("invalid index is a format failure and unknown candidate cannot start a download", async () => {
  let requests = 0
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async () => { requests++; return new Response("{not-json") } })
  expect(await sources.captureCandidate("cand_invented")).toMatchObject({ ok: false, code: "unknown-id" })
  expect(requests).toBe(0)
  expect((await sources.searchSources("playwright")).sources.slice(0, 2)).toMatchObject([{ status: "ok" }, { status: "failed", reason: "format" }])
})

test("selected entry changed between index and codeload is source-changed", async () => {
  // Controlled variant of the real index: only the selected entry's source differs from the recorded archive.
  const index = JSON.parse(await marketplace())
  index.plugins.find((plugin: { name: string }) => plugin.name === "playwright").source = "./external_plugins/context7"
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => String(url).includes("raw.githubusercontent") ? Response.json(index) : fixtureFetch(url) })
  const searched = await sources.searchSources("playwright")
  expect(await sources.captureCandidate(searched.candidates[0]!.id)).toMatchObject({ ok: false, code: "source-changed" })
})

test("corrupt tar header is rejected before exposing a capture", async () => {
  const bytes = new Uint8Array(gunzipSync(await archive()))
  bytes[0] = bytes[0]! ^ 1 // corrupt a real tar header without recomputing its checksum
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => String(url).includes("raw.githubusercontent") ? fixtureFetch(url) : new Response(gzipSync(bytes)) })
  const searched = await sources.searchSources("playwright")
  expect(await sources.captureCandidate(searched.candidates[0]!.id)).toMatchObject({ ok: false, code: "source-unreachable" })
})

test("command sources are installable candidates that search comparison never runs", async () => {
  const fetched: string[] = []
  // A same-name catalog row and installed package make search compare the marketplace candidate; comparing would capture it.
  const sources = (await sourcesModule()).createPluginSources({
    catalog: async () => [{ id: "xcode-catalog", source: "catalog", name: "xcode", displayName: "Xcode", description: "", kind: "plugin", upstream: {} }],
    installed: () => [{ packageId: "claude:xcode", name: "xcode", enabled: true, runtimeIdentity: "installed-xcode" }],
    fetch: (url) => { fetched.push(String(url)); return fixtureFetch(url) },
  })
  const result = await sources.searchSources("xcode")
  const xcode = result.candidates.find((candidate) => candidate.source === "claude-marketplace" && candidate.name === "xcode")
  expect(xcode).toMatchObject({ kind: "plugin", upstream: { repository: "https://github.com/anthropics/claude-plugins-official" } })
  expect(xcode?.sameAs).toBeUndefined()
  expect(xcode?.installed).toBeUndefined()
  expect(fetched.filter((url) => url.includes("codeload.github.com"))).toEqual([])
  expect(result.sources.find((source) => source.source === "claude-marketplace")).toMatchObject({ status: "ok", skipped: 0 })
})

test("Codex local entry captures only its pinned subtree and rechecks marketplace membership", async () => {
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: fixtureFetch })
  const result = await sources.searchSources("figma")
  expect(result.sources.map((source) => source.source)).toEqual(["catalog", "claude-marketplace", "codex-marketplace", "opencode-npm", "mcp-registry"])
  expect(result.sources[2]).toMatchObject({ status: "ok", matched: 1, skipped: 0 })
  const candidate = result.candidates.find((entry) => entry.source === "codex-marketplace")!
  expect(candidate).toMatchObject({ name: "figma", upstream: { repository: codex.repository, path: "plugins/figma" } })
  const captured = await sources.captureCandidate(candidate.id)
  expect(captured.ok).toBe(true)
  if (!captured.ok) throw new Error(captured.code)
  expect(captured.capture.source).toMatchObject({ ecosystem: "codex", commit: codex.commit, pluginPath: "plugins/figma" })
  expect(captured.capture.nodes.every((node) => !node.path.startsWith("plugins/"))).toBe(true)
  expect(await captured.capture.readFile(".mcp.json")).toEqual(await Bun.file(join(fixtureRoot, "codex/plugins/figma/.mcp.json")).bytes())
  expect(await sources.captureCandidate(candidate.id)).toEqual(captured)
  // Only change the selected path in a recorded real index; the archive retains its original entry.
  const index = JSON.parse(await Bun.file(join(fixtureRoot, "codex/.agents/plugins/marketplace.json")).text())
  index.plugins.find((entry: { name: string }) => entry.name === "figma").source.path = "./plugins/github"
  const changed = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => url.includes("openai/plugins/main/") ? Response.json(index) : fixtureFetch(url) })
  const found = (await changed.searchSources("figma")).candidates.find((entry) => entry.source === "codex-marketplace")!
  expect(await changed.captureCandidate(found.id)).toMatchObject({ ok: false, code: "source-changed" })
})

test("Codex failures retry per source while successful Claude results survive", async () => {
  let attempts = 0
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => {
    // §4.7:转发地址由夹具回 404;这里只数原地址的请求。
    if (!url.includes("raw.githubusercontent.com/openai/plugins/main/")) return fixtureFetch(url)
    attempts++
    return attempts === 1 ? new Response("unavailable", { status: 503 }) : fixtureFetch(url)
  } })
  const failed = await sources.searchSources("figma")
  expect(failed.sources[2]).toMatchObject({ source: "codex-marketplace", status: "failed", reason: "http" })
  expect(failed.candidates.some((entry) => entry.source === "claude-marketplace")).toBe(true)
  const retried = await sources.searchSources("figma")
  expect(retried.sources[2]).toMatchObject({ status: "ok", matched: 1 })
  await sources.searchSources("figma")
  expect(attempts).toBe(2)
})

test("GitHub registry candidate has namespace publisher and exact version detail", async () => {
  const requests: string[] = []
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => { requests.push(url); return fixtureFetch(url) } })
  const result = await sources.searchSources("io.github.github/github-mcp-server")
  expect(result.sources.at(-1)).toMatchObject({ source: "mcp-registry", status: "ok", matched: 1 })
  const candidate = result.candidates.find((entry) => entry.source === "mcp-registry")!
  expect(candidate).toMatchObject({ kind: "mcp", publisher: { kind: "github", account: "github" }, upstream: { serverName: "io.github.github/github-mcp-server", version: "2.1.0" } })
  const captured = await sources.captureCandidate(candidate.id)
  expect(captured.ok).toBe(true)
  if (!captured.ok) throw new Error(captured.code)
  expect(captured.capture.source).toMatchObject({ kind: "mcp-registry", serverName: candidate.upstream.serverName, version: "2.1.0" })
  expect(JSON.parse(new TextDecoder().decode(await captured.capture.readFile("server.json")))).toEqual((await Bun.file(join(fixtureRoot, "registry/github-registry-version.json")).json()).server)
  await sources.searchSources("io.github.github/github-mcp-server")
  expect(await sources.captureCandidate(candidate.id)).toEqual(captured)
  expect(requests.filter((url) => url.includes("registry.modelcontextprotocol.io"))).toHaveLength(2)
})

test("registry zero matches and transport http format failures stay distinct and retry", async () => {
  for (const reason of ["network", "http", "format"] as const) {
    let attempts = 0
    const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => {
      if (!url.includes("registry.modelcontextprotocol.io")) return fixtureFetch(url)
      if (++attempts > 1) return fixtureFetch(url)
      if (reason === "network") throw new Error("transport failed")
      return reason === "http" ? new Response("unavailable", { status: 503 }) : new Response("{malformed")
    } })
    expect((await sources.searchSources("playwright")).sources.at(-1)).toMatchObject({ source: "mcp-registry", status: "failed", reason })
    expect((await sources.searchSources("playwright")).sources.at(-1)).toEqual({ source: "mcp-registry", status: "ok", matched: 0, skipped: 0 })
    expect(attempts).toBe(2)
  }
})

test("registry pagination preserves real records and malformed namespaces cannot claim a publisher", async () => {
  const page = await Bun.file(join(fixtureRoot, "registry/github-registry-search.json")).json()
  const figma = await Bun.file(join(fixtureRoot, "registry/figma-registry-version.json")).json()
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => {
    if (!url.includes("registry.modelcontextprotocol.io")) return fixtureFetch(url)
    // Page a recorded result into two responses; only container metadata and record selection change.
    return url.includes("cursor=") ? Response.json({ ...page, servers: [figma] }) : Response.json({ ...page, metadata: { ...page.metadata, nextCursor: "recorded-page-2" } })
  } })
  const result = await sources.searchSources("mcp")
  expect(result.sources.at(-1)).toMatchObject({ status: "ok", matched: 2 })
  expect(result.candidates.find((entry) => entry.upstream.serverName === "com.figma.mcp/mcp")).toMatchObject({ publisher: { kind: "domain", domain: "figma.com" } })
  const broken = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => url.includes("registry.modelcontextprotocol.io") ? Response.json({ ...page, servers: [{ ...page.servers[0], server: { ...page.servers[0].server, name: "github" } }] }) : fixtureFetch(url) })
  const invalid = await broken.searchSources("github")
  expect(invalid.sources.at(-1)).toMatchObject({ status: "failed", reason: "format" })
  expect(invalid.candidates.some((entry) => entry.source === "mcp-registry")).toBe(false)
})

test("registry version changes fail capture without replacing the selected identity", async () => {
  const detail = await Bun.file(join(fixtureRoot, "registry/github-registry-version.json")).json()
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => url.includes("/versions/") ? Response.json({ ...detail, server: { ...detail.server, version: "changed" } }) : fixtureFetch(url) })
  const result = await sources.searchSources("io.github.github/github-mcp-server")
  const candidate = result.candidates.find((entry) => entry.source === "mcp-registry")!
  expect(await sources.captureCandidate(candidate.id)).toMatchObject({ ok: false, code: "source-changed" })
  expect(candidate.upstream.version).toBe("2.1.0")
})

test("native-only npm exposes no runnable entry for the nothing-runnable result", async () => {
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: fixtureFetch })
  const result = await sources.searchSources("skills")
  expect(result.sources.map((source) => source.source)).toEqual(["catalog", "claude-marketplace", "codex-marketplace", "opencode-npm", "mcp-registry"])
  const candidate = result.candidates.find((entry) => entry.upstream.npm === npm.name)!
  expect(candidate).toMatchObject({ source: "opencode-npm", upstream: { npm: npm.name, version: npm.version } })
  const captured = await sources.captureCandidate(candidate.id)
  expect(captured.ok).toBe(true)
  if (!captured.ok) throw new Error(captured.code)
  const metadata = await Bun.file(join(fixtureRoot, "opencode/npm/metadata.json")).json()
  expect(captured.capture.source).toMatchObject({ kind: "npm", ecosystem: "opencode", version: npm.version, integrity: metadata.dist.integrity })
  const converted = await (await import("../shared/host-extension-package-contract/plugin-conversion.mjs")).convertPluginTree(captured.capture)
  expect(converted.package.entries).toEqual([])
  expect(converted.package.diagnostics.filter((diagnostic) => diagnostic.code === "native-js-plugin")).toMatchObject([{ path: "dist/index.js", sourceName: npm.name }])
  expect(converted.package.version).toBe(npm.version)
})

test("folder and pinned Git captures preserve equal OpenCode entries and original bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "helper-folder-"))
  try {
    const tree = opencode.trees.find((tree) => tree.root === "superpowers")!
    for (const file of tree.files) await cp(join(fixtureRoot, "opencode/superpowers", file.path), join(root, file.path), { recursive: true }).catch(async () => {
      const { mkdir } = await import("node:fs/promises")
      await mkdir(join(root, file.path, ".."), { recursive: true })
      await cp(join(fixtureRoot, "opencode/superpowers", file.path), join(root, file.path))
    })
    const before = await Promise.all(tree.files.map((file) => readFile(join(root, file.path))))
    const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: fixtureFetch })
    const folder = await sources.captureFolder(root)
    const git = await sources.captureGit(tree.repository, tree.commit)
    expect(git.source.commit).toBe(tree.commit)
    const convert = (await import("../shared/host-extension-package-contract/plugin-conversion.mjs")).convertPluginTree
    expect((await convert(folder)).package.entries).toEqual((await convert(git)).package.entries)
    expect((await convert(folder)).package.diagnostics).toEqual((await convert(git)).package.diagnostics)
    expect(folder.nodes.filter((node) => node.kind === "file")).toHaveLength(tree.files.length)
    expect(await Promise.all(tree.files.map((file) => readFile(join(root, file.path))))).toEqual(before)
    expect((await stat(root)).isDirectory()).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("npm integrity mismatch is source-unreachable and failed queries retry", async () => {
  let attempts = 0
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => {
    if (url.includes("/-/v1/search?") && ++attempts === 1) return new Response("unavailable", { status: 503 })
    if (url === npm.tarballUrl) {
      const bytes = await Bun.file(join(fixtureRoot, "opencode/npm/package.tgz")).bytes()
      bytes[100] = bytes[100]! ^ 1
      return new Response(bytes)
    }
    return fixtureFetch(url)
  } })
  expect((await sources.searchSources("skills")).sources.find((source) => source.source === "opencode-npm")).toMatchObject({ status: "failed", reason: "http" })
  const result = await sources.searchSources("skills")
  const candidate = result.candidates.find((entry) => entry.upstream.npm === npm.name)!
  expect(await sources.captureCandidate(candidate.id)).toMatchObject({ ok: false, code: "source-unreachable" })
  expect(attempts).toBe(2)
})

test("an npm rate-limit answer mid-pagination is waited out, not reported as the source being unavailable", async () => {
  // Recorded 2026-11-19 by replaying the app's paging for "Excel keywords:opencode-plugin" (total 3307 ⇒ 14 pages of 250):
  // registry.npmjs.org answered page 12 with Cloudflare's rate limit — HTTP 429, `retry-after: 0`, text/plain "error code: 1015".
  // The source then showed 「来源服务暂时不可用」 for every OpenCode result.
  let searches = 0
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => {
    if (url.includes("/-/v1/search?") && ++searches === 1)
      return new Response("error code: 1015", { status: 429, headers: { "retry-after": "0", "content-type": "text/plain; charset=UTF-8" } })
    return fixtureFetch(url)
  } })
  const result = await sources.searchSources("skills")
  expect(result.sources.find((source) => source.source === "opencode-npm")).toMatchObject({ status: "ok" })
  expect(result.candidates.some((entry) => entry.upstream.npm === npm.name)).toBe(true)
  expect(searches).toBe(2)
})

test("signed GitHub package and external definition supply the catalog identity and version", async () => {
  const bytes = await Bun.file(join(fixtureRoot, "catalog/catalog.json")).bytes()
  const signature = Buffer.from((await Bun.file(join(fixtureRoot, "catalog/catalog.json.sig")).text()).trim(), "base64")
  const key = createPublicKey({ key: Buffer.from("MCowBQYDK2VwAyEAqBBmG0mbZ3tZF7Vt8VEWhgm1RQdF2boFU5uUTSmsgHI=", "base64"), format: "der", type: "spki" })
  expect(verify(null, bytes, key, signature)).toBe(true)
  expect(formalCandidates().find((entry) => entry.id === "package:github")).toMatchObject({ name: "github", upstream: { version: "1.0.1" } })
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => formalCandidates(), catalogPackage: formalPackage, fetch: fixtureFetch })
  const result = await sources.searchSources("github")
  const candidate = result.candidates.find((entry) => entry.source === "claude-marketplace")!
  expect(candidate.sameAs).toBe("package:github")
  const converted = await sources.convertCandidate(candidate.id)
  expect(converted.ok).toBe(true)
  if (!converted.ok) throw new Error(converted.code)
  const comparison = (await sources.catalogComparisons("github")).find((row) => row.catalogId === "package:github")!
  expect(comparison).toMatchObject({ packageId: "package:github", version: "1.0.1", runtimeIdentity: converted.runtimeIdentity })
})

test("equal converted GitHub definitions fold to catalog while readonly headers stay distinct", async () => {
  // Same-name controlled view of the two real catalog definitions isolates their header-set difference.
  const rows = formalCandidates().map((row) => ({ ...row, name: "github" }))
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => rows, catalogPackage: formalPackage, fetch: fixtureFetch })
  const result = await sources.searchSources("github")
  expect(result.candidates.filter((entry) => entry.source === "catalog")).toHaveLength(2)
  const comparisons = await sources.catalogComparisons("github")
  expect(comparisons).toHaveLength(2)
  expect(comparisons[0]!.runtimeIdentity).not.toBe(comparisons[1]!.runtimeIdentity)
  expect(result.candidates.find((entry) => entry.source === "claude-marketplace")?.sameAs).toBe("package:github")
})

test("same name with changed runtime definition remains separate", async () => {
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => formalCandidates(), catalogPackage: formalPackage, fetch: async (url) => {
    if (!url.includes("codeload.github.com/anthropics")) return fixtureFetch(url)
    // Change only the real GitHub URL inside the recorded archive, rebuilding the same real tar members.
    const { captureFixture } = await import("../../test-fixtures/plugin-helper/fixture")
    const source = await captureFixture("external_plugins/github")
    const text = new TextDecoder().decode(await source.readFile(".mcp.json"))
    const bytes = new Uint8Array(gunzipSync(await archive()))
    const original = new TextEncoder().encode(text)
    const replacement = new TextEncoder().encode(text.replace("api.githubcopilot.com", "api.otherprovider.com"))
    expect(replacement.length).toBe(original.length)
    const offset = Buffer.from(bytes).indexOf(original)
    expect(offset).toBeGreaterThan(0)
    bytes.set(replacement, offset)
    return new Response(gzipSync(bytes))
  } })
  const result = await sources.searchSources("github")
  expect(result.candidates.find((entry) => entry.source === "claude-marketplace")?.sameAs).toBeUndefined()
})

test("search comparison and later capture reuse pinned bytes and normalized definitions", async () => {
  const requests: string[] = []
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => formalCandidates(), catalogPackage: formalPackage, fetch: async (url) => { requests.push(url); return fixtureFetch(url) } })
  const first = await sources.searchSources("github")
  const candidate = first.candidates.find((entry) => entry.source === "claude-marketplace")!
  const one = await sources.convertCandidate(candidate.id)
  const two = await sources.convertCandidate(candidate.id)
  expect(one.ok && two.ok && one.package === two.package).toBe(true)
  expect(requests.filter((url) => url.includes("codeload.github.com/anthropics"))).toHaveLength(1)
  expect((await sources.searchSources("github")).candidates.find((entry) => entry.id === candidate.id)?.sameAs).toBe("package:github")
})

test("recorded source misses preserve catalog Claude Codex OpenCode order", async () => {
  const claude = JSON.parse(await marketplace())
  const codexIndex = await Bun.file(join(fixtureRoot, "codex/.agents/plugins/marketplace.json")).json()
  const npmPage = await Bun.file(join(fixtureRoot, "opencode/npm/search.json")).json()
  for (const level of [0, 1, 2, 3]) {
    const sources = (await sourcesModule()).createPluginSources({ catalog: async () => level === 0 ? formalCandidates() : [], fetch: async (url) => {
      if (url.includes("raw.githubusercontent.com/anthropics")) return Response.json({ ...claude, plugins: level <= 1 ? claude.plugins : [] })
      if (url.includes("raw.githubusercontent.com/openai")) return Response.json({ ...codexIndex, plugins: level <= 2 ? codexIndex.plugins : [] })
      if (url.includes("/-/v1/search?")) return Response.json({ ...npmPage, total: npmPage.objects.length })
      return fixtureFetch(url)
    } })
    const result = await sources.searchSources("")
    expect(result.sources.map((source) => source.source)).toEqual(["catalog", "claude-marketplace", "codex-marketplace", "opencode-npm", "mcp-registry"])
    expect(result.candidates[0]!.source).toBe(["catalog", "claude-marketplace", "codex-marketplace", "opencode-npm"][level]!)
    expect(result.sources.every((source) => source.status === "ok")).toBe(true)
  }
})

test("runtime identity includes every MCP and skill while stdio package versions are ignored", async () => {
  const { captureFixture } = await import("../../test-fixtures/plugin-helper/fixture")
  const { convertPluginTree } = await import("../shared/host-extension-package-contract/plugin-conversion.mjs")
  const source = (await convertPluginTree(await captureFixture("external_plugins/playwright"))).package
  const identity = (await sourcesModule()).pluginRuntimeIdentity
  const mcp = source.entries.find((entry) => entry.kind === "mcp" && entry.transport === "stdio")!
  expect(identity({ ...source, name: source.name.toUpperCase(), entries: [{ ...mcp, kind: "mcp", transport: "stdio", command: [["npx"], ["-y"], ["@playwright/mcp@0.0.85"]], environment: {} }] })).toBe(identity(source))
  const skill = (await convertPluginTree(await captureFixture("plugins/frontend-design"))).package.entries[0]!
  expect(identity({ ...source, entries: [...source.entries, skill] })).not.toBe(identity(source))
  expect(identity({ ...source, entries: [] })).toBeUndefined()
})

test("a real npm tree keeps OpenCode discovery when presented as a local folder", async () => {
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: fixtureFetch })
  const result = await sources.searchSources("skills")
  const candidate = result.candidates.find((entry) => entry.upstream.npm === npm.name)!
  const captured = await sources.captureCandidate(candidate.id)
  if (!captured.ok) throw new Error(captured.code)
  const convert = (await import("../shared/host-extension-package-contract/plugin-conversion.mjs")).convertPluginTree
  const original = await convert(captured.capture)
  const folder = await convert({ ...captured.capture, source: { kind: "folder", locator: "recorded-npm-tree" } })
  expect(folder.package.provider).toBe("opencode")
  expect(folder.package.diagnostics).toEqual(original.package.diagnostics)
  expect(folder.package.entries).toEqual(original.package.entries)
})

test("D3 creation eligibility requires a recorded success for every source, not just every returned row", async () => {
  const { allPluginSourcesSucceeded, PLUGIN_SOURCE_ORDER, createPluginSources } = await import("./plugin-sources")
  const { fixtureFetch } = await import("../../test-fixtures/plugin-helper/source-fetch")
  const sources = createPluginSources({ catalog: async () => [], fetch: fixtureFetch })
  expect(sources.searchedSources("unknown")).toBeUndefined()
  const result = await sources.searchSources("frontend-design")
  const recorded = sources.searchedSources(result.searchId)!
  expect(allPluginSourcesSucceeded(recorded)).toBe(true)
  for (const source of PLUGIN_SOURCE_ORDER) expect(allPluginSourcesSucceeded(recorded.filter((item) => item.source !== source))).toBe(false)
  expect(allPluginSourcesSucceeded([])).toBe(false)
  expect(allPluginSourcesSucceeded(undefined)).toBe(false)
  result.sources.splice(0)
  expect(allPluginSourcesSucceeded(sources.searchedSources(result.searchId))).toBe(true)
  const failed = createPluginSources({ catalog: async () => [], fetch: (url) => url.startsWith("https://registry.modelcontextprotocol.io/") ? Promise.reject(Error("controlled network failure")) : fixtureFetch(url) })
  const failure = await failed.searchSources("frontend-design")
  expect(failure.sources.find((item) => item.source === "mcp-registry")).toMatchObject({ status: "failed", reason: "network" })
  expect(allPluginSourcesSucceeded(failed.searchedSources(failure.searchId))).toBe(false)
})

test("BC5 pinned OpenCode npm and Git trees contain real skills and never require executing native JS for conversion",async()=>{
 const {entrypointsFetch,verifyEntrySamples,provenance}=await import("../../test-fixtures/plugin-helper/entrypoints/fixture")
 await verifyEntrySamples()
 const sources=(await sourcesModule()).createPluginSources({catalog:async()=>[],fetch:entrypointsFetch})
 const found=await sources.searchSources(provenance.opencode.name)
 const candidate=found.candidates.find(candidate=>candidate.source==="opencode-npm")!
 expect(candidate.upstream.version).toBe("3.0.6")
 const converted=await sources.convertCandidate(candidate.id)
 expect(converted.ok).toBe(true)
 if(!converted.ok)throw Error(converted.detail)
 expect(converted.package).toMatchObject({provider:"opencode",name:"@unfrgivn/opencode-config",version:"3.0.6"})
 expect(converted.package.entries.filter(entry=>entry.kind==="skill")).toHaveLength(37)
 expect(converted.package.diagnostics).toMatchObject([{code:"native-js-plugin",path:"dist/index.js"}])
 const git=await sources.captureGit(provenance.opencode.repository,provenance.opencode.commit)
 const prepared=await sources.prepareCapture(git)
 if(prepared.kind!=="package")throw Error("real repository unexpectedly became a marketplace")
 const fromGit=await sources.convertCandidate(prepared.candidateId)
 expect(fromGit.ok&&fromGit.package).toMatchObject({provider:"opencode",name:provenance.opencode.name,version:provenance.opencode.version})
 expect(git.source.commit).toBe(provenance.opencode.commit)
})

test("BC5 real Figma plugin and official-MCP query records keep their distinct targets and verified definitions",async()=>{
 const {entrypointsFetch,provenance}=await import("../../test-fixtures/plugin-helper/entrypoints/fixture")
 // A catalog addition changes the premise rather than silently changing this query proof.
 expect(JSON.stringify(catalog).toLowerCase()).not.toContain("figma")
 const sources=(await sourcesModule()).createPluginSources({catalog:async()=>[],fetch:entrypointsFetch})
 const plugin=await sources.searchSources(provenance.figma.queries[0]!)
 expect(plugin.sources.map(source=>source.source)).toEqual(["catalog","claude-marketplace","codex-marketplace","opencode-npm","mcp-registry"])
 expect(plugin.sources.every(source=>source.status==="ok")).toBe(true)
 expect(plugin.candidates[0]).toMatchObject({source:"claude-marketplace",name:"figma"})
 const first=await sources.convertCandidate(plugin.candidates[0]!.id)
 expect(first.ok).toBe(true)
 if(!first.ok)throw Error(first.detail)
 expect(first.capture.source.commit).toBe(provenance.figma.pluginCommit)
 expect(first.package.entries.filter(entry=>entry.kind==="skill")).toHaveLength(16)
 expect(first.package.entries.some(entry=>entry.kind==="mcp")).toBe(true)
 const official=await sources.searchSources(provenance.figma.queries[1]!)
 expect(official.candidates).toHaveLength(1)
 expect(official.candidates[0]).toMatchObject({source:"mcp-registry",name:"com.figma.mcp/mcp",publisher:{kind:"domain",domain:"figma.com"}})
 const definition=await sources.convertCandidate(official.candidates[0]!.id)
 expect(definition.ok).toBe(true)
 if(!definition.ok)throw Error(definition.detail)
 expect(definition.package.entries).toMatchObject([{kind:"mcp",transport:"http",url:["https://mcp.figma.com/mcp"]}])
 expect(definition.package.source).toMatchObject({serverName:"com.figma.mcp/mcp",version:"1.0.3"})
})


test("R12 A1 B5 a stalled fetch aborts only its source and leaves catalog and other sources available", async () => {
 const {jest}=await import("bun:test")
 const {createPluginSources}=await sourcesModule()
 const {fixtureFetch}=await import("../../test-fixtures/plugin-helper/source-fetch")
 let release!: (response:Response)=>void
 let signal:AbortSignal|undefined
 const completed:Promise<Response>[]=[]
 const stalled=new Promise<Response>(resolve=>{release=resolve})
 const sources=createPluginSources({catalog:async()=>[],fetch:(url,init?:RequestInit)=>{
  if(url.includes("raw.githubusercontent.com/openai")){signal=init?.signal??undefined;return stalled}
  const request=fixtureFetch(url);completed.push(request);return request
 }})
 jest.useFakeTimers()
 let result:Awaited<ReturnType<typeof sources.searchSources>>|undefined
 const pending=sources.searchSources("__no_entry__").then(value=>{result=value;return value})
 try {
  // §4.7:清单先问转发入口(夹具回 404)再取原地址 —— 等到没有新请求为止。
  for(let seen=-1;seen!==completed.length;){seen=completed.length;await Promise.all(completed);for(let i=0;i<20;i++)await Promise.resolve()}
  jest.advanceTimersByTime(600_001)
  for(let i=0;i<40;i++)await Promise.resolve()
  expect(result).toBeDefined()
  expect(signal?.aborted).toBe(true)
  expect(result!.sources.find(source=>source.source==="codex-marketplace")).toMatchObject({status:"failed",reason:"network"})
  expect(result!.sources.filter(source=>source.source!=="codex-marketplace").every(source=>source.status==="ok")).toBe(true)
 }finally{release(await fixtureFetch("https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json"));await pending;jest.useRealTimers()}
})

test("R12 B5 a whole source deadline also bounds a hung catalog callback", async()=>{
 const {jest}=await import("bun:test")
 const {createPluginSources}=await sourcesModule()
 const {fixtureFetch}=await import("../../test-fixtures/plugin-helper/source-fetch")
 let release!: (value:[])=>void
 const completed:Promise<Response>[]=[]
 const sources=createPluginSources({catalog:()=>new Promise(resolve=>{release=resolve}),fetch:url=>{const request=fixtureFetch(url);completed.push(request);return request}})
 jest.useFakeTimers()
 let result:Awaited<ReturnType<typeof sources.searchSources>>|undefined
 const pending=sources.searchSources("__no_entry__").then(value=>{result=value;return value})
 try{
  // §4.7:清单先问转发入口(夹具回 404)再取原地址 —— 第二批请求在第一批落定后才发出,所以等到没有新请求为止。
  for(let seen=-1;seen!==completed.length;){seen=completed.length;await Promise.all(completed);for(let i=0;i<20;i++)await Promise.resolve()}
  jest.advanceTimersByTime(900_001)
  for(let i=0;i<40;i++)await Promise.resolve()
  expect(result?.sources.find(source=>source.source==="catalog")).toMatchObject({status:"failed",reason:"network"})
  expect(result!.sources.filter(source=>source.source!=="catalog").every(source=>source.status==="ok")).toBe(true)
 }finally{release([]);await pending;jest.useRealTimers()}
})

test("R12 B5 archive comparison timeout reports that source failed without hiding the catalog candidate", async()=>{
 const {jest}=await import("bun:test")
 const {createPluginSources}=await sourcesModule()
 const {fixtureFetch}=await import("../../test-fixtures/plugin-helper/source-fetch")
 const entry=catalog.entries.find(entry=>entry.id==="mcp:playwright")!
 let release!: (value:Response)=>void
 let entered!:()=>void
 const capturing=new Promise<void>(resolve=>{entered=resolve})
 const stalled=new Promise<Response>(resolve=>{release=resolve})
 const archive="https://codeload.github.com/anthropics/claude-plugins-official/tar.gz/refs/heads/main"
 const sources=createPluginSources({catalog:async()=>[{id:entry.id,source:"catalog",name:entry.name,displayName:entry.displayName,description:entry.description,kind:"mcp",upstream:{version:entry.version}}],fetch:url=>{if(url===archive){entered();return stalled}return fixtureFetch(url)}})
 jest.useFakeTimers()
 let result:Awaited<ReturnType<typeof sources.searchSources>>|undefined
 const pending=sources.searchSources("playwright").then(value=>{result=value;return value})
 try{
  await capturing
  jest.advanceTimersByTime(600_001)
  for(let i=0;i<50;i++)await Promise.resolve()
  expect(result?.sources.find(source=>source.source==="claude-marketplace")).toMatchObject({status:"failed",reason:"network"})
  expect(result!.candidates.some(candidate=>candidate.id===entry.id)).toBe(true)
 }finally{release(await fixtureFetch(archive));await pending;jest.useRealTimers()}
})

// These controlled transport/resource variants keep the recorded marketplace and tar bytes.
for(const declared of [true,false]) test("R12 A2 "+(declared?"declared":"streamed")+" oversized archive fails only its source before buffering it whole",async()=>{
 const {createPluginSources}=await sourcesModule()
 const {fixtureFetch}=await import("../../test-fixtures/plugin-helper/source-fetch")
 const archive="https://codeload.github.com/anthropics/claude-plugins-official/tar.gz/refs/heads/main"
 const prefix=new Uint8Array(await (await fixtureFetch(archive)).arrayBuffer())
 const entry=catalog.entries.find(entry=>entry.id==="mcp:playwright")!
 let canceled=false,parts=0
 const padding=new Uint8Array(1024*1024)
 const sources=createPluginSources({catalog:async()=>[{id:entry.id,source:"catalog",name:entry.name,displayName:entry.displayName,description:entry.description,kind:"mcp",upstream:{version:entry.version}}],fetch:url=>url===archive?Promise.resolve(new Response(new ReadableStream<Uint8Array>({
  pull(controller){parts++;if(parts===1){controller.enqueue(prefix);return}if(!declared&&parts<=130){controller.enqueue(padding);return}controller.close()},
  cancel(){canceled=true},
 }),{headers:declared?{"content-length":String(128*1024*1024+1)}:{}})):fixtureFetch(url)})
 const result=await sources.searchSources("playwright")
 expect(result.sources.find(source=>source.source==="claude-marketplace")).toMatchObject({status:"failed",reason:"format"})
 expect(canceled).toBe(true)
 expect(result.candidates.some(candidate=>candidate.id===entry.id)).toBe(true)
 if(declared)expect(parts).toBeLessThan(3)
})

test("R12 A2 async gunzip receives a large real-plugin ceiling and propagates native overflow as a source failure",async()=>{
 const {spyOn}=await import("bun:test")
 const zlib=await import("node:zlib")
 const original=zlib.gunzip
 const bounds:number[]=[]
 const unzip=spyOn(zlib,"gunzip").mockImplementation((bytes,options,callback)=>{
  bounds.push(options.maxOutputLength)
  // Lower only the native test boundary; gzip/tar/marketplace bytes remain the pinned sample.
  return original(bytes,{...options,maxOutputLength:16*1024},callback)
 })
 try{
  const {createPluginSources}=await sourcesModule()
  const {fixtureFetch}=await import("../../test-fixtures/plugin-helper/source-fetch")
  const entry=catalog.entries.find(entry=>entry.id==="mcp:playwright")!
  const sources=createPluginSources({catalog:async()=>[{id:entry.id,source:"catalog",name:entry.name,displayName:entry.displayName,description:entry.description,kind:"mcp",upstream:{version:entry.version}}],fetch:fixtureFetch})
  const result=await sources.searchSources("playwright")
  expect(bounds).toEqual([512*1024*1024])
  expect(result.sources.find(source=>source.source==="claude-marketplace")).toMatchObject({status:"failed",reason:"format"})
  expect(result.candidates.some(candidate=>candidate.id===entry.id)).toBe(true)
 }finally{unzip.mockRestore()}
})

test("R12 A3 re-search discards the stale marketplace index and main archive after source-changed",async()=>{
 const {fixtureFetch}=await import("../../test-fixtures/plugin-helper/source-fetch")
 const {createPluginSources}=await sourcesModule()
 let indexes=0,archives=0
 const sources=createPluginSources({catalog:async()=>[],fetch:async url=>{
  if(url==="https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json"){
   indexes++
   if(indexes===1){const index=await (await fixtureFetch(url)).json();const entry=index.plugins.find((entry:{name:string})=>entry.name==="playwright");entry.description+=" controlled stale index";return Response.json(index)}
  }
  if(url==="https://codeload.github.com/anthropics/claude-plugins-official/tar.gz/refs/heads/main")archives++
  return fixtureFetch(url)
 }})
 const first=(await sources.searchSources("playwright")).candidates.find(candidate=>candidate.source==="claude-marketplace")!
 expect(await sources.captureCandidate(first.id)).toMatchObject({ok:false,code:"source-changed"})
 const next=(await sources.searchSources("playwright")).candidates.find(candidate=>candidate.source==="claude-marketplace")!
 expect(await sources.captureCandidate(next.id)).toMatchObject({ok:true})
 expect(indexes).toBe(2)
 expect(archives).toBe(2)
})

test("R14 search publishes responsive sources before a hung index and finishes within thirty seconds", async () => {
 const {jest}=await import("bun:test")
 const {createPluginSources}=await sourcesModule()
 const {fixtureFetch}=await import("../../test-fixtures/plugin-helper/source-fetch")
 let release!: (response:Response)=>void
 const stalled=new Promise<Response>(resolve=>{release=resolve})
 const requested:Promise<Response>[]=[]
 const sources=createPluginSources({catalog:async()=>[],fetch:(url)=>{
  if(url.includes("raw.githubusercontent.com/openai"))return stalled
  const response=fixtureFetch(url);requested.push(response);return response
 }})
 const progress:import("./plugin-sources").SourceSearchResultV1[]=[]
 let answer:import("./plugin-sources").SourceSearchResultV1|undefined
 jest.useFakeTimers()
 const pending=sources.searchSources("context7",partial=>progress.push(structuredClone(partial))).then(value=>{answer=value})
 try{
  // §4.7:清单先问转发入口(夹具回 404)再取原地址 —— 等到没有新请求为止。
  for(let seen=-1;seen!==requested.length;){seen=requested.length;await Promise.all(requested);for(let n=0;n<60;n++)await Promise.resolve()}
  expect(progress.some(result=>result.candidates.some(candidate=>candidate.name==="context7"))).toBe(true)
  expect(answer).toBeUndefined()
  jest.advanceTimersByTime(30_000)
  for(let n=0;n<60;n++)await Promise.resolve()
  expect(answer).toBeDefined()
  expect(answer!.sources.find(source=>source.source==="codex-marketplace")).toMatchObject({status:"failed",reason:"network"})
  expect(answer!.candidates.some(candidate=>candidate.name==="context7")).toBe(true)
 }finally{release(await fixtureFetch("https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json"));await pending;jest.useRealTimers()}
})

test("R14 selecting a candidate keeps the generous capture budget after the search phase", async () => {
 const {jest}=await import("bun:test")
 const {createPluginSources}=await sourcesModule()
 const {fixtureFetch}=await import("../../test-fixtures/plugin-helper/source-fetch")
 const archive="https://codeload.github.com/anthropics/claude-plugins-official/tar.gz/refs/heads/main"
 let release!: (response:Response)=>void
 const stalled=new Promise<Response>(resolve=>{release=resolve})
 const sources=createPluginSources({catalog:async()=>[],fetch:url=>url===archive?stalled:fixtureFetch(url)})
 const candidate=(await sources.searchSources("context7")).candidates.find(candidate=>candidate.source==="claude-marketplace")!
 let captured:Awaited<ReturnType<typeof sources.captureCandidate>>|undefined
 jest.useFakeTimers()
 const pending=sources.captureCandidate(candidate.id).then(value=>{captured=value;return value})
 try{
  jest.advanceTimersByTime(60_000)
  for(let n=0;n<20;n++)await Promise.resolve()
  expect(captured).toBeUndefined()
  release(await fixtureFetch(archive))
  expect(await pending).toMatchObject({ok:true,capture:{source:{commit:fixtureCommit}}})
 }finally{release(await fixtureFetch(archive));await pending;jest.useRealTimers()}
})

for(const premise of ["without-search","after-failed-search"] as const)test("R14 A10 catalog identity lookup works "+premise,async()=>{
 let available=premise==="without-search"
 const sources=(await sourcesModule()).createPluginSources({catalog:async()=>{if(!available)throw Error("controlled catalog outage");return formalCandidates()},catalogPackage:formalPackage,fetch:fixtureFetch})
 if(!available){expect((await sources.searchSources("no-such-name")).sources.find(source=>source.source==="catalog")).toMatchObject({status:"failed"});available=true}
 expect(await sources.catalogComparisons("github")).toContainEqual(expect.objectContaining({catalogId:"package:github",version:"1.0.1",runtimeIdentity:expect.any(String)}))
})

test("R14 A10 install preparation reuses one catalog lookup inside its request while a new request reads current facts",async()=>{
 let reads=0
 let rows=formalCandidates()
 const sources=(await sourcesModule()).createPluginSources({catalog:async()=>{reads++;return rows},catalogPackage:formalPackage,fetch:fixtureFetch})
 const prepared=await sources.catalogComparisons("github","r14_install_one")
 expect(prepared).toHaveLength(1)
 rows=[]
 expect(await sources.catalogComparisons("github","r14_install_one")).toEqual(prepared)
 expect(reads).toBe(1)
 expect(await sources.catalogComparisons("github","r14_install_two")).toEqual([])
 expect(reads).toBe(2)
})

// DESIGN-domestic-cloud-connectivity §4.7(切片二)、§8 E-5:Claude、Codex 两份市场清单先经香港 GitHub 转发入口(§4.5 白名单最后两行),
// 转发那一次最多 10 s,任何失败都改取原 raw 地址;两次都失败才报该来源失败,SourceStatusV1 形状不变。转发入口的字节就是同一份清单,
// 所以桩把转发地址映射回录制好的 raw 字节;时间只经假时钟推进。
const RELAY_CLAUDE = "https://alpha-github-hk.tidelabs.click/raw/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json"
const RELAY_CODEX = "https://alpha-github-hk.tidelabs.click/raw/openai/plugins/main/.agents/plugins/marketplace.json"
const RAW_CLAUDE = "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json"
const RAW_CODEX = "https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json"
const relayToRaw = (address: string) => address === RELAY_CLAUDE ? RAW_CLAUDE : address === RELAY_CODEX ? RAW_CODEX : undefined
const flush = async (n = 40) => { for (let i = 0; i < n; i++) await Promise.resolve() }

test("§4.7 E-5 转发入口答清单:两个来源经转发成功,不请求原 raw 地址;五个来源都成功", async () => {
  const requested: string[] = []
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => catalogCandidates(), fetch: async (url) => {
    const address = String(url)
    requested.push(address)
    if (address.startsWith("https://raw.githubusercontent.com/")) throw new Error("original address must not be needed")
    const raw = relayToRaw(address)
    return fixtureFetch(raw ?? address)
  } })
  const result = await sources.searchSources("context7")
  expect(result.sources.find((source) => source.source === "claude-marketplace")).toMatchObject({ status: "ok", matched: 1 })
  expect(result.sources.find((source) => source.source === "codex-marketplace")).toMatchObject({ status: "ok" })
  expect((await sourcesModule()).allPluginSourcesSucceeded(result.sources)).toBe(true)
  expect(requested.filter((address) => address.startsWith("https://alpha-github-hk.tidelabs.click/")).sort()).toEqual([RELAY_CLAUDE, RELAY_CODEX])
  expect(requested.some((address) => address.startsWith("https://raw.githubusercontent.com/"))).toBe(false)
})

test("§4.7 E-5 转发入口不通(挂住):第 10 s 中止转发、改取原地址,来源成功", async () => {
  const { jest } = await import("bun:test")
  const requested: string[] = []
  const relaySignals: AbortSignal[] = []
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: (url, init?: RequestInit) => {
    const address = String(url)
    requested.push(address)
    if (relayToRaw(address)) {
      const signal = init!.signal!
      relaySignals.push(signal)
      return new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(new Error("relay aborted")), { once: true }))
    }
    return fixtureFetch(address)
  } })
  jest.useFakeTimers()
  try {
    const pending = sources.searchSources("context7")
    await flush()
    expect(requested.filter((address) => relayToRaw(address)).sort()).toEqual([RELAY_CLAUDE, RELAY_CODEX])
    jest.advanceTimersByTime(9_999)
    await flush()
    expect(requested.filter((address) => address.startsWith("https://raw.githubusercontent.com/"))).toEqual([])
    jest.advanceTimersByTime(1)
    await flush()
    expect(relaySignals.every((signal) => signal.aborted)).toBe(true)
    expect(requested.filter((address) => address.startsWith("https://raw.githubusercontent.com/")).sort()).toEqual([RAW_CLAUDE, RAW_CODEX])
    const result = await pending
    expect(result.sources.find((source) => source.source === "claude-marketplace")).toMatchObject({ status: "ok", matched: 1 })
    expect(result.sources.find((source) => source.source === "codex-marketplace")).toMatchObject({ status: "ok" })
  } finally {
    jest.useRealTimers()
  }
})

test("§4.7 E-5 转发回非 2xx、回读不出的内容、拒连:都立刻改取原地址,来源成功", async () => {
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => {
    const address = String(url)
    if (address === RELAY_CLAUDE) return new Response("<html>bad gateway</html>", { status: 502 })
    if (address === RELAY_CODEX) return new Response("not a marketplace")
    return fixtureFetch(address)
  } })
  const result = await sources.searchSources("context7")
  expect(result.sources.find((source) => source.source === "claude-marketplace")).toMatchObject({ status: "ok", matched: 1 })
  expect(result.sources.find((source) => source.source === "codex-marketplace")).toMatchObject({ status: "ok" })
  const refused = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => {
    if (relayToRaw(String(url))) throw new TypeError("fetch failed: ECONNREFUSED")
    return fixtureFetch(url)
  } })
  const second = await refused.searchSources("context7")
  expect(second.sources.find((source) => source.source === "claude-marketplace")).toMatchObject({ status: "ok", matched: 1 })
  expect(second.sources.find((source) => source.source === "codex-marketplace")).toMatchObject({ status: "ok" })
})

test("§4.7 转发与原地址都失败:报该来源失败,原因取原地址那次(形状不变)", async () => {
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => {
    const address = String(url)
    if (relayToRaw(address)) return new Response("bad gateway", { status: 502 })
    if (address === RAW_CLAUDE || address === RAW_CODEX) return new Response("unavailable", { status: 503 })
    return fixtureFetch(address)
  } })
  const result = await sources.searchSources("context7")
  expect(result.sources.find((source) => source.source === "claude-marketplace")).toEqual({ source: "claude-marketplace", status: "failed", reason: "http", detail: "Source returned HTTP 503" })
  expect(result.sources.find((source) => source.source === "codex-marketplace")).toEqual({ source: "codex-marketplace", status: "failed", reason: "http", detail: "Source returned HTTP 503" })
})

test("§4.7 转发入口回 429(GitHub 限流转发机)⇒ 不等 Retry-After,立刻改取原地址", async () => {
  const { jest } = await import("bun:test")
  const requested: string[] = []
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => {
    const address = String(url)
    requested.push(address)
    if (relayToRaw(address)) return new Response("rate limited", { status: 429, headers: { "retry-after": "5" } })
    return fixtureFetch(address)
  } })
  jest.useFakeTimers()
  try {
    const pending = sources.searchSources("context7")
    await flush(200)
    // 假时钟一刻未动:原地址已经请求,转发地址各只问过一次(没有按 Retry-After 再问)。
    expect(requested.filter((address) => address.startsWith("https://raw.githubusercontent.com/")).sort()).toEqual([RAW_CLAUDE, RAW_CODEX])
    expect(requested.filter((address) => relayToRaw(address)).sort()).toEqual([RELAY_CLAUDE, RELAY_CODEX])
    const result = await pending
    expect(result.sources.find((source) => source.source === "claude-marketplace")).toMatchObject({ status: "ok", matched: 1 })
    expect(result.sources.find((source) => source.source === "codex-marketplace")).toMatchObject({ status: "ok" })
  } finally {
    jest.useRealTimers()
  }
})


test("a real mixed plugin root exposes its marketplace without duplicating its listed root", async () => {
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [] })
  const capture = await captureStandardFixture("claude:codspeed")
  expect(capture.nodes.some(node => node.path.endsWith("marketplace.json"))).toBe(true)
  const prepared = await sources.prepareCapture({ ...capture, source: { ...capture.source, kind: "folder" } })
  expect(prepared.kind).toBe("marketplace")
  if (prepared.kind !== "marketplace") throw Error("Mixed root must expose the real market")
  expect(prepared.entries.map(entry => entry.displayName)).toEqual(["codspeed"])
  const converted = await sources.convertCandidate(prepared.entries[0]!.id)
  expect(converted.ok && converted.package.entries.some(entry => entry.kind === "mcp" && entry.sourceName === "CodSpeed")).toBe(true)
})

test("a mixed marketplace also exposes its unlisted root alongside selectable nested real plugins", async () => {
  const { captureFixture } = await import("../../test-fixtures/plugin-helper/fixture")
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [] })
  const root = await captureStandardFixture("claude:codspeed")
  const marketplace = JSON.parse(new TextDecoder().decode(await root.readFile(".claude-plugin/marketplace.json")))
  const nested = await captureFixture("plugins/frontend-design")
  // Controlled addition of the pinned real frontend-design tree to the real CodSpeed mixed repo shape.
  const files = Object.fromEntries(await Promise.all(nested.nodes.flatMap(node => node.kind === "file" ? [nested.readFile(node.path).then(bytes => ["nested/" + node.path, new TextDecoder().decode(bytes)])] : [])))
  const capture = await captureStandardFixture("claude:codspeed", { ...files, ".claude-plugin/marketplace.json": JSON.stringify({ ...marketplace, plugins: [{ ...marketplace.plugins[0], name: "frontend-design", source: "./nested" }] }) })
  const prepared = await sources.prepareCapture({ ...capture, source: { ...capture.source, kind: "folder" } })
  expect(prepared.kind).toBe("marketplace")
  if (prepared.kind !== "marketplace") throw Error("Mixed root must expose both choices")
  expect(prepared.entries.map(entry => entry.displayName)).toEqual(["frontend-design", "codspeed"])
  const converted = await Promise.all(prepared.entries.map(entry => sources.convertCandidate(entry.id)))
  expect(converted[0]!.ok && converted[0]!.package.entries.some(entry => entry.kind === "skill" && entry.sourceName === "frontend-design")).toBe(true)
  expect(converted[1]!.ok && converted[1]!.package.entries.some(entry => entry.kind === "mcp" && entry.sourceName === "CodSpeed")).toBe(true)
})

test("a connector version suggestion uses the real npm metadata and remains optional", async () => {
  const { suggestPluginVersion } = await import("./plugin-sources")
  const { captureStandardFixture } = await import("../../test-fixtures/plugin-helper/fixture")
  const { convertPluginTree } = await import("../shared/host-extension-package-contract/plugin-conversion.mjs")
  const converted = await convertPluginTree(await captureStandardFixture("codex:build-ios-apps"))
  const original = converted.package.entries.find(entry => entry.kind === "mcp")!
  if (original.kind !== "mcp" || original.transport !== "stdio") throw Error("XcodeBuildMCP is stdio")
  // Existing recorded npm /latest response, with provenance in opencode/npm/provenance.json.
  const metadata = await Bun.file(join(import.meta.dir, "../../test-fixtures/plugin-helper/opencode/npm/metadata.json")).json()
  const entry = { ...original, floatingVersion: { ...original.floatingVersion!, token: metadata.name + "@latest" } }
  const urls: string[] = []
  expect(await suggestPluginVersion(entry, async url => { urls.push(url); return Response.json(metadata) })).toBe(metadata.version)
  expect(urls).toEqual(["https://registry.npmjs.org/" + encodeURIComponent(metadata.name) + "/latest"])
  expect(await suggestPluginVersion(entry, async () => new Response("unavailable", { status: 503 }))).toBeUndefined()
})

test("link identity follows the printed path and top-level entries, not file contents", async () => {
  const sandbox = realpathSync.native(await mkdtemp(join(tmpdir(), "plugin-linked-")))
  const printed = join(sandbox, "linked-plugin-dev")
  cpSync(join(fixtureRoot, "standard", "claude-plugin-dev"), printed, { recursive: true })
  const source = { kind: "marketplace" as const, locator: printed, ecosystem: "claude" as const, entryName: "xcode" }
  const { captureLinkedDirectory } = await sourcesModule()
  // Unguarded reads: this case is about identity; credential-store guarding has its own cases below.
  const files = { listable: () => true, readFile: (path: string) => new Uint8Array(readFileSync(path)) }
  const first = await captureLinkedDirectory(printed, source, files)
  expect(first.topLevel.map(node => node.path)).toEqual([".claude-plugin", "LICENSE", "README.md", "agents", "commands", "skills"])
  appendFileSync(join(printed, "skills/hook-development/scripts/hook-linter.sh"), "\n# changed in place\n")
  writeFileSync(join(printed, "README.md"), "rewritten")
  expect((await captureLinkedDirectory(printed, source, files)).bindingId).toBe(first.bindingId)
  writeFileSync(join(printed, "NOTICE"), "new top-level entry")
  expect((await captureLinkedDirectory(printed, source, files)).bindingId).not.toBe(first.bindingId)
  rmSync(join(printed, "NOTICE"))
  const moved = join(sandbox, "linked-plugin-dev-elsewhere")
  cpSync(printed, moved, { recursive: true })
  expect((await captureLinkedDirectory(moved, { ...source, locator: moved }, files)).bindingId).not.toBe(first.bindingId)
  await expect(first.readFile("../outside")).rejects.toThrow("outside the plugin directory")
  await rm(sandbox, { recursive: true, force: true })
})

/** A printed plugin-dev copy (claude-plugins-official@0fbfda5a) behind the recorded xcode entry with only its command replaced. */
async function linkedCommandSource(prepare: (printed: string, sandbox: string) => void) {
  const { configureCommandSourceFence, locateCommandSource } = await import("./plugin-command-source")
  const { locatedFiles } = await import("./plugin-command-fence")
  const sandbox = realpathSync.native(await mkdtemp(join(tmpdir(), "plugin-linked-source-")))
  const store = join(sandbox, "credentials", "store.json")
  mkdirSync(join(sandbox, "credentials"))
  // A stored credential shaped like a skill, so reading it would surface in a skill instruction.
  writeFileSync(store, "---\nname: leaked-credential\ndescription: leaked\n---\ncredential-canary\n")
  configureCommandSourceFence({ egressProxyPort: 47125, configFence: [], credentialStores: [{ kind: "literal", path: store }] })
  const printed = join(sandbox, "printed")
  cpSync(join(fixtureRoot, "standard", "claude-plugin-dev"), printed, { recursive: true })
  prepare(printed, sandbox)
  const document = JSON.parse(await marketplace()) as { plugins: { name: string; source: Record<string, unknown> }[] }
  const xcode = document.plugins.find(entry => entry.name === "xcode")!
  mkdirSync(join(sandbox, "market", ".claude-plugin"), { recursive: true })
  writeFileSync(join(sandbox, "market", ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "recorded", plugins: [{ ...xcode, source: { ...xcode.source, command: `printf '%s\\n' '${printed}'` } }] }))
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], locateCommand: locateCommandSource, locatedFiles })
  const prepared = await sources.prepareCapture(await sources.captureFolder(join(sandbox, "market")))
  if (prepared.kind !== "marketplace") throw Error("expected marketplace entries")
  const converted = await sources.convertCandidate(prepared.entries[0]!.id)
  await rm(sandbox, { recursive: true, force: true })
  if (!converted.ok) throw Error(converted.detail)
  return { store, converted }
}

test("a linked definition that resolves into a credential store is never read by main", async () => {
  // The fenced locator can plant links; main reads definitions unfenced, so a link into C1 must be a read failure.
  const { converted } = await linkedCommandSource((printed, sandbox) => symlinkSync(join(sandbox, "credentials", "store.json"), join(printed, "SKILL.md")))
  expect(JSON.stringify(converted.package).includes("credential-canary")).toBe(false)
  expect(converted.package.entries.some(entry => entry.sourceName === "leaked-credential")).toBe(false)
  expect(converted.package.entries.filter(entry => entry.kind === "skill")).toHaveLength(7)
})

test("a linked plugin follows a top-level component directory that links elsewhere", async () => {
  // Xcode may link component directories into its own bundle; the stand-in is a sibling directory outside the printed one.
  const { converted } = await linkedCommandSource((printed, sandbox) => {
    renameSync(join(printed, "skills"), join(sandbox, "bundle-skills"))
    symlinkSync(join(sandbox, "bundle-skills"), join(printed, "skills"))
  })
  expect(converted.package.entries.filter(entry => entry.kind === "skill").map(entry => entry.sourcePath).toSorted()).toEqual([
    "skills/agent-development/SKILL.md", "skills/command-development/SKILL.md", "skills/hook-development/SKILL.md", "skills/mcp-integration/SKILL.md",
    "skills/plugin-settings/SKILL.md", "skills/plugin-structure/SKILL.md", "skills/skill-development/SKILL.md",
  ])
})
