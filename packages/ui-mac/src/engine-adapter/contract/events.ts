// `#1697`(I-04,设计 §4.5):`GET /global/event` 的帧格式与事件表 —— 第 1 版 = 翻译器今天发出的全部事件类型,逐个列名
// (`mcp.*` 不再按前缀直通)。载荷按设计 §4.3 规则 1 引用发出它的冻结客户端声明的事件类型(v1 SDK 的 `Event*`,v1 SDK 没有而
// 1.17.13 客户端有的三种按 R4 引用后者);两个冻结客户端都没声明的按规则 2 自声明。
// 引擎公开事件流不发的类型不在表里(R17:`lsp.updated`、`global.disposed`、`mcp.tools.changed`、`mcp.prompts.changed`;
// contract-cases.test.ts 守着引擎的事件清单,哪天它开始发其中任何一种就红,约定要有意识地扩)。
// 登记的是翻译器**实际发出**的字段:有几种它发的比冻结客户端声明的少(下面逐条注明),冻结 app 的事件归约
// (codepuppy-app/src/context/global-sync/event-reducer.ts)只读发出的那些,所以按实际发出的形状收窄,不为凑类型补字段。
import type * as Legacy from "@opencode-ai/client/promise"
import type * as V1 from "@opencode-ai/sdk/v2/client"

/** SSE:每帧 `data: <JSON>\n\n`,JSON = ContractFrame;directory 为 "global" 表示不属于某个目录。 */
export type ContractFrame = { directory: string; payload: ContractEvent }

export type ContractEventMap = {
  "pty.created": V1.EventPtyCreated["properties"]
  "pty.updated": V1.EventPtyUpdated["properties"]
  "pty.exited": V1.EventPtyExited["properties"]
  "pty.deleted": V1.EventPtyDeleted["properties"]
  "vcs.branch.updated": V1.EventVcsBranchUpdated["properties"]
  "reference.updated": V1.EventReferenceUpdated["properties"]
  "server.connected": V1.EventServerConnected["properties"]
  "mcp.status.changed": Legacy.McpStatusChanged["data"] // 消费方只看类型(codepuppy-app/src/context/server-sync.tsx)
  "mcp.resources.changed": Legacy.McpResourcesChanged["data"]
  "server.instance.disposed": V1.EventServerInstanceDisposed["properties"]
  "catalog.updated": V1.EventCatalogUpdated["properties"]
  "project.updated": V1.EventProjectUpdated["properties"]
  "permission.asked": V1.EventPermissionAsked["properties"]
  "permission.replied": V1.EventPermissionReplied["properties"]
  "question.asked": V1.EventQuestionAsked["properties"]
  "question.replied": V1.EventQuestionReplied["properties"]
  "question.rejected": V1.EventQuestionRejected["properties"]
  "file.watcher.updated": V1.EventFileWatcherUpdated["properties"]
  // 只发 info(归约只读 info)
  "session.created": Pick<V1.EventSessionCreated["properties"], "info">
  "session.updated": Pick<V1.EventSessionUpdated["properties"], "info">
  // info 只在这个窗口见过这个会话时带;归约读 info?.id ?? sessionID
  "session.deleted": Pick<V1.EventSessionDeleted["properties"], "sessionID"> & Partial<Pick<V1.EventSessionDeleted["properties"], "info">>
  // event-reducer.ts 读 sessionID、cost、tokens
  "session.usage.updated": Legacy.SessionUsageUpdated["data"]
  // 只发 info(归约只读 info)
  "message.updated": Pick<V1.EventMessageUpdated["properties"], "info">
  // `#1669`:编辑重发删除旧消息,收件箱投递也用它先移除受理时间版本。
  "message.removed": V1.EventMessageRemoved["properties"]
  // ContractPart = V1.Part:UC-09 的 `display` 已在 Code Puppy 自有的 sdk-v1 里声明,其余细化在开放的 `state.metadata` 里
  "message.part.updated": { part: V1.Part }
  "message.part.delta": V1.EventMessagePartDelta["properties"]
  "todo.updated": V1.EventTodoUpdated["properties"]
  "session.status": V1.EventSessionStatus["properties"]
  "session.error": V1.EventSessionError["properties"]
  "session.idle": V1.EventSessionIdle["properties"]
}

export type ContractEventType = keyof ContractEventMap
export type ContractEvent = { [T in ContractEventType]: { type: T; properties: ContractEventMap[T] } }[ContractEventType]
