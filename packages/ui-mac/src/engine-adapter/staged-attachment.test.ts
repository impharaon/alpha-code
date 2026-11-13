// `#1668` I11'(`#1553` 暂存附件):v1 synthetic part → 2.x `files` 条目 → 引擎存下的形状 → v1 synthetic part,逐字相同。
//
// 「引擎存下的形状」取自真 2.x 引擎:fixtures/read-tool.json 的用户消息带一个暂存附件条目(`data:` URI 声明了自定义
// mime,引擎按字节嗅探存成 `text/plain`、文件名原样)。往返测试把 composer 真正发出的 part(buildAttachmentParts 的
// 生产函数)送进适配器的发送翻译,再按引擎的存法落成 2.x 用户消息,经读回投影比对。
import { describe, expect, test } from "bun:test"
import { STAGED_ATTACHMENT_PART_NAME } from "../../../ext/src/staged-attachment-part"
import { buildAttachmentParts } from "../renderer/codepuppy-ui/composer-attachments-core"
import readTool from "./fixtures/read-tool.json"
import { toPrompt, toV1Messages } from "./v1-shapes"

const meta = {
  v: 1 as const,
  name: "季度报告 Q3.pdf",
  mime: "application/pdf",
  size: 12_345,
  path: "attachments/0b1e8a52-7d1c-4c4b-9f0a-3c2d1e0f9a8b/季度报告 Q3.pdf",
  reader: "pdf" as const,
}

/** 按引擎的存法落一条 2.x 用户消息:data: URI 的载荷 base64 原样进 `data`,mime 嗅探成 text/plain,名字原样。 */
function stored(files: ReadonlyArray<{ uri: string; name?: string }>, text: string) {
  return {
    id: "msg_user_1",
    type: "user" as const,
    time: { created: 1 },
    text,
    files: files.map((file) => ({
      data: file.uri.replace(/^data:[^,]*;base64,/, ""),
      mime: "text/plain",
      source: { type: "inline" as const },
      name: file.name,
    })),
  }
}

describe("#1668 I11' 暂存附件往返", () => {
  test("composer 发出的 synthetic part → files 条目(data:、固定名、不是 file://)→ 读回的 v1 part 逐字相同", () => {
    const sent = buildAttachmentParts([
      { id: "a", name: meta.name, size: meta.size, kind: "document", mime: meta.mime, reader: meta.reader, directory: "/w", path: meta.path },
    ] as never) as Array<Record<string, unknown>>
    const prompt = toPrompt([{ type: "text", text: "看看这份报告" }, ...(sent as never[])])
    expect(prompt.text).toBe("看看这份报告")
    expect(prompt.files).toHaveLength(1)
    expect(prompt.files[0]!.uri.startsWith("data:")).toBe(true)
    expect(prompt.files[0]!.name).toBe(STAGED_ATTACHMENT_PART_NAME)

    const [message] = toV1Messages("ses_1", [stored(prompt.files, prompt.text)] as never)
    const restored = message!.parts.filter((part) => part.type === "text" && part.synthetic)
    expect(restored).toHaveLength(1)
    const { id, sessionID, messageID, ...shape } = restored[0] as Record<string, unknown>
    expect(JSON.stringify(shape)).toBe(JSON.stringify(sent[0]))
    expect([id, sessionID, messageID]).toEqual(["msg_user_1:0001", "ses_1", "msg_user_1"])
  })

  test("真引擎存下的那条(fixtures/read-tool.json)读回成 synthetic part,metadata 是发出去的 StagedAttachmentMeta", () => {
    const fixture = readTool as unknown as { sessionID: string; final: any[] }
    const user = toV1Messages(fixture.sessionID, fixture.final).find((item) => item.info.role === "user")!
    const synthetic = user.parts.find((part) => part.type === "text" && part.synthetic) as { metadata?: Record<string, unknown> }
    expect(synthetic?.metadata?.["codepuppy.attachment"]).toEqual({
      v: 1,
      name: "x.pdf",
      mime: "application/pdf",
      size: 3,
      path: "attachments/00000000-0000-4000-8000-000000000000/x.pdf",
      reader: "pdf",
    })
    expect(user.parts.some((part) => part.type === "file")).toBe(false)
  })

  test("反向臂:名字不是登记的固定名 ⇒ 不认,原样是一个普通文件 part(不会把用户的 JSON 文件当成附件卡)", () => {
    const prompt = toPrompt([{ type: "text", text: "x" }, ...(buildAttachmentParts([
      { id: "a", name: meta.name, size: meta.size, kind: "document", mime: meta.mime, reader: meta.reader, directory: "/w", path: meta.path },
    ] as never) as never[])])
    const renamed = prompt.files.map((file) => ({ ...file, name: "notes.json" }))
    const [message] = toV1Messages("ses_1", [stored(renamed, "x")] as never)
    expect(message!.parts.map((part) => part.type)).toEqual(["text", "file"])
  })
})
