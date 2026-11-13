// `#1697`(I-04 M4,设计 §4.2、R12):Code Puppy 自己的界面(renderer)与当前代翻译器取 v1 类型、建 v1 客户端的唯一入口。
// 类型按引用取冻结的 v1 SDK(codepuppy-sdk-v1,上游 1.18.35 的冻结副本,R4),只列今天用到的;`createOpencodeClient` 原样
// 转出同一个绑定(运行时不变,boundary.test.ts 钉住)。renderer 与 opencode2/ 不再直接 import `@opencode-ai/sdk`。
export { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
export type {
  Agent,
  AssistantMessage,
  Command,
  FileNode,
  FilePart,
  Message,
  ModelRef,
  ModelV2Info,
  Part,
  Path,
  PermissionRequest,
  PermissionV2Decision,
  PermissionV2DecisionCommand,
  PermissionV2DecisionReceipt,
  PermissionV2Request,
  PermissionV2Source,
  Project,
  Provider,
  ProviderListResponse,
  QuestionInfo,
  QuestionRequest,
  ReasoningPart,
  Session,
  TextPart,
  Todo,
  ToolPart,
  ToolState,
  UserMessage,
} from "@opencode-ai/sdk/v2/client"
