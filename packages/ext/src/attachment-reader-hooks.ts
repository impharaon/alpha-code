// attachment-reader-hooks — REQ-236 `#1553` AC3:给每个暂存附件追加读取指令(方案 §2.6「读取指令由 ext 写」)。
//
// composer 把 PDF / Word / Excel / PPT 存进会话实例目录的隐藏目录后,ext 给每个暂存附件写一句模型唯一看到的附件文字,
// 登记在 context-injection.ts(sink=attachment-block):
//   · 读取工具可用(或状态读不到)⇒ 叫模型调本机读取工具:工具 id = mcpEngineToolId(第一方 Office 服务名, 远端工具名)
//     (与 cloud-contract-hook 同一推导纪律),path = attachmentAbsolutePath(插件实例目录, metadata.path)—— renderer 判
//     「已读取」用的是同一个函数;
//   · 读取工具没装 / 停用 / 启动失败 ⇒ 叫模型如实告诉用户读不到以及原因。
// 宿主不自己调读取工具(插件 API 没有受支持的执行接缝,方案 §1.5),所以「读到没有」只由会话里的真实工具调用判定。
//
// `#1665`(OpenCode 2,接口 I11'):每个暂存附件随用户消息带一个 `data:` 文件部件(只装它的 StagedAttachmentMeta JSON,
// 文件名固定,见 staged-attachment-part.ts)。引擎把它渲染成一段文本部件 `\n\nAttached file: <文件名>\n\n<JSON>`;
// 本模块在 `session.hook.context` 里认出它(首行文件名 + 能过 `stagedAttachmentOf` 的 JSON),只在这次请求的副本里换成
// 登记过的读取指令。只有附件的消息也照常在请求里(实测),指令有处可挂。认不出 / JSON 不合形 ⇒ 原样不动。
import path from "node:path"
import {
  ATTACHMENT_READ_TOOL,
  attachmentAbsolutePath,
  attachmentReaderServer,
  type StagedAttachmentMeta,
} from "../../ui-mac/src/shared/attachment-path"
import { ATTACHMENT_METADATA_KEY, stagedAttachmentOf } from "../../ui-mac/src/shared/attachment-path"
import { mcpEngineToolId } from "./cloud-websearch-kill"
import { STAGED_ATTACHMENT_PART_NAME } from "./staged-attachment-part"
import { ATTACHMENT_READ_ID, attachmentUnavailableId, renderTemplate, renderWrapper } from "./context-injection"

/** 一条附件的指令文字。`services` 缺席 = 状态读不到:不替读取工具下「不可用」的结论,照常叫模型去读。 */
export function attachmentInstruction(meta: StagedAttachmentMeta, directory: string, services: Readonly<Record<string, unknown>> | undefined): string {
  const server = attachmentReaderServer(meta.reader)
  const status = services ? ((services[server] as { status?: unknown } | undefined)?.status ?? "absent") : "unknown"
  if (status === "absent" || status === "disabled")
    return renderTemplate(attachmentUnavailableId("missing"), { name: path.posix.basename(meta.path) })
  if (status === "failed" || status === "needs_auth" || status === "needs_client_registration")
    return renderTemplate(attachmentUnavailableId("failed"), { name: path.posix.basename(meta.path) })
  return renderWrapper(ATTACHMENT_READ_ID, {
    label: mcpEngineToolId(server, ATTACHMENT_READ_TOOL[meta.reader]),
    body: attachmentAbsolutePath(directory, meta.path),
  })
}

/** 引擎渲染出的暂存附件文本部件 → 它装的那条 StagedAttachmentMeta;不是本接口的部件 ⇒ undefined。 */
export function stagedAttachmentOfText(text: string): StagedAttachmentMeta | undefined {
  const body = text.replace(/^\n+/, "")
  const split = body.indexOf("\n\n")
  if (split < 0) return undefined
  const header = body.slice(0, split).split("\n")
  if (header[0] !== `Attached file: ${STAGED_ATTACHMENT_PART_NAME}`) return undefined
  try {
    return stagedAttachmentOf({ [ATTACHMENT_METADATA_KEY]: JSON.parse(body.slice(split + 2)) })
  } catch {
    return undefined
  }
}

type MessageLike = { role?: unknown; content?: unknown; constructor: new (fields: Record<string, unknown>) => unknown }

export type AttachmentReaderHookDeps = {
  /** 本 Location 的目录 = 本机读取工具的授权工作区。 */
  readonly directory: string
  /** 逐服务状态(`server 名 → { status }`);读不到 ⇒ undefined(不替读取工具下「不可用」的结论)。 */
  readonly mcpStatus: () => Promise<Readonly<Record<string, unknown>> | undefined>
  readonly error?: (message: string) => void
}

export function createAttachmentReaderHooks(deps: AttachmentReaderHookDeps) {
  return {
    /** I11':只在这次请求的副本里把暂存附件部件换成读取指令。绝不抛(抛出会打死这次请求)。 */
    async context(event: { messages: unknown[] }): Promise<void> {
      try {
        const hits: Array<{ message: number; part: number; meta: StagedAttachmentMeta }> = []
        event.messages.forEach((raw, m) => {
          const message = raw as MessageLike
          if (message.role !== "user" || !Array.isArray(message.content)) return
          message.content.forEach((value, p) => {
            const part = value as { type?: unknown; text?: unknown }
            const meta = part.type === "text" && typeof part.text === "string" ? stagedAttachmentOfText(part.text) : undefined
            if (meta) hits.push({ message: m, part: p, meta })
          })
        })
        if (hits.length === 0) return
        let services: Readonly<Record<string, unknown>> | undefined
        try {
          services = await deps.mcpStatus()
        } catch (error) {
          deps.error?.(`[@codepuppy/ext] attachment reader: MCP status unavailable (${error instanceof Error ? error.message : String(error)})`)
        }
        const replaced = new Map<number, unknown[]>()
        for (const hit of hits) {
          const content = [...(replaced.get(hit.message) ?? ((event.messages[hit.message] as MessageLike).content as unknown[]))]
          content[hit.part] = { type: "text", text: attachmentInstruction(hit.meta, deps.directory, services) }
          replaced.set(hit.message, content)
        }
        for (const [index, content] of replaced) {
          const message = event.messages[index] as MessageLike
          event.messages[index] = new message.constructor({ ...message, content })
        }
      } catch (error) {
        deps.error?.(`[@codepuppy/ext] attachment reader (context) failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}
