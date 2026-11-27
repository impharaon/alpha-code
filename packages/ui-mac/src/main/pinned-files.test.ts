import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import pins from "../../resources/pinned-files.json"
import type { PinnedFiles, PinnedFileId } from "../../../util/src/codepuppy-pinned-files"
import { CODEPUPPY_GITHUB_RELAY_HOST } from "../shared/codepuppy-config"
import { createPinnedFileAuthority, parsePinnedFiles, readPinnedFiles } from "./pinned-files"
import { createPinnedFileRequester, type PinnedFileRequest } from "../../../util/src/codepuppy-connector-launch"
import { createPinnedFileMainBridge } from "./connector-launch-host"

// Opaque transport bytes from the actual shipped manifest, not a stand-in archive format.
const payload = readFileSync(new URL("../../resources/pinned-files.json", import.meta.url))
const sample = pins.files.find((file) => file.id === "python/darwin-arm64/3.12.16-20261124")!
const file = { ...sample, id: sample.id as PinnedFileId, bytes: payload.length, sha256: createHash("sha256").update(payload).digest("hex") }
const manifest: PinnedFiles = { schemaVersion: 1, files: [file] }
const relay = `https://${CODEPUPPY_GITHUB_RELAY_HOST}${new URL(file.originUrl).pathname}`
const roots: string[] = []
afterEach(() => { roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })) })
function directory() { const root = realpathSync(mkdtempSync(join(tmpdir(), "pinned-files-"))); roots.push(root); return root }
function response(body: Uint8Array = payload, headers: HeadersInit = {}) {
  return new Response(body, { headers: { "content-length": String(body.length), ...headers } })
}
function broken() {
  let sent = false
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (sent) { controller.error(new Error("connection reset")); return }
    sent = true
    controller.enqueue(payload.subarray(0, 100))
  } }, { highWaterMark: 0 }))
}
function authority(route: (url: string, init: RequestInit) => Response | Promise<Response>, selected = manifest) {
  const calls: { url: string; init: RequestInit }[] = []
  const instance = createPinnedFileAuthority({ userData: directory(), manifest: selected, fetchImpl: async (url, init) => {
    calls.push({ url, init })
    return route(url, init)
  } })
  const run = () => instance.ensurePinnedFile({ id: file.id, targetPath: instance.targetPath(file.id) })
  return { ...instance, calls, run }
}

test("manifest validates the shipped pins and canonical GitHub asset identities", () => {
  expect(readPinnedFiles()).toEqual(pins)
  expect(parsePinnedFiles(pins)).toEqual(pins)
  for (const target of ["darwin-arm64", "win32-x64"]) {
    for (const family of ["python", "libreoffice"]) expect(pins.files.some((file) => file.family === family && file.target === target)).toBe(true)
  }
  const invalid = [
    null, {}, { ...manifest, schemaVersion: true }, { ...manifest, files: [null] },
    ...[
      { family: "node" }, { target: "darwin-x64" }, { id: "python/win32-x64/wrong" },
      { bytes: 0 }, { bytes: true }, { bytes: 1.5 }, { bytes: Number.MAX_SAFE_INTEGER + 1 },
      { version: "latest" }, { version: ">=3" }, { sha256: "A".repeat(64) }, { provenanceUrl: "" },
      ...[
        file.originUrl.replace("%2B", "+"), file.originUrl.replace("%2B", "%2b"),
        file.originUrl.replace("https:", "http:"), file.originUrl + "?token=x", file.originUrl + "#",
        file.originUrl.replace("github.com", "github.com:443"), file.originUrl.replace("github.com", "user@github.com"),
        file.originUrl.replace("20261124/", "%252f/"), file.originUrl.replace("20261124/", "%252e%252e/"),
        file.originUrl.replace("20261124/", "%5C/"), file.originUrl.replace("20261124/", "%00/"),
      ].map((originUrl) => ({ originUrl })),
    ].map((change) => ({ ...manifest, files: [{ ...file, ...change }] })),
    { ...manifest, files: [file, file] }, { ...manifest, files: [file, { ...file, id: file.id + "-copy" }] },
  ]
  for (const value of invalid) expect(() => parsePinnedFiles(value)).toThrow()
})

test("verified cache is rehashed and corrupt bytes redownload through relay", async () => {
  const host = authority(() => response())
  const path = host.targetPath(file.id)
  const progress: number[] = []
  expect(path).toContain(`/pinned-files/${file.id}/cpython-3.12.16+20261124-`)
  expect(await host.ensurePinnedFile({ id: file.id, targetPath: path, onProgress: (received) => progress.push(received) })).toEqual({ ok: true, path, via: "relay" })
  expect(progress.at(-1)).toBe(payload.length)
  expect(readFileSync(path)).toEqual(payload)
  expect(readdirSync(dirname(path))).toEqual([path.split("/").at(-1)!])
  expect(await host.run()).toEqual({ ok: true, path, via: "cache" })
  expect(host.calls).toHaveLength(1)
  writeFileSync(path, Buffer.alloc(payload.length))
  expect(await host.run()).toEqual({ ok: true, path, via: "relay" })
  expect(host.calls).toHaveLength(2)
})

test("relay transport, HTTP, length and hash failures fall back from byte zero without credentials", async () => {
  for (const fail of [() => broken(), () => new Response(null, { status: 503 }), () => response(payload.subarray(0, 30)), () => response(Buffer.alloc(payload.length))]) {
    const host = authority((url) => url === relay ? fail() : response())
    expect(await host.run()).toEqual({ ok: true, path: host.targetPath(file.id), via: "origin" })
    expect(host.calls.map((call) => call.url)).toEqual([relay, file.originUrl])
    for (const call of host.calls) {
      expect(call.init.credentials).toBe("omit")
      expect(call.init.redirect).toBe("manual")
      const headers = new Headers(call.init.headers)
      expect(headers.get("range")).toBeNull()
      expect(headers.get("if-range")).toBeNull()
      expect(headers.get("authorization")).toBeNull()
      expect(headers.get("cookie")).toBeNull()
    }
    expect(readFileSync(host.targetPath(file.id))).toEqual(payload)
  }
})

test("final delivery retains HTTP, connection and integrity facts and removes failed parts", async () => {
  for (const status of [404, 429, 503]) {
    const host = authority(() => new Response(null, { status }))
    expect(await host.ensureFile(file.id, new AbortController().signal, () => {})).toEqual({ result: { ok: false, error: "network" }, failure: { kind: "http", status, detail: `HTTP ${status}` } })
    expect(existsSync(host.targetPath(file.id))).toBe(false)
    expect(readdirSync(dirname(host.targetPath(file.id)))).toEqual([])
  }
  const connect = authority(() => { throw new Error("fetch failed", { cause: { code: "ECONNREFUSED" } }) })
  expect((await connect.ensureFile(file.id, new AbortController().signal, () => {})).failure?.kind).toBe("connect")
  const timeout = authority(() => { throw new Error("fetch failed", { cause: { code: "ETIMEDOUT" } }) })
  expect((await timeout.ensureFile(file.id, new AbortController().signal, () => {})).failure?.kind).toBe("timeout")
  const unknown = authority(() => { throw new Error("unclassified fetch failure") })
  expect((await unknown.ensureFile(file.id, new AbortController().signal, () => {})).failure?.kind).toBe("other")
  const corrupt = authority(() => response(Buffer.alloc(payload.length)))
  expect(await corrupt.run()).toEqual({ ok: false, error: "integrity" })
  expect(readdirSync(dirname(corrupt.targetPath(file.id)))).toEqual([])
})

test("redirects permit only this asset and GitHub CDN; origin redirect does not repeat fallback", async () => {
  const host = authority((url) => url === relay ? new Response(null, { status: 302, headers: { location: file.originUrl } }) : new Response(null, { status: 404 }))
  expect(await host.run()).toEqual({ ok: false, error: "network" })
  expect(host.calls.map((call) => call.url)).toEqual([relay, file.originUrl])
  for (const next of ["https://github.com/other/repo/releases/download/v1/file", "https://release-assets.githubusercontent.com.evil.test/x", "https://user@release-assets.githubusercontent.com/x", "http://objects.githubusercontent.com/x"]) {
    const invalid = authority((url) => url === relay ? new Response(null, { status: 302, headers: { location: next } }) : response())
    expect((await invalid.run()).ok).toBe(true)
    expect(invalid.calls.map((call) => call.url)).toEqual([relay, file.originUrl])
  }
  const cdn = "https://release-assets.githubusercontent.com/opaque?signature=redacted"
  const valid = authority((url) => url === relay ? new Response(null, { status: 302, headers: { location: cdn } }) : response())
  expect(await valid.run()).toEqual({ ok: true, path: valid.targetPath(file.id), via: "relay" })
  expect(valid.calls.map((call) => call.url)).toEqual([relay, cdn])
})

test("origin resumes a valid same-source range and restarts a 200 instead of appending", async () => {
  for (const resume of [true, false]) {
    let original = true
    const host = authority((url, init) => {
      if (url === relay) return new Response(null, { status: 502 })
      if (original) {
        original = false
        const res = broken()
        res.headers.set("accept-ranges", "bytes")
        res.headers.set("etag", '"original"')
        return res
      }
      expect(new Headers(init.headers).get("range")).toBe("bytes=100-")
      expect(new Headers(init.headers).get("if-range")).toBe('"original"')
      return resume ? new Response(payload.subarray(100), { status: 206, headers: { "content-range": `bytes 100-${payload.length - 1}/${payload.length}`, "content-length": String(payload.length - 100) } }) : response()
    })
    expect(await host.run()).toEqual({ ok: true, path: host.targetPath(file.id), via: "origin" })
    expect(readFileSync(host.targetPath(file.id))).toEqual(payload)
    expect(host.calls).toHaveLength(3)
  }
  const badRange = authority((url) => url === relay ? new Response(null, { status: 502 }) : new Response(payload, { status: 206, headers: { "content-range": `bytes 1-${payload.length}/${payload.length}` } }))
  expect(await badRange.run()).toEqual({ ok: false, error: "integrity" })
})

test("same ID shares download and progress; one cancellation leaves the other waiter alive", async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const host = authority(async (_url, init) => { await gate; expect(init.signal?.aborted).toBe(false); return response() })
  const controller = new AbortController()
  const first = host.ensurePinnedFile({ id: file.id, targetPath: host.targetPath(file.id), signal: controller.signal })
  const progress: number[] = []
  const second = host.ensureFile(file.id, new AbortController().signal, (received) => progress.push(received))
  controller.abort()
  expect(await first).toEqual({ ok: false, error: "cancelled" })
  release()
  expect(await second).toEqual({ result: { ok: true, path: host.targetPath(file.id), via: "relay" } })
  expect(host.calls).toHaveLength(1)
  expect(progress.at(-1)).toBe(payload.length)
})

test("distinct IDs with identical bytes remain independent and unknown IDs cause no download", async () => {
  const copy = { ...file, id: `${file.id}-copy` as PinnedFileId, originUrl: file.originUrl + "-copy" }
  const host = authority(() => response(), { schemaVersion: 1, files: [file, copy] })
  expect(await host.ensurePinnedFile({ id: "python/any/unknown", targetPath: "/unused" })).toEqual({ ok: false, error: "unknown-file" })
  expect(host.calls).toHaveLength(0)
  const results = await Promise.all([host.run(), host.ensurePinnedFile({ id: copy.id, targetPath: host.targetPath(copy.id) })])
  expect(results.every((result) => result.ok)).toBe(true)
  expect(host.calls).toHaveLength(2)
})

test("disk errors, symlink escape and non-host targets never cause network fallback", async () => {
  const host = authority(() => response())
  expect(await host.ensurePinnedFile({ id: file.id, targetPath: join(directory(), "outside") })).toEqual({ ok: false, error: "disk" })
  mkdirSync(dirname(dirname(host.targetPath(file.id))), { recursive: true })
  symlinkSync(directory(), dirname(host.targetPath(file.id)))
  expect(await host.run()).toEqual({ ok: false, error: "disk" })
  expect(host.calls).toHaveLength(0)
  const disk = authority(() => response())
  mkdirSync(disk.targetPath(file.id), { recursive: true })
  expect(await disk.run()).toEqual({ ok: false, error: "disk" })
  expect(disk.calls).toHaveLength(0)
})

test("cancelled transfer publishes no cache and a fresh request can retry", async () => {
  let started!: () => void
  const waiting = new Promise<void>((resolve) => { started = resolve })
  const controller = new AbortController()
  let cancelled = false
  const host = authority((_url, init) => {
    if (cancelled) return response()
    started()
    return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => { cancelled = true; reject(init.signal!.reason) }, { once: true }))
  })
  const first = host.ensurePinnedFile({ id: file.id, targetPath: host.targetPath(file.id), signal: controller.signal })
  await waiting
  controller.abort()
  expect(await first).toEqual({ ok: false, error: "cancelled" })
  expect(existsSync(host.targetPath(file.id))).toBe(false)
  expect(await host.run()).toEqual({ ok: true, path: host.targetPath(file.id), via: "relay" })
  expect(host.calls).toHaveLength(2)
})

test("ID-only host bridge uses the shared authority and rejects URL overrides without I/O", async () => {
  const host = authority(() => response())
  const requests: unknown[] = []
  const replies: unknown[] = []
  const client = createPinnedFileRequester((value) => { requests.push(value); main.receive(value) }, "one")
  const main = createPinnedFileMainBridge(host, "one", (value) => { replies.push(value); client.receive(value) })
  const progress: number[] = []
  const result = await client.ensureFile(file.id, new AbortController().signal, (received) => progress.push(received))
  expect(result).toEqual({ result: { ok: true, path: host.targetPath(file.id), via: "relay" } })
  expect(progress.at(-1)).toBe(payload.length)
  expect(requests).toEqual([{ type: "codepuppy.pinned-file.ensure", id: 1, sidecarGeneration: "one", fileId: file.id }])
  expect(main.receive({ type: "codepuppy.pinned-file.ensure", id: 2, sidecarGeneration: "one", fileId: file.id, url: "https://untrusted.test/file" })).toBe(true)
  expect(replies.at(-1)).toMatchObject({ id: 2, delivery: { result: { ok: false, error: "unknown-file" } } })
  expect(host.calls).toHaveLength(1)
  main.receive({ type: "codepuppy.pinned-file.ensure", id: 77, sidecarGeneration: "old", fileId: file.id })
  expect(replies.at(-1)).toMatchObject({ id: 77, sidecarGeneration: "old", delivery: { result: { ok: false, error: "cancelled" } } })
  expect(await client.ensureFile("python/any/unknown", new AbortController().signal, () => {})).toEqual({ result: { ok: false, error: "unknown-file" } })
  expect(host.calls).toHaveLength(1)
  client.close()
  await main.dispose()
})

test("bridge cancellation belongs to one request, and generation close releases all waiters", async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const host = authority(async () => { await gate; return response() })
  const client = createPinnedFileRequester((value) => main.receive(value), "one")
  const main = createPinnedFileMainBridge(host, "one", (value) => client.receive(value))
  const controller = new AbortController()
  const first = client.ensureFile(file.id, controller.signal, () => {})
  const second = client.ensureFile(file.id, new AbortController().signal, () => {})
  controller.abort()
  expect(await first).toEqual({ result: { ok: false, error: "cancelled" } })
  release()
  expect((await second).result.ok).toBe(true)
  expect(host.calls).toHaveLength(1)
  client.close()
  await main.dispose()

  const messages: PinnedFileRequest[] = []
  const disconnected = createPinnedFileRequester((value) => { if (value.type === "codepuppy.pinned-file.ensure") messages.push(value); else throw Error("port closed") }, "new")
  const waiting = disconnected.ensureFile(file.id, new AbortController().signal, () => { throw Error("old progress consumed") })
  const another = disconnected.ensureFile(file.id, new AbortController().signal, () => {})
  disconnected.receive({ type: "codepuppy.pinned-file.progress", id: messages[0]!.id, sidecarGeneration: "old", received: 1, total: 2 })
  disconnected.receive({ type: "codepuppy.pinned-file.result", id: messages[0]!.id, sidecarGeneration: "old", delivery: { result: { ok: true, path: "/old", via: "cache" } } })
  disconnected.close()
  expect(await waiting).toEqual({ result: { ok: false, error: "cancelled" } })
  expect(await another).toEqual({ result: { ok: false, error: "cancelled" } })
})
