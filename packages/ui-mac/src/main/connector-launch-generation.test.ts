// Integration layer: one generation's launcher descriptor from the real bundle inventory and #1759's binding, and main's bridge
// over a paired port with the sidecar host (real dependency reader, real install ledger). No Electron, engine or network.
import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseCodePuppyBootstrap } from "../../../util/src/codepuppy-bootstrap"
import type { PinnedFiles } from "../../../util/src/codepuppy-pinned-files"
import pins from "../../resources/pinned-files.json"
import { writeLauncherFixture } from "../../test-component/connector-launcher-fixture"
import { addReceipt } from "./codepuppy-installs"
import { forkLauncherAuthority, openConnectorLaunchMain } from "./connector-launch-generation"
import { createConnectorLaunchSidecarHost } from "./connector-launch-sidecar"
import { createConnectorLaunchState } from "./connector-launch-state"
import { hostLauncherPlatform } from "./connector-launchers"
import type { CatalogEntry } from "../renderer/extensions/catalog-types"

const roots: string[] = []
const saved = process.env.CODEPUPPY_GLOBAL_DIR
beforeEach(() => {
  const global = realpathSync(mkdtempSync(join(tmpdir(), "launch-generation-global-")))
  roots.push(global)
  process.env.CODEPUPPY_GLOBAL_DIR = global
})
afterEach(() => {
  if (saved === undefined) delete process.env.CODEPUPPY_GLOBAL_DIR
  else process.env.CODEPUPPY_GLOBAL_DIR = saved
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const platform = hostLauncherPlatform()

async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "launch-generation-"))); roots.push(root)
  const resources = join(root, "resources")
  await writeLauncherFixture(resources, platform!)
  mkdirSync(join(resources, "office-mcp"), { recursive: true })
  const manifest = join(resources, "office-mcp", "tools.json")
  writeFileSync(manifest, JSON.stringify({ formats: { video: { command: ["{codepuppyNode}", "{codepuppyResources}/video-mcp/server.js", "{workspace}", "--cache-root", "{codepuppyCacheRoot}"] }, word: { command: ["{codepuppyResources}/office-runtime/bin/python3"] } } }))
  const userData = join(root, "user-data"); mkdirSync(userData)
  const binding = { UV_PYTHON_INSTALL_DIR: join(userData, "package-managers/uv/python"), UV_CACHE_DIR: join(userData, "package-managers/uv/cache"), npm_config_cache: join(userData, "package-managers/npm/cache") }
  const input = { userData, resourcesRoot: resources, packaged: true, pins: pins as PinnedFiles, packageManagerEnv: binding, officeMcpManifest: manifest, log: () => {} }
  return { root, resources, userData, binding, input }
}

test.skipIf(!platform)("the packaged descriptor consumes #1759's binding as given, crosses the bootstrap parser, and a missing bundle refuses the fork", async () => {
  const f = await fixture()
  const authority = forkLauncherAuthority(f.input)!
  const launchers = authority.environment
  expect(launchers.packageManagerEnv).toEqual(f.binding)
  expect(launchers.node.startsWith(join(f.resources, "connector-launchers") + "/")).toBe(true)
  expect(launchers.runtimeRoot).toBe(join(f.userData, "connector-runtime"))
  expect(Object.keys(launchers.firstPartyCacheRoots)).toEqual(["video"])
  expect(launchers.pythonFileId).toBe(`python/${platform}/3.12.16-20261124`)
  const base = { v: 1, paths: { userData: f.userData, globalRoot: f.root, initialDirectory: f.root, database: ":memory:", engineConfigDirectory: f.root, officeMcpManifest: f.input.officeMcpManifest }, platform: { credentialRef: `{file:${join(f.userData, "key")}}` }, webSearch: { killSwitch: false }, policy: {}, network: {}, engine: { modelsFetch: false, filewatcher: true }, skills: { factoryDirs: [] }, permission: {}, switches: { modelsDisabled: false, identityDisabled: false, behaviorDisabled: false, promptRebrandDisabled: false, automationDisabled: false, readonlyDisabled: false, ecosystemInherit: false, extVerbose: false } }
  expect(parseCodePuppyBootstrap({ ...base, sidecarGeneration: 2, launchers }).launchers).toEqual(launchers)
  expect((await authority.resolveAssets()).node).toBe(launchers.node)
  rmSync(join(f.resources, "connector-launchers", "runtime.json"))
  expect(() => forkLauncherAuthority(f.input)).toThrow("bundled connector launchers are unreadable")
  const lines: string[] = []
  expect(forkLauncherAuthority({ ...f.input, packaged: false, log: (line) => lines.push(line) })).toBeUndefined()
  expect(lines).toHaveLength(1)
})

test.skipIf(!platform)("main answers the sidecar host with this authority's assets and the installed declaration's dependency facts", async () => {
  const f = await fixture()
  const authority = forkLauncherAuthority(f.input)!
  const card = { id: "mcp:git", type: "mcp", name: "git", displayName: "Git", description: "", source: "official", category: "dev", version: "1.0.0", installSpec: { kind: "mcp", mcpType: "local", command: ["uvx", "mcp-server-git"], runtimeDep: ["uv", "git", "docker-for-this-test"] } } as CatalogEntry
  expect(addReceipt(process.env.CODEPUPPY_GLOBAL_DIR!, { id: "mcp:git", name: "git", type: "mcp", scope: "global", version: "1.0.0", installedAt: "2026-11-27T00:00:00.000Z", origin: "catalog" }).ok).toBe(true)
  const launches = createConnectorLaunchState("2", { retry: async () => ({ ok: true }), diagnostic: async () => ({ ok: false, error: "unavailable" }), openNetworkApproval: async () => ({ ok: false, error: "unavailable" }), chooseWorkspace: async () => ({ ok: false, error: "unavailable" }) })
  let toSidecar: (message: unknown) => void = () => {}
  const main = openConnectorLaunchMain({ sidecarGeneration: "2", authority, launches, catalogs: () => [{ entries: [card], version: "catalog-1" }], proxyPort: 4433, post: (message) => queueMicrotask(() => toSidecar(structuredClone(message))) })
  const sidecar = createConnectorLaunchSidecarHost({ sidecarGeneration: "2", launchers: structuredClone(authority.environment), post: (message) => queueMicrotask(() => main.receive(structuredClone(message))) })
  toSidecar = (message) => void sidecar.receive(message)
  try {
    expect((await sidecar.host.resolveAssets()).node).toBe(authority.environment.node)
    const facts = await sidecar.host.runtimeDependencies({ directory: f.root, server: "git", attempt: "a1" })
    expect(facts.runtimeDep).toEqual(["uv", "git", "docker-for-this-test"])
    expect(facts.missing).toContain("docker-for-this-test")
    expect(facts.missing).not.toContain("uv")
    expect(await sidecar.host.runtimeDependencies({ directory: f.root, server: "user-added", attempt: "a2" })).toEqual({ runtimeDep: [], executables: {}, missing: [] })
    // R5: the attempt's own marked proxy URL, then evidence from the real registry reaches this attempt only until it ends.
    const identity = { directory: f.root, server: "git", attempt: "a1" }
    const { proxyEnvironment } = await sidecar.host.beginEgress(identity)
    const url = new URL(proxyEnvironment.HTTPS_PROXY!)
    expect([url.hostname, url.port, proxyEnvironment.https_proxy === proxyEnvironment.HTTPS_PROXY]).toEqual(["127.0.0.1", "4433", true])
    const { attributeConnectorEgress } = await import("./connector-egress-attribution")
    attributeConnectorEgress(`Basic ${Buffer.from(`${url.username}:attempt`).toString("base64")}`, { host: "pypi.org", port: 443, outcome: "refused" })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(await sidecar.host.egressEvidence(identity)).toEqual([{ identity, host: "pypi.org", port: 443, outcome: "refused" }])
    main.dispose()
    attributeConnectorEgress(`Basic ${Buffer.from(`${url.username}:attempt`).toString("base64")}`, { host: "pypi.org", port: 443, outcome: "refused" })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(await sidecar.host.egressEvidence(identity)).toHaveLength(1)
  } finally {
    sidecar.close()
    main.dispose()
    launches.dispose()
  }
})

// Integration layer (real config file): a definition whose secret reference is unsaved turns an unclassified failure into
// 「需要填写密钥」; a concrete download failure stays what it was; saving the file clears the need.
test("main's secret facts refine only an unclassified failure", async () => {
  const { connectorSecretNeed } = await import("./connector-secret-needs")
  const { mcpPluginTargetPath } = await import("./ext-config")
  const root = realpathSync(mkdtempSync(join(tmpdir(), "launch-generation-secret-"))); roots.push(root)
  const secret = join(root, "GITHUB_PERSONAL_ACCESS_TOKEN")
  mkdirSync(join(mcpPluginTargetPath(), ".."), { recursive: true })
  writeFileSync(mcpPluginTargetPath(), JSON.stringify({ mcp: { github: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-github"], environment: { GITHUB_PERSONAL_ACCESS_TOKEN: `{file:${secret}}`, MODE: "read" } } } }))
  expect(connectorSecretNeed("github")).toEqual({ fields: ["GITHUB_PERSONAL_ACCESS_TOKEN"] })
  const f = await fixture()
  const launches = createConnectorLaunchState("2", { retry: async () => ({ ok: true }), diagnostic: async () => ({ ok: false, error: "unavailable" }), openNetworkApproval: async () => ({ ok: false, error: "unavailable" }), chooseWorkspace: async () => ({ ok: false, error: "unavailable" }) })
  const main = openConnectorLaunchMain({ sidecarGeneration: "2", authority: forkLauncherAuthority(f.input)!, launches, catalogs: () => [], proxyPort: undefined, post: () => {} })
  const failed = (server: string, failure: object) => ({ type: "codepuppy.connector-launch.changed", snapshot: { identity: { directory: f.root, server, attempt: `a-${server}` }, sidecarGeneration: "2", sequence: 1, state: { phase: "failed", failure, diagnostic: `a-${server}` } } })
  main.receive(failed("github", { kind: "unknown", detail: "401 Bad credentials" }))
  writeFileSync(mcpPluginTargetPath(), JSON.stringify({ mcp: { github: { type: "local", command: ["npx"], environment: { GITHUB_PERSONAL_ACCESS_TOKEN: `{file:${secret}}` } }, fetch: { type: "local", command: ["uvx"], environment: { KEY: `{file:${secret}}` } } } }))
  main.receive(failed("fetch", { kind: "download", detail: "ECONNREFUSED" }))
  const rows = await launches.api.list(f.root)
  expect(rows.find((row) => row.identity.server === "github")?.state).toMatchObject({ failure: { kind: "secret", fields: ["GITHUB_PERSONAL_ACCESS_TOKEN"] } })
  expect(rows.find((row) => row.identity.server === "fetch")?.state).toMatchObject({ failure: { kind: "download" } })
  writeFileSync(secret, "saved")
  expect(connectorSecretNeed("github")).toBeUndefined()
  main.dispose(); launches.dispose()
})
