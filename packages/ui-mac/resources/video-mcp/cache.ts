import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { Flock } from "@opencode/util/flock"
import type { VideoRuntime } from "./runtime"

export const digest = (value: string) => createHash("sha256").update(value).digest("hex")

export async function fileDigest(file: string) {
  const hash = createHash("sha256")
  for await (const block of createReadStream(file)) hash.update(block)
  return hash.digest("hex")
}

export function cachePath(runtime: Pick<VideoRuntime, "cacheRoot">, ...keys: string[]) {
  if (keys.some((key) => !/^[a-zA-Z0-9._-]+$/.test(key))) throw new Error("Invalid internal cache key")
  return path.join(runtime.cacheRoot, ...keys)
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  return readFile(file, "utf8").then((value) => JSON.parse(value) as T).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return undefined
    throw error
  })
}

export async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  const pending = `${file}.${randomUUID()}.part`
  try {
    await writeFile(pending, JSON.stringify(value), { flag: "wx" })
    await rename(pending, file)
  } finally { await rm(pending, { force: true }) }
}

export async function withMediaLock<T>(runtime: VideoRuntime, key: string, operation: () => Promise<T>) {
  // The existing call signal is the bound; a 15-minute transcript must not inherit
  // Flock's unrelated five-minute default acquisition limit.
  return Flock.withLock(key, operation, { dir: cachePath(runtime, "locks"), signal: runtime.signal, timeoutMs: Infinity })
}

export type Published<T> = { value: T; files: { path: string; bytes: number; sha256: string }[] }

export async function readPublished<T>(file: string) {
  const record = await readJson<Published<T>>(file)
  if (!record) return undefined
  for (const item of record.files) {
    const info = await stat(item.path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error })
    if (!info?.isFile() || info.size !== item.bytes || await fileDigest(item.path) !== item.sha256) return undefined
  }
  return record.value
}

export async function publish<T>(file: string, value: T, files: string[] = []) {
  const entries = await Promise.all(files.map(async (entry) => ({ path: entry, bytes: (await stat(entry)).size, sha256: await fileDigest(entry) })))
  await writeJson(file, { value, files: entries } satisfies Published<T>)
}
