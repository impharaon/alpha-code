// DESIGN-local-plugin-install §4.16 (R1-M3): this run's fence for marketplace `source: command` locators — the profile and proxy port
// the locator runs under (plugin-command-source.ts) and the credential-store rules main applies when it reads the located directory
// unfenced (plugin-sources.ts). server.ts hands over the rules of the fence plan it just made; one record serves both sides.

import type { LocatedFiles } from "./plugin-sources"
import { realpathSync, statSync } from "node:fs"
import { readRegularFileNoFollow } from "./codepuppy-secret-files"
import { credentialReferenceGuard } from "./process-fence-plan"
import { renderCommandSourceProfile, type ConfigFenceRule, type CredentialStoreRule } from "./process-fence-profile"

let fence: { profile: string; egressProxyPort: number; credentialStores: readonly CredentialStoreRule[] } | undefined

export function configureCommandSourceFence(input: { egressProxyPort: number; configFence: readonly ConfigFenceRule[]; credentialStores: readonly CredentialStoreRule[] }) {
  fence = { profile: renderCommandSourceProfile(input), egressProxyPort: input.egressProxyPort, credentialStores: input.credentialStores }
}

export function commandSourceFence() {
  return fence
}

/**
 * main's reads of a located directory: the fenced locator can plant links, so a path whose real target — or an ancestor of it — is a
 * credential store (the locator's own C1 rules, by device and inode) reads as absent. Files are opened as the judged real file without
 * following its last link, and their identity is rechecked. Without a configured fence nothing is readable.
 */
export function locatedFiles(): LocatedFiles {
  if (!fence) return { listable: () => false, readFile: () => undefined }
  const guard = credentialReferenceGuard(fence.credentialStores, new Set(), { realpath: path => realpathSync.native(path), stat: path => statSync(path, { bigint: true }), readRegular: readRegularFileNoFollow })
  return {
    listable: path => !guard.isStoreTarget(path),
    readFile: path => guard.isStoreTarget(path) ? undefined : new TextEncoder().encode(guard.readFile(path)),
  }
}
