import { createHash } from "node:crypto"
import { createReadStream, readFileSync, realpathSync } from "node:fs"
import { lstat, mkdir, realpath, rename } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, sep } from "node:path"
import type { EnsurePinnedFileResult, PinnedFileId, PinnedFiles } from "../../../util/src/codepuppy-pinned-files"
import type { DownloadFailureEvidence, PinnedFileDelivery } from "../../../util/src/codepuppy-connector-launch"
import { CODEPUPPY_GITHUB_RELAY_HOST } from "../shared/codepuppy-config"
import { sanitizeTransportError, writeChunksChecked } from "./codepuppy-artifact-download"
import { resourcesRoot } from "./ext-fs-installer"
import { USER_DATA_LAYOUT } from "./user-data-layout"

/** Same acceptance rules as domestic-cloud-connectivity §4.11.1's relay parser. */
export function parsePinnedFiles(value: unknown): PinnedFiles {
  const record = (input: unknown): input is Record<string, unknown> => !!input && typeof input === "object" && !Array.isArray(input)
  const require = (ok: unknown, detail: string) => { if (!ok) throw new Error(`invalid pinned files: ${detail}`) }
  require(record(value) && value.schemaVersion === 1 && Array.isArray(value.files), "schema")
  const manifest = value as PinnedFiles
  const ids = new Set<string>()
  const paths = new Set<string>()
  for (const file of manifest.files) {
    require(record(file) && (["id", "family", "target", "version", "originUrl", "sha256", "provenanceUrl"] as const).every((key) => typeof file[key] === "string" && file[key]), "file fields")
    require(["python", "libreoffice", "speech-model", "ocr-model", "ffmpeg"].includes(file.family) && ["darwin-arm64", "win32-x64", "any"].includes(file.target), "family/target")
    require(file.id.startsWith(`${file.family}/${file.target}/`) && !ids.has(file.id), "id")
    require(!/^(latest|main|master|head)$/i.test(file.version) && !/[~^*<>=]/.test(file.version), "version")
    require(/^[0-9a-f]{64}$/.test(file.sha256) && Number.isSafeInteger(file.bytes) && file.bytes > 0, "file identity")
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/.exec(file.originUrl)
    require(match && !/[?#]/.test(file.originUrl), "origin")
    const segments = match!.slice(1).map((segment) => {
      const decoded = decodeURIComponent(segment)
      const twice = decodeURIComponent(decoded.replace(/%(?![0-9a-f]{2})/gi, "%25"))
      require([decoded, twice].every((part) => part && part !== "." && part !== ".." && !/[/\\\x00-\x1f\x7f]/.test(part)), "asset segment")
      require(encodeURIComponent(decoded).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`) === segment, "origin encoding")
      return decoded
    })
    const path = JSON.stringify(segments)
    require(!paths.has(path), "conflicting asset path")
    ids.add(file.id)
    paths.add(path)
  }
  return manifest
}

export function readPinnedFiles(): PinnedFiles {
  return parsePinnedFiles(JSON.parse(readFileSync(join(resourcesRoot(), "pinned-files.json"), "utf8")))
}

type Request = {
  id: PinnedFileId
  targetPath: string
  signal?: AbortSignal
  onProgress?: (received: number, total: number) => void
}
type Waiter = { progress?: Request["onProgress"] }

class TransportFailure extends Error {
  constructor(readonly failure: DownloadFailureEvidence, readonly error: "network" | "integrity" = "network") {
    super(failure.detail)
  }
}

const cancelled = (): PinnedFileDelivery => ({ result: { ok: false, error: "cancelled" } })
const detailOf = (error: unknown) => sanitizeTransportError(error instanceof Error ? error.message : String(error))
const inside = (root: string, path: string) => { const part = relative(root, path); return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part) }

/** One instance at the main composition root owns the host's manifest and in-flight IDs. */
export function createPinnedFileAuthority(input: {
  userData: string
  manifest: PinnedFiles
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
}) {
  const manifest = parsePinnedFiles(input.manifest)
  const root = join(realpathSync(input.userData), USER_DATA_LAYOUT.pinnedFiles)
  const files = new Map(manifest.files.map((file) => [file.id, file]))
  const fetchImpl = input.fetchImpl ?? fetch
  const inflight = new Map<PinnedFileId, {
    controller: AbortController
    waiters: Set<Waiter>
    promise: Promise<PinnedFileDelivery>
    progress?: [number, number]
  }>()

  function targetPath(id: PinnedFileId) {
    const file = files.get(id)
    if (!file) throw new Error("unknown pinned file")
    const path = join(root, id, decodeURIComponent(new URL(file.originUrl).pathname.split("/").at(-1)!))
    if (!inside(root, path)) throw new Error("pinned file path escapes its root")
    return path
  }

  async function ensureDelivery(request: Request): Promise<PinnedFileDelivery> {
    if (!files.has(request.id)) return { result: { ok: false, error: "unknown-file" } }
    if (request.signal?.aborted) return cancelled()
    try {
      if (request.targetPath !== targetPath(request.id)) throw new Error("pinned file target differs from host path")
    } catch (error) {
      return { result: { ok: false, error: "disk" }, failure: { kind: "disk", detail: detailOf(error) } }
    }
    const shared = inflight.get(request.id) ?? (() => {
      const controller = new AbortController()
      const waiters = new Set<Waiter>()
      const state = {
        controller, waiters,
        promise: Promise.resolve().then(() => acquire(files.get(request.id)!, request.targetPath, controller.signal, (received, total) => {
          state.progress = [received, total]
          for (const waiter of waiters) waiter.progress?.(received, total)
        })),
        progress: undefined as [number, number] | undefined,
      }
      inflight.set(request.id, state)
      void state.promise.then(() => { if (inflight.get(request.id) === state) inflight.delete(request.id) })
      return state
    })()
    return new Promise((resolve) => {
      const waiter = { progress: request.onProgress }
      const finish = (delivery: PinnedFileDelivery) => {
        if (!shared.waiters.delete(waiter)) return
        request.signal?.removeEventListener("abort", abort)
        if (!shared.waiters.size) {
          shared.controller.abort()
          if (inflight.get(request.id) === shared) inflight.delete(request.id)
        }
        resolve(delivery)
      }
      const abort = () => finish(cancelled())
      shared.waiters.add(waiter)
      request.signal?.addEventListener("abort", abort, { once: true })
      if (shared.progress) request.onProgress?.(...shared.progress)
      void shared.promise.then(finish)
    })
  }

  async function acquire(file: PinnedFiles["files"][number], path: string, signal: AbortSignal, progress: NonNullable<Request["onProgress"]>): Promise<PinnedFileDelivery> {
    try {
      // Walk before mkdir: a cache ancestor must never redirect the main downloader outside userData.
      const directories = relative(dirname(root), dirname(path)).split(sep)
      let current = dirname(root)
      for (const segment of directories) {
        current = join(current, segment)
        await mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error })
        if ((await lstat(current)).isSymbolicLink() || !inside(dirname(root), await realpath(current))) throw new Error("pinned file directory is a symlink")
      }
      const cached = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return undefined })
      if (cached?.isSymbolicLink() || (cached && !cached.isFile())) throw new Error("pinned cache is not a regular file")
      if (cached?.size === file.bytes) {
        const hash = createHash("sha256")
        for await (const chunk of createReadStream(path, { signal })) hash.update(chunk)
        if (hash.digest("hex") === file.sha256) {
          progress(file.bytes, file.bytes)
          return { result: { ok: true, path, via: "cache" } }
        }
      }
      let delivery: PinnedFileDelivery = { result: { ok: false, error: "network" } }
      for (const source of ["relay", "origin"] as const) {
        if (signal.aborted) return cancelled()
        const controller = new AbortController()
        const abort = () => controller.abort(signal.reason)
        signal.addEventListener("abort", abort, { once: true })
        let via: "relay" | "origin" = source
        try {
          const url = source === "relay" ? `https://${CODEPUPPY_GITHUB_RELAY_HOST}${new URL(file.originUrl).pathname}` : file.originUrl
          const response = await requestFile(url, {}, controller, file, () => { via = "origin" })
          let restart: Response | undefined = response
          while (restart) {
            const res = restart
            restart = undefined
            let transport: TransportFailure | undefined
            const chunks = streamFile(res, url, controller, file, () => via === "origin", (response) => { restart = response }, (error) => { transport = error })
            const outcome = await writeChunksChecked(chunks, {
              targetPath: path, maxBytes: file.bytes, expectedSize: file.bytes, expectedSha256: file.sha256,
              signal, via: "stream", onProgress: (update) => progress(update.bytes, file.bytes),
              finalize: async ({ partPath, targetPath }) => {
                if (signal.aborted) return { ok: false, error: "disk", detail: "pinned download cancelled before publication" }
                // Recheck the parent after streaming as well as before opening the part.
                if (await realpath(dirname(path)) !== dirname(path)) throw new Error("pinned directory changed during download")
                await rename(partPath, targetPath)
                return { ok: true }
              },
            })
            if (signal.aborted) return cancelled()
            if (restart) continue // Range ignored (200): writer discarded the prefix; hash from byte zero.
            if (outcome.ok) return { result: { ok: true, path, via } }
            const error = outcome.error === "disk" ? "disk" : transport?.error ?? (outcome.error === "network" ? "network" : "integrity")
            delivery = { result: { ok: false, error }, failure: transport?.failure ?? { kind: error === "network" ? "other" : error, detail: outcome.detail ?? outcome.error } }
          }
        } catch (error) {
          if (signal.aborted) return cancelled()
          delivery = error instanceof TransportFailure
            ? { result: { ok: false, error: error.error }, failure: error.failure }
            : { result: { ok: false, error: "disk" }, failure: { kind: "disk", detail: detailOf(error) } }
        } finally {
          controller.abort()
          signal.removeEventListener("abort", abort)
        }
        if (!delivery.result.ok && (delivery.result.error === "disk" || delivery.result.error === "cancelled")) return delivery
        if (via === "origin") return delivery // A relay 302 already took this request to origin.
      }
      return delivery
    } catch (error) {
      return signal.aborted ? cancelled() : { result: { ok: false, error: "disk" }, failure: { kind: "disk", detail: detailOf(error) } }
    }
  }

  async function requestFile(url: string, headers: Record<string, string>, controller: AbortController, file: PinnedFiles["files"][number], origin: () => void): Promise<Response> {
    for (let hop = 0; ; hop++) {
      const timer = setTimeout(() => controller.abort(new TransportFailure({ kind: "timeout", detail: "pinned file headers idle for 10000ms" })), 10_000)
      let response: Response
      try {
        response = await fetchImpl(url, { signal: controller.signal, redirect: "manual", credentials: "omit", headers: { "Accept-Encoding": "identity", ...headers } })
      } catch (error) {
        if (controller.signal.reason instanceof TransportFailure) throw controller.signal.reason
        const code = error && typeof error === "object" && "cause" in error ? error.cause : error
        const errno = code && typeof code === "object" && "code" in code ? String(code.code) : ""
        throw new TransportFailure({ kind: /TIMEDOUT|TIMEOUT/.test(errno) ? "timeout" : /^(ECONN|ENET|EHOST|ENOTFOUND|EAI_)/.test(errno) ? "connect" : "other", detail: detailOf(error) })
      } finally {
        clearTimeout(timer)
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get("location") ?? ""
        await response.body?.cancel()
        const same = [file.originUrl, file.originUrl.replaceAll("%2B", "+"), file.originUrl.replaceAll("%2B", "%2b")].includes(next)
        if (hop >= 3 || (!same && !/^https:\/\/(release-assets|objects)\.githubusercontent\.com\//.test(next)) || /[\x00-\x20\\]/.test(next)) {
          throw new TransportFailure({ kind: "other", detail: "invalid pinned file redirect" })
        }
        if (same) origin()
        url = next
        continue
      }
      if (response.status !== 200 && response.status !== 206) {
        await response.body?.cancel()
        throw new TransportFailure({ kind: "http", status: response.status, detail: `HTTP ${response.status}` })
      }
      return response
    }
  }

  async function* streamFile(response: Response, url: string, controller: AbortController, file: PinnedFiles["files"][number], atOrigin: () => boolean, restart: (res: Response) => void, failed: (error: TransportFailure) => void): AsyncGenerator<Uint8Array> {
    let offset = 0
    for (;;) {
      const start = offset
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "")
      const end = response.status === 206 ? Number(range?.[2]) + 1 : file.bytes
      const length = response.headers.get("content-length")
      if ((response.status === 206 && (!range || Number(range[1]) !== offset || Number(range[3]) !== file.bytes || end <= offset || end > file.bytes)) || (length !== null && (!/^\d+$/.test(length) || Number(length) !== end - start))) {
        await response.body?.cancel()
        const error = new TransportFailure({ kind: "integrity", detail: "pinned file response length/range differs from identity" }, "integrity")
        failed(error)
        throw error
      }
      const validator = response.headers.get("etag")?.replace(/^W\/.*$/, "") || response.headers.get("last-modified")
      const resumable = atOrigin() && response.headers.get("accept-ranges") === "bytes" && !!validator
      const reader = response.body?.getReader()
      if (!reader) return
      try {
        for (;;) {
          let timer: ReturnType<typeof setTimeout> | undefined
          const read = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => { timer = setTimeout(() => {
              const error = new TransportFailure({ kind: "timeout", detail: "pinned file body idle for 30000ms" })
              controller.abort(error)
              reject(error)
            }, 30_000) }),
          ]).finally(() => clearTimeout(timer))
          if (read.done) {
            if (offset !== end) throw new Error("pinned file body ended early")
            break
          }
          offset += read.value.byteLength
          yield read.value
        }
        if (offset === file.bytes) return
      } catch (error) {
        if (!resumable || offset <= start || offset >= file.bytes || controller.signal.aborted) {
          const failure = error instanceof TransportFailure ? error : new TransportFailure({ kind: "connect", detail: detailOf(error) })
          failed(failure)
          throw failure
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      try {
        response = await requestFile(url, { Range: `bytes=${offset}-`, ...(validator ? { "If-Range": validator } : {}) }, controller, file, () => {})
      } catch (error) {
        if (error instanceof TransportFailure) failed(error)
        throw error
      }
      if (response.status === 200) { restart(response); return }
    }
  }

  async function ensurePinnedFile(request: Request): Promise<EnsurePinnedFileResult> {
    return (await ensureDelivery(request)).result
  }
  async function ensureFile(id: PinnedFileId, signal: AbortSignal, onProgress: NonNullable<Request["onProgress"]>): Promise<PinnedFileDelivery> {
    if (!files.has(id)) return { result: { ok: false, error: "unknown-file" } }
    try { return await ensureDelivery({ id, targetPath: targetPath(id), signal, onProgress }) }
    catch (error) { return { result: { ok: false, error: "disk" }, failure: { kind: "disk", detail: detailOf(error) } } }
  }
  return { targetPath, ensurePinnedFile, ensureFile }
}
