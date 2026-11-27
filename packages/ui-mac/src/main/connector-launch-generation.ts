import { readFileSync } from "node:fs"
import type { ConnectorLaunchMainMessage } from "../../../util/src/codepuppy-connector-launch"
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
  catalog: () => Promise<{ entries: readonly CatalogEntry[]; version: string }>
  post: (message: ConnectorLaunchMainMessage) => void
}) {
  return createConnectorLaunchMainBridge({
    sidecarGeneration: input.sidecarGeneration,
    runtimeRoot: input.authority.environment.runtimeRoot,
    changed: input.launches.changed,
    resolveAssets: () => input.authority.resolveAssets(),
    runtimeDependencies: connectorRuntimeDependencyReader({
      installed: (identity) =>
        installedConnectorDeclaration({
          identity,
          roots: [codepuppyRoot(identity.directory), codepuppyGlobalRoot()].filter((root): root is string => root !== null),
          catalog: input.catalog,
        }),
      environment: hostProgramEnvironment,
    }),
    // Attribution marks land with R5's proxy evidence; until then the attempt keeps the inherited proxy and has no evidence.
    beginEgress: async () => ({ proxyEnvironment: {} }),
    endEgress: () => {},
    post: input.post,
  })
}

function readBundle(directory: string, platform: NonNullable<ReturnType<typeof hostLauncherPlatform>>, packaged: boolean) {
  try {
    return readLauncherBundle(directory, platform)
  } catch (error) {
    if (packaged) throw new Error(`bundled connector launchers are unreadable: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}
