// Closed official recipes and read-only install prerequisites (also used by Catalog evaluation).
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { userInfo, tmpdir } from "node:os"
import { isAbsolute, join, sep } from "node:path"
import { environmentFromMutableRoot } from "./codepuppy-environment"
import { keychainBackend } from "./codepuppy-keychain-backend"

// Source: DBHub v1.5.0 CLI migration template and https://dbhub.ai/config/toml .
export const DBHUB_READONLY_TOML =
  '[[sources]]\nid = "default"\ndsn = "${DSN}"\n\n[[tools]]\nname = "execute_sql"\nsource = "default"\nreadonly = true\n'
import type { OfficialConnectorName } from "./official-connector-names"
import { commandOnPath, underGenerationFence } from "./shell-env"
export { OFFICIAL_CONNECTOR_NAMES, isOfficialConnector, type OfficialConnectorName } from "./official-connector-names"
export const officialConnectorFailure = () =>
  new Error("official-connector-needs-reentry: secure storage or runtime prerequisite unavailable")
export const insideDirectory = (root: string, target: string) => target === root || target.startsWith(root + sep)

export function officialConnectorBackend() {
  const value = keychainBackend()
  // Only macOS currently supplies the process fence that keeps ciphertext/TOML/cwd outside
  // engine-write roots. chmod alone cannot provide that boundary on the other platforms.
  if (process.platform !== "darwin" || !value?.isEncryptionAvailable()) throw officialConnectorFailure()
  return value
}

/**
 * The runtime directory's path, purely computed (DESIGN-stored-credentials-fence §4.5, implementation amendment 2): the fence rule C1
 * and the credential table list this path whatever the availability check in officialRuntimeParent says at plan time — the plaintext
 * is written later, when the check is evaluated again.
 */
export function officialRuntimeParentPath(root: string) {
  return join(
    realpathSync.native(tmpdir()),
    `codepuppy-connectors-${process.getuid?.()}-${createHash("sha256").update(root).digest("hex").slice(0, 16)}`,
  )
}

/** The materialising path's check, then the same path: throws while the runtime directory must not be used. */
export function officialRuntimeParent(root: string) {
  const temp = realpathSync.native(tmpdir())
  if (
    insideDirectory(realpathSync.native(userInfo().homedir), temp) ||
    insideDirectory(realpathSync.native(process.cwd()), temp)
  )
    throw officialConnectorFailure()
  const base = environmentFromMutableRoot(root)
  if (!base) throw officialConnectorFailure()
  // Read the main-only workspace truth at this synchronous secret boundary. Importing the
  // tracker also imports renderer contract checks through tabs-preclean (Window.api order).
  const truthPath = join(base.casBaseRoot, "fence-workspaces", `${base.environment}.json`)
  if (existsSync(truthPath)) {
    const truth = JSON.parse(readFileSync(truthPath, "utf8"))
    if (
      truth.v !== 1 ||
      !Array.isArray(truth.workspaces) ||
      truth.workspaces.some(
        (path: unknown) =>
          typeof path !== "string" || !isAbsolute(path) || (existsSync(path) && insideDirectory(realpathSync.native(path), temp)),
      )
    )
      throw officialConnectorFailure()
  }
  return officialRuntimeParentPath(root)
}

export function officialNodeCommand() {
  // PATH directories can be fence-writable: look them up without running anything, and run the version check fenced.
  const node = commandOnPath("node", process.env.PATH)
  const npx = commandOnPath("npx", process.env.PATH)
  const check = node ? underGenerationFence(node, ["--version"]) : undefined
  if (!node || !npx || !check) throw officialConnectorFailure()
  const tested = spawnSync(check.file, check.args, { encoding: "utf8", timeout: 5000, env: check.env ?? { PATH: process.env.PATH } })
  const version = /^v(\d+)\.(\d+)\.(\d+)\s*$/.exec(tested.stdout ?? "")
  if (
    tested.status !== 0 ||
    !version ||
    Number(version[1]) < 22 ||
    (Number(version[1]) === 22 && Number(version[2]) < 5)
  )
    throw officialConnectorFailure()
  return [node, realpathSync(npx), "-y", "@bytebase/dbhub@1.5.0", "--transport", "stdio"]
}

export function officialConnectorPrerequisite(name: OfficialConnectorName, root: string) {
  officialConnectorBackend()
  officialRuntimeParent(root)
  if (name === "dbhub-readonly") officialNodeCommand()
}
