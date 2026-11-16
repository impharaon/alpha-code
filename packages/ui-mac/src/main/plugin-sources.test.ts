import { expect, test } from "bun:test"
import { mkdtemp, rm, cp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import opencode from "../../test-fixtures/plugin-helper/opencode/provenance.json"
import npm from "../../test-fixtures/plugin-helper/opencode/npm/provenance.json"
import { gunzipSync, gzipSync } from "node:zlib"
import { join } from "node:path"
import catalog from "../renderer/extensions/codepuppy-catalog.json"
import codex from "../../test-fixtures/plugin-helper/codex/provenance.json"
import { fixtureCommit, fixtureRoot } from "../../test-fixtures/plugin-helper/fixture"

const sourcesModule = () => import("./plugin-sources")
const marketplace = () => Bun.file(join(fixtureRoot, ".claude-plugin/marketplace.json")).text()
const archive = () => Bun.file(join(fixtureRoot, "claude-selection.tar.gz")).arrayBuffer()
const catalogCandidates = () => catalog.entries.map((entry) => ({ id: entry.id, source: "catalog" as const, name: entry.name, displayName: entry.displayName, description: entry.description, kind: "plugin" as const, upstream: {} }))

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
