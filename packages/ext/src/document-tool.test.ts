import { describe, expect, test } from "bun:test"
import { createDocumentInspection } from "./document-check"
import { createDocumentTool } from "./document-tool"
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
})
