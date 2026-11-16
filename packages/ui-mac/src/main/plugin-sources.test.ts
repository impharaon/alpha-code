import { expect, test } from "bun:test"
import { gunzipSync, gzipSync } from "node:zlib"
import { join } from "node:path"
import catalog from "../renderer/extensions/codepuppy-catalog.json"
import { fixtureCommit, fixtureRoot } from "../../test-fixtures/plugin-helper/fixture"

const sourcesModule = () => import("./plugin-sources")
const marketplace = () => Bun.file(join(fixtureRoot, ".claude-plugin/marketplace.json")).text()
const archive = () => Bun.file(join(fixtureRoot, "claude-selection.tar.gz")).arrayBuffer()
const catalogCandidates = () => catalog.entries.map((entry) => ({ id: entry.id, source: "catalog" as const, name: entry.name, displayName: entry.displayName, description: entry.description, kind: "plugin" as const, upstream: {} }))

async function fixtureFetch(url: string | URL | Request): Promise<Response> {
  const address = String(url)
  if (address === "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json") return new Response(await marketplace())
  if (address === "https://codeload.github.com/anthropics/claude-plugins-official/tar.gz/refs/heads/main") return new Response(await archive())
  throw new Error(`unexpected fixture URL: ${address}`)
}

test("catalog miss continues to the pinned Claude playwright entry", async () => {
  expect(catalog.entries.some((entry) => /playwright/i.test(`${entry.name} ${entry.displayName}`))).toBe(false)
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => catalogCandidates(), fetch: fixtureFetch })
  const result = await sources.searchSources("playwright")
  expect(result.sources).toMatchObject([{ source: "catalog", status: "ok", matched: 0 }, { source: "claude-marketplace", status: "ok", matched: 1 }])
  expect(result.candidates).toMatchObject([{ source: "claude-marketplace", name: "playwright", upstream: { repository: "https://github.com/anthropics/claude-plugins-official", path: "external_plugins/playwright" } }])
  expect(result.candidates[0]!.id).toMatch(/^cand_/)
  expect(result.searchId).not.toBe("")
  const captured = await sources.captureCandidate(result.candidates[0]!.id)
  expect(captured.ok).toBe(true)
  if (!captured.ok) throw new Error(captured.code)
  expect(captured.capture.source.commit).toBe(fixtureCommit)
  expect(captured.capture.nodes.map((node) => node.path).filter(Boolean).sort()).toEqual([".claude-plugin", ".claude-plugin/plugin.json", ".mcp.json"])
  expect(JSON.parse(new TextDecoder().decode(await captured.capture.readFile(".mcp.json")))).toEqual({ playwright: { command: "npx", args: ["@playwright/mcp@latest"] } })
})

test("catalog candidates precede marketplace candidates; names alone do not claim sameAs", async () => {
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => catalogCandidates(), fetch: fixtureFetch })
  const result = await sources.searchSources("github")
  expect(result.candidates[0]!.source).toBe("catalog")
  expect(result.candidates.some((candidate) => candidate.source === "claude-marketplace")).toBe(true)
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
  expect(requests).toHaveLength(2)
  expect(requests.every((url) => !url.includes("api.github.com"))).toBe(true)
})

test("failed sources are truthful and not cached as no results", async () => {
  let calls = 0
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async (url) => ++calls === 1 ? new Response("unavailable", { status: 503 }) : fixtureFetch(url) })
  const failed = await sources.searchSources("playwright")
  expect(failed.sources).toMatchObject([{ status: "ok" }, { source: "claude-marketplace", status: "failed", reason: "http" }])
  expect(failed.candidates).toEqual([])
  const retried = await sources.searchSources("playwright")
  expect(retried.candidates).toHaveLength(1)
  expect(calls).toBe(2)
})

test("invalid index is a format failure and unknown candidate cannot start a download", async () => {
  let requests = 0
  const sources = (await sourcesModule()).createPluginSources({ catalog: async () => [], fetch: async () => { requests++; return new Response("{not-json") } })
  expect(await sources.captureCandidate("cand_invented")).toMatchObject({ ok: false, code: "unknown-id" })
  expect(requests).toBe(0)
  expect((await sources.searchSources("playwright")).sources).toMatchObject([{ status: "ok" }, { status: "failed", reason: "format" }])
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
