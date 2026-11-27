import { spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { FENCE_ADDON_ARCHS, FENCE_ADDON_BUILD_DIR } from "./build-fence-addon"
import { PACKAGE_MANAGER_HELPER } from "../src/main/package-manager-helper"

export const PACKAGE_MANAGER_HELPER_SOURCE = join(import.meta.dirname, "../native/codepuppy-fence/package_manager_helper.m")
export const PACKAGE_MANAGER_HELPER_OUT = join(FENCE_ADDON_BUILD_DIR, PACKAGE_MANAGER_HELPER)

/** Local build uses a strict ad-hoc signature; production packaging replaces only its signing identity. */
export function buildPackageManagerHelper(out = PACKAGE_MANAGER_HELPER_OUT) {
  mkdirSync(dirname(out), { recursive: true })
  const compile = spawnSync("clang", ["-O2", "-fobjc-arc", ...FENCE_ADDON_ARCHS.flatMap((arch) => ["-arch", arch]), "-mmacosx-version-min=11.0", "-framework", "Foundation", PACKAGE_MANAGER_HELPER_SOURCE, "-o", out], { encoding: "utf8" })
  if (compile.status !== 0) throw new Error(`package-manager helper compile failed: ${compile.stderr}`)
  signPackageManagerHelper(out, "-")
  const architectures = spawnSync("lipo", ["-archs", out], { encoding: "utf8" })
  if (architectures.status !== 0 || FENCE_ADDON_ARCHS.some((arch) => !architectures.stdout.trim().split(/\s+/).includes(arch))) throw new Error("package-manager helper architecture missing")
  return out
}

export function signPackageManagerHelper(binary: string, identity: string, keychain?: string) {
  const sign = spawnSync("codesign", ["--force", "--sign", identity, ...(keychain ? ["--keychain", keychain] : []), "--identifier", "app.codepuppy.package-manager", "--options", "runtime,restrict,kill", binary], { encoding: "utf8" })
  if (sign.status !== 0) throw new Error(`package-manager helper signing failed: ${sign.stderr}`)
  const check = spawnSync("codesign", ["--verify", "--strict", "--all-architectures", binary], { encoding: "utf8" })
  if (check.status !== 0) throw new Error(`package-manager helper signature check failed: ${check.stderr}`)
}

if (import.meta.main && process.platform === "darwin") console.log(buildPackageManagerHelper())
