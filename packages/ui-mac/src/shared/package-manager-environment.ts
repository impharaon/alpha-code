import { isAbsolute } from "node:path"

export type PackageManagerEnvironment = Readonly<Record<string, string>>

let refresh: (() => Promise<PackageManagerEnvironment>) | undefined

let environment: PackageManagerEnvironment = Object.freeze({})

export function parsePackageManagerEnvironment(value: unknown): PackageManagerEnvironment {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid package manager environment")
  const entries = Object.entries(value)
  if (entries.some(([, path]) => typeof path !== "string" || !isAbsolute(path))) throw new Error("invalid package manager environment path")
  return Object.freeze(Object.fromEntries(entries))
}

/** Installed by this engine's host, before any Location or tool is created. */
export function installPackageManagerEnvironment(value: unknown, pull?: () => Promise<PackageManagerEnvironment>) {
  environment = parsePackageManagerEnvironment(value)
  refresh = pull
}

export async function refreshPackageManagerEnvironment() {
  if (environment.GOCACHE !== undefined && environment.GOPATH === undefined && refresh) environment = parsePackageManagerEnvironment(await refresh())
}

export function packageManagerEnvironment(): PackageManagerEnvironment {
  return environment
}

export function projectPackageManagerEnvironment<T>(source: Readonly<Record<string, T>> | undefined) {
  return { ...source, ...environment }
}


export type PackageManagerEnvironmentRequest = { type: "package-manager-environment.request"; id: number }
export type PackageManagerEnvironmentReply = { type: "package-manager-environment.result"; id: number; environment: PackageManagerEnvironment }

export function parsePackageManagerEnvironmentRequest(value: unknown): PackageManagerEnvironmentRequest | undefined {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 2 || !("type" in value) || value.type !== "package-manager-environment.request" || !("id" in value) || typeof value.id !== "number" || !Number.isSafeInteger(value.id) || value.id <= 0) return
  return { type: value.type, id: value.id }
}

/** One read-only pull at a time, scoped to the current parent port; close releases pending spawns. */
export function createPackageManagerEnvironmentRequester(post: (message: PackageManagerEnvironmentRequest) => void, initial: PackageManagerEnvironment) {
  let next = 0
  let closed = false
  let pending: { id: number; promise: Promise<PackageManagerEnvironment>; resolve: (value: PackageManagerEnvironment) => void } | undefined
  const settle = (value: PackageManagerEnvironment) => {
    pending?.resolve(value)
    pending = undefined
  }
  return {
    pull(): Promise<PackageManagerEnvironment> {
      if (closed) return Promise.resolve(initial)
      if (pending) return pending.promise
      const id = ++next
      const result = Promise.withResolvers<PackageManagerEnvironment>()
      pending = { id, ...result }
      try { post({ type: "package-manager-environment.request", id }) } catch { settle(initial) }
      return result.promise
    },
    receive(value: unknown): boolean {
      if (!value || typeof value !== "object" || !("type" in value) || value.type !== "package-manager-environment.result") return false
      if (Object.keys(value).length !== 3 || !("id" in value) || value.id !== pending?.id || !("environment" in value)) return true
      try { settle(parsePackageManagerEnvironment(value.environment)) } catch { settle(initial) }
      return true
    },
    close() { closed = true; settle(initial) },
  }
}
