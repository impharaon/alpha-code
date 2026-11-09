// REQ-236 `#1553` AC3 —— 暂存附件的读取指令:工具 id 由 mcpEngineToolId 推导、路径是 attachmentAbsolutePath 算出的绝对路径;
// 读取工具不可用时改为如实告知;指令每个字都由登记簿解释;renderer 用同一个函数判「已读取」。
import { describe, expect, test } from "bun:test"
import {
  ATTACHMENT_METADATA_KEY,
  attachmentAbsolutePath,
  type StagedAttachmentMeta,
} from "../../ui-mac/src/shared/attachment-path"
import { attachmentReadOf } from "../../ui-mac/src/renderer/codepuppy-ui/session-timeline/timeline-attachments"
import { attachmentInstruction } from "./attachment-reader-hooks"
import { mcpEngineToolId } from "./cloud-websearch-kill"
import { explainAttachmentBlock } from "./context-injection"

const DIR = "/Users/me/项目 A"
const UUID = "0b8c7f9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f"
const meta = (over: Partial<StagedAttachmentMeta> = {}): StagedAttachmentMeta => ({
  v: 1,
  name: "季度复盘.docx",
  mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: 2048,
  path: `attachments/${UUID}/季度复盘.docx`,
  reader: "word",
  ...over,
})
const stagedPart = (m: StagedAttachmentMeta, id = "prt_02") => ({
  id,
  sessionID: "ses_1",
  messageID: "msg_1",
  type: "text",
  text: "",
  synthetic: true,
  metadata: { [ATTACHMENT_METADATA_KEY]: m },
})
const connected = { "codepuppy-word": { status: "connected" }, "codepuppy-pdf": { status: "connected" } }

describe("attachmentInstruction", () => {
  test("读取工具就绪:工具 id = mcpEngineToolId(第一方服务名, 远端工具名),path = attachmentAbsolutePath(实例目录, 记录路径)", () => {
    const text = attachmentInstruction(meta(), DIR, connected)
    expect(text).toContain(mcpEngineToolId("codepuppy-word", "read_docx"))
    expect(text).toContain("codepuppy-word_read_docx")
    expect(text).toContain(attachmentAbsolutePath(DIR, meta().path))
    expect(explainAttachmentBlock(text)).toEqual({ ok: true, id: "attachment.read", kind: "wrapper" })
    const pdf = attachmentInstruction(meta({ reader: "pdf", path: `attachments/${UUID}/a.pdf` }), DIR, connected)
    expect(pdf).toContain("codepuppy-pdf_read_pdf")
  })
  test("准备中(pending)与状态读不到:照常叫模型去读,不替读取工具下「不可用」的结论", () => {
    expect(explainAttachmentBlock(attachmentInstruction(meta(), DIR, { "codepuppy-word": { status: "pending" } }))).toMatchObject({ id: "attachment.read" })
    expect(explainAttachmentBlock(attachmentInstruction(meta(), DIR, undefined))).toMatchObject({ id: "attachment.read" })
  })
  test("读取工具不可用:没装 / 停用 ⇒ missing,启动失败 ⇒ failed;都点名文件、不给工具 id 与路径", () => {
    for (const [services, id] of [
      [{}, "attachment.unavailable.missing"],
      [{ "codepuppy-word": { status: "disabled" } }, "attachment.unavailable.missing"],
      [{ "codepuppy-word": { status: "failed", error: "spawn ENOENT", code: "spawn_failed" } }, "attachment.unavailable.failed"],
      [{ "codepuppy-word": { status: "needs_auth" } }, "attachment.unavailable.failed"],
    ] as const) {
      const text = attachmentInstruction(meta(), DIR, services)
      expect(explainAttachmentBlock(text), JSON.stringify(services)).toEqual({ ok: true, id, kind: "template" })
      expect(text).toContain("季度复盘.docx")
      expect(text).not.toContain("read_docx")
      expect(text).toContain("如实告诉用户")
    }
  })
  test("ext 写进指令的路径与 renderer 判「已读取」用的是同一个函数:模型照抄指令里的路径(哪怕多了 // 或 ./)即判已读", () => {
    const path = attachmentAbsolutePath(DIR, meta().path)
    expect(attachmentInstruction(meta(), DIR, connected)).toContain(path)
    const call = (input: string) => ({
      type: "tool",
      display: { identity: { source: "mcp", origin: "codepuppy-word", name: "read_docx" } },
      state: { status: "completed", input: { path: input }, output: "{}" },
    })
    const read = (input: string) => attachmentReadOf(meta(), { directory: DIR, tools: [call(input) as never], turnActive: false }).kind
    expect(read(path)).toBe("read")
    expect(read(path.replace("/attachments/", "//attachments/./"))).toBe("read")
    expect(read(path.replace("季度复盘", "别的"))).toBe("not-read")
  })
})
