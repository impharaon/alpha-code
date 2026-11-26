import { execFile, spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { createReadStream, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { access, cp, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { LauncherEnvironment, LauncherPlatform, ConnectorLaunchApi, ConnectorLaunchHost, ManagedFirstPartyBinding, ManagedPinnedFilesResult, PinnedEntryRecipe, PinnedPreparationProgress, DownloadFailureEvidence, PinnedFileDelivery } from "../../../util/src/codepuppy-connector-launch"
import { canonicalJsonDigest } from "../../../util/src/codepuppy-hash"
import { declaredFirstPartyTools } from "../../../core/src/mcp/codepuppy-first-party-mcp"
import { ensurePinnedDirectory } from "./pinned-files"
import type { PinnedFiles, PinnedFileId, EnsurePinnedFileResult } from "../../../util/src/codepuppy-pinned-files"
import lock from "../../resources/connector-launchers/lock.json"
import { videoBinaryTarget } from "../../scripts/video-runtime-artifacts"
import { USER_DATA_LAYOUT } from "./user-data-layout"

const execute = promisify(execFile)
export const CONNECTOR_LAUNCHER_BUILD_DIR = "native/connector-launchers/build"
export const launcherPinSet = createHash("sha256").update(JSON.stringify(lock)).digest("hex")
export type LauncherBundle = { schemaVersion: 1; platform: LauncherPlatform; pinSet: string; form: "expanded" | "archives"; files: Record<string, string>; preparedFiles?: Record<string, string> }

export function launcherEntries(platform: LauncherPlatform) {
  const windows = platform === "win32-x64"
  const npm = windows ? "node/node_modules/npm" : "node/lib/node_modules/npm"
  return { uv: `uv/uv${windows ? ".exe" : ""}`, uvx: `uv/uvx${windows ? ".exe" : ""}`, node: windows ? "node/node.exe" : "node/bin/node", npmCli: `${npm}/bin/npm-cli.js`, npxCli: `${npm}/bin/npx-cli.js` }
}

const safe = (root: string, name: string) => {
  if (!name || isAbsolute(name) || name.split(/[\\/]/).some((part) => part === "..") || /^[a-z]:/i.test(name)) throw Error("launcher member escapes root")
  const file = resolve(root, name)
  if (!file.startsWith(resolve(root) + sep)) throw Error("launcher member escapes root")
  return file
}

export async function launcherFileDigest(file: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

/** System archive tools retain internal links and executable bits; no package code is run. */
export async function extractLauncherArchive(archive: string, destination: string, kind: Exclude<PinnedEntryRecipe["archive"], "file">) {
  const tar = process.platform === "win32" ? join(process.env.SystemRoot!, "System32", "tar.exe") : "/usr/bin/tar"
  const listing = await new Promise<string>((resolve, reject) => {
    const child = spawn(tar, ["-tf", archive])
    let output = ""
    let error = ""
    child.stdout.on("data", (chunk) => { output += chunk })
    child.stderr.on("data", (chunk) => { error += chunk })
    child.on("error", reject)
    child.on("close", (code) => code === 0 ? resolve(output) : reject(Error(error)))
  })
  for (const member of listing.split(/\r?\n/).filter(Boolean)) {
    if (member === "." || member === "./") continue
    safe(destination, member.replace(/\/$/, ""))
  }
  if (process.platform === "win32" && kind === "zip") {
    const scratch = await mkdtemp(join(dirname(destination), "launcher-zip-"))
    try {
      const zip = join(scratch, "source.zip")
      await cp(archive, zip)
      const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
      await execute(join(process.env.SystemRoot!, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath ${quote(zip)} -DestinationPath ${quote(destination)} -Force`], { windowsHide: true })
    } finally { await rm(scratch, { recursive: true, force: true }) }
  }
  if (process.platform !== "win32" || kind !== "zip") await execute(tar, ["-xf", archive, "-C", destination])
  await launcherFiles(destination) // Verify link targets as well as lexical members.
}

async function launcherFiles(root: string) {
  const canonical = await realpath(root)
  const visit = async (directory: string): Promise<string[]> => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(async (entry) => {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) return visit(file)
    const target = await realpath(file)
    if (target !== canonical && !target.startsWith(canonical + sep)) throw Error("launcher link escapes root")
    if ((await stat(target)).isDirectory()) return [] // Internal directory links retain their original shape.
    if (!(await stat(target)).isFile()) throw Error("launcher member is not a file")
    return [relative(root, file).split(sep).join("/")]
  }))).flat()
  return visit(root)
}

export async function populateLauncherTree(destination: string, archives: { uv: string; node: string }, platform: LauncherPlatform) {
  const scratch = await mkdtemp(join(dirname(destination), "launcher-unpack-"))
  try {
    await Promise.all(["uv", "node"].map(async (kind) => {
      const name = kind as keyof typeof archives
      const pin = lock[name].targets[platform]
      if ((await stat(archives[name])).size !== pin.bytes || await launcherFileDigest(archives[name]) !== pin.sha256) throw Error(`launcher archive integrity mismatch: ${kind}`)
      const directory = join(scratch, kind)
      await mkdir(directory)
      await extractLauncherArchive(archives[name], directory, platform === "win32-x64" ? "zip" : name === "uv" ? "tar.gz" : "tar.xz")
      const source = join(directory, pin.root)
      await mkdir(join(destination, kind), { recursive: true })
      if (kind === "uv") {
        for (const binary of ["uv", "uvx"]) {
          const file = binary + (platform === "win32-x64" ? ".exe" : "")
          await cp(join(source, file), join(destination, kind, file), { preserveTimestamps: true })
        }
        return
      }
      for (const member of platform === "win32-x64" ? ["node.exe", "node_modules", "LICENSE"] : ["bin", "lib", "LICENSE"]) {
        await cp(join(source, member), join(destination, kind, member), { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true })
      }
      const npm = platform === "win32-x64" ? "node/node_modules/npm" : "node/lib/node_modules/npm"
      await rm(join(destination, npm, "docs"), { recursive: true, force: true })
    }))
  } finally { await rm(scratch, { recursive: true, force: true }) }
}

export async function writeLauncherInventory(directory: string, platform: LauncherPlatform, form: LauncherBundle["form"], preparedFiles?: Record<string, string>) {
  const files = (await launcherFiles(directory)).filter((file) => file !== "runtime.json")
  const manifest: LauncherBundle = { schemaVersion: 1, platform, pinSet: launcherPinSet, form, files: Object.fromEntries(await Promise.all(files.map(async (file) => [file, await launcherFileDigest(join(directory, file))]))), ...(form === "archives" ? { preparedFiles } : {}) }
  await writeFile(join(directory, "runtime.json"), JSON.stringify(manifest, null, 2) + "\n")
  await checkLauncherBundle(directory, platform)
  return manifest
}

export async function checkLauncherBundle(directory: string, platform: LauncherPlatform, expectedFiles?: Record<string, string>): Promise<LauncherBundle> {
  const manifest: LauncherBundle = JSON.parse(await readFile(join(directory, "runtime.json"), "utf8"))
  if (manifest.schemaVersion !== 1 || manifest.platform !== platform || manifest.pinSet !== launcherPinSet || !["expanded", "archives"].includes(manifest.form) || !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) throw Error("invalid launcher bundle")
  if (expectedFiles && (Object.keys(expectedFiles).length !== Object.keys(manifest.files).length || Object.entries(expectedFiles).some(([file, digest]) => manifest.files[file] !== digest))) throw Error("prepared launchers differ from sealed inventory")
  for (const [file, digest] of Object.entries(manifest.files)) {
    const target = safe(directory, file)
    if (!/^[0-9a-f]{64}$/.test(digest) || !(await realpath(target)).startsWith(await realpath(directory) + sep) || await launcherFileDigest(target) !== digest) throw Error(`launcher content mismatch: ${file}`)
  }
  const required = manifest.form === "archives" ? ["archives/uv", "archives/node"] : Object.values(launcherEntries(platform))
  for (const file of [...required, ...lock.licenses.map((license) => `licenses/uv/${license.name}`), "licenses/node/LICENSE"]) if (!Object.hasOwn(manifest.files, file)) throw Error(`launcher bundle missing ${file}`)
  if (manifest.form === "archives") {
    if (!manifest.preparedFiles || typeof manifest.preparedFiles !== "object" || Object.values(launcherEntries(platform)).some((file) => !Object.hasOwn(manifest.preparedFiles!, file))) throw Error("launcher archive has no sealed prepared inventory")
    for (const kind of ["uv", "node"] as const) {
      const file = join(directory, "archives", kind)
      if ((await stat(file)).size !== lock[kind].targets[platform].bytes || manifest.files[`archives/${kind}`] !== lock[kind].targets[platform].sha256) throw Error("launcher archive differs from source lock")
    }
    return manifest
  }
  const entries = launcherEntries(platform)
  for (const binary of [entries.uv, entries.uvx, entries.node]) {
    const file = join(directory, binary)
    const handle = await open(file)
    const header = Buffer.alloc(4096)
    try { await handle.read(header, 0, header.length, 0) } finally { await handle.close() }
    if (videoBinaryTarget(header) !== platform) throw Error(`launcher binary target mismatch: ${binary}`)
    if (platform === "darwin-arm64") await access(file, constants.X_OK)
  }
  const npm = JSON.parse(await readFile(join(directory, dirname(dirname(entries.npmCli)), "package.json"), "utf8"))
  if (npm.version !== lock.node.npmVersion) throw Error("launcher npm version differs from source lock")
  return manifest
}

/** This descriptor consumes #1759's already computed env; it never computes package-manager locations. */
export function describeLauncherEnvironment(input: { resources: string; userData: string; platform: LauncherPlatform; bundle: LauncherBundle; pins: PinnedFiles; packageManagerEnv: LauncherEnvironment["packageManagerEnv"]; declarations: Record<string, { command: readonly string[] }> }): LauncherEnvironment {
  if (input.bundle.platform !== input.platform || input.bundle.pinSet !== launcherPinSet) throw Error("launcher descriptor differs from bundle")
  const userData = realpathSync(input.userData)
  const runtimeRoot = join(userData, USER_DATA_LAYOUT.connectorRuntime)
  const root = input.bundle.form === "expanded" ? join(realpathSync(input.resources), "connector-launchers") : join(userData, USER_DATA_LAYOUT.connectorLaunchers, launcherPinSet, input.platform)
  const pin = input.pins.files.find((file) => file.family === "python" && file.target === input.platform)
  if (!pin) throw Error("launcher Python pin missing")
  const build = new URL(pin.originUrl).pathname.split("/").at(-2)!
  if (!/^\d{8}$/.test(build)) throw Error("launcher Python build is not pinned")
  const firstPartyCacheRoots = Object.fromEntries(Object.entries(input.declarations).filter(([, value]) => value.command.includes("{codepuppyCacheRoot}")).map(([id]) => {
    if (!id || id === "." || id === ".." || /[\\/\x00-\x1f:]/.test(id)) throw Error("invalid first-party declaration ID")
    return [id, join(runtimeRoot, USER_DATA_LAYOUT.firstPartyCache, id)]
  }))
  const entries = launcherEntries(input.platform)
  return {
    platform: input.platform, pinSet: launcherPinSet, ...Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, join(root, file)])) as typeof entries,
    runtimeRoot, pythonFileId: pin.id, packageManagerEnv: input.packageManagerEnv, firstPartyCacheRoots,
    environment: { UV_PYTHON: pin.version, UV_PYTHON_CPYTHON_BUILD: build, UV_PYTHON_PREFERENCE: "only-managed", UV_PYTHON_DOWNLOADS: "manual", UV_PYTHON_INSTALL_BIN: "false", UV_PYTHON_BIN_DIR: join(runtimeRoot, "uv", "python-bin"), UV_PYTHON_INSTALL_MIRROR: pathToFileURL(join(runtimeRoot, "python-mirror")).href, TMPDIR: join(runtimeRoot, "tmp"), TMP: join(runtimeRoot, "tmp"), TEMP: join(runtimeRoot, "tmp"), XDG_CACHE_HOME: join(runtimeRoot, "cache"), XDG_DATA_HOME: join(runtimeRoot, "data") },
  }
}

export function createLauncherAssetAuthority(input: Parameters<typeof describeLauncherEnvironment>[0]) {
  const environment = describeLauncherEnvironment(input)
  const entries = new Map<string, Promise<string>>()
  let pythonMirror: Promise<void> | undefined
  let pending: Promise<LauncherEnvironment> | undefined
  const resolveAssets = async () => {
    const bundled = join(input.resources, "connector-launchers")
    await checkLauncherBundle(bundled, input.platform)
    if (input.bundle.form === "expanded") return environment
    const destination = dirname(dirname(environment.uv))
    if (
      await lstat(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error
      })
    ) {
      if ((await realpath(destination)) !== destination) throw Error("launcher ready root is a symlink")
      const valid = await checkLauncherBundle(destination, input.platform, input.bundle.preparedFiles).then(
        () => true,
        () => false,
      )
      if (valid) return environment
      await rm(destination, { recursive: true, force: true })
    }
    await mkdir(dirname(destination), { recursive: true })
    if ((await realpath(dirname(destination))) !== dirname(destination)) throw Error("launcher parent is a symlink")
    const staging = await mkdtemp(join(dirname(destination), "launcher-candidate-"))
    try {
      await populateLauncherTree(
        staging,
        { uv: join(bundled, "archives/uv"), node: join(bundled, "archives/node") },
        input.platform,
      )
      await cp(join(bundled, "licenses"), join(staging, "licenses"), { recursive: true })
      await writeLauncherInventory(staging, input.platform, "expanded")
      await checkLauncherBundle(staging, input.platform, input.bundle.preparedFiles)
      await rename(staging, destination)
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
    return environment
  }
  const failed = (result: Extract<EnsurePinnedFileResult, { ok: false }>, failure?: DownloadFailureEvidence) => ({
    result,
    delivery: { result, ...(failure ? { failure } : {}) },
  })
  const prepareFiles = async (
    context: {
      sidecarGeneration: string
      snapshots: Pick<ConnectorLaunchApi, "list">
      manifestPath: string
      files: Pick<ConnectorLaunchHost, "ensureFile">
    },
    request: { binding: ManagedFirstPartyBinding; ids: readonly string[] },
    signal: AbortSignal,
    report: (update: PinnedPreparationProgress) => void,
  ): Promise<{ result: ManagedPinnedFilesResult; delivery: PinnedFileDelivery }> => {
    if (signal.aborted) return failed({ ok: false, error: "cancelled" })
    const binding = request.binding
    const current =
      binding.sidecarGeneration === context.sidecarGeneration &&
      (await context.snapshots.list(binding.identity.directory)).some(
        (row) =>
          row.sidecarGeneration === context.sidecarGeneration &&
          row.identity.directory === binding.identity.directory &&
          row.identity.server === binding.identity.server &&
          row.identity.attempt === binding.identity.attempt,
      )
    const declared = current
      ? declaredFirstPartyTools(
          binding.identity.server,
          binding.entry,
          context.manifestPath,
          readFileSync,
          undefined,
          environment,
        )
      : undefined
    const recipes = new Map(declared?.recipe?.map((recipe) => [recipe.id, recipe]))
    const pins = new Map(input.pins.files.map((file) => [file.id, file]))
    const ids = [...new Set(request.ids)]
    let sequence = 0
    if (
      !current ||
      !declared ||
      declared.declarationSha256 !== binding.declarationSha256 ||
      declared.recipeSha256 !== binding.recipeSha256 ||
      ![...recipes.keys()].every((id) => pins.has(id)) ||
      !ids.length ||
      !ids.every((id) => {
        const pin = pins.get(id as PinnedEntryRecipe["id"])
        return (
          recipes.has(id as PinnedEntryRecipe["id"]) && pin && (pin.target === "any" || pin.target === input.platform)
        )
      })
    ) {
      for (const id of ids)
        if (pins.has(id as PinnedEntryRecipe["id"]) && !signal.aborted)
          report({
            id: id as PinnedEntryRecipe["id"],
            sequence: ++sequence,
            phase: "failed",
            error: "unknown-file",
            failure: { kind: "other", detail: "Managed pinned-file binding, declaration or recipe is not current" },
          })
      return failed(
        { ok: false, error: "unknown-file" },
        { kind: "other", detail: "Managed pinned-file binding, declaration or recipe is not current" },
      )
    }
    const files: Extract<ManagedPinnedFilesResult, { ok: true }>["files"] = []
    const deliveries: PinnedFileDelivery[] = []
    for (const id of ids) {
      const recipe = recipes.get(id as PinnedEntryRecipe["id"])!
      const pin = pins.get(recipe.id)!
      const emit = (update: Omit<PinnedPreparationProgress, "id" | "sequence">) => {
        if (!signal.aborted) report({ ...update, id: recipe.id, sequence: ++sequence })
      }
      emit({ phase: "download", receivedBytes: 0, totalBytes: pin.bytes })
      const delivery = await context.files.ensureFile(recipe.id, signal, (receivedBytes, totalBytes) =>
        emit({ phase: "download", receivedBytes, totalBytes }),
      )
      if (!delivery.result.ok) {
        emit({
          phase: delivery.result.error === "cancelled" ? "cancelled" : "failed",
          error: delivery.result.error,
          ...(delivery.failure ? { failure: delivery.failure } : {}),
        })
        return failed(delivery.result, delivery.failure)
      }
      if (signal.aborted) return failed({ ok: false, error: "cancelled" })
      const archive = delivery.result.path
      emit({ phase: "unpack" })
      const key = canonicalJsonDigest({
        id: recipe.id,
        sha256: pin.sha256,
        recipeSha256: binding.recipeSha256,
        platform: input.platform,
      })
      const shared =
        entries.get(key) ??
        (() => {
          const work = preparePinnedEntry(
            environment,
            pin,
            recipe,
            binding.recipeSha256,
            archive,
            realpathSync(input.userData),
          ).finally(() => entries.delete(key))
          entries.set(key, work)
          return work
        })()
      const prepared = await new Promise<
        | { ok: true; path: string }
        | { ok: false; error: "disk" | "integrity" | "cancelled"; failure?: DownloadFailureEvidence }
      >((resolve) => {
        const finish = (
          value:
            | { ok: true; path: string }
            | { ok: false; error: "disk" | "integrity" | "cancelled"; failure?: DownloadFailureEvidence },
        ) => {
          signal.removeEventListener("abort", abort)
          resolve(signal.aborted ? { ok: false, error: "cancelled" } : value)
        }
        const abort = () => finish({ ok: false, error: "cancelled" })
        signal.addEventListener("abort", abort, { once: true })
        if (signal.aborted) abort()
        void shared.then(
          (path) => finish({ ok: true, path }),
          (error: unknown) => {
            const kind =
              error instanceof Error && "code" in error && typeof error.code === "string" ? "disk" : "integrity"
            finish({
              ok: false,
              error: kind,
              failure: { kind, detail: error instanceof Error ? error.message : String(error) },
            })
          },
        )
      })
      if (!prepared.ok) {
        emit({
          phase: prepared.error === "cancelled" ? "cancelled" : "failed",
          error: prepared.error,
          ...(prepared.failure ? { failure: prepared.failure } : {}),
        })
        return failed({ ok: false, error: prepared.error }, prepared.failure)
      }
      emit({ phase: "verify" })
      files.push({ id: recipe.id, path: prepared.path })
      deliveries.push({ result: { ...delivery.result, path: prepared.path } })
      emit({ phase: "ready" })
    }
    return signal.aborted
      ? failed({ ok: false, error: "cancelled" })
      : { result: { ok: true, files }, delivery: deliveries.at(-1)! }
  }
  return {
    environment,
    resolveAssets() {
      return (pending ??= resolveAssets().finally(() => {
        pending = undefined
      }))
    },
    async ensureFile(files: Pick<ConnectorLaunchHost, "ensureFile">, id: PinnedFileId, signal: AbortSignal, progress: (received: number, total: number) => void): Promise<PinnedFileDelivery> {
      const delivery = await files.ensureFile(id, signal, progress)
      if (!delivery.result.ok || id !== environment.pythonFileId || signal.aborted) return signal.aborted ? { result: { ok: false, error: "cancelled" } } : delivery
      const archive = delivery.result.path
      const pin = input.pins.files.find((file) => file.id === id)!
      pythonMirror ??= (async () => {
        const directory = join(fileURLToPath(environment.environment.UV_PYTHON_INSTALL_MIRROR!), environment.environment.UV_PYTHON_CPYTHON_BUILD!)
        await ensurePinnedDirectory(realpathSync(input.userData), directory)
        // The download authority already decoded the original filename exactly once.
        const destination = join(directory, basename(archive))
        const info = await lstat(destination).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error })
        if (info?.isSymbolicLink() || (info && !info.isFile())) throw Error("Python mirror is not a regular file")
        if (info?.size === pin.bytes && await launcherFileDigest(destination) === pin.sha256) return
        const temporary = `${destination}.${randomUUID()}.part`
        try {
          await cp(archive, temporary, { preserveTimestamps: true })
          if ((await stat(temporary)).size !== pin.bytes || await launcherFileDigest(temporary) !== pin.sha256) throw Error("Python mirror integrity mismatch")
          await rename(temporary, destination)
        } finally { await rm(temporary, { force: true }) }
      })().finally(() => { pythonMirror = undefined })
      try { await pythonMirror }
      catch (error) { return { result: { ok: false, error: "disk" }, failure: { kind: "disk", detail: error instanceof Error ? error.message : String(error) } } }
      return signal.aborted ? { result: { ok: false, error: "cancelled" } } : delivery
    },
    // Both domains share validation, download and unpack. The ID bridge retains original delivery provenance.
    async prepareFiles(...args: Parameters<typeof prepareFiles>): Promise<ManagedPinnedFilesResult> {
      return (await prepareFiles(...args)).result
    },
    async ensureEntry(
      context: Parameters<typeof prepareFiles>[0],
      binding: ManagedFirstPartyBinding,
      id: PinnedFileId,
      signal: AbortSignal,
      report: (update: PinnedPreparationProgress) => void,
    ): Promise<PinnedFileDelivery> {
      return (await prepareFiles(context, { binding, ids: [id] }, signal, report)).delivery
    },
  }
}

async function preparePinnedEntry(
  environment: LauncherEnvironment,
  pin: PinnedFiles["files"][number],
  recipe: PinnedEntryRecipe,
  recipeSha256: string,
  archive: string,
  userData: string,
) {
  const destination = safe(join(environment.runtimeRoot, "assets"), `${pin.id}/${recipeSha256}`)
  await ensurePinnedDirectory(userData, dirname(destination))
  const receipt = {
    schema: 1,
    ready: true,
    id: pin.id,
    sha256: pin.sha256,
    recipeSha256,
    platform: environment.platform,
  }
  const ready = await readFile(join(destination, "ready.json"), "utf8").then(
    (text) => {
      try {
        return JSON.parse(text)
      } catch {
        return undefined
      }
    },
    () => undefined,
  )
  if (
    JSON.stringify(ready) === JSON.stringify(receipt) &&
    (await verifyPinnedEntry(destination, recipe, environment.platform).then(
      () => true,
      () => false,
    ))
  )
    return safe(destination, recipe.entry)
  const prior = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
  })
  if (prior?.isSymbolicLink()) throw Error("prepared asset root is a symlink")
  if (prior) await rm(destination, { recursive: true, force: true })
  const staging = await mkdtemp(join(dirname(destination), "asset-candidate-"))
  try {
    if (recipe.archive === "file") {
      await mkdir(dirname(safe(staging, recipe.entry)), { recursive: true })
      await cp(archive, safe(staging, recipe.entry), { preserveTimestamps: true })
    }
    if (recipe.archive !== "file") await extractLauncherArchive(archive, staging, recipe.archive)
    await verifyPinnedEntry(staging, recipe, environment.platform)
    await writeFile(join(staging, "ready.json"), JSON.stringify(receipt))
    await rename(staging, destination)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  return safe(destination, recipe.entry)
}

async function verifyPinnedEntry(root: string, recipe: PinnedEntryRecipe, platform: LauncherPlatform) {
  if ((await realpath(root)) !== root || !(await lstat(root)).isDirectory())
    throw Error("prepared asset root is not a real directory")
  for (const member of new Set([recipe.entry, ...recipe.required])) {
    const file = safe(root, member)
    const targetPath = await realpath(file)
    if (targetPath !== root && !targetPath.startsWith(root + sep)) throw Error("prepared member escapes root")
    const info = await stat(file)
    if (info.isDirectory()) continue
    if (!info.isFile()) throw Error("prepared member is not a file or directory")
    const handle = await open(file)
    const header = Buffer.alloc(4096)
    try {
      await handle.read(header, 0, header.length, 0)
    } finally {
      await handle.close()
    }
    const target = videoBinaryTarget(header)
    if (target && target !== platform) throw Error("prepared binary target mismatch")
  }
}

/** Recompute only after the packaging signer has signed children, immediately before the parent resource seal. */
export function finalizeLauncherSignatures(resources: string) {
  const directory = join(resources, "connector-launchers")
  const file = join(directory, "runtime.json")
  const manifest: LauncherBundle = JSON.parse(readFileSync(file, "utf8"))
  manifest.files = Object.fromEntries(Object.keys(manifest.files).map((name) => [name, createHash("sha256").update(readFileSync(safe(directory, name))).digest("hex")]))
  writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n")
}

export function connectorNodeSigningOptions(file: string, app: string, entitlements: string) {
  if (resolve(file) !== resolve(app, "Contents/Resources/connector-launchers", launcherEntries("darwin-arm64").node)) return
  return { entitlements, hardenedRuntime: true }
}
