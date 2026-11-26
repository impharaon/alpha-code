import { testBootstrap } from "../../test-component/codepuppy-bootstrap-fixture"
import { codepuppyVideoDefinition } from "./codepuppy-video"
import { afterEach, expect, test } from "bun:test"
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createHash } from "node:crypto"
import { declaredFirstPartyTools } from "../../../core/src/mcp/codepuppy-first-party-mcp"
import { createPinnedFileAuthority } from "./pinned-files"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import pins from "../../resources/pinned-files.json"
import type { LauncherPlatform, ManagedFirstPartyBinding, PinnedEntryRecipe, PinnedPreparationProgress } from "../../../util/src/codepuppy-connector-launch"
import type { PinnedFiles } from "../../../util/src/codepuppy-pinned-files"
import { checkLauncherBundle, connectorNodeSigningOptions, createLauncherAssetAuthority, describeLauncherEnvironment, extractLauncherArchive, finalizeLauncherSignatures, launcherFileDigest, launcherPinSet, writeLauncherInventory } from "./connector-launchers"
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

// Integration: owned declarations; payload is the actual shipped pin manifest. Archives are made by system tar.
async function managedAsset(archive: PinnedEntryRecipe["archive"] = "file", payload?: Uint8Array) {
  const f = await fixture()
  const id = "speech-model/any/owned-fixture" as const
  const source = join(f.root, "source")
  await mkdir(join(source, "model"), { recursive: true })
  await writeFile(join(source, "model/data.json"), await readFile(new URL("../../resources/pinned-files.json", import.meta.url)))
  await symlink("data.json", join(source, "model/internal.json"))
  await symlink(".", join(source, "self"))
  if (archive !== "file") {
    const flags = { zip: ["--format=zip", "-cf"], "tar.gz": ["-czf"], "tar.bz2": ["-cjf"], "tar.xz": ["-cJf"] }
    await promisify(execFile)("/usr/bin/tar", [...flags[archive], join(f.root, "source.archive"), "-C", source, "model", "self"])
  }
  const bytes = payload ?? (archive === "file" ? await readFile(join(source, "model/data.json")) : await readFile(join(f.root, "source.archive")))
  const own = { id, family: "speech-model" as const, target: "any" as const, version: "1.0.0", originUrl: "https://github.com/impharaon/alpha-code/releases/download/owned-fixture/data", provenanceUrl: "https://github.com/impharaon/alpha-code", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }
  const manifest: PinnedFiles = { schemaVersion: 1, files: [...f.input.pins.files, own] }
  const recipe: PinnedEntryRecipe = { id, archive, entry: archive === "file" ? "model/data.json" : "model", required: archive === "file" ? ["model/data.json"] : ["model", "model/data.json", "model/internal.json", "self"] }
  const code = new TextEncoder().encode("export const owned = true\n")
  await mkdir(join(f.resources, "office-mcp"), { recursive: true })
  await writeFile(join(f.resources, "owned.js"), code)
  const manifestPath = join(f.resources, "office-mcp/tools.json")
  await writeFile(manifestPath, JSON.stringify({ formats: { own: { command: ["{codepuppyNode}", "{codepuppyResources}/owned.js"], environment: {}, cwd: null, codeSha256: { "owned.js": createHash("sha256").update(code).digest("hex") }, tools: [], recipe: [recipe] } } }))
  const host = createLauncherAssetAuthority({ ...f.input, pins: manifest })
  const entry = { type: "local" as const, command: [host.environment.node, join(f.resources, "owned.js")] }
  const declared = declaredFirstPartyTools("own", entry, manifestPath, readFileSync, undefined, host.environment)!
  const binding: ManagedFirstPartyBinding = { identity: { directory: f.root, server: "own", attempt: "own-attempt" }, sidecarGeneration: "owned-generation", entry, declarationSha256: declared.declarationSha256, recipeSha256: declared.recipeSha256 }
  let downloads = 0
  const files = createPinnedFileAuthority({ userData: f.root, manifest, fetchImpl: async () => { downloads++; return new Response(bytes, { headers: { "content-length": String(bytes.length) } }) } })
  const context = { sidecarGeneration: binding.sidecarGeneration, manifestPath, files, snapshots: { list: async () => [{ identity: binding.identity, sidecarGeneration: binding.sidecarGeneration, sequence: 1, state: { phase: "connected" as const } }] } }
  const progress: PinnedPreparationProgress[] = []
  const run = (value = binding, ids: readonly string[] = [id]) => host.prepareFiles(context, { binding: value, ids }, new AbortController().signal, (update) => progress.push(update))
  return { ...f, host, context, binding, recipe, bytes, manifest, progress, run, downloads: () => downloads }
}

test("managed entry preparation uses the pinned authority and reuses only complete recipe entries", async () => {
  const f = await managedAsset()
  const first = await f.run(f.binding, [f.recipe.id, f.recipe.id])
  if (!first.ok) throw Error(first.error)
  expect(first.files).toHaveLength(1)
  expect(await readFile(first.files[0]!.path)).toEqual(f.bytes)
  expect(f.downloads()).toBe(1)
  expect(f.progress.at(-1)?.phase).toBe("ready")
  expect(f.progress.every((update, index) => update.sequence === index + 1)).toBe(true)
  expect(await f.run()).toEqual(first)
  expect(f.downloads()).toBe(1)
  await rm(first.files[0]!.path)
  expect(await f.run()).toEqual(first)
  expect(await readFile(first.files[0]!.path)).toEqual(f.bytes)
  expect(f.downloads()).toBe(1)
})

test("managed bindings recheck exact identity declaration and every id before downloading", async () => {
  const f = await managedAsset()
  for (const binding of [
    { ...f.binding, sidecarGeneration: "old" },
    { ...f.binding, identity: { ...f.binding.identity, attempt: "old" } },
    { ...f.binding, declarationSha256: "0".repeat(64) },
    { ...f.binding, recipeSha256: "0".repeat(64) },
    { ...f.binding, entry: { ...f.binding.entry, command: [f.host.environment.node + "-other", ...f.binding.entry.command.slice(1)] } },
    { ...f.binding, entry: { ...f.binding.entry, environment: { NODE_OPTIONS: "--require ./other" } } },
    { ...f.binding, entry: { ...f.binding.entry, cwd: f.root } },
  ]) expect(await f.run(binding)).toEqual({ ok: false, error: "unknown-file" })
  expect(await f.run(f.binding, [f.recipe.id, "speech-model/any/not-in-recipe"])).toEqual({ ok: false, error: "unknown-file" })
  await writeFile(join(f.resources, "owned.js"), "changed protected code")
  expect(await f.run()).toEqual({ ok: false, error: "unknown-file" })
  expect(f.downloads()).toBe(0)
})

test("managed archive preparation preserves internal links and coalesces concurrent unpack", async () => {
  const f = await managedAsset("tar.gz")
  const [first, second] = await Promise.all([f.run(), f.run()])
  expect(first).toEqual(second)
  if (!first.ok) throw Error(first.error)
  const directory = first.files[0]!.path
  expect(await realpath(join(directory, "internal.json"))).toBe(join(directory, "data.json"))
  expect(await readFile(join(directory, "data.json"))).toEqual(await readFile(new URL("../../resources/pinned-files.json", import.meta.url)))
  expect(f.downloads()).toBe(1)
  expect((await readdir(dirname(directory))).sort()).toEqual(["model", "ready.json", "self"])
})

test("managed asset verification rejects a different binary target and reports integrity evidence", async () => {
  const f = await managedAsset("file", await launcherHeader("win32-x64", "node"))
  expect(await f.run()).toEqual({ ok: false, error: "integrity" })
  expect(f.progress.at(-1)).toMatchObject({ phase: "failed", error: "integrity", failure: { kind: "integrity", detail: "prepared binary target mismatch" } })
})

test("managed asset parents cannot redirect writes outside the app data root", async () => {
  const f = await managedAsset()
  const outside = await mkdtemp(join(tmpdir(), "managed-outside-"))
  roots.push(outside)
  await mkdir(f.host.environment.runtimeRoot)
  await symlink(outside, join(f.host.environment.runtimeRoot, "assets"))
  expect(await f.run()).toEqual({ ok: false, error: "integrity" })
  expect(await readdir(outside)).toEqual([])
})

for (const archive of ["zip", "tar.bz2", "tar.xz"] as const)
  test(`managed ${archive} recipes use the same system archive adapter`, async () => {
    const f = await managedAsset(archive)
    const result = await f.run()
    if (!result.ok) throw Error(result.error)
    expect(await readFile(join(result.files[0]!.path, "data.json"))).toEqual(await readFile(new URL("../../resources/pinned-files.json", import.meta.url)))
    expect(await realpath(join(dirname(result.files[0]!.path), "self"))).toBe(dirname(result.files[0]!.path))
  })

test("system archive extraction does not write through a link outside its staging root", async () => {
  const f = await fixture()
  const source = join(f.root, "unsafe-source")
  const destination = join(f.root, "candidate")
  const outside = join(f.root, "outside")
  for (const directory of [source, destination, outside]) await mkdir(directory)
  await symlink(outside, join(source, "link"))
  await writeFile(join(source, "file"), "owned fixture bytes")
  const archive = join(f.root, "unsafe.tar")
  await promisify(execFile)("/usr/bin/tar", ["-cf", archive, "-s", "|^file$|link/owned|", "-C", source, "link", "file"])
  await expect(extractLauncherArchive(archive, destination, "tar.gz")).rejects.toThrow()
  expect(await readdir(outside)).toEqual([])
})

test("cancelling a managed download detaches one waiter while another prepares the entry", async () => {
  const f = await managedAsset()
  let release: () => void = () => {}
  const wait = new Promise<void>((resolve) => { release = resolve })
  let both: () => void = () => {}
  const entered = new Promise<void>((resolve) => { both = resolve })
  let calls = 0
  const authority = createPinnedFileAuthority({ userData: f.root, manifest: f.manifest, fetchImpl: async () => {
    calls++
    return new Response(new ReadableStream({ start(controller) { void wait.then(() => { controller.enqueue(f.bytes); controller.close() }) } }), { headers: { "content-length": String(f.bytes.length) } })
  } })
  let joined = 0
  const context = { ...f.context, files: { ensureFile: (...args: Parameters<typeof authority.ensureFile>) => { const result = authority.ensureFile(...args); if (++joined === 2) both(); return result } } }
  const cancelled = new AbortController()
  const first = f.host.prepareFiles(context, { binding: f.binding, ids: [f.recipe.id] }, cancelled.signal, () => {})
  const second = f.host.prepareFiles(context, { binding: f.binding, ids: [f.recipe.id] }, new AbortController().signal, () => {})
  await entered
  cancelled.abort()
  release()
  expect(await first).toEqual({ ok: false, error: "cancelled" })
  const result = await second
  expect(result.ok).toBe(true)
  if (result.ok) expect(await readFile(result.files[0]!.path)).toEqual(f.bytes)
  expect(calls).toBe(1)
})
