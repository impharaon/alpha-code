import type { Info } from "@opencode/plugin/promise/tool"
import { Schema } from "effect"
import {
  DocumentToolInputSchema,
  documentMetadata,
  isRenderRequest,
  type DocumentHost,
  type DocumentCaller,
  type DocumentCheckReport,
  type RenderRequest,
  type RenderResult,
} from "../../util/src/codepuppy-document"
import { TOOL_TEXT } from "./context-injection"
import { engineToolInput } from "./engine-tool-input"

const engineInput = engineToolInput(DocumentToolInputSchema)

export function createDocumentTool(input: {
  host: () => DocumentHost
  location: DocumentCaller["location"]
  check: (caller: DocumentCaller, report: DocumentCheckReport, host: DocumentHost) => Promise<DocumentCheckReport>
  render: (
    caller: DocumentCaller,
    request: RenderRequest,
    checkId?: string,
    revision?: 0 | 1,
    signal?: AbortSignal,
  ) => Promise<RenderResult>
}): Info {
  return {
    name: "codepuppy_document",
    description: TOOL_TEXT.codepuppy_document.description,
    input: engineInput,
    options: { codemode: false },
    async execute(value: unknown, context) {
      let args: typeof DocumentToolInputSchema.Type
      try {
        args = Schema.decodeUnknownSync(DocumentToolInputSchema, { onExcessProperty: "error" })(value)
      } catch {
        return {
          content: JSON.stringify({ status: "failed", code: "invalid-input", detail: "invalid document tool input" }),
        }
      }
      const caller = { location: input.location, sessionID: context.sessionID }
      if (args.action === "environment") return { content: JSON.stringify(await input.host().environment(caller)) }
      if (args.action === "check") {
        await context.progress({ title: "检查", codepuppyDocumentStage: "inspect" })
        const report = await input.check(caller, args.report as DocumentCheckReport, input.host())
        return {
          metadata: { title: "检查", codepuppyDocumentStage: "inspect" },
          content: JSON.stringify({
            status: "recorded",
            checkId: args.report.checkId,
            coverage: report.uninspected.length ? "partial" : "complete",
          }),
        }
      }
      if (!isRenderRequest(args.request))
        return {
          content: JSON.stringify({ status: "failed", code: "invalid-input", detail: "invalid render request" }),
        }
      await context.progress({ title: "渲染", codepuppyDocumentStage: "render" })
      const result = await input.render(caller, args.request, args.checkId, args.revision, context.signal)
      return {
        content: JSON.stringify(result),
        metadata: { ...documentMetadata(result), title: "渲染", codepuppyDocumentStage: "render" },
      }
    },
  }
}
