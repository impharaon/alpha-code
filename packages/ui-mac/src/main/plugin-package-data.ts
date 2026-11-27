import { chmodSync, lstatSync, mkdirSync, rmSync, rmdirSync } from "node:fs"
import { join } from "node:path"
import { pluginDataDirectory } from "../shared/installed-plugin-settings"
export { pluginDataDirectory } from "../shared/installed-plugin-settings"

let dataHome: string | undefined
let environment: Readonly<Record<string, string | undefined>> = {}
export function publishPluginEnvironment(value: Record<string, string | undefined>) { environment = Object.freeze({ ...value }) }
export function pluginEnvironment(name: string) { return environment[name] }
/** Published by server.ts from the actual generation's fence roots, never re-derived from process.env. */
export function publishPluginDataHome(value: string) { dataHome = value }
export function pluginDataHome(): string {
  if (!dataHome) throw Error("Plugin runtime data root is unavailable")
  return dataHome
}
export function preparePluginData(home: string, packageId: string): { directory: string; created: boolean } {
  const directory = pluginDataDirectory(home, packageId)
  const parent = join(home, "opencode", "plugin-data")
  for (const dir of [home, join(home, "opencode"), parent]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw Error("Plugin data parent is not an owned directory")
  }
  try {
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw Error("Plugin data is not an owned directory")
    return { directory, created: false }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    mkdirSync(directory, { mode: 0o700 })
    chmodSync(directory, 0o700)
    return { directory, created: true }
  }
}
export function discardPreparedPluginData(directory: string) { try { rmdirSync(directory) } catch { /* A used/existing directory is never removed by failed preparation. */ } }
export function removePluginData(home: string, packageId: string) {
  const parent = join(home, "opencode", "plugin-data")
  try {
    if (lstatSync(parent).isSymbolicLink()) throw Error("Plugin data parent is a symbolic link")
    rmSync(pluginDataDirectory(home, packageId), { recursive: true, force: true })
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
}
