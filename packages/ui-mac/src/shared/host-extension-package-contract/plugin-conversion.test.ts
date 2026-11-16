import { expect, test } from "bun:test"
import { join } from "node:path"
import { captureFixture, digest, fixtureRoot } from "../../../test-fixtures/plugin-helper/fixture"
import provenance from "../../../test-fixtures/plugin-helper/provenance.json"
import codex from "../../../test-fixtures/plugin-helper/codex/provenance.json"

const converter = () => import("./plugin-conversion")

test("pinned Codex marketplace preserves real local sources and provenance", async () => {
  for (const file of [...codex.files, { path: codex.archive.path, sha256: codex.archive.sha256 }])
    expect(digest(await Bun.file(join(fixtureRoot, "codex", file.path)).bytes())).toBe(`sha256:${file.sha256}`)
  const read = (await converter()).readMarketplace(await Bun.file(join(fixtureRoot, "codex/.agents/plugins/marketplace.json")).bytes(), "codex")
  expect(read.entries).toHaveLength(65)
  expect(read.entries.find((entry) => entry.name === "figma")).toMatchObject({ source: { kind: "path", path: "plugins/figma" }, category: "Creativity" })
  expect(read.diagnostics).toEqual([])
})

test("pinned Codex Figma keeps skill MCP and provider metadata", async () => {
  const captured = await captureFixture("plugins/figma", {}, "codex")
  const converted = await (await converter()).convertPluginTree(captured)
  expect(converted.package).toMatchObject({ provider: "codex", name: "figma", version: "2.0.20", source: { ecosystem: "codex", commit: codex.commit } })
  expect(converted.package.entries).toContainEqual(expect.objectContaining({ kind: "skill", sourceName: "figma-code-connect", sourcePath: "skills/figma-code-connect/SKILL.md" }))
  expect(converted.package.entries).toContainEqual(expect.objectContaining({ kind: "mcp", sourceName: "figma", transport: "http", url: ["https://mcp.figma.com/mcp"] }))
  expect(converted.package.diagnostics).toContainEqual(expect.objectContaining({ path: ".app.json", code: "unresolved-app-id" }))
  const published = await import("./plugin-conversion.mjs")
  expect((await published.convertPluginTree(captured)).package).toEqual(converted.package)
})

test("Codex root manifest and invocation controls reuse the same conversion", async () => {
  const original = await captureFixture("plugins/figma", {}, "codex")
  const manifest = new TextDecoder().decode(await original.readFile(".codex-plugin/plugin.json"))
  const skill = new TextDecoder().decode(await original.readFile("skills/figma-code-connect/SKILL.md"))
  // Relocate the real manifest and add the documented Codex invocation field to real frontmatter.
  const root = await captureFixture("plugins/figma", { ".codex-plugin/plugin.json": null, "plugin.json": manifest, "skills/figma-code-connect/SKILL.md": skill.replace("---\n", "---\nallow_implicit_invocation: false\n") }, "codex")
  const converted = await (await converter()).convertPluginTree(root)
  expect(converted.package).toMatchObject({ provider: "codex", name: "figma", version: "2.0.20" })
  expect(converted.package.entries.find((entry) => entry.kind === "skill")).toMatchObject({ invocation: { implicitInvocation: false } })
})

test("real app identifiers stay unresolved without inventing MCP", async () => {
  const converted = await (await converter()).convertPluginTree(await captureFixture("plugins/github", {}, "codex"))
  expect(converted.package.provider).toBe("codex")
  expect(converted.package.entries).toEqual([])
  expect(converted.package.diagnostics).toContainEqual(expect.objectContaining({ path: ".app.json", code: "unresolved-app-id" }))
  expect(converted.package.diagnostics).toContainEqual(expect.objectContaining({ path: ".mcp.json", code: "missing-entry" }))
})

test("real Codex Gmail OAuth snake-case fields and scopes remain typed and redacted", async () => {
  const converted = await (await converter()).convertPluginTree(await captureFixture("plugins/gmail", {}, "codex"))
  expect(converted.package.entries).toMatchObject([{ kind: "mcp", oauth: { oauth: { clientId: "<GMAIL_PUBLIC_CLIENT_ID>", clientSecret: [{ secret: expect.any(String) }], scopes: expect.arrayContaining(["https://mail.google.com/"]) } } }])
  expect(converted.package.secrets).toContainEqual(expect.objectContaining({ targets: [{ file: ".mcp.json", pointer: "/mcpServers/gmail/oauth/client_secret" }] }))
  expect(converted.replacements.get(".mcp.json")).toBeDefined()
})

test("real Codex Figma OAuth resource survives for the installer's applicability report", async () => {
  const converted = await (await converter()).convertPluginTree(await captureFixture("plugins/figma", {}, "codex"))
  expect(converted.package.entries.find((entry) => entry.kind === "mcp")).toMatchObject({ oauth: { oauth: { resource: "https://mcp.figma.com/mcp" } } })
})

test("recorded upstream bytes and reduced codeload archive match their provenance", async () => {
  for (const file of [...provenance.files, { path: provenance.archive.path, sha256: provenance.archive.sha256 }])
    expect(digest(new Uint8Array(await Bun.file(join(fixtureRoot, file.path)).arrayBuffer()))).toBe(`sha256:${file.sha256}`)
})

test("real Claude marketplace preserves path, pinned git-subdir and unsupported command sources", async () => {
  const read = (await converter()).readMarketplace(new Uint8Array(await Bun.file(join(fixtureRoot, ".claude-plugin/marketplace.json")).arrayBuffer()), "claude")
  expect(read.entries).toHaveLength(317)
  expect(read.entries.find((entry) => entry.name === "playwright")?.source).toEqual({ kind: "path", path: "external_plugins/playwright" })
  expect(read.entries.find((entry) => entry.name === "42crunch-api-security-testing")?.source).toEqual({ kind: "git", url: "https://github.com/42Crunch-AI/claude-plugins.git", commit: "faf5305385de8afed9468904e8639be737aff39e", ref: "v1.5.5", path: "plugins/api-security-testing" })
  expect(read.entries.find((entry) => entry.name === "xcode")?.source.kind).toBe("unsupported")
})

test("real bare-map playwright becomes one stdio MCP with its floating token", async () => {
  const converted = await (await converter()).convertPluginTree(await captureFixture("external_plugins/playwright"))
  expect(converted.package.name).toBe("playwright")
  expect(converted.package.provider).toBe("claude-code")
  expect(converted.package.entries).toMatchObject([{ kind: "mcp", sourceName: "playwright", sourcePath: ".mcp.json", transport: "stdio", command: [["npx"], ["@playwright/mcp@latest"]], environment: {}, floatingVersion: { commandIndex: 1, token: "@playwright/mcp@latest" } }])
  expect(converted.package.diagnostics).toEqual([])
})

test("real wrapped context7 remote preserves its URL and optional OAuth readiness", async () => {
  const converted = await (await converter()).convertPluginTree(await captureFixture("external_plugins/context7"))
  expect(converted.package.entries).toMatchObject([{ kind: "mcp", sourceName: "context7", transport: "http", url: ["https://mcp.context7.com/mcp?client=claude-code-plugin"], headers: {} }])
})

test("real frontend-design skill uses full frontmatter parsing and preserves instruction bytes", async () => {
  const captured = await captureFixture("plugins/frontend-design")
  const converted = await (await converter()).convertPluginTree(captured)
  const source = new TextDecoder().decode(await captured.readFile("skills/frontend-design/SKILL.md"))
  expect(converted.package.entries).toMatchObject([{ kind: "skill", sourceName: "frontend-design", directory: "skills/frontend-design", instruction: [source], invocation: { fork: false, userInvocable: true, implicitInvocation: true, allowedTools: [], deniedTools: [] }, mcpDependencies: [] }])
  expect(converted.package.tree).toEqual(captured.nodes)
  expect(converted.replacements.size).toBe(0)
})

test("manifestless root skill and manifest additional skills both discover real skill bytes", async () => {
  const original = await captureFixture("plugins/frontend-design")
  const skill = new TextDecoder().decode(await original.readFile("skills/frontend-design/SKILL.md"))
  const root = await captureFixture("plugins/frontend-design", { ".claude-plugin/plugin.json": null, "skills/frontend-design/SKILL.md": null, "SKILL.md": skill })
  expect((await (await converter()).convertPluginTree(root)).package.entries).toMatchObject([{ kind: "skill", directory: "", sourceName: "frontend-design" }])
  // Controlled variant: add an extra declared directory to the real manifest; default skills still participate.
  const manifest = JSON.parse(new TextDecoder().decode(await original.readFile(".claude-plugin/plugin.json")))
  const extra = await captureFixture("plugins/frontend-design", { ".claude-plugin/plugin.json": JSON.stringify({ ...manifest, skills: ["./extra"] }), "extra/second/SKILL.md": skill })
  expect((await (await converter()).convertPluginTree(extra)).package.entries.filter((entry) => entry.kind === "skill").map((entry) => entry.sourcePath).sort()).toEqual(["extra/second/SKILL.md", "skills/frontend-design/SKILL.md"])
})

test("skill invocation controls and structured MCP dependencies are preserved", async () => {
  const captured = await captureFixture("plugins/frontend-design")
  const source = new TextDecoder().decode(await captured.readFile("skills/frontend-design/SKILL.md"))
  // Controlled frontmatter variant of the recorded real skill, not a stand-in plugin format.
  const text = source.replace("---\n", "---\ndisable-model-invocation: true\nuser-invocable: false\ncontext: fork\nallowed-tools: [Read, 'mcp__github__*']\ndisallowed-tools: [Write]\ntools: [Read]\nmodel: sonnet\nargument-hint: '[task]'\ndependencies:\n  mcp: [github]\n")
  const converted = await (await converter()).convertPluginTree(await captureFixture("plugins/frontend-design", { "skills/frontend-design/SKILL.md": text }))
  expect(converted.package.entries).toMatchObject([{ kind: "skill", invocation: { fork: true, implicitInvocation: false, userInvocable: false, model: { alias: "sonnet" }, argumentHint: "[task]", allowedTools: [{ tool: "Read" }, { tool: "mcp__github__*" }], deniedTools: [{ tool: "Write" }], availableTools: [{ tool: "Read" }] }, mcpDependencies: ["github"] }])
})

test("real GitHub credential placeholder becomes a need and every public byte is redacted", async () => {
  const captured = await captureFixture("external_plugins/github")
  const converted = await (await converter()).convertPluginTree(captured)
  expect(converted.package.secrets).toMatchObject([{ componentId: converted.package.entries[0]!.id, label: "GITHUB_PERSONAL_ACCESS_TOKEN", targets: [{ file: ".mcp.json", pointer: "/github/headers/Authorization" }] }])
  const need = converted.package.secrets[0]!
  expect(converted.package.entries).toMatchObject([{ headers: { Authorization: ["Bearer ", { secret: need.id }] } }])
  expect(converted.privateCredentials.size).toBe(0)
  expect(new TextDecoder().decode(converted.replacements.get(".mcp.json"))).toContain(`{secret:${need.id}}`)
  // Controlled value substitution uses a non-credential marker. The source itself is unchanged.
  const source = new TextDecoder().decode(await captured.readFile(".mcp.json"))
  const secret = "fixture-value-not-a-real-credential"
  const literal = await (await converter()).convertPluginTree(await captureFixture("external_plugins/github", { ".mcp.json": source.replace("${GITHUB_PERSONAL_ACCESS_TOKEN}", secret) }))
  expect([...literal.privateCredentials.values()].map((value) => new TextDecoder().decode(value))).toContain(secret)
  expect(JSON.stringify(literal.package)).not.toContain(secret)
  expect([...literal.replacements.values()].every((bytes) => !new TextDecoder().decode(bytes).includes(secret))).toBe(true)
  expect(literal.package.tree.find((node) => node.path === ".mcp.json")).toMatchObject({ digest: digest(literal.replacements.get(".mcp.json")!) })
})

test("inline and declared-file MCP definitions augment root .mcp.json through the same converter", async () => {
  const captured = await captureFixture("external_plugins/playwright")
  const original = JSON.parse(new TextDecoder().decode(await captured.readFile(".claude-plugin/plugin.json")))
  const remote = JSON.parse(await Bun.file(join(fixtureRoot, "external_plugins/context7/.mcp.json")).text())
  const inline = await (await converter()).convertPluginTree(await captureFixture("external_plugins/playwright", { ".claude-plugin/plugin.json": JSON.stringify({ ...original, mcpServers: remote.mcpServers }) }))
  expect(inline.package.entries.map((entry) => entry.sourceName).sort()).toEqual(["context7", "playwright"])
  const file = await (await converter()).convertPluginTree(await captureFixture("external_plugins/playwright", { ".claude-plugin/plugin.json": JSON.stringify({ ...original, mcpServers: "./extra-mcp.json" }), "extra-mcp.json": JSON.stringify(remote) }))
  expect(file.package.entries.map((entry) => entry.sourceName).sort()).toEqual(["context7", "playwright"])
})

test("malformed definitions do not hide unrelated real skills or expose raw values", async () => {
  const converted = await (await converter()).convertPluginTree(await captureFixture("plugins/frontend-design", { ".mcp.json": "{broken-sensitive-marker" }))
  expect(converted.package.entries.some((entry) => entry.kind === "skill")).toBe(true)
  expect(converted.package.diagnostics).toMatchObject([{ path: ".mcp.json", code: "invalid-definition" }])
  expect(JSON.stringify(converted.package.diagnostics)).not.toContain("broken-sensitive-marker")
})

test("capture digest mismatch, duplicate destination and traversal are capture errors", async () => {
  const captured = await captureFixture("external_plugins/playwright")
  const convert = (await converter()).convertPluginTree
  await expect(convert({ ...captured, nodes: [...captured.nodes, captured.nodes[0]!] })).rejects.toMatchObject({ code: "duplicate-path" })
  await expect(convert({ ...captured, readFile: async () => new Uint8Array() })).rejects.toMatchObject({ code: "digest-mismatch" })
  await expect(convert({ ...captured, nodes: [{ ...captured.nodes[0]!, path: "../outside" }] })).rejects.toMatchObject({ code: "invalid-path" })
})

test("the published converter is self-contained ESM with the same conversion result", async () => {
  const source = await converter()
  const published = await import("./plugin-conversion.mjs")
  const captured = await captureFixture("external_plugins/playwright")
  expect((await published.convertPluginTree(captured)).package).toEqual((await source.convertPluginTree(captured)).package)
})
