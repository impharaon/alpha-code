import type { LauncherEnvironment, PackageRunner } from "@opencode/util/codepuppy-connector-launch"
import { canonicalJsonDigest } from "@opencode/util/codepuppy-hash"
import { connectorSecretQueryPattern } from "./codepuppy-connector-diagnostic.js"
import { Schema } from "effect"

/** Facts from the official resolver adapters. Local sources carry content identity, never their host path. */
const requirementAttributes = {
  extras: Schema.optional(Schema.Array(Schema.String)),
  alias: Schema.optional(Schema.String),
  marker: Schema.optional(Schema.String),
  editable: Schema.optional(Schema.Boolean),
}
export const ConnectorRequirement = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("registry"),
    name: Schema.String,
    version: Schema.String,
    ...requirementAttributes,
  }),
  Schema.Struct({
    kind: Schema.Literal("remote"),
    url: Schema.String,
    name: Schema.optional(Schema.String),
    ...requirementAttributes,
  }),
  Schema.Struct({
    kind: Schema.Literal("git"),
    url: Schema.String,
    revision: Schema.String,
    name: Schema.optional(Schema.String),
    subdirectory: Schema.optional(Schema.String),
    ...requirementAttributes,
  }),
  Schema.Struct({
    kind: Schema.Literal("content"),
    sha256: Schema.String,
    name: Schema.optional(Schema.String),
    ...requirementAttributes,
  }),
])
export type ConnectorRequirement = typeof ConnectorRequirement.Type

export const connectorNpmResolutionOptions = new Set([
  // Only normalized resolution-affecting facts from pinned npm / uv's resolved
  // resolver settings. Cache locations, logging, credentials, argv and workspace IDs are not inputs.
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
  const allowed = input.runner === "npm-exec" ? connectorNpmResolutionOptions : uvResolutionOptions
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
              name: requirement.name,
              subdirectory: requirement.subdirectory,
            }
          : { kind: requirement.kind, sha256: requirement.sha256, name: requirement.name }),
    ...(requirement.extras?.length ? { extras: [...new Set(requirement.extras)].sort() } : {}),
    ...(requirement.alias ? { alias: requirement.alias } : {}),
    ...(requirement.marker ? { marker: requirement.marker } : {}),
    ...(requirement.editable ? { editable: true } : {}),
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

/** Self-contained so the same owner can normalize metadata inside the bundled Node on a Location. */
export function connectorResolutionContent(input: unknown, queryPattern: string): unknown {
  const query = new RegExp(`^${queryPattern}$`, "i")
  const authentication = (name: string) =>
    /(?:^|[:_./-])(?:auth|authorization|token|credential|credentials|password|passwd|secret|username|signature|api[_-]?key|private_key)(?:$|[:_./-])/i.test(
      name.replace(/([a-z])([A-Z])/g, "$1_$2"),
    )
  const sourceUrl = (source: string) => {
    const url = new URL(source)
    if (url.protocol === "file:" || url.protocol === "git+file:")
      throw Error("Local connector sources need content facts")
    url.username = ""
    url.password = ""
    for (const name of [...url.searchParams.keys()]) if (query.test(name)) url.searchParams.delete(name)
    url.searchParams.sort()
    return url.toString()
  }
  const content = (value: unknown): unknown => {
    if (typeof value === "string") return value.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi, sourceUrl)
    if (Array.isArray(value)) return value.map(content)
    if (value === null || typeof value !== "object") return value
    return Object.fromEntries(
      Object.entries(value)
        .filter(([name]) => !authentication(name))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, item]) => [name, content(item)]),
    )
  }
  return content(input)
}

function nonSecretResolution(value: unknown) {
  return connectorResolutionContent(value, connectorSecretQueryPattern)
}

function nonSecretSourceUrl(value: string) {
  return String(nonSecretResolution(value))
}
