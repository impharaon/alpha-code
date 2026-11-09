// staged-attachment-part — `#1665` 接口 I11'(编排器裁决 2026-11-09,alpha-code#1665 评论 6737733672):暂存附件随用户消息走的形状。
//
// composer(L6 的适配层)把每个暂存附件译成 `POST /api/session/:id/prompt` 的一个 `files` 条目:`data:` URI,里面**只装**这个附件的
// `StagedAttachmentMeta` JSON(几十字节),文件名用下面这个登记过的固定值。不走 `file://`:引擎提交时会把整份 Office/PDF 字节读进库,
// PDF 还会绕过本机读取工具直接发给模型(`packages/core/src/session/prompt.ts:110-140`、`session/runner/to-llm-message.ts:66`)。
//
// MIME 用 `text/plain`(开工实测,2.x CLI + 隔离 HOME/XDG):`data:` URI 里声明的 MIME 引擎不认 —— 它按字节嗅探
// (`prompt.ts` materializeAttachment 对 `data:` 给 `mime: undefined` ⇒ `Mime.detect`),自定义的
// `application/vnd.codepuppy.attachment+json` 存进库时已被改写成 `text/plain`。引擎把 `text/plain` 附件渲染成一段文本部件
// `\n\nAttached file: <文件名>\n\n<内容>`(`to-llm-message.ts` textAttachment),只有附件、没有文字的消息也不会被丢掉。
// ext 在 `session.hook.context` 里按这个文件名认出它,只在这次请求的副本里换成登记过的读取指令(attachment-reader-hooks.ts)。
//
// 本模块零依赖(renderer 与 ext 都能直接 import;同 ui-mac `shared/attachment-path.ts` 被 ext 引用的先例)。

/** 暂存附件部件的固定文件名(I11')。 */
export const STAGED_ATTACHMENT_PART_NAME = "codepuppy-attachment.json"
/** 暂存附件部件的 MIME(I11';自定义 MIME 会被引擎按字节嗅探改写,实测)。 */
export const STAGED_ATTACHMENT_PART_MIME = "text/plain"

/** 一个暂存附件 → prompt 的 `files` 条目(`data:` URI 只装它的 StagedAttachmentMeta JSON,UTF-8 → base64)。 */
export function stagedAttachmentPart(meta: unknown): { uri: string; name: string } {
  const bytes = new TextEncoder().encode(JSON.stringify(meta))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { uri: `data:${STAGED_ATTACHMENT_PART_MIME};base64,${btoa(binary)}`, name: STAGED_ATTACHMENT_PART_NAME }
}
