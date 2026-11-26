import type { LauncherEnvironment, PackageRunner } from "@opencode/util/codepuppy-connector-launch"
import { canonicalJsonDigest } from "@opencode/util/codepuppy-hash"
import { isConnectorSecretQueryParameter } from "./codepuppy-connector-diagnostic.js"

/** Facts from the official resolver adapters. Local sources carry content identity, never their host path. */
export type ConnectorRequirement = (
  | { kind: "registry"; name: string; version: string }
  | { kind: "remote"; url: string; name?: string }
  | { kind: "git"; url: string; revision: string; subdirectory?: string }
  | { kind: "content"; sha256: string; name?: string }
) & { extras?: readonly string[]; alias?: string }

// Only normalized resolution-affecting facts from pinned npm / uv's resolved
// resolver settings. Cache locations, logging, credentials, argv and workspace IDs are not inputs.
const npmResolutionOptions = new Set([
  "registry",
  "tag",
  "defaultTag",
  "before",
  "minReleaseAge",
  "minReleaseAgeExclude",
  "include",
  "omit",
  "legacyPeerDeps",
  "strictPeerDeps",
  "preferDedupe",
  "installStrategy",
  "installLinks",
  "packageLock",
  "lockfileVersion",
  "force",
  "engineStrict",
  "nodeVersion",
  "os",
  "cpu",
  "libc",
  "preferOnline",
  "preferOffline",
  "offline",
  "allowDirectory",
  "replaceRegistryHost",
])
const uvResolutionOptions = new Set([
  "indexes",
  "index_locations",
  "index_strategy",
  "resolution",
  "prerelease",
  "prerelease_package",
  "fork_strategy",
  "dependency_metadata",
  "config_settings",
  "config_setting",
  "config_settings_package",
  "require_build_hashes",
  "build_hash_checking",
  "build_isolation",
  "extra_build_dependencies",
  "extra_build_variables",
  "exclude_newer",
  "exclude_newer_package",
  "torch_backend",
  "no_sources",
  "no_sources_package",
  "sources",
  "no_build",
  "no_build_package",
  "no_binary",
  "no_binary_package",
  "build_options",
  "python_platform",
  "cuda_driver_version",
  "amd_gpu_architecture",
  "upgrade",
])

/** Pure key over normalized package/configuration facts. It cannot accept invocation state as a key axis. */
export function connectorPreparationKey(input: {
  runner: PackageRunner
  launchers: Pick<LauncherEnvironment, "platform" | "pinSet" | "pythonFileId">
  requirements: readonly ConnectorRequirement[]
  options: Readonly<Record<string, unknown>>
  configuration: readonly {
    purpose: "constraints" | "overrides" | "build-constraints" | "dependencies" | "source"
    // Parsed non-secret resolution content; the adapter replaces local references with content facts.
    value: unknown
  }[]
}) {
  const allowed = input.runner === "npm-exec" ? npmResolutionOptions : uvResolutionOptions
  const requirements = input.requirements.map((requirement) => ({
    ...(requirement.kind === "registry"
      ? { kind: requirement.kind, name: requirement.name, version: requirement.version }
      : requirement.kind === "remote"
        ? { kind: requirement.kind, url: nonSecretSourceUrl(requirement.url), name: requirement.name }
        : requirement.kind === "git"
          ? {
              kind: requirement.kind,
              url: nonSecretSourceUrl(requirement.url),
              revision: requirement.revision,
              subdirectory: requirement.subdirectory,
            }
          : { kind: requirement.kind, sha256: requirement.sha256, name: requirement.name }),
    ...(requirement.extras?.length ? { extras: [...new Set(requirement.extras)].sort() } : {}),
    ...(requirement.alias ? { alias: requirement.alias } : {}),
  }))
  const options = Object.fromEntries(
    Object.entries(input.options)
      .filter(([name]) => allowed.has(name) || (input.runner === "npm-exec" && /^@[^:]+:registry$/.test(name)))
      .map(([name, value]) => [name, nonSecretResolution(value)]),
  )
  return canonicalJsonDigest({
    kind: "codepuppy-connector-preparation",
    runner: input.runner,
    platform: input.launchers.platform,
    pinSet: input.launchers.pinSet,
    pythonFileId: input.launchers.pythonFileId,
    requirements: canonicalSet(requirements),
    options,
    configuration: canonicalSet(
      input.configuration.map((file) => ({ purpose: file.purpose, value: nonSecretResolution(file.value) })),
    ),
  }).slice("sha256:".length)
}

function canonicalSet<A>(values: readonly A[]) {
  return [...new Map(values.map((value) => [canonicalJsonDigest(value), value])).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value)
}

function authenticationField(name: string) {
  return /(?:^|[:_./-])(?:auth|authorization|token|credential|credentials|password|passwd|secret|username|signature|api[_-]?key|private_key)(?:$|[:_./-])/i.test(
    name.replace(/([a-z])([A-Z])/g, "$1_$2"),
  )
}

function nonSecretResolution(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi, nonSecretSourceUrl)
  if (Array.isArray(value)) return value.map(nonSecretResolution)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => !authenticationField(name))
      .map(([name, item]) => [name, nonSecretResolution(item)]),
  )
}

function nonSecretSourceUrl(source: string) {
  const url = new URL(source)
  if (url.protocol === "file:" || url.protocol === "git+file:")
    throw Error("Local connector sources need content facts")
  url.username = ""
  url.password = ""
  for (const name of [...url.searchParams.keys()])
    if (isConnectorSecretQueryParameter(name)) url.searchParams.delete(name)
  url.searchParams.sort()
  return url.toString()
}
