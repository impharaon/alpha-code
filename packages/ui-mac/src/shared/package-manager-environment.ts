import { isAbsolute } from "node:path"

export type PackageManagerEnvironment = Readonly<Record<string, string>>

let environment: PackageManagerEnvironment = Object.freeze({})

export function parsePackageManagerEnvironment(value: unknown): PackageManagerEnvironment {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid package manager environment")
  const entries = Object.entries(value)
  if (entries.some(([, path]) => typeof path !== "string" || !isAbsolute(path))) throw new Error("invalid package manager environment path")
  return Object.freeze(Object.fromEntries(entries))
}

/** Installed by this engine's host, before any Location or tool is created. */
export function installPackageManagerEnvironment(value: unknown) {
  environment = parsePackageManagerEnvironment(value)
}

export function packageManagerEnvironment(): PackageManagerEnvironment {
  return environment
}

export function projectPackageManagerEnvironment<T>(source: Readonly<Record<string, T>> | undefined) {
  return { ...source, ...environment }
}
