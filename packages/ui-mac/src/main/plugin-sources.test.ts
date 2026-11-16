import { expect, test } from "bun:test"
import { mkdtemp, rm, cp, readFile, stat } from "node:fs/promises"
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
import { fixtureCommit, fixtureRoot } from "../../test-fixtures/plugin-helper/fixture"

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
  expect(requests).toHaveLength(5)
  expect(requests.every((url) => !url.includes("api.github.com"))).toBe(true)
})

test("failed sources are truthful and not cached as no results", async () => {
  let calls = 0
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => ++calls === 1 ? new Response("unavailable", { status: 503 }) : fixtureFetch(url) })
  const failed = await sources.searchSources("playwright")
  expect(failed.sources.slice(0, 2)).toMatchObject([{ status: "ok" }, { source: "claude-marketplace", status: "failed", reason: "http" }])
  expect(failed.candidates).toEqual([])
  const retried = await sources.searchSources("playwright")
  expect(retried.candidates).toHaveLength(1)
  expect(calls).toBe(5)
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

test("non-GitHub and command sources are counted but never minted as installable candidates", async () => {
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: fixtureFetch })
  const result = await sources.searchSources("xcode")
  expect(result.candidates.some((candidate) => candidate.name === "xcode")).toBe(false)
  expect(result.sources.find((source) => source.source === "claude-marketplace")).toMatchObject({ status: "ok", skipped: 1 })
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
    if (!url.includes("openai/plugins/main/")) return fixtureFetch(url)
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
  await Promise.all(completed)
  for(let i=0;i<20;i++)await Promise.resolve()
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
  await Promise.all(completed)
  for(let i=0;i<20;i++)await Promise.resolve()
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
