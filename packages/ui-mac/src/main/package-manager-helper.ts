import { dirname, join } from "node:path"
import { loadFenceAddon } from "./process-fence-apply"

export const PACKAGE_MANAGER_HELPER = "codepuppy-package-manager"
export function packageManagerHelperPath(addonPath: string) { return join(dirname(addonPath), PACKAGE_MANAGER_HELPER) }
export type NativeHelperPeer = { pid: number; pidversion: number; executable: string; signingIdentity: string }
export type BoundShellProcess = { pid: number; startTime: { seconds: number; microseconds: number } }
export type PackageManagerNodeClaim = { executionID: string; nodeID: string; nodeProof: string }
export type PackageManagerNodeGrant =
  | { kind: "delegated"; brokerPort: number; authorization: string }
  | { kind: "fenced" }
  | { kind: "error"; error: "unauthorized" | "inactive-execution" | "node-consumed" }
export type PackageManagerNative = {
  startPackageManagerService(name: string, helper: string, claim: (input: PackageManagerNodeClaim, peer: NativeHelperPeer, reply: (grant: PackageManagerNodeGrant) => void) => void): unknown
  closePackageManagerService(service: unknown): void
  packageManagerProcessIdentity(pid: number): BoundShellProcess | undefined
  packageManagerBoundDescendant(pid: number, pidversion: number, root: BoundShellProcess): boolean
}
export function loadPackageManagerNative(addon: string): PackageManagerNative {
  const native = loadFenceAddon(addon) as unknown as PackageManagerNative
  if ([native.startPackageManagerService, native.closePackageManagerService, native.packageManagerProcessIdentity, native.packageManagerBoundDescendant].some((entry) => typeof entry !== "function")) throw new Error("package-manager native service exports missing")
  return native
}
