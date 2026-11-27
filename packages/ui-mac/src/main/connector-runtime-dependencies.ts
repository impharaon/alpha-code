import { execFile } from "node:child_process"
import { readFileSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import { connectorPackageRunner } from "@opencode/util/codepuppy-command-head"
import type { LaunchIdentity, PackageRunner, RuntimeDependencyFacts } from "../../../util/src/codepuppy-connector-launch"
import type { CatalogEntry } from "../renderer/extensions/catalog-types"
import { findReceipt } from "./codepuppy-installs"
import { toolProbe } from "./platform"

/** What the two runner roles supply from the bundled launchers; the user's own copies never matter (BR-05). */
const RUNNER_PROGRAMS = {
  "uv-tool": ["uv", "uvx", "python", "python3"],
  "npm-exec": ["node", "npm", "npx"],
} satisfies Record<PackageRunner, readonly string[]>
const XCRUN_SHIM = Buffer.from("__xcrun_shim")

type HostSystem = {
  platform: NodeJS.Platform
  /** The active developer directory when one is installed (darwin); see xcodeDeveloperDirectory. */
  developerDirectory: () => Promise<string | undefined>
}
const HOST: HostSystem = { platform: process.platform, developerDirectory: () => xcodeDeveloperDirectory() }

/**
 * R5 (design §4.5): the one dependency predicate for the install precheck and the pre-spawn read. It only reads files and
 * `/usr/bin/xcode-select -p`; it never runs a program it is judging, so a developer-tools shim cannot open the install dialog.
 * Programs a runner role supplies are neither missing nor listed: their entries belong to the launcher's resolveAssets.
 */
export async function checkConnectorRuntimeDependencies(
  input: { runtimeDep: readonly string[]; runner?: PackageRunner; environment: Record<string, string> },
  system: HostSystem = HOST,
): Promise<RuntimeDependencyFacts> {
  const runtimeDep = [...new Set(input.runtimeDep)]
  const executables: Record<string, string> = {}
  const missing: string[] = []
  let developer: Promise<string | undefined> | undefined
  for (const program of runtimeDep) {
    if (input.runner && (RUNNER_PROGRAMS[input.runner] as readonly string[]).includes(program)) continue
    const found = await locateProgram(program, input.environment, system.platform, () => (developer ??= system.developerDirectory()))
    if (found) executables[program] = found
    else missing.push(program)
  }
  return { runtimeDep, executables, missing }
}

/** The host's `runtimeDependencies(identity)`: the installed declaration, its original runner role, then the same predicate. */
export function connectorRuntimeDependencyReader(
  source: {
    /** The installed version's declaration for this server in this directory; undefined = not a catalog install. */
    installed: (identity: LaunchIdentity) => Promise<{ runtimeDep: readonly string[]; command: readonly unknown[] } | undefined>
    environment: () => Record<string, string>
  },
  system: HostSystem = HOST,
) {
  return async function readConnectorRuntimeDependencies(identity: LaunchIdentity): Promise<RuntimeDependencyFacts> {
    const declaration = await source.installed(identity)
    if (!declaration) return { runtimeDep: [], executables: {}, missing: [] }
    return checkConnectorRuntimeDependencies(
      { runtimeDep: declaration.runtimeDep, runner: connectorPackageRunner(declaration.command, system.platform), environment: source.environment() },
      system,
    )
  }
}

/**
 * The installed receipt pins the catalog card version (the planner records `entry.version || catalog version`); a version the
 * current catalog no longer lists declares nothing rather than borrowing the newest card.
 */
export async function installedConnectorDeclaration(input: {
  identity: LaunchIdentity
  /** Project ledger root first (when the directory has one), then the global ledger root. */
  roots: readonly string[]
  catalog: () => Promise<{ entries: readonly CatalogEntry[]; version: string }>
}) {
  const receipt = input.roots.map((root) => findReceipt(root, "mcp", input.identity.server)).find((value) => value !== null)
  if (!receipt?.version) return undefined
  const catalog = await input.catalog()
  const entry = catalog.entries.find((value) => value.id === receipt.id && (value.version || catalog.version) === receipt.version)
  if (entry?.installSpec?.kind !== "mcp" || !entry.installSpec.command) return undefined
  return { runtimeDep: entry.installSpec.runtimeDep ?? [], command: entry.installSpec.command }
}

/** The host PATH the install precheck already uses (REQ-076 T2: posix adds the package-manager directories GUI launches lack). */
export function hostProgramEnvironment(): Record<string, string> {
  return Object.fromEntries(Object.entries({ ...process.env, PATH: toolProbe().probePath }).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

/** `xcode-select -p` prints the active developer directory and never prompts; a missing directory counts as absent. */
export function xcodeDeveloperDirectory(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("/usr/bin/xcode-select", ["-p"], { timeout: 10_000 }, (error, stdout) => {
      const directory = String(stdout).trim()
      resolve(!error && path.isAbsolute(directory) && isDirectory(directory) ? directory : undefined)
    })
  })
}

async function locateProgram(
  program: string,
  environment: Record<string, string>,
  platform: NodeJS.Platform,
  developerDirectory: () => Promise<string | undefined>,
) {
  if (!/^[A-Za-z0-9._-]+$/.test(program)) return undefined
  const windows = platform === "win32"
  const search = Object.entries(environment).find(([key]) => (windows ? key.toUpperCase() === "PATH" : key === "PATH"))?.[1] ?? ""
  // Windows accepts only the real git.exe; other programs keep the platform's executable suffixes.
  const names = !windows ? [program] : program === "git" ? ["git.exe"] : [program, ...[".exe", ".cmd", ".bat"].map((suffix) => program + suffix)]
  for (const directory of search.split(windows ? ";" : ":").filter((value) => path.isAbsolute(value))) {
    for (const name of names) {
      const candidate = path.join(directory, name)
      if (!executableFile(candidate, windows)) continue
      const real = realpathSync(candidate)
      if (platform !== "darwin" || !readFileSync(real).includes(XCRUN_SHIM)) return real
      // A developer-tools shim works only when the tools are installed; then the real tool lives in the developer directory.
      const developer = await developerDirectory()
      if (!developer) continue
      const tool = path.join(developer, "usr", "bin", program)
      return executableFile(tool, false) ? realpathSync(tool) : real
    }
  }
  return undefined
}

function executableFile(file: string, windows: boolean) {
  try {
    const info = statSync(file)
    return info.isFile() && (windows || (info.mode & 0o111) !== 0)
  } catch {
    return false
  }
}

function isDirectory(directory: string) {
  try {
    return statSync(directory).isDirectory()
  } catch {
    return false
  }
}
