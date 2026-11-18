import { applyEdits, modify } from "jsonc-parser"
import {
  collectMergedMcpRefPathsStrict,
  mcpPluginTargetPath,
  readMcpLeafStrict,
  releasePreparedTxResources,
  withConfigWriteLock,
  writeConfigTextAtomic,
} from "./ext-config"
import { collectMcpFileRefPaths } from "./codepuppy-mcp-secrets"
import { codepuppyGlobalRoot } from "./engine-config-truth"
import { tryAcquireBundleLock } from "./ext-bundle-lock"
import { findRecordV2, markOfficialRuntimeAvailable, reconcileSkillsDerivation } from "./ext-receipt-v2"
import { probeTransactionJournals, type TxPreparedResourceV1 } from "./ext-transaction"
import { removeMcpServerRecord, upsertMcpServerRecord } from "./mcp-server-lifecycle"
// alpha-web#256: two closed recipes; only ciphertext survives a stopped application.
import { createHash, randomUUID } from "node:crypto"
import {
  constants,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path"

import { environmentFromMutableRoot } from "./codepuppy-environment"
import {
  DBHUB_READONLY_TOML,
  OFFICIAL_CONNECTOR_NAMES,
  isOfficialConnector,
  officialConnectorBackend,
  officialConnectorFailure,
  officialNodeCommand,
  officialRuntimeParent,
  insideDirectory,
  type OfficialConnectorName,
} from "./official-connector-recipes"

const runs = new Map<string, string>()
// Check every managed ancestor, never follow a planted link or adopt somebody else's directory.
function directory(path: string) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
    throw officialConnectorFailure()
}
function managedDirectory(base: string, path: string) {
  const parent = realpathSync(base)
  const parts = relative(base, path).split(sep)
  if (parts.some((part) => !part || part === "..")) throw officialConnectorFailure()
  parts.reduce((current, part) => {
    const next = join(current, part)
    directory(next)
    return next
  }, parent)
}
function readProtected(file: string) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.nlink !== 1)
      throw officialConnectorFailure()
    return readFileSync(fd)
  } finally {
    closeSync(fd)
  }
}
function writeProtected(file: string, bytes: string | Buffer, mode = 0o600) {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode)
  try {
    writeFileSync(fd, bytes)
  } finally {
    closeSync(fd)
  }
}

export function officialConnectorPaths(root: string, name: string, version: string) {
  const base = environmentFromMutableRoot(root)
  if (!base || !isOfficialConnector(name) || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,95}$/.test(version))
    throw officialConnectorFailure()
  return {
    base: base.casBaseRoot,
    secret: join(base.casBaseRoot, "connector-secrets", base.environment, name, version),
    config: join(base.casBaseRoot, "connector-config", base.environment, name, version),
  }
}

export function officialRuntimeRoot(root: string) {
  const existing = runs.get(root)
  if (existing) {
    directory(existing)
    return existing
  }
  sweepOfficialConnectorRuntime(root)
  const parent = officialRuntimeParent(root)
  managedDirectory(dirname(parent), parent)
  const run = join(parent, `${process.pid}-${randomUUID()}`)
  directory(run)
  runs.set(root, run)
  return run
}

/** The single main process owns this environment; retain only its current registered generation. */
export function sweepOfficialConnectorRuntime(root: string) {
  const parent = officialRuntimeParent(root)
  if (!existsSync(parent)) return
  directory(parent)
  for (const entry of readdirSync(parent)) {
    if (!/^\d+-[a-f0-9-]{36}$/.test(entry)) throw officialConnectorFailure()
    directory(join(parent, entry))
    if (join(parent, entry) !== runs.get(root)) rmSync(join(parent, entry), { recursive: true })
  }
}

export function clearOfficialConnectorRuntime(generation = [...runs.values()]) {
  for (const [root, run] of runs) {
    if (!generation.includes(run)) continue
    directory(run)
    rmSync(run, { recursive: true })
    runs.delete(root)
  }
}

/** Both application and child exit must settle even when a protected runtime root cannot be removed. */
export function clearOfficialConnectorRuntimeOnExit(generation?: string[]) {
  try {
    clearOfficialConnectorRuntime(generation)
  } catch {
    console.warn("official connector runtime cleanup failed on exit")
  }
}

export function assertOfficialConnectorSecret(name: OfficialConnectorName, value: string) {
  if (!value?.trim() || value !== value.trim() || /\{(?:file|env):|[\u0000\r\n]/.test(value))
    throw officialConnectorFailure()
  if (name === "github-official") return
  // v1.5.0 SQLiteDSNParser consumes a literal pathname. Require an existing local absolute
  // file; no remote dialect, relative cwd, memory DB, URL query or ambiguous encoded path.
  if (!value.startsWith("sqlite:///")) throw officialConnectorFailure()
  const file = value.slice("sqlite://".length)
  if (!isAbsolute(file) || /[?#%]/.test(file) || file.startsWith("//") || !lstatSync(file).isFile())
    throw officialConnectorFailure()
}

export function officialConnectorConfig(root: string, name: OfficialConnectorName, version: string) {
  const paths = officialConnectorPaths(root, name, version)
  const variable = name === "github-official" ? "GITHUB_PERSONAL_ACCESS_TOKEN" : "DSN"
  const file = join(officialRuntimeRoot(root), name, version, variable)
  const ref = `{file:${file}}`
  if (name === "github-official")
    return {
      file,
      config: {
        type: "remote" as const,
        url: "https://api.githubcopilot.com/mcp/",
        oauth: false as const,
        headers: { Authorization: `Bearer ${ref}`, "X-MCP-Toolsets": "repos", "X-MCP-Readonly": "true" },
      },
    }
  const command = officialNodeCommand()
  return {
    file,
    config: {
      type: "local" as const,
      timeout: 60_000,
      command: [...command, "--config", join(paths.config, "dbhub.toml")],
      cwd: join(paths.config, "work"),
      environment: { DSN: ref, PATH: `${dirname(command[0]!)}:${process.env.PATH ?? "/usr/bin:/bin"}` },
    },
  }
}

export function prepareOfficialConnector(root: string, name: OfficialConnectorName, version: string, value: string) {
  try {
    assertOfficialConnectorSecret(name, value)
    const encrypted = officialConnectorBackend().encryptString(value)
    const paths = officialConnectorPaths(root, name, version)
    managedDirectory(paths.base, paths.secret)
    writeProtected(join(paths.secret, "secret.enc"), encrypted)
    if (name === "dbhub-readonly") {
      managedDirectory(paths.base, join(paths.config, "work"))
      writeProtected(join(paths.config, "dbhub.toml"), DBHUB_READONLY_TOML, 0o400)
      writeProtected(
        join(paths.secret, "recipe.json"),
        JSON.stringify({
          path: join(paths.config, "dbhub.toml"),
          sha256: createHash("sha256").update(DBHUB_READONLY_TOML).digest("hex"),
        }),
      )
    }
    restoreOfficialConnector(root, name, version)
  } catch {
    throw officialConnectorFailure()
  }
}

export function restoreOfficialConnector(
  root: string,
  name: OfficialConnectorName,
  version: string,
  state: "enabled" | "disabled" = "enabled",
) {
  try {
    const paths = officialConnectorPaths(root, name, version)
    managedDirectory(paths.base, paths.secret)
    const value = state === "enabled"
      ? officialConnectorBackend().decryptString(readProtected(join(paths.secret, "secret.enc")))
      : ""
    if (state === "enabled") assertOfficialConnectorSecret(name, value)
    const next = officialConnectorConfig(root, name, version)
    managedDirectory(officialRuntimeRoot(root), dirname(next.file))
    if (existsSync(next.file)) {
      if (readProtected(next.file).toString() !== value) {
        rmSync(next.file)
        writeProtected(next.file, value)
      }
    } else writeProtected(next.file, value)
    // A disabled definition is never spawned; before its DSN is saved the template does not exist yet.
    // The engine still needs the complete leaf (an enabled-only leaf is dropped). Enabling re-checks it.
    if (name === "dbhub-readonly" && state === "enabled") {
      managedDirectory(paths.base, paths.config)
      directory(join(paths.config, "work"))
      if (
        readdirSync(join(paths.config, "work")).length ||
        readProtected(join(paths.config, "dbhub.toml")).toString() !== DBHUB_READONLY_TOML
      )
        throw officialConnectorFailure()
    }
    return { ...next.config, enabled: state === "enabled" }
  } catch {
    throw officialConnectorFailure()
  }
}

export function removeOfficialConnectorVersion(root: string, name: OfficialConnectorName, version: string) {
  const paths = officialConnectorPaths(root, name, version)
  const run = runs.get(root)
  for (const dir of [paths.secret, paths.config, ...(run ? [join(run, name, version)] : [])]) {
    if (!existsSync(dir)) continue
    managedDirectory(insideDirectory(paths.base, dir) ? paths.base : run!, dir)
    rmSync(dir, { recursive: true })
  }
}

export function removeOfficialConnector(root: string, name: OfficialConnectorName) {
  const paths = officialConnectorPaths(root, name, "unused")
  const parents = [dirname(paths.secret), dirname(paths.config)]
  const versions = new Set(
    parents.flatMap((parent) => (existsSync(parent) ? (directory(parent), readdirSync(parent)) : [])),
  )
  for (const version of versions) removeOfficialConnectorVersion(root, name, version)
  for (const parent of parents) if (existsSync(parent)) rmdirSync(parent)
}

export function collectOldOfficialConnectorVersions(root: string, name: OfficialConnectorName, keep: string) {
  const parent = dirname(officialConnectorPaths(root, name, keep).secret)
  directory(parent)
  for (const version of readdirSync(parent)) if (version !== keep) removeOfficialConnectorVersion(root, name, version)
}

/** Main admission/recovery share the same release decision; never touch a still-live version. */
export function releaseOfficialConnectorResources(userDataPath: string, resources: readonly TxPreparedResourceV1[]) {
  // Preserve the legacy batch release's collect-all-errors semantics, including live + orphan
  // versions in one recovered journal. Official recipes cannot introduce mixed package graphs.
  releasePreparedTxResources(
    userDataPath,
    resources.filter((resource) => resource.store !== "official-connectors"),
  )
  for (const resource of resources.filter((resource) => resource.store === "official-connectors")) {
    if (!isOfficialConnector(resource.server)) throw new Error("invalid official connector resource")
    const live = collectMergedMcpRefPathsStrict(resource.server)
    if (!live.ok || live.refs.some((file) => file.includes(`/${resource.server}/${resource.version}/`)))
      throw new Error("official connector version still referenced or config unreadable")
    removeOfficialConnectorVersion(codepuppyGlobalRoot(), resource.server, resource.version)
  }
}

/** The live leaf names exactly one versioned runtime file of this connector; anything else cannot be restored. */
function liveOfficialConnectorVersion(root: string, name: OfficialConnectorName): string {
  const recovery = probeTransactionJournals(root)
  if (recovery.unreadableDir || recovery.entries.some((entry) => !entry.terminal)) throw officialConnectorFailure()
  const live = readMcpLeafStrict(name)
  if (!live.ok || !live.value) throw officialConnectorFailure()
  const refs = collectMcpFileRefPaths(live.value)
  const file = refs[0]
  if (refs.length !== 1 || !file || basename(dirname(dirname(file))) !== name) throw officialConnectorFailure()
  const version = basename(dirname(file))
  officialConnectorPaths(root, name, version)
  return version
}

// I-11(design v9 §4.4「官方配方的可运行性」):不可运行集合改了之后,在 bundle 锁下按账本与集合重发允许集
// (reconcileSkillsDerivation 同一路径,不改账本)。锁忙时有界重试;多次改动串成一条,每次都读最新集合。
const REPUBLISH_ATTEMPTS = 100
const REPUBLISH_RETRY_MS = 50
let republished: Promise<boolean> = Promise.resolve(true)
async function republishPackageAllowSet(): Promise<boolean> {
  const root = codepuppyGlobalRoot()
  for (let attempt = 0; attempt < REPUBLISH_ATTEMPTS; attempt++) {
    const held = tryAcquireBundleLock(root, { txId: `official-runtime-${randomUUID()}` })
    if (held.ok) {
      try {
        const derived = reconcileSkillsDerivation(root)
        if (!derived.ok) console.warn(`official connector availability: allow-set republish failed: ${derived.reason}`)
        return derived.ok
      } finally {
        held.lock.release()
      }
    }
    await new Promise((resolve) => setTimeout(resolve, REPUBLISH_RETRY_MS))
  }
  console.warn("official connector availability: allow-set republish gave up while the ledger stayed busy; the next ledger write publishes it")
  return false
}
function markAvailability(name: OfficialConnectorName, available: boolean) {
  if (markOfficialRuntimeAvailable(name, available)) republished = republished.then(republishPackageAllowSet, republishPackageAllowSet)
}
/** Resolves once every availability change so far has been republished (or the bounded retry gave up). */
export function officialAvailabilityPublished(): Promise<boolean> {
  return republished
}

/**
 * The per-name final-state step shared by convergeManagedMcp: the direction is the ledger intent read when the
 * convergence run started, never the request's. Enabled = materialize from ciphertext; disabled = write empty.
 * Returns whether the step succeeded; availability follows (only a materialized enabled connector is available).
 */
export function settleOfficialConnectorCredential(name: OfficialConnectorName, intent: "enabled" | "disabled"): boolean {
  const root = codepuppyGlobalRoot()
  let settled = false
  try {
    restoreOfficialConnector(root, name, liveOfficialConnectorVersion(root, name), intent)
    settled = true
  } catch {
    if (intent === "enabled") console.warn(`official-connector-needs-reentry: ${name}`)
  }
  markAvailability(name, settled && intent === "enabled")
  return settled
}

/** Rebind each committed connector independently; a credential failure must not stop the engine. */
export function restoreCommittedOfficialConnectors() {
  const root = codepuppyGlobalRoot()
  try {
    sweepOfficialConnectorRuntime(root)
  } catch {
    console.warn("official connector orphan runtime cleanup failed")
  }
  for (const name of OFFICIAL_CONNECTOR_NAMES) {
    const record = findRecordV2(root, "mcp", name)
    if (!record) {
      markAvailability(name, false)
      continue
    }
    let version = ""
    try {
      version = liveOfficialConnectorVersion(root, name)
      projectOfficialConnector(name, restoreOfficialConnector(root, name, version, record.desiredState))
      markAvailability(name, record.desiredState === "enabled")
    } catch {
      // No secret, path or decryption error leaves this boundary. Empty refs remain parseable.
      console.warn(`official-connector-needs-reentry: ${name}`)
      markAvailability(name, false)
      // I-11(v9-8):keep this version's complete definition (leaf + remote record, empty credential). The allow-set
      // keeps it off; later Locations get the same trusted definition; the ledger intent is untouched.
      let definition: Record<string, unknown> | undefined
      try {
        definition = restoreOfficialConnector(root, name, version, "disabled")
      } catch {
        // A missing/invalid recipe cannot safely provide a ref; the engine accepts disable-only leaves.
      }
      // A disable-only leaf has no type, so projecting it also removes the remote record.
      projectOfficialConnector(name, definition ?? { enabled: false })
    }
  }
  return [...runs.values()]
}

export function projectOfficialConnector(name: OfficialConnectorName, config: Record<string, unknown>) {
  const written = withConfigWriteLock(() => {
    const target = mcpPluginTargetPath()
    const before = readFileSync(target, "utf8")
    return writeConfigTextAtomic(target, before, applyEdits(before, modify(before, ["mcp", name], config, {})))
  })
  if (!written.ok) throw officialConnectorFailure()
  const remote = config.type === "remote"
    ? upsertMcpServerRecord({ name, url: config.url as string, headers: config.headers as Record<string, string> })
    : removeMcpServerRecord(name)
  if (!remote.ok) throw officialConnectorFailure()
}
