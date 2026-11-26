import { testBootstrap } from "../../test-component/codepuppy-bootstrap-fixture"
import { codepuppyVideoDefinition } from "./codepuppy-video"
import { afterEach, expect, test } from "bun:test"
import { access, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import pins from "../../resources/pinned-files.json"
import type { LauncherPlatform } from "../../../util/src/codepuppy-connector-launch"
import type { PinnedFiles } from "../../../util/src/codepuppy-pinned-files"
import { checkLauncherBundle, connectorNodeSigningOptions, createLauncherAssetAuthority, describeLauncherEnvironment, finalizeLauncherSignatures, launcherFileDigest, launcherPinSet, writeLauncherInventory } from "./connector-launchers"
import { buildConnectorLaunchers } from "../../scripts/build-connector-launchers"
import { launcherFixtureSamples, launcherHeader, writeLauncherFixture } from "../../test-component/connector-launcher-fixture"

// Actual original executable headers and npm files; provenance beside the fixtures.
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function fixture(platform: LauncherPlatform = "darwin-arm64") {
  const root = await mkdtemp(join(tmpdir(), "launcher-assets-"))
  roots.push(root)
  // macOS tmpdir has a /var alias; the production authority uses the canonical userData.
  const canonical = await realpath(root)
  const resources = join(canonical, "resources")
  const { directory, entries, bundle } = await writeLauncherFixture(resources, platform)
  const input = { resources, userData: canonical, platform, bundle, pins: pins as PinnedFiles, packageManagerEnv: { npm_config_cache: join(canonical, "r1-cache") }, declarations: { video: { command: ["{codepuppyNode}", "server.js", "--cache-root", "{codepuppyCacheRoot}"] } } }
  return { root: canonical, resources, directory, entries, bundle, input }
}

test("one descriptor owns Node/uv/npm and stable per-declaration cache roots before readiness", async () => {
  const f = await fixture()
  const value = describeLauncherEnvironment(f.input)
  expect(value.node).toBe(join(f.directory, f.entries.node))
  expect(value.npmCli).toBe(join(f.directory, f.entries.npmCli))
  expect(value.packageManagerEnv).toBe(f.input.packageManagerEnv)
  expect(value.environment.UV_PYTHON).toBe("3.12.16")
  expect(value.environment.UV_PYTHON_CPYTHON_BUILD).toBe("20261124")
  expect(value.environment.UV_PYTHON_DOWNLOADS).toBe("manual")
  expect(value.environment).not.toHaveProperty("UV_CACHE_DIR")
  expect(value.environment).not.toHaveProperty("XDG_CONFIG_HOME")
  expect(value.firstPartyCacheRoots).toEqual({ video: join(f.root, "connector-runtime/first-party-cache/video") })
  const archive = describeLauncherEnvironment({ ...f.input, bundle: { ...f.bundle, form: "archives" } })
  expect(archive.node).toBe(join(f.root, "connector-launchers", launcherPinSet, f.input.platform, f.entries.node))
  expect(archive.firstPartyCacheRoots).toEqual(value.firstPartyCacheRoots)
  expect(() => describeLauncherEnvironment({ ...f.input, declarations: { "../outside": f.input.declarations.video } })).toThrow("declaration ID")
  expect(() => describeLauncherEnvironment({ ...f.input, bundle: { ...f.bundle, pinSet: "0".repeat(64) } })).toThrow("differs")
})

test("video host projection uses this bundle's Node and stable cache root even before archive expansion", async () => {
  const f = await fixture()
  const base = testBootstrap({ globalRoot: f.root, officeMcpManifest: join(f.resources, "office-mcp/tools.json") })
  expect(codepuppyVideoDefinition(base)).toBeUndefined()
  for (const form of ["expanded", "archives"] as const) {
    const launchers = describeLauncherEnvironment({ ...f.input, bundle: { ...f.bundle, form } })
    const bootstrap = { ...base, launchers }
    const definition = codepuppyVideoDefinition(bootstrap)
    expect(definition?.command).toEqual([launchers.node, join(f.resources, "video-mcp/server.js"), "{workspace}", "--cache-root", join(f.root, "connector-runtime/first-party-cache/video")])
    expect(definition?.environment).toEqual({})
    if (form === "archives") await expect(access(launchers.node)).rejects.toThrow()
  }
})

test("resolver verifies both targets, catches changed bytes and preserves valid internal links", async () => {
  for (const platform of ["darwin-arm64", "win32-x64"] as const) {
    const f = await fixture(platform)
    const host = createLauncherAssetAuthority(f.input)
    const [first, second] = await Promise.all([host.resolveAssets(), host.resolveAssets()])
    expect(first).toEqual(second)
    expect(first.platform).toBe(platform)
    await symlink("npm-cli.js", join(dirname(first.npmCli), "internal-link.js"))
    await writeLauncherInventory(f.directory, platform, "expanded")
    expect((await host.resolveAssets()).node).toBe(first.node)
    await writeFile(first.node, "changed")
    await expect(host.resolveAssets()).rejects.toThrow("content mismatch")
  }
})

test("sealed prepared digests reject a mutable cache whose inventory was forged alongside the binary", async () => {
  const f = await fixture()
  const sealed = { ...f.bundle.files }
  await writeFile(join(f.directory, f.entries.node), await launcherHeader("darwin-arm64", "uv"))
  await writeLauncherInventory(f.directory, "darwin-arm64", "expanded")
  await expect(checkLauncherBundle(f.directory, "darwin-arm64", sealed)).rejects.toThrow("sealed inventory")
})

test("target, npm closure, missing entries and symlink escapes never become ready", async () => {
  const f = await fixture()
  await expect(checkLauncherBundle(f.directory, "win32-x64")).rejects.toThrow("invalid launcher bundle")
  const saved = await readFile(join(f.directory, f.entries.node))
  await writeFile(join(f.directory, f.entries.node), await launcherHeader("win32-x64", "node"))
  await expect(writeLauncherInventory(f.directory, "darwin-arm64", "expanded")).rejects.toThrow("target mismatch")
  await writeFile(join(f.directory, f.entries.node), saved)
  const npm = join(f.directory, dirname(dirname(f.entries.npmCli)), "package.json")
  const original = await readFile(npm)
  await writeFile(npm, JSON.stringify({ ...JSON.parse(original.toString()), version: "1.0.0" }))
  await expect(writeLauncherInventory(f.directory, "darwin-arm64", "expanded")).rejects.toThrow("npm version")
  await writeFile(npm, original)
  await rm(join(f.directory, f.entries.uvx))
  await expect(writeLauncherInventory(f.directory, "darwin-arm64", "expanded")).rejects.toThrow("missing")
  await symlink(join(f.root, "outside"), join(f.directory, "escape"))
  await writeFile(join(f.root, "outside"), "outside")
  await expect(writeLauncherInventory(f.directory, "darwin-arm64", "expanded")).rejects.toThrow("escapes root")
})

test("Node entitlements match only the precise packaged executable; inventory refresh seals signed bytes", async () => {
  const app = resolve("/Applications/Code Puppy.app")
  const node = join(app, "Contents/Resources/connector-launchers/node/bin/node")
  expect(connectorNodeSigningOptions(node, app, "/bundle/node.plist")).toEqual({ entitlements: "/bundle/node.plist", hardenedRuntime: true })
  for (const file of [app, node + "-other", join(app, "Contents/Frameworks/Helper.app"), join(app, "Contents/Resources/office-runtime/bin/python3")]) expect(connectorNodeSigningOptions(file, app, "/bundle/node.plist")).toBeUndefined()
  const f = await fixture()
  await writeFile(join(f.directory, f.entries.node), await launcherHeader("darwin-arm64", "uv"))
  finalizeLauncherSignatures(f.resources)
  const result = await checkLauncherBundle(f.directory, "darwin-arm64")
  expect(result.files[f.entries.node]).toBe(await launcherFileDigest(join(f.directory, f.entries.node)))
})

test("build rejects a source that differs from the lock before publishing a bundle", async () => {
  const f = await fixture()
  const destination = join(f.root, "unpublished")
  await expect(buildConnectorLaunchers({ platform: "darwin-arm64", destination, form: "expanded", archives: { uv: join(f.directory, f.entries.uv), node: join(f.directory, f.entries.node) }, licenses: launcherFixtureSamples })).rejects.toThrow("archive integrity mismatch")
  await expect(access(destination)).rejects.toThrow()
})
