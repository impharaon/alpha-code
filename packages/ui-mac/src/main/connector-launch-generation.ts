import { readFileSync } from "node:fs"
import { isLaunchSnapshot, type ConnectorLaunchMainMessage, type LaunchIdentity } from "../../../util/src/codepuppy-connector-launch"
import { connectorSecretNeed } from "./connector-secret-needs"
import { beginConnectorEgressAttempt, endConnectorEgressAttempt } from "./connector-egress-attribution"
import type { PinnedFiles } from "../../../util/src/codepuppy-pinned-files"
import type { CatalogEntry } from "../renderer/extensions/catalog-types"
import { codepuppyGlobalRoot } from "./codepuppy-installs"
import { codepuppyRoot } from "./codepuppy-workdir"
import { createConnectorLaunchMainBridge } from "./connector-launch-host"
import type { createConnectorLaunchState } from "./connector-launch-state"
import { createLauncherAssetAuthority, hostLauncherPlatform, launcherBundleDirectory, readLauncherBundle } from "./connector-launchers"
import { connectorRuntimeDependencyReader, hostProgramEnvironment, installedConnectorDeclaration } from "./connector-runtime-dependencies"

/**
 * This generation's launcher authority (design §4.3): the descriptor consumes #1759's location binding for this fork and
 * never computes a package-manager path. A packaged app always ships the bundle; a dev tree without the launcher prebuild
 * gets no descriptor, so its package runners keep their declared commands.
 */
export function forkLauncherAuthority(input: {
  userData: string
  resourcesRoot: string
  packaged: boolean
  pins: PinnedFiles
  /** The location binding #1759's planner returned for this fork (its R2 cache projection); the fence code decides it. */
  packageManagerEnv: Readonly<Record<string, string>>
  officeMcpManifest: string
  log: (line: string) => void
}) {
  const platform = hostLauncherPlatform()
  if (!platform) return undefined
  const bundleDirectory = launcherBundleDirectory({ resourcesRoot: input.resourcesRoot, packaged: input.packaged, platform })
  const bundle = readBundle(bundleDirectory, platform, input.packaged)
  if (!bundle) {
    input.log(`connector launchers are not built in this dev tree (${bundleDirectory}); package runners keep their declared commands`)
    return undefined
  }
  const manifest = JSON.parse(readFileSync(input.officeMcpManifest, "utf8")) as { formats: Record<string, { command: readonly string[] }> }
  return createLauncherAssetAuthority({ bundleDirectory, userData: input.userData, platform, bundle, pins: input.pins, packageManagerEnv: input.packageManagerEnv, declarations: manifest.formats })
}

/** Main's end of §4.7 for one generation, bound to the launcher authority, the current projection and the installed declarations. */
export function openConnectorLaunchMain(input: {
  sidecarGeneration: string
  authority: NonNullable<ReturnType<typeof forkLauncherAuthority>>
  launches: Pick<ReturnType<typeof createConnectorLaunchState>, "changed">
  /** Local catalogs only (signed cache, bundled snapshot): a start never waits on the network. */
  catalogs: () => readonly { entries: readonly CatalogEntry[]; version: string }[]
  /** The policy proxy port of this generation; undefined where no proxy runs (no attribution, the inherited environment). */
  proxyPort: number | undefined
  /** Main's package/secret facts for a server (connectorSecretNeed); they refine only an unclassified failure. */
  secretNeed?: (server: string) => { fields: string[]; packageId?: string } | undefined
  post: (message: ConnectorLaunchMainMessage) => void
}) {
  const attributed = new Map<string, LaunchIdentity>()
  const key = (identity: LaunchIdentity) => JSON.stringify([identity.directory, identity.server, identity.attempt])
  const bridge: ReturnType<typeof createConnectorLaunchMainBridge> = createConnectorLaunchMainBridge({
    sidecarGeneration: input.sidecarGeneration,
    runtimeRoot: input.authority.environment.runtimeRoot,
    changed: (value) => input.launches.changed(withSecretNeed(value, input.secretNeed ?? connectorSecretNeed)),
    resolveAssets: () => input.authority.resolveAssets(),
    runtimeDependencies: connectorRuntimeDependencyReader({
      installed: async (identity) =>
        installedConnectorDeclaration({
          identity,
          roots: [codepuppyRoot(identity.directory), codepuppyGlobalRoot()].filter((root): root is string => root !== null),
          catalogs: input.catalogs,
        }),
      environment: hostProgramEnvironment,
    }),
    beginEgress: async (identity) => {
      if (input.proxyPort === undefined) return { proxyEnvironment: {} }
      attributed.set(key(identity), identity)
      return beginConnectorEgressAttempt({ identity, proxyPort: input.proxyPort, report: (evidence) => bridge.evidence(evidence) })
    },
    endEgress: (identity) => {
      attributed.delete(key(identity))
      endConnectorEgressAttempt(identity)
    },
    post: input.post,
  })
  return {
    ...bridge,
    // A stopped generation's marks stop attributing at once; a late CONNECT from its processes is no one's evidence.
    dispose() {
      for (const identity of attributed.values()) endConnectorEgressAttempt(identity)
      attributed.clear()
      bridge.dispose()
    },
  }
}

/** §4.5: main's authorization facts may name a missing key, but never overwrite a concrete download/egress/dependency fact. */
function withSecretNeed(value: unknown, need: (server: string) => { fields: string[]; packageId?: string } | undefined) {
  if (!isLaunchSnapshot(value) || value.state.phase !== "failed" || value.state.failure.kind !== "unknown") return value
  const secret = need(value.identity.server)
  return secret ? { ...value, state: { ...value.state, failure: { kind: "secret" as const, ...secret } } } : value
}

function readBundle(directory: string, platform: NonNullable<ReturnType<typeof hostLauncherPlatform>>, packaged: boolean) {
  try {
    return readLauncherBundle(directory, platform)
  } catch (error) {
    if (packaged) throw new Error(`bundled connector launchers are unreadable: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}
