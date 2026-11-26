import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Location } from "../../../schema/src/location"
import type { DocumentRuntimeState, DocumentRuntimeVerifyTask, DocumentRuntimeVerifyReceipt } from "../../../util/src/codepuppy-document"
import type { PinnedFiles } from "../../../util/src/codepuppy-pinned-files"
import { createDocumentRuntime } from "./document-runtime"

const roots: string[] = []
const runtimes: ReturnType<typeof createDocumentRuntime>[] = []
afterEach(async () => { for (const runtime of runtimes.splice(0)) await runtime.dispose(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const pdf = readFileSync(join(import.meta.dir, "fixtures/document-runtime/control.pdf"))
const digest = createHash("sha256").update(pdf).digest("hex")
// This is our own manifest contract, not a mocked download or a published release claim.
const pin = { id: "libreoffice/darwin-arm64/test-version", family: "libreoffice", target: "darwin-arm64", version: "test-version", originUrl: "https://github.com/test/test/releases/download/test-version/fixture.dmg", provenanceUrl: "https://example.org/fixture", sha256: "a".repeat(64), bytes: 1 } as const
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "document-runtime-"))); roots.push(root)
  const assets = join(root, "assets")
  cpSync(join(import.meta.dir, "fixtures/document-assets"), assets, { recursive: true })
  const location = { directory: root as Location.Ref["directory"] }
  const counts = { acquire: 0, extract: 0, verify: 0 }
  const input = {
    manifest: { schemaVersion: 1, files: [pin] } satisfies PinnedFiles, platform: "darwin-arm64" as const, userData: root, assets, resources: root, python: process.execPath, sidecarGeneration: 3,
    ensureFile: async (_id: string, _signal: AbortSignal, progress: (received: number, total: number) => void) => { counts.acquire++; progress(1, 1); return { result: { ok: true as const, path: join(root, "fixture.dmg"), via: "cache" as const } } },
    classifyFailure: () => ({ kind: "unknown" as const, detail: "preserved delivery facts" }),
    extract: async ({ destination }: { destination: string }) => { counts.extract++; const file = join(destination, "LibreOffice.app/Contents/MacOS/soffice"); mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, "extracted candidate") },
  }
  const completed = async (task: DocumentRuntimeVerifyTask): Promise<DocumentRuntimeVerifyReceipt> => {
    counts.verify++
    const pdfPath = join(task.jobRoot, "control.pdf")
    copyFileSync(join(import.meta.dir, "fixtures/document-runtime/control.pdf"), pdfPath)
    return { ...task, status: "completed", version: pin.version, pdfPath, pdfSha256: digest, pageCount: 1 }
  }
  return { input, location, counts, completed }
}
function until(runtime: ReturnType<typeof createDocumentRuntime>, condition: (state: DocumentRuntimeState) => boolean) {
  return new Promise<DocumentRuntimeState>((resolve) => {
    let unsubscribe = () => {}
    unsubscribe = runtime.subscribe((state) => { if (condition(state)) { queueMicrotask(() => unsubscribe()); resolve(state) } })
  })
}
describe("document runtime", () => {
  test("queries return immediately, share acquisition/extraction and wait for a real verification registration", async () => {
    const f = fixture(); const runtime = createDocumentRuntime(f.input); runtimes.push(runtime)
    const verifying = until(runtime, (s) => s.phase === "preparing" && s.stage === "verify")
    expect(runtime.query(f.location).phase).toBe("preparing")
    runtime.query(f.location)
    await verifying
    expect(f.counts).toEqual({ acquire: 1, extract: 1, verify: 0 })
    const ready = until(runtime, (s) => s.phase === "ready")
    runtime.subscribeRuntimeVerify(f.location, f.completed)
    const state = await ready
    expect(state.phase).toBe("ready")
    if (state.phase !== "ready") throw Error("not ready")
    expect(readFileSync(state.executable, "utf8")).toBe("extracted candidate")
    expect(f.counts.verify).toBe(1)
  })
  test.each(["generation", "pin", "registration", "digest", "outside", "version", "failure"])("rejects %s verification evidence before ready", async (fault) => {
    const f = fixture(); const runtime = createDocumentRuntime(f.input); runtimes.push(runtime)
    const failed = until(runtime, (s) => s.phase === "failed" || s.phase === "ready")
    runtime.subscribeRuntimeVerify(f.location, async (task) => {
      const receipt = await f.completed(task)
      if (receipt.status !== "completed") throw Error("invalid fixture")
      if (fault === "generation") receipt.sidecarGeneration++
      if (fault === "pin") receipt.pinSha256 = "b".repeat(64)
      if (fault === "registration") receipt.registrationId = "different"
      if (fault === "digest") receipt.pdfSha256 = "b".repeat(64)
      if (fault === "outside") receipt.pdfPath = join(f.location.directory, "outside.pdf"), writeFileSync(receipt.pdfPath, pdf)
      if (fault === "version") receipt.version = "different"
      if (fault === "failure") return { ...task, status: "failed", reason: "conversion", detail: "actual conversion diagnostic", stderr: "nonzero", exitCode: 1 }
      return receipt
    })
    runtime.query(f.location)
    const result = await failed
    expect(result.phase).toBe("failed")
    if (result.phase !== "failed") throw Error("not failed")
    expect(result.failure.kind).toBe("unknown")
  })
  test("cancelling a Location invalidates its late success and transfers one attempt to a live requester", async () => {
    const f = fixture(); const runtime = createDocumentRuntime(f.input); runtimes.push(runtime)
    const second = { directory: join(f.location.directory, "second") as Location.Ref["directory"] }
    let start!: () => void
    const started = new Promise<void>((resolve) => { start = resolve })
    const cleanup = runtime.subscribeRuntimeVerify(f.location, async (task, signal) => {
      start()
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
      return f.completed(task) // deliberately late completed, not a cooperative cancellation receipt
    })
    runtime.subscribeRuntimeVerify(second, f.completed)
    const ready = until(runtime, (s) => s.phase === "ready")
    runtime.query(f.location); runtime.query(second)
    await started; await cleanup(); await ready
    expect(f.counts).toEqual({ acquire: 1, extract: 1, verify: 2 })
  })
  test("shared file failure facts reach the existing classifier and never unpack", async () => {
    const f = fixture(); let classified = false
    const runtime = createDocumentRuntime({ ...f.input, ensureFile: async () => ({ result: { ok: false, error: "integrity" }, failure: { kind: "integrity", detail: "SHA mismatch" } }), classifyFailure: (delivery) => { expect(delivery.failure?.detail).toBe("SHA mismatch"); classified = true; return { kind: "unknown", detail: "SHA mismatch" } } }); runtimes.push(runtime)
    const failed = until(runtime, (s) => s.phase === "failed"); runtime.query(f.location); await failed
    expect(classified).toBe(true); expect(f.counts.extract).toBe(0)
  })
})

test("Python projection is live before state notifications and invalidated before registration cleanup", async () => {
  const f = fixture()
  // Actual Plugin.Context.location is Location.Info and includes project; the file contract is only Location.Ref.
  Object.assign(f.location, { project: { id: "global", directory: f.location.directory, canonical: f.location.directory } })
  const runtime = createDocumentRuntime({ ...f.input, resources: join(import.meta.dir, "../../resources") })
  runtimes.push(runtime)
  const unregister = runtime.subscribeRuntimeVerify(f.location, f.completed, "python-registration")
  const environment = runtime.pythonEnvironment(f.location)
  const first = JSON.parse(readFileSync(environment.CODEPUPPY_DOCUMENT_HOST, "utf8"))
  expect(first).toMatchObject({ status: "active", registrationId: "python-registration", sidecarGeneration: 3, pinSha256: pin.sha256 })
  expect(first.location).toEqual({ directory: f.location.directory })
  expect(readFileSync(first.jobs.fontconfigTemplate, "utf8")).toContain("{{JOB_FONT_CACHE}}")
  const ready = until(runtime, (state) => state.phase === "ready" || state.phase === "failed")
  const stop = runtime.subscribe((state) => {
    expect(JSON.parse(readFileSync(environment.CODEPUPPY_DOCUMENT_HOST, "utf8")).runtime).toEqual(state)
  })
  expect((await ready).phase).toBe("ready")
  stop()
  const final = JSON.parse(readFileSync(environment.CODEPUPPY_DOCUMENT_HOST, "utf8"))
  expect(final.sequence).toBeGreaterThan(first.sequence)
  await unregister()
  expect(JSON.parse(readFileSync(environment.CODEPUPPY_DOCUMENT_HOST, "utf8"))).toMatchObject({ status: "invalidated", reason: "location-disposed", registrationId: "python-registration" })
  expect(() => runtime.pythonEnvironment(f.location)).toThrow("live Location registration")
})

test("a failed preparation retries only through the explicit action, never in ready or preparing", async () => {
  const f = fixture()
  let attempts = 0
  const runtime = createDocumentRuntime({ ...f.input, ensureFile: async (...args) => ++attempts === 1 ? { result: { ok: false, error: "network" }, failure: { kind: "connect", detail: "fixture interrupted" } } : f.input.ensureFile(...args) })
  runtimes.push(runtime)
  expect(typeof runtime.retry).toBe("function")
  runtime.retry()
  expect(attempts).toBe(0)
  runtime.subscribeRuntimeVerify(f.location, f.completed)
  const failed = until(runtime, (state) => state.phase === "failed")
  runtime.query(f.location)
  await failed
  expect(attempts).toBe(1)
  const ready = until(runtime, (state) => state.phase === "ready")
  runtime.retry()
  await ready
  expect(attempts).toBe(2)
  runtime.retry()
  expect(attempts).toBe(2)
})
