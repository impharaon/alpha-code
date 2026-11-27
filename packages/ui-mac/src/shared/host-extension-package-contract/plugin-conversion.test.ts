import { expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, sep } from "node:path"
import { captureStandardFixture, captureFixture, digest, fixtureRoot } from "../../../test-fixtures/plugin-helper/fixture"
import provenance from "../../../test-fixtures/plugin-helper/provenance.json"
import codex from "../../../test-fixtures/plugin-helper/codex/provenance.json"
import registry from "../../../test-fixtures/plugin-helper/registry/provenance.json"
import opencode from "../../../test-fixtures/plugin-helper/opencode/provenance.json"
import npmProvenance from "../../../test-fixtures/plugin-helper/opencode/npm/provenance.json"
import type { Json, Source } from "./plugin-conversion"

const converter = () => import("./plugin-conversion")
const registryServer = async (file: string) => (await Bun.file(join(fixtureRoot, "registry", file)).json()).server as { [key: string]: Json }
const registrySource: Source = { kind: "mcp-registry", locator: "https://registry.modelcontextprotocol.io", serverName: "io.github.github/github-mcp-server", version: "2.1.0" }

test("source tool rules retain quoted nested patterns and recover the next rule", async () => {
  const original = await captureStandardFixture("claude:plugin-dev")
  const source = new TextDecoder().decode(await original.readFile("commands/create-plugin.md"))
  // Pinned plugin-dev declaration, with a controlled rule-list variant exercising its source grammar.
  const variant = source.replace(/allowed-tools:[\s\S]*?\n---/, 'allowed-tools: \'Bash(clay *), Bash(echo "a,b" $(date)), Write, Broken(, AskUserQuestion\'\n---')
  const result = (await (await converter()).convertPluginTree(await captureStandardFixture("claude:plugin-dev", { "commands/create-plugin.md": variant }))).package
  const command = result.entries.find(entry => entry.kind === "command")!
  expect(command).toMatchObject({ invocation: { allowedTools: [
    { tool: "Bash", pattern: "clay *" }, { tool: "Bash", pattern: 'echo "a,b" $(date)' }, { tool: "Write" }, { tool: "AskUserQuestion" },
  ] } })
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ path: "commands/create-plugin.md", field: "allowed-tools", code: "invalid-definition" }))
})

test("skill sidecars preserve manual policy and resolve declared MCP dependencies", async () => {
  const convert = (await converter()).convertPluginTree
  const temporal = await captureStandardFixture("codex:temporal")
  const source = new TextDecoder().decode(await temporal.readFile("skills/temporal-cloud-setup/SKILL.md"))
  // Remove the redundant frontmatter false so the real YAML must supply the manual policy.
  const manual = (await convert(await captureStandardFixture("codex:temporal", { "skills/temporal-cloud-setup/SKILL.md": source.replace(/^allow_implicit_invocation: false\r?\n/m, "") }))).package
  expect(manual.entries.find(entry => entry.sourceName === "temporal-cloud-setup")).toMatchObject({ invocation: { implicitInvocation: false, userInvocable: true, argumentSyntax: "literal", arguments: [], paths: [], preloadSkills: [] }, display: { displayName: "Temporal Cloud Setup", shortDescription: "Set up Temporal Cloud and run a sample Workflow" } })
  const apps = (await convert(await captureStandardFixture("codex:openai-developers"))).package
  expect(apps.entries.find(entry => entry.sourceName === "build-chatgpt-app")).toMatchObject({ dependencies: [{ type: "mcp", value: "openaiDeveloperDocs", transport: "http", url: ["https://developers.openai.com/mcp"] }], display: { displayName: "Build ChatGPT App", defaultPrompt: expect.stringContaining("$build-chatgpt-app") } })
  expect(apps.entries.filter(entry => entry.kind === "agent")).toHaveLength(0)
  expect(apps.entries).toContainEqual(expect.objectContaining({ kind: "mcp", sourceName: "openaiDeveloperDocs", transport: "http" }))
})

test("invocation fields preserve source controls and provider argument syntax", async () => {
  const original = await captureStandardFixture("claude:feature-dev")
  const source = new TextDecoder().decode(await original.readFile("agents/code-reviewer.md"))
  const variant = source.replace("---\n", '---\narguments: [target, mode]\neffort: high\npaths: ["src/**"]\nskills: [review]\nmemory: project\nmaxTurns: 7\nbackground: false\n')
  const converted = (await (await converter()).convertPluginTree(await captureStandardFixture("claude:feature-dev", { "agents/code-reviewer.md": variant }))).package
  expect(converted.entries.find(entry => entry.id === "agent:agents/code-reviewer.md")).toMatchObject({ invocation: { arguments: ["target", "mode"], argumentSyntax: "literal", effort: "high", paths: ["src/**"], preloadSkills: ["review"], memory: "project", maxTurns: 7, background: false, model: { alias: "sonnet" }, availableTools: expect.arrayContaining([{ tool: "Read" }]) } })
  const vercel = (await (await converter()).convertPluginTree(await captureStandardFixture("codex:vercel"))).package
  expect(vercel.entries.filter(entry => entry.kind === "command")).toHaveLength(6)
  expect(vercel.entries.find(entry => entry.kind === "command")).toMatchObject({ invocation: { argumentSyntax: "codex" } })
})

test("YAML false independently disables automatic skill invocation", async () => {
  const original = await captureStandardFixture("codex:temporal")
  const source = new TextDecoder().decode(await original.readFile("skills/temporal-cloud-setup/SKILL.md"))
  // The pinned source actually uses the Claude spelling; remove that redundant declaration.
  expect(source).toContain("disable-model-invocation: true")
  const converted = await (await converter()).convertPluginTree(await captureStandardFixture("codex:temporal", {
    "skills/temporal-cloud-setup/SKILL.md": source.replace(/^disable-model-invocation: true\r?\n/m, ""),
  }))
  const entry = converted.package.entries.find(entry => entry.sourceName === "temporal-cloud-setup")
  expect(entry && "invocation" in entry ? entry.invocation.implicitInvocation : undefined).toBe(false)
})

test("real third-party sample trees are archive-only and unpacked into temporary storage", async () => {
  const storedRoot = join(import.meta.dir, "../../../test-fixtures/plugin-helper")
  expect(fixtureRoot).not.toBe(storedRoot)
  expect(relative(realpathSync(tmpdir()), realpathSync(fixtureRoot)).split(sep)[0]).not.toBe("..")
  for (const tree of [
    { root: "", files: provenance.files, archive: provenance.archive },
    { root: "codex", files: codex.files, archive: codex.archive },
    ...opencode.trees.map(tree => ({ ...tree, root: join("opencode", tree.root) })),
  ]) {
    expect(digest(await Bun.file(join(storedRoot, tree.root, tree.archive.path)).bytes())).toBe(`sha256:${tree.archive.sha256}`)
    for (const file of tree.files) expect(await Bun.file(join(storedRoot, tree.root, file.path)).exists()).toBe(false)
  }
})

test("OpenCode native modules remain visible with native-js-plugin while skills survive", async () => {
  for (const tree of opencode.trees) for (const file of [...tree.files, { path: tree.archive.path, sha256: tree.archive.sha256 }])
    expect(digest(await Bun.file(join(fixtureRoot, "opencode", tree.root, file.path)).bytes())).toBe(`sha256:${file.sha256}`)
  for (const file of npmProvenance.files) {
    const bytes = await Bun.file(join(fixtureRoot, "opencode/npm", file.path)).bytes()
    expect(bytes.byteLength).toBe(file.bytes)
    expect(digest(bytes)).toBe(`sha256:${file.sha256}`)
  }
  const local = await Bun.file(join(fixtureRoot, "opencode/local-config.jsonc")).bytes()
  expect(local.byteLength).toBe(opencode.localConfig.bytes)
  expect(digest(local)).toBe(`sha256:${opencode.localConfig.sha256}`)
  const captured = await captureFixture("superpowers", {}, "opencode")
  const converted = await (await converter()).convertPluginTree(captured)
  expect(converted.package.provider).toBe("opencode")
  expect(converted.package.entries).toContainEqual(expect.objectContaining({ kind: "skill", sourceName: "using-superpowers" }))
  expect(converted.package.diagnostics).toContainEqual(expect.objectContaining({ code: "native-js-plugin", path: ".opencode/plugins/superpowers.js", sourceName: "superpowers" }))
  expect(converted.package.tree).toEqual(captured.nodes)
  expect((await (await import("./plugin-conversion.mjs")).convertPluginTree(captured)).package).toEqual(converted.package)
})

test("pinned OpenCode JSONC and skills use the shared package model", async () => {
  const converted = await (await converter()).convertPluginTree(await captureFixture("onyxia", {}, "opencode"))
  expect(converted.package.provider).toBe("opencode")
  expect(converted.package.entries.filter((entry) => entry.kind === "skill")).toHaveLength(15)
  expect(converted.package.entries.filter((entry) => entry.kind === "mcp")).toMatchObject([
    { sourceName: "excalidraw", transport: "http", url: ["https://api.excalidraw.com/api/v1/mcp"] },
    { sourceName: "datagouv", transport: "http", url: ["https://mcp.data.gouv.fr/mcp"] },
  ])
  expect(converted.package.diagnostics).toEqual([])
})

test("OpenCode singular hidden skill paths and local MCP preserve credentials and original field pointers", async () => {
  const original = await captureFixture("superpowers", {}, "opencode")
  const skill = new TextDecoder().decode(await original.readFile("skills/using-superpowers/SKILL.md"))
  // Relocate actual entry files; MCP fields remain the pinned OpenCode user's original configuration.
  const config = await Bun.file(join(fixtureRoot, "opencode/local-config.jsonc")).text()
  const capture = await captureFixture("superpowers", { "skills/using-superpowers/SKILL.md": null, ".opencode/skill/using-superpowers/SKILL.md": skill, ".opencode/opencode.jsonc": config }, "opencode")
  const result = await (await converter()).convertPluginTree(capture)
  expect(result.package.entries).toContainEqual(expect.objectContaining({ kind: "skill", directory: ".opencode/skill/using-superpowers" }))
  expect(result.package.entries).toContainEqual(expect.objectContaining({ kind: "mcp", transport: "stdio", command: [["npx"], ["@playwright/mcp@latest"]], environment: {} }))
  expect(result.package.secrets).toContainEqual(expect.objectContaining({ targets: [{ file: ".opencode/opencode.jsonc", pointer: "/mcp/zai-mcp-server/environment/Z_AI_API_KEY" }] }))
  expect(result.privateCredentials.size).toBe(0)
})

test("OpenCode native module diagnostics deduplicate paths and never evaluate source bytes", async () => {
  const { mkdtemp, access, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const root = await mkdtemp(join(tmpdir(), "helper-native-"))
  try {
    const original = await captureFixture("superpowers", {}, "opencode")
    const js = new TextDecoder().decode(await original.readFile(".opencode/plugins/superpowers.js"))
    const manifest = await Bun.file(join(fixtureRoot, "opencode/npm/package.json")).json()
    const capture = await captureFixture("superpowers", { ".opencode/plugins/superpowers.js": `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(join(root, "executed"))}, "executed");\n` + js,
      "package.json": JSON.stringify({ ...manifest, name: "superpowers-package", main: "./.opencode/plugins/superpowers.js", exports: { ".": { import: "./.opencode/plugins/superpowers.js", default: "./.opencode/plugins/superpowers.js" } } }) }, "opencode")
    const result = await (await converter()).convertPluginTree(capture)
    expect(result.package.diagnostics.filter((diagnostic) => diagnostic.code === "native-js-plugin")).toMatchObject([{ path: ".opencode/plugins/superpowers.js", sourceName: "superpowers-package" }])
    expect(await access(join(root, "executed")).then(() => true, () => false)).toBe(false)
    expect(result.package.entries.some((entry) => entry.kind === "skill")).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("registry GitHub without plugin manifest becomes one remote MCP with a Bearer secret need", async () => {
  for (const file of registry.files) expect(digest(await Bun.file(join(fixtureRoot, "registry", file.path)).bytes())).toBe(`sha256:${file.sha256}`)
  const server = await registryServer("github-registry-version.json")
  const converted = (await converter()).convertMcpServerDefinition(server, registrySource)
  expect(converted.package).toMatchObject({ provider: "mcp-registry", version: "2.1.0", source: registrySource, diagnostics: [] })
  expect(converted.package.entries).toMatchObject([{ kind: "mcp", transport: "http", url: ["https://api.githubcopilot.com/mcp/"], headers: { Authorization: ["Bearer ", { secret: expect.any(String) }] } }])
  expect(converted.package.secrets).toHaveLength(1)
  expect(converted.package.secrets[0]!.targets).toEqual([{ file: "server.json", pointer: "/remotes/0/headers/0/value" }])
  expect(converted.privateCredentials.size).toBe(0)
  expect((await import("./plugin-conversion.mjs")).convertMcpServerDefinition(server, registrySource)).toEqual(converted)
})

test("registry remote preference and real npm pypi oci fallbacks preserve commands", async () => {
  const convert = (await converter()).convertMcpServerDefinition
  const npm = convert(await registryServer("playwright-registry-version.json"), registrySource)
  expect(npm.package.entries).toMatchObject([{ transport: "stdio", command: [["npx"], ["-y"], ["@playwright/mcp@0.0.85"]] }])
  const pypi = convert(await registryServer("pypi-registry-version.json"), registrySource)
  expect(pypi.package.entries).toMatchObject([{ transport: "stdio", command: [["uvx"], ["agentfetch-mcp==1.0.1"]], environment: { JINA_API_KEY: [{ secret: expect.any(String) }], FIRECRAWL_API_KEY: [{ secret: expect.any(String) }], REDIS_URL: [{ secret: expect.any(String) }] } }])
  // Remove only remotes from the real GitHub server; its original OCI/runtime arguments are retained.
  const github = await registryServer("github-registry-version.json")
  const oci = convert({ ...github, remotes: [] }, registrySource)
  expect(oci.package.entries).toMatchObject([{ transport: "stdio", command: [["docker"], ["run"], ["-i"], ["--rm"], ["-p"], ["127.0.0.1:8085:8085"], ["-e"], ["GITHUB_OAUTH_CALLBACK_PORT=8085"], ["-e"], ["GITHUB_PERSONAL_ACCESS_TOKEN=", { secret: expect.any(String) }], ["ghcr.io/github/github-mcp-server:2.1.0"]] }])
  expect(oci.package.secrets).toHaveLength(1)
})

test("registry header templates defaults and literal credentials keep public output safe", async () => {
  const server = await registryServer("github-registry-version.json")
  // Controlled variants of the real header: templated, literal, then a non-secret default.
  const remote = (server.remotes as { [key: string]: Json }[])[0]!
  const header = (remote.headers as { [key: string]: Json }[])[0]!
  const templated = (await converter()).convertMcpServerDefinition({ ...server, remotes: [{ ...remote, headers: [{ ...header, value: "Token {token}" }] }] }, registrySource)
  expect(templated.package.entries).toMatchObject([{ headers: { Authorization: ["Token ", { secret: expect.any(String) }] } }])
  const literal = (await converter()).convertMcpServerDefinition({ ...server, remotes: [{ ...remote, headers: [{ ...header, value: "Bearer test-credential-1724" }] }] }, registrySource)
  expect(JSON.stringify(literal.package)).not.toContain("test-credential-1724")
  expect(new TextDecoder().decode([...literal.privateCredentials.values()][0])).toBe("test-credential-1724")
  const ordinary = (await converter()).convertMcpServerDefinition({ ...server, remotes: [{ ...remote, headers: [{ ...header, name: "Accept", isSecret: false, value: "application/json" }] }] }, registrySource)
  expect(ordinary.package.entries).toMatchObject([{ headers: { Accept: ["application/json"] }, oauth: { kind: "mcp-oauth" } }])
  expect(ordinary.package.secrets).toEqual([])
})

test("registry unsupported or malformed definitions diagnose instead of inventing endpoints", async () => {
  const convert = (await converter()).convertMcpServerDefinition
  const github = await registryServer("github-registry-version.json")
  for (const server of [null, [], { ...github, remotes: [], packages: [] }, { ...github, remotes: [{ type: "streamable-http", url: "https://{region}/mcp" }], packages: [] }]) {
    const result = convert(server, registrySource)
    expect(result.package.entries).toEqual([])
    expect(result.package.diagnostics).toContainEqual(expect.objectContaining({ code: "invalid-definition" }))
  }
})

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

test("real Claude marketplace preserves path, pinned git-subdir and command sources", async () => {
  const bytes = new Uint8Array(await Bun.file(join(fixtureRoot, ".claude-plugin/marketplace.json")).arrayBuffer())
  const read = (await converter()).readMarketplace(bytes, "claude")
  expect(read.entries).toHaveLength(317)
  expect(read.entries.find((entry) => entry.name === "playwright")?.source).toEqual({ kind: "path", path: "external_plugins/playwright" })
  expect(read.entries.find((entry) => entry.name === "42crunch-api-security-testing")?.source).toEqual({ kind: "git", url: "https://github.com/42Crunch-AI/claude-plugins.git", commit: "faf5305385de8afed9468904e8639be737aff39e", ref: "v1.5.5", path: "plugins/api-security-testing" })
  // The recorded xcode entry is field-for-field the one pinned by AC-31 (claude-plugins-official@0fbfda5a).
  expect(read.entries.find((entry) => entry.name === "xcode")?.source).toEqual({ kind: "command", command: "xcrun agent plugin path --plugin-format claude", timeoutSeconds: 60, mode: "link" })
})

test("marketplace command sources keep command, timeout and mode", async () => {
  const document = JSON.parse(new TextDecoder().decode(await Bun.file(join(fixtureRoot, ".claude-plugin/marketplace.json")).arrayBuffer())) as { plugins: { name: string; source: Record<string, unknown> }[] }
  const xcode = document.plugins.find(entry => entry.name === "xcode")!
  // Controlled variants of the real entry: only its source fields change.
  const variant = (source: Record<string, unknown>) => (async () => (await converter()).readMarketplace(new TextEncoder().encode(JSON.stringify({ plugins: [{ ...xcode, source: { ...xcode.source, ...source } }] })), "claude").entries[0]!.source)()
  expect(await variant({ timeout: 120 })).toEqual({ kind: "command", command: "xcrun agent plugin path --plugin-format claude", timeoutSeconds: 120, mode: "link" })
  expect(await variant({ timeout: 0, mode: undefined })).toEqual({ kind: "command", command: "xcrun agent plugin path --plugin-format claude", timeoutSeconds: 60, mode: "copy" })
  expect(await variant({ mode: "symlink" })).toMatchObject({ kind: "unsupported" })
  expect(await variant({ command: " " })).toMatchObject({ kind: "unsupported" })
})

test("a linked plugin reads only its control definitions and converts like its copy", async () => {
  const { readdir, lstat, readlink, readFile } = await import("node:fs/promises")
  const root = join(fixtureRoot, "standard", "claude-plugin-dev")
  const list = async (path: string) => Promise.all((await readdir(join(root, path))).sort().map(async name => {
    const child = path ? path + "/" + name : name
    const info = await lstat(join(root, child))
    return info.isSymbolicLink() ? { kind: "symlink" as const, path: child, mode: info.mode & 0o7777, target: await readlink(join(root, child)) }
      : { kind: info.isDirectory() ? "directory" as const : "file" as const, path: child, mode: info.mode & 0o7777 }
  }))
  const read: string[] = []
  const copied = (await (await converter()).convertPluginTree(await captureStandardFixture("claude:plugin-dev"))).package
  const linked = (await (await converter()).convertPluginTree({
    source: copied.source, materialization: "link", bindingId: `sha256:${"a".repeat(64)}`, topLevel: await list(""), readDirectory: list,
    readFile: async path => { read.push(path); return new Uint8Array(await readFile(join(root, path))) },
  })).package
  expect(linked).toMatchObject({ materialization: "link", link: { bindingId: `sha256:${"a".repeat(64)}`, topLevel: await list("") } })
  expect(linked).not.toHaveProperty("tree")
  const byId = (entries: typeof copied.entries) => entries.toSorted((left, right) => left.id.localeCompare(right.id))
  expect(byId(linked.entries)).toEqual(byId(copied.entries))
  expect(linked.entries.map(entry => entry.kind).toSorted()).toEqual(expect.arrayContaining(["agent", "command", "skill"]))
  // Ordinary resources (scripts, references, examples, README) stay reachable through links and are never read.
  expect(read.length).toBeGreaterThan(0)
  expect(read.every(path => /(?:^|\/)(?:SKILL\.md|plugin\.json|hooks\.json)$/.test(path) || /^(?:commands|agents)\/.+\.md$/.test(path))).toBe(true)
  expect((await import("./plugin-package")).validPluginPackage(linked)).toBe(true)
})

test("a linked plugin discovers its language servers, output styles and settings default like its copy", async () => {
  const { mkdtemp, mkdir, writeFile, readdir, lstat, readFile } = await import("node:fs/promises")
  const { dirname } = await import("node:path")
  const { convertPluginTree } = await converter()
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
  // Write the pinned sample (with its controlled variants) to a real directory, then capture that directory by link.
  const both = async (name: string, changes: Record<string, string | null> = {}) => {
    const capture = await captureStandardFixture(name, changes)
    const root = await mkdtemp(join(tmpdir(), "plugin-linked-definitions-"))
    for (const node of capture.nodes) if (node.kind === "file") {
      await mkdir(dirname(join(root, node.path)), { recursive: true })
      await writeFile(join(root, node.path), await capture.readFile(node.path))
    }
    const list = async (path: string) => Promise.all((await readdir(join(root, path))).sort().map(async child => {
      const full = path ? path + "/" + child : child
      return { kind: (await lstat(join(root, full))).isDirectory() ? "directory" as const : "file" as const, path: full, mode: 0o644 }
    }))
    const copied = (await convertPluginTree(capture)).package
    const linked = (await convertPluginTree({
      source: copied.source, materialization: "link", bindingId: `sha256:${"b".repeat(64)}`, topLevel: await list(""), readDirectory: list,
      readFile: async path => new Uint8Array(await readFile(join(root, path))),
    })).package
    const byId = (entries: typeof copied.entries) => entries.toSorted((left, right) => left.id.localeCompare(right.id))
    expect(byId(linked.entries)).toEqual(byId(copied.entries))
    expect(linked.defaults).toEqual(copied.defaults)
    return linked
  }
  const pyright = await captureStandardFixture("claude:pyright-lsp")
  const manifest = JSON.parse(text(await pyright.readFile(".claude-plugin/plugin.json")))
  // Root .lsp.json and a manifest-declared server file, both only reachable through the link.
  const lsp = await both("claude:pyright-lsp", {
    ".claude-plugin/plugin.json": JSON.stringify({ ...manifest, lspServers: ["./lsp/servers.json"] }),
    ".lsp.json": JSON.stringify({ rooted: { command: "rooted-langserver", extensionToLanguage: { ".rt": "rooted" } } }),
    "lsp/servers.json": JSON.stringify({ pyright: manifest.lspServers.pyright }),
  })
  expect(lsp.entries.filter(entry => entry.kind === "lsp").map(entry => [entry.sourceName, entry.sourcePath]).toSorted()).toEqual([["pyright", "lsp/servers.json"], ["rooted", ".lsp.json"]])
  const styles = await both("claude:dominodatalab")
  expect(styles.entries.filter(entry => entry.kind === "output-style").map(entry => entry.sourcePath)).toEqual(["output-styles/domino-learning.md", "output-styles/domino-mlops.md"])
  const domino = await captureStandardFixture("claude:dominodatalab")
  const replaced = await both("claude:dominodatalab", {
    ".claude-plugin/plugin.json": JSON.stringify({ ...JSON.parse(text(await domino.readFile(".claude-plugin/plugin.json"))), outputStyles: "./styles/" }),
    "styles/domino-learning.md": text(await domino.readFile("output-styles/domino-learning.md")),
  })
  expect(replaced.entries.filter(entry => entry.kind === "output-style").map(entry => entry.sourcePath)).toEqual(["styles/domino-learning.md"])
  expect((await both("claude:agentforce-adlc")).defaults).toEqual({ agent: "agent:agents/adlc-orchestrator.md" })
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
  expect(converted.package.entries).toMatchObject([{ headers: { Authorization: ["Bearer ", { environment: { name: "GITHUB_PERSONAL_ACCESS_TOKEN", default: [{ secret: need.id }] } }] } }])
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

test("A2 installed skill copy rewrites host names and structured MCP references while retaining other bytes", async () => {
  const capture = await captureFixture("plugins/frontend-design")
  const original = new TextDecoder().decode(await capture.readFile("skills/frontend-design/SKILL.md"))
  // Controlled frontmatter additions to the actual skill, using the converter's existing fields.
  const skill = original.replace("---\n", '---\nallowed-tools: ["mcp__playwright__browser_navigate", "Read"]\ndisallowed-tools: ["mcp__playwright__browser_close"]\ntools: ["mcp__playwright__browser_snapshot"]\ndependencies:\n  mcp: [playwright]\n')
  const converted = await (await converter()).convertPluginTree(await captureFixture("plugins/frontend-design", { "skills/frontend-design/SKILL.md": skill }))
  const entry = converted.package.entries.find((entry) => entry.kind === "skill")!
  if (entry.kind !== "skill") throw Error("real skill is absent")
  const result = (await converter()).renderInstalledSkill(entry, new TextEncoder().encode(skill), new Map([[entry.sourceName, "frontend-design-host"], ["playwright", "playwright-host"]]))
  const text = new TextDecoder().decode(result)
  expect(text).toContain("name: frontend-design-host")
  expect(text).toContain("mcp__playwright-host__browser_navigate")
  expect(text).toContain("mcp__playwright-host__browser_close")
  expect(text).toContain("mcp__playwright-host__browser_snapshot")
  expect(text).toContain("mcp: [playwright-host]")
  expect(text.slice(text.indexOf("\n---", 4))).toBe(skill.slice(skill.indexOf("\n---", 4)))
  expect(text).toContain('description:')
})

test("R12 A5 real Claude command agent and hook components survive discovery without execution", async () => {
  const review = await captureFixture("plugins/pr-review-toolkit")
  const hooks = await captureFixture("plugins/explanatory-output-style")
  for (const ecosystem of ["claude", "codex"] as const) {
    const capture = { ...review, source: { ...review.source, ecosystem } }
    const converted = await (await converter()).convertPluginTree(capture)
    expect(converted.package.entries.filter(entry => entry.kind === "agent")).toHaveLength(6)
    expect(converted.package.entries).toContainEqual(expect.objectContaining({ kind: "command", sourcePath: "commands/review-pr.md", sourceName: "review-pr" }))
    expect((await (await import("./plugin-conversion.mjs")).convertPluginTree(capture)).package).toEqual(converted.package)
  }
  const converted = await (await converter()).convertPluginTree(hooks)
  expect(converted.package.entries).toMatchObject([{ kind: "hook", sourcePath: "hooks/hooks.json", sourceName: "SessionStart", hook: { event: "SessionStart", command: ["bash \"", { binding: "pluginRoot" }, "/hooks-handlers/session-start.sh\""], scope: { kind: "package" } } }])
  expect(converted.package.diagnostics).toEqual([])
})

test("R14 B6 a repository with one loose skill keeps the previously accepted child layout", async () => {
 const captured=await captureFixture("plugins/frontend-design")
 const skill=new TextDecoder().decode(await captured.readFile("skills/frontend-design/SKILL.md"))
 const relocated=await captureFixture("plugins/frontend-design",{".claude-plugin/plugin.json":null,"skills/frontend-design/SKILL.md":null,"frontend-design/SKILL.md":skill})
 const converted=await (await converter()).convertPluginTree(relocated)
 expect(converted.package.entries).toContainEqual(expect.objectContaining({kind:"skill",sourcePath:"frontend-design/SKILL.md",sourceName:"frontend-design"}))
})


test("standalone converter check detects drift in both committed runtime and declaration outputs", async () => {
  const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const child = Bun.spawnSync([process.execPath, join(import.meta.dir, "generate-plugin-conversion.ts"), "--check"], { cwd: import.meta.dir })
  expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
  const { checkPluginConversion } = await import("./generate-plugin-conversion")
  const root = await mkdtemp(join(tmpdir(), "conversion-check-"))
  try {
    for (const file of ["plugin-conversion.mjs", "plugin-conversion.d.mts"])
      await writeFile(join(root, file), await readFile(join(import.meta.dir, file)))
    await checkPluginConversion(root)
    for (const file of ["plugin-conversion.mjs", "plugin-conversion.d.mts"]) {
      const original = await readFile(join(root, file))
      await writeFile(join(root, file), Buffer.concat([original, Buffer.from("\n// controlled drift\n")]))
      await expect(checkPluginConversion(root)).rejects.toThrow(file + " drifted")
      await writeFile(join(root, file), original)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})


test("chosen provider and portable MCP retain the real standard definitions", async () => {
  const convert = (await converter()).convertPluginTree
  const supabase = await convert(await captureStandardFixture("claude:supabase"))
  expect(supabase.package.provider).toBe("claude-code")
  expect(supabase.package.entries.filter(entry => entry.kind === "mcp")).toContainEqual(expect.objectContaining({ sourceName: "supabase", sourcePath: "agents/claude/.mcp.json" }))
  for (const [name, count] of [["claude:cloudinary", 5], ["claude:catalyst-by-zoho", 1]] as const) {
    const result = await convert(await captureStandardFixture(name))
    expect(result.package.entries.filter(entry => entry.kind === "mcp" && entry.transport === "http")).toHaveLength(count)
  }
})

test("typed options and environment defaults preserve real source meaning", async () => {
  const convert = (await converter()).convertPluginTree
  const grafana = await convert(await captureStandardFixture("claude:grafana-mcp"))
  expect(grafana.package).toMatchObject({ options: { grafana_url: { type: "string", required: true, sensitive: false }, grafana_service_account_token: { type: "string", required: true, sensitive: true } } })
  expect(grafana.privateCredentials.size).toBe(0)
  expect(grafana.package.entries.find(entry => entry.kind === "mcp")).toMatchObject({ environment: { GRAFANA_URL: [{ option: "grafana_url" }], GRAFANA_SERVICE_ACCOUNT_TOKEN: [{ option: "grafana_service_account_token" }] } })
  const langfuse = await convert(await captureStandardFixture("claude:langfuse-observability"))
  expect(langfuse.package).toMatchObject({ options: { CC_LANGFUSE_DEBUG: { default: false }, CC_LANGFUSE_MAX_CHARS: { default: 20000 }, LANGFUSE_BASE_URL: { default: "https://cloud.langfuse.com" } } })
  const logfire = await convert(await captureStandardFixture("claude:logfire"))
  expect(logfire.package.entries.find(entry => entry.kind === "mcp")).toMatchObject({ url: [{ environment: { name: "LOGFIRE_MCP_URL", default: ["https://logfire-us.pydantic.dev/mcp"] } }] })
  expect(logfire.package.secrets).toEqual([])
})

test("ambiguous exported option names preserve each source key and report the environment name", async () => {
  const convert = (await converter()).convertPluginTree
  const original = await captureStandardFixture("claude:langfuse-observability")
  const manifest = JSON.parse(new TextDecoder().decode(await original.readFile(".claude-plugin/plugin.json")))
  manifest.userConfig.cc_langfuse_debug = manifest.userConfig.CC_LANGFUSE_DEBUG
  const converted = await convert(await captureStandardFixture("claude:langfuse-observability", { ".claude-plugin/plugin.json": JSON.stringify(manifest) }))
  expect(converted.package.options?.CC_LANGFUSE_DEBUG?.default).toBe(false)
  expect(converted.package.options?.cc_langfuse_debug?.default).toBe(false)
  expect(converted.package.diagnostics).toContainEqual(expect.objectContaining({ field: "/userConfig", message: "Plugin option environment name is ambiguous: CLAUDE_PLUGIN_OPTION_CC_LANGFUSE_DEBUG" }))
})

test("standard hook sources retain command prompt scopes events and monitor triggers", async () => {
  const convert = (await converter()).convertPluginTree
  const learning = (await convert(await captureStandardFixture("claude:learning-output-style"))).package
  expect(learning.entries.filter(entry => entry.kind === "hook")).toMatchObject([{ hook: { type: "command", event: "SessionStart", scope: { kind: "package" } } }])
  const langfuse = (await convert(await captureStandardFixture("claude:langfuse-observability"))).package
  expect(langfuse.entries.filter(entry => entry.kind === "hook").length).toBeGreaterThan(0)
  const dash = (await convert(await captureStandardFixture("claude:dash0"))).package
  expect(dash.entries.filter(entry => entry.kind === "hook")).toHaveLength(24)
  expect(dash.diagnostics.filter(item => item.code === "unavailable-trigger").map(item => item.sourceName).sort()).toEqual(["CwdChanged", "PermissionDenied", "TaskCompleted", "TaskCreated", "TeammateIdle"])
  const stripe = (await convert(await captureStandardFixture("claude:stripe"))).package
  expect(stripe.entries.find(entry => entry.kind === "hook" && entry.hook.event === "PostToolBatch")).toMatchObject({ hook: { type: "command", command: ["node"], args: [expect.any(Array)] } })
  const paypal = (await convert(await captureStandardFixture("claude:paypal"))).package
  expect(paypal.entries.find(entry => entry.kind === "hook")).toMatchObject({ hook: { type: "prompt", event: "PreToolUse", matcher: "Write|Edit", continueOnBlock: false } })
  const security = (await convert(await captureStandardFixture("claude:claude-security"))).package
  expect(security.entries.find(entry => entry.kind === "hook" && entry.hook.scope.kind === "skill")).toMatchObject({ sourcePath: "skills/threat-model/SKILL.md", hook: { type: "command", scope: { kind: "skill", entryId: "skill:skills/threat-model/SKILL.md" } } })
  expect(new Set(security.entries.filter(entry => entry.kind === "hook").map(entry => entry.hook.order)).size).toBe(security.entries.filter(entry => entry.kind === "hook").length)
  const convex = (await convert(await captureStandardFixture("claude:convex"))).package
  expect(convex.entries.filter(entry => entry.kind === "monitor")).toHaveLength(5)
  expect(convex.entries.filter(entry => entry.kind === "monitor" && entry.when.kind === "skill" && entry.when.sourceName === "design")).toHaveLength(2)
  expect(convex.entries.filter(entry => entry.kind === "monitor" && entry.when.kind === "skill" && entry.when.sourceName === "quickstart")).toHaveLength(3)
})

test("monitor declarations merge portable and provider manifests by source name", async () => {
  const source = await captureStandardFixture("claude:convex")
  const manifest = JSON.parse(new TextDecoder().decode(await source.readFile(".claude-plugin/plugin.json")))
  const monitors = JSON.parse(new TextDecoder().decode(await source.readFile("monitors/monitors.json")))
  const { pluginText } = await import("./plugin-package")
  // Controlled variants of the pinned Convex declarations: one conflicting name and one additional entry.
  const portable = { ...manifest, experimental: { monitors: [{ ...monitors[0], command: "printf portable" }, { ...monitors[0], name: "portable-monitor" }] } }
  const capture = await captureStandardFixture("claude:convex", { "plugin.json": JSON.stringify(portable) })
  for (const ecosystem of ["claude", "codex"] as const) {
    const converted = (await (await converter()).convertPluginTree({ ...capture, source: { ...capture.source, ecosystem } })).package
    const entries = converted.entries.filter(entry => entry.kind === "monitor")
    expect(entries).toHaveLength(6)
    expect(entries.find(entry => entry.sourceName === "convex-runtime-errors")).toMatchObject({ command: ecosystem === "claude" ? pluginText(monitors[0].command) : ["printf portable"] })
    expect(entries.find(entry => entry.sourceName === "portable-monitor")).toMatchObject({ sourcePath: "plugin.json" })
  }
})

test("output styles and plugin settings normalize from their source declarations", async () => {
  const { convertPluginTree } = await converter()
  const { renderPluginText } = await import("./plugin-package")
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
  const domino = await captureStandardFixture("claude:dominodatalab")
  const learning = text(await domino.readFile("output-styles/domino-learning.md"))
  const mlops = text(await domino.readFile("output-styles/domino-mlops.md"))
  const styles = (await convertPluginTree(domino)).package.entries.filter(entry => entry.kind === "output-style")
  expect(styles).toMatchObject([
    { id: "output-style:output-styles/domino-learning.md", sourceName: "Domino Learning", description: "Educational mode that explains Domino Data Lab concepts and best practices as you work", keepCodingInstructions: true },
    { id: "output-style:output-styles/domino-mlops.md", sourceName: "Domino MLOps", keepCodingInstructions: true },
  ])
  expect(styles[0]?.kind === "output-style" && renderPluginText(styles[0].instruction, { pluginRoot: "/root", projectDir: "/project" })).toBe(learning)
  // Controlled variants of the pinned styles: explicit false, absent field and name, broken frontmatter, and a manifest replacement path.
  const manifest = JSON.parse(text(await domino.readFile(".claude-plugin/plugin.json")))
  const variant = (await convertPluginTree(await captureStandardFixture("claude:dominodatalab", {
    "output-styles/domino-learning.md": learning.replace("keep-coding-instructions: true", "keep-coding-instructions: false"),
    "output-styles/domino-mlops.md": mlops.replace("name: Domino MLOps\n", "").replace("keep-coding-instructions: true\n", ""),
    "output-styles/broken.md": "---\nname: [\n---\nbody\n",
  }))).package
  expect(variant.entries.filter(entry => entry.kind === "output-style")).toMatchObject([
    { sourceName: "Domino Learning", keepCodingInstructions: false },
    { sourceName: "domino-mlops", keepCodingInstructions: false },
  ])
  expect(variant.diagnostics).toContainEqual(expect.objectContaining({ path: "output-styles/broken.md", code: "invalid-definition" }))
  const replaced = (await convertPluginTree(await captureStandardFixture("claude:dominodatalab", {
    ".claude-plugin/plugin.json": JSON.stringify({ ...manifest, outputStyles: "./styles/" }),
    "styles/domino-learning.md": learning,
  }))).package
  expect(replaced.entries.filter(entry => entry.kind === "output-style").map(entry => entry.sourcePath)).toEqual(["styles/domino-learning.md"])

  const adlc = await captureStandardFixture("claude:agentforce-adlc")
  expect(text(await adlc.readFile("settings.json"))).toContain('"agent": "agents/adlc-orchestrator.md"')
  const settled = (await convertPluginTree(adlc)).package
  expect(settled.defaults).toEqual({ agent: "agent:agents/adlc-orchestrator.md" })
  expect(settled.diagnostics.filter(item => item.path === "settings.json")).toEqual([])
  const settings = async (changes: Record<string, string | null>) => (await convertPluginTree(await captureStandardFixture("claude:agentforce-adlc", changes))).package
  expect((await settings({ "settings.json": JSON.stringify({ agent: "adlc-qa" }) })).defaults).toEqual({ agent: "agent:agents/adlc-qa.md" })
  const missing = await settings({ "settings.json": JSON.stringify({ agent: "agents/absent.md", statusLine: { type: "command" } }) })
  expect(missing.defaults).toEqual({})
  expect(missing.diagnostics.filter(item => item.path === "settings.json").map(item => [item.field, item.code])).toEqual([["/agent", "missing-entry"], ["/statusLine", "unsupported-setting"]])
  const project = await settings({ "settings.json": null, ".claude/settings.json": JSON.stringify({ agent: "agents/adlc-qa.md" }) })
  expect(project.defaults).toEqual({})
  expect(project.diagnostics.filter(item => item.path.endsWith("settings.json"))).toEqual([])
})


test("language servers keep their source protocol fields and declaration order", async () => {
  const convert = (await converter()).convertPluginTree
  const pyright = (await convert(await captureStandardFixture("claude:pyright-lsp"))).package
  expect(pyright.diagnostics).toEqual([])
  expect(pyright.entries).toEqual([{ kind: "lsp", id: "lsp:.claude-plugin/plugin.json#pyright", sourcePath: ".claude-plugin/plugin.json", sourceName: "pyright", server: {
    command: ["pyright-langserver"], args: [["--stdio"]], extensionToLanguage: { ".py": "python", ".pyi": "python" }, transport: "stdio", env: {}, restartOnCrash: true, diagnostics: true,
  } }])
  const original = await captureStandardFixture("claude:pyright-lsp")
  const manifest = JSON.parse(new TextDecoder().decode(await original.readFile(".claude-plugin/plugin.json")))
  // Controlled variants of the pinned pyright declaration: a root .lsp.json, a declared file, one option binding and one broken server.
  const root = { pyright: { ...manifest.lspServers.pyright, command: "root-pyright" }, rooted: { command: "rooted-langserver", extensionToLanguage: { ".rt": "rooted" } } }
  const declared = { pyright: { ...manifest.lspServers.pyright, env: { PYRIGHT_HOME: "${CLAUDE_PLUGIN_DATA}/home" }, settings: { python: { analysis: { typeCheckingMode: "${user_config.mode}", strict: "${user_config.strict}" } } }, shutdownTimeout: 1500, maxRestarts: 0, restartOnCrash: false }, broken: { command: "broken-langserver" } }
  const variant = { ...manifest, userConfig: { mode: { type: "string", title: "Mode", default: "strict" }, strict: { type: "boolean", title: "Strict", default: false } }, lspServers: ["./lsp/servers.json"] }
  const converted = (await convert(await captureStandardFixture("claude:pyright-lsp", { ".claude-plugin/plugin.json": JSON.stringify(variant), ".lsp.json": JSON.stringify(root), "lsp/servers.json": JSON.stringify(declared) }))).package
  const servers = converted.entries.filter(entry => entry.kind === "lsp")
  expect(servers.map(entry => [entry.sourceName, entry.sourcePath])).toEqual([["pyright", "lsp/servers.json"], ["rooted", ".lsp.json"]])
  expect(servers[0]).toMatchObject({ server: { command: ["pyright-langserver"], env: { PYRIGHT_HOME: [{ binding: "pluginData" }, "/home"] }, shutdownTimeout: 1500, maxRestarts: 0, restartOnCrash: false,
    settings: { value: { python: { analysis: { typeCheckingMode: "${user_config.mode}", strict: "${user_config.strict}" } } }, bindings: { "/python/analysis/typeCheckingMode": [{ option: "mode" }], "/python/analysis/strict": [{ option: "strict" }] } } } })
  expect(converted.diagnostics).toEqual([expect.objectContaining({ path: "lsp/servers.json", field: "/broken", code: "invalid-definition" })])
  const { validPluginPackage } = await import("./plugin-package")
  expect(validPluginPackage(pyright) && validPluginPackage(converted)).toBe(true)
  // The published decoder vector is this converter output, not a hand-written description.
  expect(pyright).toEqual((await import("./testvectors/plugin-package-lsp-description.v1.json")).default as never)
})

test("real skill bodies retain shell environment expressions byte for byte except package bindings", async () => {
  const { renderPluginText } = await import("./plugin-package")
  const capture = await captureStandardFixture("codex:build-ios-apps")
  const converted = await (await converter()).convertPluginTree(capture)
  for (const path of ["skills/ios-ettrace-performance/SKILL.md", "skills/ios-memgraph-leaks/SKILL.md"]) {
    const source = new TextDecoder().decode(await capture.readFile(path))
    const entry = converted.package.entries.find(entry => entry.kind === "skill" && entry.sourcePath === path)!
    if (entry.kind !== "skill") throw Error("real skill missing")
    const bindings = { pluginRoot: "/package root", skillDir: "/skill dir", projectDir: "/project dir", pluginData: "/package data", resolveEnvironment: () => "MUST_REMAIN_SOURCE" }
    const expected = source.replaceAll("${CLAUDE_PLUGIN_ROOT}", bindings.pluginRoot).replaceAll("${PLUGIN_ROOT}", bindings.pluginRoot).replaceAll("${CLAUDE_SKILL_DIR}", bindings.skillDir).replaceAll("${CLAUDE_PROJECT_DIR}", bindings.projectDir).replaceAll("${CLAUDE_PLUGIN_DATA}", bindings.pluginData).replaceAll("${PLUGIN_DATA}", bindings.pluginData)
    expect(renderPluginText(entry.instruction, bindings)).toBe(expected)
  }
})

test("sensitive structured credentials preserve each path binding and hide nested default literals", async () => {
  const original = await captureFixture("external_plugins/github")
  const source = new TextDecoder().decode(await original.readFile(".mcp.json"))
  // Controlled credential-field variants of the recorded GitHub declaration; no real credential.
  for (const value of ["${CLAUDE_PLUGIN_DATA}/token.json", "${CLAUDE_PLUGIN_ROOT}/token.json", "${OUTER_TOKEN:-${INNER_TOKEN:-fixture-nested-private-default}}"] ) {
    const capture = await captureFixture("external_plugins/github", { ".mcp.json": source.replace("Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}", value) })
    const converted = await (await converter()).convertPluginTree(capture)
    const replacement = converted.replacements.get(".mcp.json")
    const text = new TextDecoder().decode(replacement ?? await capture.readFile(".mcp.json"))
    if (value.endsWith("/token.json")) expect(JSON.parse(text).github.headers.Authorization).toBe(value)
    else {
      expect(JSON.stringify(converted.package)).not.toContain("fixture-nested-private-default")
      expect(text).not.toContain("fixture-nested-private-default")
      expect([...converted.privateCredentials.values()].map(bytes => new TextDecoder().decode(bytes))).toContain("fixture-nested-private-default")
      const { renderPluginText } = await import("./plugin-package")
      const entry = converted.package.entries.find(entry => entry.kind === "mcp")!
      if (entry.kind !== "mcp" || entry.transport === "stdio") throw Error("GitHub fixture must be remote")
      const render = (environment: Record<string, string>) => renderPluginText(entry.headers.Authorization!, { pluginRoot: "/plugin", projectDir: "/project", resolveEnvironment: name => environment[name], resolveSecret: id => { const bytes = converted.privateCredentials.get(id); return bytes && new TextDecoder().decode(bytes) } })
      expect(render({ OUTER_TOKEN: "outer" })).toBe("outer")
      expect(render({ INNER_TOKEN: "inner" })).toBe("inner")
      expect(render({})).toBe("fixture-nested-private-default")
    }
  }
})
