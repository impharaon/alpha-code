import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { createDocumentInspection } from "./document-check"
import { createDocumentTool } from "./document-tool"
import { separatelyBundledEngineRuntime } from "./engine-runtime.harness"
import type { DocumentCaller, DocumentHost, RenderResult } from "../../util/src/codepuppy-document"

describe("document tool", () => {
  test("model input cannot replace the bound Location/session or trigger execution with invalid parameters", async () => {
    let executed = 0
    const location = { directory: "/workspace" } as DocumentCaller["location"]
    const render = async (): Promise<RenderResult> => {
      executed++
      return { status: "failed", code: "source-missing", detail: "not found" }
    }
    const tool = createDocumentTool({ check: createDocumentInspection().check, host: () => ({}) as DocumentHost, location, render })
    for (const input of [
      {
        action: "render",
        caller: { location: { directory: "/other" } },
        request: { kind: "pdf", path: "/workspace/report.pdf" },
      },
      { action: "render", request: { kind: "pdf", path: "/workspace/report.pdf", dpi: NaN } },
      { action: "render", request: { kind: "design", path: "/workspace/poster.html" } },
    ]) {
      const result = await tool.execute(input, {
        sessionID: "ses_document",
        signal: new AbortController().signal,
        progress: async () => {},
      } as never)
      expect(JSON.parse(String(result.content)).code).toBe("invalid-input")
    }
    expect(executed).toBe(0)
  })

  // The calls the model made in the composed product engine (2026-11-28 document-quality run, opencode-dev.db; workspace path
  // replaced): both renders died there with "Cannot convert a Symbol value to a number" while `environment` passed.
  test.each([
    { action: "environment" },
    { action: "render", checkId: "q3-report-1", revision: 0, request: { kind: "docx", path: "/workspace/report.docx", dpi: 110 } },
    { action: "render", checkId: "q3-report-1", request: { kind: "docx", path: "/workspace/report.docx" }, revision: 0 },
  ])("an engine with its own Effect runs $action with the model's arguments", async (args) => {
    const engine = await separatelyBundledEngineRuntime()
    const calls: unknown[] = []
    const tool = createDocumentTool({
      location: { directory: "/workspace" } as DocumentCaller["location"],
      host: () => ({ environment: async () => (calls.push("environment"), {}) }) as unknown as DocumentHost,
      check: createDocumentInspection().check,
      render: async (_caller, request, checkId, revision) => {
        calls.push({ request, checkId, revision })
        return { status: "failed", code: "source-missing", detail: "not found" }
      },
    })
    // The engine adapts a promise plugin's tool to an Effect one (plugin promise adapter `executePromiseTool`).
    const engineTool = { ...tool, execute: (input: unknown, context: object) => Effect.promise((signal) => tool.execute(input, { ...context, signal, progress: async () => {} } as never)) }
    const context = { sessionID: "ses_document", agent: "build", messageID: "msg_document", id: "call_document", progress: () => Effect.void }
    const exit = await Effect.runPromiseExit(engine.execute(engineTool as never, args, context as never))
    expect(Exit.isSuccess(exit) ? "settled" : String(exit.cause)).toBe("settled")
    const { action, ...render } = args as { action: string }
    expect(calls).toEqual([action === "environment" ? "environment" : render])
  })
})

test.each(["conversion", "timeout"] as const)("document workflow titles end after render %s", async (code) => {
  const fs = await import("node:fs")
  const path = await import("node:path")
  const os = await import("node:os")
  const { registerDocumentTools, documentToolForLocation, documentSessionActive } = await import("./document-register")
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "document-stage-")))
  const location = { directory: root } as DocumentCaller["location"]
  const caller = { location, sessionID: "ses_document" } as DocumentCaller
  fs.mkdirSync(path.join(root, ".document-output"))
  const source = path.join(root, "report.html"); fs.writeFileSync(source, "<!doctype html><title>Report</title><p>Report</p>")
  const host = { subscribeReady: () => () => {}, subscribeRuntimeVerify: () => async () => {}, environment: async () => ({ python: process.execPath, node: process.execPath, nodeModules: root, skills: root, templates: root, fonts: root, workRoot: path.join(root, ".document-output"), renderState: { phase: "preparing", stage: "download" }, pythonEnvironment: { CODEPUPPY_DOCUMENT_HOST: path.join(root, "host.json") } }) } as unknown as DocumentHost
  const cleanup = await registerDocumentTools({ location, session: {} } as never, { host, sidecarGeneration: 1, manifest: { schemaVersion: 1, files: [] }, resources: { python: process.execPath, assets: root, templates: root, documentRuntimeRoot: path.join(root, "runtime"), verify: "unused", render: "unused", recalculate: "unused" }, chromium: async () => { expect(documentSessionActive(location, caller.sessionID)).toBe(true); return { status: "failed", code, detail: "controlled renderer failure" } } })
  try {
    const result = await documentToolForLocation(location).execute({ action: "render", request: { kind: "html", path: source } }, { sessionID: caller.sessionID, signal: new AbortController().signal, progress: async () => {} } as never)
    expect(JSON.parse(String(result.content)).status).toBe("failed")
    expect(documentSessionActive(location, caller.sessionID)).toBe(false)
  } finally { await cleanup(); fs.rmSync(root, { recursive: true, force: true }) }
})
