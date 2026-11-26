import { chmod, cp, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { LauncherPlatform } from "../../util/src/codepuppy-connector-launch"
import { launcherEntries, writeLauncherInventory } from "../src/main/connector-launchers"

export const launcherFixtureSamples = join(import.meta.dir, "../src/main/fixtures/connector-launchers")

export async function launcherHeader(platform: LauncherPlatform, binary: "uv" | "uvx" | "node") {
  return Buffer.from(await readFile(join(launcherFixtureSamples, `${platform}-${binary}.header.b64`), "utf8"), "base64")
}

/** Captured original headers/npm files; never executes the truncated binary samples. */
export async function writeLauncherFixture(resources: string, platform: LauncherPlatform) {
  const directory = join(resources, "connector-launchers")
  const entries = launcherEntries(platform)
  for (const binary of ["uv", "uvx", "node"] as const) {
    const file = join(directory, entries[binary])
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, await launcherHeader(platform, binary))
    await chmod(file, 0o755)
  }
  const npm = join(directory, dirname(dirname(entries.npmCli)))
  await cp(join(launcherFixtureSamples, "npm"), npm, { recursive: true })
  await rename(join(npm, "package.sample"), join(npm, "package.json"))
  await mkdir(join(directory, "licenses/uv"), { recursive: true })
  await mkdir(join(directory, "licenses/node"), { recursive: true })
  for (const file of ["LICENSE-MIT", "LICENSE-APACHE"]) await cp(join(launcherFixtureSamples, file), join(directory, "licenses/uv", file))
  await cp(join(launcherFixtureSamples, "node-LICENSE-prefix"), join(directory, "licenses/node/LICENSE"))
  return { directory, entries, bundle: await writeLauncherInventory(directory, platform, "expanded") }
}
