import { readdir, readFile, realpath, stat } from "node:fs/promises"
import type { BigIntStats, Dirent } from "node:fs"
import path from "node:path"
import { ProtectedFiles } from "../../schema/src/codepuppy-protected-files"
import { credentialValues, documentValues, secretScalar } from "./secret-values"

export function sourceVersion(value: Pick<BigIntStats, "dev" | "ino" | "size" | "mtimeNs" | "ctimeNs">) {
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(":")
}

export async function resolveProtectedFile(file: string, roots: ProtectedFiles.ProtectedRoots) {
  const api = roots.platform === "win32" ? path.win32 : path
  const absolute = api.resolve(roots.directory, file)
  const lexical = ProtectedFiles.match({ path: absolute, roots })
  if (lexical) return lexical
  const target = await available(() => realpath(absolute))
  if (!target) return
  const direct = ProtectedFiles.match({ path: target, roots })
  if (direct) return direct
  for (const source of ProtectedFiles.sources(roots)) {
    const root = await available(() => realpath(source.root))
    if (!root) continue
    const relative = api.relative(root, target)
    if (relative === ".." || relative.startsWith(`..${api.sep}`) || api.isAbsolute(relative)) continue
    const match = ProtectedFiles.match({ path: api.join(source.root, relative), roots })
    if (match) return { ...match, path: target }
  }
}

export function createSecretFiles(roots: ProtectedFiles.ProtectedRoots) {
  const directories = new Map<string, { version: string; entries: Dirent[] }>()
  const files = new Map<string, string>()
  const retained = new Map<string, Uint8Array>()
  let pending: Promise<void> | undefined
  let disposed = false
  const remember = (values: readonly Uint8Array[]) => {
    if (disposed) return
    for (const value of values) if (value.length) retained.set(Buffer.from(value).toString("base64"), value)
  }
  const capture = async (file: ProtectedFiles.ProtectedFile, identity: BigIntStats) => {
    const versions =
      file.format === "sqlite"
        ? await Promise.all(
            ["", "-wal", "-shm"].map(async (suffix) => {
              const info = await available(() =>
                stat(file.path.replace(/-(?:wal|shm)$/, "") + suffix, { bigint: true }),
              )
              return info ? sourceVersion(info) : "missing"
            }),
          )
        : [sourceVersion(identity)]
    const key = `${identity.dev}:${identity.ino}:${file.profile}:${file.format}`
    const version = versions.join("|")
    if (files.get(key) === version) return
    const values =
      file.format === "sqlite" ? await sqliteValues(file) : credentialValues(file, await readFile(file.path))
    remember(values)
    files.set(key, version)
  }
  const scan = async () => {
    for (const source of ProtectedFiles.sources(roots)) {
      const visited = new Set<string>()
      const walk = async (directory: string): Promise<void> => {
        if (disposed) return
        const identity = await available(() => stat(directory, { bigint: true }))
        if (!identity) {
          // Observe the nearest existing parent without treating siblings as sources.
          const parent = path.dirname(directory)
          if (parent !== directory) {
            const ancestor = await available(() => stat(parent, { bigint: true }))
            if (!ancestor) await walkMissing(parent)
            else await directoryEntries(parent, ancestor)
          }
          return
        }
        if (!identity.isDirectory()) return
        const key = `${identity.dev}:${identity.ino}`
        if (visited.has(key)) return
        visited.add(key)
        const entries = await directoryEntries(directory, identity)
        for (const entry of entries) {
          if (disposed) return
          const candidate = path.join(directory, entry.name)
          const relative = path.relative(source.root, candidate).split(path.sep).join("/")
          if (source.exclude.some((pattern) => pathGlob(relative, pattern, roots.platform))) continue
          if (entry.isDirectory() || entry.isSymbolicLink()) {
            if (source.include.some((pattern) => canDescend(relative, pattern, roots.platform))) await walk(candidate)
          }
          if (!source.include.some((pattern) => pathGlob(relative, pattern, roots.platform))) continue
          const target = await available(() => realpath(candidate))
          if (!target) continue
          const info = await available(() => stat(candidate, { bigint: true }))
          if (!info?.isFile()) continue
          const matches = [
            ProtectedFiles.match({ path: candidate, roots }),
            ProtectedFiles.match({ path: target, roots }),
          ]
          for (const file of matches)
            if (file) {
              // Missing/unreadable sources are retried; other failures propagate to this call's hidden result.
              await available(() => capture(file, info))
            }
        }
      }
      await walk(source.root)
    }
  }
  const directoryEntries = async (directory: string, identity: BigIntStats) => {
    const version = sourceVersion(identity)
    const previous = directories.get(directory)
    if (previous?.version === version) return previous.entries
    const entries = (await available(() => readdir(directory, { withFileTypes: true }))) ?? []
    directories.set(directory, { version, entries })
    return entries
  }
  const walkMissing = async (directory: string): Promise<void> => {
    const identity = await available(() => stat(directory, { bigint: true }))
    if (identity) {
      await directoryEntries(directory, identity)
      return
    }
    if (path.dirname(directory) !== directory) await walkMissing(path.dirname(directory))
  }
  return {
    roots,
    remember,
    values: () => [...retained.values()],
    refresh: async () => {
      if (disposed) throw new Error("Secret files released")
      if (!pending)
        pending = scan().finally(() => {
          pending = undefined
        })
      await pending
      if (disposed) throw new Error("Secret files released")
    },
    dispose: () => {
      disposed = true
      directories.clear()
      files.clear()
      retained.clear()
    },
  }
}

async function available<T>(run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run()
  } catch (cause) {
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      ["ENOENT", "EACCES", "EPERM"].includes(String(cause.code))
    )
      return
    throw cause
  }
}

function pathGlob(value: string, pattern: string, platform: ProtectedFiles.PathPlatform) {
  return path.posix.matchesGlob(
    platform === "win32" ? value.toLowerCase() : value,
    platform === "win32" ? pattern.toLowerCase() : pattern,
  )
}

function canDescend(relative: string, pattern: string, platform: ProtectedFiles.PathPlatform) {
  const segments = relative.split("/")
  const parts = pattern.split("/")
  const recursive = parts.indexOf("**")
  const prefix = recursive === -1 ? parts.slice(0, -1) : parts.slice(0, recursive)
  if (recursive === -1 && segments.length >= parts.length) return false
  return segments.every((segment, index) => index >= prefix.length || pathGlob(segment, prefix[index], platform))
}

async function sqliteValues(file: ProtectedFiles.ProtectedFile) {
  const selection = ProtectedFiles.CredentialFields[file.profile]
  if (!("sqlite" in selection)) throw new Error("Invalid credential database profile")
  const { DatabaseSync } = await import("node:sqlite")
  const database = new DatabaseSync(file.path.replace(/-(?:wal|shm)$/, ""), { readOnly: true, allowExtension: false })
  try {
    const values: Uint8Array[] = []
    for (const table of selection.sqlite) {
      const exists = database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(table.table)
      if (!exists) continue
      const columns = database
        .prepare(`SELECT name FROM pragma_table_info('${table.table}')`)
        .all()
        .map((row) => row.name)
      const selected = table.columns.filter((name) => columns.includes(name))
      if (!selected.length) continue
      for (const row of database
        .prepare(`SELECT ${selected.map((name) => `"${name}"`).join(",")} FROM "${table.table}"`)
        .iterate()) {
        for (const name of selected) {
          const value = row[name]
          if (value === null || value === "") continue
          if ("json" in table) {
            const text =
              value instanceof Uint8Array ? new TextDecoder("utf-8", { fatal: true }).decode(value) : String(value)
            values.push(...documentValues(file.profile, JSON.parse(text)))
            continue
          }
          values.push(...secretScalar(name, value))
        }
      }
    }
    return values
  } finally {
    database.close()
  }
}
