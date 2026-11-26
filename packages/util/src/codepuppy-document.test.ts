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
