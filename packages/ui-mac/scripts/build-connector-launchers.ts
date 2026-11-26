#!/usr/bin/env bun
import { copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { LauncherPlatform } from "../../util/src/codepuppy-connector-launch"
import lock from "../resources/connector-launchers/lock.json"
import { CONNECTOR_LAUNCHER_BUILD_DIR, launcherFileDigest, populateLauncherTree, writeLauncherInventory, type LauncherBundle } from "../src/main/connector-launchers"

/** Build-time only. Runtime never fetches uv or Node. */
export async function buildConnectorLaunchers(input: { platform: LauncherPlatform; destination: string; form: LauncherBundle["form"]; archives?: { uv: string; node: string }; licenses?: string }) {
  await mkdir(dirname(input.destination), { recursive: true })
  const staging = await mkdtemp(join(dirname(input.destination), "launcher-build-"))
  const downloads = await mkdtemp(join(tmpdir(), "launcher-sources-"))
  try {
    const get = async (pin: { url: string; sha256: string; bytes: number }, file: string) => {
      const response = await fetch(pin.url)
      if (!response.ok || !response.body) throw Error(`launcher build download: HTTP ${response.status}`)
      await Bun.write(file, response)
      if ((await stat(file)).size !== pin.bytes || await launcherFileDigest(file) !== pin.sha256) throw Error("launcher build source differs from lock")
      return file
    }
    const archives = input.archives ?? { uv: await get(lock.uv.targets[input.platform], join(downloads, "uv")), node: await get(lock.node.targets[input.platform], join(downloads, "node")) }
    await populateLauncherTree(staging, archives, input.platform)
    await mkdir(join(staging, "licenses/uv"), { recursive: true })
    await mkdir(join(staging, "licenses/node"), { recursive: true })
    for (const license of lock.licenses) {
      const source = input.licenses ? join(input.licenses, license.name) : await get(license, join(downloads, license.name))
      if ((await stat(source)).size !== license.bytes || await launcherFileDigest(source) !== license.sha256) throw Error("uv licence differs from lock")
      await copyFile(source, join(staging, "licenses/uv", license.name))
    }
    await copyFile(join(staging, "node/LICENSE"), join(staging, "licenses/node/LICENSE"))
    const prepared = await writeLauncherInventory(staging, input.platform, "expanded")
    if (input.form === "archives") {
      await mkdir(join(staging, "archives"))
      await cp(archives.uv, join(staging, "archives/uv"))
      await cp(archives.node, join(staging, "archives/node"))
      await rm(join(staging, "uv"), { recursive: true })
      await rm(join(staging, "node"), { recursive: true })
      await writeLauncherInventory(staging, input.platform, "archives", prepared.files)
    }
    await rm(input.destination, { recursive: true, force: true })
    await rename(staging, input.destination)
    return JSON.parse(await readFile(join(input.destination, "runtime.json"), "utf8")) as LauncherBundle
  } finally {
    await rm(staging, { recursive: true, force: true })
    await rm(downloads, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const platform = process.platform === "darwin" && process.arch === "arm64" ? "darwin-arm64" : process.platform === "win32" && process.arch === "x64" ? "win32-x64" : undefined
  if (!platform) throw Error("connector launchers target darwin-arm64 or win32-x64")
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  await buildConnectorLaunchers({ platform, destination: join(packageDir, CONNECTOR_LAUNCHER_BUILD_DIR, platform === "darwin-arm64" ? "mac-arm64" : "win-x64"), form: "expanded" })
}
