import { describe, expect, test } from "bun:test"
import { isDocumentRuntimeState, isDocumentRuntimeVerifyTask, isDocumentRuntimeVerifyReceipt, sameDocumentVerifyRef } from "./codepuppy-document.js"
const task = { taskId: "task-1", sidecarGeneration: 1, registrationId: "registration-1", location: { directory: "/workspace" }, pinId: "libreoffice/darwin-arm64/26.8.3", pinSha256: "a".repeat(64), kind: "libreoffice", runtimeRoot: "/state/candidate", jobRoot: "/state/jobs/one" }
describe("document runtime", () => {
  test("validates pure task and completion data without accepting malformed identity/results", () => {
    expect(isDocumentRuntimeVerifyTask(task)).toBe(true)
    const receipt = { ...task, status: "completed", version: "26.8.3", pdfPath: "/state/jobs/one/control.pdf", pdfSha256: "b".repeat(64), pageCount: 2 }
    expect(isDocumentRuntimeVerifyReceipt(receipt)).toBe(true)
    for (const changed of [{ sidecarGeneration: -1 }, { pinSha256: "no" }, { runtimeRoot: "relative" }, { location: { directory: "relative" } }, { pinId: "libreoffice/darwin-x64/26.8.3" }]) expect(isDocumentRuntimeVerifyTask({ ...task, ...changed })).toBe(false)
    for (const changed of [{ pageCount: 0 }, { pdfSha256: "no" }, { pdfPath: "relative" }]) expect(isDocumentRuntimeVerifyReceipt({ ...receipt, ...changed })).toBe(false)
    if (!isDocumentRuntimeVerifyTask(task)) throw Error("invalid fixture")
    expect(sameDocumentVerifyRef(task, { ...task, registrationId: "other" })).toBe(false)
  })
  test("validates genuine progress units, ready paths and shared failure shapes", () => {
    for (const state of [{ phase: "preparing", stage: "download", received: 100, total: 200 }, { phase: "ready", version: "26.8.3", executable: "C:\\runtime\\program\\soffice.com" }, { phase: "failed", failure: { kind: "unknown", detail: "integrity" } }]) expect(isDocumentRuntimeState(state)).toBe(true)
    for (const state of [{ phase: "ready", executable: "/soffice" }, { phase: "preparing", stage: "download", received: 3, total: 2 }, { phase: "failed", failure: { kind: "download" } }]) expect(isDocumentRuntimeState(state)).toBe(false)
  })
})

import { isRenderRequest, isRenderResult, documentMetadata, documentArtifactFromMetadata, documentHost, publishDocumentHost, type DocumentHost, type RenderResult } from "./codepuppy-document.js"
describe("document render receipts", () => {
  const artifact = { checkId: "check", kind: "pdf" as const, sourcePath: "/workspace/report.pdf", sourceSha256: "a".repeat(64), artifactPath: "/workspace/report.pdf", artifactSha256: "a".repeat(64) }
  test("all normal result arms retain one shared, validated artifact envelope", () => {
    const results: RenderResult[] = [{ status: "pending", checkId: "check", artifact, runtime: { phase: "preparing", stage: "verify" } }, { status: "failed", code: "conversion", detail: "LO failed", artifact }, { status: "rendered", receipt: { ...artifact, id: "render", revision: 0, renderer: "pdfium", rendererVersion: "test", pageCount: 1, pages: [{ number: 1, path: "/workspace/.document-output/1.png", sha256: "b".repeat(64), width: 2, height: 3 }], template: null, diagnostics: [] } }]
    for (const result of results) {
      expect(isRenderResult(result)).toBe(true)
      expect(documentArtifactFromMetadata(documentMetadata(result))).toMatchObject(artifact)
    }
    expect(documentArtifactFromMetadata({ codepuppyDocument: { schemaVersion: 2, artifact } })).toBeUndefined()
    expect(documentArtifactFromMetadata({ codepuppyDocument: { schemaVersion: 1, artifact: { ...artifact, artifactSha256: "bad" } } })).toBeUndefined()
    const rendered = results[2]
    if (rendered.status !== "rendered") throw Error("fixture")
    expect(isRenderResult({ ...rendered, receipt: { ...rendered.receipt, pageCount: 2 } })).toBe(false)
  })
  test("request geometry and design output obey the frozen business shape", () => {
    expect(isRenderRequest({ kind: "pdf", path: "/workspace/report.pdf", dpi: 0.25 })).toBe(true)
    expect(isRenderRequest({ kind: "html", path: "/workspace/report.html", viewport: { width: 1, height: 1 } })).toBe(true)
    for (const value of [{ kind: "design", path: "/workspace/source.html" }, { kind: "pdf", path: "/workspace/report.pdf", outputPath: "/workspace/out.png" }, { kind: "pdf", path: "/workspace/report.pdf", dpi: Infinity }]) expect(isRenderRequest(value)).toBe(false)
  })
  test("a process publishes exactly one real host and never fabricates an unregistered fallback", () => {
    expect(() => documentHost()).toThrow("not published")
    const host = {} as DocumentHost
    publishDocumentHost(host)
    expect(documentHost()).toBe(host)
    expect(() => publishDocumentHost(host)).toThrow("already published")
  })
})
