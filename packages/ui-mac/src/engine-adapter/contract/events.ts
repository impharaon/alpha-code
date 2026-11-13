// `#1697`(I-04,设计 §4.5):`GET /global/event` 的帧格式与事件表 —— 第 1 版 = 翻译器今天发出的全部事件类型,逐个列名
// (`mcp.*` 不再按前缀直通)。载荷按设计 §4.3 规则 1 引用 v1 SDK 声明的 `Event*`;两个冻结客户端都没声明的按规则 2 自声明。
// 本片(M1b)翻译器只按事件名定型;载荷按这里的类型定型随 M2b(计划 docs/specs/upgrade-ui-contract/plan.md),届时
// `session.usage.updated`、`mcp.status.changed`、`mcp.resources.changed` 改为引用 1.17.13 客户端的事件类型(R4,编排器裁决 2)。
import type * as V1 from "@opencode-ai/sdk/v2/client"

/** SSE:每帧 `data: <JSON>\n\n`,JSON = ContractFrame;directory 为 "global" 表示不属于某个目录。 */
export type ContractFrame = { directory: string; payload: ContractEvent }

export type ContractEventMap = {
  "pty.created": V1.EventPtyCreated["properties"]
  "pty.updated": V1.EventPtyUpdated["properties"]
  "pty.exited": V1.EventPtyExited["properties"]
  "pty.deleted": V1.EventPtyDeleted["properties"]
  "lsp.updated": V1.EventLspUpdated["properties"]
  "vcs.branch.updated": V1.EventVcsBranchUpdated["properties"]
  "reference.updated": V1.EventReferenceUpdated["properties"]
  "server.connected": V1.EventServerConnected["properties"]
  "global.disposed": V1.EventGlobalDisposed["properties"]
  "mcp.tools.changed": V1.EventMcpToolsChanged["properties"]
  "mcp.status.changed": Record<string, unknown> // 消费方只看类型(codepuppy-app/src/context/server-sync.tsx)
  "mcp.resources.changed": Record<string, unknown>
  "mcp.prompts.changed": Record<string, unknown> // 两个冻结客户端都没声明,也没有消费方读字段
  "server.instance.disposed": V1.EventServerInstanceDisposed["properties"]
  "catalog.updated": V1.EventCatalogUpdated["properties"]
  "project.updated": V1.EventProjectUpdated["properties"]
  "permission.asked": V1.EventPermissionAsked["properties"]
  "permission.replied": V1.EventPermissionReplied["properties"]
  "question.asked": V1.EventQuestionAsked["properties"]
  "question.replied": V1.EventQuestionReplied["properties"]
  "question.rejected": V1.EventQuestionRejected["properties"]
  "file.watcher.updated": V1.EventFileWatcherUpdated["properties"]
  "session.created": V1.EventSessionCreated["properties"]
  "session.updated": V1.EventSessionUpdated["properties"]
  "session.deleted": V1.EventSessionDeleted["properties"]
  // codepuppy-app/src/context/global-sync/event-reducer.ts 读 sessionID、cost、tokens
  "session.usage.updated": { sessionID: string; cost: V1.Session["cost"]; tokens: V1.Session["tokens"] }
  "message.updated": V1.EventMessageUpdated["properties"]
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
