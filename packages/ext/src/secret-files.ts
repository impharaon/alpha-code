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

type EntryPlan = { readonly candidate: string; readonly descend: boolean; readonly link: boolean; resolved?: readonly (ProtectedFiles.ProtectedFile | undefined)[] }

export function createSecretFiles(roots: ProtectedFiles.ProtectedRoots) {
  const directories = new Map<string, { version: string; entries: Dirent[] }>()
  // Per source and directory version, whose entry names and kinds are then fixed: what each entry was found to be.
  const plans = new Map<string, { version: string; entries: EntryPlan[] }>()
  const files = new Map<string, string>()
  const retained = new Map<string, Uint8Array>()
  const encrypted = new Map<string, Uint8Array[]>()
  let snapshot: readonly Uint8Array[] = []
  const publishValues = () => { snapshot = [...retained.values(), ...[...encrypted.values()].flat()] }
  let pending: Promise<void> | undefined
  let requested = 0
  let completed = 0
  let disposed = false
  const remember = (values: readonly Uint8Array[]) => {
    if (disposed) return
    const previous = retained.size
    for (const value of values) if (value.length) retained.set(Buffer.from(value).toString("base64"), value)
    if (retained.size !== previous) publishValues()
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
    if (file.profile === "encrypted-store") {
      for (const value of encrypted.get(file.path) ?? []) value.fill(0)
      encrypted.set(file.path, values)
      publishValues()
    } else remember(values)
    files.set(key, version)
  }
  const scan = async () => {
    for (const [index, source] of ProtectedFiles.sources(roots).entries()) {
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
        const version = sourceVersion(identity)
        const planKey = `${index}\0${directory}`
        let plan = plans.get(planKey)
        if (plan?.version !== version) {
          plan = {
            version,
            entries: entries.flatMap((entry): EntryPlan[] => {
              const candidate = path.join(directory, entry.name)
              if (!entry.isDirectory() && !entry.isSymbolicLink()) return [{ candidate, descend: false, link: false }]
              const relative = path.relative(source.root, candidate).split(path.sep).join("/")
              // Published literal subtree exclusions prune IO; only Schema matches protected file paths.
              if (relative.split("/").some((segment) => source.exclude.includes(`**/${segment}`))) return []
              const descend = source.include.some((pattern) => canDescend(relative, pattern, roots.platform))
              return [{ candidate, descend, link: entry.isSymbolicLink() }]
            }),
          }
          plans.set(planKey, plan)
        }
        for (const item of plan.entries) {
          if (disposed) return
          const candidate = item.candidate
          if (item.descend) await walk(candidate)
          let matches = item.resolved
          if (!matches) {
            const target = await available(() => realpath(candidate))
            if (!target) continue
            matches = [ProtectedFiles.match({ path: candidate, roots }), ProtectedFiles.match({ path: target, roots })]
            // A link's target can move while its directory stays the same; any other entry resolves the same until it does.
            if (!item.link) item.resolved = matches
          }
          if (!matches.some((file) => file !== undefined)) continue
          const info = await available(() => stat(candidate, { bigint: true }))
          if (!info?.isFile()) continue
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
    values: () => snapshot,
    refresh: async () => {
      if (disposed) throw new Error("Secret files released")
      const generation = ++requested
      while (completed < generation) {
        if (!pending) {
          const capturing = requested
          pending = scan().then(() => { completed = capturing }).finally(() => { pending = undefined })
        }
        await pending
      }
      if (disposed) throw new Error("Secret files released")
    },
    dispose: () => {
      disposed = true
      directories.clear()
      plans.clear()
      files.clear()
      retained.clear()
      for (const values of encrypted.values()) for (const value of values) value.fill(0)
      encrypted.clear()
      snapshot = []
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

function canDescend(relative: string, pattern: string, platform: ProtectedFiles.PathPlatform) {
  const segments = (platform === "win32" ? relative.toLowerCase() : relative).split("/")
  const parts = (platform === "win32" ? pattern.toLowerCase() : pattern).split("/")
  const recursive = parts.indexOf("**")
  const prefix = recursive === -1 ? parts.slice(0, -1) : parts.slice(0, recursive)
  if (recursive === -1 && segments.length >= parts.length) return false
  return segments.every((segment, index) => index >= prefix.length || /[*?]/.test(prefix[index]) || segment === prefix[index])
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
